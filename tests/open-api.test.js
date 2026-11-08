'use strict';
require('./test-env');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');
const { hashPassword } = require('../security');
const { handler } = require('../server');

let server;
let baseUrl;

async function apiRequest(
    pathname,
    { method = 'GET', body, cookie, csrf, headers: customHeaders = {} } = {}
) {
    const headers = { ...customHeaders };
    if (cookie) headers.cookie = cookie;
    if (csrf) headers['x-nkiot-csrf'] = csrf;
    let payload;
    if (body !== undefined) {
        headers['content-type'] = 'application/json';
        payload = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const res = await fetch(`${baseUrl}${pathname}`, {
        method,
        headers,
        body: payload
    });
    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
        ? await res.json()
        : Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, body: data };
}

async function loginAs(username, password) {
    const res = await apiRequest('/api/login', {
        method: 'POST',
        body: { username, password }
    });
    assert.equal(res.status, 200);
    const setCookie = res.headers.get('set-cookie') || '';
    const cookie = setCookie.split(';')[0];
    return { cookie, csrf: res.body.csrfToken };
}

before(async () => {
    db.initDb();
    const data = db.getAllData();
    data.branches = [
        { id: 'B1', code: 'CN01', name: 'Chi nhánh chính', isDefault: 1 },
        { id: 'B2', code: 'CN02', name: 'Kho Phụ', isDefault: 0 }
    ];
    data.users = [
        {
            id: 'U_ADMIN',
            code: 'NV001',
            name: 'Quản trị viên',
            username: 'admin',
            password: hashPassword('Admin-pass-123'),
            phone: '0901234567',
            role: 'admin',
            branch: 'Chi nhánh chính',
            branches: ['Chi nhánh chính', 'Kho Phụ'],
            status: 'active',
            permissions: { settings: true, products: true }
        },
        {
            id: 'U_STAFF',
            code: 'NV002',
            name: 'Nhân viên bán',
            username: 'staff',
            password: hashPassword('Staff-pass-123'),
            phone: '0912345678',
            role: 'staff',
            branch: 'Chi nhánh chính',
            branches: ['Chi nhánh chính'],
            status: 'active',
            permissions: { pos: true }
        }
    ];

    const uploadsDir = process.env.NKIOT_UPLOADS_DIR;
    fs.mkdirSync(uploadsDir, { recursive: true });
    const fakeJpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    fs.writeFileSync(path.join(uploadsDir, 'watch-main.jpg'), fakeJpg);
    fs.writeFileSync(path.join(uploadsDir, 'imei-sn1-pic.jpg'), fakeJpg);
    fs.writeFileSync(path.join(uploadsDir, 'private.jpg'), fakeJpg);

    data.products = [
        {
            id: 'P_OPEN_1',
            code: 'DH_SEIKO',
            name: 'Đồng hồ Seiko 5 Sport Automatic',
            category: 'Đồng hồ',
            costPrice: 4200000,
            price: 6500000,
            stock: 2,
            branch: 'Chi nhánh chính',
            status: 'active',
            condition: 'new',
            conditionDetail: 'Mới 100% fullbox',
            description: 'Đồng hồ cơ quân đội bền bỉ.',
            images: ['/uploads/watch-main.jpg'],
            hasImei: true,
            imeis: ['SN-SEIKO-999999'],
            imeiDetails: {
                'SN-SEIKO-999999': {
                    condition: 'new',
                    conditionDetail: 'Hàng new seal',
                    images: ['/uploads/imei-sn1-pic.jpg']
                }
            }
        },
        {
            id: 'P_OPEN_2',
            code: 'PK_DAY',
            name: 'Dây da cá sấu handmade',
            category: 'Phụ kiện',
            costPrice: 200000,
            price: 550000,
            stock: 10,
            branch: 'Chi nhánh chính',
            status: 'active',
            images: [],
            hasImei: false
        }
    ];
    db.saveAllData(data);

    server = http.createServer(handler);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    db.closeDb();
});

test('external clients read products and unit media with a revocable branch token', async () => {
    const openApi = require('../open-api-service');
    const admin = db.getAllData().users.find((user) => user.role === 'admin');
    const created = openApi.createToken(admin, {
        name: 'External client contract test',
        branch: 'Chi nhánh chính',
        expiresInDays: 1
    });
    const headers = { Authorization: `Bearer ${created.token}` };
    try {
        const result = await apiRequest(
            '/api/v1/open/products?q=DH_SEIKO&in_stock=true&page=1&limit=12',
            { headers }
        );
        assert.equal(result.status, 200);
        assert.equal(result.body.success, true);
        assert.equal(result.body.data.length, 1);
        const product = result.body.data[0];
        assert.equal(product.code, 'DH_SEIKO');
        assert.equal(product.price, 6500000);
        assert.equal(product.units.length, 1);
        const unit = product.units[0];
        assert.doesNotMatch(JSON.stringify(result.body), /SN-SEIKO-999999|costPrice|nk_live_/);
        const media = await apiRequest(unit.images[0], { headers });
        assert.equal(media.status, 200);
        assert.equal(media.headers.get('content-type'), 'image/jpeg');
        assert.deepEqual(
            media.body,
            fs.readFileSync(path.join(process.env.NKIOT_UPLOADS_DIR, 'imei-sn1-pic.jpg'))
        );
        const detail = await apiRequest(`/api/v1/open/products/${product.code}`, { headers });
        assert.equal(detail.status, 200);
        assert.deepEqual(detail.body.data.units, product.units);
        openApi.revokeToken(admin, created.id);
        assert.equal((await apiRequest('/api/v1/open/products', { headers })).status, 401);
        assert.equal((await apiRequest(unit.images[0], { headers })).status, 401);
    } finally {
        openApi.deleteToken(admin, created.id);
    }
});

test('admin creates, lists, revokes and deletes API tokens with permission guard', async () => {
    const admin = await loginAs('admin', 'Admin-pass-123');
    const staff = await loginAs('staff', 'Staff-pass-123');

    // Nhân viên không có quyền settings bị chặn
    const denied = await apiRequest('/api/tokens', {
        method: 'POST',
        cookie: staff.cookie,
        csrf: staff.csrf,
        body: { name: 'CRM Hack' }
    });
    assert.equal(denied.status, 403);
    const data = db.getAllData();
    data.users.find((u) => u.username === 'staff').permissions.settings = true;
    db.saveAllData(data);
    const scoped = await apiRequest('/api/tokens', {
        method: 'POST',
        ...staff,
        body: { name: 'Escalate', branch: 'ALL' }
    });
    assert.equal(scoped.status, 403);
    const all = await apiRequest('/api/tokens', {
        method: 'POST',
        ...admin,
        body: { name: 'All', branch: 'ALL' }
    });
    assert.equal(all.status, 400);

    // Admin tạo Token thành công
    const created = await apiRequest('/api/tokens', {
        method: 'POST',
        cookie: admin.cookie,
        csrf: admin.csrf,
        body: {
            name: 'App Chat CRM Nội bộ',
            branch: 'Chi nhánh chính',
            expiresInDays: 30
        }
    });
    assert.equal(created.status, 201);
    const tokenData = created.body.token;
    assert.ok(tokenData.token.startsWith('nk_live_'));
    assert.ok(tokenData.maskedToken.includes('...'));

    // Danh sách Token che giấu secret raw token
    const listRes = await apiRequest('/api/tokens', {
        cookie: admin.cookie,
        csrf: admin.csrf
    });
    assert.equal(listRes.status, 200);
    assert.ok(Array.isArray(listRes.body.tokens));
    const found = listRes.body.tokens.find((t) => t.id === tokenData.id);
    assert.ok(found);
    assert.equal(found.name, 'App Chat CRM Nội bộ');
    assert.equal(found.token, undefined);
    assert.equal(found.tokenHash, undefined);
    assert.equal(found.status, 'active');

    // Thu hồi token
    const revokeRes = await apiRequest(`/api/tokens/${tokenData.id}/revoke`, {
        method: 'POST',
        cookie: admin.cookie,
        csrf: admin.csrf,
        body: {}
    });
    assert.equal(revokeRes.status, 200);

    const afterRevokeList = await apiRequest('/api/tokens', {
        cookie: admin.cookie,
        csrf: admin.csrf
    });
    const foundRevoked = afterRevokeList.body.tokens.find((t) => t.id === tokenData.id);
    assert.equal(foundRevoked.status, 'revoked');

    // Xóa token
    const deleteRes = await apiRequest(`/api/tokens/${tokenData.id}`, {
        method: 'DELETE',
        cookie: admin.cookie,
        csrf: admin.csrf
    });
    assert.equal(deleteRes.status, 200);
});

test('open API sanitizes products and media, supports CORS and Bearer auth, rejects query tokens', async () => {
    const admin = await loginAs('admin', 'Admin-pass-123');
    const created = await apiRequest('/api/tokens', {
        method: 'POST',
        cookie: admin.cookie,
        csrf: admin.csrf,
        body: {
            name: 'CRM Open Test Token',
            branch: 'Chi nhánh chính',
            expiresInDays: 90
        }
    });
    assert.equal(created.status, 201);
    const rawToken = created.body.token.token;

    // 1. CORS Preflight OPTIONS
    const preflight = await apiRequest('/api/v1/open/products', {
        method: 'OPTIONS',
        headers: { Origin: 'https://mycrm.com' }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), '*');

    // 2. Gọi Open API với Bearer Token
    const resBearer = await apiRequest('/api/v1/open/products?in_stock=true', {
        headers: {
            Authorization: `Bearer ${rawToken}`,
            Origin: 'https://mycrm.com'
        }
    });
    assert.equal(resBearer.status, 200);
    assert.equal(resBearer.headers.get('access-control-allow-origin'), '*');
    assert.equal(resBearer.body.success, true);
    assert.ok(Array.isArray(resBearer.body.data));

    const seiko = resBearer.body.data.find((p) => p.code === 'DH_SEIKO');
    assert.ok(seiko);
    assert.equal(seiko.price, 6500000);
    assert.equal(seiko.costPrice, undefined, 'Tuyệt đối không lộ giá vốn');
    assert.ok(seiko.images.length > 0);
    assert.match(seiko.images[0], /^\/api\/v1\/open\/media\/[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(resBearer.body).includes(rawToken));
    assert.ok(!JSON.stringify(resBearer.body).includes('SN-SEIKO-999999'));
    assert.equal(seiko.stock, undefined);
    assert.equal(
        (
            await apiRequest('/api/v1/open/media/private.jpg', {
                headers: { Authorization: `Bearer ${rawToken}` }
            })
        ).status,
        404
    );
    const crypto = require('node:crypto');
    const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const privateId = crypto.createHmac('sha256', hash).update('private.jpg').digest('hex');
    assert.equal(
        (
            await apiRequest(`/api/v1/open/media/${privateId}`, {
                headers: { Authorization: `Bearer ${rawToken}` }
            })
        ).status,
        404
    );
    assert.equal((await apiRequest(seiko.images[0])).status, 401);

    // Kiểm tra thông tin IMEI và ảnh riêng của IMEI cho app Chat CRM
    assert.ok(seiko.units.length > 0);
    assert.match(seiko.units[0].id, /^[a-f0-9]{64}$/);
    assert.equal(seiko.units[0].serialMasked, '***9999');
    assert.match(seiko.units[0].images[0], /open\/media\/[a-f0-9]{64}$/);

    // 3. Không chấp nhận token trên URL (tránh lộ qua log, lịch sử và referrer).
    const resQuery = await apiRequest(`/api/v1/open/products?token=${rawToken}&q=seiko`);
    assert.equal(resQuery.status, 401);

    // 4. Lấy chi tiết một sản phẩm theo mã
    const detail = await apiRequest('/api/v1/open/products/DH_SEIKO', {
        headers: { Authorization: `Bearer ${rawToken}` }
    });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.name, 'Đồng hồ Seiko 5 Sport Automatic');

    // 4b. Lấy chi tiết sản phẩm có dấu chấm hoặc dấu hai chấm trong mã (F4)
    const data = db.getAllData();
    data.products.push({
        id: 'P_DOT_COLON',
        code: 'DH.SEIKO:01',
        name: 'Seiko Special Edition',
        category: 'Đồng hồ',
        costPrice: 4000000,
        price: 7000000,
        stock: 5,
        branch: 'Chi nhánh chính',
        status: 'active',
        images: [],
        hasImei: false
    });
    db.saveAllData(data);
    const detailDot = await apiRequest('/api/v1/open/products/DH.SEIKO%3A01', {
        headers: { Authorization: `Bearer ${rawToken}` }
    });
    assert.equal(detailDot.status, 200);
    assert.equal(detailDot.body.data.name, 'Seiko Special Edition');

    // Exact case-sensitive identity wins; normalized input is only a fallback
    // when it identifies one product unambiguously.
    const caseData = db.getAllData();
    const template = caseData.products.find((p) => p.id === 'P_DOT_COLON');
    caseData.products.push(
        { ...template, id: 'CASE_UPPER', code: 'Case:01', name: 'Upper variant', price: 111 },
        { ...template, id: 'CASE_LOWER', code: 'case:01', name: 'Lower variant', price: 222 },
        { ...template, id: 'CASE_OTHER_BRANCH', code: 'Case:01', branch: 'Kho Phụ', price: 333 }
    );
    db.saveAllData(caseData);
    for (const [code, price] of [
        ['Case:01', 111],
        ['case:01', 222]
    ]) {
        const response = await apiRequest(`/api/v1/open/products/${encodeURIComponent(code)}`, {
            headers: { Authorization: `Bearer ${rawToken}` }
        });
        assert.equal(response.status, 200);
        assert.equal(response.body.data.code, code);
        assert.equal(response.body.data.price, price);
    }
    assert.equal(
        (
            await apiRequest('/api/v1/open/products/CASE%3A01', {
                headers: { Authorization: `Bearer ${rawToken}` }
            })
        ).status,
        409
    );
    assert.equal(
        (
            await apiRequest('/api/v1/open/products/dh_seiko', {
                headers: { Authorization: `Bearer ${rawToken}` }
            })
        ).status,
        200
    );

    // 5. Tải ảnh Open Media trực tiếp
    const mediaRes = await apiRequest(seiko.images[0], {
        headers: { Authorization: `Bearer ${rawToken}` }
    });
    assert.equal(mediaRes.status, 200);
    assert.equal(mediaRes.headers.get('content-type'), 'image/jpeg');
    assert.equal(mediaRes.headers.get('access-control-allow-origin'), '*');
    assert.ok(mediaRes.headers.get('etag'));

    // 6. Kiểm tra cache ETag / 304 Not Modified
    const etag = mediaRes.headers.get('etag');
    const res304 = await apiRequest(seiko.images[0], {
        headers: { 'If-None-Match': etag, Authorization: `Bearer ${rawToken}` }
    });
    assert.equal(res304.status, 304);

    // 7. Thu hồi token thì Open API phải từ chối ngay lập tức
    await apiRequest(`/api/tokens/${created.body.token.id}/revoke`, {
        method: 'POST',
        cookie: admin.cookie,
        csrf: admin.csrf,
        body: {}
    });

    const deniedAfterRevoke = await apiRequest('/api/v1/open/products', {
        headers: { Authorization: `Bearer ${rawToken}` }
    });
    assert.equal(deniedAfterRevoke.status, 401);
    assert.ok(deniedAfterRevoke.body.error.includes('thu hồi'));

    const deniedMedia = await apiRequest(seiko.images[0], {
        headers: { Authorization: `Bearer ${rawToken}` }
    });
    assert.equal(deniedMedia.status, 401);
});
