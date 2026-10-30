'use strict';
// Hub Media Proxy: tenant đẩy ảnh lên Hub một lần, đối tác tải qua /v1/media/:id.
// Tách khỏi hub-server.js để test độc lập được.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const hubDb = require('./hub-db');

const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const MEDIA_DIR = () =>
    process.env.NKIOT_HUB_MEDIA_DIR || path.join(__dirname, 'data', 'hub-media');

const ALLOWED_MIME = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov'
};

const MIME_BY_EXT = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime'
};

const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
};

// id xác định từ (tenant, đường dẫn gốc) nên upload lặp lại không tạo bản ghi trùng.
function mediaId(ownerTenantId, originalPath) {
    return crypto
        .createHash('sha256')
        .update(`${ownerTenantId}|${originalPath}`)
        .digest('hex')
        .slice(0, 32);
}

function mediaFilePath(id) {
    if (!/^[a-f0-9]{32}$/.test(id || '')) fail('Mã media không hợp lệ.', 400);
    return path.join(MEDIA_DIR(), `${id}.bin`);
}

function detectMime(buffer) {
    if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
        return 'image/jpeg';
    if (
        buffer.length > 8 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47
    )
        return 'image/png';
    if (
        buffer.length > 4 &&
        buffer[0] === 0x47 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x38
    )
        return 'image/gif';
    if (
        buffer.length > 12 &&
        buffer.toString('ascii', 0, 4) === 'RIFF' &&
        buffer.toString('ascii', 8, 12) === 'WEBP'
    )
        return 'image/webp';
    if (
        buffer.length > 12 &&
        (buffer.toString('ascii', 4, 8) === 'ftyp' || buffer.toString('ascii', 4, 8) === 'moov')
    )
        return 'video/mp4';
    if (buffer.length > 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf)
        return 'video/webm';
    return '';
}

// Tenant gọi hàm này khi shareProduct để đẩy ảnh IMEI lên Hub.
async function storeMedia(ownerTenantId, originalPath, base64Data) {
    if (typeof originalPath !== 'string' || !/^\/uploads\/[A-Za-z0-9_.-]+$/.test(originalPath))
        fail('Đường dẫn media phải là /uploads/<tên-tệp>.', 400);
    if (typeof base64Data !== 'string' || !base64Data) fail('Thiếu dữ liệu media.', 400);
    const buffer = Buffer.from(base64Data.replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!buffer.length) fail('Dữ liệu media rỗng.', 400);
    if (buffer.length > MAX_MEDIA_BYTES) fail('Media vượt quá 10MB.', 413);

    const detected = detectMime(buffer);
    if (!detected || !ALLOWED_MIME[detected]) fail('Định dạng media không được hỗ trợ.', 415);

    const id = mediaId(ownerTenantId, originalPath);
    const dir = MEDIA_DIR();
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
    const target = path.join(dir, `${id}.bin`);
    const temp = `${target}.${crypto.randomUUID()}.tmp`;
    try {
        await fs.promises.writeFile(temp, buffer, { mode: 0o600, flag: 'wx' });
        await fs.promises.rename(temp, target);
    } finally {
        await fs.promises.rm(temp, { force: true });
    }

    hubDb
        .getDb()
        .prepare(
            `INSERT INTO tenant_media (id, ownerTenantId, originalPath, mime, size, createdAt)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET mime=excluded.mime, size=excluded.size`
        )
        .run(id, ownerTenantId, originalPath, detected, buffer.length, new Date().toISOString());

    return { mediaId: id, url: `/v1/media/${id}`, mime: detected, size: buffer.length };
}

// Đối tác tải ảnh: chỉ được xem ảnh của tenant đã liên kết (hoặc của chính mình).
function canReadMedia(viewerTenantId, ownerTenantId, originalPath) {
    const db = hubDb.getDb();
    const active = (id) =>
        db.prepare("SELECT 1 FROM tenants WHERE id=? AND status='active'").get(id);
    if (!active(viewerTenantId) || !active(ownerTenantId)) return false;
    if (viewerTenantId === ownerTenantId) return true;
    if (
        !originalPath ||
        !db
            .prepare(
                "SELECT 1 FROM tenant_partners WHERE tenantId=? AND partnerTenantId=? AND status='active'"
            )
            .get(viewerTenantId, ownerTenantId)
    )
        return false;
    return db
        .prepare(
            "SELECT images, videoUrl, imeis, imeiDetails FROM catalog_products WHERE ownerTenantId=? AND status='active' AND availability!='out_of_stock'"
        )
        .all(ownerTenantId)
        .some((row) => {
            try {
                if (
                    JSON.parse(row.images || '[]').includes(originalPath) ||
                    row.videoUrl === originalPath
                )
                    return true;
                const details = JSON.parse(row.imeiDetails || '{}');
                return JSON.parse(row.imeis || '[]').some(
                    (im) =>
                        details[im]?.images?.includes(originalPath) ||
                        details[im]?.videoUrl === originalPath
                );
            } catch {
                return false;
            }
        });
}

function getMediaRecord(id) {
    return hubDb.getDb().prepare('SELECT * FROM tenant_media WHERE id=?').get(id) || null;
}

function mediaMimeForExt(filePath) {
    return MIME_BY_EXT[path.extname(filePath).toLowerCase()] || '';
}

module.exports = {
    MAX_MEDIA_BYTES,
    MEDIA_DIR,
    ALLOWED_MIME,
    mediaId,
    mediaFilePath,
    detectMime,
    storeMedia,
    canReadMedia,
    getMediaRecord,
    mediaMimeForExt
};
