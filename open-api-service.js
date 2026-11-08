'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');
const { FALLBACK_BRANCH } = require('./constants');

const TOKEN_PREFIX = 'nk_live_';
const MAX_TOKENS = 50;

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

function fail(message, status = 400) {
    throw Object.assign(new Error(message), { status });
}

function hashToken(rawToken) {
    return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

function maskToken(rawToken) {
    const s = String(rawToken || '');
    if (s.length <= 16) return s;
    return `${s.slice(0, 12)}...${s.slice(-6)}`;
}

function allowedBranchesForUser(user, snapshot) {
    if (user?.role === 'admin') {
        return new Set((snapshot.branches || []).map((b) => b.name).concat([FALLBACK_BRANCH]));
    }
    const list =
        Array.isArray(user?.branches) && user.branches.length
            ? user.branches
            : [user?.branch || FALLBACK_BRANCH];
    return new Set(list);
}

function effectiveStatus(row, nowIso = new Date().toISOString()) {
    if (!row) return 'not_found';
    if (row.status === 'revoked' || row.revokedAt) return 'revoked';
    if (row.expiresAt && row.expiresAt <= nowIso) return 'expired';
    return row.status || 'active';
}

function createToken(user, input = {}) {
    if (!user) fail('Vui lòng đăng nhập.', 401);
    const name = String(input.name || '').trim();
    if (!name) fail('Vui lòng nhập tên gợi nhớ cho Token (ví dụ: Website, CRM Chat).', 400);
    if (name.length > 100) fail('Tên gợi nhớ tối đa 100 ký tự.', 400);

    const snapshot = db.readSnapshot();
    const allowed = allowedBranchesForUser(user, snapshot);
    const targetBranch = String(input.branch || '').trim();
    if (user.role !== 'admin') fail('Chỉ quản trị viên được quản lý API Token.', 403);
    if (targetBranch === 'ALL' || targetBranch === 'Toàn bộ chi nhánh')
        fail('Vui lòng chọn một chi nhánh cụ thể.', 400);
    if (!allowed.has(targetBranch)) fail('Chi nhánh không tồn tại.', 400);

    const expiresInDays = Number(input.expiresInDays ?? 0);
    if (!Number.isFinite(expiresInDays) || expiresInDays < 0 || expiresInDays > 365) {
        fail('Thời hạn hiệu lực không hợp lệ (0-365 ngày).', 400);
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt =
        expiresInDays > 0
            ? new Date(now.getTime() + expiresInDays * 86400 * 1000).toISOString()
            : null;

    const database = db.getDb();
    const count = database.prepare('SELECT COUNT(*) AS total FROM api_tokens').get()?.total || 0;
    if (count >= MAX_TOKENS) {
        fail(`Đã đạt giới hạn tối đa ${MAX_TOKENS} API Token. Vui lòng xóa bớt Token cũ.`, 400);
    }

    const rawToken = `${TOKEN_PREFIX}${crypto.randomBytes(24).toString('base64url')}`;
    const tokenHash = hashToken(rawToken);
    const masked = maskToken(rawToken);
    const tokenId = `TOK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    database
        .prepare(
            `INSERT INTO api_tokens (
                id, name, tokenHash, maskedToken, branch, createdBy, createdByName,
                scopes, status, expiresAt, lastUsedAt, createdAt, updatedAt, revokedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, '["products:read"]', 'active', ?, NULL, ?, ?, NULL)`
        )
        .run(
            tokenId,
            name,
            tokenHash,
            masked,
            targetBranch,
            user.id || user.username || '',
            user.name || user.username || '',
            expiresAt,
            nowIso,
            nowIso
        );

    return {
        id: tokenId,
        name,
        token: rawToken,
        maskedToken: masked,
        branch: targetBranch,
        expiresAt,
        createdAt: nowIso
    };
}

function listTokens(user) {
    if (!user) fail('Vui lòng đăng nhập.', 401);
    const database = db.getDb();
    const rows = database.prepare('SELECT * FROM api_tokens ORDER BY createdAt DESC').all();
    const nowIso = new Date().toISOString();
    return rows.map((r) => ({
        id: r.id,
        name: r.name,
        maskedToken: r.maskedToken,
        branch: r.branch,
        createdByName: r.createdByName || '',
        status: effectiveStatus(r, nowIso),
        expiresAt: r.expiresAt || null,
        lastUsedAt: r.lastUsedAt || null,
        createdAt: r.createdAt
    }));
}

function revokeToken(user, tokenId) {
    if (!user) fail('Vui lòng đăng nhập.', 401);
    const database = db.getDb();
    const row = database.prepare('SELECT * FROM api_tokens WHERE id=?').get(String(tokenId || ''));
    if (!row) fail('Không tìm thấy Token.', 404);
    const nowIso = new Date().toISOString();
    database
        .prepare("UPDATE api_tokens SET status='revoked', revokedAt=?, updatedAt=? WHERE id=?")
        .run(nowIso, nowIso, row.id);
    return { success: true };
}

function deleteToken(user, tokenId) {
    if (!user) fail('Vui lòng đăng nhập.', 401);
    const database = db.getDb();
    database.prepare('DELETE FROM api_tokens WHERE id=?').run(String(tokenId || ''));
    return { success: true };
}

function extractTokenString(req) {
    const authHeader = req.headers['authorization'] || '';
    const match = /^Bearer\s+([A-Za-z0-9_-]+)$/i.exec(authHeader.trim());
    if (match) return match[1];
    return '';
}

function authenticateOpenRequest(req) {
    const rawToken = extractTokenString(req);
    if (!rawToken || !rawToken.startsWith(TOKEN_PREFIX)) {
        fail('Thiếu hoặc sai mã API Token (yêu cầu header Authorization: Bearer).', 401);
    }
    const tokenHash = hashToken(rawToken);
    const database = db.getDb();
    const row = database.prepare('SELECT * FROM api_tokens WHERE tokenHash=?').get(tokenHash);
    if (!row) {
        fail('API Token không tồn tại hoặc đã bị xóa.', 401);
    }
    const nowIso = new Date().toISOString();
    const st = effectiveStatus(row, nowIso);
    if (st === 'revoked') {
        fail('API Token này đã bị thu hồi.', 401);
    }
    if (st === 'expired') {
        fail('API Token này đã hết hạn hiệu lực.', 401);
    }
    if (!row.branch || row.branch === 'ALL' || row.branch === 'Toàn bộ chi nhánh')
        fail('Token cũ có phạm vi không an toàn; vui lòng tạo lại token theo chi nhánh.', 401);
    let scopes;
    try {
        scopes = JSON.parse(row.scopes);
    } catch {
        fail('Phạm vi token không hợp lệ.', 403);
    }
    if (!Array.isArray(scopes) || !scopes.includes('products:read'))
        fail('Token không có quyền đọc hàng hóa.', 403);

    if (!row.lastUsedAt || Date.now() - Date.parse(row.lastUsedAt) >= 300000)
        database.prepare('UPDATE api_tokens SET lastUsedAt=? WHERE id=?').run(nowIso, row.id);

    return { tokenRecord: row };
}

function mediaId(tokenRecord, filename) {
    return crypto.createHmac('sha256', tokenRecord.tokenHash).update(filename).digest('hex');
}
function formatProductMediaUrl(rawPath, tokenRecord) {
    const clean = String(rawPath || '').trim();
    if (!/^\/uploads\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(clean)) return '';
    return `/api/v1/open/media/${mediaId(tokenRecord, clean.slice(9))}`;
}
function activeProducts(tokenRecord) {
    return (db.readSnapshot().products || []).filter(
        (p) => p.status !== 'archived' && (p.branch || FALLBACK_BRANCH) === tokenRecord.branch
    );
}
function productView(p, tokenRecord) {
    const urls = (items) =>
        (Array.isArray(items) ? items : [])
            .map((u) => formatProductMediaUrl(u, tokenRecord))
            .filter(Boolean);
    const imeis = p.hasImei && Array.isArray(p.imeis) ? p.imeis : [];
    const units = imeis.map((serial) => {
        const detail = p.imeiDetails?.[serial] || {};
        return {
            id: crypto
                .createHmac('sha256', tokenRecord.tokenHash)
                .update(JSON.stringify([p.id, serial]))
                .digest('hex'),
            serialMasked: `***${String(serial).slice(-4)}`,
            condition: detail.condition || p.condition || 'new',
            conditionDetail: detail.conditionDetail || '',
            images: urls(detail.images)
        };
    });
    return {
        code: p.code,
        name: p.name,
        category: p.category || '',
        price: Number(p.price) || 0,
        unit: p.unit || '',
        barcode: p.barcode || '',
        availability: (p.hasImei ? units.length > 0 : Number(p.stock) > 0)
            ? 'in_stock'
            : 'out_of_stock',
        condition: p.condition || 'new',
        conditionDetail: p.conditionDetail || '',
        description: p.description || '',
        hasImei: Boolean(p.hasImei),
        images: urls(p.images),
        units
    };
}
function getOpenProducts(tokenRecord, searchParams) {
    const q = (searchParams.get('q') || '').trim().toLowerCase();
    const category = (searchParams.get('category') || '').trim();
    const page = Number(searchParams.get('page') || 1),
        limit = Number(searchParams.get('limit') || 50);
    if (
        !Number.isSafeInteger(page) ||
        page < 1 ||
        page > 100000 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100
    )
        fail('Trang hoặc giới hạn không hợp lệ.');
    const min = searchParams.get('min_price'),
        max = searchParams.get('max_price');
    if (
        (min !== null && (!Number.isFinite(Number(min)) || Number(min) < 0)) ||
        (max !== null && (!Number.isFinite(Number(max)) || Number(max) < 0))
    )
        fail('Giá không hợp lệ.');
    const rows = activeProducts(tokenRecord)
        .filter(
            (p) =>
                (!q ||
                    [p.name, p.code, p.barcode].some((v) =>
                        String(v || '')
                            .toLowerCase()
                            .includes(q)
                    )) &&
                (!category || p.category === category) &&
                (min === null || Number(p.price) >= Number(min)) &&
                (max === null || Number(p.price) <= Number(max)) &&
                (!['true', '1'].includes(searchParams.get('in_stock')) ||
                    (p.hasImei
                        ? Array.isArray(p.imeis) && p.imeis.length > 0
                        : Number(p.stock) > 0))
        )
        .sort(
            (a, b) =>
                String(a.code).localeCompare(String(b.code)) ||
                String(a.id).localeCompare(String(b.id))
        );
    const offset = (page - 1) * limit;
    return {
        success: true,
        page,
        limit,
        total: rows.length,
        hasMore: offset + limit < rows.length,
        data: rows.slice(offset, offset + limit).map((p) => productView(p, tokenRecord))
    };
}
function getOpenProductByCode(tokenRecord, code) {
    const products = activeProducts(tokenRecord);
    // Catalog/POS codes are case-sensitive. Keep exact identity, with a unique
    // case-insensitive fallback for existing clients that normalize input.
    const exact = products.filter((p) => p.code === code);
    const matches = exact.length
        ? exact
        : products.filter(
              (p) => String(p.code || '').toLowerCase() === String(code || '').toLowerCase()
          );
    if (!matches.length) fail('Không tìm thấy sản phẩm.', 404);
    if (matches.length > 1) fail('Mã sản phẩm không duy nhất trong chi nhánh.', 409);
    return { success: true, data: productView(matches[0], tokenRecord) };
}
function resolveOpenMediaFile(id, uploadsDir, tokenRecord) {
    if (!/^[a-f0-9]{64}$/.test(String(id))) return null;
    for (const product of activeProducts(tokenRecord)) {
        const images = Array.isArray(product.images) ? [...product.images] : [];
        for (const serial of Array.isArray(product.imeis) ? product.imeis : []) {
            const extra = product.imeiDetails?.[serial]?.images;
            if (Array.isArray(extra)) images.push(...extra);
        }
        for (const raw of images) {
            const clean = String(raw || '');
            if (!/^\/uploads\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(clean)) continue;
            const filename = clean.slice(9);
            if (mediaId(tokenRecord, filename) !== id) continue;
            const contentType = MIME_BY_EXT[path.extname(filename).toLowerCase()];
            if (!contentType) return null;
            return {
                safePath: path.join(path.resolve(uploadsDir), filename),
                filename,
                ext: path.extname(filename).toLowerCase(),
                contentType
            };
        }
    }
    return null;
}

module.exports = {
    TOKEN_PREFIX,
    createToken,
    listTokens,
    revokeToken,
    deleteToken,
    authenticateOpenRequest,
    getOpenProducts,
    getOpenProductByCode,
    resolveOpenMediaFile
};
