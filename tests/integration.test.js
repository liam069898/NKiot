'use strict';
require('./test-env');
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path'),
    vm = require('node:vm');
const { PassThrough } = require('node:stream');
const { JSDOM } = require('jsdom');
process.env.NKIOT_DB_PATH = process.env.MINIKIOT_DB_PATH = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'minikiot-integration-')),
    'test.db'
);
process.env.MINIKIOT_ADMIN_PASSWORD = 'Test-password-123';
const db = require('../db'),
    application = require('../application'),
    { handler } = require('../server');
const { hashPassword } = require('../security');
const seed = () => {
    const d = JSON.parse(JSON.stringify(require('../data').defaultData));
    for (const table of db.ENTITY_TABLES)
        if (!['branches', 'categories'].includes(table)) d[table] = [];
    d.products = [
        {
            id: 'P',
            code: 'P',
            name: 'Product',
            category: 'Test',
            price: 100000,
            costPrice: 50000,
            stock: 3,
            minStock: 0,
            unit: 'Chiếc',
            barcode: '',
            status: 'active',
            branch: 'Kalo HCM',
            hasImei: true,
            imeis: ['S1', 'S2', 'S3']
        }
    ];
    d.customers = [
        {
            id: 'C',
            code: 'C',
            name: 'Customer',
            phone: '000',
            address: '',
            debt: 0,
            totalSpent: 0,
            points: 0
        }
    ];
    d.suppliers = [
        { id: 'S', code: 'S', name: 'Supplier', phone: '', address: '', debt: 0, totalBought: 0 }
    ];
    d.users = [
        {
            id: 'ADMIN',
            code: 'ADMIN',
            name: 'Admin',
            username: 'admin',
            password: hashPassword('Test-password-123'),
            role: 'admin',
            roleName: 'Admin',
            phone: '',
            status: 'active',
            permissions: {},
            branch: 'Kalo HCM',
            branches: ['Kalo HCM', 'Chi nhánh Hà Nội']
        }
    ];
    return d;
};
before(() => db.initDb());
beforeEach(() => {
    db.saveAllData(seed());
    db.getDb().exec('DELETE FROM processed_requests');
});
after(() => db.getDb().close());
function browser() {
    const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
            url: 'http://localhost',
            runScripts: 'outside-only'
        }),
        w = dom.window;
    w.eval = (code) => vm.runInContext(code, dom.getInternalVMContext());
    w.confirm = () => true;
    w.prompt = () => null;
    w.print = () => {};
    let cookie = '';
    const bridge = { loseNextCommand: false, commands: [] };
    w.fetch = async (url, options = {}) =>
        new Promise((resolve, reject) => {
            const req = new PassThrough();
            req.method = options.method || 'GET';
            req.url = url;
            const extra = Object.fromEntries(
                Object.entries(options.headers || {}).map(([k, v]) => [k.toLowerCase(), v])
            );
            req.headers = {
                ...extra,
                host: 'localhost',
                'content-type': 'application/json',
                cookie
            };
            req.socket = { remoteAddress: '127.0.0.1' };
            const response = {
                headersSent: false,
                setHeader(name, value) {
                    if (name.toLowerCase() === 'set-cookie') cookie = value.split(';')[0];
                },
                writeHead(status) {
                    this.status = status;
                    this.headersSent = true;
                },
                end(body) {
                    if (url === '/api/command') bridge.commands.push(JSON.parse(body));
                    if (url === '/api/command' && bridge.loseNextCommand) {
                        bridge.loseNextCommand = false;
                        reject(new Error('Response lost'));
                        return;
                    }
                    resolve({
                        ok: this.status < 400,
                        status: this.status,
                        json: async () => JSON.parse(body)
                    });
                }
            };
            handler(req, response).catch(reject);
            req.end(options.body || '');
        });
    for (const file of [
        'constants.js',
        'catalog-patch.js',
        'ui-safety.js',
        'client-store.js',
        'app-utils.js',
        'app-reports.js',
        'app-export.js',
        'app.js'
    ])
        w.eval(
            fs
                .readFileSync(file, 'utf8')
                .replace("window.addEventListener('DOMContentLoaded', initApp);", '')
        );
    return { dom, w, bridge, close: () => w.close() };
}
async function login(b) {
    await b.w.initApp();
    b.w.document.getElementById('login-username').value = 'admin';
    b.w.document.getElementById('login-password').value = 'Test-password-123';
    await b.w.handleLoginSubmit({ preventDefault() {} });
    assert.equal(b.w.eval('KVStore.user.username'), 'admin');
}
function setValue(w, id, value) {
    w.document.getElementById(id).value = value;
}
function cart(w) {
    w.eval('addPosCartItem(KVStore.data.products[0])');
}
test('real login -> POS -> discounted credit return persists correct inventory, money and serials', async () => {
    const b = browser();
    try {
        await login(b);
        cart(b.w);
        b.w.eval(
            'selectPosCustomer(KVStore.data.customers[0]);state.posTabs[0].discount=20000;state.posTabs[0].customerGiven=30000'
        );
        await b.w.checkoutPos();
        let d = db.getAllData();
        assert.equal(d.invoices.length, 1);
        assert.equal(d.customers[0].debt, 50000);
        assert.equal(d.products[0].stock, 2);
        b.w.openReturnModal(d.invoices[0].code);
        await b.w.submitReturnGoods();
        d = db.getAllData();
        assert.equal(d.products[0].stock, 3);
        assert.equal(d.customers[0].debt, 0);
        assert.equal(d.returns[0].totalRefund, 30000);
        assert.equal(d.returns[0].returnValue, 80000);
    } finally {
        b.close();
    }
});
test('command responses carry only changed rows and the browser ends with the exact server view', async () => {
    const b = browser();
    try {
        await login(b);
        const serverView = () => {
            const snap = db.readSnapshot();
            return JSON.stringify(
                application.project(
                    snap,
                    snap.users.find((u) => u.id === 'ADMIN')
                )
            );
        };
        cart(b.w);
        b.w.eval('selectPosCustomer(KVStore.data.customers[0])');
        await b.w.checkoutPos();
        b.w.openReturnModal(db.getAllData().invoices[0].code);
        await b.w.submitReturnGoods();
        assert.equal(b.bridge.commands.length, 2);
        for (const response of b.bridge.commands) {
            assert.ok(response.delta, 'delta response');
            assert.equal(response.data, undefined);
            assert.equal(response.revision, response.base + 1);
        }
        assert.ok(b.bridge.commands[0].delta.invoices.prepend);
        assert.equal(b.w.eval('JSON.stringify(KVStore._base)'), serverView());
        assert.equal(b.w.eval('KVStore.revision'), application.revision());
        // A delta that does not fit the local base must fall back to a full reload.
        await b.w.eval(
            "KVStore.adoptResult({user: KVStore.user, revision: KVStore.revision, base: KVStore.revision, delta: {invoices: {remove: ['NOPE'], length: 0}}})"
        );
        assert.equal(b.w.eval('JSON.stringify(KVStore._base)'), serverView());
    } finally {
        b.close();
    }
});
test('catalog add, settings save and staff create roundtrip through actual HTTP handler', async () => {
    const b = browser();
    try {
        await login(b);
        b.w.openAddProductModal();
        setValue(b.w, 'prod-code', 'NEW');
        setValue(b.w, 'prod-name', 'Name <img src=x onerror=alert(1)>');
        setValue(b.w, 'prod-price', '200000');
        await b.w.saveProductFromModal({ preventDefault() {} });
        assert.equal(db.getAllData().products.filter((p) => p.code === 'NEW').length, 2);
        assert.equal(db.getAllData().products.length, 3);
        assert.equal(b.w.document.querySelector('#products-tbody img'), null);
        b.w.openSettingsModal();
        setValue(b.w, 'set-bank-account', '00123456789');
        await b.w.saveSettingsFromModal({ preventDefault() {} });
        assert.equal(db.getAllData().settings.bankAccount, '00123456789');
        b.w.openBillCustomModal();
        b.w.applyBillPreset('tech');
        await b.w.saveBillCustomConfig();
        const savedSettings = db.getAllData().settings;
        assert.ok(savedSettings.billConfig);
        const parsedBillCfg = JSON.parse(savedSettings.billConfig);
        assert.equal(parsedBillCfg.paperSize, 'k80');
        assert.equal(parsedBillCfg.showImei, true);
        b.w.openStaffFormModal();
        setValue(b.w, 'staff-input-name', 'New cashier');
        setValue(b.w, 'staff-input-username', 'newcashier');
        setValue(b.w, 'staff-input-password', 'New-password-123');
        b.w.document.querySelector('input[name="staff-branch-cb"]').checked = true;
        await b.w.saveStaffSubmit({ preventDefault() {} });
        assert.equal(db.getAllData().users.length, 2);
        assert.match(
            db.getAllData().users.find((u) => u.username === 'newcashier').password,
            /^scrypt\$/
        );
        assert.ok(!b.w.eval('JSON.stringify(KVStore.data)').includes('scrypt$'));
        for (let i = 0; i < b.w.localStorage.length; i++)
            assert.ok(
                !b.w.localStorage.getItem(b.w.localStorage.key(i)).includes('New-password-123')
            );
    } finally {
        b.close();
    }
});
test('committed sale with lost response is recovered exactly once and clears original cart', async () => {
    const b = browser();
    try {
        await login(b);
        cart(b.w);
        b.bridge.loseNextCommand = true;
        await b.w.checkoutPos();
        assert.equal(db.getAllData().invoices.length, 1);
        assert.equal(b.w.eval('KVStore.pending().length'), 1);
        assert.equal(b.w.eval('state.posTabs[0].cart.length'), 1);
        assert.equal(b.w.document.getElementById('pos-checkout-btn').disabled, true);
        await b.w.forceSyncDatabase();
        assert.equal(db.getAllData().invoices.length, 1);
        assert.equal(b.w.eval('KVStore.pending().length'), 0);
        assert.equal(b.w.eval('state.posTabs[0].cart.length'), 0);
        assert.equal(b.w.eval('state.posTabs[0].tenderEdited'), false);
        assert.equal(b.w.document.getElementById('pos-checkout-btn').disabled, false);
    } finally {
        b.close();
    }
});
test('two browser instances cannot overwrite each other and conflict keeps unsent cart', async () => {
    const a = browser(),
        b = browser();
    try {
        await login(a);
        await login(b);
        cart(a.w);
        cart(b.w);
        await a.w.checkoutPos();
        await b.w.checkoutPos();
        assert.equal(db.getAllData().invoices.length, 1);
        assert.equal(b.w.eval('state.posTabs[0].cart.length'), 1);
        assert.equal(b.w.eval('KVStore.recoveryData().rejected.length'), 1);
        await b.w.checkoutPos();
        assert.equal(db.getAllData().invoices.length, 2);
        assert.equal(db.getAllData().products[0].stock, 1);
    } finally {
        a.close();
        b.close();
    }
});
test('sensitive staff command never puts credentials in pending browser storage', async () => {
    const b = browser();
    try {
        await login(b);
        b.w.openStaffFormModal();
        setValue(b.w, 'staff-input-name', 'New user');
        setValue(b.w, 'staff-input-username', 'newuser');
        setValue(b.w, 'staff-input-password', 'Secret-test-123');
        b.w.document.querySelector('input[name="staff-branch-cb"]').checked = true;
        b.bridge.loseNextCommand = true;
        await b.w.saveStaffSubmit({ preventDefault() {} });
        assert.equal(db.getAllData().users.length, 2);
        for (let i = 0; i < b.w.localStorage.length; i++)
            assert.ok(
                !b.w.localStorage.getItem(b.w.localStorage.key(i)).includes('Secret-test-123')
            );
        b.w.eval('KVStore._volatilePending.clear()');
        await b.w.forceSyncDatabase();
        assert.equal(b.w.eval('KVStore.pending().length'), 0);
        assert.equal(db.getAllData().users.length, 2);
    } finally {
        b.close();
    }
});
test('product codes synchronize across all branches when created or when new branch is added', async () => {
    const b = browser();
    try {
        await login(b);
        b.w.openAddProductModal();
        setValue(b.w, 'prod-code', 'SP_SYNC_TEST');
        setValue(b.w, 'prod-name', 'Sản phẩm Test Đồng Bộ');
        setValue(b.w, 'prod-price', '150000');
        await b.w.saveProductFromModal({ preventDefault() {} });

        const prodsAfterAdd = db.getAllData().products.filter((p) => p.code === 'SP_SYNC_TEST');
        assert.equal(prodsAfterAdd.length, 2);
        const hcmProd = prodsAfterAdd.find((p) => (p.branch || 'Kalo HCM') === 'Kalo HCM');
        const hnProd = prodsAfterAdd.find((p) => p.branch === 'Chi nhánh Hà Nội');
        assert.ok(hcmProd);
        assert.ok(hnProd);
        assert.equal(hnProd.stock, 0);
        assert.deepEqual(hnProd.imeis, []);
        assert.equal(hnProd.name, 'Sản phẩm Test Đồng Bộ');

        b.w.openAddBranchModal();
        setValue(b.w, 'branch-code-input', 'CN_DN');
        setValue(b.w, 'branch-name-input', 'Chi nhánh Đà Nẵng');
        await b.w.saveBranchFromModal({ preventDefault() {} });

        const prodsAfterBranch = db.getAllData().products.filter((p) => p.code === 'SP_SYNC_TEST');
        assert.equal(prodsAfterBranch.length, 3);
        const dnProd = prodsAfterBranch.find((p) => p.branch === 'Chi nhánh Đà Nẵng');
        assert.ok(dnProd);
        assert.equal(dnProd.stock, 0);
        assert.deepEqual(dnProd.imeis, []);
    } finally {
        b.close();
    }
});

test('editing a created branch updates branch information and persists', async () => {
    const b = browser();
    try {
        await login(b);

        // 1. Create a new branch
        b.w.openAddBranchModal();
        setValue(b.w, 'branch-code-input', 'CN_HP');
        setValue(b.w, 'branch-name-input', 'Chi nhánh Hải Phòng');
        setValue(b.w, 'branch-phone-input', '0912345678');
        setValue(b.w, 'branch-address-input', '12 Lạch Tray, Hải Phòng');
        setValue(b.w, 'branch-note-input', 'Chi nhánh mới tạo');
        await b.w.saveBranchFromModal({ preventDefault() {} });

        let hpBranch = db.getAllData().branches.find((br) => br.code === 'CN_HP');
        assert.ok(hpBranch);
        assert.equal(hpBranch.name, 'Chi nhánh Hải Phòng');
        assert.equal(hpBranch.phone, '0912345678');
        assert.equal(hpBranch.address, '12 Lạch Tray, Hải Phòng');

        // 2. Edit the created branch
        b.w.openEditBranchModal('CN_HP');
        assert.equal(b.w.document.getElementById('branch-edit-id').value, 'CN_HP');
        assert.equal(b.w.document.getElementById('branch-name-input').value, 'Chi nhánh Hải Phòng');
        setValue(b.w, 'branch-name-input', 'Chi nhánh Hải Phòng - Lê Chân');
        setValue(b.w, 'branch-phone-input', '0988776655');
        setValue(b.w, 'branch-address-input', '99 Lê Chân, Hải Phòng');
        setValue(b.w, 'branch-note-input', 'Đã cập nhật địa chỉ');
        b.w.document.getElementById('branch-default-input').checked = true;
        await b.w.saveBranchFromModal({ preventDefault() {} });

        hpBranch = db.getAllData().branches.find((br) => br.code === 'CN_HP');
        assert.ok(hpBranch);
        assert.equal(hpBranch.name, 'Chi nhánh Hải Phòng - Lê Chân');
        assert.equal(hpBranch.phone, '0988776655');
        assert.equal(hpBranch.address, '99 Lê Chân, Hải Phòng');
        assert.equal(hpBranch.note, 'Đã cập nhật địa chỉ');
        assert.equal(hpBranch.isDefault, true);

        // Other branches should not be default
        const otherBranches = db.getAllData().branches.filter((br) => br.code !== 'CN_HP');
        assert.ok(otherBranches.every((br) => !br.isDefault));
    } finally {
        b.close();
    }
});

test('catalog save sends a small patch, retains pending payload and reconciles lost response', async () => {
    const b = browser();
    try {
        await login(b);
        const originalRequest = b.w.fetch;
        let envelope;
        b.w.fetch = (url, options) => {
            if (url === '/api/command') envelope = JSON.parse(options.body);
            return originalRequest(url, options);
        };
        b.w.eval("KVStore.data.customers[0].name='Patch customer'");
        b.bridge.loseNextCommand = true;
        await assert.rejects(b.w.eval('KVStore.save()'));
        assert.equal(envelope.type, 'catalogPatch');
        assert.deepEqual(Object.keys(envelope.payload.tables), ['customers']);
        assert.equal(JSON.stringify(envelope).includes('invoices'), false);
        const rev = application.revision();
        b.w.eval("KVStore.data.customers[0].name='Unsent later draft'");
        await b.w.forceSyncDatabase();
        assert.equal(application.revision(), rev);
        assert.equal(b.w.eval('KVStore.pending().length'), 0);
        assert.equal(db.getAllData().customers[0].name, 'Patch customer');
        assert.equal(b.w.eval('KVStore.data.customers[0].name'), 'Patch customer');
    } finally {
        b.close();
    }
});

test('concurrent catalog patches conflict instead of overwriting a newer change', async () => {
    const a = browser(),
        b = browser();
    try {
        await login(a);
        await login(b);
        a.w.eval("KVStore.data.customers[0].name='First writer'");
        b.w.eval("KVStore.data.customers[0].name='Stale writer'");
        await a.w.eval('KVStore.save()');
        await assert.rejects(b.w.eval('KVStore.save()'), { status: 409 });
        assert.equal(db.getAllData().customers[0].name, 'First writer');
        assert.equal(b.w.eval('KVStore.recoveryData().rejected.length'), 1);
    } finally {
        a.close();
        b.close();
    }
});

test('rejected staff patches never persist passwords and unchanged saves make no request', async () => {
    const b = browser();
    try {
        await login(b);
        let commands = 0;
        const fetch = b.w.fetch;
        b.w.fetch = (url, options) => {
            if (url === '/api/command') commands++;
            return fetch(url, options);
        };
        const rev = application.revision();
        await b.w.eval('KVStore.save()');
        assert.equal(commands, 0);
        assert.equal(application.revision(), rev);
        b.w.eval(
            "KVStore.data.users[0].password='Never-store-123'; KVStore.data.users[0].status='locked'"
        );
        await assert.rejects(b.w.eval('KVStore.save()'), { status: 422 });
        for (let i = 0; i < b.w.localStorage.length; i++)
            assert.ok(
                !b.w.localStorage.getItem(b.w.localStorage.key(i)).includes('Never-store-123')
            );
        assert.equal(b.w.eval('KVStore.recoveryData().rejected.length'), 1);
        b.w.eval('KVStore.isDbConnected=false');
        await assert.rejects(b.w.eval('KVStore.save()'), /Cần kết nối/);
    } finally {
        b.close();
    }
});

test('invoice paging uses real HTTP filters and refreshes full details before actions', async () => {
    const b = browser();
    try {
        await login(b);
        const data = db.getAllData();
        data.invoices = Array.from({ length: 65 }, (_, i) => ({
            id: `PAGE${i}`,
            code: `PAGE${i}`,
            branch: 'Kalo HCM',
            customer: 'Khách',
            phone: '090',
            time: '01/01/2026 10:00',
            status: 'completed',
            total: 100,
            paid: 100,
            items: [{ code: 'P', name: 'Product', qty: 1, price: 100, total: 100, costPrice: 50 }]
        }));
        db.saveAllData(data);
        db.getDb()
            .prepare("UPDATE app_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'")
            .run();
        await b.w.renderInvoices();
        assert.equal(b.w.document.querySelectorAll('#invoice-tbody tr').length, 50);
        await b.w.changeInvoicePage(1);
        assert.equal(b.w.document.querySelectorAll('#invoice-tbody tr').length, 15);
        assert.ok(b.w.document.getElementById('invoice-tbody').textContent.includes('PAGE50'));
        await b.w.openInvoiceDetailByCode('PAGE50');
        assert.equal(b.w.eval('state.selectedInvoice.items.length'), 1);
        assert.equal(b.w.eval('KVStore.revision'), application.revision());
        b.w.document.getElementById('invoice-search-input').value = 'PAGE64';
        await b.w.renderInvoices();
        assert.equal(b.w.document.querySelectorAll('#invoice-tbody tr').length, 1);
    } finally {
        b.close();
    }
});

test('return UI submits the selected serial and excludes previously returned devices', async () => {
    const b = browser();
    try {
        await login(b);
        const inv = await b.w.eval(`KVStore.command('sale', {
            branch: 'Kalo HCM', items: [{code: 'P', qty: 2, imeis: ['S1', 'S2']}], given: 200000
        })`);
        b.w.openReturnModal(inv.code);
        const select = b.w.document.getElementById('ret-imeis-0');
        for (const option of select.options) option.selected = option.value === 'S2';
        select.dispatchEvent(new b.w.Event('change'));
        assert.equal(b.w.document.getElementById('ret-qty-0').value, '1');
        await b.w.submitReturnGoods();
        assert.deepEqual(db.getAllData().returns[0].items[0].imeis, ['S2']);
        assert.deepEqual(db.getAllData().products[0].imeis, ['S3', 'S2']);
        b.w.openReturnModal(inv.code);
        assert.deepEqual(
            Array.from(b.w.document.getElementById('ret-imeis-0').options, (o) => o.value),
            ['S1']
        );
    } finally {
        b.close();
    }
});

test('import workspace records selected devices and partial payment, then recovers a lost response once', async () => {
    const b = browser();
    try {
        await login(b);
        b.w.openCreateImportModal();
        b.w.document.getElementById('import-ncc-select').value = 'S';
        b.w.selectImportProduct('P');
        b.w.addImeisToItem('P', ['NEW-1', 'NEW-2']);
        b.w.updateImportItemPrice('P', 60000);
        b.w.document.getElementById('import-payment-state').value = 'partial';
        b.w.updateImportPayment();
        b.w.document.getElementById('import-paid-input').value = '20000';
        b.bridge.loseNextCommand = true;
        await b.w.saveNewImport();
        assert.equal(db.getAllData().imports.length, 1);
        assert.equal(db.getAllData().imports[0].paid, 20000);
        assert.equal(db.getAllData().suppliers[0].debt, 100000);
        assert.equal(b.w.document.getElementById('import-save').disabled, true);
        await b.w.saveNewImport();
        assert.equal(db.getAllData().imports.length, 1);
        await b.w.reconcileImport();
        assert.equal(db.getAllData().imports.length, 1);
        assert.equal(b.w.eval('currentImportItems.length'), 0);
        assert.equal(b.w.eval('KVStore.pending().length'), 0);
        assert.equal(db.getAllData().products[0].stock, 5);
    } finally {
        b.close();
    }
});

test('creating a product from import uses its selected receiving branch without changing navigation', async () => {
    const b = browser();
    try {
        await login(b);
        b.w.openCreateImportModal();
        const original = b.w.getCurrentBranch();
        const branch = b.w.document.getElementById('import-branch');
        branch.value = 'Chi nhánh Hà Nội';
        b.w.changeImportBranch();
        b.w.openAddProductFromImport();
        setValue(b.w, 'prod-code', 'IMPORT-NEW');
        setValue(b.w, 'prod-name', 'New receiving branch product');
        setValue(b.w, 'prod-price', '200000');
        await b.w.saveProductFromModal({ preventDefault() {} });
        assert.equal(b.w.getCurrentBranch(), original);
        assert.equal(b.w.getImportBranch(), 'Chi nhánh Hà Nội');
        assert.equal(b.w.eval('currentImportItems[0].code'), 'IMPORT-NEW');
        assert.ok(
            db
                .getAllData()
                .products.some((p) => p.code === 'IMPORT-NEW' && p.branch === 'Chi nhánh Hà Nội')
        );
    } finally {
        b.close();
    }
});
