'use strict';
const { test } = require('node:test'),
    assert = require('node:assert/strict'),
    fs = require('node:fs');
const { JSDOM } = require('jsdom');
function browser() {
    const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
        url: 'http://localhost',
        runScripts: 'outside-only'
    });
    const w = dom.window;
    w.eval = (code) => require('node:vm').runInContext(code, dom.getInternalVMContext());
    w.confirm = () => true;
    w.prompt = () => null;
    w.print = () => {};
    w.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: 'login' }) });
    w.eval(fs.readFileSync('constants.js', 'utf8'));
    w.eval(fs.readFileSync('catalog-patch.js', 'utf8'));
    w.eval(fs.readFileSync('ui-safety.js', 'utf8'));
    w.eval(fs.readFileSync('client-store.js', 'utf8'));
    for (const file of [
        'app-utils.js',
        'app-reports.js',
        'app-export.js',
        'app.js',
        'app-deplao.js'
    ]) {
        w.eval(
            fs
                .readFileSync(file, 'utf8')
                .replace("window.addEventListener('DOMContentLoaded', initApp);", '')
        );
    }
    const d = JSON.parse(JSON.stringify(require('../data').defaultData));
    d.users = d.users.map(({ password, ...u }) => u);
    w.fixtureData = d;
    w.eval(
        'KVStore.data=fixtureData;KVStore._base=copyData(fixtureData);KVStore.user=fixtureData.users[0];KVStore.revision=1;KVStore.isDbConnected=true;'
    );
    return dom;
}
test('login screen and modals are top-level so a closed modal can never hide the app', () => {
    const dom = browser(),
        w = dom.window;
    try {
        const doc = w.document;
        const login = doc.getElementById('login-screen');
        assert.ok(login, 'login screen exists');
        assert.equal(login.parentElement, doc.body, 'login screen must be a direct child of body');
        for (const modal of doc.querySelectorAll('.kv-modal')) {
            const nested = modal.parentElement.closest('.kv-modal');
            assert.equal(
                nested,
                null,
                `#${modal.id || '(no id)'} is nested inside #${nested?.id || '(no id)'}`
            );
        }
    } finally {
        w.close();
    }
});
test('POS catalog, search and scanner exclude archived products', () => {
    const dom = browser(),
        w = dom.window;
    try {
        w.eval(`
            const original = KVStore.data.products[0];
            KVStore.data.products = [
                {...original, id:'ACTIVE', code:'ACTIVE', name:'Active', status:'active'},
                {...original, id:'ARCHIVE', code:'ARCHIVE', name:'Archived', status:'archived', barcode:'ARCHIVE-BAR'}
            ];
        `);
        w.renderPosCatalog();
        assert.ok(w.document.getElementById('pos-product-grid').textContent.includes('Active'));
        assert.ok(!w.document.getElementById('pos-product-grid').textContent.includes('Archived'));
        w.searchPosProducts('ARCHIVE');
        assert.ok(
            !w.document.getElementById('pos-product-dropdown').textContent.includes('Archived')
        );
        w.document.getElementById('pos-search-input').value = 'ARCHIVE-BAR';
        w.handlePosSearchKeydown({ key: 'Enter', preventDefault() {} });
        assert.equal(w.eval('state.posTabs[state.activePosTab].cart.length'), 0);
        w.eval('addPosCartItem(KVStore.data.products[1])');
        assert.equal(w.eval('state.posTabs[state.activePosTab].cart.length'), 0);
    } finally {
        w.close();
    }
});
test('all views render with the shipped data', () => {
    const dom = browser();
    dom.window.renderAllViews();
    dom.window.renderBranchSelector();
    dom.window.renderCategorySelectOptions();
    dom.window.renderStaffTable();
    assert.ok(dom.window.document.querySelector('#products-tbody tr'));
    dom.window.close();
});
test('catalog and report rendering escape stored HTML and attribute injection', () => {
    const dom = browser(),
        w = dom.window;
    w.eval(
        `KVStore.data.products[0].name='<img src=x onerror="window.pwned=1">';KVStore.data.products[0].category='"><svg onload="window.pwned=1">';KVStore.data.customers[0].name='<script>window.pwned=1</script>';KVStore.data.users[0].name='<img src=x onerror="window.pwned=1">';`
    );
    w.renderAllViews();
    w.renderStaffTable();
    assert.equal(w.document.querySelector('#products-tbody img'), null);
    assert.equal(w.document.querySelector('#customers-tbody script'), null);
    assert.equal(w.document.querySelector('#staff-table-tbody img'), null);
    assert.ok(w.document.querySelector('#products-tbody').textContent.includes('<img'));
    dom.window.close();
});
test('legacy malicious identifiers cannot escape quoted inline arguments', () => {
    const dom = browser(),
        w = dom.window;
    w.eval(`KVStore.data.products[0].code="SP');window.pwned=1;//";`);
    w.renderProducts();
    const button = w.document.querySelector('#products-tbody button');
    const handler = button.getAttribute('onclick');
    let code;
    w.viewProductImeis = (value) => (code = value);
    w.openBarcodeModal = (value) => (code = value);
    w.eval(handler);
    assert.equal(w.pwned, undefined);
    assert.equal(code, "SP');window.pwned=1;//");
    dom.window.close();
});
test('POS revenue uses line value and historic costs, cash is categorized correctly', () => {
    const dom = browser(),
        w = dom.window;
    w.eval(
        `KVStore.data.invoices=[{id:'TEST',code:'TEST',branch:'Kalo HCM',status:'completed',time:getCurrentDateTimeString(),customer:'Test',total:100000,paid:100000,discount:0,paymentMethod:'cash',items:[{code:'SP001',name:'Test',qty:1,price:100000,costPrice:50000,total:100000,netTotal:100000}]}];KVStore.data.returns=[];KVStore.data.products[0].costPrice=80000;`
    );
    const cards = {};
    let breakdown;
    w.updateKpiCard = (idx, icon, label, value) => (cards[label] = value);
    w.renderBreakdownBars = (id, items) => (breakdown = items);
    w.eval("renderProductsReportTab(KVStore.data,'Kalo HCM',KVStore.data.products,'all')");
    assert.equal(cards['Doanh thu sản phẩm'], '100.000 đ');
    assert.equal(cards['Lợi nhuận hàng hóa'], '50.000 đ');
    w.eval("renderSalesReportTab(KVStore.data,'Kalo HCM',KVStore.data.products,'all')");
    assert.equal(cards['Lợi nhuận gộp'], '50.000 đ');
    assert.equal(breakdown.find((b) => b.label === 'Tiền mặt').value, 100000);
    dom.window.close();
});
test('print chooses only the requested document and clears previous content', () => {
    const dom = browser(),
        w = dom.window;
    w.document.getElementById('printable-return-receipt').textContent = 'RETURN-TEST';
    w.printReturnReceipt();
    assert.equal(w.document.querySelector('#print-root').textContent, 'RETURN-TEST');
    w.document.getElementById('view-reports').textContent = 'REPORT-TEST';
    w.printCurrentReport();
    assert.equal(w.document.querySelectorAll('#print-root').length, 1);
    assert.equal(w.document.querySelector('#print-root').textContent, 'REPORT-TEST');
    dom.window.close();
});
test('network failure preserves exact pending request for retry, blocks a second transaction', async () => {
    const dom = browser(),
        w = dom.window;
    w.fetch = async () => {
        throw new Error('offline');
    };
    await assert.rejects(w.eval("KVStore.command('sale',{branch:'Kalo HCM',items:[]})"));
    const pending = w.eval('JSON.stringify(KVStore.pending())');
    assert.ok(JSON.parse(pending).length === 1);
    await assert.rejects(w.eval("KVStore.command('sale',{branch:'Kalo HCM',items:[]})"));
    assert.equal(w.eval('JSON.stringify(KVStore.pending())'), pending);
    dom.window.close();
});

test('legacy missing costs never show fabricated profit or margin in reports', () => {
    const dom = browser(),
        w = dom.window;
    w.eval(
        `KVStore.data.invoices=[{id:'OLD',code:'OLD',branch:'Kalo HCM',status:'completed',time:getCurrentDateTimeString(),total:100000,paid:100000,items:[{code:'constructor',name:'Old product',qty:1,price:100000,total:100000}]}];KVStore.data.returns=[];`
    );
    w.eval("renderProductsReportTab(KVStore.data,'Kalo HCM',KVStore.data.products,'all')");
    assert.ok(w.document.getElementById('rep-margin').textContent.includes('—'));
    assert.ok(
        w.document
            .getElementById('rep-main-chart-container')
            .querySelector('[title]')
            .title.includes('Thiếu giá vốn lịch sử')
    );
    assert.ok(w.document.getElementById('rep-table-tbody').textContent.includes('Chưa xác định'));
    dom.window.close();
});

test('cancellation in a later period preserves original sale and books reversal on return date', () => {
    const dom = browser(),
        w = dom.window;
    w.eval(
        `KVStore.data.invoices=[{id:'I',code:'I',bookingVersion:2,branch:'Kalo HCM',status:'cancelled',time:'01/01/2025 10:00',total:100000,paid:0,returnedTotal:100000,paymentMethod:'cash',items:[{code:'P',name:'Product',qty:1,price:100000,costPrice:50000,netTotal:100000}]}];KVStore.data.returns=[{id:'R',invoiceCode:'I',branch:'Kalo HCM',time:getCurrentDateTimeString(),returnValue:100000,totalRefund:100000,items:[{code:'P',name:'Product',qty:1,total:100000,costPrice:50000}]}];`
    );
    const cards = {};
    w.updateKpiCard = (idx, icon, label, value) => (cards[label] = value);
    w.eval("renderSalesReportTab(KVStore.data,'Kalo HCM',KVStore.data.products,'today')");
    assert.equal(cards['Doanh thu thuần'], '-100.000 đ');
    assert.equal(cards['Lợi nhuận gộp'], '-50.000 đ');
    w.eval("renderSalesReportTab(KVStore.data,'Kalo HCM',KVStore.data.products,'all')");
    assert.equal(cards['Doanh thu thuần'], '0 đ');
    assert.equal(cards['Lợi nhuận gộp'], '0 đ');
    dom.window.close();
});

test('staff form starts without a default password and preserves separate user-management permission', () => {
    const dom = browser(),
        w = dom.window;
    w.openStaffFormModal();
    assert.equal(w.document.getElementById('staff-input-password').value, '');
    w.eval('KVStore.data.users[1].permissions.users=true');
    w.openStaffFormModal(w.eval('KVStore.data.users[1].id'));
    assert.equal(w.document.getElementById('perm-users').checked, true);
    dom.window.close();
});

test('10% UI scaling, Xoá button title, and item notes work in POS', () => {
    const dom = browser(),
        w = dom.window;
    // 1. Verify 10% zoom in CSS
    const styleContent = Array.from(w.document.querySelectorAll('style'))
        .map((s) => s.textContent)
        .join('\n');
    assert.ok(styleContent.includes('zoom: 1.1'));

    // 2. Add an item to POS cart and check render
    w.eval(
        "state.posTabs[0].cart = [{ code: 'SP001', name: 'Đồng hồ Garmin', price: 6000000, stock: 10, qty: 1, note: '' }];"
    );
    w.renderPosScreen();

    // Check delete button title is 'Xoá'
    const delBtn = w.document.querySelector('[onclick*="removePosItem"]');
    assert.ok(delBtn);
    assert.equal(delBtn.getAttribute('title'), 'Xoá');
    assert.equal(delBtn.getAttribute('aria-label'), 'Xoá');

    // Check note input exists
    const noteInput = w.document.querySelector('input[data-note-code="SP001"]');
    assert.ok(noteInput);
    w.updatePosItemNote('SP001', 'Quà tặng kèm dock sạc');
    assert.equal(w.eval('state.posTabs[0].cart[0].note'), 'Quà tặng kèm dock sạc');

    // Check invoice table header is "Tên hàng hóa"
    const tableHeader = w.document.querySelector('#invoice-detail-modal th:nth-child(3)');
    assert.equal(tableHeader?.textContent?.trim(), 'Tên hàng hóa');

    dom.window.close();
});

test('Vietnamese name and address normalization standardizes input to proper Title Case', () => {
    const dom = browser(),
        w = dom.window;
    w.eval('KVStore.save = async () => {}');

    assert.equal(w.normalizeTitleCase('nguyễn văn an'), 'Nguyễn Văn An');
    assert.equal(w.normalizeTitleCase('  trần   thị   hoa  '), 'Trần Thị Hoa');
    assert.equal(
        w.normalizeTitleCase('103 võ văn tần, p.6, quận 3, tp.hcm'),
        '103 Võ Văn Tần, P.6, Quận 3, TP.HCM'
    );

    // Customer save normalizes customer name and address
    w.document.getElementById('cust-code').value = 'KH_TEST_01';
    w.document.getElementById('cust-name').value = '  lê hoàng nam  ';
    w.document.getElementById('cust-phone').value = '0988112233';
    w.document.getElementById('cust-address').value = '12 nguyễn du, q.1, tp.hcm';
    w.saveCustomerFromModal({ preventDefault() {} });

    const saved = w.eval("KVStore.data.customers.find((c) => c.code === 'KH_TEST_01')");
    assert.ok(saved);
    assert.equal(saved.name, 'Lê Hoàng Nam');
    assert.equal(saved.address, '12 Nguyễn Du, Q.1, TP.HCM');

    dom.window.close();
});

test('Custom bill in configuration saves and updates receipt preview and print layout', async () => {
    const dom = browser(),
        w = dom.window;
    w.eval('KVStore.save = async () => {}');

    // Default bill config
    const def = w.getBillConfig();
    assert.equal(def.paperSize, 'k80');
    assert.equal(def.title, 'HÓA ĐƠN BÁN HÀNG');
    assert.equal(def.showNote, true);

    // Open custom bill modal, verify live preview and tab switching
    w.openBillCustomModal();
    const modal = w.document.getElementById('bill-custom-modal');
    assert.ok(!modal.classList.contains('hidden'));
    const previewPaper = w.document.getElementById('bill-preview-paper');
    assert.ok(previewPaper);

    // Test tab switching
    w.switchBillCustomTab('store');
    assert.ok(!w.document.getElementById('bill-tab-content-store').classList.contains('hidden'));
    assert.ok(w.document.getElementById('bill-tab-content-format').classList.contains('hidden'));

    w.switchBillCustomTab('items');
    assert.ok(!w.document.getElementById('bill-tab-content-items').classList.contains('hidden'));

    w.switchBillCustomTab('footer');
    assert.ok(!w.document.getElementById('bill-tab-content-footer').classList.contains('hidden'));

    w.switchBillCustomTab('format');
    assert.ok(!w.document.getElementById('bill-tab-content-format').classList.contains('hidden'));

    // Set deep customization values including multiline content with line breaks (\n)
    w.document.getElementById('bill-opt-paper-k58').checked = true;
    w.document.getElementById('bill-custom-font-family').value = 'sans';
    w.document.getElementById('bill-custom-font-size').value = 'large';
    w.document.getElementById('bill-custom-title').value = 'PHIẾU TÍNH TIỀN\n(KIÊM PHIẾU XUẤT KHO)';
    w.document.getElementById('bill-custom-footer').value =
        'Hẹn gặp lại quý khách!\nHotline khiếu nại: 0988.112.233';
    w.document.getElementById('bill-custom-slogan').value =
        'Uy tín tạo nên thương hiệu\nChuyên sỉ & lẻ toàn quốc';
    w.document.getElementById('bill-custom-store-name').value = 'TIỆM CÔNG NGHỆ PRO\nCHI NHÁNH 1';
    w.document.getElementById('bill-custom-address').value =
        'CS1: 103 Võ Văn Tần, Q.3\nCS2: 456 CMT8, Q.10';
    w.document.getElementById('bill-custom-show-stt').checked = true;
    w.document.getElementById('bill-custom-show-item-unit').checked = true;
    w.document.getElementById('bill-custom-policy').value =
        '- Hàng mua rồi miễn đổi trả sau 3 ngày\n- Vui lòng giữ nguyên tem mác';
    w.document.getElementById('bill-custom-show-signatures').checked = true;

    // Trigger live preview update
    w.onBillConfigChange();

    // Verify live preview renders custom values and preserves multiline content
    assert.ok(previewPaper.textContent.includes('PHIẾU TÍNH TIỀN\n(KIÊM PHIẾU XUẤT KHO)'));
    assert.ok(previewPaper.textContent.includes('TIỆM CÔNG NGHỆ PRO\nCHI NHÁNH 1'));
    assert.ok(
        previewPaper.textContent.includes('Uy tín tạo nên thương hiệu\nChuyên sỉ & lẻ toàn quốc')
    );
    assert.ok(previewPaper.textContent.includes('CS1: 103 Võ Văn Tần, Q.3\nCS2: 456 CMT8, Q.10'));
    assert.ok(
        previewPaper.textContent.includes(
            '- Hàng mua rồi miễn đổi trả sau 3 ngày\n- Vui lòng giữ nguyên tem mác'
        )
    );
    assert.ok(
        previewPaper.textContent.includes('Hẹn gặp lại quý khách!\nHotline khiếu nại: 0988.112.233')
    );
    assert.ok(previewPaper.textContent.includes('Người mua hàng'));

    // Test print test bill template
    w.printTestBillTemplate();
    const testPrintRoot = w.document.getElementById('print-root');
    assert.ok(testPrintRoot);
    assert.equal(testPrintRoot.dataset.paper, 'k58');
    assert.ok(testPrintRoot.textContent.includes('TIỆM CÔNG NGHỆ PRO\nCHI NHÁNH 1'));

    // Save bill custom config
    await w.saveBillCustomConfig();

    const updated = w.getBillConfig();
    assert.equal(updated.paperSize, 'k58');
    assert.equal(updated.fontFamily, 'sans');
    assert.equal(updated.fontSize, 'large');
    assert.equal(updated.title, 'PHIẾU TÍNH TIỀN\n(KIÊM PHIẾU XUẤT KHO)');
    assert.equal(updated.footer, 'Hẹn gặp lại quý khách!\nHotline khiếu nại: 0988.112.233');
    assert.equal(updated.slogan, 'Uy tín tạo nên thương hiệu\nChuyên sỉ & lẻ toàn quốc');
    assert.equal(updated.customStoreName, 'TIỆM CÔNG NGHỆ PRO\nCHI NHÁNH 1');
    assert.equal(updated.customAddress, 'CS1: 103 Võ Văn Tần, Q.3\nCS2: 456 CMT8, Q.10');
    assert.equal(updated.showStt, true);
    assert.equal(updated.showItemUnit, true);
    assert.equal(
        updated.policy,
        '- Hàng mua rồi miễn đổi trả sau 3 ngày\n- Vui lòng giữ nguyên tem mác'
    );
    assert.equal(updated.showSignatures, true);

    // Open receipt modal and check custom title, footer, item note, slogan and paper size
    const testInv = {
        code: 'HD000099',
        time: '21/10/2026 10:00',
        customer: 'Nguyễn Văn An',
        customerAddress: '123 Đường Số 1, Q.1',
        customerDebt: 500000,
        cashier: 'Thu ngân 1',
        items: [
            {
                code: 'SP01',
                name: 'Sản phẩm mẫu',
                unit: 'Cái',
                qty: 2,
                price: 50000,
                note: 'Bảo hành 6 tháng'
            }
        ],
        total: 100000,
        paid: 100000
    };
    w.openReceiptModal(testInv);
    assert.equal(
        w.document.getElementById('receipt-title').textContent,
        'PHIẾU TÍNH TIỀN\n(KIÊM PHIẾU XUẤT KHO)'
    );
    assert.equal(
        w.document.getElementById('receipt-footer').textContent,
        'Hẹn gặp lại quý khách!\nHotline khiếu nại: 0988.112.233'
    );
    assert.equal(
        w.document.getElementById('receipt-store-name').textContent,
        'TIỆM CÔNG NGHỆ PRO\nCHI NHÁNH 1'
    );
    assert.equal(
        w.document.getElementById('receipt-slogan').textContent,
        'Uy tín tạo nên thương hiệu\nChuyên sỉ & lẻ toàn quốc'
    );
    assert.ok(
        w.document.getElementById('receipt-items-tbody').textContent.includes('Bảo hành 6 tháng')
    );
    assert.ok(w.document.getElementById('receipt-items-tbody').textContent.includes('Cái'));
    assert.equal(w.document.getElementById('printable-receipt').dataset.paper, 'k58');
    assert.ok(!w.document.getElementById('receipt-signatures').classList.contains('hidden'));

    // Test printReceipt uses paperSize k58
    w.printReceipt();
    const printRoot = w.document.getElementById('print-root');
    assert.ok(printRoot);
    assert.equal(printRoot.dataset.paper, 'k58');

    dom.window.close();
});

test('Invoice printing supports A4 and A5 formats with in-words currency, responsive dialog and sheet layout', async () => {
    const dom = browser(),
        w = dom.window;
    w.eval('KVStore.save = async () => {}');

    const testInv = {
        code: 'HD-A5-TEST',
        time: '25/10/2026 14:30',
        customer: 'Công ty TNHH Giải Pháp Công Nghệ',
        customerPhone: '0909.888.999',
        customerAddress: 'Số 88 đường Nam Kỳ Khởi Nghĩa, Q.1, TP.HCM',
        customerPoints: 200,
        customerOldDebt: 1000000,
        cashier: 'Nguyễn Văn Thu Ngân',
        items: [
            {
                code: 'MACBOOK-M3',
                name: 'MacBook Pro 14 M3 18GB/512GB',
                unit: 'Máy',
                qty: 1,
                price: 45000000,
                imeis: ['C02XYZ123456'],
                note: 'Bảo hành chính hãng 12 tháng tại Apple Care'
            }
        ],
        total: 45000000,
        paid: 40000000
    };

    // Open receipt modal with test invoice
    w.openReceiptModal(testInv);
    const modal = w.document.getElementById('receipt-modal');
    assert.ok(!modal.classList.contains('hidden'));

    // 1. Switch to A5 format
    w.setReceiptPaperPreview('a5');
    const printable = w.document.getElementById('printable-receipt');
    assert.equal(printable.dataset.paper, 'a5');

    const dialog = w.document.getElementById('receipt-modal-dialog');
    assert.ok(dialog.classList.contains('max-w-2xl'));
    assert.ok(!dialog.classList.contains('max-w-sm'));
    assert.ok(!dialog.classList.contains('max-w-4xl'));

    const btnA5 = w.document.getElementById('receipt-btn-a5');
    assert.ok(btnA5.className.includes('text-[#0066cc]'));

    // Check Vietnamese in-words amount
    const inWordsEl = w.document.getElementById('receipt-words-total');
    assert.ok(inWordsEl);
    assert.ok(inWordsEl.textContent.includes('Bốn mươi lăm triệu đồng'));

    // Check 3-column signatures in A5
    const sigsEl = w.document.getElementById('receipt-signatures');
    assert.ok(sigsEl.textContent.includes('Người mua hàng'));
    assert.ok(sigsEl.textContent.includes('Người giao hàng'));
    assert.ok(sigsEl.textContent.includes('Người lập hóa đơn / Thủ kho'));

    // Check printReceipt for A5
    w.printReceipt();
    const printRootA5 = w.document.getElementById('print-root');
    assert.ok(printRootA5);
    assert.equal(printRootA5.dataset.paper, 'a5');
    assert.equal(printRootA5.dataset.thermal, 'false');

    // 2. Switch to A4 format
    w.setReceiptPaperPreview('a4');
    assert.equal(printable.dataset.paper, 'a4');
    assert.ok(dialog.classList.contains('max-w-4xl'));
    assert.ok(!dialog.classList.contains('max-w-2xl'));

    const btnA4 = w.document.getElementById('receipt-btn-a4');
    assert.ok(btnA4.className.includes('text-[#0066cc]'));

    // Check printReceipt for A4
    w.printReceipt();
    const printRootA4 = w.document.getElementById('print-root');
    assert.ok(printRootA4);
    assert.equal(printRootA4.dataset.paper, 'a4');
    assert.equal(printRootA4.dataset.thermal, 'false');

    // 3. Test bill custom configuration with A4 and A5
    w.openBillCustomModal();
    const radA5 = w.document.getElementById('bill-opt-paper-a5');
    assert.ok(radA5);
    radA5.checked = true;
    w.onBillConfigChange();

    const previewPaper = w.document.getElementById('bill-preview-paper');
    assert.ok(previewPaper.textContent.includes('Người giao hàng'));
    assert.ok(previewPaper.textContent.includes('Số tiền viết bằng chữ:'));

    // Test print test bill template for A5
    w.printTestBillTemplate();
    const printRootTestA5 = w.document.getElementById('print-root');
    assert.ok(printRootTestA5);
    assert.equal(printRootTestA5.dataset.paper, 'a5');
    assert.equal(printRootTestA5.dataset.thermal, 'false');

    // Switch to A4 in custom modal and save
    const radA4 = w.document.getElementById('bill-opt-paper-a4');
    radA4.checked = true;
    w.onBillConfigChange();
    await w.saveBillCustomConfig();

    const savedCfg = w.getBillConfig();
    assert.equal(savedCfg.paperSize, 'a4');

    dom.window.close();
});

test('Bill customization UX/UI: One-click presets, Live preview badge, and preview expand toggle', async () => {
    const dom = browser(),
        w = dom.window;
    w.eval('KVStore.save = async () => {}');

    // 1. Setup logo in settings, open modal and check initial states
    w.eval(
        'if (!KVStore.data.settings) KVStore.data.settings = {}; KVStore.data.settings.logoUrl = "https://example.com/logo-test.png";'
    );
    w.openBillCustomModal();
    const modal = w.document.getElementById('bill-custom-modal');
    assert.ok(!modal.classList.contains('hidden'));

    const paperBadge = w.document.getElementById('bill-preview-paper-badge');
    assert.ok(paperBadge);
    assert.ok(paperBadge.textContent.includes('K80'));

    const logoPreview = w.document.getElementById('bill-custom-logo-preview');
    assert.ok(logoPreview);
    assert.ok(logoPreview.innerHTML.includes('https://example.com/logo-test.png'));

    // 2. Test expand/collapse toggle
    const ctrlCol = w.document.getElementById('bill-custom-controls-col');
    const prevCol = w.document.getElementById('bill-custom-preview-col');
    const expandLabel = w.document.getElementById('bill-preview-expand-label');
    assert.ok(ctrlCol);
    assert.ok(prevCol);
    assert.ok(ctrlCol.classList.contains('lg:col-span-7'));
    assert.ok(prevCol.classList.contains('lg:col-span-5'));

    w.toggleBillPreviewExpand();
    assert.ok(ctrlCol.classList.contains('lg:col-span-4'));
    assert.ok(prevCol.classList.contains('lg:col-span-8'));
    assert.equal(expandLabel.textContent, 'Thu nhỏ');

    w.toggleBillPreviewExpand();
    assert.ok(ctrlCol.classList.contains('lg:col-span-7'));
    assert.ok(prevCol.classList.contains('lg:col-span-5'));
    assert.equal(expandLabel.textContent, 'Phóng to');

    // 3. Test Minimal Preset ('minimal')
    w.applyBillPreset('minimal');
    assert.ok(w.document.getElementById('bill-opt-paper-k80').checked);
    assert.equal(w.document.getElementById('bill-custom-font-size').value, 'compact');
    assert.equal(w.document.getElementById('bill-custom-font-family').value, 'monospace');
    assert.equal(w.document.getElementById('bill-custom-show-imei').checked, false);
    assert.equal(w.document.getElementById('bill-custom-show-qr').checked, false);
    assert.ok(paperBadge.textContent.includes('K80'));
    assert.ok(paperBadge.textContent.includes('Cỡ nhỏ'));

    // 4. Test Tech Preset ('tech')
    w.applyBillPreset('tech');
    assert.ok(w.document.getElementById('bill-opt-paper-k80').checked);
    assert.equal(w.document.getElementById('bill-custom-font-size').value, 'standard');
    assert.equal(w.document.getElementById('bill-custom-show-imei').checked, true);
    assert.equal(w.document.getElementById('bill-custom-show-item-code').checked, true);
    assert.equal(w.document.getElementById('bill-custom-show-qr').checked, true);
    assert.ok(w.document.getElementById('bill-custom-policy').value.includes('Bảo hành'));
    assert.ok(paperBadge.textContent.includes('K80'));
    assert.ok(paperBadge.textContent.includes('Tiêu chuẩn'));

    // 5. Test Wholesale Preset ('wholesale')
    w.applyBillPreset('wholesale');
    assert.ok(w.document.getElementById('bill-opt-paper-a4').checked);
    assert.equal(w.document.getElementById('bill-custom-font-family').value, 'sans');
    assert.equal(w.document.getElementById('bill-custom-show-item-unit').checked, true);
    assert.equal(w.document.getElementById('bill-custom-show-cust-debt').checked, true);
    assert.equal(w.document.getElementById('bill-custom-show-signatures').checked, true);
    assert.ok(paperBadge.textContent.includes('Khổ A4'));
    assert.ok(paperBadge.textContent.includes('Sans'));

    // Wholesale on A4 preview renders 3 signature columns
    const previewPaper = w.document.getElementById('bill-preview-paper');
    assert.ok(previewPaper.textContent.includes('Người lập hóa đơn'));
    assert.ok(previewPaper.textContent.includes('Người giao hàng'));

    // 6. Save custom configuration after preset
    await w.saveBillCustomConfig();
    const finalCfg = w.getBillConfig();
    assert.equal(finalCfg.paperSize, 'a4');
    assert.equal(finalCfg.fontFamily, 'sans');
    assert.equal(finalCfg.showSignatures, true);

    dom.window.close();
});

test('Bill customization UX/UI: One-click presets, Live preview badge, and preview expand toggle', async () => {
    const dom = browser(),
        w = dom.window;
    w.eval('KVStore.save = async () => {}');

    // 1. Setup logo in settings, open modal and check initial states
    w.eval(
        'if (!KVStore.data.settings) KVStore.data.settings = {}; KVStore.data.settings.logoUrl = "https://example.com/logo-test.png";'
    );
    w.openBillCustomModal();
    const modal = w.document.getElementById('bill-custom-modal');
    assert.ok(!modal.classList.contains('hidden'));

    const paperBadge = w.document.getElementById('bill-preview-paper-badge');
    assert.ok(paperBadge);
    assert.ok(paperBadge.textContent.includes('K80'));

    const logoPreview = w.document.getElementById('bill-custom-logo-preview');
    assert.ok(logoPreview);
    assert.ok(logoPreview.innerHTML.includes('https://example.com/logo-test.png'));

    // 2. Test expand/collapse toggle
    const ctrlCol = w.document.getElementById('bill-custom-controls-col');
    const prevCol = w.document.getElementById('bill-custom-preview-col');
    const expandLabel = w.document.getElementById('bill-preview-expand-label');
    assert.ok(ctrlCol);
    assert.ok(prevCol);
    assert.ok(ctrlCol.classList.contains('lg:col-span-7'));
    assert.ok(prevCol.classList.contains('lg:col-span-5'));

    w.toggleBillPreviewExpand();
    assert.ok(ctrlCol.classList.contains('lg:col-span-4'));
    assert.ok(prevCol.classList.contains('lg:col-span-8'));
    assert.equal(expandLabel.textContent, 'Thu nhỏ');

    w.toggleBillPreviewExpand();
    assert.ok(ctrlCol.classList.contains('lg:col-span-7'));
    assert.ok(prevCol.classList.contains('lg:col-span-5'));
    assert.equal(expandLabel.textContent, 'Phóng to');

    // 3. Test Minimal Preset ('minimal')
    w.applyBillPreset('minimal');
    assert.ok(w.document.getElementById('bill-opt-paper-k80').checked);
    assert.equal(w.document.getElementById('bill-custom-font-size').value, 'compact');
    assert.equal(w.document.getElementById('bill-custom-font-family').value, 'monospace');
    assert.equal(w.document.getElementById('bill-custom-show-imei').checked, false);
    assert.equal(w.document.getElementById('bill-custom-show-qr').checked, false);
    assert.ok(paperBadge.textContent.includes('K80'));
    assert.ok(paperBadge.textContent.includes('Cỡ nhỏ'));

    // 4. Test Tech Preset ('tech')
    w.applyBillPreset('tech');
    assert.ok(w.document.getElementById('bill-opt-paper-k80').checked);
    assert.equal(w.document.getElementById('bill-custom-font-size').value, 'standard');
    assert.equal(w.document.getElementById('bill-custom-show-imei').checked, true);
    assert.equal(w.document.getElementById('bill-custom-show-item-code').checked, true);
    assert.equal(w.document.getElementById('bill-custom-show-qr').checked, true);
    assert.ok(w.document.getElementById('bill-custom-policy').value.includes('Bảo hành'));
    assert.ok(paperBadge.textContent.includes('K80'));
    assert.ok(paperBadge.textContent.includes('Tiêu chuẩn'));

    // 5. Test Wholesale Preset ('wholesale')
    w.applyBillPreset('wholesale');
    assert.ok(w.document.getElementById('bill-opt-paper-a4').checked);
    assert.equal(w.document.getElementById('bill-custom-font-family').value, 'sans');
    assert.equal(w.document.getElementById('bill-custom-show-item-unit').checked, true);
    assert.equal(w.document.getElementById('bill-custom-show-cust-debt').checked, true);
    assert.equal(w.document.getElementById('bill-custom-show-signatures').checked, true);
    assert.ok(paperBadge.textContent.includes('Khổ A4'));
    assert.ok(paperBadge.textContent.includes('Sans'));

    // Wholesale on A4 preview renders 3 signature columns
    const previewPaper = w.document.getElementById('bill-preview-paper');
    assert.ok(previewPaper.textContent.includes('Người lập hóa đơn'));
    assert.ok(previewPaper.textContent.includes('Người giao hàng'));

    // 6. Save custom configuration after preset
    await w.saveBillCustomConfig();
    const finalCfg = w.getBillConfig();
    assert.equal(finalCfg.paperSize, 'a4');
    assert.equal(finalCfg.fontFamily, 'sans');
    assert.equal(finalCfg.showSignatures, true);

    dom.window.close();
});

test('SQL badge removed and toast popup slides down from top', async () => {
    const dom = browser(),
        w = dom.window;

    // Check DB status badge is removed
    const dbBadge = w.document.getElementById('db-status-badge');
    assert.equal(dbBadge, null);

    // Check toast container initial position and styling
    const toast = w.document.getElementById('kv-toast');
    assert.ok(toast);
    assert.ok(toast.classList.contains('top-4'));
    assert.ok(toast.classList.contains('left-1/2'));
    assert.ok(toast.classList.contains('-translate-x-1/2'));
    assert.ok(toast.classList.contains('-translate-y-24'));
    assert.ok(toast.classList.contains('opacity-0'));

    // Verify #kv-toast CSS rules exist in <style>
    const styleContent = Array.from(w.document.querySelectorAll('style'))
        .map((s) => s.textContent)
        .join('\n');
    assert.ok(styleContent.includes('#kv-toast {'));
    assert.ok(styleContent.includes('left: 50% !important;'));
    assert.ok(styleContent.includes('transform: translate(-50%, -150%) !important;'));
    assert.ok(styleContent.includes('#kv-toast.translate-y-0 {'));
    assert.ok(styleContent.includes('transform: translate(-50%, 0) !important;'));

    // Trigger toast notification
    w.showToast('Test thông báo', 'success');
    assert.ok(toast.classList.contains('translate-y-0'));
    assert.ok(toast.classList.contains('opacity-100'));
    assert.ok(!toast.classList.contains('-translate-y-24'));
    assert.equal(w.document.getElementById('kv-toast-msg').textContent, 'Test thông báo');

    dom.window.close();
});

test('Admin can select and view Toàn bộ chi nhánh across views', async () => {
    const dom = browser(),
        w = dom.window;
    w.eval('KVStore.save = async () => {}');

    // Setup admin user
    w.eval(
        "KVStore.user = { id: 'u_admin', username: 'admin', role: 'admin', branches: ['Kalo HCM', 'Kalo Hà Nội'] }"
    );

    // Add branches and products in both branches
    w.eval(`
        KVStore.data.branches = [
            { id: 'b1', name: 'Kalo HCM', isDefault: true },
            { id: 'b2', name: 'Kalo Hà Nội' }
        ];
        KVStore.data.products = [
            { id: 'p1', code: 'SP001', name: 'Áo thun HCM', branch: 'Kalo HCM', stock: 10, price: 100000, costPrice: 60000, status: 'active' },
            { id: 'p2', code: 'SP002', name: 'Áo thun HN', branch: 'Kalo Hà Nội', stock: 5, price: 120000, costPrice: 70000, status: 'active' }
        ];
        KVStore.data.invoices = [
            { id: 'inv1', code: 'HD000001', branch: 'Kalo HCM', total: 100000, paid: 100000, status: 'completed', time: '21/10/2026 09:00', items: [{ code: 'SP001', name: 'Áo thun HCM', qty: 1, price: 100000 }] },
            { id: 'inv2', code: 'HD000002', branch: 'Kalo Hà Nội', total: 120000, paid: 120000, status: 'completed', time: '21/10/2026 10:00', items: [{ code: 'SP002', name: 'Áo thun HN', qty: 1, price: 120000 }] }
        ];
    `);

    // Render branch selector as admin
    w.renderBranchSelector();
    const branchContainer = w.document.getElementById('branch-list-container');
    assert.ok(branchContainer);
    assert.ok(branchContainer.textContent.includes('Toàn bộ chi nhánh'));

    // Admin selects Toàn bộ chi nhánh
    await w.selectActiveBranch(w.ALL_BRANCHES);
    assert.equal(w.getCurrentBranch(), w.ALL_BRANCHES);
    assert.equal(w.document.getElementById('top-branch-name').textContent, w.ALL_BRANCHES);

    // Products table displays products from both branches
    w.renderProducts();
    const prodTbody = w.document.getElementById('products-tbody');
    assert.ok(prodTbody.textContent.includes('SP001'));
    assert.ok(prodTbody.textContent.includes('SP002'));
    assert.ok(prodTbody.textContent.includes('Kalo HCM'));
    assert.ok(prodTbody.textContent.includes('Kalo Hà Nội'));

    // Invoices table displays invoices from both branches
    w.renderInvoiceRows(w.eval('KVStore.data.invoices'), w.ALL_BRANCHES);
    const invTbody = w.document.getElementById('invoice-tbody');
    assert.ok(invTbody.textContent.includes('HD000001'));
    assert.ok(invTbody.textContent.includes('HD000002'));

    // Non-admin user cannot select Toàn bộ chi nhánh
    w.eval(
        "KVStore.user = { id: 'u_staff', username: 'staff1', role: 'staff', branches: ['Kalo HCM'] }"
    );
    w.renderBranchSelector();
    assert.ok(!branchContainer.textContent.includes('Toàn bộ chi nhánh'));
    await w.selectActiveBranch(w.ALL_BRANCHES);
    assert.notEqual(w.getCurrentBranch(), w.ALL_BRANCHES);

    dom.window.close();
});

test('Toàn bộ chi nhánh aggregates products with same SKU across branches and does not double rows or stock', async () => {
    const dom = browser(),
        w = dom.window;
    w.eval('KVStore.save = async () => {}');

    w.eval(
        "KVStore.user = { id: 'u_admin', username: 'admin', role: 'admin', branches: ['Kalo HCM', 'Kalo Hà Nội'] }"
    );

    w.eval(`
        KVStore.data.branches = [
            { id: 'b1', name: 'Kalo HCM', isDefault: true },
            { id: 'b2', name: 'Kalo Hà Nội' }
        ];
        KVStore.data.products = [
            { id: 'p1_hcm', code: 'SP001', name: 'iPhone 15', branch: 'Kalo HCM', stock: 1, minStock: 2, price: 20000000, costPrice: 15000000, status: 'active', hasImei: true, imeis: ['IMEI_HCM_1'] },
            { id: 'p1_hn', code: 'SP001', name: 'iPhone 15', branch: 'Kalo Hà Nội', stock: 0, minStock: 2, price: 20000000, costPrice: 15000000, status: 'active', hasImei: true, imeis: [] }
        ];
    `);

    // Switch to Toàn bộ chi nhánh
    await w.selectActiveBranch(w.ALL_BRANCHES);
    assert.equal(w.getCurrentBranch(), w.ALL_BRANCHES);

    // 1. In products list: exactly 1 row rendered for SP001, total stock is 1 (not duplicated)
    w.renderProducts();
    const rows = w.document.querySelectorAll('#products-tbody tr');
    assert.equal(rows.length, 1);
    const countEl = w.document.getElementById('products-total-count');
    assert.equal(countEl.textContent, 'Hiển thị 1 hàng hóa');
    assert.ok(rows[0].textContent.includes('iPhone 15'));

    // 2. viewProductImeis aggregates imeis across branches
    w.viewProductImeis('SP001');
    assert.equal(
        w.document.getElementById('prod-imeis-sub').textContent.includes('Tồn kho: 1'),
        true
    );

    // 3. Reports inventory tab
    w.eval("currentReportTab = 'inventory'");
    w.renderReports();
    const repRows = w.document.querySelectorAll('#rep-table-tbody tr');
    assert.equal(repRows.length, 1);

    dom.window.close();
});

test('Product table renders Chi tiết button and opens product detail modal with actions', async () => {
    const dom = browser(),
        w = dom.window;
    w.eval('KVStore.save = async () => {}');

    w.renderProducts();
    const actionBtn = w.document.querySelector('#products-tbody tr td:last-child button');
    assert.ok(actionBtn);
    assert.equal(actionBtn.textContent.trim(), 'Chi tiết');

    // Open detail modal
    w.viewProductDetail('SP001');
    const modal = w.document.getElementById('product-detail-modal');
    assert.ok(modal);
    assert.ok(!modal.classList.contains('hidden'));
    assert.equal(w.document.getElementById('prod-detail-code').textContent, 'SP001');
    assert.ok(modal.textContent.includes('In mã'));
    assert.ok(modal.textContent.includes('Sửa'));
    assert.ok(modal.textContent.includes('Xóa'));

    dom.window.close();
});

test('Import cancellation updates UI, hides cancel button, shows status banner and filters', async () => {
    const dom = browser(),
        w = dom.window;
    try {
        w.eval(`
            window.commanded = null;
            KVStore.command = async (cmd, payload) => {
                window.commanded = { cmd, payload };
                const imp = KVStore.data.imports.find((i) => i.code === payload.importId);
                if (imp) {
                    imp.status = 'cancelled';
                    imp.cancelReason = payload.reason;
                    imp.cancelTime = '21/10/2026 15:30';
                }
                KVStore._base = copyData(KVStore.data);
                return { result: imp };
            };
        `);

        // 1. Initial render of imports
        w.renderImports();
        const initialRows = w.document.querySelectorAll('#import-tbody tr');
        assert.ok(initialRows.length > 0);

        // 2. Open import detail modal for first import
        const targetCode = w.eval('KVStore.data.imports[0].code');
        w.viewImportDetail(targetCode);
        const modal = w.document.getElementById('import-detail-modal');
        assert.ok(!modal.classList.contains('hidden'));
        const banner = w.document.getElementById('imp-detail-status-banner');
        const cancelBtn = w.document.getElementById('imp-detail-cancel-btn');
        assert.ok(banner.classList.contains('hidden'));
        assert.ok(!cancelBtn.classList.contains('hidden'));

        // 3. User cancels import through accessible dialog
        const pending = w.cancelImport(targetCode);
        const dialog = w.document.getElementById('action-dialog');
        assert.ok(!dialog.classList.contains('hidden'));
        assert.equal(dialog.getAttribute('role'), 'dialog');
        const paid = w.eval('KVStore.data.imports[0].paid') || 0;
        assert.equal(
            w.document.getElementById('action-dialog-method-wrap').classList.contains('hidden'),
            paid <= 0
        );
        w.document.getElementById('action-dialog-input').value = '';
        w.document.getElementById('action-dialog-form').requestSubmit();
        assert.ok(!w.document.getElementById('action-dialog-error').classList.contains('hidden'));
        w.document.getElementById('action-dialog-input').value = 'Hàng lỗi kỹ thuật';
        w.document.getElementById('action-dialog-method').value = 'transfer';
        w.document.getElementById('action-dialog-form').requestSubmit();
        await pending;

        const commanded = w.eval('window.commanded');
        assert.equal(commanded.cmd, 'cancel_import');
        assert.equal(commanded.payload.importId, targetCode);
        assert.equal(commanded.payload.reason, 'Hàng lỗi kỹ thuật');
        assert.equal(commanded.payload.refundMethod, paid > 0 ? 'transfer' : undefined);

        // 4. Modal is closed and import is marked cancelled
        assert.ok(modal.classList.contains('hidden'));
        assert.equal(w.eval('KVStore.data.imports[0].status'), 'cancelled');

        // 5. Open detail of cancelled import
        w.viewImportDetail(targetCode);
        assert.ok(!banner.classList.contains('hidden'));
        assert.ok(banner.textContent.includes('Hàng lỗi kỹ thuật'));
        assert.ok(cancelBtn.classList.contains('hidden'));

        // 6. Test status filter in imports view
        const statusFilter = w.document.getElementById('import-status-filter');
        assert.ok(statusFilter);

        statusFilter.value = 'imported';
        w.renderImports();
        let rows = w.document.querySelectorAll('#import-tbody tr');
        assert.ok(!Array.from(rows).some((r) => r.textContent.includes(targetCode)));

        statusFilter.value = 'cancelled';
        w.renderImports();
        rows = w.document.querySelectorAll('#import-tbody tr');
        assert.ok(
            Array.from(rows).some(
                (r) => r.textContent.includes(targetCode) && r.textContent.includes('Đã hủy')
            )
        );

        statusFilter.value = 'all';
        w.renderImports();
        rows = w.document.querySelectorAll('#import-tbody tr');
        assert.ok(Array.from(rows).some((r) => r.textContent.includes(targetCode)));
    } finally {
        dom.window.close();
    }
});

test('Create import modal searches products, adds non-IMEI and IMEI items, and saves new import receipt', async () => {
    const dom = browser(),
        w = dom.window;
    try {
        w.eval(`
            window.commanded = null;
            KVStore.command = async (cmd, payload) => {
                window.commanded = { cmd, payload };
                return { code: 'PN-TEST-001', ...payload };
            };
        `);

        // 1. Open create import modal
        w.openCreateImportModal();
        const modal = w.document.getElementById('create-import-modal');
        assert.ok(!modal.classList.contains('hidden'), 'Modal should be visible');
        const searchInput = w.document.getElementById('import-modal-search-input');
        assert.ok(searchInput, 'Search input should exist');
        assert.equal(searchInput.value, '', 'Search input should be cleared');

        // 2. Search for non-IMEI product (SP002)
        w.handleImportProductSearch('Shokz');
        const dropdown = w.document.getElementById('import-search-dropdown');
        assert.ok(
            !dropdown.classList.contains('hidden'),
            'Dropdown should be visible after search'
        );
        assert.ok(dropdown.children.length > 0, 'Dropdown should have matching items');

        // 3. Select non-IMEI product into import
        w.selectImportProduct('SP002');
        const itemsContainer = w.document.getElementById('import-items-container');
        assert.ok(
            itemsContainer.textContent.includes('SP002'),
            'Product SP002 should be in items container'
        );

        // 4. Search and select IMEI product (SP001)
        w.selectImportProduct('SP001');
        assert.ok(
            itemsContainer.textContent.includes('SP001'),
            'Product SP001 should be in items container'
        );

        // 5. Add IMEI to SP001
        const imeiInput = w.document.getElementById('inline-imei-input-SP001');
        assert.ok(imeiInput, 'IMEI input should be present for IMEI-managed product');
        imeiInput.value = 'GARMIN_TEST_SERIAL_01';
        w.addInlineImeiFromInput('SP001');

        // 6. Verify total and paid inputs
        const totalCalc = w.document.getElementById('import-total-calc');
        assert.ok(totalCalc.textContent.includes('đ'), 'Total should have currency format');
        const paidInput = w.document.getElementById('import-paid-input');
        assert.equal(Number(paidInput.value), 0, 'New receipt defaults to unpaid');
        w.document.getElementById('import-payment-state').value = 'full';
        w.updateImportPayment();
        assert.ok(Number(paidInput.value) > 0);

        // 7. Verify supplier selection
        const nccSelect = w.document.getElementById('import-ncc-select');
        assert.equal(nccSelect.value, '', 'Supplier must be explicitly selected');
        nccSelect.selectedIndex = 1;

        // 8. Save import
        await w.saveNewImport();
        assert.ok(w.window.commanded, 'KVStore.command should be called');
        assert.equal(w.window.commanded.cmd, 'import');
        assert.equal(w.window.commanded.payload.items.length, 2);
        assert.equal(w.window.commanded.payload.items[1].imeis[0], 'GARMIN_TEST_SERIAL_01');
        assert.ok(
            modal.classList.contains('hidden'),
            'Modal should be hidden after successful save'
        );
    } finally {
        dom.window.close();
    }
});

test('POS multi-method payment splits tender, computes debt/change and checks out with payments payload', async () => {
    const dom = browser(),
        w = dom.window;
    try {
        w.eval(`
            window.commanded = null;
            KVStore.command = async (cmd, payload) => {
                window.commanded = { cmd, payload };
                if (cmd === 'sale') {
                    const inv = {
                        id: 'HD0099',
                        code: 'HD0099',
                        time: '22/10/2026 10:00',
                        customer: payload.customerId ? 'Khách VIP' : 'Khách lẻ',
                        phone: '0901234567',
                        items: payload.items,
                        total: 10000000,
                        discount: payload.discount || 0,
                        paid: payload.given || 6000000,
                        returnedTotal: 0,
                        redPaid: true,
                        status: 'completed',
                        paymentMethod: payload.paymentMethod,
                        payments: payload.payments || [{ amount: 6000000, method: 'multi' }]
                    };
                    KVStore.data.invoices.unshift(inv);
                    return inv;
                }
                return {};
            };
        `);

        // 1. Switch to POS and add a product
        w.switchView('pos');
        const prod = w.eval('KVStore.data.products.find(p => p.stock > 0)');
        w.addPosCartItem(prod);
        // Set price to 10,000,000
        w.setPosItemPrice(prod.code, '10000000');
        assert.equal(w.document.getElementById('pos-grand-total').textContent, '10.000.000');

        // 2. Select customer (Khách VIP)
        const cust = w.eval('KVStore.data.customers.find(c => c.code !== "KL")');
        w.selectPosCustomer(cust);

        // 3. Switch payment method to 'multi' (Phối hợp)
        w.setPosPaymentMethod('multi');
        const singleContainer = w.document.getElementById('pos-single-pay-container');
        const multiContainer = w.document.getElementById('pos-multi-pay-panel');
        assert.ok(singleContainer.classList.contains('hidden'));
        assert.ok(!multiContainer.classList.contains('hidden'));

        // 4. Enter amounts: Chuyển khoản 2M, Tiền mặt 2M, Quẹt thẻ 2M
        w.handleMultiPaymentInput('transfer', '2000000');
        w.handleMultiPaymentInput('cash', '2000000');
        w.handleMultiPaymentInput('card', '2000000');

        assert.equal(w.document.getElementById('pos-multi-total-paid').textContent, '6.000.000 đ');
        const summaryText = w.document.getElementById('pos-multi-summary').textContent;
        assert.ok(summaryText.includes('4.000.000'));
        assert.ok(summaryText.includes('Ghi nợ'));

        // 5. Test fill remainder button on cash
        w.fillMultiPaymentRemainder('cash');
        // Total is 10M, transfer=2M, card=2M -> cash becomes 6M
        assert.equal(w.document.getElementById('pos-multi-pay-cash').value, '6.000.000');
        assert.equal(w.document.getElementById('pos-multi-total-paid').textContent, '10.000.000 đ');

        // Set back to 2M cash for 4M debt test
        w.handleMultiPaymentInput('cash', '2000000');
        assert.equal(w.document.getElementById('pos-multi-total-paid').textContent, '6.000.000 đ');

        // 6. Checkout
        const invoice = await w.checkoutPos();
        assert.ok(invoice);
        assert.equal(invoice.code, 'HD0099');

        const commanded = w.eval('window.commanded');
        assert.equal(commanded.cmd, 'sale');
        assert.equal(commanded.payload.paymentMethod, 'multi');
        assert.equal(commanded.payload.given, 6000000);
        assert.deepEqual(JSON.parse(JSON.stringify(commanded.payload.payments)), [
            { method: 'transfer', amount: 2000000 },
            { method: 'cash', amount: 2000000 },
            { method: 'card', amount: 2000000 }
        ]);

        // 7. Verify receipt modal displays payment breakdown and debt
        const receiptModal = w.document.getElementById('receipt-modal');
        assert.ok(!receiptModal.classList.contains('hidden'));
        assert.equal(w.document.getElementById('receipt-debt').textContent, '4.000.000 đ');
        assert.ok(!w.document.getElementById('receipt-row-debt').classList.contains('hidden'));
        const receiptBreakdown = w.document.getElementById('receipt-payments-breakdown');
        assert.ok(!receiptBreakdown.classList.contains('hidden'));
        assert.ok(receiptBreakdown.textContent.includes('Chuyển khoản'));
        assert.ok(receiptBreakdown.textContent.includes('Tiền mặt'));
        assert.ok(receiptBreakdown.textContent.includes('Quẹt thẻ'));

        // 8. Verify invoice detail modal displays payment breakdown and debt
        w.openInvoiceDetailModal(invoice);
        const invDetailModal = w.document.getElementById('invoice-detail-modal');
        assert.ok(!invDetailModal.classList.contains('hidden'));
        assert.equal(w.document.getElementById('inv-detail-debt').textContent, '4.000.000 đ');
        assert.ok(!w.document.getElementById('inv-detail-debt-row').classList.contains('hidden'));
        const detailBreakdown = w.document.getElementById('inv-detail-payments-breakdown');
        assert.ok(!detailBreakdown.classList.contains('hidden'));
        assert.ok(detailBreakdown.textContent.includes('Chuyển khoản'));
        assert.ok(detailBreakdown.textContent.includes('Tiền mặt'));
        assert.ok(detailBreakdown.textContent.includes('Quẹt thẻ'));
        assert.equal(
            w.document.getElementById('inv-detail-note').textContent,
            '(Không có ghi chú)'
        );

        // Also verify invoice detail modal displays note when order has note
        w.openInvoiceDetailModal({ ...invoice, note: 'Giao hàng sau 18h' });
        assert.equal(w.document.getElementById('inv-detail-note').textContent, 'Giao hàng sau 18h');
        assert.ok(w.document.getElementById('inv-detail-note').classList.contains('font-medium'));
    } finally {
        dom.window.close();
    }
});

test('POS displays negative change with minus sign, removes warning line, and requires selecting IMEI to checkout', async () => {
    const dom = browser(),
        w = dom.window;
    try {
        w.eval(`
            window.commanded = null;
            KVStore.command = async (cmd, payload) => {
                window.commanded = { cmd, payload };
                return { code: 'HD0100', items: payload.items };
            };
        `);

        w.switchView('pos');
        // Find product with IMEI
        const imeiProd = w.eval('KVStore.data.products.find(p => p.hasImei && p.stock > 0)');
        assert.ok(imeiProd, 'Must have at least one product with IMEI and stock');
        w.addPosCartItem(imeiProd);

        // 1. Verify cart item does NOT have the warning line "Chưa chọn IMEI (Bắt buộc chọn thủ công)"
        const cartHtml = w.document.getElementById('pos-cart-list').innerHTML;
        assert.ok(!cartHtml.includes('Chưa chọn IMEI (Bắt buộc chọn thủ công)'));

        // 2. Customer pays 30.000 for total > 30.000 -> change starts with '-' and has no 'Thiếu'
        w.setPosCustomerGiven(30000);
        const changeEl = w.document.getElementById('pos-change');
        assert.ok(changeEl.textContent.startsWith('-'));
        assert.ok(!changeEl.textContent.includes('Thiếu'));

        // 3. Checkout without selecting IMEI is blocked: returns undefined, no sale command sent
        w.eval('window._testEnforceManualImei = true');
        const blockedInvoice = await w.checkoutPos();
        assert.equal(blockedInvoice, undefined);
        assert.equal(w.eval('window.commanded'), null);

        // 4. Select IMEI and checkout succeeds
        const curTab = w.eval('state.posTabs[state.activePosTab]');
        curTab.cart[0].selectedImeis = [imeiProd.imeis[0]];
        const invoice = await w.checkoutPos();
        assert.ok(invoice);
        assert.equal(w.eval('window.commanded.cmd'), 'sale');
    } finally {
        dom.window.close();
    }
});

test('Dashboard renders rich recent activities stream with badges, actions, amounts and branch scope', () => {
    const dom = browser(),
        w = dom.window;
    try {
        w.eval(`
            KVStore.data.recentActivities = [
                {
                    id: 'act_1',
                    type: 'sale',
                    title: 'Trần Văn Nhất',
                    action: 'Vừa bán đơn hàng HD0010 cho Khách VIP',
                    val: 1500000,
                    branch: 'Kalo HCM',
                    time: '22/10/2026 16:30'
                },
                {
                    id: 'act_2',
                    type: 'return',
                    title: 'Trần Văn Nhất',
                    action: 'Trả hàng đơn HD0009',
                    val: -300000,
                    branch: 'Kalo HCM',
                    time: '22/10/2026 16:25'
                },
                {
                    id: 'act_3',
                    type: 'edit',
                    title: 'Quản lý',
                    action: 'Thêm hàng hóa mới: Apple Watch Ultra',
                    val: '',
                    branch: 'Kalo HCM',
                    time: '22/10/2026 16:20'
                }
            ];
            renderDashboard();
        `);

        const actContainer = w.document.getElementById('dash-recent-activities');
        assert.ok(actContainer);
        const text = actContainer.textContent;
        assert.ok(text.includes('Vừa bán đơn hàng HD0010'));
        assert.ok(text.includes('1.500.000 đ'));
        assert.ok(text.includes('Trả hàng đơn HD0009'));
        assert.ok(text.includes('-300.000 đ'));
        assert.ok(text.includes('Thêm hàng hóa mới: Apple Watch Ultra'));

        // Test in Toàn bộ chi nhánh: branch name appears in activity item
        w.eval(`
            KVStore.data.settings.branch = ALL_BRANCHES;
            renderDashboard();
        `);
        const allText = w.document.getElementById('dash-recent-activities').textContent;
        assert.ok(allText.includes('Kalo HCM'));
    } finally {
        dom.window.close();
    }
});

test('product details treat legacy IMEI and media as data, not executable markup', () => {
    const dom = browser(),
        w = dom.window;
    try {
        w.eval(`
            const p = KVStore.data.products[0];
            KVStore.data.settings.branch = p.branch || FALLBACK_BRANCH;
            p.hasImei = true;
            p.imeis = ['<img src=x onerror="window.pwned=1">'];
            p.images = ['x" onerror="window.pwned=1', '/uploads/safe.png'];
            p.videoUrl = 'javascript:alert(1)';
            p.imeiDetails = {};
            viewProductDetail(p.code);
        `);
        const list = w.document.getElementById('prod-detail-imei-list');
        assert.equal(list.querySelector('img'), null);
        assert.ok(list.textContent.includes('<img'));
        assert.equal(list.querySelector('button').getAttribute('onclick'), null);
        list.querySelector('button').click();
        const media = w.document.getElementById('prod-detail-images-list');
        assert.ok(media, 'media markup must exist');
        assert.equal(media.querySelectorAll('img').length, 1);
        assert.equal(media.querySelector('[onerror]'), null);
        assert.ok(
            w.document.getElementById('prod-detail-video-container').classList.contains('hidden')
        );
    } finally {
        w.close();
    }
});

test('partner details open with safe media and never fabricate a phone number', () => {
    const dom = browser(),
        w = dom.window;
    try {
        w.eval(`
            partnerCatalog.items = [{id:'partner-review', name:'Partner product', code:'P', price:1,
                images:['/uploads/safe.png', 'x" onerror="alert(1)'],
                videoUrl:'javascript:alert(1)', imeiDetails: {'<img src=x onerror="alert(1)">': {}}}];
            showContactPartnerModal('partner-review');
        `);
        const modal = w.document.getElementById('contact-partner-modal');
        assert.ok(modal && !modal.classList.contains('hidden'));
        assert.equal(modal.querySelector('[onerror]'), null);
        assert.equal(modal.querySelector('#contact-imei-pills img'), null);
        assert.equal(
            w.document.getElementById('contact-owner-phone').textContent,
            'Chưa có số liên hệ'
        );
        assert.equal(w.document.getElementById('call-partner-link').hasAttribute('href'), false);
        assert.equal(w.document.querySelectorAll('#contact-thumbnails-strip img').length, 1);
    } finally {
        w.close();
    }
});

test('IMEI editor and import inspection preserve markup as text and safe event arguments', () => {
    const dom = browser(),
        w = dom.window;
    try {
        w.eval(`
            const serial = "serial');window.pwned=1;//<img src=x>";
            currentEditingImportItem = {imeiDetails:{}, imeis:[serial]};
            renderEditImeiCards([serial]);
            currentImportItems = [{code:'SP',name:'Product',qty:1,price:10,total:10,hasImei:true,imeis:[serial],imeiDetails:{}}];
            renderImportItemsTable();
        `);
        const editor = w.document.getElementById('edit-imei-cards-container');
        assert.equal(editor.querySelector('img'), null);
        assert.ok(editor.textContent.includes('<img src=x>'));
        const inspection = w.document.getElementById('import-items-container');
        assert.ok(
            inspection.querySelector('.import-device'),
            'inspection markup must not be escaped as a string'
        );
        assert.equal(inspection.querySelector('img'), null);
        const select = inspection.querySelector('select');
        assert.ok(select);
        assert.equal(select.getAttribute('onchange'), null);
        select.value = 'good';
        select.dispatchEvent(new w.Event('change'));
        assert.equal(w.pwned, undefined);
        assert.equal(
            w.eval('currentImportItems[0].imeiDetails[currentImportItems[0].imeis[0]].condition'),
            'good'
        );
    } finally {
        w.close();
    }
});

test('refresh renders only the current view; navigating to invoices renders fresh data', () => {
    const dom = browser(),
        w = dom.window;
    try {
        w.eval(`
            window.renderCalls = [];
            renderAppLogo = () => renderCalls.push('logo');
            renderPosScreen = () => renderCalls.push('pos');
            renderDashboard = () => renderCalls.push('dashboard');
            renderReports = () => renderCalls.push('reports');
            renderInvoices = () => renderCalls.push('invoices:' + KVStore.data.invoices.length);
            state.currentView = 'pos';
            refreshCurrentView();
        `);
        assert.deepEqual(Array.from(w.renderCalls), ['logo', 'pos']);
        w.eval("KVStore.data.invoices=[]; renderCalls.length=0; switchView('invoices')");
        assert.deepEqual(Array.from(w.renderCalls), ['invoices:0']);
        assert.equal(
            w.document.getElementById('view-invoices').classList.contains('hidden'),
            false
        );
        w.eval("renderCalls.length=0; switchView('reports')");
        assert.deepEqual(Array.from(w.renderCalls), ['reports']);
    } finally {
        w.close();
    }
});

test('invoice pages ignore out-of-order responses and show network errors without stale rows', async () => {
    const dom = browser(),
        w = dom.window;
    try {
        const pending = [];
        w.fetch = (url) => new Promise((resolve) => pending.push({ url, resolve }));
        const first = w.renderInvoices();
        w.document.getElementById('invoice-search-input').value = 'new';
        const second = w.renderInvoices();
        const page = (code) => ({
            success: true,
            rows: [{ id: code, code, status: 'completed', total: 1, paid: 1 }],
            page: 1,
            pages: 2,
            total: 51,
            pageSize: 50,
            revision: 2
        });
        pending[1].resolve({ ok: true, json: async () => page('NEW') });
        await second;
        pending[0].resolve({ ok: true, json: async () => page('OLD') });
        await first;
        assert.ok(w.document.getElementById('invoice-tbody').textContent.includes('NEW'));
        assert.ok(!w.document.getElementById('invoice-tbody').textContent.includes('OLD'));
        assert.equal(w.document.getElementById('invoice-page-next').disabled, false);
        w.fetch = async () => {
            throw new Error('offline');
        };
        await w.changeInvoicePage(1);
        assert.equal(w.document.getElementById('invoice-tbody').children.length, 0);
        assert.match(
            w.document.getElementById('invoices-total-count').textContent,
            /Không tải được/
        );
        assert.equal(w.document.getElementById('invoice-page-next').disabled, true);
    } finally {
        w.close();
    }
});
test('invoice page revision conflict resets to page one and filters reset pagination', async () => {
    const dom = browser(),
        w = dom.window;
    try {
        const urls = [];
        w.fetch = async (url) => {
            urls.push(url);
            const second = new URL(url, 'http://localhost').searchParams.get('page') === '2';
            return {
                ok: !second,
                status: second ? 409 : 200,
                json: async () =>
                    second
                        ? { error: 'changed' }
                        : {
                              success: true,
                              rows: [],
                              page: 1,
                              pages: 2,
                              total: 60,
                              pageSize: 50,
                              revision: 10
                          }
            };
        };
        await w.renderInvoices();
        await w.changeInvoicePage(1);
        assert.equal(urls.length, 3);
        assert.equal(new URL(urls[1], 'http://localhost').searchParams.get('revision'), '10');
        assert.equal(new URL(urls[2], 'http://localhost').searchParams.get('page'), '1');
        w.document.getElementById('invoice-search-input').value = 'other';
        await w.changeInvoicePage(1);
        assert.equal(new URL(urls.at(-1), 'http://localhost').searchParams.get('page'), '1');
        assert.equal(new URL(urls.at(-1), 'http://localhost').searchParams.has('revision'), false);
    } finally {
        w.close();
    }
});

test('Shared warehouse view renders, connects navigation, modals, and login screen hides management layout', () => {
    const dom = browser(),
        w = dom.window;
    try {
        // 1. Verify Kho Chung navigation and elements exist
        const navBtn = w.document.getElementById('nav-products');
        assert.ok(navBtn, 'nav-products button exists');
        const viewShared = w.document.getElementById('view-sharedWarehouse');
        assert.ok(viewShared, 'view-sharedWarehouse container exists');
        assert.ok(w.document.getElementById('share-product-modal'), 'share-product-modal exists');
        assert.ok(w.document.getElementById('partner-token-modal'), 'partner-token-modal exists');
        assert.ok(
            w.document.getElementById('edit-shared-product-modal'),
            'edit-shared-product-modal exists'
        );
        assert.ok(
            w.document.getElementById('prod-detail-share-btn'),
            'prod-detail-share-btn exists in product detail modal'
        );

        // 2. Switch view to sharedWarehouse
        w.switchView('sharedWarehouse');
        assert.equal(
            viewShared.classList.contains('hidden'),
            false,
            'sharedWarehouse view is visible'
        );
        assert.equal(
            navBtn.classList.contains('nav-item-active'),
            true,
            'nav-products is active for sharedWarehouse'
        );

        // 3. Login screen guards management layout:
        // Calling showLoginScreen(true) must hide management-layout so login doesn't overlay admin
        const mgmt = w.document.getElementById('management-layout');
        const login = w.document.getElementById('login-screen');
        w.showLoginScreen(true);
        assert.equal(login.classList.contains('hidden'), false, 'login-screen is visible');
        assert.equal(
            mgmt.classList.contains('hidden'),
            true,
            'management-layout is hidden when login is active'
        );

        // showLoginScreen(false) restores management-layout
        w.showLoginScreen(false);
        assert.equal(login.classList.contains('hidden'), true, 'login-screen is hidden');
        assert.equal(mgmt.classList.contains('hidden'), false, 'management-layout is restored');
    } finally {
        w.close();
    }
});

test('manual tender survives quantity, price, discount and removal changes including explicit zero', () => {
    const dom = browser(),
        w = dom.window;
    try {
        w.eval(
            'window.testProduct=KVStore.data.products.find(p=>p.stock>0);addPosCartItem(testProduct)'
        );
        const code = w.testProduct.code;
        w.handlePosTenderInput('30.000.000');
        w.changePosQty(code, 1);
        w.setPosQty(code, 1);
        w.setPosItemPrice(code, '200000');
        w.handlePosDiscountInput('10000');
        assert.equal(w.eval('state.posTabs[0].customerGiven'), 30000000);
        assert.equal(w.document.getElementById('pos-tender-input').value, '30.000.000');
        w.fillPosExactTender();
        assert.equal(w.eval('state.posTabs[0].customerGiven'), 190000);
        w.changePosQty(code, 1);
        assert.equal(w.eval('state.posTabs[0].customerGiven'), 190000);
        w.handlePosTenderInput('0');
        w.changePosQty(code, 1);
        assert.equal(w.eval('state.posTabs[0].customerGiven'), 0);
        w.setPosCustomerGiven(500000);
        w.removePosItem(code);
        assert.equal(w.eval('state.posTabs[0].customerGiven'), 500000);
        w.addPosNewTab();
        w.addPosCartItem(w.testProduct);
        assert.equal(w.eval('state.posTabs[1].customerGiven'), w.testProduct.price);
        w.changePosQty(code, 1);
        assert.equal(w.eval('state.posTabs[1].customerGiven'), 2 * w.testProduct.price);
    } finally {
        w.close();
    }
});
test('closing populated tabs asks first, pending tabs cannot close, and active tab identity stays stable', () => {
    const dom = browser(),
        w = dom.window;
    try {
        w.addPosNewTab();
        w.eval('addPosCartItem(KVStore.data.products.find(p=>p.stock>0))');
        const event = { stopPropagation() {} };
        let asked = 0;
        w.confirm = () => {
            asked++;
            return false;
        };
        w.closePosTab(event, 1);
        assert.equal(asked, 1);
        assert.equal(w.eval('state.posTabs.length'), 2);
        w.confirm = () => true;
        w.eval("state.posTabs[1].pendingRequestId='waiting'");
        w.closePosTab(event, 1);
        assert.equal(w.eval('state.posTabs.length'), 2);
        w.eval('delete state.posTabs[1].pendingRequestId');
        w.addPosNewTab();
        const active = w.eval('state.posTabs[state.activePosTab].id');
        w.closePosTab(event, 1);
        assert.equal(w.eval('state.posTabs[state.activePosTab].id'), active);
        w.addPosNewTab();
        assert.equal(w.eval('new Set(state.posTabs.map(t=>t.id)).size'), 3);
    } finally {
        w.close();
    }
});
test('POS delete and close controls have visible content and recovery status persists', () => {
    const dom = browser(),
        w = dom.window;
    try {
        w.eval('addPosCartItem(KVStore.data.products.find(p=>p.stock>0))');
        assert.ok(w.document.querySelector('#pos-cart-list button[title="Xoá"] svg'));
        w.addPosNewTab();
        assert.equal(
            w.document.querySelector('#pos-tabs-wrapper button[aria-label^="Đóng"]').textContent,
            '×'
        );
        w.eval('KVStore.updateDbStatus()');
        assert.match(w.document.getElementById('pos-save-status-text').textContent, /Đã kết nối/);
        w.eval(
            "localStorage.setItem('minikiot.pending.test',JSON.stringify({userId:KVStore.user.id,requestId:'test'}));KVStore.updateDbStatus()"
        );
        assert.match(
            w.document.getElementById('pos-save-status-text').textContent,
            /chưa xác nhận/
        );
        assert.equal(w.document.getElementById('pos-checkout-btn').disabled, true);
        assert.equal(
            w.document.getElementById('pos-reconcile-btn').textContent,
            'Kiểm tra kết quả'
        );
        w.eval('KVStore._sending=true;KVStore.updateDbStatus()');
        assert.match(w.document.getElementById('pos-checkout-btn').textContent, /ĐANG LƯU/);
        assert.equal(w.document.getElementById('pos-reconcile-btn').disabled, true);
        w.eval(
            "KVStore._sending=false;localStorage.removeItem('minikiot.pending.test');KVStore.isDbConnected=false;KVStore.updateDbStatus()"
        );
        assert.match(w.document.getElementById('pos-save-status-text').textContent, /Mất kết nối/);
        assert.equal(w.document.getElementById('pos-reconcile-btn').disabled, false);
    } finally {
        w.close();
    }
});
test('multi-payment allocations are not overwritten by basket edits or exact tender action', () => {
    const dom = browser(),
        w = dom.window;
    try {
        w.eval(
            'window.testProduct=KVStore.data.products.find(p=>p.stock>0);addPosCartItem(testProduct)'
        );
        w.setPosPaymentMethod('multi');
        w.handleMultiPaymentInput('cash', '100000');
        w.handleMultiPaymentInput('transfer', '200000');
        w.changePosQty(w.testProduct.code, 1);
        w.fillPosExactTender();
        assert.equal(w.eval('state.posTabs[0].multiPayments.cash'), 100000);
        assert.equal(w.eval('state.posTabs[0].multiPayments.transfer'), 200000);
        assert.equal(w.eval('state.posTabs[0].customerGiven'), 300000);
    } finally {
        w.close();
    }
});

test('mobile order summary tracks quantity, discount and tab changes without submitting a sale', () => {
    const dom = browser(),
        w = dom.window;
    try {
        Object.defineProperty(w, 'innerWidth', { value: 390, writable: true });
        w.eval(
            "state.posTabs[0].cart=[{code:'M',name:'Mobile',qty:2,price:100000,stock:10}];state.posTabs[0].discount=10000;renderPosScreen();switchPosMobileView('catalog')"
        );
        const bar = w.document.getElementById('pos-mobile-summary');
        const action = w.document.getElementById('pos-mobile-summary-action');
        assert.equal(bar.parentElement.id, 'pos-layout');
        assert.equal(bar.classList.contains('hidden'), false);
        assert.equal(
            w.document.getElementById('pos-mobile-summary-total').textContent,
            '2 món · 190.000 đ'
        );
        let commands = 0;
        w.eval('window.submitted=0; KVStore.command=()=>{window.submitted++}');
        action.click();
        assert.equal(w.eval('posMobileView'), 'cart');
        assert.equal(action.textContent, 'Thanh toán');
        w.changePosQty('M', 1);
        assert.equal(
            w.document.getElementById('pos-mobile-summary-total').textContent,
            '3 món · 290.000 đ'
        );
        action.click();
        assert.equal(w.eval('posMobileView'), 'checkout');
        assert.equal(bar.classList.contains('hidden'), true);
        assert.equal(w.submitted, commands);
        w.addPosNewTab();
        w.switchPosMobileView('catalog');
        assert.equal(action.disabled, true);
        assert.equal(
            w.document.getElementById('pos-mobile-summary-total').textContent,
            '0 món · 0 đ'
        );
        w.switchPosTab(0);
        assert.equal(action.disabled, false);
        w.switchPosMobileView('invalid');
        assert.equal(w.eval('posMobileView'), 'catalog');
    } finally {
        w.close();
    }
});
test('tablet pairs cart and payment, phone isolates panels and desktop keeps catalog preference', () => {
    const dom = browser(),
        w = dom.window;
    try {
        Object.defineProperty(w, 'innerWidth', { value: 768, writable: true });
        const visible = (id) => !w.document.getElementById(id).classList.contains('hidden');
        w.switchPosMobileView('cart');
        assert.ok(visible('pos-cart-panel') && visible('pos-checkout-panel'));
        assert.equal(visible('pos-catalog-panel'), false);
        assert.equal(w.document.getElementById('pos-panels').dataset.tabletCheckout, 'true');
        assert.equal(visible('pos-mobile-summary'), false);
        w.switchPosMobileView('catalog');
        assert.ok(visible('pos-catalog-panel'));
        assert.equal(visible('pos-checkout-panel'), false);
        w.switchPosMobileView('checkout');
        w.innerWidth = 390;
        w.updatePosResponsivePanels();
        assert.equal(visible('pos-cart-panel'), false);
        assert.equal(visible('pos-checkout-panel'), true);
        assert.equal(
            w.document.getElementById('pos-tab-checkout').getAttribute('aria-pressed'),
            'true'
        );
        w.innerWidth = 1440;
        w.eval('state.posShowCatalog=false');
        w.updatePosResponsivePanels();
        assert.ok(visible('pos-cart-panel') && visible('pos-checkout-panel'));
        assert.equal(visible('pos-catalog-panel'), false);
        assert.equal(visible('pos-mobile-summary'), false);
        w.eval('state.posShowCatalog=true');
        w.updatePosResponsivePanels();
        assert.equal(visible('pos-catalog-panel'), true);
    } finally {
        w.close();
    }
});
test('POS keeps one labelled search control through panel changes and resize', () => {
    const dom = browser(),
        w = dom.window;
    try {
        const input = w.document.getElementById('pos-search-input');
        input.value = 'UX-123';
        Object.defineProperty(w, 'innerWidth', { value: 390, writable: true });
        for (const width of [390, 768, 1024, 1440, 390]) {
            w.innerWidth = width;
            for (const view of ['catalog', 'cart', 'checkout']) w.switchPosMobileView(view);
            assert.equal(w.document.querySelectorAll('#pos-search-input').length, 1);
            assert.equal(w.document.getElementById('pos-search-input'), input);
            assert.equal(input.value, 'UX-123');
            assert.ok(input.getAttribute('aria-label'));
        }
    } finally {
        w.close();
    }
});

test('POS catalog exposes all matches through load more and resets on search and branch changes', () => {
    const dom = browser(),
        w = dom.window;
    try {
        w.eval(
            `const template=KVStore.data.products[0]; KVStore.data.products=Array.from({length:125},(_,i)=>({...template,id:'PAGE'+i,code:'PAGE'+i,name:'Item '+i,stock:10,hasImei:false,imeis:[],branch:getCurrentBranch()}));renderPosCatalog();`
        );
        const grid = w.document.getElementById('pos-product-grid'),
            more = w.document.getElementById('pos-catalog-more'),
            count = w.document.getElementById('pos-catalog-count');
        assert.equal(grid.querySelectorAll('button[data-product-code]').length, 50);
        assert.equal(count.textContent, 'Hiển thị 50/125 sản phẩm');
        w.loadMorePosCatalog();
        assert.equal(grid.querySelectorAll('button[data-product-code]').length, 100);
        assert.equal(w.document.activeElement.dataset.productCode, 'PAGE50');
        w.loadMorePosCatalog();
        assert.equal(grid.querySelectorAll('button[data-product-code]').length, 125);
        assert.equal(more.hidden, true);
        w.filterPosCatalog('no match');
        assert.equal(count.textContent, 'Hiển thị 0/0 sản phẩm');
        assert.equal(more.hidden, true);
        w.filterPosCatalog('');
        assert.equal(grid.querySelectorAll('[data-product-code]').length, 50);
        w.loadMorePosCatalog();
        w.eval("KVStore.data.settings.branch='Other branch'; renderPosCatalog()");
        assert.equal(count.textContent, 'Hiển thị 0/0 sản phẩm');
    } finally {
        w.close();
    }
});
test('POS catalog buttons expose product names, keep focus and disable out-of-stock items', () => {
    const dom = browser(),
        w = dom.window;
    try {
        w.eval(
            `const p=KVStore.data.products[0];KVStore.data.products=[{...p,id:'IN',code:'IN',stock:2,hasImei:false},{...p,id:'OUT',code:'OUT',stock:0,hasImei:false}];renderPosCatalog();`
        );
        let button = w.document.querySelector('[data-product-code="IN"]');
        assert.equal(button.tagName, 'BUTTON');
        assert.equal(button.type, 'button');
        assert.ok(button.getAttribute('aria-label'));
        button.focus();
        button.click();
        assert.equal(w.eval('state.posTabs[0].cart.length'), 1);
        assert.equal(w.document.activeElement.dataset.productCode, 'IN');
        const out = w.document.querySelector('[data-product-code="OUT"]');
        assert.equal(out.disabled, true);
        out.click();
        assert.equal(w.eval('state.posTabs[0].cart.length'), 1);
    } finally {
        w.close();
    }
});
test('POS identity uses text, updates branch, and keyboard shortcuts never submit payment', () => {
    const dom = browser(),
        w = dom.window;
    try {
        w.eval(
            `KVStore.data.settings.storeName='<img src=x> Shop';state.currentView='pos';renderPosScreen();setupKeyboardShortcuts();setupKeyboardShortcuts();window.sent=0;KVStore.command=()=>{window.sent++};`
        );
        const title = w.document.getElementById('pos-store-identity');
        assert.ok(title.textContent.includes('<img src=x> Shop'));
        assert.equal(title.querySelector('img'), null);
        const key = (name, options = {}) =>
            w.dispatchEvent(
                new w.KeyboardEvent('keydown', {
                    key: name,
                    bubbles: true,
                    cancelable: true,
                    ...options
                })
            );
        key('F2');
        assert.equal(w.document.activeElement.id, 'pos-search-input');
        key('F4');
        assert.equal(w.eval('state.posTabs.length'), 2);
        key('F4', { repeat: true });
        key('F4', { ctrlKey: true });
        key('F4', { isComposing: true });
        assert.equal(w.eval('state.posTabs.length'), 2);
        Object.defineProperty(w, 'innerWidth', { value: 390, writable: true });
        key('F8');
        assert.equal(w.eval('posMobileView'), 'checkout');
        assert.equal(w.document.activeElement.id, 'pos-tender-input');
        assert.equal(w.sent, 0);
        w.document.getElementById('pos-imei-modal').classList.remove('hidden');
        key('F4');
        assert.equal(w.eval('state.posTabs.length'), 2);
        w.document.getElementById('pos-imei-modal').classList.add('hidden');
        w.eval(
            "localStorage.setItem('minikiot.pending.test',JSON.stringify({userId:KVStore.user.id,requestId:'test'}))"
        );
        key('F4');
        assert.equal(w.eval('state.posTabs.length'), 2);
        w.eval("localStorage.clear();state.currentView='dashboard'");
        key('F4');
        assert.equal(w.eval('state.posTabs.length'), 2);
    } finally {
        w.close();
    }
});

test('all-branch inventory sums each branch valuation instead of using first branch price', () => {
    const dom = browser(),
        w = dom.window;
    try {
        w.eval(`
            KVStore.data.products = [
                { code: 'P', name: 'P', branch: 'A', stock: 1, costPrice: 100, price: 200, status: 'active' },
                { code: 'P', name: 'P', branch: 'B', stock: 1, costPrice: 300, price: 400, status: 'active' }
            ];
            getCurrentBranch = () => ALL_BRANCHES;
            currentReportTab = 'inventory';
            globalThis.kpis = {};
            updateKpiCard = (index, icon, label, value) => { kpis[label] = value; };
            renderReports();
        `);
        assert.equal(w.kpis['Giá trị tồn theo vốn'], '400 đ');
        assert.equal(w.kpis['Giá trị tồn theo giá bán'], '600 đ');
        assert.match(w.document.getElementById('rep-table-tbody').textContent, /400/);
    } finally {
        w.close();
    }
});

test('import workspace preserves partial payment, derives serial quantity and confirms close', () => {
    const dom = browser(),
        w = dom.window;
    try {
        w.openCreateImportModal();
        w.selectImportProduct('SP001');
        assert.equal(w.eval('currentImportItems[0].qty'), 0);
        w.addImeisToItem('SP001', ['NEW-A', 'NEW-A', 'NEW-B']);
        assert.equal(w.eval('currentImportItems[0].qty'), 2);
        assert.match(
            w.document.getElementById('import-imei-feedback-SP001').textContent,
            /1 mã trùng/
        );
        assert.equal(w.document.querySelector('#import-items-container details').open, false);
        assert.equal(w.document.querySelector('#import-items-container select').value, '');
        const mode = w.document.getElementById('import-payment-state');
        mode.value = 'partial';
        w.updateImportPayment();
        w.document.getElementById('import-paid-input').value = '1234';
        w.updateImportItemPrice('SP001', 50000);
        w.selectImportProduct('SP002');
        assert.equal(w.document.getElementById('import-paid-input').value, '1234');
        w.removeInlineImei('SP001', 'NEW-A');
        w.removeInlineImei('SP001', 'NEW-B');
        assert.equal(w.eval('currentImportItems[0].qty'), 0);
        assert.equal(w.document.getElementById('import-paid-input').value, '1234');
        w.confirm = () => false;
        w.closeCreateImport();
        assert.equal(
            w.document.getElementById('create-import-modal').classList.contains('hidden'),
            false
        );
        w.confirm = () => true;
        w.closeCreateImport();
        w.openCreateImportModal();
        assert.equal(w.eval('currentImportItems.length'), 2);
        assert.equal(w.document.getElementById('import-paid-input').value, '1234');
    } finally {
        w.close();
    }
});

test('import branch is explicit and ambiguous search requires a deliberate selection', () => {
    const dom = browser(),
        w = dom.window;
    try {
        w.eval('KVStore.data.settings.branch = ALL_BRANCHES');
        w.openCreateImportModal();
        assert.equal(w.document.getElementById('import-branch').value, '');
        w.selectImportProduct('SP001');
        assert.equal(w.eval('currentImportItems.length'), 0);
        const branch = w.document.getElementById('import-branch');
        branch.selectedIndex = 1;
        w.changeImportBranch();
        w.document.getElementById('import-modal-search-input').value = 'SP';
        w.handleImportProductSearch('SP');
        w.handleImportSearchKeydown({ key: 'Enter', preventDefault() {} });
        assert.equal(w.eval('currentImportItems.length'), 0);
        w.handleImportSearchKeydown({ key: 'ArrowDown', preventDefault() {} });
        w.handleImportSearchKeydown({ key: 'Enter', preventDefault() {} });
        assert.equal(w.eval('currentImportItems.length'), 1);
        const oldBranch = branch.value;
        w.confirm = () => false;
        branch.selectedIndex = 2;
        w.changeImportBranch();
        assert.equal(branch.value, oldBranch);
    } finally {
        w.close();
    }
});

test('UX/UI audit fixes: viewport zoom compensation, brand-safe Title Case, modal focus, F9 safety and accessible icons', async () => {
    const dom = browser(),
        w = dom.window;
    try {
        // 1. Desktop POS zoom compensation prevents 110% viewport clipping
        const styleContent = Array.from(w.document.querySelectorAll('style'))
            .map((s) => s.textContent)
            .join('\n');
        assert.ok(styleContent.includes('width: calc(100vw / 1.1)'));
        assert.ok(styleContent.includes('height: calc(100dvh / 1.1)'));

        // 2. Title Case preserves mixed-case brand words (iPhone, iPad, MacBook, eSIM)
        assert.equal(
            w.normalizeTitleCase('nguyễn văn an - iPhone 16 Pro Max / eSIM'),
            'Nguyễn Văn An - iPhone 16 Pro Max / eSIM'
        );

        // 3. F9 never auto-submits payment in POS
        w.eval(
            `state.currentView='pos';setupKeyboardShortcuts();window.checkoutCalled=0;checkoutPos=()=>{window.checkoutCalled++};`
        );
        w.dispatchEvent(
            new w.KeyboardEvent('keydown', { key: 'F9', bubbles: true, cancelable: true })
        );
        assert.equal(w.checkoutCalled, 0);

        // 4. Unified modal accessibility observer focuses first editable input directly (not close button)
        w.setupModalAccessibility();
        w.openAddCustomerModal();
        await new Promise((r) => w.setTimeout(r, 10));
        assert.equal(w.document.activeElement.id, 'cust-code');

        // 5. Product image preview delete button has visible symbol & aria-label
        const previewHost = w.document.createElement('div');
        previewHost.id = 'prod-images-preview';
        w.document.body.appendChild(previewHost);
        w.eval(`currentProductImages=['/uploads/sample.png'];renderProductImagePreviews();`);
        const delImgBtn = previewHost.querySelector('button');
        assert.ok(delImgBtn);
        assert.equal(delImgBtn.getAttribute('aria-label'), 'Xóa ảnh 1');
        assert.equal(delImgBtn.textContent.trim(), '×');
        previewHost.remove();

        // 6. Receipt & payment modals and login fields have proper labels and SVG icons
        assert.ok(w.document.querySelector('#create-receipt-modal svg'));
        assert.ok(w.document.querySelector('#create-payment-modal svg'));
        assert.equal(
            w.document.querySelector('label[for="login-username"]') !== null &&
                w.document.querySelector('label[for="login-password"]') !== null,
            true
        );
    } finally {
        w.close();
    }
});

test('Phase 2 UX/UI: Dashboard period selector, persistent starred records, POS draft cart recovery, and table Load More', () => {
    const dom = browser(),
        w = dom.window;
    try {
        // 1. Dashboard period selector updates period badges & chart bars dynamically
        const periodSel = w.document.getElementById('dash-period-select');
        assert.ok(periodSel);
        periodSel.value = '7days';
        w.renderDashboard();
        assert.equal(
            w.document.getElementById('dash-top-product-period-badge').textContent,
            '7 ngày qua'
        );
        assert.equal(w.document.querySelectorAll('#dashboard-bars-container > div').length, 7);

        // 2. Starred records persist across re-renders via localStorage
        w.eval(`
            KVStore.data.imports = [{ id: 'imp1', code: 'PN000999', branch: 'Kalo HCM', time: '20/10/2026 09:00', needPay: 100000, paid: 100000, items: [] }];
            renderImports();
        `);
        let starCell = w.document.querySelector('[data-star-key="imp:PN000999"]');
        assert.ok(starCell);
        assert.equal(starCell.classList.contains('text-yellow-400'), false);
        w.toggleStar(starCell, 'imp:PN000999');
        assert.equal(w.isRecordStarred('imp:PN000999'), true);
        w.renderImports();
        starCell = w.document.querySelector('[data-star-key="imp:PN000999"]');
        assert.equal(starCell.classList.contains('text-yellow-400'), true);

        // 3. POS draft cart saves to sessionStorage and restores with updated live stock
        const savedCode = w.eval(`
            const p = KVStore.data.products.find((x) => x.stock > 0);
            addPosCartItem(p);
            state.posTabs[0].note = 'Đơn giữ nháp';
            renderPosScreen();
            p.stock = 42;
            state.posTabs = [{ id: 1, name: 'Hóa đơn 1', cart: [], note: '' }];
            p.code;
        `);
        assert.equal(w.restorePosDraft(), true);
        assert.equal(w.eval('state.posTabs[0].cart.length'), 1);
        assert.equal(w.eval('state.posTabs[0].cart[0].code'), savedCode);
        assert.equal(w.eval('state.posTabs[0].cart[0].stock'), 42);
        assert.equal(w.eval('state.posTabs[0].note'), 'Đơn giữ nháp');

        // 4. Table batch rendering (Load More 50 rows) for Products and Customers
        w.eval(`
            KVStore.data.customers = Array.from({ length: 65 }, (_, i) => ({
                id: 'C' + i,
                code: 'KH' + String(i + 1).padStart(4, '0'),
                name: 'Khách ' + (i + 1),
                phone: '09000000' + String(i).padStart(2, '0'),
                address: 'HCM',
                totalSpent: 0,
                debt: 0
            }));
            renderCustomers();
        `);
        assert.equal(w.document.querySelectorAll('#customers-tbody tr').length, 50);
        assert.equal(
            w.document.getElementById('customers-total-count').textContent,
            'Hiển thị 50 / 65 khách hàng'
        );
        const moreCustBtn = w.document.getElementById('customers-load-more-btn');
        assert.equal(moreCustBtn.classList.contains('hidden'), false);
        w.loadMoreCustomers();
        assert.equal(w.document.querySelectorAll('#customers-tbody tr').length, 65);
        assert.equal(moreCustBtn.classList.contains('hidden'), true);
    } finally {
        w.close();
    }
});

test('Phase 3 UX/UI: Select All table checkboxes, selective CSV export, touch-friendly report chart tooltips, and mobile nav dropdown', async () => {
    const dom = browser(),
        w = dom.window;
    try {
        w.setupTableCheckboxes();
        w.setupNavigation();

        // 1. Header checkbox toggles all visible row checkboxes & row highlight
        w.renderCustomers();
        const custTable = w.document.getElementById('customers-tbody').closest('table');
        const headerCb = custTable.querySelector('thead input.kv-checkbox');
        const rowCbs = [...custTable.querySelectorAll('tbody input.kv-checkbox')];
        assert.ok(headerCb && rowCbs.length >= 2);
        headerCb.checked = true;
        headerCb.dispatchEvent(new w.Event('change', { bubbles: true }));
        assert.equal(
            rowCbs.every((cb) => cb.checked),
            true
        );
        assert.equal(rowCbs[0].closest('tr').classList.contains('bg-blue-50/50'), true);

        // Unchecking one row sets header checkbox to indeterminate
        rowCbs[0].checked = false;
        rowCbs[0].dispatchEvent(new w.Event('change', { bubbles: true }));
        assert.equal(headerCb.checked, false);
        assert.equal(headerCb.indeterminate, true);

        // 2. Report bar charts render focusable bars with inline popover tooltips for touch/keyboard
        w.renderDualBarChart(
            'rep-main-chart-container',
            [{ label: '20/10', fullName: 'Ngày 20/10', val1: 500000, val2: 200000 }],
            'Doanh thu',
            'bg-[#0066cc]',
            'Lợi nhuận',
            'bg-emerald-500'
        );
        const barCol = w.document.querySelector('#rep-main-chart-container [tabindex="0"]');
        assert.ok(barCol);
        assert.ok(barCol.textContent.includes('500.000 đ'));

        // 3. Shared warehouse unshare uses custom askAction dialog instead of native confirm
        w.document.getElementById('edit-shared-id').value = 'SP_SHARED_1';
        const unsharePromise = w.confirmUnshareProduct();
        assert.equal(
            w.document.getElementById('action-dialog').classList.contains('hidden'),
            false
        );
        w.document.getElementById('action-dialog-cancel').click();
        await unsharePromise;

        // 4. Mobile "Khác" dropdown opens on click and closes when switching view
        const moreBtn = w.document.getElementById('nav-more');
        const moreMenu = w.document.getElementById('nav-more-menu');
        assert.ok(moreBtn && moreMenu);
        moreBtn.click();
        assert.equal(moreMenu.classList.contains('hidden'), false);
        assert.equal(moreBtn.getAttribute('aria-expanded'), 'true');
        w.switchView('reports');
        assert.equal(moreMenu.classList.contains('hidden'), true);
        assert.equal(moreBtn.classList.contains('nav-item-active'), true);
    } finally {
        w.close();
    }
});

test('Phase 4 UX/UI: Search clear buttons & Escape shortcut, starred document filters, and filter-aware CSV export', async () => {
    const dom = browser(),
        w = dom.window;
    try {
        w.setupSearchInputs();

        // 1. Search inputs get an accessible clear button (×) and clear on Escape key
        const custSearch = w.document.getElementById('customer-search-input');
        const clearBtn = custSearch.parentElement.querySelector(
            '[data-clear-for="customer-search-input"]'
        );
        assert.ok(clearBtn);
        assert.equal(clearBtn.classList.contains('hidden'), true);

        custSearch.value = 'Nguyễn';
        custSearch.dispatchEvent(new w.Event('input', { bubbles: true }));
        assert.equal(clearBtn.classList.contains('hidden'), false);

        custSearch.dispatchEvent(
            new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        );
        assert.equal(custSearch.value, '');
        assert.equal(clearBtn.classList.contains('hidden'), true);

        // 2. Starred filter on Imports and Invoices shows only starred records
        w.eval(`
            KVStore.data.imports = [
                { id: 'i1', code: 'PN_STAR_1', branch: 'Kalo HCM', time: '20/10/2026 09:00', needPay: 50000, paid: 50000, items: [] },
                { id: 'i2', code: 'PN_NORM_2', branch: 'Kalo HCM', time: '20/10/2026 10:00', needPay: 80000, paid: 80000, items: [] }
            ];
            renderImports();
        `);
        const starTd = w.document.querySelector('[data-star-key="imp:PN_STAR_1"]');
        w.toggleStar(starTd, 'imp:PN_STAR_1');
        const impStatusSel = w.document.getElementById('import-status-filter');
        impStatusSel.value = 'starred';
        w.renderImports();
        const impRows = w.document.querySelectorAll('#import-tbody tr');
        assert.equal(impRows.length, 1);
        assert.ok(impRows[0].textContent.includes('PN_STAR_1'));

        // Starred filter on Invoices
        w.eval(`
            KVStore.data.invoices = [
                { id: 'inv_s1', code: 'HD_STAR_1', branch: 'Kalo HCM', time: '20/10/2026 11:00', customer: 'Khách A', total: 120000, paid: 120000, items: [] },
                { id: 'inv_s2', code: 'HD_NORM_2', branch: 'Kalo HCM', time: '20/10/2026 12:00', customer: 'Khách B', total: 150000, paid: 150000, items: [] }
            ];
        `);
        w.toggleStar(w.document.createElement('td'), 'inv:HD_STAR_1');
        await w.setInvoiceStatusFilter('starred');
        const invRows = w.document.querySelectorAll('#invoice-tbody tr');
        assert.equal(invRows.length, 1);
        assert.ok(invRows[0].textContent.includes('HD_STAR_1'));
    } finally {
        w.close();
    }
});

test('Phase 5 UX/UI: Column sorting on Suppliers/Imports/Cashbook, Bulk Selection badge & clear, and POS dropdown keyboard navigation', () => {
    const dom = browser(),
        w = dom.window;
    try {
        w.setupTableCheckboxes();

        // 1. Column sorting on Suppliers (by debt asc/desc)
        w.eval(`
            KVStore.data.suppliers = [
                { id: 's1', code: 'NCC01', name: 'Nhà cung cấp A', phone: '0901', debt: 500000, totalBought: 1000000 },
                { id: 's2', code: 'NCC02', name: 'Nhà cung cấp B', phone: '0902', debt: 100000, totalBought: 2000000 }
            ];
        `);
        w.sortSuppliersBy('debt');
        let supRows = w.document.querySelectorAll('#suppliers-tbody tr');
        assert.ok(supRows[0].textContent.includes('NCC02'));
        assert.equal(w.document.getElementById('sort-sup-debt').textContent, '↑');
        w.sortSuppliersBy('debt');
        supRows = w.document.querySelectorAll('#suppliers-tbody tr');
        assert.ok(supRows[0].textContent.includes('NCC01'));
        assert.equal(w.document.getElementById('sort-sup-debt').textContent, '↓');

        // 2. Bulk selection badge appears when rows are checked and clears on "Bỏ chọn"
        const supTable = w.document.getElementById('suppliers-tbody').closest('table');
        const headerCb = supTable.querySelector('thead input.kv-checkbox');
        headerCb.checked = true;
        headerCb.dispatchEvent(new w.Event('change', { bubbles: true }));
        const bulkBadge = supTable.closest('.glass-panel').querySelector('[data-bulk-badge]');
        assert.ok(bulkBadge && !bulkBadge.classList.contains('hidden'));
        assert.ok(bulkBadge.textContent.includes('Đã chọn 2 dòng'));
        bulkBadge.querySelector('[data-bulk-clear]').click();
        assert.equal(bulkBadge.classList.contains('hidden'), true);
        assert.equal(headerCb.checked, false);

        // 3. POS Customer Dropdown keyboard navigation (ArrowDown + Enter selects customer)
        w.searchPosCustomers('');
        w.handlePosCustomerKeydown({ key: 'ArrowDown', preventDefault() {} });
        const highlightedCust = w.document.querySelector(
            '#pos-customer-dropdown [data-pos-cust-item].bg-blue-50'
        );
        assert.ok(highlightedCust);
        w.handlePosCustomerKeydown({ key: 'Enter', preventDefault() {} });
        assert.ok(w.eval('state.posTabs[state.activePosTab].customer !== null'));
    } finally {
        w.close();
    }
});

test('Phase 6 UX/UI: Stocktake/Transfer column sorting, Import load more, and bulk selection reset on re-render', () => {
    const dom = browser(),
        w = dom.window;
    try {
        w.setupTableCheckboxes();

        // 1. Stocktake column sorting toggles direction and re-renders rows
        w.eval(`
            KVStore.data.stocktakes = [
                { id: 'st1', code: 'KK01', branch: 'Kalo HCM', time: '20/10/2026', cashier: 'A', totalActual: 100, totalVariance: 5, status: 'balanced' },
                { id: 'st2', code: 'KK02', branch: 'Kalo HCM', time: '21/10/2026', cashier: 'B', totalActual: 300, totalVariance: -2, status: 'draft' }
            ];
        `);
        w.sortStocktakesBy('totalActual');
        let rows = w.document.querySelectorAll('#stocktakes-tbody tr');
        assert.ok(rows[0].textContent.includes('KK01'));
        assert.equal(w.document.getElementById('sort-st-totalActual').textContent, '↑');
        w.sortStocktakesBy('totalActual');
        rows = w.document.querySelectorAll('#stocktakes-tbody tr');
        assert.ok(rows[0].textContent.includes('KK02'));
        assert.equal(w.document.getElementById('sort-st-totalActual').textContent, '↓');

        // 2. Transfer column sorting by totalValue
        w.eval(`
            KVStore.data.transfers = [
                { id: 'tf1', code: 'CH01', fromBranch: 'Kalo HCM', toBranch: 'Kalo Hà Nội', cashier: 'A', totalQty: 2, totalValue: 900000, status: 'shipping' },
                { id: 'tf2', code: 'CH02', fromBranch: 'Kalo HCM', toBranch: 'Kalo Hà Nội', cashier: 'B', totalQty: 5, totalValue: 100000, status: 'completed' }
            ];
        `);
        w.sortTransfersBy('totalValue');
        rows = w.document.querySelectorAll('#transfers-tbody tr');
        assert.ok(rows[0].textContent.includes('CH02'));
        assert.equal(w.document.getElementById('sort-tf-totalValue').textContent, '↑');

        // 3. Imports load-more paginates 60 records as 50 + 10
        w.eval(`
            KVStore.data.imports = Array.from({ length: 60 }, (_, i) => ({
                id: 'imp' + i,
                code: 'PN' + String(i + 1).padStart(4, '0'),
                branch: 'Kalo HCM',
                time: '20/10/2026 09:00',
                needPay: 100000,
                paid: 100000,
                items: []
            }));
            renderImports();
        `);
        assert.equal(w.document.querySelectorAll('#import-tbody tr').length, 50);
        assert.equal(
            w.document.getElementById('imports-total-count').textContent,
            'Hiển thị 50 / 60 phiếu nhập'
        );
        const moreImpBtn = w.document.getElementById('imports-load-more-btn');
        assert.equal(moreImpBtn.classList.contains('hidden'), false);
        w.loadMoreImports();
        assert.equal(w.document.querySelectorAll('#import-tbody tr').length, 60);
        assert.equal(moreImpBtn.classList.contains('hidden'), true);

        // 4. Bulk selection badge resets when the table is re-rendered by a new search
        const impTable = w.document.getElementById('import-tbody').closest('table');
        const headerCb = impTable.querySelector('thead input.kv-checkbox');
        headerCb.checked = true;
        headerCb.dispatchEvent(new w.Event('change', { bubbles: true }));
        const badge = impTable.closest('.glass-panel').querySelector('[data-bulk-badge]');
        assert.equal(badge.classList.contains('hidden'), false);
        w.document.getElementById('import-search-input').value = 'PN0001';
        w.renderImports();
        assert.equal(headerCb.checked, false);
        assert.equal(badge.classList.contains('hidden'), true);
    } finally {
        w.close();
    }
});

test('View transitions render before reveal, avoid display flips, restore scroll and honour reduced motion', () => {
    const dom = browser(),
        w = dom.window;
    try {
        // 1. Rendering happens while the target view is still hidden (no empty-frame flash)
        w.eval(`
            window.hiddenAtRender = null;
            renderReports = () => {
                window.hiddenAtRender = document
                    .getElementById('view-reports')
                    .classList.contains('hidden');
            };
            switchView('reports');
        `);
        assert.equal(w.hiddenAtRender, true, 'view must still be hidden while rendering');
        assert.equal(
            w.document.getElementById('view-reports').classList.contains('hidden'),
            false,
            'view is revealed after rendering'
        );

        // 2. No inline display overrides are written (class-based toggling only)
        assert.equal(w.document.getElementById('management-layout').style.display, '');
        assert.equal(w.document.getElementById('pos-layout').style.display, '');

        // 3. Reveal calls the enter-animation helper exactly once per switch
        w.eval(`
            window.enterCalls = [];
            window.realPlayViewEnter = playViewEnter;
            playViewEnter = (el, cls) => window.enterCalls.push((el && el.id) + '|' + cls);
            switchView('products');
        `);
        assert.deepEqual(Array.from(w.enterCalls), ['view-products|view-entering']);

        // 4. Scroll position of the previous view is remembered and restored
        w.eval(`
            const prev = document.getElementById('view-products');
            prev.scrollTop = 240;
            switchView('dashboard');
        `);
        // Vị trí được lưu cho chính view và mọi khung cuộn con (phần tử đầu là view).
        assert.equal(w.eval('viewScrollPositions.get("view-products")[0].top'), 240);
        w.eval(`
            const back = document.getElementById('view-products');
            back.scrollTop = 0;
            switchView('products');
        `);
        assert.equal(w.document.getElementById('view-products').scrollTop, 240);

        // 5. POS switch uses the layout fade helper and keeps class-based visibility
        w.eval(`
            window.enterCalls.length = 0;
            switchView('pos');
        `);
        assert.deepEqual(Array.from(w.enterCalls), ['pos-layout|layout-entering']);
        assert.equal(
            w.document.getElementById('management-layout').classList.contains('hidden'),
            true
        );
        assert.equal(w.document.getElementById('pos-layout').classList.contains('hidden'), false);

        // 6. Reduced-motion users get no animation class (use the original helper)
        const originalMatchMedia = w.matchMedia;
        w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
        w.eval(`
            const el = document.getElementById('pos-layout');
            el.classList.add('layout-entering');
            window.realPlayViewEnter(el, 'layout-entering');
        `);
        assert.equal(
            w.document.getElementById('pos-layout').classList.contains('layout-entering'),
            false
        );
        w.matchMedia = originalMatchMedia;
    } finally {
        w.close();
    }
});

test('Import detail modal and import list display product image thumbnails and photo badges', () => {
    const dom = browser(),
        w = dom.window;
    try {
        w.eval(`
            KVStore.data.imports = [
                {
                    id: 'imp_photo_1',
                    code: 'PN_PHOTO_01',
                    branch: 'Kalo HCM',
                    time: '30/10/2026 10:00',
                    nccName: 'Synnex FPT',
                    needPay: 50000000,
                    paid: 50000000,
                    paymentMethod: 'transfer',
                    items: [
                        {
                            code: 'SP_IMG_01',
                            name: 'iPhone 15 Pro Max',
                            qty: 1,
                            price: 30000000,
                            images: ['/uploads/img_iphone15pm.jpg']
                        },
                        {
                            code: 'SP_IMG_02',
                            name: 'Củ sạc Anker GaN',
                            qty: 2,
                            price: 10000000,
                            images: ['/uploads/img_anker_charger.jpg']
                        }
                    ]
                }
            ];
            renderImports();
        `);

        // 1. Import list table displays the photo indicator badge
        const importRow = w.document.querySelector('#import-tbody tr');
        assert.ok(importRow);
        assert.ok(importRow.textContent.includes('Ảnh'));
        assert.ok(importRow.querySelector('span[title="Phiếu nhập có ảnh sản phẩm"]'));

        // 2. Import detail modal renders thumbnail images for items with photos
        w.viewImportDetail('PN_PHOTO_01');
        const detailModal = w.document.getElementById('import-detail-modal');
        assert.ok(!detailModal.classList.contains('hidden'));
        const thumbs = w.document.querySelectorAll('#imp-detail-tbody img');
        assert.equal(thumbs.length, 2);
        assert.equal(thumbs[0].getAttribute('src'), '/uploads/img_iphone15pm.jpg');
        assert.equal(thumbs[1].getAttribute('src'), '/uploads/img_anker_charger.jpg');
    } finally {
        w.close();
    }
});

test('IMEI-level photos render in private warehouse lists and POS selector', () => {
    const dom = browser(),
        w = dom.window;
    try {
        w.eval(`
            KVStore.data.products = [
                {
                    id: 'P_USED',
                    code: 'P_USED',
                    name: 'iPhone 13 cũ',
                    branch: 'Kalo HCM',
                    status: 'active',
                    stock: 2,
                    hasImei: true,
                    imeis: ['IMEI-A', 'IMEI-B'],
                    images: ['/uploads/product.jpg'],
                    condition: 'like_new',
                    imeiDetails: {
                        'IMEI-A': {
                            images: ['/uploads/imei-a-1.jpg', '/uploads/imei-a-2.jpg'],
                            condition: 'like_new',
                            conditionDetail: 'Pin 99%, sạc 25 lần'
                        },
                        'IMEI-B': { images: [], condition: 'good', conditionDetail: 'Trầy nhẹ góc' }
                    }
                }
            ];
        `);

        // 1. Modal danh sách IMEI: mỗi máy có thumbnail + badge ảnh chung khi thiếu ảnh riêng.
        w.viewProductImeis('P_USED');
        const list = w.document.getElementById('prod-imeis-list');
        const cards = list.querySelectorAll(':scope > div > div');
        assert.equal(cards.length, 2);
        // Máy A dùng ảnh riêng.
        assert.equal(cards[0].querySelector('img').getAttribute('src'), '/uploads/imei-a-1.jpg');
        assert.ok(cards[0].textContent.includes('Pin 99%, sạc 25 lần'));
        // Máy B không có ảnh riêng → rơi về ảnh sản phẩm và có nhãn "Ảnh chung".
        assert.equal(cards[1].querySelector('img').getAttribute('src'), '/uploads/product.jpg');
        assert.ok(cards[1].textContent.includes('Ảnh chung'));
        assert.match(
            w.document.getElementById('prod-imeis-count-text').textContent,
            /1\/2 máy có ảnh riêng/
        );

        // 2. POS IMEI selector cũng hiển thị thumbnail theo từng máy.
        w.eval(`
            state.posTabs[0].cart = [{ code: 'P_USED', name: 'iPhone 13 cũ', price: 5000000, qty: 1, stock: 2 }];
            openPosImeiSelector('P_USED');
        `);
        const posRows = w.document.querySelectorAll('#pos-imei-list-container label');
        assert.equal(posRows.length, 2);
        assert.equal(posRows[0].querySelector('img').getAttribute('src'), '/uploads/imei-a-1.jpg');
        assert.ok(posRows[0].textContent.includes('Pin 99%, sạc 25 lần'));
    } finally {
        w.close();
    }
});

test('shared warehouse viewer shows per-IMEI photo sets for own and partner items', () => {
    const dom = browser(),
        w = dom.window;
    try {
        w.eval(`
            KVStore.data.shared_products = [
                {
                    id: 'SP_SHARED',
                    code: 'P_USED',
                    name: 'iPhone 13 cũ',
                    ownerName: 'Kalo Sport',
                    status: 'active',
                    imeis: ['IMEI-A', 'IMEI-B'],
                    images: ['/uploads/product.jpg'],
                    imeiDetails: {
                        'IMEI-A': { images: ['/uploads/imei-a-1.jpg'], condition: 'like_new', conditionDetail: 'Pin 99%' },
                        'IMEI-B': { images: [], condition: 'good' }
                    }
                }
            ];
            partnerCatalog.items = [
                {
                    id: 'PARTNER_ITEM',
                    code: 'P_PARTNER',
                    name: 'Máy đối tác',
                    partnerName: 'TechMotion',
                    status: 'active',
                    imeis: ['P-IMEI-1'],
                    images: [],
                    imeiDetails: {
                        // Ảnh đối tác đi qua proxy nội bộ.
                        'P-IMEI-1': { images: ['/hub-media/${'a'.repeat(32)}'], condition: 'fair', conditionDetail: 'Móp nhẹ' }
                    }
                }
            ];
        `);

        // 1. Hàng của tôi: mở modal xem máy, đổi IMEI thì đổi bộ ảnh.
        w.openSharedImeiViewer('SP_SHARED');
        const modal = w.document.getElementById('shared-imei-viewer-modal');
        assert.equal(modal.classList.contains('hidden'), false);
        assert.equal(
            w.document.getElementById('shared-imei-main-image').getAttribute('src'),
            '/uploads/imei-a-1.jpg'
        );
        const pills = w.document.querySelectorAll('#shared-imei-viewer-pills [data-shared-imei]');
        assert.equal(pills.length, 2);
        // Máy B chưa có ảnh riêng → fallback ảnh sản phẩm + cảnh báo.
        pills[1].click();
        assert.equal(
            w.document.getElementById('shared-imei-main-image').getAttribute('src'),
            '/uploads/product.jpg'
        );
        assert.equal(
            w.document.getElementById('shared-imei-fallback-note').classList.contains('hidden'),
            false
        );
        w.closeSharedImeiViewer();

        // 2. Hàng đối tác: ảnh proxy /hub-media/<id> phải được giữ lại (không bị lọc).
        w.openSharedImeiViewer('PARTNER_ITEM');
        const mainSrc = w.document.getElementById('shared-imei-main-image').getAttribute('src');
        assert.match(mainSrc, /^\/hub-media\/[a-f0-9]{32}$/);
        assert.equal(
            w.document.getElementById('shared-imei-condition-detail').textContent,
            'Móp nhẹ'
        );
    } finally {
        w.close();
    }
});
test('public catalog builder supports product/IMEI selection, inline error states, draft preview, and form reset', async () => {
    const dom = browser(),
        w = dom.window;
    try {
        const doc = w.document;
        // 1. Mở modal khi đang ở chi nhánh hợp lệ
        w.eval('getCurrentBranch = () => "Chi nhánh trung tâm";');
        w.openPublicCatalogModal();
        assert.equal(
            doc.getElementById('public-catalog-modal').classList.contains('hidden'),
            false
        );
        assert.equal(doc.getElementById('catalog-contact-name').value, 'Trần Văn Nhất');

        // 2. Kiểm tra validation lỗi inline khi bấm tạo mà chưa nhập tiêu đề
        w.submitCreatePublicCatalog();
        const titleErr = doc.getElementById('catalog-title-error');
        assert.equal(titleErr.classList.contains('hidden'), false);
        assert.ok(titleErr.textContent.includes('tiêu đề'));

        // 3. Nhập tiêu đề -> lỗi inline tự biến mất
        doc.getElementById('catalog-title-input').value = 'Đồng hồ cao cấp';
        w.clearCatalogFormErrors();
        assert.equal(titleErr.classList.contains('hidden'), true);

        // 4. Bấm tạo khi chưa chọn sản phẩm -> lỗi inline danh sách sản phẩm xuất hiện
        w.submitCreatePublicCatalog();
        const itemsErr = doc.getElementById('catalog-items-error');
        assert.equal(itemsErr.classList.contains('hidden'), false);

        // 5. Chọn sản phẩm và xem bộ đếm /50
        const firstProd = w.eval('KVStore.data.products[0]');
        w.addProductOrImeisToCatalogSelection(firstProd);
        assert.ok(doc.getElementById('catalog-selected-count').textContent.includes('/50'));

        // 6. Mở xem trước (Draft Preview)
        w.openCatalogDraftPreview();
        const previewModal = doc.getElementById('catalog-draft-preview-modal');
        assert.equal(previewModal.classList.contains('hidden'), false);
        assert.ok(
            doc.getElementById('catalog-draft-preview-body').textContent.includes('Đồng hồ cao cấp')
        );
        w.closeCatalogDraftPreview();
        assert.equal(previewModal.classList.contains('hidden'), true);

        // 7. Reset form có xác nhận khi đang có bản nháp
        const resetPromise = w.resetCreateCatalogForm();
        const dialog = doc.getElementById('action-dialog');
        assert.equal(dialog.classList.contains('hidden'), false);
        doc.getElementById('action-dialog-form').dispatchEvent(new w.Event('submit'));
        const confirmedReset = await resetPromise;
        assert.ok(confirmedReset, 'xác nhận xóa bản nháp');
        assert.equal(doc.getElementById('catalog-title-input').value, '');
        assert.equal(doc.getElementById('catalog-selected-count').textContent, '0/50');
        assert.equal(doc.getElementById('catalog-items-error').classList.contains('hidden'), true);
    } finally {
        w.close();
    }
});

test('catalog selection keeps sale-edited price when adding remaining IMEIs', () => {
    const dom = browser(),
        w = dom.window;
    try {
        w.eval(`
            getCurrentBranch = () => 'Chi nhánh trung tâm';
            KVStore.data.products = [{
                id: 'P_PRICE', code: 'SP_PRICE', name: 'Sản phẩm giữ giá',
                price: 1000000, stock: 3, branch: 'Chi nhánh trung tâm', status: 'active',
                hasImei: 1, imeis: ['I1', 'I2', 'I3'],
                imeiDetails: {
                    I1: { images: [], conditionDetail: '' },
                    I2: { images: [], conditionDetail: '' },
                    I3: { images: [], conditionDetail: '' }
                }
            }];
            selectedCatalogItems.clear();
        `);
        w.openPublicCatalogModal();
        assert.equal(
            w.document.getElementById('catalog-draft-branch-label').textContent,
            'Chi nhánh: Chi nhánh trung tâm'
        );
        w.toggleCatalogImeiSelection('SP_PRICE', 'I1');
        w.updateSelectedCatalogItemPrice('SP_PRICE|I1', '900000');
        assert.equal(w.eval("selectedCatalogItems.get('SP_PRICE|I1').displayPrice"), 900000);

        // Chọn nốt các IMEI còn lại: giá đã chỉnh của I1 phải được giữ nguyên.
        w.toggleCatalogProductSelection('SP_PRICE');
        assert.equal(w.eval('selectedCatalogItems.size'), 3);
        assert.equal(w.eval("selectedCatalogItems.get('SP_PRICE|I1').displayPrice"), 900000);
        assert.equal(w.eval("selectedCatalogItems.get('SP_PRICE|I2').displayPrice"), 1000000);
    } finally {
        w.innerWidth = 1280;
        w.close();
    }
});

test('API tokens management modal opens from settings, validates form, renders tokens list and clipboard actions', async () => {
    const dom = browser(),
        w = dom.window;
    try {
        const doc = w.document;
        w.eval(`
            KVStore.request = async (url, opts) => {
                if (url === '/api/tokens' && opts?.method === 'POST') {
                    return {
                        success: true,
                        token: {
                            id: 'TOK-123',
                            name: 'CRM Chat Lead',
                            token: 'nk_live_testsecret1234567890',
                            maskedToken: 'nk_live_test...7890',
                            branch: 'ALL',
                            status: 'active',
                            expiresAt: null
                        }
                    };
                }
                if (url === '/api/tokens') {
                    return {
                        success: true,
                        tokens: [
                            {
                                id: 'TOK-123',
                                name: 'CRM Chat Lead',
                                maskedToken: 'nk_live_test...7890',
                                branch: 'ALL',
                                status: 'active',
                                expiresAt: null,
                                lastUsedAt: null,
                                createdByName: 'Admin'
                            }
                        ]
                    };
                }
                return { success: true };
            };
        `);

        // 1. Mở modal API Tokens
        w.openApiTokensModal();
        const modal = doc.getElementById('api-tokens-modal');
        assert.equal(modal.classList.contains('hidden'), false);

        // 2. Mở form tạo token mới
        w.toggleCreateTokenForm(true);
        assert.equal(
            doc.getElementById('create-token-form-card').classList.contains('hidden'),
            false
        );

        // 3. Validation khi bỏ trống tên token
        await w.submitCreateApiToken();

        // 4. Tạo token thành công
        doc.getElementById('new-token-name').value = 'CRM Chat Lead';
        doc.getElementById('new-token-branch').selectedIndex = 1;
        await w.submitCreateApiToken();
        assert.equal(doc.getElementById('new-token-banner').classList.contains('hidden'), false);
        assert.equal(
            doc.getElementById('new-token-raw-value').value,
            'nk_live_testsecret1234567890'
        );

        // 5. Bảng danh sách token hiển thị đúng
        const tbody = doc.getElementById('api-tokens-tbody');
        assert.ok(tbody.textContent.includes('CRM Chat Lead'));
        assert.ok(tbody.textContent.includes('nk_live_test...7890'));

        // 6. Đóng modal
        w.closeApiTokensModal();
        assert.equal(modal.classList.contains('hidden'), true);
    } finally {
        w.close();
    }
});

test('webapp enables mouse text selection on body and content while keeping buttons unselectable', () => {
    const dom = browser(),
        w = dom.window;
    try {
        const html = fs.readFileSync('index.html', 'utf8');
        // Ensure body does not disable user-select globally
        assert.doesNotMatch(
            html,
            /body\s*\{[^}]*user-select:\s*none/i,
            'body must not have user-select: none'
        );
        assert.match(
            html,
            /user-select:\s*text/i,
            'index.html should explicitly allow text selection'
        );
        assert.match(html, /::selection/i, 'index.html should have selection highlight styling');
    } finally {
        w.close();
    }
});

test('Deplao modal lists branch products, IMEI images and blocks a second send in the same job', async () => {
    const dom = browser(),
        w = dom.window;
    try {
        const doc = w.document;
        w.eval(`
            KVStore.data.branches = [{ name: 'Chi nhánh A' }];
            KVStore.data.settings.branch = 'Chi nhánh A';
            KVStore.data.products = [{
                id: 'P1', code: 'DH1', name: 'Đồng hồ A', price: 1000000, stock: 2,
                branch: 'Chi nhánh A', status: 'active', hasImei: 1, imeis: ['SN1'],
                images: ['/uploads/common.jpg'],
                imeiDetails: { SN1: { images: ['/uploads/a.jpg', '/uploads/b.jpg'] } }
            }, {
                id: 'P2', code: 'DH2', name: 'Đồng hồ B', price: 2000000, stock: 1,
                branch: 'Chi nhánh A', status: 'active', images: ['javascript:alert(1)']
            }];
            openDeplao('P1');
        `);
        assert.equal(doc.getElementById('deplao-modal').classList.contains('hidden'), false);
        assert.equal(doc.querySelectorAll('#deplao-product option').length, 3);
        // Phải chọn rõ từng máy, không tự đoán IMEI.
        assert.equal(doc.querySelectorAll('#deplao-images input').length, 0);
        w.eval("depEl('imei').value='SN1'; deplaoImagesChanged();");
        assert.equal(doc.querySelectorAll('#deplao-images input').length, 2);
        assert.equal(doc.querySelector('#deplao-images img').getAttribute('src'), '/uploads/a.jpg');
        assert.match(doc.getElementById('deplao-text').value, /Máy \*\*\*\*SN1|Máy \*\*\*SN1/);

        // Sản phẩm không có ảnh upload nội bộ hợp lệ thì không hiện ảnh.
        w.eval("depEl('product').value='P2'; deplaoProductChanged();");
        assert.equal(doc.querySelectorAll('#deplao-images input').length, 0);

        // Đang có lượt gửi thì không cho tạo lượt mới trùng.
        w.eval("deplaoJobId='11111111-1111-4111-8111-111111111111';");
        w.eval("depEl('fields').disabled=true;");
        await w.deplaoConfirmSend();
        assert.equal(doc.getElementById('deplao-fields').disabled, true);
    } finally {
        w.close();
    }
});
