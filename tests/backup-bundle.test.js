'use strict';
require('./test-env');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createBundle, verifyBundle } = require('../backup');

test('bundle includes a validated database and media and detects tampering', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nkiot-bundle-'));
    try {
        const source = path.join(root, 'source.db');
        const db = new DatabaseSync(source);
        db.exec(
            'CREATE TABLE app_meta (id); CREATE TABLE users (id); CREATE TABLE products (id); CREATE TABLE invoices (id); CREATE TABLE audit_log (id); INSERT INTO products VALUES (42)'
        );
        db.close();
        const uploads = path.join(root, 'uploads');
        fs.mkdirSync(path.join(uploads, 'nested'), { recursive: true });
        fs.writeFileSync(path.join(uploads, 'nested', 'image.jpg'), 'image');
        const bundle = createBundle(source, uploads, path.join(root, 'bundle'));
        assert.equal(verifyBundle(bundle).files.length, 2);
        const restored = new DatabaseSync(path.join(bundle, 'database.db'), { readOnly: true });
        assert.equal(restored.prepare('SELECT id FROM products').get().id, 42);
        restored.close();
        assert.equal(
            fs.readFileSync(path.join(bundle, 'uploads', 'nested', 'image.jpg'), 'utf8'),
            'image'
        );
        assert.throws(() => createBundle(source, uploads, bundle));
        assert.throws(() => createBundle(source, uploads, path.join(uploads, 'bundle')));
        fs.writeFileSync(path.join(bundle, 'uploads', 'nested', 'image.jpg'), 'other');
        assert.throws(() => verifyBundle(bundle), /thay đổi/);
        fs.symlinkSync(source, path.join(uploads, 'link'));
        const failed = path.join(root, 'failed');
        assert.throws(() => createBundle(source, uploads, failed), /symlink/);
        assert.equal(fs.existsSync(failed), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
