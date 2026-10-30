'use strict';
require('./test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveDbPath } = require('../runtime-paths');
const { safeMediaUrl } = require('../constants');
const { validateMedia } = require('../media-validation');

test('database resolver honors overrides and chooses the same modern or legacy default', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nkiot-paths-'));
    try {
        assert.equal(resolveDbPath({}, root), path.join(root, 'minikiot.db'));
        fs.writeFileSync(path.join(root, 'nkiot.db'), '');
        assert.equal(resolveDbPath({}, root), path.join(root, 'nkiot.db'));
        assert.equal(
            resolveDbPath({ MINIKIOT_DB_PATH: path.join(root, 'legacy.db') }, root),
            path.join(root, 'legacy.db')
        );
        assert.equal(
            resolveDbPath(
                { NKIOT_DB_PATH: path.join(root, 'new.db'), MINIKIOT_DB_PATH: 'ignored.db' },
                root
            ),
            path.join(root, 'new.db')
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('failed database open never creates a shadow database in tmp', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nkiot-open-'));
    const name = `review-${require('node:crypto').randomUUID()}.db`;
    const shadow = path.join('/tmp', name);
    try {
        const result = spawnSync(process.execPath, ['-e', "require('./db').getDb()"], {
            cwd: path.resolve(__dirname, '..'),
            encoding: 'utf8',
            env: {
                ...process.env,
                NKIOT_DB_PATH: path.join(root, 'missing', name),
                NKIOT_JOURNAL_MODE: 'DELETE'
            }
        });
        assert.notEqual(result.status, 0);
        assert.equal(fs.existsSync(shadow), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(shadow, { force: true });
    }
});

test('media validation rejects executable URLs and malformed nested details', () => {
    for (const url of [
        'javascript:alert(1)',
        '//evil.test/a',
        'data:text/html,x',
        'https://x.test/" onerror="x',
        '/uploads/../secret',
        'https://user:pass@x.test/a'
    ]) {
        assert.equal(safeMediaUrl(url), '');
        assert.throws(() => validateMedia({ images: [url] }), { status: 422 });
        assert.throws(() => validateMedia({ imeiDetails: { serial: { videoUrl: url } } }), {
            status: 422
        });
    }
    assert.doesNotThrow(() =>
        validateMedia({
            images: ['/uploads/a.png', 'https://example.com/a.png'],
            imeiDetails: { serial: { condition: 'good' } }
        })
    );
    assert.throws(() => validateMedia({ imeiDetails: { serial: [] } }), { status: 422 });
});

test('sharing an existing product cannot bypass its owner authorization', () => {
    const data = structuredClone(require('../data').defaultData);
    const { execute } = require('../domain');
    data.shared_products = [];
    const admin = { ...data.users[0], role: 'admin', status: 'active' };
    const product = data.products[0];
    const staff = {
        id: 'other',
        name: 'Other',
        role: 'custom',
        status: 'active',
        permissions: { products: true },
        branches: [product.branch || data.settings.branch]
    };
    const shared = execute(data, admin, 'shareProduct', {
        productId: product.id,
        wholesalePrice: 100
    });
    assert.throws(
        () =>
            execute(data, staff, 'updateSharedProduct', {
                sharedProductId: shared.id,
                wholesalePrice: 200
            }),
        { status: 403 }
    );
    assert.throws(
        () => execute(data, staff, 'shareProduct', { productId: product.id, wholesalePrice: 300 }),
        { status: 403 }
    );
    assert.equal(shared.wholesalePrice, 100);
    execute(data, admin, 'shareProduct', { productId: product.id, wholesalePrice: 400 });
    assert.equal(shared.wholesalePrice, 400);
});

test('backend test file cannot write inherited operational database or upload paths', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nkiot-test-isolation-'));
    const sentinel = path.join(root, 'operational.db');
    fs.writeFileSync(sentinel, 'DO NOT OPEN OR CHANGE');
    try {
        const result = spawnSync(
            process.execPath,
            [
                '--test',
                '--test-name-pattern=POS health response',
                path.join(__dirname, 'backend.test.js')
            ],
            {
                cwd: path.resolve(__dirname, '..'),
                encoding: 'utf8',
                timeout: 30000,
                env: {
                    ...process.env,
                    NKIOT_DB_PATH: sentinel,
                    MINIKIOT_DB_PATH: sentinel,
                    NKIOT_UPLOADS_DIR: path.join(root, 'uploads'),
                    NKIOT_HUB_URL: 'http://127.0.0.1:1',
                    NKIOT_HUB_API_KEY: 'must-not-use'
                }
            }
        );
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.equal(fs.readFileSync(sentinel, 'utf8'), 'DO NOT OPEN OR CHANGE');
        assert.equal(fs.existsSync(path.join(root, 'uploads')), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
