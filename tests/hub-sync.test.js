'use strict';
require('./test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nkiot-hub-sync-'));
process.env.NKIOT_DB_PATH = path.join(dir, 'tenant.sqlite');
process.env.MINIKIOT_ADMIN_PASSWORD = 'Test-password-123';
const db = require('../db');
const hubDb = require('../hub-db');
const hub = require('../hub-client');
const { handler, createTenant, syncCatalog } = require('../hub-server');

const snapshot = (items, sequence) => ({
    items,
    sequence,
    digest: crypto.createHash('sha256').update(JSON.stringify({ items })).digest('hex')
});
const shared = (id, name) => ({ id, name, status: 'active', availability: 'in_stock' });
const hubState = () =>
    hubDb.getDb().prepare("SELECT sequence FROM tenant_sync_state WHERE tenantId='tenant'").get();
const localSequence = () =>
    Number(db.getDb().prepare("SELECT value FROM app_meta WHERE key='hub_sequence'").get().value);
const outbox = () =>
    db
        .getDb()
        .prepare('SELECT sequence FROM hub_outbox ORDER BY sequence')
        .all()
        .map((row) => row.sequence);

let server;
test.before(async () => {
    db.initDb();
    hubDb.initDb(path.join(dir, 'hub.sqlite'));
    process.env.NKIOT_HUB_API_KEY = createTenant({ id: 'tenant', name: 'Tenant' });
    server = http.createServer(handler);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    process.env.NKIOT_HUB_URL = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
    hub.resetCache();
    await new Promise((resolve) => server.close(resolve));
    hubDb.closeDb();
    db.getDb().close();
    fs.rmSync(dir, { recursive: true, force: true });
});
test.beforeEach(() => {
    db.getDb().exec(
        "DELETE FROM hub_outbox; UPDATE app_meta SET value='0' WHERE key='hub_sequence'"
    );
    hubDb.getDb().exec('DELETE FROM tenant_sync_state; DELETE FROM catalog_products');
});

test('outbox sequence is a durable counter independent of row ids', async () => {
    assert.equal(hub.enqueue({ shared_products: [shared('a', 'A')] }), true);
    assert.equal(hub.enqueue({ shared_products: [shared('a', 'A')] }), false);
    assert.equal(hub.enqueue({ shared_products: [shared('a', 'A2')] }), true);
    assert.deepEqual(outbox(), [1, 2]);
    assert.deepEqual(await hub.syncNow(), { sent: 2 });
    assert.equal(hubState().sequence, 2);
    // Outbox empty: next snapshot must continue, not restart from a reused row id.
    hub.enqueue({ shared_products: [shared('a', 'A3')] });
    assert.deepEqual(outbox(), [3]);
});

test('tenant restored from older backup rebases above hub sequence', async () => {
    syncCatalog({ id: 'tenant' }, snapshot([], 50));
    hub.enqueue({ shared_products: [shared('a', 'Restored')] });
    assert.deepEqual(outbox(), [1]);
    const result = await hub.syncNow();
    assert.equal(result.sent, 1);
    assert.equal(hubState().sequence, 51);
    assert.equal(localSequence(), 51);
    assert.deepEqual(outbox(), []);
});

test('same sequence with different digest (409) also rebases', async () => {
    syncCatalog({ id: 'tenant' }, snapshot([{ sourceProductId: 'x', name: 'Hub copy' }], 1));
    hub.enqueue({ shared_products: [shared('a', 'Local')] });
    const result = await hub.syncNow();
    assert.equal(result.sent, 1);
    assert.equal(hubState().sequence, 2);
    assert.equal(hub.status().lastError, null);
});

test('oversized catalog is reported without queuing or blocking POS writes', () => {
    const tooMany = Array.from({ length: 5001 }, (_, i) => shared(String(i), 'Product'));
    assert.equal(hub.enqueue({ shared_products: tooMany }), false);
    assert.match(hub.status().lastError, /5000/);
    assert.deepEqual(outbox(), []);
    const tooLarge = Array.from({ length: 500 }, (_, i) => ({
        ...shared(String(i), 'Product'),
        description: 'x'.repeat(5000)
    }));
    assert.equal(hub.enqueue({ shared_products: tooLarge }), false);
    assert.match(hub.status().lastError, /2 MB/);
    hub.enqueue({ shared_products: [] });
    assert.equal(hub.status().lastError, null);
});

test('permanently rejected legacy snapshot is retained until a newer snapshot succeeds', async () => {
    const items = Array.from({ length: 5001 }, (_, i) => ({
        sourceProductId: String(i),
        name: 'Legacy'
    }));
    const old = snapshot(items, 1);
    db.getDb()
        .prepare('INSERT INTO hub_outbox(sequence,digest,payload,createdAt) VALUES(?,?,?,?)')
        .run(1, old.digest, JSON.stringify({ items }), new Date().toISOString());
    db.getDb().prepare("UPDATE app_meta SET value='1' WHERE key='hub_sequence'").run();
    await assert.rejects(hub.syncNow());
    assert.deepEqual(outbox(), [1]);
    hub.enqueue({ shared_products: [] });
    assert.equal((await hub.syncNow()).sent, 1);
    assert.deepEqual(outbox(), []);
    assert.equal(hubState().sequence, 2);
});

test('transient network failure preserves all queued snapshots for retry', async () => {
    hub.enqueue({ shared_products: [shared('a', 'A')] });
    hub.enqueue({ shared_products: [shared('a', 'B')] });
    const fetch = global.fetch;
    global.fetch = async () => {
        throw new Error('network unavailable');
    };
    try {
        await assert.rejects(hub.syncNow(), /network unavailable/);
        assert.deepEqual(outbox(), [1, 2]);
    } finally {
        global.fetch = fetch;
    }
    assert.equal((await hub.syncNow()).sent, 2);
    assert.deepEqual(outbox(), []);
});
