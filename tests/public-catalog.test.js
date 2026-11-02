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
const { computeCatalogMediaId } = require('../catalog-service');

let server;
let baseUrl;

async function apiRequest(pathname, { method = 'GET', body, cookie, csrf } = {}) {
    const headers = {};
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
        { id: 'B1', code: 'CN01', name: 'Chi nhánh A', isDefault: 1 },
        { id: 'B2', code: 'CN02', name: 'Chi nhánh B', isDefault: 0 }
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
            branch: 'Chi nhánh A',
            branches: ['Chi nhánh A', 'Chi nhánh B'],
            status: 'active',
            permissions: { products: true, settings: true }
        },
        {
            id: 'U_SALE_A',
            code: 'NV002',
            name: 'Sale Minh',
            username: 'sale_a',
            password: hashPassword('SaleA-pass-123'),
            phone: '0988888888',
            role: 'staff',
            branch: 'Chi nhánh A',
            branches: ['Chi nhánh A'],
            status: 'active',
            permissions: { products: true, pos: true }
        },
        {
            id: 'U_CASHIER',
            code: 'NV003',
            name: 'Thu ngân',
            username: 'cashier_only',
            password: hashPassword('Cashier-pass-123'),
            phone: '0977777777',
            role: 'staff',
            branch: 'Chi nhánh A',
            branches: ['Chi nhánh A'],
            status: 'active',
            permissions: { pos: true }
        }
    ];

    const uploadsDir = process.env.NKIOT_UPLOADS_DIR;
    fs.mkdirSync(uploadsDir, { recursive: true });
    const fakeJpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    fs.writeFileSync(path.join(uploadsDir, 'watch-prx.jpg'), fakeJpg);
    fs.writeFileSync(path.join(uploadsDir, 'secret-internal.jpg'), fakeJpg);
    fs.writeFileSync(path.join(uploadsDir, 'omega-imei1-front.jpg'), fakeJpg);
    fs.writeFileSync(path.join(uploadsDir, 'omega-imei1-back.jpg'), fakeJpg);
    fs.writeFileSync(path.join(uploadsDir, 'omega-imei2-only.jpg'), fakeJpg);

    data.products = [
        {
            id: 'P_WATCH_1',
            code: 'DH001',
            name: 'Đồng hồ Tissot PRX Powermatic 80',
            category: 'Đồng hồ',
            costPrice: 9500000,
            price: 12900000,
            stock: 3,
            branch: 'Chi nhánh A',
            status: 'active',
            condition: 'like_new',
            conditionDetail: 'Fullbox 99%',
            description: 'Máy cơ Thụy Sĩ trữ cót 80 giờ, kính Sapphire.',
            images: ['/uploads/watch-prx.jpg']
        },
        {
            id: 'P_WATCH_2',
            code: 'DH002',
            name: 'Đồng hồ Seiko Presage Cocktail',
            category: 'Đồng hồ',
            costPrice: 7800000,
            price: 11200000,
            stock: 2,
            branch: 'Chi nhánh A',
            status: 'active',
            condition: 'new',
            conditionDetail: 'Mới 100% chính hãng',
            description: 'Mặt số tia nắng xanh, bảo hành 24 tháng.',
            images: []
        },
        {
            id: 'P_BRANCH_B',
            code: 'DH_B01',
            name: 'Đồng hồ Orient Star Chi nhánh B',
            category: 'Đồng hồ',
            costPrice: 10000000,
            price: 14500000,
            stock: 1,
            branch: 'Chi nhánh B',
            status: 'active',
            images: []
        },
        {
            id: 'P_MULTI_IMEI',
            code: 'DH_OMEGA',
            name: 'Đồng hồ Omega Seamaster Aqua Terra',
            category: 'Đồng hồ',
            costPrice: 11000000,
            price: 14800000,
            stock: 2,
            branch: 'Chi nhánh A',
            status: 'active',
            hasImei: 1,
            imeis: ['OMEGA-SN-111111', 'OMEGA-SN-222222'],
            images: ['/uploads/watch-prx.jpg'],
            imeiDetails: {
                'OMEGA-SN-111111': {
                    condition: 'like_new',
                    conditionDetail: 'Máy 111111 đẹp 99%, đủ hộp sổ thẻ',
                    images: ['/uploads/omega-imei1-front.jpg', '/uploads/omega-imei1-back.jpg']
                },
                'OMEGA-SN-222222': {
                    condition: 'good',
                    conditionDetail: 'Máy 222222 trầy nhẹ khóa, giá tốt',
                    images: ['/uploads/omega-imei2-only.jpg']
                }
            }
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

test('sale creates public catalog link, snapshot stays immutable, and public viewer renders without login', async () => {
    const sale = await loginAs('sale_a', 'SaleA-pass-123');

    const created = await apiRequest('/api/catalogs', {
        method: 'POST',
        cookie: sale.cookie,
        csrf: sale.csrf,
        body: {
            title: 'Mẫu đồng hồ tầm giá 10 - 15 triệu',
            message: 'Em gửi anh các mẫu đồng hồ Thụy Sĩ và Nhật đang sẵn tại cửa hàng ạ.',
            contactName: 'Sale Minh',
            contactPhone: '0988888888',
            expiresInHours: 72,
            branch: 'Chi nhánh A',
            items: [
                { code: 'DH001', displayPrice: 12500000 },
                { code: 'DH002', displayPrice: 11200000 }
            ]
        }
    });
    assert.equal(created.status, 201);
    const cat = created.body.catalog;
    assert.ok(cat.token && cat.token.length >= 20);
    assert.equal(cat.url, `/catalog/${cat.token}`);
    assert.equal(cat.itemCount, 2);
    assert.equal(cat.items[0].displayPrice, 12500000);

    // Đổi giá nội bộ sau khi tạo catalog -> dữ liệu snapshot trên catalog gửi khách không bị nhảy theo
    const snapshot = db.getAllData();
    snapshot.products.find((p) => p.code === 'DH001').price = 19900000;
    db.saveAllData(snapshot);

    // Khách truy cập trang public không cần cookie đăng nhập
    const pubPage = await apiRequest(`/catalog/${cat.token}`);
    assert.equal(pubPage.status, 200);
    assert.match(pubPage.headers.get('x-robots-tag') || '', /noindex/i);
    const html = pubPage.body.toString('utf8');
    assert.ok(html.includes('Mẫu đồng hồ tầm giá 10 - 15 triệu'));
    assert.ok(html.includes('Đồng hồ Tissot PRX Powermatic 80'));
    assert.ok(html.includes('12.500.000đ'));
    assert.ok(!html.includes('9.500.000'), 'Không được lộ giá vốn trên trang public');
    assert.ok(!html.includes('19.900.000'), 'Giá snapshot không bị thay đổi khi kho đổi giá');

    // Ảnh thuộc catalog tải được không cần login qua /catalog-media/:token/:mediaId
    const validMediaId = computeCatalogMediaId(cat.token, '/uploads/watch-prx.jpg');
    const mediaRes = await apiRequest(`/catalog-media/${cat.token}/${validMediaId}`);
    assert.equal(mediaRes.status, 200);
    assert.equal(mediaRes.headers.get('content-type'), 'image/jpeg');

    // Ảnh nội bộ không nằm trong catalog bị chặn hoàn toàn
    const secretMediaId = computeCatalogMediaId(cat.token, '/uploads/secret-internal.jpg');
    const forbiddenMedia = await apiRequest(`/catalog-media/${cat.token}/${secretMediaId}`);
    assert.equal(forbiddenMedia.status, 404);
    const directUpload = await apiRequest('/uploads/watch-prx.jpg');
    assert.equal(directUpload.status, 401);
});

test('public catalog expiration, revocation, extension, duplication, and branch permission guards', async () => {
    const sale = await loginAs('sale_a', 'SaleA-pass-123');
    const cashier = await loginAs('cashier_only', 'Cashier-pass-123');

    // Nhân viên không có quyền products bị chặn
    const denied = await apiRequest('/api/catalogs', {
        method: 'POST',
        cookie: cashier.cookie,
        csrf: cashier.csrf,
        body: { title: 'Test', items: ['DH001'] }
    });
    assert.equal(denied.status, 403);

    // Sale Chi nhánh A không được tạo catalog lấy hàng của Chi nhánh B
    const crossBranch = await apiRequest('/api/catalogs', {
        method: 'POST',
        cookie: sale.cookie,
        csrf: sale.csrf,
        body: { title: 'Trái chi nhánh', branch: 'Chi nhánh B', items: ['DH_B01'] }
    });
    assert.equal(crossBranch.status, 403);

    // Tạo catalog hợp lệ rồi thu hồi
    const created = await apiRequest('/api/catalogs', {
        method: 'POST',
        cookie: sale.cookie,
        csrf: sale.csrf,
        body: { title: 'Catalog thử thu hồi', items: ['DH001'], expiresInHours: 24 }
    });
    assert.equal(created.status, 201);
    const cat = created.body.catalog;

    const revoked = await apiRequest(`/api/catalogs/${cat.id}/revoke`, {
        method: 'POST',
        cookie: sale.cookie,
        csrf: sale.csrf,
        body: {}
    });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.catalog.status, 'revoked');

    // Khi đã thu hồi, khách mở link nhận 410 và ảnh catalog cũng ngừng phục vụ
    const pubRevoked = await apiRequest(`/catalog/${cat.token}`);
    assert.equal(pubRevoked.status, 410);
    assert.ok(pubRevoked.body.toString('utf8').includes('Catalog này đã được thu hồi'));
    const validMediaId = computeCatalogMediaId(cat.token, '/uploads/watch-prx.jpg');
    assert.equal((await apiRequest(`/catalog-media/${cat.token}/${validMediaId}`)).status, 404);

    // Gia hạn lại giúp kích hoạt lại link
    const extended = await apiRequest(`/api/catalogs/${cat.id}/extend`, {
        method: 'POST',
        cookie: sale.cookie,
        csrf: sale.csrf,
        body: { expiresInHours: 48 }
    });
    assert.equal(extended.status, 200);
    assert.equal(extended.body.catalog.status, 'active');
    assert.equal((await apiRequest(`/catalog/${cat.token}`)).status, 200);

    // Nhân bản catalog sinh ra token mới độc lập
    const duplicated = await apiRequest(`/api/catalogs/${cat.id}/duplicate`, {
        method: 'POST',
        cookie: sale.cookie,
        csrf: sale.csrf,
        body: { expiresInHours: 72 }
    });
    assert.equal(duplicated.status, 201);
    assert.notEqual(duplicated.body.catalog.token, cat.token);
    assert.equal(duplicated.body.catalog.itemCount, 1);
});

test('multi-IMEI product allows selecting individual IMEIs onto catalog with IMEI-specific photos and condition', async () => {
    const sale = await loginAs('sale_a', 'SaleA-pass-123');

    // Chỉ chọn chiếc OMEGA-SN-111111 lên catalog
    const singleImeiRes = await apiRequest('/api/catalogs', {
        method: 'POST',
        cookie: sale.cookie,
        csrf: sale.csrf,
        body: {
            title: 'Chọn riêng 1 chiếc Omega theo IMEI',
            expiresInHours: 48,
            branch: 'Chi nhánh A',
            items: [
                {
                    code: 'DH_OMEGA',
                    imei: 'OMEGA-SN-111111',
                    displayPrice: 14600000
                }
            ]
        }
    });
    assert.equal(singleImeiRes.status, 201);
    const singleCat = singleImeiRes.body.catalog;
    assert.equal(singleCat.itemCount, 1);
    assert.equal(singleCat.items[0].imei, 'OMEGA-SN-111111');
    assert.deepEqual(singleCat.items[0].images, [
        '/uploads/omega-imei1-front.jpg',
        '/uploads/omega-imei1-back.jpg'
    ]);
    assert.equal(singleCat.items[0].condition, 'like_new');
    assert.equal(singleCat.items[0].conditionDetail, 'Máy 111111 đẹp 99%, đủ hộp sổ thẻ');

    // Trang public hiển thị đúng thông tin và bộ ảnh của IMEI 111111, không lộ ảnh của IMEI 222222
    const pubHtmlRes = await apiRequest(`/catalog/${singleCat.token}`);
    assert.equal(pubHtmlRes.status, 200);
    const pubHtml = pubHtmlRes.body.toString('utf8');
    assert.ok(pubHtml.includes('Máy ***111111'));
    assert.ok(pubHtml.includes('Máy 111111 đẹp 99%, đủ hộp sổ thẻ'));
    assert.ok(!pubHtml.includes('Máy 222222'));

    assert.ok(
        pubHtml.includes('⬇ Tải tất cả ảnh (2)'),
        'Ô sản phẩm hiển thị nút tải tất cả ảnh kèm số lượng ảnh của IMEI đó'
    );

    const imei1MediaId = computeCatalogMediaId(singleCat.token, '/uploads/omega-imei1-front.jpg');
    const imei2MediaId = computeCatalogMediaId(singleCat.token, '/uploads/omega-imei2-only.jpg');
    const dlRes = await apiRequest(
        `/catalog-media/${singleCat.token}/${imei1MediaId}?download=1&name=omega-111111-1`
    );
    assert.equal(dlRes.status, 200);
    assert.equal(
        dlRes.headers.get('content-disposition'),
        'attachment; filename="omega-111111-1.jpg"'
    );
    assert.equal(
        (await apiRequest(`/catalog-media/${singleCat.token}/${imei2MediaId}`)).status,
        404,
        'Ảnh của IMEI không được chọn không được phép truy cập qua catalog này'
    );

    // Chọn cả 2 IMEI với mức giá riêng cho từng chiếc
    const bothImeisRes = await apiRequest('/api/catalogs', {
        method: 'POST',
        cookie: sale.cookie,
        csrf: sale.csrf,
        body: {
            title: 'So sánh 2 chiếc Omega cùng mã khác tình trạng',
            expiresInHours: 48,
            branch: 'Chi nhánh A',
            items: [
                { code: 'DH_OMEGA', imei: 'OMEGA-SN-111111', displayPrice: 14800000 },
                { code: 'DH_OMEGA', imei: 'OMEGA-SN-222222', displayPrice: 13900000 }
            ]
        }
    });
    assert.equal(bothImeisRes.status, 201);
    const bothCat = bothImeisRes.body.catalog;
    assert.equal(bothCat.itemCount, 2);
    assert.equal(bothCat.items[0].imei, 'OMEGA-SN-111111');
    assert.equal(bothCat.items[1].imei, 'OMEGA-SN-222222');
    assert.deepEqual(bothCat.items[1].images, ['/uploads/omega-imei2-only.jpg']);
});
