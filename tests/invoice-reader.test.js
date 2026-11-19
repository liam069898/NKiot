'use strict';
require('./test-env');
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nkiot-invoice-pages-'));
process.env.NKIOT_DB_PATH = path.join(dir, 'test.db');
process.env.MINIKIOT_ADMIN_PASSWORD = 'Test-password-123';
const db = require('../db');
const { listInvoices } = require('../invoice-reader');
const { ALL_BRANCHES, FALLBACK_BRANCH } = require('../constants');
let admin;
const query = (input = {}, user = admin) => listInvoices(user, new URLSearchParams(input));
before(() => db.initDb());
beforeEach(() => {
    const data = db.getAllData();
    for (const table of db.ENTITY_TABLES) if (table !== 'users') data[table] = [];
    data.branches = [
        { id: 'A', name: 'A' },
        { id: 'B', name: 'B' },
        { id: 'F', name: FALLBACK_BRANCH }
    ];
    admin = { ...data.users[0], branch: 'A', branches: ['A', 'B'] };
    data.users = [admin];
    const now = new Date();
    const today = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} 10:00`;
    data.invoices = Array.from({ length: 125 }, (_, i) => ({
        id: `I${i}`,
        code: `HD${i}`,
        branch: i < 120 ? 'A' : 'B',
        customer: i === 0 ? 'ĐẶNG An' : 'Customer',
        phone: '090',
        time: today,
        status: 'completed',
        total: 10,
        paid: 10,
        items: []
    }));
    data.invoices[1].status = 'cancelled';
    data.invoices[2].hasReturned = true;
    data.returns = [
        { id: 'R', code: 'R', invoiceCode: 'HD3', branch: 'A', items: [], totalRefund: 1 }
    ];
    db.saveAllData(data);
});
after(() => {
    db.closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
});
test('SQL pages are bounded, ordered and return summaries only', () => {
    const first = query();
    const second = query({ page: '2', revision: String(first.revision) });
    assert.equal(first.total, 120);
    assert.equal(first.rows.length, 50);
    assert.equal(second.rows[0].id, 'I50');
    assert.equal(first.rows[0].items, undefined);
    assert.equal(query({ page: '99' }).page, 3);
    assert.equal(query({ page: '3' }).rows.length, 20);
    assert.equal(query({ branch: ALL_BRANCHES }).total, 125);
});
test('scope and permissions apply to counts and returned rows', () => {
    const staff = { ...admin, role: 'custom', branches: ['A'], permissions: { invoices: true } };
    assert.equal(query({ branch: ALL_BRANCHES }, staff).total, 120);
    assert.throws(() => query({ branch: 'B' }, staff), { status: 403 });
    assert.throws(() => query({}, { ...staff, permissions: { pos: true } }), { status: 403 });
    assert.throws(() => query({}, { ...staff, status: 'locked' }), { status: 403 });
});
test('filters match returned flags, return documents, Vietnamese search and date presets', () => {
    assert.equal(query({ status: 'returned' }).total, 2);
    assert.equal(query({ status: 'completed' }).total, 117);
    assert.equal(query({ status: 'cancelled' }).total, 1);
    assert.equal(query({ q: 'đặng' }).rows[0].id, 'I0');
    assert.equal(query({ q: "' OR 1=1 --" }).total, 0);
    assert.equal(query({ date: 'today' }).total, 120);
    assert.equal(query({ date: 'yesterday' }).total, 0);
});
test('invalid parameters and stale revisions fail explicitly', () => {
    for (const input of [
        { page: '0' },
        { page: '1.5' },
        { pageSize: '101' },
        { pageSize: '-1' },
        { status: 'bad' },
        { date: 'custom' },
        { q: 'x'.repeat(201) },
        { revision: 'oops' }
    ])
        assert.throws(() => query(input), { status: 400 });
    const page = query();
    db.getDb()
        .prepare("UPDATE app_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'")
        .run();
    assert.throws(() => query({ page: '2', revision: String(page.revision) }), { status: 409 });
    assert.ok(query().revision > page.revision);
});
test('list tolerates legacy JSON and matches fallback branch; indexes survive repeated migration', () => {
    const d = db.getDb();
    d.prepare("UPDATE invoices SET branch='',extra='bad-json' WHERE id='I0'").run();
    assert.equal(query({ branch: FALLBACK_BRANCH }).rows[0].id, 'I0');
    db.initDb();
    assert.ok(
        d
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='index' AND name='returns_invoice_code'"
            )
            .get()
    );
    const plan = d
        .prepare(
            "EXPLAIN QUERY PLAN SELECT id FROM invoices WHERE COALESCE(NULLIF(branch,''), 'Kalo HCM')=? ORDER BY rowid LIMIT 50"
        )
        .all('A');
    assert.ok(plan.some((row) => row.detail.includes('invoices_branch_list')));
});

test('advanced search filters invoices by document, product, customer, shipment, IMEI and notes', () => {
    const data = db.getAllData();
    data.invoices = [
        {
            id: 'A1',
            code: 'HD-A1',
            branch: 'A',
            customer: 'Nguyễn Văn Đức',
            phone: '0911000001',
            time: '11/10/2026 10:00',
            status: 'completed',
            total: 100,
            paid: 100,
            note: 'Giao giờ hành chính',
            items: [
                {
                    code: 'SP-TAI',
                    name: 'Tai nghe Bluetooth',
                    qty: 1,
                    price: 100,
                    total: 100,
                    imeis: ['IMEI-0001'],
                    note: 'Hàng trưng bày'
                }
            ]
        },
        {
            id: 'A2',
            code: 'HD-A2',
            branch: 'A',
            customer: 'Trần Thị Bình',
            phone: '0911000002',
            time: '11/10/2026 11:00',
            status: 'completed',
            total: 200,
            paid: 200,
            note: 'Khách quen',
            items: [
                {
                    code: 'SP-SAC',
                    name: 'Cáp sạc nhanh',
                    qty: 1,
                    price: 200,
                    total: 200,
                    imeis: [],
                    note: 'Còn bảo hành'
                }
            ]
        }
    ];
    data.customers = [
        {
            id: 'C1',
            code: 'KH0001',
            name: 'Nguyễn Văn Đức',
            phone: '0911000001',
            address: '',
            totalSpent: 0,
            debt: 0,
            points: 0
        },
        {
            id: 'C2',
            code: 'KH0002',
            name: 'Trần Thị Bình',
            phone: '0911000002',
            address: '',
            totalSpent: 0,
            debt: 0,
            points: 0
        }
    ];
    data.delivery_orders = [
        {
            id: 'VTP1',
            invoiceId: 'A2',
            branch: 'A',
            code: 'GH0002',
            orderNumber: 'VTP0002',
            shipmentCode: 'SHIP-9002',
            createdAt: '2026-10-11T11:00:00.000Z',
            updatedAt: '2026-10-11T11:00:00.000Z',
            status: 'confirmed'
        }
    ];
    db.saveAllData(data);

    const only = (input) => query(input).rows.map((row) => row.id);
    // Mã hóa đơn, không phân biệt hoa thường và có/không dấu.
    assert.deepEqual(only({ code: 'hd-a1' }), ['A1']);
    // Mã và tên hàng hóa.
    assert.deepEqual(only({ product: 'tai nghe' }), ['A1']);
    assert.deepEqual(only({ product: 'SP-SAC' }), ['A2']);
    // Mã, tên, SĐT khách hàng (kể cả mã khách lấy từ bảng customers).
    assert.deepEqual(only({ customer: 'duc' }), ['A1']);
    assert.deepEqual(only({ customer: 'KH0002' }), ['A2']);
    // Mã vận đơn trong delivery_orders.
    assert.deepEqual(only({ shipment: 'ship-9002' }), ['A2']);
    // IMEI / Serial của hàng hóa.
    assert.deepEqual(only({ imei: 'imei-0001' }), ['A1']);
    // Ghi chú hóa đơn và ghi chú hàng hóa là hai trường riêng.
    assert.deepEqual(only({ note: 'hành chính' }), ['A1']);
    assert.deepEqual(only({ itemNote: 'bảo hành' }), ['A2']);
    // Nhiều trường là AND nên kết hợp sai sẽ không khớp.
    assert.deepEqual(only({ product: 'tai nghe', note: 'khách quen' }), []);
    assert.deepEqual(only({ product: 'capsac' }), []);
    assert.deepEqual(only({ itemNote: 'bao hanh' }), ['A2']);
    // Từ khóa chung vẫn bỏ dấu được.
    assert.deepEqual(only({ q: 'nguyen van duc' }), ['A1']);
    assert.throws(() => query({ code: 'x'.repeat(201) }), { status: 400 });
});

test('advanced search ignores legacy invalid item JSON and stays scoped to the branch', () => {
    const data = db.getAllData();
    data.invoices[0].items = [{ code: 'SP-X', name: 'Đồng hồ', qty: 1, price: 10, total: 10 }];
    data.invoices[120].items = [{ code: 'SP-X', name: 'Đồng hồ', qty: 1, price: 10, total: 10 }];
    db.saveAllData(data);
    const ids = (input) => query(input).rows.map((row) => row.id);
    // Chi nhánh A chỉ thấy hóa đơn của A; chi nhánh B có hóa đơn cùng mặt hàng nhưng bị loại.
    assert.deepEqual(ids({ product: 'dong ho' }), ['I0']);
    assert.deepEqual(ids({ product: 'dong ho', branch: 'B' }), ['I120']);
    // JSON hỏng trong cột items không làm hỏng câu truy vấn, chỉ không khớp.
    db.getDb().prepare("UPDATE invoices SET items='not-json' WHERE id='I0'").run();
    assert.deepEqual(ids({ product: 'dong ho' }), []);
    assert.equal(query({}).total, 120);
});

test('empty result has one empty page and all date presets match the existing helper', () => {
    assert.deepEqual(query({ q: 'not-existing' }).rows, []);
    assert.equal(query({ q: 'not-existing' }).pages, 1);
    const dates = [
        '01/01/2025 09:00',
        '21/10/2026 10:00',
        '',
        'not-a-date',
        new Date().toISOString()
    ];
    const data = db.getAllData();
    data.invoices = dates.map((time, i) => ({
        ...data.invoices[0],
        id: `DATE${i}`,
        code: `DATE${i}`,
        time,
        branch: 'A'
    }));
    db.saveAllData(data);
    const { matchesDateFilter } = require('../app-utils');
    for (const date of [
        'today',
        'yesterday',
        '7days',
        '30days',
        'this_month',
        'last_month',
        'this_quarter',
        'this_year'
    ]) {
        const expected = data.invoices
            .filter((row) => matchesDateFilter(row.time, date))
            .map((row) => row.id);
        assert.deepEqual(
            query({ date }).rows.map((row) => row.id),
            expected
        );
    }
});
