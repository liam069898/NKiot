'use strict';
require('./test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createProvisioner } = require('../admin-provision');

test('local provisioner creates isolated POS DB, protected config and hub tenant', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nkiot-admin-'));
    try {
        const portal = createProvisioner({ dataDir: root, hubUrl: 'http://127.0.0.1:4000' });
        const tenant = portal.provision({
            id: 'a',
            name: 'Cửa hàng A',
            username: 'admin-a',
            password: 'secret-123',
            port: 3101
        });
        assert.equal(tenant.url, 'http://a.localhost:3101');
        assert.equal(fs.existsSync(tenant.dbPath), true);
        assert.equal(fs.existsSync(tenant.envPath), true);
        assert.equal(fs.statSync(tenant.envPath).mode & 0o077, 0);
        const env = fs.readFileSync(tenant.envPath, 'utf8');
        assert.match(env, /NKIOT_HUB_API_KEY/);
        assert.ok(
            env.includes(`NKIOT_UPLOADS_DIR='${path.join(path.dirname(tenant.dbPath), 'uploads')}'`)
        );
        assert.doesNotMatch(
            fs.readFileSync(path.join(path.dirname(tenant.dbPath), 'tenant.json'), 'utf8'),
            /NKIOT_HUB_API_KEY/
        );
        const db = new DatabaseSync(tenant.dbPath);
        assert.deepEqual(
            db
                .prepare('SELECT username, name, branch FROM users')
                .all()
                .map(({ username, name, branch }) => ({ username, name, branch })),
            [{ username: 'admin-a', name: 'Cửa hàng A', branch: 'Chi nhánh chính' }]
        );
        assert.deepEqual(
            db
                .prepare('SELECT name FROM branches')
                .all()
                .map(({ name }) => ({ name })),
            [{ name: 'Chi nhánh chính' }]
        );
        db.close();
        assert.deepEqual(
            portal.list().map((item) => item.id),
            ['a']
        );
        assert.equal(portal.partners().length, 0);
        assert.throws(
            () =>
                portal.provision({
                    id: 'b',
                    name: 'B',
                    username: 'admin-b',
                    password: 'secret-123',
                    port: 3101
                }),
            /Cổng POS/
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('local provisioner creates and starts an accessible POS automatically', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nkiot-admin-'));
    const portal = createProvisioner({ dataDir: root, hubUrl: 'http://127.0.0.1:39100' });
    try {
        const tenant = await portal.create({
            id: 'auto',
            name: 'Cửa hàng tự chạy',
            username: 'admin-auto',
            password: 'secret-123',
            port: 39101
        });
        assert.equal(tenant.running, true);
        assert.equal(portal.isRunning('auto'), true);
        const page = await new Promise((resolve, reject) => {
            const req = require('node:http').get(
                {
                    host: '127.0.0.1',
                    port: 39101,
                    path: '/',
                    headers: { Host: 'auto.localhost:39101' }
                },
                (res) => {
                    res.resume();
                    resolve(res.statusCode);
                }
            );
            req.on('error', reject);
        });
        assert.equal(page, 200);
        await portal.stopAll();
        assert.equal(portal.isRunning('auto'), false);
        assert.equal(fs.existsSync(path.join(root, 'tenants/auto/pos.pid')), false);
    } finally {
        await portal.stopAll();
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('local provisioner links two created tenants through hub', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nkiot-admin-'));
    try {
        const portal = createProvisioner({ dataDir: root });
        for (const [id, port] of [
            ['a', 3101],
            ['b', 3102]
        ])
            portal.provision({
                id,
                name: `Cửa hàng ${id}`,
                username: `admin-${id}`,
                password: 'secret-123',
                port
            });
        portal.setPartners('a', 'b', true);
        assert.deepEqual(portal.partners(), [{ a: 'a', b: 'b' }]);
        portal.setPartners('a', 'b', false);
        assert.deepEqual(portal.partners(), []);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Phase 1 management: CRM fields, status toggle, reset password, backup and update', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nkiot-admin-'));
    const { verifyPassword } = require('../security');
    try {
        const portal = createProvisioner({ dataDir: root });
        // 1. Provision with CRM fields
        const tenant = portal.provision({
            id: 'shop-test',
            name: 'Shop Thể Thao Test',
            username: 'admin-test',
            password: 'initial-password-123',
            port: 3105,
            phone: '0909123456',
            email: 'test@shop.vn',
            category: 'Đồ thể thao & Dã ngoại',
            note: 'Khách hàng VIP 1 năm'
        });

        assert.equal(tenant.phone, '0909123456');
        assert.equal(tenant.email, 'test@shop.vn');
        assert.equal(tenant.category, 'Đồ thể thao & Dã ngoại');
        assert.equal(tenant.note, 'Khách hàng VIP 1 năm');
        assert.equal(tenant.status, 'active');

        // 2. list() returns DB stats & CRM info
        const listed = portal.list().find((t) => t.id === 'shop-test');
        assert.ok(listed);
        assert.equal(listed.phone, '0909123456');
        assert.equal(listed.category, 'Đồ thể thao & Dã ngoại');
        assert.ok(listed.dbSize > 0, 'dbSize is calculated');
        assert.equal(typeof listed.productsCount, 'number');
        assert.equal(typeof listed.invoicesCount, 'number');

        // 3. Suspend and activate tenant
        await portal.setStatus('shop-test', 'suspended');
        assert.equal(portal.list().find((t) => t.id === 'shop-test').status, 'suspended');

        // Verify SQLite app_meta tenant_status
        let db = new DatabaseSync(tenant.dbPath);
        assert.equal(
            db.prepare("SELECT value FROM app_meta WHERE key='tenant_status'").get()?.value,
            'suspended'
        );
        db.close();

        // Restore to active
        await portal.setStatus('shop-test', 'active');
        assert.equal(portal.list().find((t) => t.id === 'shop-test').status, 'active');

        // 4. Reset admin password
        portal.resetPassword('shop-test', 'new-secret-password-456');
        db = new DatabaseSync(tenant.dbPath);
        const user = db.prepare("SELECT password FROM users WHERE username='admin-test'").get();
        assert.ok(user);
        assert.ok(verifyPassword('new-secret-password-456', user.password));
        db.close();

        // 5. Backup DB
        const backupFile = portal.backupDb('shop-test');
        assert.ok(fs.existsSync(backupFile));
        assert.ok(fs.statSync(backupFile).size > 0);
        fs.unlinkSync(backupFile);

        // 6. Update tenant metadata
        const updated = portal.update('shop-test', {
            name: 'Shop Thể Thao Mới',
            phone: '0988888888',
            category: 'Thời trang & Phụ kiện'
        });
        assert.equal(updated.name, 'Shop Thể Thao Mới');
        assert.equal(updated.phone, '0988888888');
        assert.equal(updated.category, 'Thời trang & Phụ kiện');
        const reloaded = portal.list().find((t) => t.id === 'shop-test');
        assert.equal(reloaded.name, 'Shop Thể Thao Mới');
        assert.equal(reloaded.phone, '0988888888');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('tenant media requires login and stays isolated even with legacy upload configuration', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nkiot-media-'));
    const portal = createProvisioner({ dataDir: root, hubUrl: 'http://127.0.0.1:39110' });
    try {
        for (const [id, port] of [
            ['media-a', 39111],
            ['media-b', 39112]
        ]) {
            const tenant = portal.provision({
                id,
                port,
                name: id,
                username: 'admin',
                password: 'secret-123'
            });
            fs.appendFileSync(
                tenant.envPath,
                `export NKIOT_UPLOADS_DIR='${path.join(root, 'shared')}'\n`
            );
            await portal.start(id);
        }
        const directory = path.join(root, 'tenants/media-a/uploads');
        fs.writeFileSync(path.join(directory, 'private.png'), Buffer.from([137, 80, 78, 71]));
        fs.symlinkSync(
            path.join(directory, 'private.png'),
            path.join(root, 'tenants/media-b/uploads/link.png')
        );
        async function login(port) {
            const response = await fetch(`http://127.0.0.1:${port}/api/login`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ username: 'admin', password: 'secret-123' })
            });
            assert.equal(response.status, 200);
            await response.arrayBuffer();
            return response.headers.get('set-cookie').split(';')[0];
        }
        const a = await login(39111),
            b = await login(39112);
        for (const [port, file, cookie, expected] of [
            [39111, 'private.png', '', 401],
            [39111, 'private.png', a, 200],
            [39112, 'private.png', b, 404],
            [39112, 'link.png', b, 404]
        ]) {
            const response = await fetch(`http://127.0.0.1:${port}/uploads/${file}`, {
                headers: { cookie }
            });
            assert.equal(response.status, expected);
            if (expected === 200)
                assert.equal(response.headers.get('cache-control'), 'private, no-store');
            await response.arrayBuffer();
        }
    } finally {
        await portal.stopAll();
        fs.rmSync(root, { recursive: true, force: true });
    }
});
