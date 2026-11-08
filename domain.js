'use strict';
const { requirePermission, allowedBranches } = require('./security');
const { FALLBACK_BRANCH, RETAIL_CUSTOMER_CODE, generateCode } = require('./constants');
const fail = (message, status = 422) => {
    throw Object.assign(new Error(message), { status });
};
const amount = (value, name = 'Số tiền') => {
    if (!Number.isSafeInteger(value) || value < 0) fail(`${name} phải là số nguyên không âm.`);
    return value;
};
const quantity = (value) => {
    amount(value, 'Số lượng');
    if (!value) fail('Số lượng phải lớn hơn 0.');
    return value;
};
const code = (data, prefix) => generateCode(data, prefix);
const timestamp = () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return {
        time: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
        createdAt: d.toISOString()
    };
};
const branchOf = (record) => record.branch || FALLBACK_BRANCH;
function productHasHistory(data, product) {
    const branch = branchOf(product),
        hasCode = (doc) => (doc.items || []).some((item) => item.code === product.code);
    return (
        ['invoices', 'imports', 'returns', 'stocktakes'].some((table) =>
            (data[table] || []).some((doc) => branchOf(doc) === branch && hasCode(doc))
        ) ||
        (data.transfers || []).some(
            (doc) => (doc.fromBranch === branch || doc.toBranch === branch) && hasCode(doc)
        )
    );
}
function branch(data, user, name) {
    if (!allowedBranches(user, data).includes(name) || !data.branches.some((b) => b.name === name))
        fail('Chi nhánh không hợp lệ hoặc chưa được cấp quyền.', 403);
    return name;
}
function product(data, code, br) {
    const p = data.products.find((p) => p.code === code && branchOf(p) === br);
    if (!p) fail(`Không tìm thấy sản phẩm ${code} tại ${br}.`);
    return p;
}
function customerFor(data, inv) {
    if (inv.customerId) return data.customers.find((c) => c.id === inv.customerId);
    if (!inv.phone || inv.phone === 'Tại quầy') return null;
    const matches = data.customers.filter(
        (c) => c.phone === inv.phone && c.code !== RETAIL_CUSTOMER_CODE
    );
    if (matches.length !== 1 && inv.total > inv.paid)
        fail('Cần xác định khách hàng duy nhất cho hóa đơn cũ trước khi xử lý công nợ.');
    return matches.length === 1 ? matches[0] : null;
}
function paymentMethod(method) {
    if (!['cash', 'transfer', 'card'].includes(method))
        fail('Phương thức thanh toán không hợp lệ.');
    return method;
}
const methodLabel = (method) =>
    ({ cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Thẻ', multi: 'Nhiều hình thức' })[
        method
    ] || method;
function recordActivity(
    data,
    { id, type, title, action, val = '', branch = null, time = null, createdAt = null }
) {
    if (!data) return;
    if (!Array.isArray(data.recentActivities)) {
        data.recentActivities = [];
    }
    const ts = timestamp();
    const actId = id || `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    data.recentActivities.unshift({
        id: actId,
        type,
        title: title || 'Hệ thống',
        action: action || '',
        val: val !== '' && val != null ? String(val) : '',
        branch: branch || null,
        time: time || ts.time,
        createdAt: createdAt || ts.createdAt
    });
    if (data.recentActivities.length > 200) {
        data.recentActivities.length = 200;
    }
}

function voucher(
    data,
    {
        type,
        category,
        value,
        person,
        method,
        branch,
        invoiceId,
        customerId,
        supplierId,
        note,
        allocations,
        importId,
        importCode
    }
) {
    if (!value) return;
    amount(value);
    const id = code(data, type === 'thu' ? 'PT' : 'PC');
    data.cashbook.unshift({
        id,
        code: id,
        ...timestamp(),
        type,
        category,
        amount: value,
        person,
        method: methodLabel(method),
        branch,
        invoiceId,
        customerId,
        supplierId,
        importId,
        importCode,
        note: note || '',
        allocations: allocations || []
    });
}
function takeStock(p, qty, selected) {
    amount(p.stock, 'Tồn kho');
    if (p.hasImei && (!Array.isArray(p.imeis) || p.imeis.length !== p.stock))
        fail(`Tồn và IMEI ${p.code} không khớp. Cần đối soát trước khi xuất.`);
    if (p.stock < qty) fail(`Không đủ tồn kho ${p.code} (còn ${p.stock}).`, 409);
    let imeis = [];
    if (p.hasImei) {
        imeis = selected || p.imeis.slice(0, qty);
        if (
            !Array.isArray(imeis) ||
            imeis.length !== qty ||
            new Set(imeis).size !== qty ||
            imeis.some((im) => !p.imeis.includes(im))
        )
            fail(`IMEI của ${p.code} không đủ hoặc không hợp lệ.`);
        p.imeis = p.imeis.filter((im) => !imeis.includes(im));
    }
    p.stock -= qty;
    return imeis;
}
function restoreStock(data, p, qty, imeis = [], receivingTransferId = null) {
    if (p.hasImei) {
        if (
            !Array.isArray(imeis) ||
            imeis.length !== qty ||
            new Set(imeis).size !== qty ||
            !Array.isArray(p.imeis) ||
            p.imeis.length !== p.stock ||
            imeis.some(
                (im) =>
                    data.products.some((pr) => pr.imeis?.includes(im)) ||
                    data.transfers.some(
                        (t) =>
                            t.status === 'shipping' &&
                            t.id !== receivingTransferId &&
                            t.items.some((i) => i.imeis?.includes(im))
                    )
            )
        )
            fail(`Không thể khôi phục IMEI ${p.code}; cần đối soát serial của chứng từ gốc.`);
        p.imeis.push(...imeis);
    }
    p.stock = amount(p.stock + qty, 'Tồn kho');
}
// Integer arithmetic keeps VND allocations exact even when intermediate products are large.
function ratio(value, numerator, denominator, round = false) {
    const divisor = BigInt(quantity(denominator));
    const product = BigInt(amount(value)) * BigInt(amount(numerator));
    return amount(Number((product + (round ? divisor / 2n : 0n)) / divisor));
}
function averageCost(stock, cost, qty, price) {
    const totalQty = quantity(amount(stock) + quantity(qty));
    const value = BigInt(stock) * BigInt(amount(cost)) + BigInt(qty) * BigInt(amount(price));
    return amount(Number((value + BigInt(totalQty) / 2n) / BigInt(totalQty)));
}
function sale(data, user, input) {
    requirePermission(user, 'pos');
    const br = branch(data, user, input.branch);
    if (!Array.isArray(input.items) || !input.items.length) fail('Giỏ hàng trống.');
    const seen = new Set();
    const items = input.items.map((row) => {
        if (seen.has(row.code)) fail('Sản phẩm trùng trong giỏ.');
        seen.add(row.code);
        const p = product(data, row.code, br);
        if (row.expectedPrice !== undefined && row.expectedPrice !== p.price)
            fail('Giá bán đã thay đổi. Hãy cập nhật sản phẩm trong giỏ.', 409);
        if (p.status !== 'active') fail('Sản phẩm đã ngừng kinh doanh.');
        const qty = quantity(row.qty),
            hasCustomPrice = row.salePrice !== undefined && row.salePrice !== p.price,
            price = hasCustomPrice ? amount(row.salePrice) : amount(p.price),
            costPrice = amount(p.costPrice);
        if (hasCustomPrice) requirePermission(user, 'posPrice');
        return {
            code: p.code,
            productId: p.id,
            name: p.name,
            qty,
            price,
            costPrice,
            total: amount(price * qty),
            hasImei: !!p.hasImei,
            imeis: takeStock(p, qty, row.imeis),
            note: typeof row.note === 'string' ? row.note.trim() : ''
        };
    });
    const subtotal = amount(items.reduce((s, i) => s + i.total, 0)),
        discount = amount(input.discount ?? 0);
    if (discount > subtotal) fail('Giảm giá vượt tổng tiền hàng.');
    const total = subtotal - discount;
    let allocated = 0,
        cumulative = 0;
    items.forEach((item, index) => {
        cumulative += item.total;
        const target =
            index === items.length - 1
                ? discount
                : subtotal
                  ? ratio(discount, cumulative, subtotal)
                  : 0;
        item.discount = target - allocated;
        allocated = target;
        item.netTotal = item.total - item.discount;
    });
    const cust = input.customerId ? data.customers.find((c) => c.id === input.customerId) : null;
    if (input.customerId && !cust) fail('Khách hàng không tồn tại.');
    const retail = !cust || cust.code === RETAIL_CUSTOMER_CODE;

    let finalPayments = [];
    let paid = 0;

    if (Array.isArray(input.payments) && input.payments.length > 0) {
        const rawPayments = [];
        for (const p of input.payments) {
            if (!p || typeof p !== 'object') continue;
            const m = paymentMethod(p.method);
            const a = amount(p.amount ?? p.value ?? 0);
            if (a > 0) rawPayments.push({ method: m, amount: a });
        }
        const totalGiven = rawPayments.reduce((s, p) => s + p.amount, 0);
        paid = Math.min(totalGiven, total);

        if (paid > 0) {
            let remainingPaid = paid;
            const nonCash = rawPayments.filter((p) => p.method !== 'cash');
            const cashList = rawPayments.filter((p) => p.method === 'cash');
            const sorted = [...nonCash, ...cashList];

            for (const p of sorted) {
                if (remainingPaid <= 0) break;
                const alloc = Math.min(p.amount, remainingPaid);
                if (alloc > 0) {
                    finalPayments.push({
                        amount: alloc,
                        method: p.method,
                        ...timestamp()
                    });
                    remainingPaid -= alloc;
                }
            }
        } else {
            finalPayments = [
                {
                    amount: 0,
                    method: rawPayments[0]?.method || 'cash',
                    ...timestamp()
                }
            ];
        }
    } else {
        const given = amount(input.given ?? 0);
        paid = Math.min(given, total);
        const method = paymentMethod(input.paymentMethod || 'cash');
        finalPayments = [
            {
                amount: paid,
                method,
                ...timestamp()
            }
        ];
    }

    if (retail && paid < total) fail('Khách lẻ chưa trả đủ tiền. Hãy chọn khách hàng để ghi nợ.');

    const distinctMethods = new Set(finalPayments.filter((p) => p.amount > 0).map((p) => p.method));
    const invoicePaymentMethod =
        distinctMethods.size > 1
            ? 'multi'
            : distinctMethods.size === 1
              ? Array.from(distinctMethods)[0]
              : finalPayments[0]?.method || 'cash';

    const id = code(data, 'HD');
    const invoice = {
        id,
        code: id,
        ...timestamp(),
        bookingVersion: 2,
        payments: finalPayments,
        customerId: retail ? null : cust.id,
        customer: cust?.name || 'Khách lẻ',
        phone: cust?.phone || 'Tại quầy',
        items,
        total,
        discount,
        paid,
        returnedTotal: 0,
        redPaid: paid < total,
        grayBg: false,
        status: 'completed',
        cashier: user.name,
        branch: br,
        paymentMethod: invoicePaymentMethod,
        note: input.note || ''
    };
    data.invoices.unshift(invoice);
    if (!retail) {
        cust.debt = amount(cust.debt + total - paid);
        cust.totalSpent = amount(cust.totalSpent + total);
        cust.points = amount(cust.points + Math.floor(total / 100000));
    }
    if (finalPayments.length > 1) {
        for (const p of finalPayments) {
            if (p.amount > 0) {
                voucher(data, {
                    type: 'thu',
                    category: 'Bán hàng',
                    value: p.amount,
                    person: invoice.customer,
                    method: p.method,
                    branch: br,
                    invoiceId: id,
                    customerId: invoice.customerId,
                    note: `Thu tiền bán hàng (${methodLabel(p.method).toLowerCase()}) hóa đơn ${id}`
                });
            }
        }
    } else {
        voucher(data, {
            type: 'thu',
            category: 'Bán hàng',
            value: paid,
            person: invoice.customer,
            method: finalPayments[0]?.method || 'cash',
            branch: br,
            invoiceId: id,
            customerId: invoice.customerId,
            note: `Thu tiền bán hàng hóa đơn ${id}`
        });
    }
    return invoice;
}
function previousReturns(data, inv) {
    return data.returns.filter((r) => r.invoiceCode === inv.code);
}
function lineNet(inv, item) {
    if (Number.isFinite(item.netTotal)) return item.netTotal;
    const total = inv.items.reduce((s, i) => s + i.qty * i.price, 0);
    return total ? ratio(amount(item.qty * item.price), inv.total, total, true) : 0;
}
function returnGoods(data, user, input, cancel = false) {
    requirePermission(user, 'invoices');
    const inv = data.invoices.find((i) => i.id === input.invoiceId || i.code === input.invoiceId);
    if (!inv) fail('Không tìm thấy hóa đơn.');
    branch(data, user, branchOf(inv));
    if (inv.status === 'cancelled') fail('Hóa đơn đã hủy.', 409);
    if (!inv.items.length) fail('Hóa đơn cũ thiếu chi tiết; cần đối soát trước khi hủy/trả.');
    const previous = previousReturns(data, inv),
        totals = new Map();
    if (previous.some((r) => r.returnValue == null))
        fail(
            'Hóa đơn có phiếu trả từ phiên bản cũ chưa đối soát tiền/nợ. Cần kiểm tra trước khi hoàn tiếp.'
        );
    for (const ret of previous)
        for (const it of ret.items) totals.set(it.code, (totals.get(it.code) || 0) + it.qty);
    const requested = cancel
        ? inv.items
              .map((i) => ({ code: i.code, qty: i.qty - (totals.get(i.code) || 0) }))
              .filter((i) => i.qty > 0)
        : input.items;
    if (!Array.isArray(requested) || (!requested.length && !cancel))
        fail('Chọn ít nhất một sản phẩm trả.');
    const seen = new Set();
    let value = 0;
    const items = requested.map((row) => {
        const item = inv.items.find((i) => i.code === row.code);
        if (!item || seen.has(row.code)) fail('Dòng trả hàng không hợp lệ.');
        seen.add(row.code);
        const qty = quantity(row.qty),
            returned = totals.get(row.code) || 0;
        if (qty > item.qty - returned) fail(`Số lượng trả ${row.code} vượt số lượng còn lại.`, 409);
        const p = product(data, item.code, branchOf(inv));
        let imeis = [];
        if (p.hasImei || item.hasImei || item.imeis?.length) {
            const sold = item.imeis;
            const priorLines = previous.flatMap((r) => r.items.filter((i) => i.code === row.code));
            const priorSerials = priorLines.flatMap((i) => i.imeis || []);
            if (
                !p.hasImei ||
                !Array.isArray(sold) ||
                sold.length !== item.qty ||
                new Set(sold).size !== sold.length ||
                priorLines.some((i) => !Array.isArray(i.imeis) || i.imeis.length !== i.qty) ||
                new Set(priorSerials).size !== priorSerials.length ||
                priorSerials.some((serial) => !sold.includes(serial))
            )
                fail('Chứng từ thiếu hoặc sai lịch sử IMEI; cần đối soát trước khi trả.');
            const available = sold.filter((serial) => !priorSerials.includes(serial));
            // Full cancellation has no ambiguous choice; partial returns must identify devices.
            imeis = cancel ? available : row.imeis;
            if (
                !Array.isArray(imeis) ||
                imeis.length !== qty ||
                new Set(imeis).size !== qty ||
                imeis.some((serial) => !available.includes(serial))
            )
                fail('Chọn đúng IMEI chưa trả của hóa đơn, khớp với số lượng trả.');
        }
        if (!Number.isSafeInteger(item.costPrice) || item.costPrice < 0)
            fail('Thiếu giá vốn lịch sử; cần đối soát trước khi hoàn kho.');
        const restoredCost = averageCost(p.stock, p.costPrice, qty, item.costPrice);
        restoreStock(data, p, qty, imeis);
        p.costPrice = restoredCost;
        const net = lineNet(inv, item),
            refund =
                ratio(net, returned + qty, item.qty, true) - ratio(net, returned, item.qty, true);
        value += refund;
        return {
            ...item,
            qty,
            imeis,
            total: refund,
            netTotal: refund,
            costPrice: item.costPrice ?? null
        };
    });
    const already = previous.reduce((s, r) => s + (r.returnValue ?? r.totalRefund), 0);
    // Last return receives rounding remainder for legacy discounted invoices.
    const fullyReturned = inv.items.every(
        (i) =>
            (totals.get(i.code) || 0) + (requested.find((r) => r.code === i.code)?.qty || 0) ===
            i.qty
    );
    if (fullyReturned && items.length) {
        const remaining = Math.max(0, inv.total - already);
        items.at(-1).total += remaining - value;
        items.at(-1).netTotal = items.at(-1).total;
        value = remaining;
    }
    const cust = customerFor(data, inv);
    const debtReduction = Math.min(value, Math.max(0, inv.total - already - inv.paid));
    const refund = value - debtReduction;
    if (debtReduction && !cust) fail('Không xác định được khách hàng để giảm công nợ.');
    if (cust) {
        cust.debt = Math.max(0, cust.debt - debtReduction);
        cust.totalSpent = Math.max(0, cust.totalSpent - value);
        cust.points = Math.max(
            0,
            cust.points -
                (Math.floor((inv.total - already) / 100000) -
                    Math.floor((inv.total - already - value) / 100000))
        );
    }
    const fallbackMethod = ['cash', 'transfer', 'card'].includes(inv.paymentMethod)
        ? inv.paymentMethod
        : 'cash';
    if (Array.isArray(inv.payments) && refund)
        inv.payments.push({
            amount: -refund,
            method: input.refundMethod || fallbackMethod,
            ...timestamp()
        });
    inv.paid = Math.max(0, inv.paid - refund);
    inv.returnedTotal = already + value;
    inv.hasReturned = !!(previous.length || items.length);
    inv.redPaid = inv.total - inv.returnedTotal > inv.paid;
    const method = paymentMethod(input.refundMethod || fallbackMethod),
        id = code(data, 'TH');
    const slip = {
        id,
        code: id,
        invoiceCode: inv.code,
        invoiceId: inv.id,
        ...timestamp(),
        customer: inv.customer,
        customerId: cust?.id || null,
        phone: inv.phone,
        items,
        totalRefund: refund,
        returnValue: value,
        debtReduction,
        refundMethod: methodLabel(method),
        reason: input.reason || '',
        cashier: user.name,
        branch: branchOf(inv),
        isCancellation: cancel
    };
    if (items.length) data.returns.unshift(slip);
    voucher(data, {
        type: 'chi',
        category: cancel ? 'Hủy hóa đơn' : 'Trả hàng bán',
        value: refund,
        person: inv.customer,
        method,
        branch: branchOf(inv),
        invoiceId: inv.id,
        customerId: cust?.id,
        note: `Hoàn tiền ${id} (${inv.code})`
    });
    if (cancel) {
        inv.status = 'cancelled';
        inv.cancelReason = input.reason || '';
        const cancelled = timestamp();
        inv.cancelTime = cancelled.time;
        inv.cancelledAt = cancelled.createdAt;
    }
    return slip;
}
function importGoods(data, user, input) {
    requirePermission(user, 'imports');
    const br = branch(data, user, input.branch),
        supplier = data.suppliers.find((s) => s.code === input.supplierCode);
    if (!supplier) fail('Chọn nhà cung cấp hợp lệ.');
    if (!Array.isArray(input.items) || !input.items.length) fail('Phiếu nhập trống.');
    const allImeis = new Set([
            ...data.products.flatMap((p) => p.imeis || []),
            ...data.transfers
                .filter((t) => t.status === 'shipping')
                .flatMap((t) => t.items.flatMap((i) => i.imeis || []))
        ]),
        seen = new Set();
    const items = input.items.map((row) => {
        require('./media-validation').validateMedia(row);
        if (seen.has(row.code)) fail('Dòng sản phẩm trùng.');
        seen.add(row.code);
        const p = product(data, row.code, br),
            qty = quantity(row.qty),
            price = amount(row.price),
            imeis = row.imeis || [],
            stockBefore = amount(p.stock, 'Tồn kho'),
            costPriceBefore = amount(p.costPrice, 'Giá vốn');
        const importedSerials = new Set(p.hasImei || row.hasImei ? imeis : []);
        if (Object.keys(row.imeiDetails || {}).some((serial) => !importedSerials.has(serial)))
            fail('Chi tiết IMEI chỉ được chứa các máy thuộc dòng nhập hàng.');
        if (!p.hasImei && row.hasImei && p.stock > 0)
            fail('Cần đối soát hàng đang tồn hoặc lịch sử giao dịch trước khi bật quản lý IMEI.');
        if (!p.hasImei && row.hasImei && productHasHistory(data, p))
            fail('Cần đối soát hàng đang tồn hoặc lịch sử giao dịch trước khi bật quản lý IMEI.');
        if (p.hasImei || row.hasImei) {
            if (
                !Array.isArray(imeis) ||
                imeis.length !== qty ||
                new Set(imeis).size !== qty ||
                imeis.some((im) => typeof im !== 'string' || !im || allImeis.has(im))
            )
                fail(`IMEI ${p.code} thiếu hoặc trùng.`);
            imeis.forEach((im) => allImeis.add(im));
            p.hasImei = true;
            p.imeis = (p.imeis || []).concat(imeis);
            if (row.imeiDetails && typeof row.imeiDetails === 'object') {
                p.imeiDetails = { ...(p.imeiDetails || {}), ...row.imeiDetails };
            }
            if (!p.images || !p.images.length) {
                const firstWithImg = imeis.find((im) => p.imeiDetails?.[im]?.images?.length);
                if (firstWithImg) {
                    p.images = p.imeiDetails[firstWithImg].images;
                    if (p.imeiDetails[firstWithImg].condition)
                        p.condition = p.imeiDetails[firstWithImg].condition;
                    if (p.imeiDetails[firstWithImg].conditionDetail)
                        p.conditionDetail = p.imeiDetails[firstWithImg].conditionDetail;
                }
            }
        } else {
            if (Array.isArray(row.images) && row.images.length) {
                p.images = row.images;
            }
            if (row.videoUrl) p.videoUrl = row.videoUrl;
            if (row.condition) p.condition = row.condition;
            if (row.conditionDetail) p.conditionDetail = row.conditionDetail;
        }
        p.costPrice = averageCost(p.stock, p.costPrice, qty, price);
        p.stock = amount(p.stock + qty, 'Tồn kho');
        return {
            code: p.code,
            name: p.name,
            qty,
            price,
            total: amount(qty * price),
            hasImei: p.hasImei,
            imeis,
            imeiDetails: row.imeiDetails || {},
            images: Array.isArray(row.images) ? row.images : [],
            videoUrl: row.videoUrl || '',
            condition: row.condition || 'new',
            conditionDetail: row.conditionDetail || '',
            stockBefore,
            stockAfter: p.stock,
            costPriceBefore,
            costPriceAfter: p.costPrice
        };
    });
    const total = amount(items.reduce((s, i) => s + i.total, 0)),
        paid = amount(input.paid);
    if (paid > total) fail('Tiền trả vượt tổng nhập.');
    const id = code(data, 'PN'),
        method = paymentMethod(
            input.paymentMethod === 'bank'
                ? 'transfer'
                : input.paymentMethod === 'debt'
                  ? 'cash'
                  : input.paymentMethod
        );
    const record = {
        id,
        code: id,
        ...timestamp(),
        nccCode: supplier.code,
        nccName: supplier.name,
        supplierId: supplier.id,
        items,
        needPay: total,
        paid,
        paymentMethod: method,
        note: input.note || '',
        status: 'imported',
        creator: user.name,
        branch: br
    };
    supplier.debt = amount(supplier.debt + total - paid);
    supplier.totalBought = amount(supplier.totalBought + total);
    data.imports.unshift(record);
    voucher(data, {
        type: 'chi',
        category: 'Nhập hàng',
        value: paid,
        person: supplier.name,
        method,
        branch: br,
        supplierId: supplier.id,
        note: `Nhập hàng ${id}`
    });
    return record;
}
function cancelImport(data, user, input) {
    requirePermission(user, 'imports');
    const imp = data.imports.find((i) => i.id === input.importId || i.code === input.importId);
    if (!imp) fail('Không tìm thấy phiếu nhập.');
    if (imp.status === 'cancelled') fail('Phiếu nhập đã hủy.', 409);
    if ((data.cashbook || []).some((c) => c.importId === imp.id))
        fail('Phiếu nhập đã có chứng từ hoàn tiền; cần đối soát thủ công.', 409);
    const br = branchOf(imp);
    branch(data, user, br);
    const importedCodes = new Set((imp.items || []).map((row) => row.code));
    const touchesImport = (doc) =>
        doc !== imp &&
        typeof doc.createdAt === 'string' &&
        doc.createdAt > imp.createdAt &&
        (doc.items || []).some((row) => importedCodes.has(row.code));
    if (
        ['invoices', 'imports', 'returns', 'stocktakes'].some((table) =>
            (data[table] || []).some((doc) => branchOf(doc) === br && touchesImport(doc))
        ) ||
        (data.transfers || []).some(
            (doc) => (doc.fromBranch === br || doc.toBranch === br) && touchesImport(doc)
        )
    )
        fail('Đã có chứng từ phát sinh sau phiếu nhập; cần đối soát thủ công.', 409);

    // Verify stock and IMEIs before deducting
    (imp.items || []).forEach((row) => {
        const p = product(data, row.code, br);
        if (
            !Number.isSafeInteger(row.stockBefore) ||
            !Number.isSafeInteger(row.stockAfter) ||
            !Number.isSafeInteger(row.costPriceBefore) ||
            !Number.isSafeInteger(row.costPriceAfter)
        )
            fail('Phiếu nhập cũ thiếu dữ liệu giá vốn; cần đối soát thủ công.', 409);
        if (p.stock !== row.stockAfter || p.costPrice !== row.costPriceAfter)
            fail('Tồn kho hoặc giá vốn đã thay đổi sau khi nhập; cần đối soát thủ công.', 409);
        if (p.stock < row.qty) {
            fail(
                `Tồn kho "${p.name}" (${p.code}) không đủ để hủy phiếu nhập (hiện còn ${p.stock}, cần trừ ${row.qty}).`,
                409
            );
        }
        if (row.hasImei && Array.isArray(row.imeis) && row.imeis.length) {
            const currentImeis = new Set(p.imeis || []);
            const missing = row.imeis.filter((im) => !currentImeis.has(im));
            if (missing.length > 0) {
                fail(
                    `Một số IMEI của phiếu nhập đã xuất hoặc bán: ${missing.slice(0, 3).join(', ')}...`,
                    409
                );
            }
        }
    });

    // 2. Deduct stock and remove IMEIs
    (imp.items || []).forEach((row) => {
        const p = product(data, row.code, br);
        p.stock = amount(row.stockBefore, 'Tồn kho');
        p.costPrice = amount(row.costPriceBefore, 'Giá vốn');
        if (row.hasImei && Array.isArray(row.imeis) && row.imeis.length) {
            const toRemove = new Set(row.imeis);
            p.imeis = (p.imeis || []).filter((im) => !toRemove.has(im));
            if (p.imeiDetails && typeof p.imeiDetails === 'object') {
                toRemove.forEach((im) => delete p.imeiDetails[im]);
            }
        }
    });

    // 3. Reconcile supplier debt and totalBought
    const supplier = data.suppliers.find((s) => s.id === imp.supplierId || s.code === imp.nccCode);
    const total = amount(imp.needPay || 0);
    const paid = amount(imp.paid || 0);
    const unpaid = amount(total - paid);
    if (supplier) {
        if (supplier.debt < unpaid || supplier.totalBought < total)
            fail('Công nợ hoặc tổng nhập nhà cung cấp đã thay đổi; cần đối soát thủ công.', 409);
        supplier.debt = amount(supplier.debt - unpaid);
        supplier.totalBought = amount(supplier.totalBought - total);
    }

    // 4. Reverse cashbook payment if paid > 0 (creates a receipt voucher 'thu')
    if (paid > 0) {
        const rawMethod = input.refundMethod || imp.paymentMethod;
        const normalizedMethod =
            rawMethod === 'Tiền mặt'
                ? 'cash'
                : rawMethod === 'Chuyển khoản' || rawMethod === 'bank'
                  ? 'transfer'
                  : rawMethod === 'Thẻ'
                    ? 'card'
                    : rawMethod;
        const method = paymentMethod(normalizedMethod);
        voucher(data, {
            type: 'thu',
            category: 'Hủy phiếu nhập',
            value: paid,
            person: supplier ? supplier.name : imp.nccName || 'Nhà cung cấp',
            method,
            branch: br,
            supplierId: supplier ? supplier.id : null,
            importId: imp.id,
            importCode: imp.code,
            note: `Hoàn tiền hủy phiếu nhập ${imp.code}`
        });
    }

    // 5. Update import status
    imp.status = 'cancelled';
    imp.cancelReason = input.reason || '';
    const cancelled = timestamp();
    imp.cancelTime = cancelled.time;
    imp.cancelledAt = cancelled.createdAt;
    return imp;
}
function payDebt(data, user, input) {
    if (!['thu', 'chi'].includes(input.type)) fail('Loại thanh toán không hợp lệ.');
    const supplier = input.type === 'chi';
    requirePermission(user, supplier ? 'cashbook' : 'customers');
    const br = branch(data, user, input.branch),
        partner = (supplier ? data.suppliers : data.customers).find(
            (x) => x.id === input.partnerId || x.code === input.partnerId
        );
    if (!partner) fail('Không tìm thấy đối tác.');
    const value = quantity(input.amount);
    if (value > partner.debt) fail('Số tiền vượt công nợ hiện tại.');
    const method = paymentMethod(input.method || 'cash');
    let rest = value;
    const allocations = [];
    const documents = (supplier ? data.imports : data.invoices).filter(
        (i) =>
            i.status !== 'cancelled' &&
            (supplier
                ? i.supplierId === partner.id || i.nccCode === partner.code
                : i.customerId === partner.id ||
                  (!i.customerId &&
                      i.phone === partner.phone &&
                      data.customers.filter((c) => c.phone === partner.phone).length === 1))
    );
    const outstanding = (doc) =>
        Math.max(0, (supplier ? doc.needPay : doc.total - (doc.returnedTotal || 0)) - doc.paid);
    const openingDebt = Math.max(
        0,
        partner.debt - documents.reduce((sum, d) => sum + outstanding(d), 0)
    );
    const allowed = allowedBranches(user, data);
    for (const doc of documents
        .filter((d) => allowed.includes(branchOf(d)))
        .slice()
        .reverse()) {
        const debt = Math.max(
                0,
                (supplier ? doc.needPay : doc.total - (doc.returnedTotal || 0)) - doc.paid
            ),
            allocated = Math.min(rest, debt);
        if (!allocated) continue;
        doc.paid += allocated;
        doc.redPaid = allocated < debt;
        if (Array.isArray(doc.payments))
            doc.payments.push({ amount: allocated, method, ...timestamp() });
        rest -= allocated;
        allocations.push({ documentId: doc.id, amount: allocated });
    }
    if (rest > openingDebt)
        fail('Khoản thanh toán liên quan chứng từ ngoài chi nhánh được cấp quyền.', 403);
    // Unallocated portion settles explicitly stored opening debt of legacy partners.
    partner.debt -= value;
    voucher(data, {
        type: supplier ? 'chi' : 'thu',
        category: supplier ? 'Chi trả nợ NCC' : 'Thu nợ khách hàng',
        value,
        person: partner.name,
        method,
        branch: br,
        customerId: supplier ? null : partner.id,
        supplierId: supplier ? partner.id : null,
        allocations,
        note: input.note || 'Thanh toán công nợ'
    });
    return { amount: value, allocations, openingDebtPaid: rest };
}
function cashEntry(data, user, input) {
    requirePermission(user, 'cashbook');
    const br = branch(data, user, input.branch);
    if (!['thu', 'chi'].includes(input.type)) fail('Loại phiếu không hợp lệ.');
    if (!input.person?.trim()) fail('Nhập người nộp/nhận.');
    voucher(data, {
        type: input.type,
        category: input.category,
        person: input.person,
        note: input.note,
        value: quantity(input.amount),
        method: paymentMethod(input.method),
        branch: br
    });
    return data.cashbook[0];
}
function transfer(data, user, input) {
    requirePermission(user, 'transfers');
    const from = branch(data, user, input.fromBranch),
        to = input.toBranch;
    if (from === to || !data.branches.some((b) => b.name === to))
        fail('Chi nhánh nhận không hợp lệ.');
    if (!Array.isArray(input.items) || !input.items.length) fail('Phiếu chuyển trống.');
    const seen = new Set();
    const items = input.items.map((row) => {
        if (seen.has(row.code)) fail('Dòng chuyển trùng.');
        seen.add(row.code);
        const p = product(data, row.code, from),
            qty = quantity(row.qty);
        const imeis = takeStock(p, qty, row.imeis);
        return {
            code: p.code,
            name: p.name,
            unit: p.unit,
            qty,
            price: p.costPrice,
            total: amount(p.costPrice * qty),
            hasImei: p.hasImei,
            imeis,
            imeiDetails: structuredClone(
                Object.fromEntries(
                    imeis
                        .filter((im) => Object.hasOwn(p.imeiDetails || {}, im))
                        .map((im) => [im, p.imeiDetails[im]])
                )
            ),
            productSnapshot: {
                category: p.category,
                price: p.price,
                barcode: p.barcode,
                minStock: p.minStock,
                status: p.status,
                images: Array.isArray(p.images) ? [...p.images] : [],
                videoUrl: p.videoUrl || '',
                condition: p.condition || 'new',
                conditionDetail: p.conditionDetail || '',
                description: p.description || ''
            }
        };
    });
    const id = code(data, 'PCH'),
        record = {
            id,
            code: id,
            ...timestamp(),
            fromBranch: from,
            toBranch: to,
            cashier: user.name,
            status: 'shipping',
            totalQty: amount(items.reduce((s, i) => s + i.qty, 0)),
            totalValue: amount(items.reduce((s, i) => s + i.total, 0)),
            note: input.note || '',
            items
        };
    data.transfers.unshift(record);
    return record;
}
function receive(data, user, input) {
    requirePermission(user, 'transfers');
    const record = data.transfers.find((r) => r.id === input.id);
    if (!record || record.status !== 'shipping') fail('Phiếu không ở trạng thái đang chuyển.', 409);
    branch(data, user, record.toBranch);
    for (const item of record.items) {
        let p = data.products.find((p) => p.code === item.code && branchOf(p) === record.toBranch);
        if (!p) {
            const source = data.products.find(
                (p) => p.code === item.code && branchOf(p) === record.fromBranch
            );
            p = {
                ...item.productSnapshot,
                id: code(data, 'SP'),
                code: item.code,
                name: item.name,
                unit: item.unit,
                costPrice: item.price,
                stock: 0,
                price: item.productSnapshot?.price ?? source?.price ?? item.price,
                category: item.productSnapshot?.category ?? source?.category ?? '',
                images:
                    item.productSnapshot?.images ??
                    (Array.isArray(source?.images) ? [...source.images] : []),
                videoUrl: item.productSnapshot?.videoUrl ?? source?.videoUrl ?? '',
                condition: item.productSnapshot?.condition ?? source?.condition ?? 'new',
                conditionDetail:
                    item.productSnapshot?.conditionDetail ?? source?.conditionDetail ?? '',
                description: item.productSnapshot?.description ?? source?.description ?? '',
                branch: record.toBranch,
                hasImei: !!item.hasImei,
                imeis: [],
                // Transfers created before status was snapshotted fall back to the source product.
                status: item.productSnapshot?.status ?? source?.status ?? 'active'
            };
            data.products.push(p);
        }
        if (!!p.hasImei !== !!item.hasImei) fail('Kiểu quản lý serial không khớp giữa hai kho.');
        p.costPrice = averageCost(p.stock, p.costPrice, item.qty, item.price);
        restoreStock(data, p, item.qty, item.imeis || [], record.id);
        const source = data.products.find(
            (row) => row.code === item.code && branchOf(row) === record.fromBranch
        );
        const details = item.imeiDetails ?? source?.imeiDetails ?? {};
        p.imeiDetails = {
            ...(p.imeiDetails || {}),
            ...structuredClone(
                Object.fromEntries(
                    (item.imeis || [])
                        .filter((im) => Object.hasOwn(details, im))
                        .map((im) => [im, details[im]])
                )
            )
        };
    }
    record.status = 'completed';
    const received = timestamp();
    record.receivedTime = received.time;
    record.receivedAt = received.createdAt;
    record.receiver = user.name;
    return record;
}
function stocktake(data, user, input) {
    requirePermission(user, 'stocktakes');
    let record;
    if (input.id) {
        record = data.stocktakes.find((r) => r.id === input.id);
        if (!record || record.status !== 'draft') fail('Phiếu kiểm không còn là bản nháp.', 409);
        branch(data, user, branchOf(record));
    } else {
        const br = branch(data, user, input.branch);
        if (!Array.isArray(input.items) || !input.items.length) fail('Phiếu kiểm trống.');
        const id = code(data, 'PKK');
        record = {
            id,
            code: id,
            ...timestamp(),
            cashier: user.name,
            branch: br,
            status: 'draft',
            note: input.note || '',
            items: input.items.map((row) => {
                const p = product(data, row.code, br);
                if (row.systemStock !== p.stock)
                    fail('Tồn kho đã thay đổi. Hãy kiểm đếm lại.', 409);
                return {
                    code: p.code,
                    name: p.name,
                    unit: p.unit,
                    systemStock: p.stock,
                    actualStock: amount(row.actualStock, 'Tồn thực tế'),
                    variance: row.actualStock - p.stock,
                    reason: row.reason || '',
                    imeis: row.imeis
                };
            })
        };
        if (new Set(record.items.map((i) => i.code)).size !== record.items.length)
            fail('Dòng kiểm trùng.');
        data.stocktakes.unshift(record);
    }
    if (input.balance) {
        for (const item of record.items) {
            const p = product(data, item.code, branchOf(record));
            if (p.stock !== item.systemStock)
                fail('Có phát sinh sau khi kiểm đếm; cần lập lại phiếu kiểm.', 409);
            if (p.hasImei && item.actualStock !== p.stock)
                fail(
                    'Hàng quản lý serial cần đối soát IMEI bằng nghiệp vụ nhập/trả/chuyển trước khi cân bằng.'
                );
            p.stock = item.actualStock;
        }
        record.status = 'balanced';
    }
    record.totalActual = record.items.reduce((s, i) => s + i.actualStock, 0);
    record.totalVariance = record.items.reduce((s, i) => s + i.variance, 0);
    return record;
}

// ============================================================
// Shared Warehouse (Kho Chung) Operations
// ============================================================

function syncSharedAvailability(data) {
    if (!Array.isArray(data.shared_products) || !data.shared_products.length) return;
    const productsById = new Map((data.products || []).map((p) => [p.id, p]));
    for (const sp of data.shared_products) {
        if (sp.status !== 'active') continue;
        const p = productsById.get(sp.sourceProductId);
        if (!p) {
            sp.availability = 'out_of_stock';
            sp.imeis = [];
            sp.imeiDetails = {};
            continue;
        }
        const minStock = Number(p.minStock) || 0;
        const stock = p.status === 'active' ? Number(p.stock) || 0 : 0;
        sp.availability = stock > minStock ? 'in_stock' : stock > 0 ? 'low_stock' : 'out_of_stock';
        sp.name = p.name;
        sp.price = Number(p.price) || 0;
        sp.category = p.category || '';
        sp.unit = p.unit || '';
        sp.barcode = p.barcode || '';
        sp.images = Array.isArray(p.images) ? p.images : [];
        sp.videoUrl = p.videoUrl || '';
        sp.condition = p.condition || 'new';
        sp.conditionDetail = p.conditionDetail || '';
        sp.description = p.description || '';
        sp.imeis = stock > 0 && p.hasImei ? [...(p.imeis || [])] : [];
        sp.imeiDetails = Object.fromEntries(
            sp.imeis
                .filter((serial) => Object.hasOwn(p.imeiDetails || {}, serial))
                .map((serial) => [serial, p.imeiDetails[serial]])
        );
        sp.lastSyncAt = new Date().toISOString();
    }
}

function shareProduct(data, user, input) {
    requirePermission(user, 'products');
    if (!input.productId || typeof input.productId !== 'string')
        fail('Chưa chọn sản phẩm cần chia sẻ.');
    const p = (data.products || []).find((pr) => pr.id === input.productId);
    if (!p) fail('Không tìm thấy sản phẩm.');
    if (p.status !== 'active') fail('Chỉ chia sẻ sản phẩm đang kinh doanh.');
    const br = branchOf(p);
    if (!allowedBranches(user, data).includes(br))
        fail('Không có quyền chia sẻ sản phẩm ở chi nhánh khác.', 403);

    if (!Array.isArray(data.shared_products)) data.shared_products = [];
    const existing = data.shared_products.find(
        (sp) => sp.sourceProductId === p.id && sp.status === 'active'
    );
    if (existing) {
        if (existing.ownerUserId !== user.id && user.role !== 'admin')
            fail('Chỉ chủ sở hữu hoặc quản trị viên mới có thể cập nhật sản phẩm.', 403);
        if (input.wholesalePrice !== undefined)
            existing.wholesalePrice = Math.max(0, Number(input.wholesalePrice) || 0);
        if (input.minOrderQty !== undefined)
            existing.minOrderQty = Math.max(1, Number(input.minOrderQty) || 1);
        if (input.note !== undefined) existing.note = String(input.note).slice(0, 500);
        existing.images = Array.isArray(p.images) ? p.images : [];
        existing.videoUrl = p.videoUrl || '';
        existing.condition = p.condition || 'new';
        existing.conditionDetail = p.conditionDetail || '';
        existing.description = p.description || '';
        existing.imeiDetails =
            p.imeiDetails && typeof p.imeiDetails === 'object' ? p.imeiDetails : {};
        existing.lastSyncAt = new Date().toISOString();
        return existing;
    }

    const ts = timestamp();
    const minStock = Number(p.minStock) || 0;
    const stock = Number(p.stock) || 0;
    const availability = stock > minStock ? 'in_stock' : stock > 0 ? 'low_stock' : 'out_of_stock';
    const id = code(data, 'SKC');
    const branchInfo = (data.branches || []).find((b) => b.name === br);
    const ownerPhone = branchInfo?.phone || user.phone || '';

    const shared = {
        id,
        sourceProductId: p.id,
        ownerUserId: user.id,
        ownerBranch: br,
        ownerName: user.name || user.username || 'Đối tác',
        ownerPhone,
        code: p.code,
        name: p.name,
        category: p.category || '',
        price: Number(p.price) || 0,
        unit: p.unit || '',
        barcode: p.barcode || '',
        availability,
        minOrderQty: Math.max(1, Number(input.minOrderQty) || 1),
        wholesalePrice:
            input.wholesalePrice !== undefined
                ? Math.max(0, Number(input.wholesalePrice) || 0)
                : Number(p.price) || 0,
        note: input.note ? String(input.note).slice(0, 500) : '',
        images: Array.isArray(p.images) ? p.images : [],
        videoUrl: p.videoUrl || '',
        condition: p.condition || 'new',
        conditionDetail: p.conditionDetail || '',
        description: p.description || '',
        imeiDetails: p.imeiDetails && typeof p.imeiDetails === 'object' ? p.imeiDetails : {},
        sharedAt: ts.createdAt,
        lastSyncAt: ts.createdAt,
        status: 'active'
    };
    data.shared_products.unshift(shared);
    return shared;
}

function unshareProduct(data, user, input) {
    requirePermission(user, 'products');
    if (!input.sharedProductId || typeof input.sharedProductId !== 'string')
        fail('Chưa chọn sản phẩm cần gỡ.');
    if (!Array.isArray(data.shared_products)) data.shared_products = [];
    const sp = data.shared_products.find((s) => s.id === input.sharedProductId);
    if (!sp) fail('Không tìm thấy sản phẩm kho chung.');
    if (sp.ownerUserId !== user.id && user.role !== 'admin')
        fail('Chỉ chủ sở hữu hoặc quản trị viên mới có thể gỡ sản phẩm.', 403);
    sp.status = 'removed';
    return { removed: true, id: sp.id };
}

function updateSharedProduct(data, user, input) {
    requirePermission(user, 'products');
    if (!input.sharedProductId || typeof input.sharedProductId !== 'string')
        fail('Chưa chọn sản phẩm cần cập nhật.');
    if (!Array.isArray(data.shared_products)) data.shared_products = [];
    const sp = data.shared_products.find((s) => s.id === input.sharedProductId);
    if (!sp) fail('Không tìm thấy sản phẩm kho chung.');
    if (sp.ownerUserId !== user.id && user.role !== 'admin')
        fail('Chỉ chủ sở hữu hoặc quản trị viên mới có thể cập nhật sản phẩm.', 403);
    if (input.wholesalePrice !== undefined)
        sp.wholesalePrice = Math.max(0, Number(input.wholesalePrice) || 0);
    if (input.minOrderQty !== undefined)
        sp.minOrderQty = Math.max(1, Number(input.minOrderQty) || 1);
    if (input.note !== undefined) sp.note = String(input.note).slice(0, 500);
    sp.lastSyncAt = new Date().toISOString();
    return sp;
}

function execute(data, user, type, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        fail('Nội dung thao tác không hợp lệ.');
    for (const key of ['note', 'reason', 'category', 'person'])
        if (
            input[key] !== undefined &&
            (typeof input[key] !== 'string' || input[key].length > 5000)
        )
            fail(`Trường ${key} không hợp lệ.`);
    if (input.items !== undefined) {
        if (!Array.isArray(input.items) || input.items.length > 1000)
            fail('Danh sách hàng không hợp lệ.');
        for (const row of input.items) {
            if (
                !row ||
                typeof row !== 'object' ||
                typeof row.code !== 'string' ||
                row.code.length > 160
            )
                fail('Dòng hàng không hợp lệ.');
            if (
                row.imeis !== undefined &&
                (!Array.isArray(row.imeis) ||
                    row.imeis.some((i) => typeof i !== 'string' || !i || i.length > 200))
            )
                fail('Danh sách IMEI không hợp lệ.');
        }
    }
    switch (type) {
        case 'sale': {
            const inv = sale(data, user, input);
            recordActivity(data, {
                type: 'sale',
                title: user.name || inv.cashier || 'Thu ngân',
                action: `Vừa bán đơn hàng ${inv.code}${inv.customer && inv.customer !== 'Khách lẻ' ? ` cho ${inv.customer}` : ''}`,
                val: inv.total,
                branch: inv.branch,
                time: inv.time,
                createdAt: inv.createdAt
            });
            return inv;
        }
        case 'return': {
            const ret = returnGoods(data, user, input);
            recordActivity(data, {
                type: 'return',
                title: user.name || ret.cashier || 'Thu ngân',
                action: `Trả hàng đơn ${ret.invoiceCode || ''} (${ret.code})`,
                val: ret.totalRefund ? -ret.totalRefund : 0,
                branch: ret.branch,
                time: ret.time,
                createdAt: ret.createdAt
            });
            return ret;
        }
        case 'cancel': {
            const can = returnGoods(data, user, input, true);
            recordActivity(data, {
                type: 'cancel',
                title: user.name || can.cashier || 'Thu ngân',
                action: `Hủy đơn hàng ${can.invoiceCode || can.code}${can.reason ? `: ${can.reason}` : ''}`,
                val: can.totalRefund ? -can.totalRefund : 0,
                branch: can.branch,
                time: can.time,
                createdAt: can.createdAt
            });
            return can;
        }
        case 'import': {
            const imp = importGoods(data, user, input);
            recordActivity(data, {
                type: 'import',
                title: user.name || imp.creator || 'Quản lý kho',
                action: `Nhập hàng ${imp.code}${imp.nccName ? ` từ ${imp.nccName}` : ''}`,
                val: imp.needPay,
                branch: imp.branch,
                time: imp.time,
                createdAt: imp.createdAt
            });
            return imp;
        }
        case 'cancel_import': {
            const cImp = cancelImport(data, user, input);
            recordActivity(data, {
                type: 'cancel_import',
                title: user.name || 'Quản lý kho',
                action: `Hủy phiếu nhập ${cImp.code}${cImp.cancelReason ? `: ${cImp.cancelReason}` : ''}`,
                val: cImp.needPay ? -cImp.needPay : 0,
                branch: cImp.branch,
                time: cImp.cancelTime || cImp.time,
                createdAt: cImp.cancelledAt || cImp.createdAt
            });
            return cImp;
        }
        case 'debt': {
            const res = payDebt(data, user, input);
            const isCust = input.type === 'thu';
            const partner = (isCust ? data.customers : data.suppliers).find(
                (x) => x.id === input.partnerId || x.code === input.partnerId
            );
            const pName = partner ? partner.name : isCust ? 'Khách hàng' : 'Nhà cung cấp';
            recordActivity(data, {
                type: 'debt',
                title: user.name || 'Thu ngân',
                action: isCust ? `Thu nợ ${pName}` : `Chi trả nợ ${pName}`,
                val: isCust ? res.amount : -res.amount,
                branch: input.branch || branchOf(user),
                time: timestamp().time,
                createdAt: timestamp().createdAt
            });
            return res;
        }
        case 'cash': {
            const entry = cashEntry(data, user, input);
            const isThu = entry.type === 'thu';
            recordActivity(data, {
                type: isThu ? 'cash_in' : 'cash_out',
                title: user.name || 'Thủ quỹ',
                action: `Lập phiếu ${isThu ? 'thu' : 'chi'} (${entry.code}): ${entry.category || entry.note || ''}`,
                val: isThu ? entry.amount : -entry.amount,
                branch: entry.branch,
                time: entry.time,
                createdAt: entry.createdAt
            });
            return entry;
        }
        case 'transfer': {
            const tf = transfer(data, user, input);
            recordActivity(data, {
                type: 'transfer',
                title: user.name || tf.cashier || 'Quản lý kho',
                action: `Chuyển hàng ${tf.code} từ ${tf.fromBranch} sang ${tf.toBranch} (${tf.totalQty} món)`,
                val: tf.totalValue,
                branch: tf.fromBranch,
                time: tf.time,
                createdAt: tf.createdAt
            });
            return tf;
        }
        case 'receive': {
            const rc = receive(data, user, input);
            recordActivity(data, {
                type: 'receive',
                title: user.name || rc.receiver || 'Quản lý kho',
                action: `Nhận hàng chuyển kho ${rc.code} tại ${rc.toBranch}`,
                val: rc.totalValue,
                branch: rc.toBranch,
                time: rc.receivedTime || rc.time,
                createdAt: rc.createdAt
            });
            return rc;
        }
        case 'stocktake': {
            const st = stocktake(data, user, input);
            recordActivity(data, {
                type: 'stocktake',
                title: user.name || st.cashier || 'Kiểm kho',
                action:
                    st.status === 'balanced'
                        ? `Cân bằng kho ${st.code} (${st.branch})`
                        : `Lưu tạm kiểm kho ${st.code} (${st.branch})`,
                val:
                    st.totalVariance !== 0
                        ? `${st.totalVariance > 0 ? '+' : ''}${st.totalVariance} SL`
                        : '',
                branch: st.branch,
                time: st.time,
                createdAt: st.createdAt
            });
            return st;
        }
        case 'shareProduct': {
            const sp = shareProduct(data, user, input);
            recordActivity(data, {
                type: 'shared_warehouse',
                title: user.name || 'Quản lý',
                action: `Chia sẻ sản phẩm ${sp.name} lên kho chung`,
                branch: sp.ownerBranch
            });
            return sp;
        }
        case 'unshareProduct': {
            const result = unshareProduct(data, user, input);
            recordActivity(data, {
                type: 'shared_warehouse',
                title: user.name || 'Quản lý',
                action: 'Gỡ sản phẩm khỏi kho chung'
            });
            return result;
        }
        case 'updateSharedProduct': {
            const result = updateSharedProduct(data, user, input);
            recordActivity(data, {
                type: 'shared_warehouse',
                title: user.name || 'Quản lý',
                action: `Cập nhật thông tin sản phẩm kho chung ${result.name}`
            });
            return result;
        }
        default:
            fail('Thao tác không hợp lệ.', 400);
    }
}
module.exports = {
    execute,
    amount,
    fail,
    branchOf,
    recordActivity,
    syncSharedAvailability,
    productHasHistory
};
