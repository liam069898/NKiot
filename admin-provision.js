'use strict';
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const hubDb = require('./hub-db');
const { createTenant, linkPartners } = require('./hub-server');
const { hashPassword } = require('./security');

const ROOT = __dirname;
const STOP_TIMEOUT_MS = 10000;
const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
};
const validId = (id) => typeof id === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(id);
const shellQuote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

function createProvisioner({ dataDir, hubUrl = 'http://127.0.0.1:4000' }) {
    const root = path.resolve(dataDir);
    const tenantsDir = path.join(root, 'tenants');
    const hubPath = path.join(root, 'hub.db');
    fs.mkdirSync(tenantsDir, { recursive: true, mode: 0o700 });
    hubDb.initDb(hubPath);
    hubDb.getDb().exec('PRAGMA busy_timeout = 5000');

    function list() {
        const tenants = [];
        for (const entry of fs.readdirSync(tenantsDir, { withFileTypes: true })) {
            if (!entry.isDirectory() || !validId(entry.name)) continue;
            const configPath = path.join(tenantsDir, entry.name, 'tenant.json');
            if (!fs.existsSync(configPath)) continue;
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            const record = hubDb
                .getDb()
                .prepare('SELECT status FROM tenants WHERE id=?')
                .get(entry.name);
            const dbPath = path.join(tenantsDir, entry.name, 'nkiot.db');
            let dbSize = 0,
                productsCount = 0,
                invoicesCount = 0;
            if (fs.existsSync(dbPath)) {
                try {
                    dbSize = fs.statSync(dbPath).size;
                    const walPath = dbPath + '-wal';
                    if (fs.existsSync(walPath)) dbSize += fs.statSync(walPath).size;
                    const tDb = new DatabaseSync(dbPath, { readOnly: true });
                    try {
                        productsCount =
                            tDb
                                .prepare(
                                    "SELECT count(*) as c FROM products WHERE status!='archived'"
                                )
                                .get()?.c || 0;
                        invoicesCount =
                            tDb.prepare('SELECT count(*) as c FROM invoices').get()?.c || 0;
                    } finally {
                        tDb.close();
                    }
                } catch {}
            }
            tenants.push({
                ...config,
                root: ROOT,
                envPath: path.join(tenantsDir, entry.name, 'tenant.env'),
                status: record?.status || config.status || 'missing_hub',
                dbSize,
                productsCount,
                invoicesCount
            });
        }
        return tenants.sort((a, b) => a.id.localeCompare(b.id));
    }
    function partners() {
        return hubDb
            .getDb()
            .prepare(
                "SELECT tenantId AS a, partnerTenantId AS b FROM tenant_partners WHERE status='active' AND tenantId < partnerTenantId ORDER BY tenantId, partnerTenantId"
            )
            .all()
            .map(({ a, b }) => ({ a, b }));
    }
    function provision(input) {
        const { id, port: rawPort, password } = input || {};
        const name = typeof input?.name === 'string' ? input.name.trim() : '';
        const username =
            typeof input?.username === 'string' ? input.username.trim().toLowerCase() : '';
        const phone = typeof input?.phone === 'string' ? input.phone.trim().slice(0, 20) : '';
        const email = typeof input?.email === 'string' ? input.email.trim().slice(0, 100) : '';
        const category =
            typeof input?.category === 'string' ? input.category.trim().slice(0, 100) : '';
        const note = typeof input?.note === 'string' ? input.note.trim().slice(0, 500) : '';
        const port = Number(rawPort);
        if (!validId(id))
            fail(
                'Mã tenant dùng a-z, 0-9, dấu gạch ngang; không bắt đầu hoặc kết thúc bằng gạch ngang.'
            );
        if (!name || name.length > 200) fail('Tên nhà bán hàng phải từ 1 đến 200 ký tự.');
        if (!/^[a-z0-9_.-]{3,50}$/.test(username))
            fail(
                'Tên đăng nhập POS dùng 3–50 ký tự a-z, 0-9, dấu chấm, gạch dưới hoặc gạch ngang.'
            );
        if (typeof password !== 'string' || password.length < 8 || password.length > 1024)
            fail('Mật khẩu POS phải từ 8 đến 1024 ký tự.');
        if (
            !Number.isInteger(port) ||
            port < 1024 ||
            port > 65535 ||
            [3000, 4000, 4100].includes(port)
        )
            fail('Cổng POS phải từ 1024 đến 65535, khác 3000, 4000 và 4100.');
        const directory = path.join(tenantsDir, id);
        const d = hubDb.getDb();
        if (
            fs.existsSync(directory) ||
            d.prepare('SELECT 1 FROM tenants WHERE id=? OR slug=?').get(id, id)
        )
            fail('Tenant đã tồn tại.', 409);
        if (list().some((tenant) => tenant.port === port))
            fail('Cổng POS đã được cấp cho tenant khác.', 409);
        fs.mkdirSync(directory, { mode: 0o700 });
        const dbPath = path.join(directory, 'nkiot.db');
        const host = `${id}.localhost`;
        const config = {
            id,
            name,
            username,
            port,
            host,
            url: `http://${host}:${port}`,
            dbPath,
            phone,
            email,
            category,
            note,
            status: 'active',
            createdAt: new Date().toISOString()
        };
        let committed = false;
        try {
            const child = spawnSync(
                process.execPath,
                [path.join(ROOT, 'scripts/init-tenant-db.js')],
                {
                    cwd: ROOT,
                    env: {
                        ...process.env,
                        NKIOT_DB_PATH: dbPath,
                        MINIKIOT_ADMIN_PASSWORD: password,
                        NKIOT_TENANT_NAME: name,
                        NKIOT_TENANT_ADMIN_USERNAME: username,
                        NKIOT_TENANT_ADMIN_PASSWORD: password
                    },
                    encoding: 'utf8',
                    timeout: 30000
                }
            );
            if (child.error || child.status !== 0)
                throw new Error('Không khởi tạo được DB tenant.');
            d.exec('BEGIN IMMEDIATE');
            if (d.prepare('SELECT 1 FROM tenants WHERE id=? OR slug=?').get(id, id))
                fail('Tenant đã tồn tại.', 409);
            const key = createTenant({ id, name });
            const envFile = path.join(directory, 'tenant.env');
            const env = {
                HOST: '127.0.0.1',
                PORT: String(port),
                NKIOT_DB_PATH: dbPath,
                NKIOT_UPLOADS_DIR: path.join(directory, 'uploads'),
                NKIOT_HUB_URL: hubUrl,
                NKIOT_HUB_API_KEY: key
            };
            fs.writeFileSync(
                envFile,
                Object.entries(env)
                    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
                    .join('\n') + '\n',
                { mode: 0o600, flag: 'wx' }
            );
            fs.writeFileSync(
                path.join(directory, 'tenant.json'),
                JSON.stringify(config, null, 2) + '\n',
                { mode: 0o600, flag: 'wx' }
            );
            d.exec('COMMIT');
            committed = true;
            return { ...config, root: ROOT, envPath: envFile, status: 'active' };
        } catch (error) {
            if (d.isTransaction) d.exec('ROLLBACK');
            if (!committed) fs.rmSync(directory, { recursive: true, force: true });
            throw error;
        }
    }
    function setPartners(a, b, active) {
        const ids = new Set(list().map((item) => item.id));
        if (!ids.has(a) || !ids.has(b)) fail('Không tìm thấy tenant local.', 404);
        linkPartners(a, b, active ? 'active' : 'inactive');
    }

    // Each POS runs in its own child process because db.js and hub-client.js keep
    // per-process singletons (DB path, Hub key).
    const children = new Map();
    let hubChild = null;
    function readEnv(file) {
        const env = {};
        for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
            const match = /^export ([A-Z0-9_]+)='((?:[^']|'\\'')*)'$/.exec(line);
            if (match) env[match[1]] = match[2].replace(/'\\''/g, "'");
        }
        return env;
    }
    function spawnNode(script, env, directory, logName) {
        const log = fs.openSync(path.join(directory, logName), 'a', 0o600);
        try {
            return spawn(process.execPath, [path.join(ROOT, script)], {
                cwd: ROOT,
                env,
                stdio: ['ignore', log, log]
            });
        } finally {
            fs.closeSync(log);
        }
    }
    function portFree(port) {
        return new Promise((resolve) => {
            const probe = net.createServer();
            probe.once('error', () => resolve(false));
            probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
        });
    }
    function waitReady(child, port, host) {
        return new Promise((resolve, reject) => {
            const deadline = Date.now() + 15000;
            let done = false;
            const finish = (error) => {
                if (done) return;
                done = true;
                child.off('exit', onExit);
                if (error) reject(error);
                else resolve();
            };
            const onExit = (code) =>
                finish(
                    new Error(
                        `Tiến trình dừng khi khởi động (mã ${code}). Xem log trong thư mục tenant.`
                    )
                );
            child.once('exit', onExit);
            const poll = () => {
                if (done) return;
                const req = http.get(
                    {
                        host: '127.0.0.1',
                        port,
                        path: '/health',
                        headers: { Host: host },
                        timeout: 1000
                    },
                    (res) => {
                        res.resume();
                        // Only our own /health counts; any other listener on the port is a failure.
                        if (res.statusCode === 200) finish();
                        else if (Date.now() > deadline)
                            finish(new Error(`Health check trả mã ${res.statusCode}.`));
                        else setTimeout(poll, 200);
                    }
                );
                req.on('error', () => {
                    if (Date.now() > deadline)
                        finish(new Error('Tiến trình không phản hồi sau 15 giây.'));
                    else setTimeout(poll, 200);
                });
                req.on('timeout', () => req.destroy());
            };
            poll();
        });
    }

    async function ensureHub() {
        const url = new URL(hubUrl);
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return;
        if (hubChild && hubChild.exitCode === null) return;
        const port = Number(url.port || 80);
        if (!(await portFree(port))) return;
        hubChild = spawnNode(
            'hub-server.js',
            { ...process.env, HOST: '127.0.0.1', PORT: String(port), NKIOT_HUB_DB_PATH: hubPath },
            root,
            'hub.log'
        );
        await waitReady(hubChild, port, `127.0.0.1:${port}`);
    }
    const alive = (pid) => {
        try {
            process.kill(pid, 0);
            return true;
        } catch {
            return false;
        }
    };
    async function stopStale(directory) {
        const pidFile = path.join(directory, 'pos.pid');
        if (!fs.existsSync(pidFile)) return;
        const pid = Number(fs.readFileSync(pidFile, 'utf8'));
        fs.rmSync(pidFile, { force: true });
        if (!Number.isInteger(pid) || pid <= 0) return;
        // Kill only a leftover POS of this checkout, never an unrelated process reusing the PID.
        const command =
            spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).stdout ||
            '';
        if (!command.includes(path.join(ROOT, 'server.js'))) return;
        try {
            process.kill(pid, 'SIGTERM');
        } catch {
            return;
        }
        const deadline = Date.now() + STOP_TIMEOUT_MS;
        while (alive(pid) && Date.now() < deadline)
            await new Promise((resolve) => setTimeout(resolve, 100));
        if (alive(pid))
            try {
                process.kill(pid, 'SIGKILL');
            } catch {}
    }
    function stopChild(child) {
        if (!child || child.exitCode !== null || child.signalCode !== null)
            return Promise.resolve();
        return new Promise((resolve) => {
            const force = setTimeout(() => child.kill('SIGKILL'), STOP_TIMEOUT_MS);
            child.once('exit', () => {
                clearTimeout(force);
                resolve();
            });
            child.kill('SIGTERM');
        });
    }
    async function start(id) {
        const tenant = list().find((item) => item.id === id);
        if (!tenant) fail('Không tìm thấy tenant local.', 404);
        if (isRunning(id)) return;
        const directory = path.join(tenantsDir, id);
        await stopStale(directory);
        await ensureHub();
        if (!(await portFree(tenant.port)))
            fail(`Cổng ${tenant.port} đang bị chương trình khác dùng.`, 409);
        const child = spawnNode(
            'server.js',
            {
                ...process.env,
                ...readEnv(tenant.envPath),
                // Override inherited/global settings, including legacy tenant.env files.
                NKIOT_UPLOADS_DIR: path.join(directory, 'uploads')
            },
            directory,
            'pos.log'
        );
        children.set(id, child);
        fs.writeFileSync(path.join(directory, 'pos.pid'), String(child.pid), { mode: 0o600 });
        child.once('exit', () => {
            if (children.get(id) !== child) return;
            children.delete(id);
            fs.rmSync(path.join(directory, 'pos.pid'), { force: true });
        });
        try {
            await waitReady(child, tenant.port, `${tenant.host}:${tenant.port}`);
        } catch (error) {
            await stopChild(child);
            throw error;
        }
    }
    async function create(input) {
        const port = Number(input?.port);
        if (Number.isInteger(port) && port >= 1024 && port <= 65535 && !(await portFree(port)))
            fail(`Cổng ${port} đang bị chương trình khác dùng.`, 409);
        const tenant = provision(input);
        try {
            await start(tenant.id);
            return { ...tenant, running: true };
        } catch (error) {
            return { ...tenant, running: false, startError: error.message };
        }
    }
    async function startAll() {
        const errors = {};
        for (const tenant of list()) {
            try {
                await start(tenant.id);
            } catch (error) {
                errors[tenant.id] = error.message;
            }
        }
        return errors;
    }
    function isRunning(id) {
        const child = children.get(id);
        return !!child && child.exitCode === null && child.signalCode === null;
    }
    async function stop(id) {
        const child = children.get(id);
        if (child) {
            await stopChild(child);
            children.delete(id);
        }
        const directory = path.join(tenantsDir, id);
        await stopStale(directory);
        return { success: true };
    }
    async function setStatus(id, status) {
        if (!['active', 'suspended'].includes(status))
            fail('Trạng thái không hợp lệ (chỉ chấp nhận active hoặc suspended).', 400);
        const tenant = list().find((item) => item.id === id);
        if (!tenant) fail('Không tìm thấy tenant local.', 404);

        const d = hubDb.getDb();
        d.prepare('UPDATE tenants SET status = ?, updatedAt = ? WHERE id = ?').run(
            status,
            new Date().toISOString(),
            id
        );

        const configPath = path.join(tenantsDir, id, 'tenant.json');
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            config.status = status;
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
        }

        const dbPath = path.join(tenantsDir, id, 'nkiot.db');
        if (fs.existsSync(dbPath)) {
            try {
                const tDb = new DatabaseSync(dbPath);
                try {
                    tDb.prepare(
                        "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('tenant_status', ?)"
                    ).run(status);
                } finally {
                    tDb.close();
                }
            } catch {}
        }

        if (status === 'suspended' && isRunning(id)) {
            await stop(id);
        }
        return { success: true, status };
    }
    function resetPassword(id, newPassword) {
        if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 1024)
            fail('Mật khẩu mới phải từ 8 đến 1024 ký tự.', 400);
        const tenant = list().find((item) => item.id === id);
        if (!tenant) fail('Không tìm thấy tenant local.', 404);
        const dbPath = path.join(tenantsDir, id, 'nkiot.db');
        if (!fs.existsSync(dbPath)) fail('Không tìm thấy cơ sở dữ liệu tenant.', 404);
        const hashed = hashPassword(newPassword);
        const tDb = new DatabaseSync(dbPath);
        try {
            tDb.prepare("UPDATE users SET password = ? WHERE role = 'admin' OR username = ?").run(
                hashed,
                tenant.username
            );
        } finally {
            tDb.close();
        }
        return { success: true };
    }
    function backupDb(id) {
        const tenant = list().find((item) => item.id === id);
        if (!tenant) fail('Không tìm thấy tenant local.', 404);
        const dbPath = path.join(tenantsDir, id, 'nkiot.db');
        if (!fs.existsSync(dbPath)) fail('Không tìm thấy cơ sở dữ liệu tenant.', 404);
        const backupDir = path.join(root, 'temp_backups');
        fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFilePath = path.join(backupDir, `nkiot-${id}-${timestamp}.db`);
        const tDb = new DatabaseSync(dbPath);
        try {
            tDb.exec(`VACUUM INTO '${backupFilePath.replace(/'/g, "''")}'`);
        } finally {
            tDb.close();
        }
        return backupFilePath;
    }
    function update(id, input) {
        const tenant = list().find((item) => item.id === id);
        if (!tenant) fail('Không tìm thấy tenant local.', 404);
        const configPath = path.join(tenantsDir, id, 'tenant.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (typeof input?.name === 'string' && input.name.trim()) {
            config.name = input.name.trim();
            hubDb
                .getDb()
                .prepare('UPDATE tenants SET name = ?, updatedAt = ? WHERE id = ?')
                .run(config.name, new Date().toISOString(), id);
        }
        if (typeof input?.phone === 'string') config.phone = input.phone.trim().slice(0, 20);
        if (typeof input?.email === 'string') config.email = input.email.trim().slice(0, 100);
        if (typeof input?.category === 'string')
            config.category = input.category.trim().slice(0, 100);
        if (typeof input?.note === 'string') config.note = input.note.trim().slice(0, 500);
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
        return { ...config, root: ROOT, status: tenant.status };
    }
    function stopAll() {
        return Promise.all([...children.values(), hubChild].map(stopChild));
    }
    return {
        root,
        hubPath,
        tenantsDir,
        list,
        partners,
        provision,
        setPartners,
        create,
        start,
        stop,
        setStatus,
        resetPassword,
        backupDb,
        update,
        startAll,
        isRunning,
        stopAll
    };
}
module.exports = { createProvisioner };
