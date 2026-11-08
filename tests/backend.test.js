'use strict';
require('./test-env');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path'),
    crypto = require('node:crypto');
const { PassThrough } = require('node:stream');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minikiot-test-'));
process.env.NKIOT_DB_PATH = process.env.MINIKIOT_DB_PATH = path.join(dir, 'test.db');
process.env.NKIOT_UPLOADS_DIR = path.join(dir, 'uploads');
process.env.MINIKIOT_ADMIN_PASSWORD = 'Test-password-123';
const db = require('../db'),
    { hashPassword } = require('../security'),
    app = require('../application'),
    { handler } = require('../server');
const { defaultData } = require('../data');
let admin;
function fixture() {
    const d = JSON.parse(JSON.stringify(defaultData));
    for (const k of db.ENTITY_TABLES) d[k] = [];
    d.branches = [
        { id: 'A', code: 'A', name: 'A' },
        { id: 'B', code: 'B', name: 'B' }
    ];
    d.settings = { ...defaultData.settings, branch: 'A' };
    d.products = [
        {
            id: 'SP',
            code: 'SP',
            name: 'Product',
            branch: 'A',
            stock: 3,
            price: 100000,
            costPrice: 50000,
            unit: 'Chiếc',
            category: 'Test',
            status: 'active',
            hasImei: true,
            imeis: ['I1', 'I2', 'I3'],
            minStock: 0
        }
    ];
    d.customers = [
        { id: 'C', code: 'C', name: 'Customer', phone: '000', debt: 0, totalSpent: 0, points: 0 }
    ];
    d.suppliers = [{ id: 'S', code: 'S', name: 'Supplier', phone: '', debt: 0, totalBought: 0 }];
    d.users = [
        {
            id: 'ADMIN',
            code: 'ADMIN',
            name: 'Admin',
            username: 'admin',
            password: hashPassword('Test-password-123'),
            role: 'admin',
            status: 'active',
            permissions: {},
            branch: 'A',
            branches: ['A', 'B']
        }
    ];
    return d;
}
function command(
    type,
    payload,
    revision = app.revision(),
    requestId = crypto.randomUUID(),
    user = admin
) {
    return app.transact(user, { type, payload, revision, requestId });
}
const sell = (opts = {}) =>
    command('sale', {
        branch: 'A',
        items: [{ code: 'SP', qty: 1 }],
        discount: 0,
        given: 100000,
        paymentMethod: 'cash',
        ...opts
    }).result;
async function request(method, url, input, cookie, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
        const req = new PassThrough();
        req.method = method;
        req.url = url;
        req.headers = {
            host: 'localhost',
            'content-type': 'application/json',
            ...(cookie ? { cookie } : {}),
            ...extraHeaders
        };
        req.socket = { remoteAddress: '127.0.0.1' };
        const headers = {};
        const res = {
            headersSent: false,
            setHeader(k, v) {
                headers[k.toLowerCase()] = v;
            },
            writeHead(status, h) {
                this.status = status;
                Object.assign(headers, h);
                this.headersSent = true;
            },
            end(body) {
                let json;
                try {
                    json = JSON.parse(body);
                } catch {}
                resolve({ status: this.status, headers, body, json });
            }
        };
        handler(req, res).catch(reject);
        req.end(input === undefined ? '' : JSON.stringify(input));
    });
}
before(() => db.initDb());
beforeEach(() => {
    db.saveAllData(fixture());
    db.getDb().exec('DELETE FROM processed_requests');
    admin = db.getAllData().users[0];
});
after(() => db.getDb().close());
test('POS health response has baseline security headers and report-only CSP', async () => {
    const response = await request('GET', '/health');
    assert.equal(response.status, 200);
    assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(response.headers['X-Frame-Options'], 'DENY');
    assert.equal(response.headers['Referrer-Policy'], 'same-origin');
    assert.match(response.headers['Content-Security-Policy-Report-Only'], /default-src 'self'/);
    assert.equal(response.headers['Content-Security-Policy'], undefined);
});

test('POS accepts an authorized custom sale price while retaining list-price validation', () => {
    const data = db.getAllData();
    data.products[0].price = 0;
    data.users[0].permissions.posPrice = true;
    db.saveAllData(data);
    admin = db.getAllData().users[0];

    const invoice = sell({
        items: [{ code: 'SP', qty: 1, expectedPrice: 0, salePrice: 100000 }],
        given: 100000
    });
    assert.equal(invoice.items[0].price, 100000);
    assert.equal(invoice.total, 100000);
});
test('POS rejects custom sale price without posPrice permission', () => {
    const data = db.getAllData();
    const cashier = {
        ...admin,
        id: 'CASHIER',
        code: 'CASHIER',
        username: 'cashier',
        role: 'cashier',
        branch: 'A',
        branches: ['A'],
        permissions: { pos: true }
    };
    data.users.push(cashier);
    db.saveAllData(data);
    assert.throws(
        () =>
            command(
                'sale',
                {
                    branch: 'A',
                    items: [{ code: 'SP', qty: 1, expectedPrice: 100000, salePrice: 90000 }],
                    given: 90000,
                    paymentMethod: 'cash'
                },
                app.revision(),
                crypto.randomUUID(),
                cashier
            ),
        { message: 'Bạn không có quyền thực hiện thao tác này.', status: 403 }
    );
});
test('POS still rejects stale list price when custom sale price is supplied', () => {
    assert.throws(
        () => sell({ items: [{ code: 'SP', qty: 1, expectedPrice: 0, salePrice: 100000 }] }),
        { message: 'Giá bán đã thay đổi. Hãy cập nhật sản phẩm trong giỏ.', status: 409 }
    );
});
test('empty catalog survives restart and passwords are migrated', () => {
    const d = db.getAllData();
    d.products = [];
    d.invoices = [{ id: 'KEEP', code: 'KEEP', items: [], total: 0 }];
    d.users[0].password = 'legacy';
    db.saveAllData(d);
    db.initDb();
    assert.equal(db.getAllData().invoices[0].id, 'KEEP');
    assert.match(db.getAllData().users[0].password, /^scrypt\$/);
});
test('all extended invoice/customer fields survive SQLite roundtrip', () => {
    const d = db.getAllData();
    d.invoices = [
        {
            id: 'I',
            code: 'I',
            items: [],
            paymentMethod: 'card',
            customerId: 'C',
            note: 'n',
            hasReturned: true,
            cancelReason: 'r',
            cancelTime: 't',
            returnedTotal: 123
        }
    ];
    d.customers[0].note = 'customer note';
    db.saveAllData(d);
    assert.equal(db.getAllData().invoices[0].returnedTotal, 123);
    assert.equal(db.getAllData().invoices[0].paymentMethod, 'card');
    assert.equal(db.getAllData().customers[0].note, 'customer note');
});
test('stale snapshot is rejected, preserving committed invoice', () => {
    const rev = app.revision(),
        old = app.project(db.getAllData(), admin);
    sell();
    old.customers[0].name = 'changed';
    assert.throws(
        () => command('edit', old, rev),
        (e) => e.status === 409
    );
    assert.equal(db.getAllData().invoices.length, 1);
});
test('same request retries once, different payload cannot reuse id', () => {
    const id = crypto.randomUUID(),
        rev = app.revision(),
        payload = {
            branch: 'A',
            items: [{ code: 'SP', qty: 1 }],
            discount: 0,
            given: 100000,
            paymentMethod: 'cash'
        };
    command('sale', payload, rev, id);
    assert.equal(command('sale', payload, rev, id).replayed, true);
    assert.equal(db.getAllData().invoices.length, 1);
    assert.throws(
        () => command('sale', { ...payload, given: 0 }, rev, id),
        (e) => e.status === 409
    );
});
test('stock and retail underpayment failures leave no partial changes', () => {
    assert.throws(() => sell({ items: [{ code: 'SP', qty: 4 }], given: 400000 }));
    assert.throws(() => sell({ given: 0 }));
    const d = db.getAllData();
    assert.equal(d.products[0].stock, 3);
    assert.equal(d.products[0].imeis.length, 3);
    assert.equal(d.invoices.length, 0);
    assert.equal(d.cashbook.length, 0);
});
test('sale snapshots serial and historic cost; discounted credit return settles debt first', () => {
    const inv = sell({ discount: 20000, given: 30000, customerId: 'C' });
    assert.deepEqual(inv.items[0].imeis, ['I1']);
    assert.equal(inv.items[0].costPrice, 50000);
    const r = command('return', {
        invoiceId: inv.id,
        items: [{ code: 'SP', qty: 1, imeis: ['I1'] }],
        refundMethod: 'cash'
    }).result;
    assert.equal(r.totalRefund, 30000);
    assert.equal(r.returnValue, 80000);
    assert.equal(r.debtReduction, 50000);
    const d = db.getAllData();
    assert.equal(d.customers[0].debt, 0);
    assert.equal(d.customers[0].totalSpent, 0);
    assert.equal(d.products[0].stock, 3);
    assert.deepEqual(d.products[0].imeis.sort(), ['I1', 'I2', 'I3']);
    assert.throws(() => command('return', { invoiceId: inv.id, items: [{ code: 'SP', qty: 1 }] }));
    command('cancel', { invoiceId: inv.id });
    assert.equal(db.getAllData().products[0].stock, 3);
    assert.equal(db.getAllData().cashbook.filter((c) => c.type === 'chi').length, 1);
});
test('sale snapshots item note alongside price and serials', () => {
    const inv = sell({
        items: [{ code: 'SP', qty: 1, note: 'Bảo hành 12 tháng, tặng kèm cáp sạc' }],
        given: 100000
    });
    assert.equal(inv.items[0].note, 'Bảo hành 12 tháng, tặng kèm cáp sạc');
    command('cancel', { invoiceId: inv.id });
});
test('partial return then cancel refunds only remainder', () => {
    const inv = sell({ items: [{ code: 'SP', qty: 3 }], discount: 10000, given: 290000 });
    command('return', { invoiceId: inv.id, items: [{ code: 'SP', qty: 1, imeis: ['I1'] }] });
    command('cancel', { invoiceId: inv.id });
    const d = db.getAllData();
    assert.equal(
        d.cashbook.filter((c) => c.type === 'chi').reduce((s, c) => s + c.amount, 0),
        290000
    );
    assert.equal(d.products[0].stock, 3);
    assert.throws(() => command('cancel', { invoiceId: inv.id }));
});
test('customer id prevents cancellation against another customer with same name', () => {
    const d = db.getAllData();
    d.customers.unshift({
        ...d.customers[0],
        id: 'OTHER',
        code: 'OTHER',
        phone: '999',
        debt: 300000
    });
    db.saveAllData(d);
    const inv = sell({ given: 0, customerId: 'C' });
    command('cancel', { invoiceId: inv.id });
    const after = db.getAllData();
    assert.equal(after.customers.find((c) => c.id === 'OTHER').debt, 300000);
    assert.equal(after.customers.find((c) => c.id === 'C').debt, 0);
});
test('debt collection allocates invoice payments and later cancel returns collected money', () => {
    const inv = sell({ given: 0, customerId: 'C' });
    command('debt', { branch: 'A', partnerId: 'C', type: 'thu', amount: 100000, method: 'cash' });
    assert.equal(db.getAllData().invoices[0].paid, 100000);
    command('cancel', { invoiceId: inv.id });
    assert.equal(db.getAllData().cashbook.find((c) => c.type === 'chi').amount, 100000);
});
test('receive assigns distinct product IDs to multiple new destination products', () => {
    const d = db.getAllData();
    d.products.push({
        ...d.products[0],
        id: 'SP2',
        code: 'SP2',
        name: 'Second product',
        hasImei: false,
        imeis: [],
        stock: 2
    });
    db.saveAllData(d);
    const transfer = command('transfer', {
        fromBranch: 'A',
        toBranch: 'B',
        items: [
            { code: 'SP', qty: 1 },
            { code: 'SP2', qty: 1 }
        ]
    }).result;
    command('receive', { id: transfer.id });
    const received = db
        .getAllData()
        .products.filter((p) => p.branch === 'B' && ['SP', 'SP2'].includes(p.code));
    assert.equal(received.length, 2);
    assert.equal(new Set(received.map((p) => p.id)).size, 2);
});

test('transfer carries serials, rejects receive twice, updates weighted cost', () => {
    const d = db.getAllData();
    d.products.push({
        ...d.products[0],
        id: 'BSP',
        branch: 'B',
        stock: 1,
        costPrice: 100000,
        imeis: ['B1']
    });
    db.saveAllData(d);
    const transfer = command('transfer', {
        fromBranch: 'A',
        toBranch: 'B',
        items: [{ code: 'SP', qty: 1 }]
    }).result;
    assert.equal(db.getAllData().products.find((p) => p.branch === 'A').imeis.length, 2);
    command('receive', { id: transfer.id });
    const dest = db.getAllData().products.find((p) => p.branch === 'B');
    assert.equal(dest.costPrice, 75000);
    assert.deepEqual(dest.imeis, ['B1', 'I1']);
    assert.throws(() => command('receive', { id: transfer.id }));
});
test('receiving a discontinued product keeps it discontinued at the destination', () => {
    const d = db.getAllData();
    d.products[0].status = 'archived';
    db.saveAllData(d);
    const transfer = command('transfer', {
        fromBranch: 'A',
        toBranch: 'B',
        items: [{ code: 'SP', qty: 1 }]
    }).result;
    // Legacy transfer without a status snapshot falls back to the source product.
    const legacy = command('transfer', {
        fromBranch: 'A',
        toBranch: 'B',
        items: [{ code: 'SP', qty: 1 }]
    }).result;
    const raw = db.getAllData();
    delete raw.transfers.find((t) => t.id === legacy.id).items[0].productSnapshot.status;
    db.saveAllData(raw);
    command('receive', { id: legacy.id });
    command('receive', { id: transfer.id });
    const dest = db.getAllData().products.find((p) => p.branch === 'B');
    assert.equal(dest.status, 'archived');
    assert.equal(dest.stock, 2);
    assert.throws(() => sell({ branch: 'B' }), /ngừng kinh doanh/);
});
test('stocktake draft cannot overwrite subsequent sales', () => {
    const st = command('stocktake', {
        branch: 'A',
        items: [{ code: 'SP', systemStock: 3, actualStock: 3 }],
        balance: false
    }).result;
    sell();
    assert.throws(
        () => command('stocktake', { id: st.id, balance: true }),
        (e) => e.status === 409
    );
    assert.equal(db.getAllData().products[0].stock, 2);
});
test('import rejects duplicate serial across warehouses and invalid amounts', () => {
    assert.throws(() =>
        command('import', {
            branch: 'A',
            supplierCode: 'S',
            items: [{ code: 'SP', qty: 1, price: 50000, hasImei: true, imeis: ['I1'] }],
            paid: 50000,
            paymentMethod: 'cash'
        })
    );
    assert.throws(() => sell({ discount: -1 }));
    assert.throws(() => sell({ given: Infinity }));
});
test('cancel_import reverses inventory, serials, supplier debt and issues cash receipt', () => {
    const initialProduct = db
        .getAllData()
        .products.find((p) => p.code === 'SP' && p.branch === 'A');
    const initialStock = initialProduct.stock;
    const initialCostPrice = initialProduct.costPrice;
    const initialSupplier = db.getAllData().suppliers.find((s) => s.code === 'S');
    const initialDebt = initialSupplier.debt;
    const initialBought = initialSupplier.totalBought;

    // 1. Create an import
    const imp = command('import', {
        branch: 'A',
        supplierCode: 'S',
        items: [
            {
                code: 'SP',
                qty: 2,
                price: 50000,
                hasImei: true,
                imeis: ['NEW_IMEI_1', 'NEW_IMEI_2']
            }
        ],
        paid: 60000,
        paymentMethod: 'cash'
    }).result;

    assert.equal(
        db.getAllData().products.find((p) => p.code === 'SP' && p.branch === 'A').stock,
        initialStock + 2
    );
    assert.ok(
        db
            .getAllData()
            .products.find((p) => p.code === 'SP' && p.branch === 'A')
            .imeis.includes('NEW_IMEI_1')
    );

    // 2. Cancel the import
    command('cancel_import', { importId: imp.id, reason: 'Nhập nhầm hàng' });

    const after = db.getAllData();
    const prodAfter = after.products.find((p) => p.code === 'SP' && p.branch === 'A');
    assert.equal(prodAfter.stock, initialStock);
    assert.equal(prodAfter.costPrice, initialCostPrice);
    assert.ok(!prodAfter.imeis.includes('NEW_IMEI_1'));

    const supAfter = after.suppliers.find((s) => s.code === 'S');
    assert.equal(supAfter.debt, initialDebt);
    assert.equal(supAfter.totalBought, initialBought);

    const cancelledImp = after.imports.find((i) => i.id === imp.id);
    assert.equal(cancelledImp.status, 'cancelled');
    assert.equal(cancelledImp.cancelReason, 'Nhập nhầm hàng');

    // Cashbook voucher type 'thu' created to return paid money
    const refundVoucher = after.cashbook.find((c) => c.category === 'Hủy phiếu nhập');
    assert.ok(refundVoucher);
    assert.equal(refundVoucher.amount, 60000);
    assert.equal(refundVoucher.type, 'thu');
    assert.equal(refundVoucher.importId, imp.id);
    assert.equal(refundVoucher.importCode, imp.code);

    // 3. Cancelling again throws error
    assert.throws(() => command('cancel_import', { importId: imp.id }), /Phiếu nhập đã hủy/);
});
test('cancel_import refuses imports whose stock, cost or supplier balance changed later', () => {
    const importOne = (paymentMethod = 'cash') =>
        command('import', {
            branch: 'A',
            supplierCode: 'S',
            items: [{ code: 'SP', qty: 1, price: 80000, imeis: [crypto.randomUUID()] }],
            paid: 20000,
            paymentMethod
        }).result;
    const sold = importOne();
    sell();
    assert.throws(
        () => command('cancel_import', { importId: sold.id }),
        /Đã có chứng từ phát sinh sau phiếu nhập|Tồn kho hoặc giá vốn đã thay đổi/
    );

    const paidDebt = importOne('bank');
    const data = db.getAllData();
    data.suppliers.find((s) => s.code === 'S').debt = 0;
    db.saveAllData(data);
    assert.throws(
        () => command('cancel_import', { importId: paidDebt.id }),
        /Công nợ hoặc tổng nhập nhà cung cấp đã thay đổi/
    );

    const unknownMethod = db.getAllData();
    const legacy = unknownMethod.imports.find((i) => i.id === paidDebt.id);
    legacy.paymentMethod = 'legacy';
    unknownMethod.suppliers.find((s) => s.code === 'S').debt = 1000000;
    db.saveAllData(unknownMethod);
    assert.throws(
        () => command('cancel_import', { importId: paidDebt.id }),
        /Phương thức thanh toán không hợp lệ/
    );
    const receipt = command('cancel_import', {
        importId: paidDebt.id,
        refundMethod: 'transfer'
    }).result;
    assert.equal(receipt.status, 'cancelled');
    assert.equal(
        db.getAllData().cashbook.find((c) => c.importId === paidDebt.id).method,
        'Chuyển khoản'
    );
});
test('generic edit cannot forge financial records or bypass table permissions', () => {
    const data = app.project(db.getAllData(), admin);
    data.invoices = [{ id: 'bad', items: 'not-json' }];
    assert.throws(
        () => command('edit', data),
        (e) => e.status === 403
    );
    assert.equal(db.getAllData().invoices.length, 0);
    const warehouse = {
        ...admin,
        id: 'W',
        role: 'warehouse',
        branch: 'A',
        branches: ['A'],
        permissions: { products: true },
        status: 'active',
        username: 'warehouse',
        code: 'W'
    };
    const withWarehouse = db.getAllData();
    withWarehouse.users.push(warehouse);
    db.saveAllData(withWarehouse);
    assert.throws(() => sell.call(null, { branch: 'B' }));
    assert.throws(
        () =>
            command(
                'sale',
                { branch: 'A', items: [] },
                app.revision(),
                crypto.randomUUID(),
                warehouse
            ),
        (e) => e.status === 403
    );
});
test('catalog edits preserve passwords and reject duplicate codes', () => {
    const input = app.project(db.getAllData(), admin);
    input.users[0].name = 'New name';
    command('edit', input);
    assert.match(db.getAllData().users[0].password, /^scrypt\$/);
    const dup = app.project(db.getAllData(), admin);
    dup.products.push({ ...dup.products[0], id: 'OTHER' });
    assert.throws(() => command('edit', dup));
});
test('product sync respects branch scope and uses the edited branch row as source', () => {
    const data = db.getAllData();
    data.products.push({
        ...data.products[0],
        id: 'SP-B',
        branch: 'B',
        name: 'B original',
        stock: 0,
        imeis: []
    });
    const worker = {
        ...admin,
        id: 'WORKER',
        code: 'WORKER',
        username: 'worker',
        role: 'warehouse',
        branch: 'A',
        branches: ['A'],
        permissions: { products: true }
    };
    data.users.push(worker);
    db.saveAllData(data);

    const priceOnly = app.project(db.getAllData(), worker);
    priceOnly.products[0].price = 120000;
    assert.throws(() => command('edit', priceOnly, app.revision(), crypto.randomUUID(), worker), {
        status: 403
    });
    const authorized = db.getAllData();
    authorized.users.find((u) => u.id === worker.id).permissions.posPrice = true;
    db.saveAllData(authorized);
    command('edit', priceOnly, app.revision(), crypto.randomUUID(), worker);
    assert.equal(db.getAllData().products.find((p) => p.id === 'SP-B').price, 100000);

    const shared = app.project(db.getAllData(), worker);
    shared.products[0].name = 'A changed';
    assert.throws(
        () => command('edit', shared, app.revision(), crypto.randomUUID(), worker),
        (error) => error.status === 403
    );
    assert.equal(db.getAllData().products.find((p) => p.id === 'SP').name, 'Product');

    const fromB = app.project(db.getAllData(), admin);
    fromB.products.reverse().find((p) => p.branch === 'B').name = 'From B';
    command('edit', fromB);
    assert.deepEqual(
        db
            .getAllData()
            .products.map((p) => p.name)
            .sort(),
        ['From B', 'From B']
    );
});
test('customer edits do not trigger product sync or product permission checks', () => {
    const data = db.getAllData();
    const cashier = {
        ...admin,
        id: 'CASHIER',
        code: 'CASHIER',
        username: 'cashier',
        role: 'cashier',
        branch: 'A',
        branches: ['A'],
        permissions: { customers: true }
    };
    data.users.push(cashier);
    db.saveAllData(data);
    const input = app.project(db.getAllData(), cashier);
    input.customers[0].name = 'Changed customer';
    command('edit', input, app.revision(), crypto.randomUUID(), cashier);
    assert.equal(db.getAllData().customers[0].name, 'Changed customer');
    assert.equal(db.getAllData().products.length, 1);
});
test('product IMEI mode cannot propagate to another branch with stock', () => {
    const data = db.getAllData();
    Object.assign(data.products[0], { stock: 0, imeis: [] });
    data.products.push({
        ...data.products[0],
        id: 'SP-B',
        branch: 'B',
        stock: 1,
        imeis: ['B1']
    });
    db.saveAllData(data);
    const input = app.project(db.getAllData(), admin);
    input.products.find((p) => p.branch === 'A').hasImei = false;
    assert.throws(() => command('edit', input), /IMEI/);
    assert.equal(db.getAllData().products.find((p) => p.branch === 'B').hasImei, true);
});
test('generated cross-branch product IDs cannot exceed 160 characters', () => {
    const input = app.project(db.getAllData(), admin);
    input.products.push({
        ...input.products[0],
        id: 'LONG',
        code: 'X'.repeat(159),
        stock: 0,
        imeis: []
    });
    assert.throws(() => command('edit', input), /quá dài/);
    assert.equal(db.getAllData().products.length, 1);
});
test('HTTP routes deny unauthenticated reads/writes and database downloads', async () => {
    for (const url of ['/api/data', '/api/status'])
        assert.equal((await request('GET', url)).status, 401);
    assert.equal((await request('POST', '/api/reset', {})).status, 401);
    for (const url of [
        '/minikiot.db',
        '/minikiot.db-wal',
        '/db.js',
        '/data.js.map',
        '/CODE_REVIEW.md'
    ])
        assert.equal((await request('GET', url)).status, 404);
    const script = await request('GET', '/data.js');
    assert.equal(script.status, 200);
    assert.ok(!script.body.toString().includes("password: '123'"));
});
test('login session hides credentials, enforces origin and invalidates after password change', async () => {
    const login = await request('POST', '/api/login', {
        username: 'admin',
        password: 'Test-password-123'
    });
    assert.equal(login.status, 200);
    assert.ok(!('password' in login.json.user));
    assert.ok(login.json.data.users.every((u) => !('password' in u)));
    const cookie = login.headers['set-cookie'].split(';')[0];
    assert.equal((await request('GET', '/api/data', undefined, cookie)).status, 200);
    assert.equal((await request('POST', '/api/command', {}, cookie)).status, 403);
    assert.equal(
        (
            await request('POST', '/api/command', {}, cookie, {
                origin: 'https://evil.example',
                'x-minikiot-csrf': login.json.csrfToken
            })
        ).status,
        403
    );
    assert.equal(
        (
            await request(
                'POST',
                '/api/password',
                { current: 'Test-password-123', next: 'Changed-password-456' },
                cookie,
                { 'x-minikiot-csrf': login.json.csrfToken }
            )
        ).status,
        200
    );
    assert.equal((await request('GET', '/api/data', undefined, cookie)).status, 401);
});

test('branch permissions and revoked sessions are enforced by the server', async () => {
    const data = db.getAllData();
    const cashier = {
        ...admin,
        id: 'LIMITED',
        code: 'LIMITED',
        username: 'limited',
        role: 'cashier',
        branch: 'A',
        branches: ['A'],
        permissions: { pos: true, invoices: true }
    };
    data.users.push(cashier);
    data.products.push({ ...data.products[0], id: 'BSP', branch: 'B', imeis: ['B1', 'B2', 'B3'] });
    db.saveAllData(data);
    const projected = app.project(data, cashier);
    assert.equal(projected.products.length, 1);
    assert.equal(projected.users.length, 0);
    assert.throws(
        () =>
            command(
                'sale',
                {
                    branch: 'B',
                    items: [{ code: 'SP', qty: 1 }],
                    given: 100000,
                    paymentMethod: 'cash'
                },
                app.revision(),
                crypto.randomUUID(),
                cashier
            ),
        (e) => e.status === 403
    );
    const login = await request('POST', '/api/login', {
        username: 'limited',
        password: 'Test-password-123'
    });
    const cookie = login.headers['set-cookie'].split(';')[0];
    db.getDb().prepare("UPDATE users SET status='locked' WHERE id='LIMITED'").run();
    assert.equal((await request('GET', '/api/data', undefined, cookie)).status, 401);
});

test('staff managers cannot grant privileges or modify administrators', () => {
    const data = db.getAllData();
    const manager = {
        ...admin,
        id: 'M',
        code: 'M',
        username: 'manager',
        role: 'manager',
        branch: 'A',
        branches: ['A'],
        permissions: { users: true }
    };
    data.users.push(manager);
    db.saveAllData(data);
    const elevated = app.project(db.getAllData(), manager);
    elevated.users.find((u) => u.id === 'M').permissions.cashbook = true;
    assert.throws(
        () => command('edit', elevated, app.revision(), crypto.randomUUID(), manager),
        (e) => e.status === 403
    );
    const editAdmin = app.project(db.getAllData(), manager);
    editAdmin.users.find((u) => u.id === 'ADMIN').name = 'Changed';
    assert.throws(
        () => command('edit', editAdmin, app.revision(), crypto.randomUUID(), manager),
        (e) => e.status === 403
    );
    const noAdmin = app.project(db.getAllData(), admin);
    noAdmin.users[0].role = 'manager';
    assert.throws(() => command('edit', noAdmin));
    assert.equal(db.getAllData().users[0].role, 'admin');
});

test('in-transit serials cannot be recreated through import or catalog edits', () => {
    command('transfer', { fromBranch: 'A', toBranch: 'B', items: [{ code: 'SP', qty: 1 }] });
    assert.throws(() =>
        command('import', {
            branch: 'A',
            supplierCode: 'S',
            items: [{ code: 'SP', qty: 1, price: 50000, hasImei: true, imeis: ['I1'] }],
            paid: 50000,
            paymentMethod: 'cash'
        })
    );
    const edit = app.project(db.getAllData(), admin);
    edit.products[0].stock++;
    edit.products[0].imeis.push('I1');
    assert.throws(() => command('edit', edit));
    assert.equal(db.getAllData().products[0].stock, 2);
});

test('malformed legacy JSON stays intact and blocks mutations without crashing reads', () => {
    sell();
    db.getDb().prepare("UPDATE invoices SET items='bad-json'").run();
    assert.doesNotThrow(() => db.getAllData());
    assert.throws(
        () => sell(),
        (e) => e.status === 422
    );
    assert.equal(db.getDb().prepare('SELECT items FROM invoices').get().items, 'bad-json');
    db.getDb().prepare("UPDATE invoices SET items='[]'").run();
    db.getDb().prepare("UPDATE customers SET extra='bad-json'").run();
    assert.throws(
        () => sell(),
        (e) => e.status === 422
    );
    assert.equal(db.getDb().prepare('SELECT extra FROM customers').get().extra, 'bad-json');
});

test('backup captures WAL commits, is restorable, and refuses to overwrite files', () => {
    sell();
    const { backupDatabase } = require('../backup');
    const destination = path.join(dir, 'snapshot.db');
    backupDatabase(process.env.MINIKIOT_DB_PATH, destination);
    const restored = new (require('node:sqlite').DatabaseSync)(destination, { readOnly: true });
    try {
        assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
        assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM invoices').get().n, 1);
        assert.equal(restored.prepare('SELECT stock FROM products').get().stock, 2);
    } finally {
        restored.close();
    }
    assert.throws(() => backupDatabase(process.env.MINIKIOT_DB_PATH, destination));
});

test('backup CLI uses the same NKIOT_DB_PATH precedence as the server', () => {
    const destination = path.join(dir, 'cli-snapshot.db');
    const result = require('node:child_process').spawnSync(
        process.execPath,
        ['backup.js', destination],
        {
            cwd: path.join(__dirname, '..'),
            env: {
                ...process.env,
                NKIOT_DB_PATH: process.env.MINIKIOT_DB_PATH,
                MINIKIOT_DB_PATH: path.join(dir, 'missing.db')
            },
            encoding: 'utf8'
        }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(require('../backup').validateBackup(destination), true);
});

test('backup rotation validates every retained snapshot', () => {
    const { rotateBackups, validateBackup } = require('../backup');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'minikiot-rotation-'));
    const first = rotateBackups(process.env.MINIKIOT_DB_PATH, directory, 1);
    assert.equal(validateBackup(first), true);
    const second = rotateBackups(process.env.MINIKIOT_DB_PATH, directory, 1);
    assert.equal(validateBackup(second), true);
    assert.equal(fs.readdirSync(directory).filter((name) => name.endsWith('.db')).length, 1);
});
test('status migration, createdAt and idempotency retention are applied', () => {
    db.getDb().exec("UPDATE products SET status='inactive' WHERE id='SP'");
    db.initDb();
    assert.equal(db.getAllData().products[0].status, 'archived');
    db.getDb().exec("UPDATE products SET status='active' WHERE id='SP'");
    const requestId = crypto.randomUUID();
    const { result } = command(
        'sale',
        { branch: 'A', items: [{ code: 'SP', qty: 1 }], given: 100000, paymentMethod: 'cash' },
        app.revision(),
        requestId
    );
    assert.match(result.createdAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    assert.match(result.time, /^\d\d\/\d\d\/\d{4} \d\d:\d\d$/);
    const database = db.getDb();
    database
        .prepare(
            'INSERT INTO processed_requests (id,userId,digest,result,createdAt) VALUES (?,?,?,?,?)'
        )
        .run('OLD', admin.id, 'digest', '{}', '2000-01-01T00:00:00.000Z');
    sell();
    assert.equal(
        database.prepare("SELECT 1 FROM processed_requests WHERE id='OLD'").get(),
        undefined
    );
    // Expired cached result: the audit row still blocks a second execution of the same request.
    database.prepare('DELETE FROM processed_requests WHERE id=?').run(requestId);
    assert.throws(
        () =>
            command(
                'sale',
                {
                    branch: 'A',
                    items: [{ code: 'SP', qty: 1 }],
                    given: 100000,
                    paymentMethod: 'cash'
                },
                app.revision(),
                requestId
            ),
        { status: 409 }
    );
    assert.equal(db.getAllData().invoices.length, 2);
});
test('deterministic fuzz keeps stock, serials and failed commands consistent', () => {
    let seed = 0x5eed;
    const random = (n) => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed % n;
    };
    const dump = () => JSON.stringify(db.getAllData());
    for (let step = 0; step < 150; step++) {
        const data = db.getAllData(),
            p = data.products[0],
            invoices = data.invoices.filter((i) => i.status !== 'cancelled'),
            before = dump();
        try {
            const kind = random(3);
            if (kind === 0)
                sell({
                    items: [{ code: 'SP', qty: 1 + random(3) }],
                    given: random(2) ? 1000000 : random(100000)
                });
            else if (kind === 1 && invoices.length)
                command('return', {
                    invoiceId: invoices[random(invoices.length)].id,
                    items: [{ code: 'SP', qty: 1 + random(2) }]
                });
            else
                command('import', {
                    branch: 'A',
                    supplierCode: 'S',
                    paymentMethod: 'cash',
                    paid: 0,
                    items: [
                        {
                            code: 'SP',
                            qty: 1,
                            price: 50000,
                            imeis: [random(4) ? `F${step}` : p.imeis[0] || `F${step}`]
                        }
                    ]
                });
        } catch (error) {
            assert.ok(error.status >= 400 && error.status < 500, error.stack);
            assert.equal(dump(), before, `step ${step} changed data after ${error.message}`);
        }
        const after = db.getAllData().products[0];
        assert.ok(after.stock >= 0);
        assert.equal(after.imeis.length, after.stock);
        assert.equal(new Set(after.imeis).size, after.imeis.length);
    }
});
test('discount rounding remains exact across partial returns of a large invoice', () => {
    const data = db.getAllData();
    data.products[0].price = 1000000000000001;
    db.saveAllData(data);
    const inv = sell({
        items: [{ code: 'SP', qty: 3 }],
        discount: 1000000000000000,
        given: 3000000000000003
    });
    for (let i = 0; i < 3; i++)
        command('return', {
            invoiceId: inv.id,
            items: [{ code: 'SP', qty: 1, imeis: [`I${i + 1}`] }]
        });
    const refunds = db.getAllData().returns.reduce((s, r) => s + r.totalRefund, 0);
    assert.equal(refunds, inv.total);
    assert.equal(db.getAllData().invoices[0].paid, 0);
});

test('JSON arrays and null are rejected as malformed API bodies', async () => {
    assert.equal((await request('POST', '/api/login', null)).status, 400);
    assert.equal((await request('POST', '/api/login', [])).status, 400);
});

test('read snapshot is frozen, shared, and refreshed after any write', () => {
    const first = db.readSnapshot();
    assert.equal(db.readSnapshot(), first);
    assert.ok(Object.isFrozen(first.products[0]));
    assert.throws(() => {
        first.products[0].stock = 99;
    }, TypeError);
    assert.equal(Object.isFrozen(db.getAllData().products[0]), false);
    db.getDb().prepare("UPDATE products SET minStock=7 WHERE id='SP'").run();
    assert.equal(db.readSnapshot().products[0].minStock, 7);
    sell();
    assert.equal(db.readSnapshot().products[0].stock, 2);
    assert.equal(db.readSnapshot().invoices.length, 1);
    const projected = app.project(db.readSnapshot(), admin);
    assert.equal(projected.users[0].password, undefined);
    assert.ok(db.readSnapshot().users[0].password);
});

test('static assets support gzip and ETag revalidation', async () => {
    const zlib = require('node:zlib');
    const plain = await request('GET', '/app.js');
    assert.equal(plain.status, 200);
    assert.equal(plain.headers['Content-Encoding'], undefined);
    const etag = plain.headers.ETag;
    assert.match(etag, /^"[\w-]+"$/);
    const zipped = await request('GET', '/app.js', undefined, undefined, {
        'accept-encoding': 'gzip, br'
    });
    assert.equal(zipped.headers['Content-Encoding'], 'gzip');
    assert.equal(zlib.gunzipSync(zipped.body).toString(), plain.body.toString());
    assert.ok(zipped.body.length < plain.body.length / 3);
    const revalidated = await request('GET', '/app.js', undefined, undefined, {
        'if-none-match': etag
    });
    assert.equal(revalidated.status, 304);
    assert.equal(revalidated.body, undefined);
});
test('local CSS and fonts are served with correct MIME types', async () => {
    for (const [url, type] of [
        ['/assets/tailwind.css', 'text/css'],
        ['/assets/inter.css', 'text/css'],
        ['/assets/inter-vietnamese-wght-normal.woff2', 'font/woff2'],
        ['/assets/inter-latin-ext-wght-normal.woff2', 'font/woff2'],
        ['/assets/inter-latin-wght-normal.woff2', 'font/woff2']
    ]) {
        const response = await request('GET', url);
        assert.equal(response.status, 200);
        assert.ok(response.headers['Content-Type'].startsWith(type));
        assert.ok(response.body.length > 100);
    }
    const html = (await request('GET', '/')).body.toString();
    assert.ok(!html.includes('cdn.tailwindcss.com'));
    assert.ok(!html.includes('fonts.googleapis.com'));
});
test('diff-based save stores exactly what a full rewrite stores', () => {
    const d = db.getDb();
    const dump = () =>
        Object.fromEntries(
            db.ENTITY_TABLES.map((t) => [t, d.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])
        );
    // Same input saved both ways, each from the same starting state (rolled back in between).
    const saveBoth = (data) => {
        const out = [];
        for (const fullRewrite of [false, true]) {
            d.exec('BEGIN IMMEDIATE');
            try {
                db.saveAllData(structuredClone(data), true, { fullRewrite });
                out.push({ rows: dump(), read: db.getAllData() });
            } finally {
                d.exec('ROLLBACK');
            }
        }
        return out;
    };
    let seed = 7;
    const rand = (n) => (((seed = (seed * 1103515245 + 12345) % 2147483648) % n) + n) % n;
    const base = db.getAllData();
    for (let i = 0; i < 40; i++)
        base.invoices.push({
            id: `I${i}`,
            code: `HD${i}`,
            total: i * 1000,
            items: [],
            branch: 'A'
        });
    for (let i = 0; i < 20; i++)
        base.products.push({ id: `P${i}`, code: `P${i}`, name: `P${i}`, stock: i, branch: 'A' });
    db.saveAllData(base);
    const mutations = [
        (rows) => rows.unshift({ id: `NEW${rand(1e9)}`, code: 'N', total: 5, items: [] }),
        (rows) => rows.push({ id: `NEW${rand(1e9)}`, code: 'N', stock: 2 }),
        (rows) => rows.length && rows.splice(rand(rows.length), 1),
        (rows) => rows.length && Object.assign(rows[rand(rows.length)], { note: `x${rand(99)}` }),
        (rows) => rows.length && (rows[rand(rows.length)].code = `C${rand(99)}`),
        (rows) => rows.length > 2 && rows.splice(1, 0, { id: `MID${rand(1e9)}`, code: 'M' }),
        (rows) => rows.reverse(),
        (rows) => rows.length && rows.push({ ...rows[0] }) // duplicate id: both paths must fail
    ];
    for (let round = 0; round < 60; round++) {
        const data = db.getAllData();
        for (let k = 0; k < 3; k++) {
            const table = rand(2) ? 'invoices' : 'products';
            mutations[rand(mutations.length)](data[table]);
        }
        const dup = ['invoices', 'products'].some(
            (t) => new Set(data[t].map((r) => r.id)).size !== data[t].length
        );
        if (dup) {
            for (const fullRewrite of [false, true])
                assert.throws(() => db.saveAllData(structuredClone(data), false, { fullRewrite }));
            continue;
        }
        const [diff, full] = saveBoth(data);
        assert.deepEqual(diff.rows, full.rows, `round ${round}`);
        assert.deepEqual(diff.read, full.read, `round ${round}`);
        assert.deepEqual(
            diff.read.invoices.map((r) => r.id),
            data.invoices.map((r) => r.id)
        );
        db.saveAllData(data); // carry state forward so later rounds start from varied rowids
    }
    // Saving unchanged data must not touch any entity row.
    const before = d.prepare('SELECT total_changes() AS n').get().n;
    d.exec('BEGIN IMMEDIATE');
    try {
        const settingsRows = Object.keys(db.getAllData().settings).length;
        db.saveAllData(db.getAllData(), true);
        const written = d.prepare('SELECT total_changes() AS n').get().n - before;
        assert.equal(written, settingsRows * 2 + 1); // settings delete+insert, recentActivities
    } finally {
        d.exec('ROLLBACK');
    }
});
test('readForWrite returns a mutable copy of current data inside a transaction', () => {
    assert.throws(() => db.readForWrite(), /transaction/);
    const snap = db.readSnapshot();
    const d = db.getDb();
    d.exec('BEGIN IMMEDIATE');
    try {
        const copy = db.readForWrite();
        assert.deepEqual(copy, db.getAllData());
        assert.notEqual(copy, snap);
        copy.products[0].stock = 99;
        assert.equal(snap.products[0].stock, 3);
    } finally {
        d.exec('ROLLBACK');
    }
    // A write the snapshot has not seen must not be served from it.
    d.prepare("UPDATE products SET stock=8 WHERE id='SP'").run();
    d.exec('BEGIN IMMEDIATE');
    try {
        assert.equal(db.readForWrite().products[0].stock, 8);
    } finally {
        d.exec('ROLLBACK');
    }
});
test('JSON API responses are gzipped only when the client accepts it', async () => {
    const zlib = require('node:zlib');
    const login = await request('POST', '/api/login', {
        username: 'admin',
        password: 'Test-password-123'
    });
    const cookie = login.headers['set-cookie'].split(';')[0];
    const plain = await request('GET', '/api/data', undefined, cookie);
    assert.equal(plain.headers['Content-Encoding'], undefined);
    assert.equal(plain.headers.Vary, 'Accept-Encoding');
    const zipped = await request('GET', '/api/data', undefined, cookie, {
        'accept-encoding': 'gzip, deflate'
    });
    assert.equal(zipped.headers['Content-Encoding'], 'gzip');
    assert.equal(zipped.headers['Content-Length'], zipped.body.length);
    assert.deepEqual(JSON.parse(zlib.gunzipSync(zipped.body)), plain.json);
    const small = await request('GET', '/api/nope', undefined, cookie, {
        'accept-encoding': 'gzip'
    });
    assert.equal(small.status, 404);
    assert.equal(small.headers['Content-Encoding'], undefined);
});
test('view deltas rebuild the exact next view through the browser merge', () => {
    const vm = require('node:vm');
    const ctx = { FALLBACK_BRANCH: 'A', crypto: globalThis.crypto };
    vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, '..', 'client-store.js'), 'utf8') +
            ';this.applyDelta = applyDelta;',
        Object.assign(ctx, { window: { addEventListener() {} } })
    );
    let seed = 11;
    const rand = (n) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
    const row = (i) => ({ id: 'R' + i, v: rand(5) });
    let n = 0;
    for (let round = 0; round < 300; round++) {
        const prev = {
            settings: { a: rand(2) },
            t: Array.from({ length: rand(30) }, () => row(n++))
        };
        const next = { settings: { a: rand(2) }, t: prev.t.map((r) => ({ ...r })) };
        for (let k = rand(4); k >= 0; k--) {
            const op = rand(6),
                t = next.t;
            if (op === 0) t.unshift(row(n++));
            else if (op === 1) t.push(row(n++));
            else if (op === 2 && t.length) t.splice(rand(t.length), 1);
            else if (op === 3 && t.length) t[rand(t.length)].v = 9;
            else if (op === 4 && t.length > 1) t.splice(1, 0, row(n++));
            else if (op === 5) t.reverse();
        }
        const delta = app.diffViews(prev, next);
        const merged = ctx.applyDelta(prev, JSON.parse(JSON.stringify(delta)));
        assert.equal(JSON.stringify(merged), JSON.stringify(next), `round ${round}`);
    }
    assert.deepEqual(app.diffViews({ t: [{ id: 'X' }] }, { t: [{ id: 'X' }] }), {});
    assert.equal(app.diffViews({ a: 1 }, { b: 1 }), null);
    assert.throws(() => ctx.applyDelta({ t: [] }, { t: { remove: ['X'], length: 1 } }));
});
test('command response is a delta only when the client base matches the server revision', async () => {
    const login = await request('POST', '/api/login', {
        username: 'admin',
        password: 'Test-password-123'
    });
    const cookie = login.headers['set-cookie'].split(';')[0];
    const sale = (base, rev = app.revision()) =>
        request(
            'POST',
            '/api/command',
            {
                type: 'sale',
                requestId: crypto.randomUUID(),
                revision: rev,
                payload: {
                    branch: 'A',
                    items: [{ code: 'SP', qty: 1 }],
                    given: 100000,
                    paymentMethod: 'cash'
                }
            },
            cookie,
            {
                'x-minikiot-csrf': login.json.csrfToken,
                ...(base === undefined ? {} : { 'x-minikiot-base': String(base) })
            }
        );
    const rev = app.revision();
    const before = (await request('GET', '/api/data', undefined, cookie)).json.data;
    const withDelta = await sale(rev);
    assert.equal(withDelta.status, 200);
    assert.equal(withDelta.json.data, undefined);
    assert.equal(withDelta.json.base, rev);
    assert.equal(withDelta.json.revision, rev + 1);
    assert.equal(withDelta.json.delta.invoices.prepend.length, 1);
    assert.equal(withDelta.json.delta.products.update[0].stock, before.products[0].stock - 1);
    assert.ok(withDelta.json.result.code);
    const legacy = await sale(undefined);
    assert.ok(legacy.json.data && !legacy.json.delta);
    const stale = await sale(rev);
    assert.ok(stale.json.data && !stale.json.delta);
});

test('multi-method sale splits payments across transfer, cash and card and books remaining debt', () => {
    const data = db.getAllData();
    const cust = data.customers.find((c) => c.code !== 'KL');
    const initialDebt = cust.debt || 0;
    const prod = data.products.find((p) => (p.branch || 'A') === 'A' && p.stock >= 1);
    const oldPrice = prod.price;
    prod.price = 10000000;
    db.saveAllData(data);

    // 1. Retail customer underpayment with multi-payment is rejected
    assert.throws(
        () =>
            command('sale', {
                branch: 'A',
                items: [{ code: prod.code, qty: 1 }],
                payments: [
                    { method: 'transfer', amount: 2000000 },
                    { method: 'cash', amount: 2000000 },
                    { method: 'card', amount: 2000000 }
                ]
            }),
        /Khách lẻ chưa trả đủ tiền/
    );

    // 2. Exact user scenario: 10M total, 2M transfer, 2M cash, 2M card, 4M debt
    const invoice = command('sale', {
        branch: 'A',
        items: [{ code: prod.code, qty: 1 }],
        customerId: cust.id,
        payments: [
            { method: 'transfer', amount: 2000000 },
            { method: 'cash', amount: 2000000 },
            { method: 'card', amount: 2000000 }
        ]
    }).result;

    assert.equal(invoice.total, 10000000);
    assert.equal(invoice.paid, 6000000);
    assert.equal(invoice.redPaid, true);
    assert.equal(invoice.paymentMethod, 'multi');
    assert.equal(invoice.payments.length, 3);
    assert.deepEqual(
        invoice.payments.map((p) => ({ method: p.method, amount: p.amount })),
        [
            { method: 'transfer', amount: 2000000 },
            { method: 'card', amount: 2000000 },
            { method: 'cash', amount: 2000000 }
        ]
    );

    // Check customer debt increased by 4M
    const updatedCust = db.getAllData().customers.find((c) => c.id === cust.id);
    assert.equal(updatedCust.debt, initialDebt + 4000000);

    // Check cashbook vouchers: 3 vouchers created for this invoice
    const vouchers = db.getAllData().cashbook.filter((c) => c.invoiceId === invoice.id);
    assert.equal(vouchers.length, 3);
    const voucherMethods = vouchers.map((v) => ({ method: v.method, amount: v.amount }));
    assert.ok(voucherMethods.some((v) => v.method === 'Chuyển khoản' && v.amount === 2000000));
    assert.ok(voucherMethods.some((v) => v.method === 'Thẻ' && v.amount === 2000000));
    assert.ok(voucherMethods.some((v) => v.method === 'Tiền mặt' && v.amount === 2000000));

    // Cancel invoice safely reverts stock, customer debt, and refunds
    const cancelled = command('cancel', { invoiceId: invoice.id }).result;
    assert.equal(cancelled.totalRefund, 6000000);
    assert.equal(cancelled.debtReduction, 4000000);

    const revertedCust = db.getAllData().customers.find((c) => c.id === cust.id);
    assert.equal(revertedCust.debt, initialDebt);

    // Restore product price
    const resetData = db.getAllData();
    resetData.products.find((p) => p.code === prod.code).price = oldPrice;
    db.saveAllData(resetData);
});

test('all user operations record activity logs in recentActivities across commands and catalog edits', () => {
    // 1. Cash entry records activity
    command('cash', {
        type: 'thu',
        category: 'Thu tiền dịch vụ',
        amount: 250000,
        person: 'Khách hàng VIP',
        branch: 'A',
        method: 'cash'
    });
    let d = db.getAllData();
    assert.ok(d.recentActivities && d.recentActivities.length > 0);
    const cashAct = d.recentActivities[0];
    assert.equal(cashAct.type, 'cash_in');
    assert.equal(cashAct.val, '250000');
    assert.ok(cashAct.action.includes('Lập phiếu thu'));
    assert.equal(cashAct.branch, 'A');

    // 2. Catalog edit records activity
    const newProd = {
        id: 'SP_TEST_AUDIT',
        code: 'SP_TEST_AUDIT',
        name: 'Sản phẩm Test Audit Log',
        category: 'Test',
        costPrice: 100000,
        price: 150000,
        stock: 0,
        minStock: 1,
        unit: 'Chiếc',
        status: 'active',
        barcode: '893000999',
        branch: 'A',
        hasImei: false,
        imeis: []
    };
    const incomingData = {
        ...d,
        products: [newProd, ...d.products]
    };
    command('edit', incomingData);

    d = db.getAllData();
    const editAct = d.recentActivities[0];
    assert.equal(editAct.type, 'edit');
    assert.ok(editAct.action.includes('Thêm hàng hóa'));
    assert.ok(editAct.action.includes('Sản phẩm Test Audit Log'));
    assert.equal(editAct.branch, 'A');

    // Clean up test product
    incomingData.products = d.products.filter((p) => p.id !== 'SP_TEST_AUDIT');
    command('edit', incomingData);
});

test('cancel_import cleans up imeiDetails when reversing imported serials', () => {
    const importRes = command('import', {
        branch: 'A',
        supplierCode: 'S',
        paid: 0,
        paymentMethod: 'cash',
        items: [
            {
                code: 'SP',
                qty: 1,
                price: 50000,
                hasImei: true,
                imeis: ['IMEI_TEST_CLEANUP'],
                imeiDetails: {
                    IMEI_TEST_CLEANUP: { condition: 'like_new', conditionDetail: 'Pin 99%' }
                }
            }
        ]
    });
    let d = db.getAllData();
    let p = d.products.find((prod) => prod.code === 'SP' && prod.branch === 'A');
    assert.ok(p.imeis.includes('IMEI_TEST_CLEANUP'));
    assert.ok(p.imeiDetails && p.imeiDetails['IMEI_TEST_CLEANUP']);

    command('cancel_import', {
        importId: importRes.result.id,
        reason: 'Test cleanup imeiDetails'
    });

    d = db.getAllData();
    p = d.products.find((prod) => prod.code === 'SP' && prod.branch === 'A');
    assert.equal(p.imeis.includes('IMEI_TEST_CLEANUP'), false);
    assert.equal(p.imeiDetails?.['IMEI_TEST_CLEANUP'], undefined);
});

test('media upload accepts valid image magic bytes and rejects forged MIME', async () => {
    const login = await request('POST', '/api/login', {
        username: 'admin',
        password: 'Test-password-123'
    });
    const cookie = login.headers['set-cookie'].split(';')[0];
    const csrf = login.json.csrfToken;

    // Fake PNG with invalid magic bytes
    const fakePng = await request(
        'POST',
        '/api/upload-media',
        {
            data: 'data:image/png;base64,' + Buffer.from('not-a-real-png-image').toString('base64'),
            type: 'image/png'
        },
        cookie,
        { 'x-nkiot-csrf': csrf }
    );
    assert.equal(fakePng.status, 400);
    assert.match(fakePng.json.error, /Nội dung tệp không khớp/);

    // Valid 1x1 PNG header
    const validPngBytes = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52
    ]);
    const validPng = await request(
        'POST',
        '/api/upload-media',
        {
            data: 'data:image/png;base64,' + validPngBytes.toString('base64'),
            type: 'image/png'
        },
        cookie,
        { 'x-nkiot-csrf': csrf }
    );
    assert.equal(validPng.status, 200);
    assert.equal(validPng.json.success, true);
    assert.ok(validPng.json.url.startsWith('/uploads/'));
});

test('unsafe media edits and imports are rejected atomically', () => {
    const before = app.revision();
    const edit = app.project(db.getAllData(), admin);
    edit.products[0].images = ['javascript:alert(1)'];
    assert.throws(() => command('edit', edit), { status: 422 });
    assert.throws(
        () =>
            command('import', {
                branch: 'A',
                supplierCode: 'S',
                paid: 0,
                paymentMethod: 'cash',
                items: [
                    {
                        code: 'SP',
                        qty: 1,
                        price: 50000,
                        hasImei: true,
                        imeis: ['NEW'],
                        imeiDetails: { NEW: { images: ['x" onerror="alert(1)'] } }
                    }
                ]
            }),
        { status: 422 }
    );
    assert.equal(app.revision(), before);
    assert.equal(db.getAllData().products[0].stock, 3);
    assert.equal(db.getAllData().imports.length, 0);
});

function patchTable(table, upsert = [], remove = []) {
    return { tables: { [table]: { upsert, remove } }, settings: {} };
}
test('catalog patch preserves other rows, supports deletion, and replays exactly once', () => {
    const row = { ...db.getAllData().customers[0], name: 'Patched customer' };
    const requestId = crypto.randomUUID(),
        rev = app.revision();
    const payload = patchTable('customers', [row]);
    const before = db.getAllData();
    command('catalogPatch', payload, rev, requestId);
    assert.equal(db.getAllData().customers[0].name, row.name);
    assert.deepEqual(db.getAllData().products, before.products);
    assert.deepEqual(db.getAllData().suppliers, before.suppliers);
    assert.equal(command('catalogPatch', payload, rev, requestId).replayed, true);
    assert.equal(app.revision(), rev + 1);
    command('catalogPatch', patchTable('customers', [], [row.id]));
    assert.equal(db.getAllData().customers.length, 0);
});
test('catalog patch rejects stale revision, history deletion and protected tables atomically', () => {
    const rev = app.revision();
    sell();
    assert.throws(() => command('catalogPatch', patchTable('customers'), rev), { status: 409 });
    assert.throws(() => command('catalogPatch', patchTable('invoices')), { status: 403 });
    assert.throws(() => command('catalogPatch', patchTable('__proto__')), { status: 403 });
    assert.throws(() => command('catalogPatch', patchTable('products', [], ['SP'])), {
        status: 422
    });
    const customer = db.getAllData().customers[0];
    assert.throws(() => command('catalogPatch', patchTable('customers', [customer, customer])), {
        status: 422
    });
    assert.throws(
        () => command('catalogPatch', patchTable('customers', [customer], [customer.id])),
        { status: 422 }
    );
    assert.equal(app.revision(), rev + 1);
    assert.equal(db.getAllData().invoices.length, 1);
});
test('catalog patch enforces branch and table permissions including removals', () => {
    const data = db.getAllData();
    const staff = {
        ...data.users[0],
        id: 'STAFF',
        username: 'staff',
        role: 'custom',
        branch: 'A',
        branches: ['A'],
        permissions: { products: true }
    };
    data.users.push(staff);
    data.products.push({ ...data.products[0], id: 'OTHER', branch: 'B', stock: 0, imeis: [] });
    db.saveAllData(data);
    const run = (payload) =>
        command('catalogPatch', payload, app.revision(), crypto.randomUUID(), staff);
    assert.throws(() => run(patchTable('products', [{ ...data.products[1], price: 42 }])), {
        status: 403
    });
    assert.throws(() => run(patchTable('products', [], ['OTHER'])), { status: 403 });
    assert.throws(
        () => run(patchTable('customers', [{ ...data.customers[0], name: 'Forbidden' }])),
        { status: 403 }
    );
    assert.throws(() => run({ tables: {}, settings: { storeName: 'Forbidden' } }), { status: 403 });
    assert.throws(() => run(patchTable('products', [{ ...data.products[0], price: 42000 }])), {
        status: 403
    });
    const authorized = db.getAllData();
    authorized.users.find((u) => u.id === staff.id).permissions.posPrice = true;
    db.saveAllData(authorized);
    run(patchTable('products', [{ ...data.products[0], price: 42000 }]));
    assert.equal(db.getAllData().products.find((p) => p.id === 'SP').price, 42000);
    assert.equal(db.getAllData().products.find((p) => p.id === 'OTHER').price, 100000);
});
test('password-only catalog patch is hashed and cannot bypass user management restrictions', () => {
    const row = { ...require('../security').publicUser(admin), password: 'Changed-password-123' };
    command('catalogPatch', patchTable('users', [row]));
    assert.ok(
        require('../security').verifyPassword(
            'Changed-password-123',
            db.getAllData().users[0].password
        )
    );
    assert.throws(
        () => command('catalogPatch', patchTable('users', [{ ...row, status: 'locked' }])),
        { status: 422 }
    );
});
test('settings patch changes only supplied keys and cannot persist UI branch selection', () => {
    const before = db.getAllData().settings;
    command('catalogPatch', { tables: {}, settings: { storeName: 'New store' } });
    assert.deepEqual(db.getAllData().settings, { ...before, storeName: 'New store' });
    assert.throws(() => command('catalogPatch', { tables: {}, settings: { branch: 'B' } }), {
        status: 422
    });
});

test('branch-only patch renames linked empty products and user scopes on the server', () => {
    const data = db.getAllData();
    data.products[0].stock = 0;
    data.products[0].imeis = [];
    data.products[0].id = 'SP_A';
    db.saveAllData(data);
    command('catalogPatch', patchTable('branches', [{ ...data.branches[0], name: 'Renamed' }]));
    const next = db.getAllData();
    assert.equal(next.products.find((p) => p.branch === 'Renamed').id, 'SP_Renamed');
    assert.equal(next.users[0].branch, 'Renamed');
    assert.deepEqual(next.users[0].branches, ['Renamed', 'B']);
    assert.equal(next.settings.branch, 'Renamed');
});

function normalizeSaleComparison(value) {
    if (Array.isArray(value)) return value.map(normalizeSaleComparison);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
            key,
            ['time', 'createdAt', 'lastSyncAt', 'sharedAt'].includes(key)
                ? '<time>'
                : key === 'id' && typeof item === 'string' && item.startsWith('act_')
                  ? '<activity>'
                  : normalizeSaleComparison(item)
        ])
    );
}
test('direct sale matches snapshot writer for money, serials, sharing and successive document order', () => {
    const seed = db.getAllData();
    seed.products.push({
        ...seed.products[0],
        id: 'PLAIN',
        code: 'PLAIN',
        hasImei: false,
        imeis: [],
        stock: 10
    });
    seed.shared_products = [
        {
            id: 'SH',
            sourceProductId: 'SP',
            ownerUserId: 'ADMIN',
            ownerBranch: 'A',
            status: 'active',
            name: 'Product',
            price: 100000
        }
    ];
    const run = (mode) => {
        process.env.NKIOT_SALE_WRITE_MODE = mode;
        db.saveAllData(structuredClone(seed));
        db.getDb().exec(
            'DELETE FROM audit_log; DELETE FROM processed_requests; DELETE FROM hub_outbox'
        );
        sell({
            customerId: 'C',
            discount: 12345,
            payments: [
                { method: 'cash', amount: 20000 },
                { method: 'transfer', amount: 30000 }
            ]
        });
        sell({ items: [{ code: 'PLAIN', qty: 2 }], given: 200000 });
        sell({ customerId: 'C', given: 0, items: [{ code: 'SP', qty: 1, imeis: ['I3'] }] });
        return normalizeSaleComparison(db.getAllData());
    };
    const previousMode = process.env.NKIOT_SALE_WRITE_MODE;
    try {
        const legacy = run('snapshot');
        const direct = run('direct');
        assert.deepEqual(direct, legacy);
        assert.equal(direct.invoices.length, 3);
        assert.equal(direct.cashbook.length, 3);
        assert.deepEqual(direct.products[0].imeis, ['I2']);
    } finally {
        if (previousMode === undefined) delete process.env.NKIOT_SALE_WRITE_MODE;
        else process.env.NKIOT_SALE_WRITE_MODE = previousMode;
    }
});
test('direct sale writes neither historical documents nor unrelated tables', () => {
    sell();
    const d = db.getDb();
    d.exec(`CREATE TEMP TRIGGER no_old_invoice_update BEFORE UPDATE ON invoices BEGIN SELECT RAISE(ABORT,'old invoice touched'); END;
        CREATE TEMP TRIGGER no_old_invoice_delete BEFORE DELETE ON invoices BEGIN SELECT RAISE(ABORT,'old invoice deleted'); END;
        CREATE TEMP TRIGGER no_old_cash_update BEFORE UPDATE ON cashbook BEGIN SELECT RAISE(ABORT,'old cash touched'); END;
        CREATE TEMP TRIGGER no_settings_delete BEFORE DELETE ON settings BEGIN SELECT RAISE(ABORT,'settings touched'); END;`);
    try {
        sell();
        assert.equal(db.getAllData().invoices.length, 2);
    } finally {
        for (const name of [
            'no_old_invoice_update',
            'no_old_invoice_delete',
            'no_old_cash_update',
            'no_settings_delete'
        ])
            d.exec(`DROP TRIGGER ${name}`);
    }
});
test('failure after direct SQL writes rolls back stock, documents, audit and outbox', () => {
    const d = db.getDb(),
        before = db.readSnapshot(),
        rev = app.revision();
    const pending = d.prepare('SELECT COUNT(*) AS n FROM hub_outbox').get().n;
    d.exec(
        "CREATE TEMP TRIGGER reject_sale_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'forced audit failure'); END"
    );
    try {
        assert.throws(() => sell(), /forced audit failure/);
        assert.deepEqual(db.getAllData(), before);
        assert.equal(app.revision(), rev);
        assert.equal(d.prepare('SELECT COUNT(*) AS n FROM hub_outbox').get().n, pending);
        assert.equal(d.prepare('SELECT COUNT(*) AS n FROM processed_requests').get().n, 0);
        assert.equal(before.products[0].stock, 3);
    } finally {
        d.exec('DROP TRIGGER reject_sale_audit');
    }
    sell();
    assert.equal(db.getAllData().products[0].stock, 2);
});
test('selective sale draft shares frozen history but isolates mutable inventory', () => {
    sell();
    const snapshot = db.readSnapshot(),
        d = db.getDb();
    d.exec('BEGIN IMMEDIATE');
    try {
        const { base, data } = db.readSaleForWrite({
            branch: 'A',
            items: [{ code: 'SP' }],
            customerId: 'C'
        });
        assert.equal(base, snapshot);
        assert.equal(data.invoices[0], snapshot.invoices[0]);
        assert.notEqual(data.products[0], snapshot.products[0]);
        assert.notEqual(data.customers[0], snapshot.customers[0]);
        data.products[0].imeis.pop();
        assert.equal(snapshot.products[0].imeis.length, 2);
        assert.throws(() => {
            data.invoices[0].total = 0;
        }, TypeError);
    } finally {
        d.exec('ROLLBACK');
    }
});
test('direct sale observes another connection writes rather than reusing a stale snapshot', () => {
    db.readSnapshot();
    const other = new (require('node:sqlite').DatabaseSync)(process.env.MINIKIOT_DB_PATH);
    try {
        other.prepare("UPDATE products SET price=200000 WHERE id='SP'").run();
    } finally {
        other.close();
    }
    const result = sell({ given: 200000 });
    assert.equal(result.total, 200000);
    assert.equal(db.readSnapshot().products[0].stock, 2);
});
test('direct sale falls back safely for a legacy table with extra columns', () => {
    const d = db.getDb();
    d.exec("ALTER TABLE invoices ADD COLUMN legacyMarker TEXT DEFAULT 'kept'");
    try {
        sell();
        sell();
        assert.equal(db.getAllData().invoices.length, 2);
        assert.equal(
            d.prepare("SELECT COUNT(*) AS n FROM invoices WHERE legacyMarker='kept'").get().n,
            2
        );
    } finally {
        d.exec('ALTER TABLE invoices DROP COLUMN legacyMarker');
    }
});

test('invoice list route requires a session and invoice permission', async () => {
    assert.equal((await request('GET', '/api/invoices')).status, 401);
    const login = await request('POST', '/api/login', {
        username: 'admin',
        password: 'Test-password-123'
    });
    const cookie = login.headers['set-cookie'].split(';')[0];
    sell();
    const page = await request('GET', '/api/invoices?branch=A&pageSize=1', undefined, cookie);
    assert.equal(page.status, 200);
    assert.equal(page.json.rows.length, 1);
    assert.equal(page.json.rows[0].items, undefined);
    const data = db.getAllData();
    data.users[0].role = 'custom';
    data.users[0].permissions = { pos: true };
    db.saveAllData(data);
    assert.equal((await request('GET', '/api/invoices?branch=A', undefined, cookie)).status, 403);
});

test('manager cannot reset or move an existing employee from another branch', () => {
    const d = db.getAllData();
    const manager = {
        ...d.users[0],
        id: 'MA',
        code: 'MA',
        username: 'ma',
        role: 'manager',
        branch: 'A',
        branches: ['A'],
        permissions: { users: true }
    };
    const victim = {
        ...manager,
        id: 'VB',
        code: 'VB',
        username: 'vb',
        branch: 'B',
        branches: ['B'],
        permissions: {}
    };
    d.users.push(manager, victim);
    db.saveAllData(d);
    const before = db.getAllData();
    for (const changes of [
        { name: 'Changed' },
        { branch: 'A', branches: ['A'], password: 'Hijacked-password' }
    ]) {
        assert.throws(
            () =>
                command(
                    'catalogPatch',
                    {
                        tables: {
                            users: { upsert: [{ ...victim, password: '', ...changes }], remove: [] }
                        },
                        settings: {}
                    },
                    app.revision(),
                    crypto.randomUUID(),
                    manager
                ),
            { status: 403 }
        );
        assert.deepEqual(db.getAllData(), before);
    }
});

test('partial serial return restores selected device and cancellation restores only remaining serials', () => {
    const inv = sell({ items: [{ code: 'SP', qty: 3 }], given: 300000 });
    const before = db.getAllData();
    for (const imeis of [undefined, ['OTHER'], ['I1', 'I1']]) {
        assert.throws(() =>
            command('return', { invoiceId: inv.id, items: [{ code: 'SP', qty: 1, imeis }] })
        );
        assert.deepEqual(db.getAllData(), before);
    }
    const ret = command('return', {
        invoiceId: inv.id,
        items: [{ code: 'SP', qty: 1, imeis: ['I2'] }]
    }).result;
    assert.deepEqual(ret.items[0].imeis, ['I2']);
    assert.deepEqual(db.getAllData().products[0].imeis, ['I2']);
    assert.throws(() =>
        command('return', { invoiceId: inv.id, items: [{ code: 'SP', qty: 1, imeis: ['I2'] }] })
    );
    const cancelled = command('cancel', { invoiceId: inv.id }).result;
    assert.deepEqual(cancelled.items[0].imeis, ['I1', 'I3']);
    assert.equal(db.getAllData().products[0].stock, 3);
});

test('return restores weighted historic cost and rejects missing historical cost atomically', () => {
    const inv = sell({ items: [{ code: 'SP', qty: 3 }], given: 300000 });
    command('import', {
        branch: 'A',
        supplierCode: 'S',
        items: [{ code: 'SP', qty: 1, price: 300000, imeis: ['NEW'] }],
        paid: 300000,
        paymentMethod: 'cash'
    });
    command('return', { invoiceId: inv.id, items: [{ code: 'SP', qty: 1, imeis: ['I2'] }] });
    assert.equal(db.getAllData().products[0].costPrice, 175000);
    const d = db.getAllData();
    delete d.invoices[0].items[0].costPrice;
    db.saveAllData(d);
    const before = db.getAllData();
    assert.throws(() => command('cancel', { invoiceId: inv.id }), /giá vốn lịch sử/);
    assert.deepEqual(db.getAllData(), before);
});

test('shared catalog follows sale, return, catalog edits and only publishes in-stock serials', () => {
    const hub = require('../hub-client');
    const d = db.getAllData();
    d.products[0].imeiDetails = { I1: { images: [] }, I2: { images: [] }, I3: { images: [] } };
    db.saveAllData(d);
    command('shareProduct', { productId: 'SP' });
    const inv = sell({ items: [{ code: 'SP', qty: 3 }], given: 300000 });
    assert.deepEqual(hub.localCatalog(db.getAllData())[0].imeis, []);
    command('return', { invoiceId: inv.id, items: [{ code: 'SP', qty: 1, imeis: ['I2'] }] });
    let shared = hub.localCatalog(db.getAllData())[0];
    assert.equal(shared.availability, 'in_stock');
    assert.deepEqual(shared.imeis, ['I2']);
    assert.deepEqual(Object.keys(shared.imeiDetails), ['I2']);
    const p = db.getAllData().products[0];
    command('catalogPatch', {
        tables: { products: { upsert: [{ ...p, price: 250000, status: 'archived' }], remove: [] } },
        settings: {}
    });
    shared = hub.localCatalog(db.getAllData())[0];
    assert.equal(shared.price, 250000);
    assert.equal(shared.availability, 'out_of_stock');
    assert.deepEqual(shared.imeis, []);
});

test('shared availability updates after import, transfer, receive, stocktake and import cancellation', () => {
    const d = db.getAllData();
    Object.assign(d.products[0], { stock: 0, hasImei: false, imeis: [] });
    d.products.push({ ...d.products[0], id: 'BSP', branch: 'B' });
    db.saveAllData(d);
    command('shareProduct', { productId: 'SP' });
    command('shareProduct', { productId: 'BSP' });
    const availability = (id) =>
        db.getAllData().shared_products.find((s) => s.sourceProductId === id).availability;
    const payload = {
        branch: 'A',
        supplierCode: 'S',
        items: [{ code: 'SP', qty: 1, price: 50000 }],
        paid: 50000,
        paymentMethod: 'cash'
    };
    const imp = command('import', payload).result;
    assert.equal(availability('SP'), 'in_stock');
    command('cancel_import', { importId: imp.id });
    assert.equal(availability('SP'), 'out_of_stock');
    command('import', payload);
    const transfer = command('transfer', {
        fromBranch: 'A',
        toBranch: 'B',
        items: [{ code: 'SP', qty: 1 }]
    }).result;
    assert.equal(availability('SP'), 'out_of_stock');
    command('receive', { id: transfer.id });
    assert.equal(availability('BSP'), 'in_stock');
    command('stocktake', {
        branch: 'B',
        items: [{ code: 'SP', systemStock: 1, actualStock: 0 }],
        balance: true
    });
    assert.equal(availability('BSP'), 'out_of_stock');
});

for (const type of ['edit', 'catalogPatch']) {
    test(`${type} cannot swap serials or change historical cost, including admin (round 2)`, () => {
        const invoice = sell({ items: [{ code: 'SP', qty: 1, imeis: ['I1'] }] });
        const before = db.getAllData();
        const revision = app.revision();
        const mutate = (fields) => {
            const data = app.project(db.getAllData(), admin);
            const row = { ...data.products[0], ...fields };
            if (type === 'catalogPatch') return command(type, patchTable('products', [row]));
            data.products[0] = row;
            return command(type, data);
        };
        assert.throws(() => mutate({ imeis: ['I1', 'I3'] }), /Thay đổi IMEI tồn kho/);
        assert.throws(() => mutate({ costPrice: 0 }), /giá vốn/);
        assert.deepEqual(db.getAllData(), before, 'failed commands must roll back');
        assert.equal(app.revision(), revision);
        mutate({ imeis: ['I3', 'I2'] }); // ordering alone is not an inventory mutation
        command('return', {
            invoiceId: invoice.id,
            items: [{ code: 'SP', qty: 1, imeis: ['I1'] }],
            refundMethod: 'cash'
        });
        assert.equal(db.getAllData().products[0].stock, 3);
        assert.equal(
            sell({ items: [{ code: 'SP', qty: 1, imeis: ['I1'] }] }).items[0].imeis[0],
            'I1'
        );
    });
}

test('existing opening stock serials cannot be replaced without a stock document', () => {
    const product = db.getAllData().products[0];
    assert.throws(
        () =>
            command(
                'catalogPatch',
                patchTable('products', [{ ...product, imeis: ['X', 'I2', 'I3'] }])
            ),
        /Thay đổi IMEI tồn kho/
    );
});

test('import rejects metadata outside its serials and rolls back preceding lines', () => {
    const data = db.getAllData();
    data.products[0].imeiDetails = { I2: { images: ['/uploads/original.jpg'], condition: 'good' } };
    data.products.push({
        ...data.products[0],
        id: 'PLAIN',
        code: 'PLAIN',
        hasImei: false,
        imeis: [],
        imeiDetails: {}
    });
    db.saveAllData(data);
    const before = db.getAllData();
    const revision = app.revision();
    const input = {
        branch: 'A',
        supplierCode: 'S',
        paid: 0,
        paymentMethod: 'cash',
        items: [
            { code: 'PLAIN', qty: 1, price: 50000 },
            {
                code: 'SP',
                qty: 1,
                price: 50000,
                imeis: ['I4'],
                imeiDetails: { I4: { images: ['/uploads/new.jpg'] }, I2: { condition: 'fair' } }
            }
        ]
    };
    assert.throws(() => command('import', input), /chỉ được chứa các máy thuộc dòng nhập/);
    assert.deepEqual(db.getAllData(), before);
    assert.equal(app.revision(), revision);
    assert.throws(
        () =>
            command('import', {
                ...input,
                items: [
                    {
                        code: 'PLAIN',
                        qty: 1,
                        price: 50000,
                        imeiDetails: { I2: { condition: 'fair' } }
                    }
                ]
            }),
        /chỉ được chứa các máy thuộc dòng nhập/
    );
    delete input.items[1].imeiDetails.I2;
    command('import', input);
    const product = db.getAllData().products.find((p) => p.code === 'SP');
    assert.deepEqual(product.imeiDetails.I2, before.products[0].imeiDetails.I2);
    assert.deepEqual(product.imeiDetails.I4.images, ['/uploads/new.jpg']);
    assert.equal(product.stock, 4);
});

test('missing posPrice is denied consistently by sale, edit and catalogPatch', () => {
    const data = db.getAllData();
    const clerk = {
        ...admin,
        id: 'ROUND2',
        username: 'round2',
        role: 'custom',
        permissions: { products: true, pos: true }
    };
    data.users.push(clerk);
    db.saveAllData(data);
    const revision = app.revision();
    const run = (type, payload) =>
        command(type, payload, app.revision(), crypto.randomUUID(), clerk);
    assert.throws(
        () => run('sale', { branch: 'A', items: [{ code: 'SP', qty: 1, salePrice: 1 }], given: 1 }),
        { status: 403 }
    );
    const edited = app.project(db.getAllData(), clerk);
    edited.products[0].price = 1;
    assert.throws(() => run('edit', edited), { status: 403 });
    assert.throws(() => run('catalogPatch', patchTable('products', [edited.products[0]])), {
        status: 403
    });
    assert.equal(app.revision(), revision);
    assert.equal(db.getAllData().products[0].price, 100000);
    assert.equal(db.getAllData().invoices.length, 0);
});

test('catalog price change is forbidden when posPrice is explicitly false (F1)', () => {
    const data = db.getAllData();
    const clerk = {
        id: 'CLERK',
        username: 'clerk',
        role: 'custom',
        branch: 'A',
        branches: ['A'],
        permissions: { products: true, posPrice: false }
    };
    data.users.push(clerk);
    db.saveAllData(data);
    const run = (payload) =>
        command('catalogPatch', payload, app.revision(), crypto.randomUUID(), clerk);
    assert.throws(() => run(patchTable('products', [{ ...data.products[0], price: 1 }])), {
        status: 403
    });
});

test('catalog stock and cost edits on products with transaction history are rejected (F2)', () => {
    sell(); // creates an invoice history for product SP in branch A
    const data = db.getAllData();
    const product = data.products.find((p) => p.code === 'SP' && p.branch === 'A');
    assert.throws(
        () => command('catalogPatch', patchTable('products', [{ ...product, stock: 999 }])),
        { status: 409 }
    );
    const worker = {
        id: 'WORKER',
        username: 'worker',
        role: 'custom',
        branch: 'A',
        branches: ['A'],
        permissions: { products: true }
    };
    data.users.push(worker);
    db.saveAllData(data);
    assert.throws(
        () =>
            command(
                'catalogPatch',
                patchTable('products', [{ ...product, costPrice: 0 }]),
                app.revision(),
                crypto.randomUUID(),
                worker
            ),
        { status: 403 }
    );
});

test('import cannot toggle a sold non-IMEI product to IMEI when history exists (F3)', () => {
    const data = db.getAllData();
    data.products.push({
        id: 'NON_IMEI',
        code: 'NON_IMEI',
        name: 'Simple Product',
        branch: 'A',
        stock: 1,
        price: 100000,
        costPrice: 50000,
        unit: 'Chiếc',
        category: 'Test',
        status: 'active',
        hasImei: false,
        imeis: []
    });
    db.saveAllData(data);
    sell({ items: [{ code: 'NON_IMEI', qty: 1 }] });
    assert.throws(
        () =>
            command('import', {
                branch: 'A',
                supplierCode: 'S',
                items: [
                    { code: 'NON_IMEI', qty: 1, price: 50000, hasImei: true, imeis: ['NEW_SN'] }
                ],
                paid: 50000
            }),
        /quản lý IMEI/
    );
});

test('transfer and receive into branch without existing product preserves metadata and media (F5)', () => {
    const data = db.getAllData();
    data.products[0].images = ['/uploads/watch.jpg'];
    data.products[0].videoUrl = '/uploads/watch.mp4';
    data.products[0].condition = 'good';
    data.products[0].conditionDetail = 'Mặt kính xước nhẹ';
    data.products[0].description = 'Mô tả chi tiết sản phẩm';
    db.saveAllData(data);
    const transfer = command('transfer', {
        fromBranch: 'A',
        toBranch: 'B',
        items: [{ code: 'SP', qty: 1 }]
    }).result;
    command('receive', { id: transfer.id });
    const received = db.getAllData().products.find((p) => p.code === 'SP' && p.branch === 'B');
    assert.ok(received);
    assert.deepEqual(received.images, ['/uploads/watch.jpg']);
    assert.equal(received.videoUrl, '/uploads/watch.mp4');
    assert.equal(received.condition, 'good');
    assert.equal(received.conditionDetail, 'Mặt kính xước nhẹ');
    assert.equal(received.description, 'Mô tả chi tiết sản phẩm');
});
