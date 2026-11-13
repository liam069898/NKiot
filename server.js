'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const db = require('./db');
const auth = require('./security');
const application = require('./application');
const hub = require('./hub-client');
const { securityHeaders } = require('./security-headers');
const sessions = new Map(),
    attempts = new Map();
const MAX_BODY = 16 * 1024 * 1024;
// Per-process safeguard; production reverse proxies must also enforce distributed limits.
const openAttempts = new Map();
function checkOpenRateLimit(req) {
    const now = Date.now();
    for (const [key, entry] of openAttempts) if (entry.until <= now) openAttempts.delete(key);
    const ip = req.socket?.remoteAddress || 'unknown';
    const token = String(req.headers.authorization || '');
    const key = crypto.createHash('sha256').update(`${ip}|${token}`).digest('hex');
    if (!openAttempts.has(key) && openAttempts.size >= 10000)
        throw Object.assign(new Error('Máy chủ đang bận.'), { status: 429 });
    const entry = openAttempts.get(key) || { count: 0, until: now + 60000 };
    if (++entry.count > 120)
        throw Object.assign(new Error('Quá nhiều yêu cầu, vui lòng thử lại sau.'), { status: 429 });
    openAttempts.set(key, entry);
}
const UPLOADS_DIR = process.env.NKIOT_UPLOADS_DIR || path.join(__dirname, 'public', 'uploads');

fs.mkdirSync(UPLOADS_DIR, { recursive: true, mode: 0o700 });
const ASSETS = {
    '/': 'index.html',
    '/index.html': 'index.html',
    // Old URL kept so existing bookmarks still open the app.
    '/giao_di_n_qu_n_l_b_n_h_ng_kiotviet.html': 'index.html',
    '/app.js': 'app.js',
    '/app-utils.js': 'app-utils.js',
    '/app-reports.js': 'app-reports.js',
    '/app-export.js': 'app-export.js',
    '/constants.js': 'constants.js',
    '/catalog-patch.js': 'catalog-patch.js',
    '/data.js': 'client-store.js',
    '/ui-safety.js': 'ui-safety.js',
    '/assets/tailwind.css': 'public/tailwind.css',
    '/assets/inter.css': 'public/inter.css',
    '/assets/inter-vietnamese-wght-normal.woff2': 'public/inter-vietnamese-wght-normal.woff2',
    '/assets/inter-latin-ext-wght-normal.woff2': 'public/inter-latin-ext-wght-normal.woff2',
    '/assets/inter-latin-wght-normal.woff2': 'public/inter-latin-wght-normal.woff2'
};
// Static files cached in memory with a gzip copy; reloaded when mtime/size change on disk.
const assetCache = new Map();
async function loadAsset(file) {
    const full = path.join(__dirname, file),
        stat = await fs.promises.stat(full),
        stamp = `${stat.mtimeMs}:${stat.size}`,
        cached = assetCache.get(file);
    if (cached?.stamp === stamp) return cached;
    const raw = await fs.promises.readFile(full);
    const asset = {
        stamp,
        raw,
        gzip: await promisify(zlib.gzip)(raw, { level: 9 }),
        etag: `"${crypto.createHash('sha1').update(raw).digest('base64url')}"`
    };
    assetCache.set(file, asset);
    return asset;
}
// Responses whose request accepted gzip. Kept outside `res` so test doubles need no extra fields.
const acceptsGzip = new WeakSet();
const gzipAsync = promisify(zlib.gzip);
async function json(res, status, data, extraHeaders = {}) {
    let payload = JSON.stringify(data);
    const headers = {
        ...securityHeaders(),
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        Vary: 'Accept-Encoding',
        ...extraHeaders
    };
    // Full views are several MB of repetitive JSON; level 1 gives ~95% reduction in ~15 ms and
    // runs on the libuv threadpool, so the event loop stays free while compressing.
    if (payload.length > 1024 && acceptsGzip.has(res)) {
        payload = await gzipAsync(payload, { level: 1 });
        headers['Content-Encoding'] = 'gzip';
    }
    headers['Content-Length'] = Buffer.byteLength(payload);
    res.writeHead(status, headers);
    res.end(payload);
}
async function body(req) {
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))
        throw Object.assign(new Error('Yêu cầu JSON.'), { status: 415 });
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) throw Object.assign(new Error('Dữ liệu quá lớn.'), { status: 413 });
        chunks.push(chunk);
    }
    try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            throw new Error('object required');
        return parsed;
    } catch {
        throw Object.assign(new Error('JSON không hợp lệ.'), { status: 400 });
    }
}
function cookie(req) {
    return (req.headers.cookie || '')
        .split(';')
        .map((s) => s.trim())
        .find((s) => s.startsWith('minikiot_session='))
        ?.slice(17);
}
// Đọc phiên từ cache RAM trước, nếu chưa có thì nạp lại từ SQLite (khôi phục sau restart).
function loadSession(token) {
    if (!token) return null;
    let session = sessions.get(token);
    if (session) return session;
    session = db.readSession(token);
    if (session) sessions.set(token, session);
    return session;
}
function sessionUser(req) {
    const token = cookie(req),
        session = loadSession(token);
    if (!session || session.expires < Date.now()) {
        sessions.delete(token);
        db.deleteSession(token);
        return null;
    }
    const user = db.readSnapshot().users.find((u) => u.id === session.userId);
    if (!user || user.status !== 'active' || user.password !== session.password) {
        sessions.delete(token);
        db.deleteSession(token);
        return null;
    }
    return user;
}
function setCookie(res, token, remember = false, secure = false) {
    res.setHeader(
        'Set-Cookie',
        `minikiot_session=${token}; HttpOnly; SameSite=Strict; Path=/${remember ? '; Max-Age=604800' : ''}${secure ? '; Secure' : ''}`
    );
}
function view(user) {
    const data = db.readSnapshot();
    const fresh = data.users.find((u) => u.id === user.id);
    if (!fresh || fresh.status !== 'active')
        throw Object.assign(new Error('Phiên đăng nhập đã hết hiệu lực.'), { status: 401 });
    return {
        success: true,
        user: auth.publicUser(fresh),
        data: application.project(data, fresh),
        revision: application.revision()
    };
}
async function handler(req, res) {
    if (/\bgzip\b/i.test(req.headers['accept-encoding'] || '')) acceptsGzip.add(res);
    try {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/health' && req.method === 'GET')
            return json(res, 200, {
                success: true,
                service: 'nkiot-pos',
                version: require('./package.json').version,
                time: new Date().toISOString()
            });
        if (url.pathname.startsWith('/api/v1/open/')) {
            checkOpenRateLimit(req);
            const corsHeaders = {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Authorization, Content-Type, ETag, If-None-Match'
            };
            if (req.method === 'OPTIONS') {
                res.writeHead(204, { ...securityHeaders(), ...corsHeaders });
                return res.end();
            }
            if (!['GET', 'HEAD'].includes(req.method)) {
                return json(res, 405, { success: false, error: 'Method not allowed' }, corsHeaders);
            }
            const openApi = require('./open-api-service');
            const mediaMatch = /^\/api\/v1\/open\/media\/([a-f0-9]{64})$/.exec(url.pathname);
            if (mediaMatch) {
                const { tokenRecord } = openApi.authenticateOpenRequest(req);
                const resolved = openApi.resolveOpenMediaFile(
                    mediaMatch[1],
                    UPLOADS_DIR,
                    tokenRecord
                );
                if (!resolved) {
                    return json(
                        res,
                        404,
                        { success: false, error: 'Không tìm thấy tệp ảnh.' },
                        corsHeaders
                    );
                }
                const handle = await fs.promises.open(
                    resolved.safePath,
                    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
                );
                let stat;
                try {
                    stat = await handle.stat();
                    if (!stat.isFile()) {
                        await handle.close();
                        return json(
                            res,
                            404,
                            { success: false, error: 'Không tìm thấy tệp ảnh.' },
                            corsHeaders
                        );
                    }
                } catch (error) {
                    await handle.close();
                    throw error;
                }
                const etag = `"${stat.mtimeMs.toString(16)}-${stat.size.toString(16)}"`;
                if (req.headers['if-none-match'] === etag) {
                    await handle.close();
                    res.writeHead(304, {
                        ...securityHeaders(),
                        ...corsHeaders,
                        ETag: etag,
                        'Cache-Control': 'private, no-store'
                    });
                    return res.end();
                }
                const isDownload = url.searchParams.get('download') === '1';
                const customName = String(url.searchParams.get('name') || '')
                    .replace(/[^a-zA-Z0-9_-]/g, '-')
                    .replace(/-+/g, '-')
                    .replace(/^-|-$/g, '')
                    .slice(0, 60);
                const downloadFilename = `${customName || path.basename(resolved.filename, resolved.ext)}${resolved.ext}`;
                res.writeHead(200, {
                    ...securityHeaders(),
                    ...corsHeaders,
                    'Content-Type': resolved.contentType,
                    'Content-Length': stat.size,
                    'Cache-Control': 'private, no-store',
                    'X-Robots-Tag': 'noindex, nofollow',
                    ETag: etag,
                    ...(isDownload
                        ? { 'Content-Disposition': `attachment; filename="${downloadFilename}"` }
                        : {})
                });
                if (req.method === 'HEAD') {
                    await handle.close();
                    return res.end();
                }
                const stream = handle.createReadStream();
                stream.on('error', () => res.destroy());
                res.on('close', () => stream.destroy());
                return stream.pipe(res);
            }

            const prodDetailMatch = /^\/api\/v1\/open\/products\/([^/]+)$/.exec(url.pathname);
            if (prodDetailMatch) {
                let codeParam;
                try {
                    codeParam = decodeURIComponent(prodDetailMatch[1]);
                } catch {
                    return json(
                        res,
                        400,
                        { success: false, error: 'Mã sản phẩm không hợp lệ.' },
                        corsHeaders
                    );
                }
                if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(codeParam)) {
                    return json(
                        res,
                        404,
                        { success: false, error: 'Không tìm thấy sản phẩm.' },
                        corsHeaders
                    );
                }
                const { tokenRecord } = openApi.authenticateOpenRequest(req);
                const result = openApi.getOpenProductByCode(tokenRecord, codeParam);
                return json(res, 200, result, corsHeaders);
            }

            if (url.pathname === '/api/v1/open/products') {
                const { tokenRecord } = openApi.authenticateOpenRequest(req);
                const result = openApi.getOpenProducts(tokenRecord, url.searchParams);
                return json(res, 200, result, corsHeaders);
            }

            return json(
                res,
                404,
                { success: false, error: 'Endpoint Open API không tồn tại.' },
                corsHeaders
            );
        }

        if (url.pathname.startsWith('/api/')) {
            // Webhook Viettel Post: không cần phiên đăng nhập, xác thực bằng secret riêng.
            if (url.pathname === '/api/vtp/webhook' && req.method === 'POST') {
                // Viettel Post yêu cầu luôn nhận HTTP 200; nút "Kiểm tra kết nối" của hãng có thể
                // gửi body rỗng/không phải JSON, nên không để lỗi đọc body thành 400/415.
                let input;
                try {
                    input = await body(req);
                } catch {
                    return json(res, 200, {
                        success: true,
                        recorded: false,
                        reason: 'no_payload'
                    });
                }
                // Secret có thể lưu qua giao diện (đã mã hóa trong app_meta) hoặc biến môi trường.
                let secret = '';
                try {
                    const vtpConfig = require('./viettelpost-config');
                    secret = vtpConfig.getResolvedConfig().webhookSecret || '';
                } catch {}
                if (!secret) secret = process.env.NKIOT_VTP_WEBHOOK_SECRET || '';
                if (!secret)
                    return json(res, 200, {
                        success: true,
                        recorded: false,
                        reason: 'webhook_not_configured'
                    });
                // Theo tài liệu Viettel Post, secret do cửa hàng cung cấp được gửi trong trường
                // TOKEN của body; Authorization là token JWT của hãng. Vẫn chấp nhận header
                // Authorization cho môi trường tự đối soát nội bộ.
                const sent =
                    (typeof input?.TOKEN === 'string' && input.TOKEN) ||
                    String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
                const sentBuf = Buffer.from(String(sent));
                const expectedBuf = Buffer.from(secret);
                if (
                    sentBuf.length !== expectedBuf.length ||
                    !crypto.timingSafeEqual(sentBuf, expectedBuf)
                ) {
                    // Trả 200 để hãng không retry; ghi rõ lý do không hợp lệ.
                    return json(res, 200, {
                        success: true,
                        recorded: false,
                        reason: 'invalid_secret'
                    });
                }
                const delivery = require('./delivery-service');
                let outcome;
                try {
                    outcome = delivery.handleWebhook(input);
                } catch (error) {
                    // Luôn trả 200 để Viettel Post không retry với sự kiện lỗi/trùng/không rõ.
                    console.error('Webhook Viettel Post lỗi:', error.message);
                    return json(res, 200, {
                        success: true,
                        recorded: false,
                        reason: 'bad_payload'
                    });
                }
                return json(res, 200, { success: true, ...outcome });
            }
            if (req.headers.origin) {
                let origin;
                try {
                    origin = new URL(req.headers.origin);
                } catch {
                    throw Object.assign(new Error('Origin không hợp lệ.'), { status: 403 });
                }
                if (origin.host !== req.headers.host)
                    throw Object.assign(new Error('Không cho phép truy cập từ website khác.'), {
                        status: 403
                    });
            }
            if (req.method === 'OPTIONS')
                return json(res, 405, { success: false, error: 'Method not allowed' });
            if (url.pathname === '/api/login' && req.method === 'POST') {
                const input = await body(req),
                    key = req.socket?.remoteAddress || 'local',
                    time = Date.now();
                for (const [ip, value] of attempts) if (value.until < time) attempts.delete(ip);
                const throttle = attempts.get(key) || { count: 0, until: time + 15 * 60 * 1000 };
                if (throttle.count >= 10)
                    return json(res, 429, {
                        success: false,
                        error: 'Đăng nhập sai nhiều lần. Vui lòng thử lại sau.'
                    });
                const tenantStatus = db
                    .getDb()
                    .prepare("SELECT value FROM app_meta WHERE key='tenant_status'")
                    .get()?.value;
                if (tenantStatus === 'suspended') {
                    return json(res, 403, {
                        success: false,
                        error: 'Cửa hàng đã bị tạm ngưng hoạt động. Vui lòng liên hệ quản trị viên.'
                    });
                }
                const name =
                    typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
                const user = db
                    .readSnapshot()
                    .users.find((u) => u.username.toLowerCase() === name || u.phone === name);
                if (
                    !user ||
                    user.status !== 'active' ||
                    !auth.verifyPassword(input.password, user.password)
                ) {
                    throttle.count++;
                    attempts.set(key, throttle);
                    return json(res, 401, {
                        success: false,
                        error: 'Tên đăng nhập hoặc mật khẩu không đúng.'
                    });
                }
                attempts.delete(key);
                db.deleteExpiredSessions(time);
                const token = crypto.randomBytes(32).toString('hex'),
                    csrfToken = crypto.randomBytes(32).toString('base64url');
                const session = {
                    userId: user.id,
                    password: user.password,
                    csrfToken,
                    expires: time + (input.remember ? 7 * 86400000 : 12 * 3600000)
                };
                sessions.set(token, session);
                db.writeSession({ token, ...session });
                setCookie(
                    res,
                    token,
                    !!input.remember,
                    !!req.socket?.encrypted || process.env.MINIKIOT_SECURE_COOKIE === '1'
                );
                return json(res, 200, { ...view(user), csrfToken });
            }
            const user = sessionUser(req);
            if (!user) return json(res, 401, { success: false, error: 'Vui lòng đăng nhập.' });
            const csrfToken = loadSession(cookie(req)).csrfToken;
            if (!['GET', 'HEAD'].includes(req.method)) {
                const sent = Buffer.from(
                        String(req.headers['x-nkiot-csrf'] || req.headers['x-minikiot-csrf'] || '')
                    ),
                    expected = Buffer.from(csrfToken);
                if (sent.length !== expected.length || !crypto.timingSafeEqual(sent, expected))
                    return json(res, 403, {
                        success: false,
                        error: 'Mã bảo vệ phiên không hợp lệ. Hãy tải lại trang.'
                    });
            }
            if (url.pathname === '/api/invoices' && req.method === 'GET')
                return json(
                    res,
                    200,
                    require('./invoice-reader').listInvoices(user, url.searchParams)
                );
            if (url.pathname === '/api/data' && req.method === 'GET')
                return json(res, 200, { ...view(user), csrfToken });
            if (url.pathname.startsWith('/api/requests/') && req.method === 'GET') {
                const requestId = url.pathname.slice('/api/requests/'.length);
                const record = db
                    .getDb()
                    .prepare('SELECT result FROM processed_requests WHERE id=? AND userId=?')
                    .get(requestId, user.id);
                if (!record)
                    return json(res, 409, {
                        success: false,
                        error: 'Chưa tìm thấy kết quả giao dịch nhân viên. Hãy kiểm tra danh sách trước khi lưu lại.'
                    });
                return json(res, 200, {
                    ...view(user),
                    result: JSON.parse(record.result),
                    replayed: true
                });
            }
            if (url.pathname === '/api/logout' && req.method === 'POST') {
                await body(req);
                sessions.delete(cookie(req));
                db.deleteSession(cookie(req));
                res.setHeader(
                    'Set-Cookie',
                    'minikiot_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'
                );
                return json(res, 200, { success: true });
            }
            if (url.pathname === '/api/password' && req.method === 'POST') {
                const input = await body(req);
                const fresh = sessionUser(req);
                if (!fresh)
                    return json(res, 401, {
                        success: false,
                        error: 'Phiên đăng nhập đã hết hiệu lực.'
                    });
                if (!auth.verifyPassword(input.current, fresh.password))
                    return json(res, 422, {
                        success: false,
                        error: 'Mật khẩu hiện tại không đúng.'
                    });
                if (
                    typeof input.next !== 'string' ||
                    input.next.length < 8 ||
                    input.next.length > 1024
                )
                    return json(res, 422, {
                        success: false,
                        error: 'Mật khẩu mới phải từ 8 đến 1024 ký tự.'
                    });
                const database = db.getDb();
                database.exec('BEGIN IMMEDIATE');
                try {
                    database
                        .prepare('UPDATE users SET password=? WHERE id=?')
                        .run(auth.hashPassword(input.next), fresh.id);
                    database
                        .prepare(
                            "UPDATE app_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'"
                        )
                        .run();
                    database.exec('COMMIT');
                } catch (error) {
                    database.exec('ROLLBACK');
                    throw error;
                }
                for (const [token, s] of sessions) if (s.userId === user.id) sessions.delete(token);
                db.deleteSessionsForUser(user.id);
                return json(res, 200, {
                    success: true,
                    message: 'Đã đổi mật khẩu. Vui lòng đăng nhập lại.'
                });
            }
            if (url.pathname === '/api/command' && req.method === 'POST') {
                const envelope = await body(req),
                    fresh = sessionUser(req);
                if (!fresh)
                    return json(res, 401, {
                        success: false,
                        error: 'Phiên đăng nhập đã hết hiệu lực.'
                    });
                // Client holding the view at revision `base` can take only the changed rows.
                // `prior` is that view, rebuilt from the snapshot (same tick, before the write).
                const base = Number(req.headers['x-nkiot-base'] ?? req.headers['x-minikiot-base']);
                const priorRevision = application.revision();
                const prior =
                    base === priorRevision && envelope?.revision === base
                        ? application.project(db.readSnapshot(), fresh)
                        : null;
                const result = application.transact(fresh, envelope);
                if (!result.replayed) {
                    hub.scheduleSync();
                    if (envelope?.type === 'delivery' || envelope?.type === 'deliverySale') {
                        require('./delivery-service').scheduleDelivery(0);
                    }
                }
                const next = view(fresh);
                // transact checks revision in its own write transaction, so a fresh (not replayed)
                // commit at base+1 was applied on top of exactly the state `prior` was built from.
                const delta =
                    prior && !result.replayed && next.revision === base + 1
                        ? application.diffViews(prior, next.data)
                        : null;
                if (!delta) return json(res, 200, { ...next, ...result });
                const { data, ...rest } = next;
                return json(res, 200, { ...rest, ...result, base, delta });
            }
            if (url.pathname === '/api/partner-catalog' && req.method === 'GET') {
                auth.requirePermission(user, 'products');
                try {
                    const catalog = await hub.partnerCatalog({
                        refresh: url.searchParams.get('refresh') === '1'
                    });
                    return json(res, 200, { success: true, ...catalog, ...hub.status() });
                } catch (error) {
                    return json(res, 502, {
                        success: false,
                        error: 'Không kết nối được kho chung đối tác: ' + error.message
                    });
                }
            }
            if (url.pathname === '/api/hub/partners' && req.method === 'GET') {
                auth.requirePermission(user, 'products');
                try {
                    const data = await hub.listPartners();
                    return json(res, 200, { success: true, ...data });
                } catch (error) {
                    return json(res, error.status || 502, {
                        success: false,
                        error: error.message
                    });
                }
            }
            if (url.pathname === '/api/hub/partners/tokens' && req.method === 'POST') {
                auth.requirePermission(user, 'products');
                try {
                    const data = await hub.createInviteToken();
                    return json(res, 200, { success: true, ...data });
                } catch (error) {
                    return json(res, error.status || 502, {
                        success: false,
                        error: error.message
                    });
                }
            }
            if (url.pathname === '/api/hub/partners/tokens' && req.method === 'GET') {
                auth.requirePermission(user, 'products');
                try {
                    const data = await hub.listInviteTokens();
                    return json(res, 200, { success: true, ...data });
                } catch (error) {
                    return json(res, error.status || 502, {
                        success: false,
                        error: error.message
                    });
                }
            }
            if (url.pathname === '/api/hub/partners/redeem' && req.method === 'POST') {
                auth.requirePermission(user, 'products');
                try {
                    const input = await body(req);
                    const data = await hub.redeemInviteToken(input.token);
                    return json(res, 200, { success: true, ...data });
                } catch (error) {
                    return json(res, error.status || 502, {
                        success: false,
                        error: error.message
                    });
                }
            }
            if (url.pathname === '/api/hub/partners/unlink' && req.method === 'POST') {
                auth.requirePermission(user, 'products');
                try {
                    const input = await body(req);
                    const data = await hub.unlinkPartner(input.partnerId);
                    return json(res, 200, { success: true, ...data });
                } catch (error) {
                    return json(res, error.status || 502, {
                        success: false,
                        error: error.message
                    });
                }
            }
            if (url.pathname === '/api/hub/partners/tokens/revoke' && req.method === 'POST') {
                auth.requirePermission(user, 'products');
                try {
                    const input = await body(req);
                    const data = await hub.revokeInviteToken(input.token);
                    return json(res, 200, { success: true, ...data });
                } catch (error) {
                    return json(res, error.status || 502, {
                        success: false,
                        error: error.message
                    });
                }
            }
            if (url.pathname === '/api/hub/partners/tokens/delete' && req.method === 'POST') {
                auth.requirePermission(user, 'products');
                try {
                    const input = await body(req);
                    const data = await hub.deleteInviteToken(input.token);
                    return json(res, 200, { success: true, ...data });
                } catch (error) {
                    return json(res, error.status || 502, {
                        success: false,
                        error: error.message
                    });
                }
            }
            if (url.pathname === '/api/upload-media' && req.method === 'POST') {
                auth.requirePermission(user, 'products');
                const input = await body(req);
                if (!input.data || typeof input.data !== 'string')
                    throw Object.assign(new Error('Dữ liệu tệp không hợp lệ.'), { status: 400 });
                const match = input.data.match(/^data:([a-zA-Z0-9/+-]+);base64,(.+)$/);
                const mime = (match ? match[1] : input.type || '').toLowerCase();
                const base64Data = match ? match[2] : input.data;
                const ALLOWED_MIME = {
                    'image/jpeg': '.jpg',
                    'image/png': '.png',
                    'image/webp': '.webp',
                    'image/gif': '.gif',
                    'video/mp4': '.mp4',
                    'video/webm': '.webm',
                    'video/quicktime': '.mov'
                };
                if (!ALLOWED_MIME[mime])
                    throw Object.assign(
                        new Error(
                            'Định dạng tệp không được hỗ trợ (chỉ nhận ảnh JPG, PNG, WEBP, GIF hoặc video MP4, WEBM).'
                        ),
                        { status: 400 }
                    );
                const ext = ALLOWED_MIME[mime];
                const randomName = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}${ext}`;
                const targetPath = path.join(UPLOADS_DIR, randomName);
                const buffer = Buffer.from(base64Data, 'base64');
                if (buffer.length > 10 * 1024 * 1024)
                    throw Object.assign(new Error('Dung lượng tệp vượt quá 10MB.'), {
                        status: 413
                    });
                const isJpeg =
                    buffer.length > 3 &&
                    buffer[0] === 0xff &&
                    buffer[1] === 0xd8 &&
                    buffer[2] === 0xff;
                const isPng =
                    buffer.length > 8 &&
                    buffer[0] === 0x89 &&
                    buffer[1] === 0x50 &&
                    buffer[2] === 0x4e &&
                    buffer[3] === 0x47;
                const isGif =
                    buffer.length > 4 &&
                    buffer[0] === 0x47 &&
                    buffer[1] === 0x49 &&
                    buffer[2] === 0x46 &&
                    buffer[3] === 0x38;
                const isWebp =
                    buffer.length > 12 &&
                    buffer.toString('ascii', 0, 4) === 'RIFF' &&
                    buffer.toString('ascii', 8, 12) === 'WEBP';
                const isMp4OrMov =
                    buffer.length > 12 &&
                    (buffer.toString('ascii', 4, 8) === 'ftyp' ||
                        buffer.toString('ascii', 4, 8) === 'moov');
                const isWebm =
                    buffer.length > 4 &&
                    buffer[0] === 0x1a &&
                    buffer[1] === 0x45 &&
                    buffer[2] === 0xdf &&
                    buffer[3] === 0xa3;

                const validMagic =
                    (mime === 'image/jpeg' && isJpeg) ||
                    (mime === 'image/png' && isPng) ||
                    (mime === 'image/gif' && isGif) ||
                    (mime === 'image/webp' && isWebp) ||
                    ((mime === 'video/mp4' || mime === 'video/quicktime') && isMp4OrMov) ||
                    (mime === 'video/webm' && isWebm);

                if (!validMagic)
                    throw Object.assign(
                        new Error('Nội dung tệp không khớp với định dạng được khai báo.'),
                        { status: 400 }
                    );
                await fs.promises.writeFile(targetPath, buffer);
                return json(res, 200, {
                    success: true,
                    url: `/uploads/${randomName}`,
                    filename: randomName,
                    size: buffer.length,
                    mime
                });
            }
            if (url.pathname === '/api/status' && req.method === 'GET') {
                auth.requirePermission(user, 'settings');
                const { dbPath, ...stats } = db.getStats();
                return json(res, 200, { success: true, stats, hub: hub.status() });
            }
            if (url.pathname === '/api/catalogs' && req.method === 'GET') {
                auth.requirePermission(user, 'products');
                const result = require('./catalog-service').listCatalogs(user, url.searchParams);
                return json(res, 200, { success: true, ...result });
            }
            if (url.pathname === '/api/catalogs' && req.method === 'POST') {
                auth.requirePermission(user, 'products');
                const input = await body(req);
                const catalog = require('./catalog-service').createCatalog(user, input);
                return json(res, 201, { success: true, catalog });
            }
            const catalogActionMatch =
                /^\/api\/catalogs\/([A-Za-z0-9_-]+)(?:\/(revoke|extend|duplicate))?$/.exec(
                    url.pathname
                );
            if (catalogActionMatch) {
                auth.requirePermission(user, 'products');
                const [, catalogId, action] = catalogActionMatch;
                const catalogService = require('./catalog-service');
                if (!action && req.method === 'GET') {
                    return json(res, 200, {
                        success: true,
                        catalog: catalogService.getCatalogForUser(user, catalogId)
                    });
                }
                if (action === 'revoke' && req.method === 'POST') {
                    return json(res, 200, {
                        success: true,
                        catalog: catalogService.revokeCatalog(user, catalogId)
                    });
                }
                if (action === 'extend' && req.method === 'POST') {
                    const input = await body(req);
                    return json(res, 200, {
                        success: true,
                        catalog: catalogService.extendCatalog(user, catalogId, input)
                    });
                }
                if (action === 'duplicate' && req.method === 'POST') {
                    const input = await body(req);
                    return json(res, 201, {
                        success: true,
                        catalog: catalogService.duplicateCatalog(user, catalogId, input)
                    });
                }
            }
            if (url.pathname === '/api/tokens' && req.method === 'GET') {
                auth.requirePermission(user, 'settings');
                if (user.role !== 'admin')
                    throw Object.assign(new Error('Chỉ quản trị viên được quản lý token.'), {
                        status: 403
                    });
                const tokens = require('./open-api-service').listTokens(user);
                return json(res, 200, { success: true, tokens });
            }
            if (url.pathname === '/api/tokens' && req.method === 'POST') {
                auth.requirePermission(user, 'settings');
                if (user.role !== 'admin')
                    throw Object.assign(new Error('Chỉ quản trị viên được quản lý token.'), {
                        status: 403
                    });
                const input = await body(req);
                const token = require('./open-api-service').createToken(user, input);
                return json(res, 201, { success: true, token });
            }
            if (url.pathname === '/api/vtp/config') {
                auth.requirePermission(user, 'settings');
                if (user.role !== 'admin')
                    throw Object.assign(
                        new Error('Chỉ quản trị viên được cấu hình Viettel Post.'),
                        {
                            status: 403
                        }
                    );
                const vtpConfig = require('./viettelpost-config');
                if (req.method === 'GET')
                    return json(res, 200, { success: true, config: vtpConfig.publicStatus() });
                if (req.method === 'POST') {
                    const input = await body(req);
                    return json(res, 200, { success: true, config: vtpConfig.saveConfig(input) });
                }
            }
            if (url.pathname === '/api/vtp/services' && req.method === 'POST') {
                auth.requirePermission(user, 'shipping');
                const input = await body(req);
                const delivery = require('./delivery-service');
                try {
                    const services = await delivery.listServices(input);
                    return json(res, 200, { success: true, services });
                } catch (error) {
                    // Trả 200 kèm danh sách rỗng + lý do để POS hiển thị, không chặn bán hàng.
                    return json(res, 200, {
                        success: true,
                        services: [],
                        warning: error.message || 'Không lấy được danh sách dịch vụ.'
                    });
                }
            }
            if (url.pathname === '/api/vtp/label' && req.method === 'POST') {
                auth.requirePermission(user, 'shipping');
                const input = await body(req);
                const id = String(input?.id || '').slice(0, 200);
                if (!id) throw Object.assign(new Error('Thiếu mã đơn giao hàng.'), { status: 400 });
                try {
                    const label = await require('./delivery-service').labelUrl(id, {
                        size: String(input?.size || 'A5').slice(0, 10),
                        showPostage: input?.showPostage ? 1 : 0
                    });
                    return json(res, 200, { success: true, ...label });
                } catch (error) {
                    return json(res, error.status || 502, {
                        success: false,
                        error: error.message
                    });
                }
            }
            if (url.pathname === '/api/vtp/action' && req.method === 'POST') {
                auth.requirePermission(user, 'shipping');
                const input = await body(req);
                const id = String(input?.id || '').slice(0, 200);
                const action = String(input?.action || '').slice(0, 30);
                if (!id || !action)
                    throw Object.assign(new Error('Thiếu đơn hoặc thao tác vận đơn.'), {
                        status: 400
                    });
                const outcome = require('./delivery-service').enqueueOrderAction(
                    id,
                    action,
                    String(input?.note || '').slice(0, 200)
                );
                if (!outcome.ok) {
                    const messages = {
                        unknown_action: 'Thao tác vận đơn không hợp lệ.',
                        unknown_order: 'Không tìm thấy vận đơn.',
                        self_delivery: 'Đơn tự giao không dùng thao tác của Viettel Post.',
                        no_shipment_code: 'Đơn chưa có mã vận đơn Viettel Post.',
                        not_cancellable: 'Chỉ hủy được đơn hãng chưa lấy hàng.',
                        not_returning: 'Chỉ áp dụng cho đơn đang chờ chuyển hoàn (505).',
                        not_cancelled: 'Chỉ xóa được đơn đã hủy.',
                        action_pending: 'Đang có thao tác khác chờ xử lý cho đơn này.'
                    };
                    return json(res, 409, {
                        success: false,
                        error: messages[outcome.reason] || 'Không thực hiện được thao tác.'
                    });
                }
                require('./delivery-service').scheduleDelivery(0);
                return json(res, 200, { success: true, queued: true });
            }
            if (url.pathname === '/api/vtp/requeue' && req.method === 'POST') {
                auth.requirePermission(user, 'shipping');
                const input = await body(req);
                const id = String(input?.id || '').slice(0, 200);
                if (!id) throw Object.assign(new Error('Thiếu mã đơn giao hàng.'), { status: 400 });
                const delivery = require('./delivery-service');
                const outcome = delivery.requeueCreateOrderTask(id);
                if (!outcome.ok) return json(res, 409, { success: false, error: outcome.reason });
                delivery.scheduleDelivery(0);
                return json(res, 200, { success: true, requeued: true });
            }
            const tokenActionMatch = /^\/api\/tokens\/([A-Za-z0-9_-]+)(?:\/revoke)?$/.exec(
                url.pathname
            );
            if (tokenActionMatch) {
                auth.requirePermission(user, 'settings');
                if (user.role !== 'admin')
                    throw Object.assign(new Error('Chỉ quản trị viên được quản lý token.'), {
                        status: 403
                    });
                const [, tokenId] = tokenActionMatch;
                const openApiService = require('./open-api-service');
                if (url.pathname.endsWith('/revoke') && req.method === 'POST') {
                    return json(res, 200, openApiService.revokeToken(user, tokenId));
                }
                if (req.method === 'DELETE') {
                    return json(res, 200, openApiService.deleteToken(user, tokenId));
                }
            }
            // Snapshot replacement/reset are intentionally not public API operations.
            return json(res, 404, { success: false, error: 'API không tồn tại.' });
        }
        if (!['GET', 'HEAD'].includes(req.method))
            return json(res, 405, { success: false, error: 'Method not allowed' });
        const publicCatalogMatch = /^\/catalog\/([A-Za-z0-9_-]+)(\/data)?$/.exec(url.pathname);
        if (publicCatalogMatch) {
            const [, token, isData] = publicCatalogMatch;
            const catalogService = require('./catalog-service');
            const lookup = catalogService.getPublicCatalogByToken(token);
            const statusCode =
                lookup.state === 'active' ? 200 : lookup.state === 'not_found' ? 404 : 410;
            if (isData) {
                return json(res, statusCode, {
                    success: lookup.state === 'active',
                    state: lookup.state,
                    catalog: lookup.catalog
                });
            }
            const html = Buffer.from(catalogService.renderPublicCatalogHtml(lookup), 'utf8');
            res.writeHead(statusCode, {
                ...securityHeaders(),
                'Content-Type': 'text/html; charset=utf-8',
                'Content-Length': html.length,
                'Cache-Control': 'private, no-store',
                'X-Robots-Tag': 'noindex, nofollow, noarchive',
                'Referrer-Policy': 'no-referrer'
            });
            return res.end(req.method === 'HEAD' ? undefined : html);
        }
        const catalogMediaMatch = /^\/catalog-media\/([A-Za-z0-9_-]+)\/([a-f0-9]{24})$/i.exec(
            url.pathname
        );
        if (catalogMediaMatch) {
            const [, token, mediaId] = catalogMediaMatch;
            const resolved = require('./catalog-service').resolveCatalogMediaFile(
                token,
                mediaId,
                UPLOADS_DIR
            );
            if (!resolved)
                return json(res, 404, { success: false, error: 'Không tìm thấy ảnh catalog.' });
            try {
                const ext = path.extname(resolved.safePath).toLowerCase();
                const mimeTypes = {
                    '.jpg': 'image/jpeg',
                    '.jpeg': 'image/jpeg',
                    '.png': 'image/png',
                    '.webp': 'image/webp',
                    '.gif': 'image/gif'
                };
                const contentType = mimeTypes[ext];
                if (!contentType)
                    return json(res, 404, { success: false, error: 'Định dạng ảnh không hợp lệ.' });
                const isDownload = url.searchParams.get('download') === '1';
                const customName = String(url.searchParams.get('name') || '')
                    .replace(/[^a-zA-Z0-9_-]/g, '-')
                    .replace(/-+/g, '-')
                    .replace(/^-|-$/g, '')
                    .slice(0, 60);
                const downloadFilename = `${customName || `catalog-${mediaId.slice(0, 8)}`}${ext}`;
                const handle = await fs.promises.open(
                    resolved.safePath,
                    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
                );
                let stat;
                try {
                    stat = await handle.stat();
                    if (!stat.isFile()) {
                        await handle.close();
                        return json(res, 404, {
                            success: false,
                            error: 'Không tìm thấy ảnh catalog.'
                        });
                    }
                } catch (error) {
                    await handle.close();
                    throw error;
                }
                res.writeHead(200, {
                    ...securityHeaders(),
                    'Content-Type': contentType,
                    'Content-Length': stat.size,
                    'Cache-Control': 'private, no-store',
                    'X-Robots-Tag': 'noindex, nofollow',
                    'Referrer-Policy': 'no-referrer',
                    ...(isDownload
                        ? {
                              'Content-Disposition': `attachment; filename="${downloadFilename}"`
                          }
                        : {})
                });
                if (req.method === 'HEAD') {
                    await handle.close();
                    return res.end();
                }
                const stream = handle.createReadStream();
                stream.on('error', () => res.destroy());
                res.on('close', () => stream.destroy());
                return stream.pipe(res);
            } catch {
                return json(res, 404, { success: false, error: 'Không tìm thấy ảnh catalog.' });
            }
        }
        if (url.pathname.startsWith('/hub-media/')) {
            // Proxy ảnh đối tác: browser không có API key Hub, server tenant giữ key.
            const viewer = sessionUser(req);
            if (!viewer) return json(res, 401, { success: false, error: 'Vui lòng đăng nhập.' });
            auth.requirePermission(viewer, 'products');
            const id = url.pathname.slice('/hub-media/'.length);
            if (!/^[a-f0-9]{32}$/.test(id))
                return json(res, 403, { success: false, error: 'Truy cập không hợp lệ.' });
            try {
                const media = await hub.fetchMedia(id);
                res.writeHead(200, {
                    ...securityHeaders(),
                    'Content-Type': media.mime,
                    'Content-Length': media.buffer.length,
                    'Cache-Control': 'private, no-store',
                    'X-Content-Type-Options': 'nosniff'
                });
                return res.end(req.method === 'HEAD' ? undefined : media.buffer);
            } catch (error) {
                return json(res, error.status === 404 ? 404 : 502, {
                    success: false,
                    error: 'Không tải được ảnh từ Hub.'
                });
            }
        }
        if (url.pathname.startsWith('/uploads/')) {
            if (!sessionUser(req))
                return json(res, 401, { success: false, error: 'Vui lòng đăng nhập.' });
            const filename = path.basename(url.pathname);
            const safePath = path.resolve(UPLOADS_DIR, filename);
            if (
                !/^\/uploads\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(url.pathname) ||
                path.dirname(safePath) !== path.resolve(UPLOADS_DIR)
            )
                return json(res, 403, { success: false, error: 'Truy cập không hợp lệ.' });
            try {
                const stat = await fs.promises.lstat(safePath);
                if (!stat.isFile())
                    return json(res, 404, { success: false, error: 'Không tìm thấy tệp.' });
                const ext = path.extname(safePath).toLowerCase();
                const mimeTypes = {
                    '.jpg': 'image/jpeg',
                    '.jpeg': 'image/jpeg',
                    '.png': 'image/png',
                    '.webp': 'image/webp',
                    '.gif': 'image/gif',
                    '.mp4': 'video/mp4',
                    '.webm': 'video/webm',
                    '.mov': 'video/quicktime'
                };
                const contentType = mimeTypes[ext] || 'application/octet-stream';
                res.writeHead(200, {
                    ...securityHeaders(),
                    'Content-Type': contentType,
                    'Content-Length': stat.size,
                    'Cache-Control': 'private, no-store'
                });
                if (req.method === 'HEAD') return res.end();
                const stream = fs.createReadStream(safePath);
                stream.on('error', () => res.destroy());
                res.on('close', () => stream.destroy());
                return stream.pipe(res);
            } catch {
                return json(res, 404, { success: false, error: 'Không tìm thấy tệp.' });
            }
        }
        const file = Object.hasOwn(ASSETS, url.pathname) ? ASSETS[url.pathname] : null;
        if (!file) return json(res, 404, { success: false, error: 'Không tìm thấy tài nguyên.' });
        const asset = await loadAsset(file);
        const gzip = acceptsGzip.has(res);
        const contentTypes = {
            '.html': 'text/html; charset=utf-8',
            '.js': 'text/javascript; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.woff2': 'font/woff2'
        };
        const headers = {
            ...securityHeaders(),
            'Content-Type': contentTypes[path.extname(file)] || 'application/octet-stream',
            'Cache-Control': 'no-cache',
            ETag: asset.etag,
            Vary: 'Accept-Encoding'
        };
        if (req.headers['if-none-match'] === asset.etag) {
            res.writeHead(304, headers);
            return res.end();
        }
        const content = gzip ? asset.gzip : asset.raw;
        if (gzip) headers['Content-Encoding'] = 'gzip';
        headers['Content-Length'] = content.length;
        res.writeHead(200, headers);
        res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
        if (!res.headersSent)
            await json(res, error.status || 500, {
                success: false,
                error: error.status
                    ? error.message
                    : 'Không nhận được kết quả hoàn tất. Hãy đối soát giao dịch chờ trước khi thử lại.'
            });
        else res.end();
        if (!error.status) console.error(error);
    }
}
function createServer() {
    db.initDb();
    hub.scheduleSync();
    require('./delivery-service').scheduleDelivery();
    return http.createServer(handler);
}
if (require.main === module) {
    const server = createServer();
    let stopping = false;
    const shutdown = (signal) => {
        if (stopping) return;
        stopping = true;
        console.log(`NKiot nhận ${signal}; đang dừng an toàn.`);
        hub.stopSync();
        server.close((error) => {
            if (error) console.error(error);
            db.closeDb();
            process.exitCode = error ? 1 : 0;
        });
        setTimeout(() => process.exit(1), 10000).unref();
    };
    server.listen(process.env.PORT || 3000, process.env.HOST || '0.0.0.0', () =>
        console.log(`NKiot: http://localhost:${process.env.PORT || 3000}`)
    );
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => shutdown(signal));
}
module.exports = { handler, createServer, __resetSessionCacheForTest: () => sessions.clear() };
