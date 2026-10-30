'use strict';
// Local super-admin portal: provisions seller POS databases/config. Bound to loopback only.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { hashPassword, verifyPassword } = require('./security');
const { createProvisioner } = require('./admin-provision');
const { securityHeaders } = require('./security-headers');

const ASSETS = {
    '/': ['admin.html', 'text/html; charset=utf-8'],
    '/admin.js': ['admin.js', 'text/javascript; charset=utf-8'],
    '/admin.css': ['admin.css', 'text/css; charset=utf-8'],
    '/assets/inter.css': ['public/inter.css', 'text/css; charset=utf-8'],
    '/assets/inter-vietnamese-wght-normal.woff2': [
        'public/inter-vietnamese-wght-normal.woff2',
        'font/woff2'
    ],
    '/assets/inter-latin-ext-wght-normal.woff2': [
        'public/inter-latin-ext-wght-normal.woff2',
        'font/woff2'
    ],
    '/assets/inter-latin-wght-normal.woff2': ['public/inter-latin-wght-normal.woff2', 'font/woff2']
};
const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
};
function send(res, status, body) {
    res.writeHead(status, {
        ...securityHeaders({ enforceCsp: true }),
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(body));
}
async function readBody(req) {
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))
        fail('Yêu cầu JSON.', 415);
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
        size += chunk.length;
        if (size > 16384) fail('Dữ liệu quá lớn.', 413);
        chunks.push(chunk);
    }
    try {
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('object');
        return data;
    } catch {
        fail('JSON không hợp lệ.');
    }
}
function sessionToken(req) {
    return (req.headers.cookie || '')
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('nkiot_admin_session='))
        ?.slice('nkiot_admin_session='.length);
}
function createAdminServer({ dataDir, password, hubUrl } = {}) {
    if (typeof password !== 'string' || password.length < 8 || password.length > 1024)
        throw new Error('NKIOT_SUPER_ADMIN_PASSWORD phải từ 8 đến 1024 ký tự.');
    const provisioner = createProvisioner({ dataDir, hubUrl });
    const passwordHash = hashPassword(password);
    const sessions = new Map();
    const attempts = new Map();
    const handler = async (req, res) => {
        try {
            if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(req.headers.host || ''))
                fail('Host không hợp lệ.', 403);
            const url = new URL(req.url, 'http://localhost');
            if (!url.pathname.startsWith('/api/')) return staticAsset(req, res, url);
            if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)
                fail('Origin không hợp lệ.', 403);
            const now = Date.now();
            if (url.pathname === '/api/login' && req.method === 'POST') {
                const ip = req.socket.remoteAddress;
                const prior = attempts.get(ip);
                const attempt =
                    prior && prior.until > now ? prior : { count: 0, until: now + 15 * 60000 };
                if (attempt.count >= 10)
                    fail('Đăng nhập sai nhiều lần. Vui lòng thử lại sau.', 429);
                const data = await readBody(req);
                if (!verifyPassword(data.password, passwordHash)) {
                    attempt.count++;
                    attempts.set(ip, attempt);
                    fail('Mật khẩu không đúng.', 401);
                }
                attempts.delete(ip);
                for (const [key, session] of sessions)
                    if (session.expires <= now) sessions.delete(key);
                const id = crypto.randomBytes(32).toString('hex');
                const csrf = crypto.randomBytes(32).toString('base64url');
                sessions.set(id, { csrf, expires: now + 12 * 3600000 });
                res.setHeader(
                    'Set-Cookie',
                    `nkiot_admin_session=${id}; HttpOnly; SameSite=Strict; Path=/`
                );
                return send(res, 200, { success: true, csrf });
            }
            const token = sessionToken(req);
            const session = sessions.get(token);
            if (!session || session.expires <= now) {
                sessions.delete(token);
                fail('Vui lòng đăng nhập.', 401);
            }
            if (!['GET', 'HEAD'].includes(req.method)) {
                const sent = Buffer.from(String(req.headers['x-nkiot-admin-csrf'] || ''));
                const expected = Buffer.from(session.csrf);
                if (sent.length !== expected.length || !crypto.timingSafeEqual(sent, expected))
                    fail('Mã bảo vệ phiên không hợp lệ.', 403);
            }
            if (url.pathname === '/api/session' && req.method === 'GET')
                return send(res, 200, { success: true, csrf: session.csrf });
            if (url.pathname === '/api/tenants' && req.method === 'GET')
                return send(res, 200, {
                    success: true,
                    tenants: provisioner.list().map((tenant) => ({
                        ...tenant,
                        running: provisioner.isRunning(tenant.id)
                    })),
                    partners: provisioner.partners()
                });
            if (url.pathname === '/api/tenants' && req.method === 'POST')
                return send(res, 201, {
                    success: true,
                    tenant: await provisioner.create(await readBody(req))
                });
            if (url.pathname === '/api/tenants/start' && req.method === 'POST') {
                const { id } = await readBody(req);
                await provisioner.start(id);
                return send(res, 200, { success: true });
            }
            if (url.pathname === '/api/tenants/stop' && req.method === 'POST') {
                const { id } = await readBody(req);
                await provisioner.stop(id);
                return send(res, 200, { success: true });
            }
            if (url.pathname === '/api/tenants/status' && req.method === 'POST') {
                const { id, status } = await readBody(req);
                const result = await provisioner.setStatus(id, status);
                return send(res, 200, result);
            }
            if (url.pathname === '/api/tenants/reset-password' && req.method === 'POST') {
                const { id, password } = await readBody(req);
                const result = provisioner.resetPassword(id, password);
                return send(res, 200, result);
            }
            if (url.pathname === '/api/tenants/update' && req.method === 'POST') {
                const data = await readBody(req);
                const result = provisioner.update(data.id, data);
                return send(res, 200, { success: true, tenant: result });
            }
            if (url.pathname === '/api/tenants/backup' && req.method === 'GET') {
                const id = url.searchParams.get('id');
                if (!id) fail('Thiếu mã tenant.', 400);
                const backupPath = provisioner.backupDb(id);
                const filename = path.basename(backupPath);
                const stream = fs.createReadStream(backupPath);
                res.writeHead(200, {
                    ...securityHeaders(),
                    'Content-Type': 'application/x-sqlite3',
                    'Content-Disposition': `attachment; filename="${filename}"`
                });
                let cleaned = false;
                const cleanup = () => {
                    if (cleaned) return;
                    cleaned = true;
                    try {
                        if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
                    } catch {}
                };
                stream.on('error', cleanup);
                res.on('finish', cleanup);
                res.on('close', cleanup);
                stream.pipe(res);
                return;
            }
            if (url.pathname === '/api/partners' && req.method === 'POST') {
                const data = await readBody(req);
                if (typeof data.active !== 'boolean') fail('Trạng thái liên kết không hợp lệ.');
                provisioner.setPartners(data.a, data.b, data.active);
                return send(res, 200, { success: true });
            }
            if (url.pathname === '/api/logout' && req.method === 'POST') {
                await readBody(req);
                sessions.delete(token);
                res.setHeader(
                    'Set-Cookie',
                    'nkiot_admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'
                );
                return send(res, 200, { success: true });
            }
            fail('API không tồn tại.', 404);
        } catch (error) {
            if (!error.status) console.error(error);
            if (!res.headersSent)
                send(res, error.status || 500, {
                    success: false,
                    error: error.status ? error.message : 'Lỗi portal local. Kiểm tra terminal.'
                });
            else res.end();
        }
    };
    const server = http.createServer(handler);
    server.on('close', () => provisioner.stopAll());
    return { server, provisioner };
}

function staticAsset(req, res, url) {
    if (!['GET', 'HEAD'].includes(req.method) || !Object.hasOwn(ASSETS, url.pathname))
        fail('Không tìm thấy tài nguyên.', 404);
    const [file, type] = ASSETS[url.pathname];
    const content = fs.readFileSync(path.join(__dirname, file));
    res.writeHead(200, {
        ...securityHeaders({ enforceCsp: true }),
        'Content-Type': type,
        'Cache-Control': 'no-store'
    });
    res.end(req.method === 'HEAD' ? undefined : content);
}
if (require.main === module) {
    const password =
        process.env.NKIOT_SUPER_ADMIN_PASSWORD || crypto.randomBytes(16).toString('base64url');
    const dataDir = path.resolve(
        process.env.NKIOT_LOCAL_DATA_DIR || path.join(__dirname, 'data/local-admin')
    );
    const port = Number(process.env.NKIOT_ADMIN_PORT || 4100);
    const hubUrl = process.env.NKIOT_LOCAL_HUB_URL || 'http://127.0.0.1:4000';
    const { server, provisioner } = createAdminServer({ dataDir, password, hubUrl });
    server.listen(port, '127.0.0.1', async () => {
        console.log(`Quản trị local: http://localhost:${port}`);
        console.log(`Hub DB: ${provisioner.hubPath}`);
        if (!process.env.NKIOT_SUPER_ADMIN_PASSWORD) {
            console.log(`Mật khẩu quản trị local: ${password}`);
            console.log('Lưu ý: Mật khẩu quản trị ngẫu nhiên đã được tạo cho phiên này.');
        }
        const errors = await provisioner.startAll();
        for (const [id, error] of Object.entries(errors))
            console.error(`Không chạy được POS ${id}: ${error}`);
    });
    for (const signal of ['SIGINT', 'SIGTERM'])
        process.once(signal, async () => {
            await provisioner.stopAll();
            process.exit(0);
        });
}
module.exports = { createAdminServer };
