'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('./db');
const { FALLBACK_BRANCH } = require('./constants');
const { can } = require('./security');
const MIME = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif'
};
const active = new Set();
const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
};
function authorize(user) {
    if (!can(user, 'products') || user.role !== 'admin')
        fail('Chỉ quản trị viên được gửi ảnh qua Deplao trong phiên bản này.', 403);
}
function config() {
    const raw = process.env.NKIOT_DEPLAO_URL;
    const key = process.env.NKIOT_DEPLAO_KEY;
    if (!raw || !key) fail('Chưa cấu hình NKIOT_DEPLAO_URL và NKIOT_DEPLAO_KEY trên server.', 503);
    let url, accounts;
    try {
        url = new URL(raw);
        accounts = JSON.parse(process.env.NKIOT_DEPLAO_ACCOUNTS || '{}');
    } catch {
        fail('Cấu hình Deplao không hợp lệ.', 503);
    }
    if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname.replace(/\/$/, '') !== '/api/v1' ||
        !(
            url.protocol === 'https:' ||
            (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
        )
    )
        fail('Deplao cần HTTPS (hoặc HTTP loopback), đường dẫn /api/v1.', 503);
    if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts))
        fail('Ánh xạ tài khoản Deplao không hợp lệ.', 503);
    return { base: url.href.replace(/\/$/, ''), key, accounts };
}
function branchConfig(user, branch) {
    authorize(user);
    if (typeof branch !== 'string' || !db.readSnapshot().branches.some((b) => b.name === branch))
        fail('Chọn chi nhánh hợp lệ.', 403);
    const cfg = config();
    const ids = cfg.accounts[branch];
    if (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== 'string' || !id))
        fail('Chưa gán tài khoản Deplao cho chi nhánh này.', 403);
    return { ...cfg, ids };
}
async function request(cfg, route, options = {}) {
    try {
        const res = await fetch(cfg.base + route, {
            ...options,
            redirect: 'error',
            signal: AbortSignal.timeout(15000),
            headers: { Authorization: `Bearer ${cfg.key}`, ...options.headers }
        });
        const chunks = [];
        let size = 0;
        for await (const chunk of res.body) {
            size += chunk.length;
            if (size > 2 * 1024 * 1024) throw new Error('large');
            chunks.push(chunk);
        }
        const out = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!res.ok || out.success !== true)
            fail(
                `Deplao từ chối yêu cầu (HTTP ${res.status}). Kiểm tra key, scope và tài khoản.`,
                502
            );
        return out.data;
    } catch (err) {
        if (err.status) throw err;
        fail(
            'Không xác nhận được phản hồi Deplao. Kiểm tra kết nối và lịch sử gửi trước khi thử lại.',
            502
        );
    }
}
function productImages(user, branch, productId, imei) {
    authorize(user);
    const product = db
        .readSnapshot()
        .products.find(
            (p) =>
                p.id === productId &&
                (p.branch || FALLBACK_BRANCH) === branch &&
                p.status === 'active'
        );
    if (!product) fail('Sản phẩm không còn thuộc chi nhánh hoặc đã ngừng kinh doanh.', 404);
    let images = product.images;
    if (product.hasImei) {
        if (typeof imei !== 'string' || !product.imeis?.includes(imei))
            fail('Chọn đúng IMEI còn tồn.', 409);
        images = product.imeiDetails?.[imei]?.images;
    } else if (imei) fail('Sản phẩm này không quản lý IMEI.');
    return [
        ...new Set(
            (Array.isArray(images) ? images : []).filter(
                (v) =>
                    typeof v === 'string' &&
                    /^\/uploads\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(v) &&
                    MIME[path.extname(v).toLowerCase()]
            )
        )
    ];
}
async function readImage(url) {
    const directory = process.env.NKIOT_UPLOADS_DIR || path.join(__dirname, 'public/uploads');
    let handle;
    try {
        handle = await fs.promises.open(
            path.join(directory, path.basename(url)),
            fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
        );
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size < 1 || stat.size > 10 * 1024 * 1024)
            fail('Ảnh phải là file thường, tối đa 10 MB.', 413);
        const buffer = Buffer.alloc(stat.size + 1);
        let used = 0;
        while (used < buffer.length) {
            const { bytesRead } = await handle.read(buffer, used, buffer.length - used, null);
            if (!bytesRead) break;
            used += bytesRead;
        }
        if (used !== stat.size) fail('Ảnh đã thay đổi khi đọc, hãy chọn lại.', 409);
        return buffer.subarray(0, used);
    } catch (err) {
        if (err.status) throw err;
        fail('Không đọc được ảnh sản phẩm; không hỗ trợ symlink.', 404);
    } finally {
        await handle?.close();
    }
}
function job(user, id) {
    authorize(user);
    const row = db
        .getDb()
        .prepare('SELECT * FROM deplao_send_jobs WHERE id=? AND userId=?')
        .get(id, user.id);
    if (!row) fail('Không tìm thấy lượt gửi.', 404);
    return {
        id: row.id,
        status: row.status,
        uploaded: row.uploaded,
        total: row.total,
        result: JSON.parse(row.result),
        updatedAt: row.updatedAt
    };
}

async function send(user, input) {
    const cfg = branchConfig(user, input.branch);
    const route = `${accountRoute(cfg, input.accountId)}/conversations/${identity(input.threadId)}`;
    if (!/^[a-f0-9-]{36}$/i.test(input.id || '')) fail('Mã lượt gửi không hợp lệ.');
    if (typeof input.text !== 'string' || input.text.length > 10000 || input.confirmed !== true)
        fail('Cần xác nhận nội dung và người nhận.');
    if (
        !Array.isArray(input.images) ||
        !input.images.length ||
        input.images.length > 10 ||
        new Set(input.images).size !== input.images.length
    )
        fail('Chọn 1–10 ảnh, không trùng.');
    const payload = {
        branch: input.branch,
        accountId: input.accountId,
        threadId: input.threadId,
        productId: input.productId,
        imei: input.imei || '',
        text: input.text,
        images: input.images
    };
    const digest = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const database = db.getDb();
    const prior = database.prepare('SELECT * FROM deplao_send_jobs WHERE id=?').get(input.id);
    if (prior) {
        if (prior.userId !== user.id || prior.digest !== digest)
            fail('Mã lượt gửi đã dùng cho nội dung khác.', 409);
        return job(user, input.id);
    }
    const allowed = productImages(user, input.branch, input.productId, input.imei);
    if (input.images.some((url) => !allowed.includes(url)))
        fail('Ảnh không thuộc sản phẩm/IMEI đã chọn.', 403);
    if (active.size >= 2) fail('Đang xử lý lượt gửi khác, vui lòng chờ.', 429);
    active.add(input.id);
    let messaging = false;
    const now = new Date().toISOString();
    try {
        database
            .prepare(
                "INSERT INTO deplao_send_jobs (id,userId,branch,digest,status,total,createdAt,updatedAt) VALUES (?,?,?,?,'uploading',?,?,?)"
            )
            .run(input.id, user.id, input.branch, digest, input.images.length, now, now);
        const account = await request(cfg, accountRoute(cfg, input.accountId));
        if (!account?.online) fail('Tài khoản chat đang offline.', 409);
        const thread = await request(cfg, route);
        if (
            String(thread?.thread_id) !== input.threadId ||
            !['user', 'group'].includes(thread.type)
        )
            fail('Không xác minh được hội thoại.', 409);
        const files = [];
        let total = 0;
        for (const url of input.images) {
            const buffer = await readImage(url);
            total += buffer.length;
            if (total > 30 * 1024 * 1024) fail('Tổng ảnh tối đa 30 MB.', 413);
            files.push({ url, buffer });
        }
        const attachments = [];
        for (const [i, file] of files.entries()) {
            const uploaded = await request(cfg, '/media/uploads', {
                method: 'POST',
                headers: {
                    'Content-Type': MIME[path.extname(file.url).toLowerCase()],
                    'X-Filename': `product-${i + 1}${path.extname(file.url).toLowerCase()}`
                },
                body: file.buffer
            });
            if (typeof uploaded?.upload_id !== 'string')
                fail('Upload Deplao không trả mã file.', 502);
            attachments.push({ upload_id: uploaded.upload_id, kind: 'image' });
            database
                .prepare('UPDATE deplao_send_jobs SET uploaded=?,updatedAt=? WHERE id=?')
                .run(i + 1, new Date().toISOString(), input.id);
        }
        messaging = true;
        database
            .prepare("UPDATE deplao_send_jobs SET status='sending',updatedAt=? WHERE id=?")
            .run(new Date().toISOString(), input.id);
        const result = await request(cfg, route + '/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `nkiot-${input.id}` },
            body: JSON.stringify({ thread_type: thread.type, text: input.text, attachments })
        });
        const sent = Array.isArray(result?.sent)
            ? result.sent.map((r) => ({ type: r.type, msg_id: r.msg_id || null }))
            : [];
        const status =
            sent.length >= attachments.length + (input.text ? 1 : 0) ? 'sent' : 'needs_review';
        database
            .prepare('UPDATE deplao_send_jobs SET status=?,result=?,updatedAt=? WHERE id=?')
            .run(status, JSON.stringify({ sent }), new Date().toISOString(), input.id);
    } catch (err) {
        database
            .prepare('UPDATE deplao_send_jobs SET status=?,result=?,updatedAt=? WHERE id=?')
            .run(
                messaging ? 'needs_review' : 'failed',
                JSON.stringify({
                    error: err.status
                        ? err.message
                        : 'Lượt gửi chưa hoàn tất. Kiểm tra lịch sử Deplao.'
                }),
                new Date().toISOString(),
                input.id
            );
    } finally {
        active.delete(input.id);
    }
    return job(user, input.id);
}
module.exports = { connection, conversations, send, job, productImages };

function identity(value) {
    if (typeof value !== 'string' || !value || value.length > 200)
        fail('ID tài khoản/hội thoại không hợp lệ.');
    return encodeURIComponent(value);
}
function accountRoute(cfg, accountId) {
    if (!cfg.ids.includes(accountId)) fail('Tài khoản chat không thuộc chi nhánh này.', 403);
    return `/accounts/${identity(accountId)}`;
}
async function connection(user, branch) {
    const cfg = branchConfig(user, branch);
    const me = await request(cfg, '/me');
    const scopes = me?.scopes || [];
    if (
        !scopes.includes('admin') &&
        ['accounts:read', 'chat:read', 'media:write', 'chat:send'].some((s) => !scopes.includes(s))
    )
        fail('Key Deplao thiếu accounts:read, chat:read, media:write hoặc chat:send.', 403);
    const accounts = await request(cfg, '/accounts');
    if (!Array.isArray(accounts)) fail('Danh sách tài khoản Deplao không hợp lệ.', 502);
    return {
        accounts: accounts
            .filter((a) => cfg.ids.includes(a.id))
            .map((a) => ({
                id: a.id,
                name: String(a.display_name || a.id),
                channel: a.channel,
                online: a.online === true
            }))
    };
}
async function conversations(user, branch, accountId, search, offset = 0) {
    const cfg = branchConfig(user, branch);
    if (!Number.isSafeInteger(offset) || offset < 0) fail('Trang hội thoại không hợp lệ.');
    const rows = await request(
        cfg,
        `${accountRoute(cfg, accountId)}/conversations?limit=20&offset=${offset}&search=${encodeURIComponent(String(search || '').slice(0, 200))}`
    );
    if (!Array.isArray(rows)) fail('Danh sách hội thoại không hợp lệ.', 502);
    return {
        conversations: rows.map((r) => ({
            id: r.thread_id,
            name: String(r.display_name || r.thread_id),
            type: r.type,
            phone: r.phone || ''
        })),
        hasMore: rows.length === 20
    };
}
