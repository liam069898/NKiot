'use strict';
require('./test-env');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('../db');
const { hashPassword } = require('../security');
const crm = require('../deplao-service');
const { handler } = require('../server');
let pos;
let posBase;

let fake;
const calls = [];
let messageBehaviour = 'ok';

function jsonResponse(res, status, data) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(data));
}

before(async () => {
    db.initDb();
    const data = db.getAllData();
    data.branches = [
        { id: 'B1', code: 'CN01', name: 'Chi nhánh chính', isDefault: 1 },
        { id: 'B2', code: 'CN02', name: 'Chi nhánh phụ', isDefault: 0 }
    ];
    data.users = [
        {
            id: 'ADMIN',
            code: 'NV001',
            name: 'Quản trị',
            username: 'admin',
            password: hashPassword('Admin-pass-123'),
            role: 'admin',
            branch: 'Chi nhánh chính',
            branches: ['Chi nhánh chính', 'Chi nhánh phụ'],
            status: 'active',
            permissions: { products: true, settings: true }
        },
        {
            id: 'STAFF',
            code: 'NV002',
            name: 'Nhân viên',
            username: 'staff',
            password: hashPassword('Staff-pass-123'),
            role: 'staff',
            branch: 'Chi nhánh chính',
            branches: ['Chi nhánh chính'],
            status: 'active',
            permissions: { products: true }
        }
    ];

    const uploads = process.env.NKIOT_UPLOADS_DIR;
    fs.mkdirSync(uploads, { recursive: true });
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    fs.writeFileSync(path.join(uploads, 'watch-a.jpg'), jpg);
    fs.writeFileSync(path.join(uploads, 'watch-b.jpg'), jpg);
    fs.writeFileSync(path.join(uploads, 'other.jpg'), jpg);

    data.products = [
        {
            id: 'P1',
            code: 'DH001',
            name: 'Đồng hồ thử',
            price: 1000000,
            stock: 1,
            branch: 'Chi nhánh chính',
            status: 'active',
            hasImei: true,
            imeis: ['SN-111111'],
            imeiDetails: {
                'SN-111111': { images: ['/uploads/watch-a.jpg', '/uploads/watch-b.jpg'] }
            },
            images: ['/uploads/other.jpg']
        }
    ];
    db.saveAllData(data);
});

before(async () => {
    fake = http.createServer(async (req, res) => {
        const body = [];
        for await (const chunk of req) body.push(chunk);
        calls.push({ url: req.url, headers: req.headers, body: Buffer.concat(body) });
        if (req.headers.authorization !== 'Bearer dpk_test')
            return jsonResponse(res, 401, { success: false });
        if (req.url === '/api/v1/me')
            return jsonResponse(res, 200, {
                success: true,
                data: { scopes: ['accounts:read', 'chat:read', 'media:write', 'chat:send'] }
            });
        if (req.url === '/api/v1/accounts')
            return jsonResponse(res, 200, {
                success: true,
                data: [
                    { id: 'acc-1', display_name: 'Zalo chính', channel: 'zalo', online: true },
                    {
                        id: 'acc-2',
                        display_name: 'Zalo ngoài chi nhánh',
                        channel: 'zalo',
                        online: true
                    }
                ]
            });
        if (req.url === '/api/v1/accounts/acc-1')
            return jsonResponse(res, 200, { success: true, data: { id: 'acc-1', online: true } });
        if (req.url.startsWith('/api/v1/accounts/acc-1/conversations?'))
            return jsonResponse(res, 200, {
                success: true,
                data: [
                    {
                        thread_id: 'thread-1',
                        display_name: 'Anh Minh',
                        type: 'user',
                        phone: '0900000000'
                    }
                ]
            });
        if (req.url === '/api/v1/accounts/acc-1/conversations/thread-1')
            return jsonResponse(res, 200, {
                success: true,
                data: { thread_id: 'thread-1', type: 'user' }
            });
        if (req.url === '/api/v1/media/uploads')
            return jsonResponse(res, 200, {
                success: true,
                data: { upload_id: `upl_${calls.length}` }
            });
        if (req.url === '/api/v1/accounts/acc-1/conversations/thread-1/messages') {
            if (messageBehaviour === 'reject') return jsonResponse(res, 400, { success: false });
            return jsonResponse(res, 200, {
                success: true,
                data: {
                    sent: [
                        { type: 'image', msg_id: 'm1' },
                        { type: 'image', msg_id: 'm2' },
                        { type: 'text', msg_id: 'm3' }
                    ]
                }
            });
        }
        return jsonResponse(res, 404, { success: false });
    });
    await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
    process.env.NKIOT_DEPLAO_URL = `http://127.0.0.1:${fake.address().port}/api/v1`;
    process.env.NKIOT_DEPLAO_KEY = 'dpk_test';
    process.env.NKIOT_DEPLAO_ACCOUNTS = JSON.stringify({ 'Chi nhánh chính': ['acc-1'] });
    pos = http.createServer(handler);
    await new Promise((resolve) => pos.listen(0, '127.0.0.1', resolve));
    posBase = `http://127.0.0.1:${pos.address().port}`;
});

after(async () => {
    if (pos) await new Promise((resolve) => pos.close(resolve));
    if (fake) await new Promise((resolve) => fake.close(resolve));
    db.closeDb();
});

beforeEach(() => {
    calls.length = 0;
    messageBehaviour = 'ok';
    db.getDb().prepare('DELETE FROM deplao_send_jobs').run();
});

function user(id) {
    return db.getAllData().users.find((u) => u.id === id);
}

function payload(overrides = {}) {
    return {
        id: crypto.randomUUID(),
        branch: 'Chi nhánh chính',
        accountId: 'acc-1',
        threadId: 'thread-1',
        productId: 'P1',
        imei: 'SN-111111',
        text: 'Giá 1.000.000đ',
        images: ['/uploads/watch-a.jpg', '/uploads/watch-b.jpg'],
        confirmed: true,
        ...overrides
    };
}

test('deplao guards configuration, role, branch, account and image scope', async () => {
    await assert.rejects(
        () => crm.connection(user('STAFF'), 'Chi nhánh chính'),
        (e) => e.status === 403
    );
    await assert.rejects(
        () => crm.connection(user('ADMIN'), 'Chi nhánh phụ'),
        (e) => e.status === 403
    );
    await assert.rejects(
        () => crm.send(user('ADMIN'), payload({ accountId: 'acc-2' })),
        (e) => e.status === 403
    );
    await assert.rejects(
        () => crm.send(user('ADMIN'), payload({ images: ['/uploads/other.jpg'] })),
        (e) => e.status === 403
    );

    const original = process.env.NKIOT_DEPLAO_URL;
    process.env.NKIOT_DEPLAO_URL = 'http://evil.example/api/v1';
    await assert.rejects(
        () => crm.connection(user('ADMIN'), 'Chi nhánh chính'),
        (e) => e.status === 503
    );
    process.env.NKIOT_DEPLAO_URL = original;
});

test('deplao connection and conversations only expose branch-mapped accounts', async () => {
    const out = await crm.connection(user('ADMIN'), 'Chi nhánh chính');
    assert.deepEqual(out.accounts, [
        { id: 'acc-1', name: 'Zalo chính', channel: 'zalo', online: true }
    ]);
    const conv = await crm.conversations(user('ADMIN'), 'Chi nhánh chính', 'acc-1', 'Minh', 0);
    assert.equal(conv.conversations[0].id, 'thread-1');
    assert.equal(conv.hasMore, false);
    assert.ok(calls.every((c) => c.headers.authorization === 'Bearer dpk_test'));
});

test('deplao uploads every image before one idempotent message and never replays', async () => {
    const input = payload();
    const sent = await crm.send(user('ADMIN'), input);
    assert.equal(sent.status, 'sent');
    assert.equal(sent.uploaded, 2);
    assert.equal(calls.filter((c) => c.url.endsWith('/media/uploads')).length, 2);

    const messages = calls.filter((c) => c.url.endsWith('/messages'));
    assert.equal(messages.length, 1);
    assert.equal(messages[0].headers['idempotency-key'], `nkiot-${input.id}`);
    const body = JSON.parse(messages[0].body.toString('utf8'));
    assert.equal(body.attachments.length, 2);
    assert.equal(body.text, 'Giá 1.000.000đ');

    const replay = await crm.send(user('ADMIN'), input);
    assert.equal(replay.status, 'sent');
    assert.equal(calls.filter((c) => c.url.endsWith('/messages')).length, 1);
    await assert.rejects(
        () => crm.send(user('ADMIN'), { ...input, text: 'khác' }),
        (e) => e.status === 409
    );
});

test('deplao marks needs_review when the chat send cannot be confirmed', async () => {
    messageBehaviour = 'reject';
    const result = await crm.send(user('ADMIN'), payload());
    assert.equal(result.status, 'needs_review');
    assert.ok(result.result.error);
});

async function httpJson(pathname, { method = 'GET', body, cookie, csrf } = {}) {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    if (csrf) headers['x-nkiot-csrf'] = csrf;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${posBase}${pathname}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: res.status, headers: res.headers, body: await res.json() };
}

async function login(username, password) {
    const res = await httpJson('/api/login', { method: 'POST', body: { username, password } });
    assert.equal(res.status, 200);
    return {
        cookie: (res.headers.get('set-cookie') || '').split(';')[0],
        csrf: res.body.csrfToken
    };
}

test('deplao HTTP routes reject anonymous callers and expose connection to admin only', async () => {
    const anonymous = await httpJson('/api/deplao/connection?branch=Chi%20nh%C3%A1nh%20ch%C3%ADnh');
    assert.equal(anonymous.status, 401);

    const staff = await login('staff', 'Staff-pass-123');
    const staffCall = await httpJson(
        '/api/deplao/connection?branch=Chi%20nh%C3%A1nh%20ch%C3%ADnh',
        staff
    );
    assert.equal(staffCall.status, 403);

    const admin = await login('admin', 'Admin-pass-123');
    const ok = await httpJson('/api/deplao/connection?branch=Chi%20nh%C3%A1nh%20ch%C3%ADnh', admin);
    assert.equal(ok.status, 200);
    assert.deepEqual(
        ok.body.accounts.map((a) => a.id),
        ['acc-1']
    );

    const missing = await httpJson('/api/deplao/nope', admin);
    assert.equal(missing.status, 404);
});
