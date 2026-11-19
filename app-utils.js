// --- UTILS & DATE HELPERS ---
function formatVND(num) {
    return (num || 0).toLocaleString('vi-VN');
}
function parseVND(str) {
    if (typeof str === 'number') return str;
    if (/^-/.test(String(str).trim())) return -parseInt(String(str).replace(/[^0-9]/g, ''), 10);
    return parseInt((str || '0').replace(/[^0-9]/g, ''), 10) || 0;
}
function readMoneyInVietnamese(n) {
    if (!n || isNaN(n) || n === 0) return 'Không đồng';
    n = Math.round(Math.abs(n));
    const digits = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
    const units = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'];

    function readGroup(g, isFirst) {
        const h = Math.floor(g / 100);
        const t = Math.floor((g % 100) / 10);
        const u = g % 10;
        const res = [];
        if (h > 0 || !isFirst) {
            res.push(digits[h] + ' trăm');
        }
        if (t > 1) {
            res.push(digits[t] + ' mươi');
            if (u === 1) res.push('mốt');
            else if (u === 4) res.push('tư');
            else if (u === 5) res.push('lăm');
            else if (u > 0) res.push(digits[u]);
        } else if (t === 1) {
            res.push('mười');
            if (u === 5) res.push('lăm');
            else if (u > 0) res.push(digits[u]);
        } else {
            if ((h > 0 || !isFirst) && u > 0) {
                res.push('lẻ');
                res.push(digits[u]);
            } else if (u > 0 && isFirst && h === 0) {
                res.push(digits[u]);
            }
        }
        return res.join(' ');
    }

    const groups = [];
    let temp = n;
    while (temp > 0) {
        groups.push(temp % 1000);
        temp = Math.floor(temp / 1000);
    }

    const words = [];
    for (let i = groups.length - 1; i >= 0; i--) {
        const g = groups[i];
        if (g > 0) {
            const s = readGroup(g, i === groups.length - 1);
            if (s) {
                words.push(s);
                if (units[i]) words.push(units[i]);
            }
        }
    }

    const result = words.join(' ').trim() + ' đồng';
    return result.charAt(0).toUpperCase() + result.slice(1);
}
function getCurrentDateTimeString() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseRecordDate(str) {
    if (!str) return null;
    const parts = str.trim().split(' ');
    const datePart = parts[0];
    const segs = datePart.split('/');
    if (segs.length === 3) {
        const day = parseInt(segs[0], 10);
        const month = parseInt(segs[1], 10) - 1;
        const year = parseInt(segs[2], 10);
        let hours = 0,
            minutes = 0;
        if (parts[1]) {
            const timeSegments = parts[1].split(':');
            hours = parseInt(timeSegments[0], 10) || 0;
            minutes = parseInt(timeSegments[1], 10) || 0;
        }
        return new Date(year, month, day, hours, minutes);
    }
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
}

function matchesDateFilter(recordTimeStr, filterMode, customFromStr, customToStr) {
    if (!filterMode || filterMode === 'all') return true;
    const d = parseRecordDate(recordTimeStr);
    if (!d) return true;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    if (filterMode === 'today') {
        return d >= todayStart && d <= todayEnd;
    } else if (filterMode === 'yesterday') {
        const yestStart = new Date(todayStart);
        yestStart.setDate(yestStart.getDate() - 1);
        const yestEnd = new Date(todayEnd);
        yestEnd.setDate(yestEnd.getDate() - 1);
        return d >= yestStart && d <= yestEnd;
    } else if (filterMode === '7days') {
        const past7 = new Date(todayStart);
        past7.setDate(past7.getDate() - 6);
        return d >= past7 && d <= todayEnd;
    } else if (filterMode === '30days') {
        const past30 = new Date(todayStart);
        past30.setDate(past30.getDate() - 29);
        return d >= past30 && d <= todayEnd;
    } else if (filterMode === 'this_month') {
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    } else if (filterMode === 'last_month') {
        const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        return (
            d.getFullYear() === lastMonthDate.getFullYear() &&
            d.getMonth() === lastMonthDate.getMonth()
        );
    } else if (filterMode === 'this_quarter') {
        const currentQuarter = Math.floor(now.getMonth() / 3);
        const recordQuarter = Math.floor(d.getMonth() / 3);
        return d.getFullYear() === now.getFullYear() && recordQuarter === currentQuarter;
    } else if (filterMode === 'this_year') {
        return d.getFullYear() === now.getFullYear();
    } else if (filterMode === 'custom') {
        const fromStr =
            customFromStr ||
            (typeof document !== 'undefined'
                ? document.getElementById('rep-date-from')?.value
                : '') ||
            '';
        const toStr =
            customToStr ||
            (typeof document !== 'undefined'
                ? document.getElementById('rep-date-to')?.value
                : '') ||
            '';
        if (fromStr) {
            const fromDate = new Date(fromStr + 'T00:00:00');
            if (!isNaN(fromDate.getTime()) && d < fromDate) return false;
        }
        if (toStr) {
            const toDate = new Date(toStr + 'T23:59:59.999');
            if (!isNaN(toDate.getTime()) && d > toDate) return false;
        }
        return true;
    }
    return true;
}

// Tra thông tin nhà cung cấp hiện tại cho một phiếu nhập (dùng chung cho tìm kiếm/xuất/nhãn).
// Ưu tiên danh sách nhà cung cấp đang có; fallback về tên/mã đã lưu trên phiếu nếu đã bị xóa.
function resolveImportSupplier(row, suppliers) {
    const list = Array.isArray(suppliers)
        ? suppliers
        : typeof KVStore !== 'undefined'
          ? KVStore.data?.suppliers || []
          : [];
    const supplier = row?.supplierId
        ? list.find((s) => s.id === row.supplierId) || list.find((s) => s.code === row.nccCode)
        : list.find((s) => s.code === row.nccCode);
    return {
        code: supplier?.code ?? row?.nccCode ?? '',
        name: supplier?.name ?? row?.nccName ?? '',
        phone: supplier?.phone ?? row?.nccPhone ?? ''
    };
}

// Chuẩn hóa chuỗi để tìm kiếm: bỏ dấu tiếng Việt, về chữ thường và cắt khoảng trắng thừa.
// Dùng chung cho tìm kiếm phía trình duyệt và hàm SQLite `nkiot_fold` phía server.
function foldText(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase()
        .trim();
}

// Bộ lọc nâng cao cho từng danh sách; thứ tự phần tử là thứ tự ô nhập trong panel.
const ADVANCED_SEARCH_FIELDS = {
    invoices: [
        { key: 'code', label: 'Theo mã hóa đơn' },
        { key: 'product', label: 'Theo mã, tên hàng' },
        { key: 'customer', label: 'Theo mã, tên, số điện thoại khách hàng' },
        { key: 'shipment', label: 'Theo mã vận đơn' },
        { key: 'imei', label: 'Theo IMEI / Serial' },
        { key: 'note', label: 'Theo ghi chú' },
        { key: 'itemNote', label: 'Theo ghi chú hàng hóa' }
    ],
    imports: [
        { key: 'code', label: 'Theo mã phiếu nhập' },
        { key: 'product', label: 'Theo mã, tên hàng' },
        { key: 'supplier', label: 'Theo mã, tên, số điện thoại nhà cung cấp' },
        { key: 'imei', label: 'Theo IMEI / Serial' },
        { key: 'note', label: 'Theo ghi chú' },
        { key: 'creator', label: 'Theo người tạo' }
    ],
    suppliers: [
        { key: 'code', label: 'Theo mã nhà cung cấp' },
        { key: 'name', label: 'Theo tên nhà cung cấp' },
        { key: 'phone', label: 'Theo số điện thoại' },
        { key: 'address', label: 'Theo địa chỉ' },
        { key: 'note', label: 'Theo ghi chú' }
    ]
};

function advancedSearchFieldKeys(kind) {
    return (ADVANCED_SEARCH_FIELDS[kind] || []).map((f) => f.key);
}

// Tra mã vận đơn của hóa đơn; cache theo danh sách delivery_orders để không quét lại mỗi dòng.
let deliverySearchCache = { list: null, size: -1, byInvoice: null };
function deliverySearchValues(row) {
    const list =
        (typeof KVStore !== 'undefined' && Array.isArray(KVStore.data?.delivery_orders)
            ? KVStore.data.delivery_orders
            : null) || [];
    if (deliverySearchCache.list !== list || deliverySearchCache.size !== list.length) {
        const byInvoice = new Map();
        list.forEach((d) => {
            if (!d || !d.invoiceId) return;
            const codes = [d.code, d.shipmentCode, d.orderNumber].filter(Boolean);
            if (!codes.length) return;
            byInvoice.set(d.invoiceId, (byInvoice.get(d.invoiceId) || []).concat(codes));
        });
        deliverySearchCache = { list, size: list.length, byInvoice };
    }
    const codes = new Set();
    if (row?.deliveryCode) codes.add(row.deliveryCode);
    if (row?.shipmentCode) codes.add(row.shipmentCode);
    (deliverySearchCache.byInvoice.get(row?.id) || []).forEach((code) => codes.add(code));
    return Array.from(codes);
}

// Mã khách của hóa đơn theo cùng quy tắc với server (khớp SĐT trước, sau đó tới tên).
let customerCodeCache = { list: null, size: -1, byPhone: null, byName: null };
function customerCodeOf(row) {
    if (row?.customerCode) return row.customerCode;
    const list =
        (typeof KVStore !== 'undefined' && Array.isArray(KVStore.data?.customers)
            ? KVStore.data.customers
            : null) || [];
    if (customerCodeCache.list !== list || customerCodeCache.size !== list.length) {
        const byPhone = new Map(),
            byName = new Map();
        list.forEach((c) => {
            if (c?.phone && !byPhone.has(c.phone)) byPhone.set(c.phone, c.code);
            if (c?.name && !byName.has(c.name)) byName.set(c.name, c.code);
        });
        customerCodeCache = { list, size: list.length, byPhone, byName };
    }
    return (
        customerCodeCache.byPhone.get(row?.phone) ||
        customerCodeCache.byName.get(row?.customer) ||
        ''
    );
}

// Gom giá trị có thể tìm kiếm của một dòng theo từng khóa của bộ lọc nâng cao.
function advancedSearchRowValues(kind, row) {
    const items = Array.isArray(row?.items) ? row.items : [];
    if (kind === 'imports') {
        const ncc = resolveImportSupplier(row);
        return {
            code: [row?.code],
            product: items.flatMap((item) => [item.code, item.name]),
            supplier: [ncc.code, ncc.name, ncc.phone],
            imei: items.flatMap((item) => (Array.isArray(item.imeis) ? item.imeis : [])),
            note: [row?.note],
            creator: [row?.creator]
        };
    }
    if (kind === 'suppliers') {
        return {
            code: [row?.code],
            name: [row?.name],
            phone: [row?.phone],
            address: [row?.address],
            note: [row?.note]
        };
    }
    return {
        code: [row?.code],
        product: items.flatMap((item) => [item.code, item.name]),
        customer: [row?.customer, row?.phone, customerCodeOf(row)],
        shipment: deliverySearchValues(row),
        imei: items.flatMap((item) => (Array.isArray(item.imeis) ? item.imeis : [])),
        note: [row?.note],
        itemNote: items.map((item) => item?.note)
    };
}

// Mọi trường trong panel phải cùng khớp (AND); trường để trống thì bỏ qua.
function matchesAdvancedSearch(kind, row, adv) {
    if (!adv) return true;
    const keys = advancedSearchFieldKeys(kind);
    const entries = Object.entries(adv).filter(
        ([key, needle]) => keys.includes(key) && String(needle || '').trim()
    );
    if (!entries.length) return true;
    const values = advancedSearchRowValues(kind, row);
    return entries.every(([key, needle]) => {
        const target = foldText(needle);
        return (values[key] || []).some((value) => foldText(value).includes(target));
    });
}

// Shared UI/export predicates; independent of rendering and pagination.
function matchesDocumentFilter(
    row,
    {
        q = '',
        date = 'all',
        status = 'all',
        kind,
        returned = false,
        starred = false,
        adv = null
    } = {}
) {
    if (!matchesDateFilter(row.time, date)) return false;
    if (status === 'starred' && !starred) return false;
    if (status === 'cancelled' && row.status !== 'cancelled') return false;
    if (status === 'imported' && row.status === 'cancelled') return false;
    if (status === 'completed' && (row.status !== 'completed' || returned)) return false;
    if (status === 'returned' && !returned) return false;
    if (!matchesAdvancedSearch(kind, row, adv)) return false;
    const values =
        kind === 'imports'
            ? (() => {
                  const ncc = resolveImportSupplier(row);
                  return [row.code, ncc.name, ncc.code, ncc.phone];
              })()
            : [row.code, row.customer, row.phone];
    const needle = foldText(q);
    return !needle || values.some((v) => foldText(v).includes(needle));
}

function normalizePaymentMethod(method) {
    if (!method && method !== 0) return 'unknown';
    const m = String(method).toLowerCase().trim();
    if (!m) return 'unknown';
    if (m === 'cash' || m.includes('tiền mặt') || m.includes('tien mat')) return 'cash';
    if (
        m === 'transfer' ||
        m.includes('khoản') ||
        m.includes('khoan') ||
        m.includes('vietqr') ||
        m.includes('bank') ||
        m.includes('ngân hàng') ||
        m.includes('ngan hang')
    )
        return 'transfer';
    if (
        m === 'card' ||
        m.includes('thẻ') ||
        m.includes('the') ||
        m.includes('pos') ||
        m.includes('quẹt') ||
        m.includes('quet') ||
        m.includes('credit') ||
        m.includes('debit')
    )
        return 'card';
    return 'unknown';
}

function getPaymentMethodLabel(method) {
    const norm = normalizePaymentMethod(method);
    switch (norm) {
        case 'cash':
            return 'Tiền mặt';
        case 'transfer':
            return 'Chuyển khoản';
        case 'card':
            return 'Thẻ / POS';
        default:
            return typeof method === 'string' && method.trim() ? method.trim() : 'Không xác định';
    }
}

// Share date semantics with the paginated SQLite reader (no DOM access for supported presets).
if (typeof module !== 'undefined') {
    module.exports = {
        parseRecordDate,
        matchesDateFilter,
        normalizePaymentMethod,
        getPaymentMethodLabel,
        foldText
    };
}
