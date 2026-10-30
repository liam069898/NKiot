'use strict';
// Hub kho chung: chỉ nhận catalog đã lọc và trả catalog của đối tác đã liên kết.
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const hubDb = require('./hub-db');
const hubMedia = require('./hub-media');
const { securityHeaders } = require('./security-headers');
const { MAX_BODY, MAX_ITEMS } = require('./hub-limits');
const AVAILABILITY = new Set(['in_stock', 'low_stock', 'out_of_stock']);
const failedAuth = new Map();
const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
};
const hashKey = (secret) => crypto.createHash('sha256').update(secret).digest('hex');

function createTenant({ id, name }) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(id || ''))
        fail(
            'Tenant ID chỉ gồm a-z, 0-9, dấu gạch ngang; không bắt đầu hoặc kết thúc bằng gạch ngang.'
        );
    if (!name || typeof name !== 'string' || name.length > 200) fail('Tên tenant không hợp lệ.');
    const secret = crypto.randomBytes(32).toString('base64url');
    const now = new Date().toISOString();
    hubDb
        .getDb()
        .prepare(
            `INSERT INTO tenants (id, slug, name, apiKeyHash, status, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, 'active', ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, apiKeyHash=excluded.apiKeyHash, status='active', updatedAt=excluded.updatedAt`
        )
        .run(id, id, name, hashKey(secret), now, now);
    return `${id}.${secret}`;
}
function linkPartners(a, b, status = 'active', insideTx = false) {
    const d = hubDb.getDb();
    for (const id of [a, b])
        if (!d.prepare('SELECT 1 FROM tenants WHERE id=?').get(id)) fail(`Không có tenant ${id}.`);
    if (a === b) fail('Không thể liên kết tenant với chính nó.');
    const now = new Date().toISOString();
    const stmt = d.prepare(
        `INSERT INTO tenant_partners (tenantId, partnerTenantId, status, createdAt) VALUES (?, ?, ?, ?)
         ON CONFLICT(tenantId, partnerTenantId) DO UPDATE SET status=excluded.status`
    );
    if (!insideTx) d.exec('BEGIN IMMEDIATE');
    try {
        stmt.run(a, b, status, now);
        stmt.run(b, a, status, now);
        if (!insideTx) d.exec('COMMIT');
    } catch (error) {
        if (!insideTx) d.exec('ROLLBACK');
        throw error;
    }
}
function createInviteToken(tenant) {
    const d = hubDb.getDb();
    const token = `NK-SHARE-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const now = new Date().toISOString();
    d.prepare(
        `INSERT INTO partner_invite_tokens (token, ownerTenantId, status, createdAt) VALUES (?, ?, 'active', ?)`
    ).run(token, tenant.id, now);
    return { token, ownerTenantId: tenant.id, createdAt: now, status: 'active' };
}
function listInviteTokens(tenant) {
    const d = hubDb.getDb();
    const tokens = d
        .prepare(
            `SELECT p.token, p.ownerTenantId, p.status, p.createdAt, p.consumedAt,
                    p.consumedByTenantId, t.name AS consumedByName
             FROM partner_invite_tokens p
             LEFT JOIN tenants t ON t.id = p.consumedByTenantId
             WHERE p.ownerTenantId = ?
             ORDER BY p.createdAt DESC`
        )
        .all(tenant.id);
    return { tokens };
}
function revokeInviteToken(tenant, tokenInput) {
    const d = hubDb.getDb();
    const token = String(tokenInput || '')
        .trim()
        .toUpperCase();
    const record = d
        .prepare(`SELECT * FROM partner_invite_tokens WHERE token = ? AND ownerTenantId = ?`)
        .get(token, tenant.id);
    if (!record) fail('Không tìm thấy mã token.', 404);
    if (record.status === 'consumed') fail('Không thể hủy mã token đã được đối tác sử dụng.', 400);
    if (record.status === 'revoked') return { success: true, revoked: false };
    d.prepare(`UPDATE partner_invite_tokens SET status = 'revoked' WHERE token = ?`).run(token);
    return { success: true, revoked: true };
}
function deleteInviteToken(tenant, tokenInput) {
    const d = hubDb.getDb();
    const token = String(tokenInput || '')
        .trim()
        .toUpperCase();
    if (!token) fail('Vui lòng cung cấp mã token cần xoá.', 400);
    const record = d
        .prepare(`SELECT * FROM partner_invite_tokens WHERE token = ? AND ownerTenantId = ?`)
        .get(token, tenant.id);
    if (!record) fail('Không tìm thấy mã token.', 404);
    d.prepare(`DELETE FROM partner_invite_tokens WHERE token = ? AND ownerTenantId = ?`).run(
        token,
        tenant.id
    );
    return { success: true, deleted: true, token };
}
function redeemInviteToken(tenant, tokenInput) {
    const d = hubDb.getDb();
    const token = String(tokenInput || '')
        .trim()
        .toUpperCase();
    if (!token) fail('Vui lòng nhập mã token.', 400);

    const record = d.prepare(`SELECT * FROM partner_invite_tokens WHERE token = ?`).get(token);
    if (!record) fail('Mã token không hợp lệ hoặc không tồn tại.', 404);
    if (record.ownerTenantId === tenant.id)
        fail('Không thể tự kết nối kho chung với chính mình.', 400);
    if (record.status === 'consumed')
        fail(
            'Mã token này đã được sử dụng bởi một nhà bán hàng khác. Mỗi token chỉ dùng được 1 lần.',
            409
        );
    if (record.status === 'revoked') fail('Mã token này đã bị người tạo thu hồi.', 410);
    if (record.status !== 'active') fail('Mã token không còn khả dụng.', 400);

    const owner = d.prepare(`SELECT id, name FROM tenants WHERE id = ?`).get(record.ownerTenantId);
    if (!owner) fail('Nhà bán hàng phát hành token không tồn tại.', 404);

    const now = new Date().toISOString();
    d.exec('BEGIN IMMEDIATE');
    try {
        d.prepare(
            `UPDATE partner_invite_tokens SET status = 'consumed', consumedByTenantId = ?, consumedAt = ? WHERE token = ? AND status = 'active'`
        ).run(tenant.id, now, token);
        linkPartners(record.ownerTenantId, tenant.id, 'active', true);
        d.exec('COMMIT');
    } catch (error) {
        d.exec('ROLLBACK');
        throw error;
    }
    return {
        success: true,
        partner: { id: owner.id, name: owner.name }
    };
}
function listTenantPartners(tenant) {
    const d = hubDb.getDb();
    const partners = d
        .prepare(
            `SELECT p.partnerTenantId AS id, t.name, p.status, p.createdAt
             FROM tenant_partners p
             JOIN tenants t ON t.id = p.partnerTenantId
             WHERE p.tenantId = ? AND p.status = 'active'
             ORDER BY t.name`
        )
        .all(tenant.id);
    return { partners };
}
function unlinkTenantPartner(tenant, partnerId) {
    if (!partnerId) fail('Thiếu mã đối tác cần ngắt kết nối.', 400);
    const d = hubDb.getDb();
    d.exec('BEGIN IMMEDIATE');
    try {
        d.prepare(
            `UPDATE tenant_partners SET status = 'inactive'
             WHERE (tenantId = ? AND partnerTenantId = ?) OR (tenantId = ? AND partnerTenantId = ?)`
        ).run(tenant.id, partnerId, partnerId, tenant.id);
        d.exec('COMMIT');
    } catch (error) {
        d.exec('ROLLBACK');
        throw error;
    }
    return { success: true };
}
function authenticate(req) {
    const match = /^Bearer ([a-z0-9-]+)\.([A-Za-z0-9_-]{20,200})$/.exec(
        req.headers.authorization || ''
    );
    if (!match) fail('Thiếu API key.', 401);
    const tenant = hubDb.getDb().prepare('SELECT * FROM tenants WHERE id=?').get(match[1]);
    const expected = Buffer.from(tenant?.apiKeyHash || '0'.repeat(64), 'hex');
    const sent = Buffer.from(hashKey(match[2]), 'hex');
    if (!tenant || !crypto.timingSafeEqual(expected, sent) || tenant.status !== 'active')
        fail('API key không hợp lệ.', 401);
    return tenant;
}
const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const money = (value) => (Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0);
function normalizeItem(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Sản phẩm không hợp lệ.');
    if (
        typeof raw.sourceProductId !== 'string' ||
        !raw.sourceProductId ||
        raw.sourceProductId.length > 160
    )
        fail('sourceProductId không hợp lệ.');
    if (typeof raw.name !== 'string' || !raw.name.trim()) fail('Tên sản phẩm không hợp lệ.');
    require('./media-validation').validateMedia(raw);
    return {
        sourceProductId: raw.sourceProductId,
        code: text(raw.code, 160),
        name: text(raw.name, 300),
        category: text(raw.category, 200),
        price: money(raw.price),
        wholesalePrice: money(raw.wholesalePrice),
        unit: text(raw.unit, 50),
        barcode: text(raw.barcode, 200),
        availability: AVAILABILITY.has(raw.availability) ? raw.availability : 'out_of_stock',
        minOrderQty: Math.max(1, Math.min(1e6, Math.floor(Number(raw.minOrderQty) || 1))),
        note: text(raw.note, 500),
        images: Array.isArray(raw.images) ? raw.images : [],
        videoUrl: text(raw.videoUrl, 500),
        condition: ['new', 'like_new', 'good', 'fair'].includes(raw.condition)
            ? raw.condition
            : 'new',
        conditionDetail: text(raw.conditionDetail, 1000),
        description: text(raw.description, 2000),
        imeiDetails: raw.imeiDetails && typeof raw.imeiDetails === 'object' ? raw.imeiDetails : {},
        imeis: Array.isArray(raw.imeis) ? raw.imeis : [],
        sourceUpdatedAt: text(raw.updatedAt, 40) || new Date().toISOString()
    };
}
function syncCatalog(tenant, input) {
    if (!Number.isSafeInteger(input?.sequence) || input.sequence < 1)
        fail('sequence không hợp lệ.');
    if (typeof input.digest !== 'string' || !/^[a-f0-9]{64}$/.test(input.digest))
        fail('digest không hợp lệ.');
    if (!Array.isArray(input.items) || input.items.length > MAX_ITEMS)
        fail('Danh sách sản phẩm không hợp lệ.');
    const expectedDigest = crypto
        .createHash('sha256')
        .update(JSON.stringify({ items: input.items }))
        .digest('hex');
    if (input.digest !== expectedDigest) fail('digest không khớp.');
    const items = input.items.map(normalizeItem);
    if (new Set(items.map((i) => i.sourceProductId)).size !== items.length)
        fail('Trùng sourceProductId.');
    const d = hubDb.getDb(),
        now = new Date().toISOString();
    d.exec('BEGIN IMMEDIATE');
    try {
        const state = d
            .prepare('SELECT sequence, digest FROM tenant_sync_state WHERE tenantId=?')
            .get(tenant.id);
        // currentSequence lets a tenant restored from an older backup resume above the hub state.
        if (state && input.sequence < state.sequence) {
            d.exec('COMMIT');
            return {
                synced: 0,
                ignored: true,
                reason: 'stale_sequence',
                currentSequence: state.sequence,
                syncedAt: now
            };
        }
        if (state && input.sequence === state.sequence) {
            if (input.digest !== state.digest)
                throw Object.assign(new Error('sequence đã được dùng với snapshot khác.'), {
                    status: 409,
                    currentSequence: state.sequence
                });
            d.exec('COMMIT');
            return { synced: 0, replayed: true, syncedAt: now };
        }
        d.prepare(
            "UPDATE catalog_products SET status='removed', updatedAt=? WHERE ownerTenantId=? AND status='active'"
        ).run(now, tenant.id);
        const upsert = d.prepare(
            `INSERT INTO catalog_products (id, ownerTenantId, sourceProductId, code, name, category, price, wholesalePrice,
                unit, barcode, availability, minOrderQty, note, images, videoUrl, condition, conditionDetail, description,
                imeiDetails, imeis, status, sourceUpdatedAt, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
             ON CONFLICT(ownerTenantId, sourceProductId) DO UPDATE SET code=excluded.code, name=excluded.name,
                category=excluded.category, price=excluded.price, wholesalePrice=excluded.wholesalePrice,
                unit=excluded.unit, barcode=excluded.barcode, availability=excluded.availability,
                minOrderQty=excluded.minOrderQty, note=excluded.note,
                images=excluded.images, videoUrl=excluded.videoUrl, condition=excluded.condition,
                conditionDetail=excluded.conditionDetail, description=excluded.description,
                imeiDetails=excluded.imeiDetails, imeis=excluded.imeis,
                status='active', sourceUpdatedAt=excluded.sourceUpdatedAt, updatedAt=excluded.updatedAt`
        );
        for (const i of items)
            upsert.run(
                `${tenant.id}:${i.sourceProductId}`,
                tenant.id,
                i.sourceProductId,
                i.code,
                i.name,
                i.category,
                i.price,
                i.wholesalePrice,
                i.unit,
                i.barcode,
                i.availability,
                i.minOrderQty,
                i.note,
                typeof i.images === 'string'
                    ? i.images
                    : JSON.stringify(Array.isArray(i.images) ? i.images : []),
                i.videoUrl || '',
                i.condition || 'new',
                i.conditionDetail || '',
                i.description || '',
                typeof i.imeiDetails === 'string'
                    ? i.imeiDetails
                    : JSON.stringify(i.imeiDetails || {}),
                typeof i.imeis === 'string'
                    ? i.imeis
                    : JSON.stringify(Array.isArray(i.imeis) ? i.imeis : []),
                i.sourceUpdatedAt || now,
                now,
                now
            );
        d.prepare(
            `INSERT INTO tenant_sync_state (tenantId, sequence, digest) VALUES (?, ?, ?)
            ON CONFLICT(tenantId) DO UPDATE SET sequence=excluded.sequence, digest=excluded.digest`
        ).run(tenant.id, input.sequence, input.digest);
        d.exec('COMMIT');
    } catch (error) {
        d.exec('ROLLBACK');
        throw error;
    }
    return { synced: items.length, syncedAt: now };
}
// Ảnh tenant gửi lên là `/uploads/<tệp>`. Đổi sang URL proxy để đối tác tải được
// dù không cùng thư mục uploads. Ảnh chưa đẩy lên Hub thì để nguyên và client tự bỏ qua.
function toMediaProxyUrl(ownerTenantId, value) {
    const url = String(value || '');
    const match = /^\/uploads\/([A-Za-z0-9_.-]+)$/.exec(url);
    if (!match) return url;
    const record = hubMedia.getMediaRecord(hubMedia.mediaId(ownerTenantId, url));
    return record ? `/v1/media/${record.id}` : url;
}

function partnerCatalog(tenant) {
    const items = hubDb
        .getDb()
        .prepare(
            `SELECT c.*, t.name AS partnerName FROM catalog_products c
         JOIN tenant_partners p ON p.partnerTenantId=c.ownerTenantId AND p.tenantId=? AND p.status='active'
         JOIN tenants t ON t.id=c.ownerTenantId AND t.status='active'
         WHERE c.status='active' ORDER BY t.name, c.name`
        )
        .all(tenant.id)
        .map((r) => ({
            id: r.id,
            partnerId: r.ownerTenantId,
            partnerName: r.partnerName,
            productId: r.sourceProductId,
            code: r.code,
            name: r.name,
            category: r.category,
            price: r.price,
            wholesalePrice: r.wholesalePrice,
            unit: r.unit,
            barcode: r.barcode,
            availability: r.availability,
            minOrderQty: r.minOrderQty,
            note: r.note,
            images: (r.images
                ? typeof r.images === 'string'
                    ? (() => {
                          try {
                              return JSON.parse(r.images);
                          } catch {
                              return [];
                          }
                      })()
                    : r.images
                : []
            ).map((u) => toMediaProxyUrl(r.ownerTenantId, u)),
            videoUrl: r.videoUrl ? toMediaProxyUrl(r.ownerTenantId, r.videoUrl) : '',
            condition: r.condition || 'new',
            conditionDetail: r.conditionDetail || '',
            description: r.description || '',
            imeiDetails: (() => {
                const raw = r.imeiDetails
                    ? typeof r.imeiDetails === 'string'
                        ? (() => {
                              try {
                                  return JSON.parse(r.imeiDetails);
                              } catch {
                                  return {};
                              }
                          })()
                        : typeof r.imeiDetails === 'object' && r.imeiDetails !== null
                          ? r.imeiDetails
                          : {}
                    : {};
                // Ảnh theo từng IMEI cũng phải đi qua proxy, nếu không đối tác thấy ảnh vỡ.
                return Object.fromEntries(
                    Object.entries(raw).map(([serial, detail]) => [
                        serial,
                        detail && typeof detail === 'object'
                            ? {
                                  ...detail,
                                  images: Array.isArray(detail.images)
                                      ? detail.images.map((u) =>
                                            toMediaProxyUrl(r.ownerTenantId, u)
                                        )
                                      : [],
                                  videoUrl: detail.videoUrl
                                      ? toMediaProxyUrl(r.ownerTenantId, detail.videoUrl)
                                      : ''
                              }
                            : detail
                    ])
                );
            })(),
            imeis: r.imeis
                ? typeof r.imeis === 'string'
                    ? (() => {
                          try {
                              return JSON.parse(r.imeis);
                          } catch {
                              return [];
                          }
                      })()
                    : Array.isArray(r.imeis)
                      ? r.imeis
                      : []
                : [],
            updatedAt: r.updatedAt
        }));
    return { items, fetchedAt: new Date().toISOString() };
}
async function readBody(req, limit = MAX_BODY) {
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))
        fail('Yêu cầu JSON.', 415);
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
        size += chunk.length;
        if (size > limit) fail('Dữ liệu quá lớn.', 413);
        chunks.push(chunk);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
        fail('JSON không hợp lệ.');
    }
}
function send(res, status, data) {
    const payload = JSON.stringify(data);
    res.writeHead(status, {
        ...securityHeaders(),
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
    });
    res.end(payload);
}

// Stream nhị phân (ảnh/video) — không dùng JSON như send().
function sendBinary(res, status, buffer, mime) {
    res.writeHead(status, {
        ...securityHeaders(),
        'Content-Type': mime,
        'Content-Length': buffer.length,
        // Revalidate access on every request; path IDs can be overwritten or revoked.
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
    });
    res.end(buffer);
}
async function handler(req, res) {
    const ip = req.socket?.remoteAddress || 'local',
        now = Date.now();
    try {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/health' && req.method === 'GET') {
            hubDb.getDb().prepare('SELECT 1 AS ok').get();
            return send(res, 200, { success: true });
        }
        const throttle = failedAuth.get(ip);
        if (throttle && throttle.until > now && throttle.count >= 20)
            fail('Thử sai quá nhiều lần.', 429);
        let tenant;
        try {
            tenant = authenticate(req);
        } catch (error) {
            const next =
                throttle && throttle.until > now ? throttle : { count: 0, until: now + 15 * 60000 };
            next.count++;
            failedAuth.set(ip, next);
            throw error;
        }
        if (url.pathname === '/v1/catalog/sync' && req.method === 'POST')
            return send(res, 200, { success: true, ...syncCatalog(tenant, await readBody(req)) });
        if (url.pathname === '/v1/catalog' && req.method === 'GET')
            return send(res, 200, { success: true, ...partnerCatalog(tenant) });
        if (url.pathname === '/v1/partners/tokens' && req.method === 'POST')
            return send(res, 200, { success: true, ...createInviteToken(tenant) });
        if (url.pathname === '/v1/partners/tokens' && req.method === 'GET')
            return send(res, 200, { success: true, ...listInviteTokens(tenant) });
        if (url.pathname === '/v1/partners/tokens/revoke' && req.method === 'POST')
            return send(res, 200, await revokeInviteToken(tenant, (await readBody(req)).token));
        if (url.pathname === '/v1/partners/tokens/delete' && req.method === 'POST')
            return send(res, 200, deleteInviteToken(tenant, (await readBody(req)).token));
        if (url.pathname === '/v1/partners/redeem' && req.method === 'POST')
            return send(res, 200, await redeemInviteToken(tenant, (await readBody(req)).token));
        if (url.pathname === '/v1/partners' && req.method === 'GET')
            return send(res, 200, { success: true, ...listTenantPartners(tenant) });
        if (url.pathname === '/v1/partners/unlink' && req.method === 'POST')
            return send(
                res,
                200,
                await unlinkTenantPartner(tenant, (await readBody(req)).partnerId)
            );
        // Hub Media Proxy — tenant đẩy ảnh lên một lần, đối tác đã liên kết tải về.
        if (url.pathname === '/v1/media' && req.method === 'POST') {
            const body = await readBody(req, Math.ceil((hubMedia.MAX_MEDIA_BYTES * 4) / 3) + 4096);
            const stored = await hubMedia.storeMedia(tenant.id, body.path, body.data);
            return send(res, 200, { success: true, ...stored });
        }
        const mediaMatch = /^\/v1\/media\/([a-f0-9]{32})$/.exec(url.pathname);
        if (mediaMatch && req.method === 'GET') {
            const record = hubMedia.getMediaRecord(mediaMatch[1]);
            if (!record) fail('Không tìm thấy media.', 404);
            if (!hubMedia.canReadMedia(tenant.id, record.ownerTenantId, record.originalPath))
                fail('Không có quyền xem media của đối tác này.', 403);
            const filePath = hubMedia.mediaFilePath(record.id);
            let buffer;
            try {
                buffer = await fs.promises.readFile(filePath);
            } catch {
                fail('Tệp media không còn trên máy chủ Hub.', 410);
            }
            return sendBinary(res, 200, buffer, record.mime);
        }
        fail('API không tồn tại.', 404);
    } catch (error) {
        if (!error.status) console.error(error);
        if (!res.headersSent)
            send(res, error.status || 500, {
                success: false,
                error: error.status ? error.message : 'Lỗi hub.',
                ...(Number.isSafeInteger(error.currentSequence)
                    ? { currentSequence: error.currentSequence }
                    : {})
            });
        else res.end();
    }
}
if (require.main === module) {
    hubDb.initDb();
    const port = process.env.PORT || 4000;
    const server = http.createServer(handler);
    let stopping = false;
    const shutdown = (signal) => {
        if (stopping) return;
        stopping = true;
        console.log(`NKiot Hub nhận ${signal}; đang dừng an toàn.`);
        server.close((error) => {
            hubDb.closeDb();
            if (error) console.error(error);
            process.exitCode = error ? 1 : 0;
        });
        setTimeout(() => process.exit(1), 10000).unref();
    };
    server.listen(port, process.env.HOST || '127.0.0.1', () =>
        console.log(`NKiot Hub: http://localhost:${port}`)
    );
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => shutdown(signal));
}
module.exports = {
    handler,
    createTenant,
    linkPartners,
    syncCatalog,
    partnerCatalog,
    createInviteToken,
    listInviteTokens,
    revokeInviteToken,
    deleteInviteToken,
    redeemInviteToken,
    listTenantPartners,
    unlinkTenantPartner
};
