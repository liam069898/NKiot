// --- 10. BARCODE LABEL PRINTING SYSTEM ---
const CODE39_PATTERNS = {
    0: '000110100',
    1: '100100001',
    2: '001100001',
    3: '101100000',
    4: '000110001',
    5: '100110000',
    6: '001110000',
    7: '000100101',
    8: '100100100',
    9: '001100100',
    A: '100001001',
    B: '001001001',
    C: '101001000',
    D: '000011001',
    E: '100011000',
    F: '001011000',
    G: '000001101',
    H: '100001100',
    I: '001001100',
    J: '000011100',
    K: '100000011',
    L: '001000011',
    M: '101000010',
    N: '000010011',
    O: '100010010',
    P: '001010010',
    Q: '000000111',
    R: '100000110',
    S: '001000110',
    T: '000010110',
    U: '110000001',
    V: '011000001',
    W: '111000000',
    X: '010010001',
    Y: '110010000',
    Z: '011010000',
    '-': '010000101',
    '.': '110000100',
    ' ': '011000100',
    $: '010101000',
    '/': '010100010',
    '+': '010001010',
    '%': '000101010',
    '*': '010010100'
};

function drawBarcodeCode39(canvas, text) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const raw = (text || '').toUpperCase().replace(/[^0-9A-Z\-\. \$\/\+\%]/g, '');
    const cleanText = '*' + raw + '*';
    const narrowWidth = 2;
    const wideWidth = 5;
    const gap = 2;
    const barHeight = 44;

    let totalWidth = 20;
    for (let i = 0; i < cleanText.length; i++) {
        const pattern = CODE39_PATTERNS[cleanText[i]];
        if (!pattern) continue;
        for (let j = 0; j < 9; j++) {
            totalWidth += pattern[j] === '1' ? wideWidth : narrowWidth;
        }
        totalWidth += gap;
    }

    canvas.width = Math.max(160, totalWidth);
    canvas.height = barHeight + 18;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let curX = 10;
    ctx.fillStyle = '#000000';

    for (let i = 0; i < cleanText.length; i++) {
        const char = cleanText[i];
        const pattern = CODE39_PATTERNS[char];
        if (!pattern) continue;

        for (let j = 0; j < 9; j++) {
            const isBar = j % 2 === 0;
            const w = pattern[j] === '1' ? wideWidth : narrowWidth;
            if (isBar) {
                ctx.fillRect(curX, 0, w, barHeight);
            }
            curX += w;
        }
        curX += gap;
    }

    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(raw, canvas.width / 2, barHeight + 14);
}

let activeBarcodeProduct = null;

function openBarcodeModal(productCode) {
    const currentBranch = getCurrentBranch();
    const isAll =
        currentBranch ===
        (typeof ALL_BRANCHES !== 'undefined' ? ALL_BRANCHES : 'Toàn bộ chi nhánh');
    const p = (KVStore.data.products || []).find(
        (item) =>
            item.code === productCode &&
            (isAll || (item.branch || FALLBACK_BRANCH) === currentBranch)
    );
    if (!p) {
        showToast('Không tìm thấy sản phẩm', 'error');
        return;
    }
    activeBarcodeProduct = p;
    const modal = document.getElementById('barcode-modal');
    if (!modal) return;

    document.getElementById('barcode-modal-pname').textContent = p.name;
    document.getElementById('barcode-modal-pcode').textContent = p.code;
    document.getElementById('barcode-modal-pprice').textContent = `${formatVND(p.price)} đ`;
    document.getElementById('barcode-qty-input').value = '4';

    updateBarcodePreview();
    modal.classList.remove('hidden');
}

function closeBarcodeModal() {
    document.getElementById('barcode-modal')?.classList.add('hidden');
}

function updateBarcodePreview() {
    if (!activeBarcodeProduct) return;
    const qty = parseInt(document.getElementById('barcode-qty-input')?.value || '4', 10) || 1;
    const showStore = document.getElementById('barcode-opt-store')?.checked ?? true;
    const showPrice = document.getElementById('barcode-opt-price')?.checked ?? true;

    const container = document.getElementById('barcode-preview-grid');
    const printContainer = document.getElementById('printable-barcode-sheet');
    if (!container) return;
    container.innerHTML = '';
    if (printContainer) printContainer.innerHTML = '';

    for (let i = 0; i < qty; i++) {
        const card = document.createElement('div');
        card.className =
            'bg-white border border-gray-300 rounded p-2 flex flex-col items-center justify-between text-center shadow-xs w-[170px] h-[130px] flex-shrink-0';

        let storeHtml = showStore
            ? trustedHTML(
                  '<div class="text-[10px] font-bold text-gray-500 uppercase tracking-wider">KALO STORE</div>'
              )
            : '';
        let nameHtml = renderHTML`<div class="text-[11px] font-semibold text-gray-900 leading-tight line-clamp-1 w-full" title="${activeBarcodeProduct.name}">${activeBarcodeProduct.name}</div>`;
        let priceHtml = showPrice
            ? renderHTML`<div class="text-[12px] font-bold text-red-600">${formatVND(activeBarcodeProduct.price)} đ</div>`
            : '';

        card.innerHTML = renderHTML`
            ${storeHtml}
            ${nameHtml}
            <canvas class="barcode-canvas-item my-1 max-w-full" style="max-height: 48px"></canvas>
            ${priceHtml}
        `;
        container.appendChild(card);

        const canvas = card.querySelector('.barcode-canvas-item');
        drawBarcodeCode39(canvas, activeBarcodeProduct.barcode || activeBarcodeProduct.code);

        // Print sheet copy
        if (printContainer) {
            const printCard = card.cloneNode(true);
            printCard.className =
                'inline-block m-1.5 border border-dashed border-gray-400 p-2 text-center w-[170px] h-[130px] align-top';
            printContainer.appendChild(printCard);
            const printCanvas = printCard.querySelector('.barcode-canvas-item');
            drawBarcodeCode39(
                printCanvas,
                activeBarcodeProduct.barcode || activeBarcodeProduct.code
            );
        }
    }
}

function printBarcodeStickers() {
    printRegion('printable-barcode-sheet', false);
}

// --- 11. EXPORT TO CSV / EXCEL ---
function exportTableToCSV(type) {
    const currentBranch = getCurrentBranch();
    const isAll =
        currentBranch ===
        (typeof ALL_BRANCHES !== 'undefined' ? ALL_BRANCHES : 'Toàn bộ chi nhánh');
    const branchTag = isAll ? 'Toan_bo_chi_nhanh' : currentBranch.replace(/\s+/g, '_');
    let filename = `kiotviet_${type}_${new Date().toISOString().slice(0, 10)}.csv`;
    let headers = [];
    let rows = [];

    if (type === 'products') {
        filename = `Danh_muc_hang_hoa_${branchTag}_${new Date().toISOString().slice(0, 10)}.csv`;
        headers = [
            'Mã hàng',
            'Tên hàng hóa',
            'Mã vạch',
            'Nhóm hàng',
            'Giá vốn',
            'Giá bán',
            'Tồn kho',
            'Đơn vị tính',
            'Chi nhánh'
        ];
        let exportList;
        if (isAll) {
            const prodMap = new Map();
            (KVStore.data.products || []).forEach((p) => {
                const code = p.code;
                if (!prodMap.has(code)) {
                    prodMap.set(code, {
                        ...p,
                        stock: 0,
                        branchStocks: []
                    });
                }
                const item = prodMap.get(code);
                const bName = p.branch || FALLBACK_BRANCH;
                const bStock = Number(p.stock) || 0;
                item.stock += bStock;
                item.branchStocks.push({ branch: bName, stock: bStock });
            });
            exportList = Array.from(prodMap.values()).map((item) => {
                item.branch = item.branchStocks.map((b) => `${b.branch}: ${b.stock}`).join(' · ');
                return item;
            });
        } else {
            exportList = (KVStore.data.products || []).filter(
                (p) => (p.branch || FALLBACK_BRANCH) === currentBranch
            );
        }
        if (typeof productFilterCategory !== 'undefined' && productFilterCategory !== 'all') {
            exportList = exportList.filter((p) => p.category === productFilterCategory);
        }
        if (typeof productFilterStock !== 'undefined') {
            if (productFilterStock === 'warning') {
                exportList = exportList.filter(
                    (p) => (p.minStock || 0) > 0 && p.stock < p.minStock
                );
            } else if (productFilterStock === 'out') {
                exportList = exportList.filter((p) => p.stock === 0);
            } else if (productFilterStock === 'in') {
                exportList = exportList.filter((p) => p.stock > 0);
            }
        }
        const prodQ = (document.getElementById('product-search-input')?.value || '')
            .toLowerCase()
            .trim();
        if (prodQ) {
            exportList = exportList.filter(
                (p) =>
                    (p.name || '').toLowerCase().includes(prodQ) ||
                    (p.code || '').toLowerCase().includes(prodQ) ||
                    (p.barcode && p.barcode.toLowerCase().includes(prodQ))
            );
        }
        rows = exportList.map((p) => [
            p.code,
            `"${(p.name || '').replace(/"/g, '""')}"`,
            `"${p.barcode || ''}"`,
            `"${p.category || ''}"`,
            p.costPrice || 0,
            p.price || 0,
            p.stock || 0,
            `"${p.unit || ''}"`,
            `"${p.branch || currentBranch}"`
        ]);
    } else if (type === 'sharedWarehouse') {
        filename = `Kho_chung_doi_tac_${new Date().toISOString().slice(0, 10)}.csv`;
        headers = [
            'Mã kho chung',
            'Mã SKU gốc',
            'Tên sản phẩm',
            'Nhóm hàng',
            'Giá bán lẻ',
            'Giá sỉ chia sẻ',
            'SL tối thiểu',
            'Trạng thái kho',
            'Nhà bán hàng',
            'Chi nhánh',
            'Số điện thoại',
            'Ghi chú'
        ];
        rows = (KVStore.data.shared_products || [])
            .filter((sp) => sp.status === 'active')
            .map((sp) => [
                sp.id,
                sp.code,
                `"${(sp.name || '').replace(/"/g, '""')}"`,
                `"${sp.category || ''}"`,
                sp.price || 0,
                sp.wholesalePrice || 0,
                sp.minOrderQty || 1,
                sp.availability === 'in_stock'
                    ? 'Còn hàng'
                    : sp.availability === 'low_stock'
                      ? 'Sắp hết'
                      : 'Hết hàng',
                `"${(sp.ownerName || '').replace(/"/g, '""')}"`,
                `"${sp.ownerBranch || ''}"`,
                `"${sp.ownerPhone || ''}"`,
                `"${(sp.note || '').replace(/"/g, '""')}"`
            ]);
    } else if (type === 'invoices') {
        filename = `Danh_sach_hoa_don_${branchTag}_${new Date().toISOString().slice(0, 10)}.csv`;
        headers = [
            'Mã hóa đơn',
            'Thời gian',
            'Khách hàng',
            'Điện thoại',
            'Tổng tiền hàng',
            'Khách đã trả',
            'Giảm giá',
            'Trạng thái',
            'Thu ngân',
            'Chi nhánh'
        ];
        rows = (KVStore.data.invoices || [])
            .filter((i) => isAll || (i.branch || FALLBACK_BRANCH) === currentBranch)
            .filter((i) =>
                matchesDocumentFilter(i, {
                    kind: 'invoices',
                    q: document.getElementById('invoice-search-input')?.value || '',
                    date: document.getElementById('invoice-date-filter')?.value || 'all',
                    status: invoiceStatusFilter,
                    returned:
                        !!i.hasReturned ||
                        (KVStore.data.returns || []).some((r) => r.invoiceCode === i.code),
                    starred: isRecordStarred(`inv:${i.code}`)
                })
            )
            .map((i) => [
                i.code,
                `"${i.time || ''}"`,
                `"${(i.customer || '').replace(/"/g, '""')}"`,
                `"${i.phone || ''}"`,
                i.total || 0,
                i.paid || 0,
                i.discount || 0,
                i.status === 'cancelled' ? 'Đã hủy' : i.hasReturned ? 'Có trả hàng' : 'Hoàn thành',
                `"${i.cashier || ''}"`,
                `"${i.branch || ''}"`
            ]);
    } else if (type === 'imports') {
        filename = `Danh_sach_nhap_hang_${branchTag}_${new Date().toISOString().slice(0, 10)}.csv`;
        headers = [
            'Mã phiếu',
            'Thời gian',
            'Mã NCC',
            'Tên nhà cung cấp',
            'Cần trả NCC',
            'Đã trả',
            'Trạng thái',
            'Người tạo',
            'Chi nhánh',
            'Ghi chú'
        ];
        rows = (KVStore.data.imports || [])
            .filter((imp) => isAll || (imp.branch || FALLBACK_BRANCH) === currentBranch)
            .filter((imp) =>
                matchesDocumentFilter(imp, {
                    kind: 'imports',
                    q: document.getElementById('import-search-input')?.value || '',
                    date: document.getElementById('import-date-filter')?.value || 'all',
                    status: document.getElementById('import-status-filter')?.value || 'all',
                    starred: isRecordStarred(`imp:${imp.code}`)
                })
            )
            .map((imp) => [
                imp.code,
                `"${imp.time || ''}"`,
                `"${imp.nccCode || ''}"`,
                `"${(imp.nccName || '').replace(/"/g, '""')}"`,
                imp.needPay || 0,
                imp.paid || 0,
                imp.status === 'cancelled' ? 'Đã hủy' : 'Đã nhập hàng',
                `"${imp.creator || ''}"`,
                `"${imp.branch || currentBranch}"`,
                `"${(imp.note || '').replace(/"/g, '""').replace(/<br>/g, ' ')}"`
            ]);
    } else if (type === 'customers') {
        filename = `Danh_sach_khach_hang_${new Date().toISOString().slice(0, 10)}.csv`;
        headers = [
            'Mã KH',
            'Tên khách hàng',
            'Điện thoại',
            'Địa chỉ',
            'Tổng chi tiêu',
            'Nợ hiện tại',
            'Điểm tích lũy'
        ];
        const custQ = (document.getElementById('customer-search-input')?.value || '')
            .toLowerCase()
            .trim();
        rows = (KVStore.data.customers || [])
            .filter(
                (c) =>
                    !custQ ||
                    (c.name || '').toLowerCase().includes(custQ) ||
                    (c.phone || '').includes(custQ) ||
                    (c.code || '').toLowerCase().includes(custQ)
            )
            .map((c) => [
                c.code,
                `"${(c.name || '').replace(/"/g, '""')}"`,
                `"${c.phone || ''}"`,
                `"${(c.address || '').replace(/"/g, '""')}"`,
                c.totalSpent || 0,
                c.debt || 0,
                c.points || 0
            ]);
    } else if (type === 'suppliers') {
        filename = `Danh_sach_nha_cung_cap_${new Date().toISOString().slice(0, 10)}.csv`;
        headers = [
            'Mã NCC',
            'Tên nhà cung cấp',
            'Điện thoại',
            'Địa chỉ',
            'Tổng tiền mua',
            'Nợ cần trả'
        ];
        const supQ = (document.getElementById('supplier-search-input')?.value || '')
            .toLowerCase()
            .trim();
        rows = (KVStore.data.suppliers || [])
            .filter(
                (s) =>
                    !supQ ||
                    (s.name || '').toLowerCase().includes(supQ) ||
                    (s.phone || '').includes(supQ) ||
                    (s.code || '').toLowerCase().includes(supQ)
            )
            .map((s) => [
                s.code,
                `"${(s.name || '').replace(/"/g, '""')}"`,
                `"${s.phone || ''}"`,
                `"${(s.address || '').replace(/"/g, '""')}"`,
                s.totalBought || 0,
                s.debt || 0
            ]);
    } else if (type === 'cashbook') {
        filename = `So_quy_${branchTag}_${new Date().toISOString().slice(0, 10)}.csv`;
        headers = [
            'Mã phiếu',
            'Thời gian',
            'Loại phiếu',
            'Hạng mục',
            'Người nộp/nhận',
            'Hình thức',
            'Số tiền',
            'Chi nhánh',
            'Ghi chú'
        ];
        const cbDate = document.getElementById('cashbook-date-filter')?.value || 'all';
        const cbFund = document.getElementById('cashbook-fund-filter')?.value || 'all';
        rows = (KVStore.data.cashbook || [])
            .filter((tx) => isAll || (tx.branch || FALLBACK_BRANCH) === currentBranch)
            .filter((tx) => cbDate === 'all' || matchesDateFilter(tx.time, cbDate))
            .filter((tx) => {
                if (cbFund === 'cash') return (tx.method || '').toLowerCase().includes('tiền mặt');
                if (cbFund === 'bank') return !(tx.method || '').toLowerCase().includes('tiền mặt');
                return true;
            })
            .map((tx) => [
                tx.code,
                `"${tx.time || ''}"`,
                tx.type === 'thu' ? 'Thu' : 'Chi',
                `"${tx.category || ''}"`,
                `"${(tx.person || '').replace(/"/g, '""')}"`,
                `"${tx.method || ''}"`,
                tx.amount || 0,
                `"${tx.branch || currentBranch}"`,
                `"${(tx.note || '').replace(/"/g, '""')}"`
            ]);
    } else if (type === 'stocktakes') {
        filename = `Phieu_kiem_kho_${branchTag}_${new Date().toISOString().slice(0, 10)}.csv`;
        headers = [
            'Mã phiếu kiểm',
            'Thời gian',
            'Chi nhánh',
            'Người kiểm',
            'Tổng thực tế',
            'Tổng chênh lệch',
            'Trạng thái',
            'Ghi chú'
        ];
        rows = (KVStore.data.stocktakes || [])
            .filter((st) => isAll || (st.branch || FALLBACK_BRANCH) === currentBranch)
            .map((st) => [
                st.code,
                `"${st.time || ''}"`,
                `"${(st.branch || '').replace(/"/g, '""')}"`,
                `"${(st.cashier || '').replace(/"/g, '""')}"`,
                st.totalActual || 0,
                st.totalVariance || 0,
                st.status === 'balanced' ? 'Đã cân bằng' : 'Phiếu tạm',
                `"${(st.note || '').replace(/"/g, '""')}"`
            ]);
    } else if (type === 'transfers') {
        filename = `Phieu_chuyen_hang_${branchTag}_${new Date().toISOString().slice(0, 10)}.csv`;
        headers = [
            'Mã chuyển hàng',
            'Thời gian',
            'Chi nhánh gửi',
            'Chi nhánh nhận',
            'Người chuyển',
            'Tổng SL chuyển',
            'Tổng giá trị',
            'Trạng thái',
            'Ghi chú'
        ];
        rows = (KVStore.data.transfers || [])
            .filter(
                (tf) => isAll || tf.fromBranch === currentBranch || tf.toBranch === currentBranch
            )
            .map((tf) => [
                tf.code,
                `"${tf.time || ''}"`,
                `"${(tf.fromBranch || '').replace(/"/g, '""')}"`,
                `"${(tf.toBranch || '').replace(/"/g, '""')}"`,
                `"${(tf.cashier || '').replace(/"/g, '""')}"`,
                tf.totalQty || 0,
                tf.totalValue || 0,
                tf.status === 'completed'
                    ? 'Đã nhận hàng'
                    : tf.status === 'shipping'
                      ? 'Đang chuyển'
                      : 'Đã hủy',
                `"${(tf.note || '').replace(/"/g, '""')}"`
            ]);
    }

    function formatCsvCell(val) {
        let str = String(val ?? '');
        if (str.startsWith('"') && str.endsWith('"') && str.length >= 2) {
            str = str.slice(1, -1).replace(/""/g, '"');
        }
        str = str.replace(/"/g, '""');
        if (/^[=+\-@\t\r]/.test(str)) {
            str = "'" + str;
        }
        return `"${str}"`;
    }

    const tbodyIdMap = {
        products: 'products-tbody',
        sharedWarehouse: 'shared-products-tbody',
        invoices: 'invoice-tbody',
        imports: 'import-tbody',
        customers: 'customers-tbody',
        suppliers: 'suppliers-tbody',
        cashbook: 'cashbook-tbody',
        stocktakes: 'stocktakes-tbody',
        transfers: 'transfers-tbody'
    };
    const targetTbody = document.getElementById(tbodyIdMap[type] || '');
    const checkedBoxes = targetTbody
        ? [...targetTbody.querySelectorAll('input.kv-checkbox:checked')]
        : [];
    if (checkedBoxes.length > 0) {
        const selectedCodes = new Set(
            checkedBoxes
                .map((cb) => {
                    const tr = cb.closest('tr');
                    return tr?.dataset.exportKey || '';
                })
                .filter(Boolean)
        );
        rows = rows.filter((r) => selectedCodes.has(String(r[0])));
    }

    const csvRows = [headers.map(formatCsvCell).join(',')];
    rows.forEach((r) => csvRows.push(r.map(formatCsvCell).join(',')));
    const csvContent = '\uFEFF' + csvRows.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(
        checkedBoxes.length > 0
            ? `Đã xuất ${rows.length} dòng đã chọn ra file ${filename}!`
            : `Đã xuất file ${filename} thành công!`,
        'success'
    );
}
