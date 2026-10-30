'use strict';
require('./test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const hubDb = require('../hub-db');
const crypto = require('node:crypto');
const { handler, createTenant, linkPartners } = require('../hub-server');

function snapshot(items, sequence) {
    const body = { items };
    return {
        ...body,
        sequence,
        digest: crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex')
    };
}

function request(url, { method = 'GET', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const req = new PassThrough();
        req.url = url;
        req.method = method;
        req.headers = headers;
        req.socket = { remoteAddress: '127.0.0.1' };
        const res = {
            headersSent: false,
            writeHead(status, headers = {}) {
                this.status = status;
                this.headers = headers;
                this.headersSent = true;
            },
            end(payload) {
                // Media trả về buffer nhị phân, các endpoint khác trả JSON.
                const isBuffer = Buffer.isBuffer(payload);
                resolve({
                    status: this.status,
                    headers: this.headers,
                    body: isBuffer ? payload : JSON.parse(payload)
                });
            }
        };
        handler(req, res).catch(reject);
        req.end(body || '');
    });
}
test('hub migration records initial schema and is idempotent', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nkiot-hub-')), 'hub.db');
    try {
        hubDb.initDb(file);
        assert.deepEqual(
            hubDb
                .getDb()
                .prepare('SELECT version, name FROM schema_migrations ORDER BY version')
                .all()
                .map((row) => ({ ...row })),
            [
                { version: 1, name: 'initial_schema' },
                { version: 2, name: 'catalog_media_and_condition' },
                { version: 3, name: 'catalog_imei_details' },
                { version: 4, name: 'tenant_media_store' }
            ]
        );
        hubDb.closeDb();
        hubDb.initDb(file);
        assert.equal(
            hubDb.getDb().prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n,
            4
        );
    } finally {
        hubDb.closeDb();
        fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
});

test('hub migration upgrades legacy database without schema_migrations', () => {
    const { DatabaseSync } = require('node:sqlite');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nkiot-hub-')), 'hub.db');
    const legacy = new DatabaseSync(file);
    legacy.exec(`CREATE TABLE tenants (
        id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, apiKeyHash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    INSERT INTO tenants VALUES ('old', 'old', 'Old', 'hash', 'active', 'now', 'now');`);
    legacy.close();
    try {
        hubDb.initDb(file);
        const d = hubDb.getDb();
        assert.equal(d.prepare('SELECT name FROM tenants WHERE id=?').get('old').name, 'Old');
        assert.equal(d.prepare('SELECT COUNT(*) AS n FROM partner_invite_tokens').get().n, 0);
        assert.equal(d.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v, 4);
        assert.equal(
            d.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='tenant_media'").get().n,
            1
        );
    } finally {
        hubDb.closeDb();
        fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
});

test('hub only returns active catalog from linked partners', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nkiot-hub-')), 'hub.db');
    hubDb.initDb(file);
    try {
        const kalo = createTenant({ id: 'kalo', name: 'Kalo' });
        const tech = createTenant({ id: 'techmotion', name: 'Techmotion' });
        const auth = { authorization: `Bearer ${kalo}`, 'content-type': 'application/json' };
        let result = await request('/v1/catalog/sync', {
            method: 'POST',
            headers: auth,
            body: JSON.stringify(
                snapshot(
                    [
                        {
                            sourceProductId: 'local-1',
                            name: 'Secret-free product',
                            price: 50,
                            costPrice: 1,
                            availability: 'in_stock'
                        }
                    ],
                    1
                )
            )
        });
        assert.equal(result.status, 200);
        assert.equal(result.headers['X-Content-Type-Options'], 'nosniff');
        assert.equal(result.headers['X-Frame-Options'], 'DENY');
        assert.match(result.headers['Content-Security-Policy-Report-Only'], /default-src 'self'/);
        result = await request('/v1/catalog', { headers: { authorization: `Bearer ${tech}` } });
        assert.deepEqual(result.body.items, []);
        linkPartners('kalo', 'techmotion');
        result = await request('/v1/catalog', { headers: { authorization: `Bearer ${tech}` } });
        assert.equal(result.status, 200);
        assert.equal(result.body.items.length, 1);
        assert.equal(result.body.items[0].partnerId, 'kalo');
        assert.equal(Object.hasOwn(result.body.items[0], 'costPrice'), false);
        result = await request('/v1/catalog', { headers: { authorization: 'Bearer kalo.bad' } });
        assert.equal(result.status, 401);
    } finally {
        hubDb.closeDb();
        fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
});

test('hub replays duplicates, ignores old snapshot, rejects conflicting sequence', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nkiot-hub-')), 'hub.db');
    hubDb.initDb(file);
    try {
        const key = createTenant({ id: 'tenant-a', name: 'Tenant A' });
        const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
        const first = snapshot(
            [{ sourceProductId: 'p1', name: 'First', availability: 'in_stock' }],
            10
        );
        let result = await request('/v1/catalog/sync', {
            method: 'POST',
            headers,
            body: JSON.stringify(first)
        });
        assert.equal(result.status, 200);
        result = await request('/v1/catalog/sync', {
            method: 'POST',
            headers,
            body: JSON.stringify(first)
        });
        assert.equal(result.status, 200);
        assert.equal(result.body.replayed, true);
        const old = snapshot(
            [{ sourceProductId: 'p1', name: 'Old', availability: 'out_of_stock' }],
            9
        );
        result = await request('/v1/catalog/sync', {
            method: 'POST',
            headers,
            body: JSON.stringify(old)
        });
        assert.equal(result.status, 200);
        assert.equal(result.body.ignored, true);
        const conflict = snapshot(
            [{ sourceProductId: 'p1', name: 'Conflict', availability: 'out_of_stock' }],
            10
        );
        result = await request('/v1/catalog/sync', {
            method: 'POST',
            headers,
            body: JSON.stringify(conflict)
        });
        assert.equal(result.status, 409);
    } finally {
        hubDb.closeDb();
        fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
});

test('hub partner invite tokens: create, redeem (1-to-1 single use), prevent reuse, and unlink', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nkiot-hub-')), 'hub.db');
    hubDb.initDb(file);
    try {
        const shopA = createTenant({ id: 'shop-a', name: 'Shop A' });
        const shopB = createTenant({ id: 'shop-b', name: 'Shop B' });
        const shopC = createTenant({ id: 'shop-c', name: 'Shop C' });

        const authA = { authorization: `Bearer ${shopA}`, 'content-type': 'application/json' };
        const authB = { authorization: `Bearer ${shopB}`, 'content-type': 'application/json' };
        const authC = { authorization: `Bearer ${shopC}`, 'content-type': 'application/json' };

        // 1. Shop A creates an invite token
        let res = await request('/v1/partners/tokens', { method: 'POST', headers: authA });
        assert.equal(res.status, 200);
        const { token } = res.body;
        assert.ok(token.startsWith('NK-SHARE-'), 'Token prefix is NK-SHARE-');

        // 2. Token shows up in Shop A's list
        res = await request('/v1/partners/tokens', { method: 'GET', headers: authA });
        assert.equal(res.status, 200);
        assert.equal(res.body.tokens.length, 1);
        assert.equal(res.body.tokens[0].status, 'active');

        // 3. Shop A cannot self-redeem
        res = await request('/v1/partners/redeem', {
            method: 'POST',
            headers: authA,
            body: JSON.stringify({ token })
        });
        assert.equal(res.status, 400);

        // 4. Shop B redeems token (Connects Shop A ↔ Shop B)
        res = await request('/v1/partners/redeem', {
            method: 'POST',
            headers: authB,
            body: JSON.stringify({ token })
        });
        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.partner.id, 'shop-a');

        // 5. Verify token is now 'consumed' and cannot be used by Shop C (Single-use 1-to-1 rule)
        res = await request('/v1/partners/redeem', {
            method: 'POST',
            headers: authC,
            body: JSON.stringify({ token })
        });
        assert.equal(res.status, 409);
        assert.match(res.body.error, /Mỗi token chỉ dùng được 1 lần/);

        // 6. Verify partners list for both shops
        res = await request('/v1/partners', { method: 'GET', headers: authA });
        assert.equal(res.status, 200);
        assert.equal(res.body.partners.length, 1);
        assert.equal(res.body.partners[0].id, 'shop-b');

        res = await request('/v1/partners', { method: 'GET', headers: authB });
        assert.equal(res.status, 200);
        assert.equal(res.body.partners.length, 1);
        assert.equal(res.body.partners[0].id, 'shop-a');

        // 7. Shop A unlinks Shop B
        res = await request('/v1/partners/unlink', {
            method: 'POST',
            headers: authA,
            body: JSON.stringify({ partnerId: 'shop-b' })
        });
        assert.equal(res.status, 200);

        res = await request('/v1/partners', { method: 'GET', headers: authA });
        assert.equal(res.body.partners.length, 0);
        res = await request('/v1/partners', { method: 'GET', headers: authB });
        assert.equal(res.body.partners.length, 0);

        // 8. Delete token tests
        // Create a new token2 for Shop A
        res = await request('/v1/partners/tokens', { method: 'POST', headers: authA });
        assert.equal(res.status, 200);
        const token2 = res.body.token;

        // Shop C cannot delete Shop A's token
        res = await request('/v1/partners/tokens/delete', {
            method: 'POST',
            headers: authC,
            body: JSON.stringify({ token: token2 })
        });
        assert.equal(res.status, 404);

        // Shop A deletes token2
        res = await request('/v1/partners/tokens/delete', {
            method: 'POST',
            headers: authA,
            body: JSON.stringify({ token: token2 })
        });
        assert.equal(res.status, 200);
        assert.equal(res.body.deleted, true);

        // Redeeming deleted token2 fails
        res = await request('/v1/partners/redeem', {
            method: 'POST',
            headers: authB,
            body: JSON.stringify({ token: token2 })
        });
        assert.equal(res.status, 404);

        // Shop A also deletes the consumed first token
        res = await request('/v1/partners/tokens/delete', {
            method: 'POST',
            headers: authA,
            body: JSON.stringify({ token })
        });
        assert.equal(res.status, 200);

        // Verify Shop A has no tokens left
        res = await request('/v1/partners/tokens', { method: 'GET', headers: authA });
        assert.equal(res.body.tokens.length, 0);
    } finally {
        hubDb.closeDb();
        fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
});

test('hub rejects unsafe nested media without changing its catalog', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nkiot-hub-media-'));
    try {
        hubDb.initDb(path.join(root, 'hub.db'));
        createTenant({ id: 'media-owner', name: 'Media owner' });
        const tenant = hubDb.getDb().prepare('SELECT * FROM tenants WHERE id=?').get('media-owner');
        const { syncCatalog } = require('../hub-server');
        assert.throws(
            () =>
                syncCatalog(
                    tenant,
                    snapshot(
                        [
                            {
                                sourceProductId: 'P',
                                name: 'Product',
                                imeiDetails: { serial: { videoUrl: 'javascript:alert(1)' } }
                            }
                        ],
                        1
                    )
                ),
            { status: 422 }
        );
        assert.equal(
            hubDb.getDb().prepare('SELECT COUNT(*) AS n FROM catalog_products').get().n,
            0
        );
        assert.equal(
            hubDb.getDb().prepare('SELECT COUNT(*) AS n FROM tenant_sync_state').get().n,
            0
        );
    } finally {
        hubDb.closeDb();
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('hub media proxy stores tenant media and only serves it to linked partners', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nkiot-hub-media-'));
    const mediaDir = path.join(root, 'hub-media');
    process.env.NKIOT_HUB_MEDIA_DIR = mediaDir;
    hubDb.initDb(path.join(root, 'hub.db'));
    try {
        const keyA = createTenant({ id: 'tenant-a', name: 'Tenant A' });
        const keyB = createTenant({ id: 'tenant-b', name: 'Tenant B' });
        const keyC = createTenant({ id: 'tenant-c', name: 'Tenant C' });
        linkPartners('tenant-a', 'tenant-b');

        // PNG 1x1 hợp lệ để vượt qua kiểm tra magic bytes.
        const png = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
            'base64'
        );
        const upload = await request('/v1/media', {
            method: 'POST',
            headers: { authorization: `Bearer ${keyA}`, 'content-type': 'application/json' },
            body: JSON.stringify({ path: '/uploads/iphone.jpg', data: png.toString('base64') })
        });
        assert.equal(upload.status, 200);
        assert.match(upload.body.url, /^\/v1\/media\/[a-f0-9]{32}$/);
        const mediaId = upload.body.url.split('/').pop();

        // Upload lặp lại cùng đường dẫn trả cùng id (idempotent).
        const again = await request('/v1/media', {
            method: 'POST',
            headers: { authorization: `Bearer ${keyA}`, 'content-type': 'application/json' },
            body: JSON.stringify({ path: '/uploads/iphone.jpg', data: png.toString('base64') })
        });
        assert.equal(again.body.url, upload.body.url);

        // A partner may only read media referenced by a live shared item.
        const { syncCatalog } = require('../hub-server');
        syncCatalog(
            { id: 'tenant-a' },
            snapshot(
                [
                    {
                        sourceProductId: 'P',
                        name: 'Shared',
                        availability: 'in_stock',
                        images: ['/uploads/iphone.jpg']
                    }
                ],
                1
            )
        );
        const allowed = await request(`/v1/media/${mediaId}`, {
            headers: { authorization: `Bearer ${keyB}` }
        });
        assert.equal(allowed.status, 200);
        assert.equal(allowed.headers['Content-Type'], 'image/png');
        assert.ok(Buffer.isBuffer(allowed.body));
        assert.equal(allowed.body.length, png.length);

        // Tenant không liên kết bị chặn.
        const denied = await request(`/v1/media/${mediaId}`, {
            headers: { authorization: `Bearer ${keyC}` }
        });
        assert.equal(denied.status, 403);

        // Chủ sở hữu luôn xem được ảnh của mình.
        const owner = await request(`/v1/media/${mediaId}`, {
            headers: { authorization: `Bearer ${keyA}` }
        });
        assert.equal(owner.status, 200);

        // Media không tồn tại trả 404.
        const missing = await request('/v1/media/' + 'a'.repeat(32), {
            headers: { authorization: `Bearer ${keyB}` }
        });
        assert.equal(missing.status, 404);
    } finally {
        hubDb.closeDb();
        delete process.env.NKIOT_HUB_MEDIA_DIR;
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('hub catalog rewrites partner /uploads media to proxy URLs per IMEI', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nkiot-hub-rewrite-'));
    process.env.NKIOT_HUB_MEDIA_DIR = path.join(root, 'hub-media');
    hubDb.initDb(path.join(root, 'hub.db'));
    try {
        const keyA = createTenant({ id: 'tenant-a', name: 'Tenant A' });
        const keyB = createTenant({ id: 'tenant-b', name: 'Tenant B' });
        linkPartners('tenant-a', 'tenant-b');

        const png = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
            'base64'
        );
        const uploaded = await request('/v1/media', {
            method: 'POST',
            headers: { authorization: `Bearer ${keyA}`, 'content-type': 'application/json' },
            body: JSON.stringify({ path: '/uploads/imei-1.jpg', data: png.toString('base64') })
        });
        assert.equal(uploaded.status, 200);

        const { syncCatalog } = require('../hub-server');
        syncCatalog(
            { id: 'tenant-a' },
            snapshot(
                [
                    {
                        sourceProductId: 'P1',
                        name: 'iPhone cũ',
                        hasImei: true,
                        imeis: ['IMEI-1', 'IMEI-2'],
                        images: ['/uploads/imei-1.jpg'],
                        imeiDetails: {
                            'IMEI-1': {
                                images: ['/uploads/imei-1.jpg'],
                                condition: 'like_new',
                                conditionDetail: 'Pin 99%'
                            },
                            // Máy 2 chưa đẩy ảnh lên Hub → giữ nguyên đường dẫn gốc.
                            'IMEI-2': { images: ['/uploads/imei-2.jpg'], condition: 'good' }
                        }
                    }
                ],
                1
            )
        );

        const catalog = await request('/v1/catalog', {
            headers: { authorization: `Bearer ${keyB}` }
        });
        assert.equal(catalog.status, 200);
        const item = catalog.body.items[0];
        assert.equal(item.images[0], uploaded.body.url);
        assert.equal(item.imeiDetails['IMEI-1'].images[0], uploaded.body.url);
        assert.equal(item.imeiDetails['IMEI-1'].conditionDetail, 'Pin 99%');
        // Ảnh chưa có trên Hub thì giữ nguyên để client tự xử lý.
        assert.equal(item.imeiDetails['IMEI-2'].images[0], '/uploads/imei-2.jpg');
    } finally {
        hubDb.closeDb();
        delete process.env.NKIOT_HUB_MEDIA_DIR;
        fs.rmSync(root, { recursive: true, force: true });
    }
});
