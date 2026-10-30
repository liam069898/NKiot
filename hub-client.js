'use strict';
// Kết nối tenant với hub kho chung. API key chỉ nằm ở server, trình duyệt không thấy.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { MAX_MEDIA_BYTES } = require('./hub-media');
const db = require('./db');
const { validateSnapshot } = require('./hub-limits');

const CACHE_MS = 60000;
const STALE_MS = 30 * 60000;
const RETRY_MS = 30000;
const FULL_SYNC_MS = 15 * 60000;
let cache = null,
    syncing = null,
    timer = null,
    lastError = null;

const config = () => ({
    url: (process.env.NKIOT_HUB_URL || '').replace(/\/+$/, ''),
    key: process.env.NKIOT_HUB_API_KEY || ''
});
const enabled = () => {
    const c = config();
    return !!(c.url && c.key);
};

async function call(path, options = {}) {
    const { url, key } = config();
    const response = await fetch(url + path, {
        ...options,
        signal: AbortSignal.timeout(10000),
        headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok)
        throw Object.assign(new Error(json.error || `Hub lỗi ${response.status}.`), {
            status: response.status,
            currentSequence: json.currentSequence
        });
    return json;
}

// Chỉ gửi trường công khai; không gửi tồn kho chính xác, giá vốn hoặc dữ liệu khách hàng.
function localCatalog(data = db.readSnapshot()) {
    return (data.shared_products || [])
        .filter((sp) => sp.status === 'active')
        .map((sp) => ({
            sourceProductId: sp.id,
            code: sp.code || '',
            name: sp.name || '',
            category: sp.category || '',
            price: Number(sp.price) || 0,
            wholesalePrice: Number(sp.wholesalePrice) || 0,
            unit: sp.unit || '',
            barcode: sp.barcode || '',
            availability: sp.availability,
            minOrderQty: Number(sp.minOrderQty) || 1,
            note: sp.note || '',
            images: Array.isArray(sp.images) ? sp.images : [],
            videoUrl: sp.videoUrl || '',
            condition: sp.condition || 'new',
            conditionDetail: sp.conditionDetail || '',
            description: sp.description || '',
            imeiDetails: Object.fromEntries(
                (sp.imeis || [])
                    .filter((serial) => Object.hasOwn(sp.imeiDetails || {}, serial))
                    .map((serial) => [serial, sp.imeiDetails[serial]])
            ),
            imeis: Array.isArray(sp.imeis) ? sp.imeis : []
        }));
}

function enqueue(data, { minimumSequence = 0 } = {}) {
    const items = localCatalog(data);
    const payload = JSON.stringify({ items });
    const digest = crypto.createHash('sha256').update(payload).digest('hex');
    const d = db.getDb();
    const latest = d.prepare('SELECT digest FROM hub_outbox ORDER BY sequence DESC LIMIT 1').get();
    const stored = Number(
        d.prepare("SELECT value FROM app_meta WHERE key='hub_sequence'").get()?.value || 0
    );
    const sequence = Math.max(stored, Number(minimumSequence) || 0) + 1;
    try {
        validateSnapshot({ items, sequence, digest });
    } catch (error) {
        // Catalog publication must not roll back a committed business operation.
        d.prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)').run(
            'hub_catalog_error',
            error.message
        );
        return false;
    }
    d.prepare("DELETE FROM app_meta WHERE key='hub_catalog_error'").run();
    if (latest?.digest === digest) return false;
    d.prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)').run(
        'hub_sequence',
        String(sequence)
    );
    d.prepare(
        'INSERT INTO hub_outbox (sequence, digest, payload, createdAt) VALUES (?, ?, ?, ?)'
    ).run(sequence, digest, payload, new Date().toISOString());
    return true;
}

function rebaseOutbox(currentSequence) {
    const sequence = Number(currentSequence);
    if (!Number.isSafeInteger(sequence) || sequence < 0)
        throw new Error('Hub trả sequence phục hồi không hợp lệ.');
    const d = db.getDb();
    d.exec('BEGIN IMMEDIATE');
    try {
        d.prepare('DELETE FROM hub_outbox').run();
        const stored = Number(
            d.prepare("SELECT value FROM app_meta WHERE key='hub_sequence'").get()?.value || 0
        );
        d.prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)').run(
            'hub_sequence',
            String(Math.max(stored, sequence))
        );
        if (!enqueue(db.readSnapshot(), { minimumSequence: sequence }))
            throw new Error('Catalog hiện tại vượt giới hạn Hub; giữ outbox để đối soát.');
        d.exec('COMMIT');
    } catch (error) {
        d.exec('ROLLBACK');
        throw error;
    }
}

function pending() {
    const d = db.getDb();
    return Number(d.prepare('SELECT COUNT(*) AS count FROM hub_outbox').get().count) || 0;
}

async function syncNow() {
    if (!enabled()) return { skipped: true };
    if (syncing) return syncing;
    syncing = (async () => {
        let sent = 0,
            rebased = 0,
            afterSequence = 0;
        // Gửi đúng thứ tự. Xóa row chỉ sau khi hub xác nhận snapshot tương ứng.
        for (;;) {
            const row = db
                .getDb()
                .prepare(
                    'SELECT id, sequence, digest, payload FROM hub_outbox WHERE sequence > ? ORDER BY sequence LIMIT 1'
                )
                .get(afterSequence);
            if (!row) break;
            let result;
            try {
                result = await call('/v1/catalog/sync', {
                    method: 'POST',
                    body: JSON.stringify({
                        ...JSON.parse(row.payload),
                        sequence: row.sequence,
                        digest: row.digest
                    })
                });
            } catch (error) {
                if (
                    [400, 413, 422].includes(error.status) &&
                    db
                        .getDb()
                        .prepare('SELECT 1 FROM hub_outbox WHERE sequence > ? LIMIT 1')
                        .get(row.sequence)
                ) {
                    // Keep the rejected snapshot until a newer full snapshot is acknowledged.
                    afterSequence = row.sequence;
                    continue;
                }
                if (error.status !== 409 || !Number.isSafeInteger(error.currentSequence))
                    throw error;
                result = { ignored: true, currentSequence: error.currentSequence };
            }
            if (result.ignored) {
                // Tenant DB restored from an older backup: local catalog is authoritative, so
                // drop obsolete snapshots and resend the current one above the hub sequence.
                if (++rebased > 1) throw new Error('Không phục hồi được sequence với hub.');
                rebaseOutbox(result.currentSequence);
                afterSequence = 0;
                continue;
            }
            const items = JSON.parse(row.payload).items || [];
            const mediaPaths = items
                .flatMap((item) => [
                    ...(item.images || []),
                    item.videoUrl,
                    ...(item.imeis || []).flatMap((im) => [
                        ...(item.imeiDetails?.[im]?.images || []),
                        item.imeiDetails?.[im]?.videoUrl
                    ])
                ])
                .filter((url) => typeof url === 'string' && url.startsWith('/uploads/'));
            await uploadMediaToHub(mediaPaths);
            db.getDb().prepare('DELETE FROM hub_outbox WHERE sequence<=?').run(row.sequence);
            db.getDb()
                .prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)')
                .run('hub_last_sync_at', result.syncedAt || new Date().toISOString());
            sent++;
        }
        lastError = null;
        return { sent };
    })();
    try {
        return await syncing;
    } catch (error) {
        lastError = error.message;
        throw error;
    } finally {
        syncing = null;
    }
}

function scheduleSync(delay = 0) {
    if (!enabled()) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
        syncNow()
            .then(() => scheduleSync(FULL_SYNC_MS))
            .catch((error) => {
                console.error('Đồng bộ hub thất bại:', error.message);
                scheduleSync(RETRY_MS);
            });
    }, delay);
    timer.unref?.();
}

async function partnerCatalog({ refresh = false } = {}) {
    if (!enabled()) return { configured: false, items: [], fetchedAt: null };
    if (!refresh && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
    try {
        const result = await call('/v1/catalog');
        cache = {
            at: Date.now(),
            value: {
                configured: true,
                items: rewritePartnerMedia(result.items || []),
                fetchedAt: result.fetchedAt
            }
        };
        return cache.value;
    } catch (error) {
        if (cache && Date.now() - cache.at < STALE_MS)
            return { ...cache.value, stale: true, error: error.message };
        throw error;
    }
}

// Hub trả URL `/v1/media/<id>` cho ảnh đối tác. Tenant đổi sang proxy nội bộ
// `/hub-media/<id>` → server.js stream từ Hub kèm API key (không lộ key ra browser).
function rewritePartnerMedia(items) {
    const toProxy = (value) => {
        const url = String(value || '');
        const match = /^\/v1\/media\/([a-f0-9]{32})$/.exec(url);
        return match ? `/hub-media/${match[1]}` : url.startsWith('/uploads/') ? '' : url;
    };
    const rewriteList = (list) => (Array.isArray(list) ? list.map(toProxy) : []);
    return items.map((item) => {
        const imeiDetails = {};
        for (const [serial, detail] of Object.entries(item.imeiDetails || {})) {
            imeiDetails[serial] = detail
                ? {
                      ...detail,
                      images: rewriteList(detail.images),
                      videoUrl: detail.videoUrl ? toProxy(detail.videoUrl) : ''
                  }
                : detail;
        }
        return {
            ...item,
            images: rewriteList(item.images),
            videoUrl: item.videoUrl ? toProxy(item.videoUrl) : '',
            imeiDetails
        };
    });
}

// Đẩy ảnh IMEI/sản phẩm lên Hub để đối tác xem được. Gọi khi shareProduct.
// Trả về map { '/uploads/x.jpg': '/v1/media/<id>' } để lưu vào shared_products.
async function uploadMediaToHub(paths) {
    if (!enabled()) return {};
    const uploadsDir = process.env.NKIOT_UPLOADS_DIR || path.join(__dirname, 'public', 'uploads');
    const mapping = {};
    for (const originalPath of new Set(paths)) {
        const match = /^\/uploads\/([A-Za-z0-9_.-]+)$/.exec(String(originalPath || ''));
        if (!match) continue;
        const filePath = path.join(uploadsDir, match[1]);
        try {
            const handle = await fs.promises.open(
                filePath,
                fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
            );
            let buffer;
            try {
                const stat = await handle.stat();
                if (!stat.isFile() || stat.size > MAX_MEDIA_BYTES)
                    throw new Error('Media không hợp lệ hoặc vượt 10MB.');
                buffer = await handle.readFile();
                if (buffer.length > MAX_MEDIA_BYTES) throw new Error('Media vượt 10MB.');
            } finally {
                await handle.close();
            }
            const result = await call('/v1/media', {
                method: 'POST',
                body: JSON.stringify({ path: originalPath, data: buffer.toString('base64') })
            });
            mapping[originalPath] = result.url;
        } catch (error) {
            throw new Error(`Chưa đồng bộ media ${originalPath}: ${error.message}`);
        }
    }
    return mapping;
}

function resetCache() {
    cache = null;
}

function stopSync() {
    clearTimeout(timer);
    timer = null;
}

function status() {
    return {
        configured: enabled(),
        pending: pending(),
        lastSyncAt: enabled()
            ? db.getDb().prepare('SELECT value FROM app_meta WHERE key=?').get('hub_last_sync_at')
                  ?.value || null
            : null,
        lastError:
            db.getDb().prepare("SELECT value FROM app_meta WHERE key='hub_catalog_error'").get()
                ?.value || lastError
    };
}
async function createInviteToken() {
    if (!enabled()) throw new Error('Cửa hàng chưa cấu hình kết nối Hub kho chung.');
    return call('/v1/partners/tokens', { method: 'POST', body: JSON.stringify({}) });
}
async function listInviteTokens() {
    if (!enabled()) return { tokens: [] };
    return call('/v1/partners/tokens', { method: 'GET' });
}
async function revokeInviteToken(token) {
    if (!enabled()) throw new Error('Cửa hàng chưa cấu hình kết nối Hub kho chung.');
    return call('/v1/partners/tokens/revoke', { method: 'POST', body: JSON.stringify({ token }) });
}
async function deleteInviteToken(token) {
    if (!enabled()) throw new Error('Cửa hàng chưa cấu hình kết nối Hub kho chung.');
    return call('/v1/partners/tokens/delete', { method: 'POST', body: JSON.stringify({ token }) });
}
async function redeemInviteToken(token) {
    if (!enabled()) throw new Error('Cửa hàng chưa cấu hình kết nối Hub kho chung.');
    const result = await call('/v1/partners/redeem', {
        method: 'POST',
        body: JSON.stringify({ token })
    });
    resetCache();
    return result;
}
async function listPartners() {
    if (!enabled()) return { partners: [] };
    return call('/v1/partners', { method: 'GET' });
}
async function unlinkPartner(partnerId) {
    if (!enabled()) throw new Error('Cửa hàng chưa cấu hình kết nối Hub kho chung.');
    const result = await call('/v1/partners/unlink', {
        method: 'POST',
        body: JSON.stringify({ partnerId })
    });
    resetCache();
    return result;
}
// Tải ảnh đối tác qua Hub. Trả về buffer + mime để server.js stream cho browser.
async function fetchMedia(id) {
    if (!enabled()) throw Object.assign(new Error('Hub chưa cấu hình.'), { status: 502 });
    if (!/^[a-f0-9]{32}$/.test(String(id || '')))
        throw Object.assign(new Error('Mã media không hợp lệ.'), { status: 400 });
    const { url, key } = config();
    const response = await fetch(`${url}/v1/media/${id}`, {
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
        headers: { Authorization: `Bearer ${key}` }
    });
    if (!response.ok) {
        const status = response.status === 404 || response.status === 403 ? 404 : 502;
        throw Object.assign(new Error(`Hub trả ${response.status}.`), { status });
    }
    const mime = response.headers.get('content-type') || 'application/octet-stream';
    if (!/^(image\/(jpeg|png|gif|webp)|video\/(mp4|webm|quicktime))$/.test(mime)) {
        await response.body?.cancel();
        throw new Error('Hub trả định dạng media không hợp lệ.');
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_MEDIA_BYTES) throw new Error('Media Hub vượt 10MB.');
        chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    return { buffer, mime };
}

module.exports = {
    enqueue,
    localCatalog,
    rebaseOutbox,
    syncNow,
    scheduleSync,
    partnerCatalog,
    uploadMediaToHub,
    rewritePartnerMedia,
    fetchMedia,
    status,
    resetCache,
    stopSync,
    createInviteToken,
    listInviteTokens,
    revokeInviteToken,
    deleteInviteToken,
    redeemInviteToken,
    listPartners,
    unlinkPartner
};
