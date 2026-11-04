'use strict';
require('./test-env');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { verifyPassword } = require('../security');

test('migration 8 upgrades a v7 catalog without losing its rows', () => {
    const { applyMigrations } = require('../migrations');
    const d = new DatabaseSync(':memory:');
    try {
        d.exec(`
            CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, appliedAt TEXT NOT NULL);
            CREATE TABLE public_catalog_items (id TEXT PRIMARY KEY);
            INSERT INTO public_catalog_items (id) VALUES ('keep');
            INSERT INTO schema_migrations SELECT 1, 'v1', '' UNION ALL SELECT 2, 'v2', '' UNION ALL SELECT 3, 'v3', '' UNION ALL SELECT 4, 'v4', '' UNION ALL SELECT 5, 'v5', '' UNION ALL SELECT 6, 'v6', '' UNION ALL SELECT 7, 'v7', '';
        `);
        applyMigrations(d, { entityTables: [] });
        assert.equal(
            d.prepare("SELECT imei FROM public_catalog_items WHERE id='keep'").get().imei,
            ''
        );
        assert.ok(
            d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='api_tokens'").get()
        );
        applyMigrations(d, { entityTables: [] });
        assert.equal(
            d.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version,
            10
        );
        assert.ok(
            d
                .prepare(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='deplao_send_jobs'"
                )
                .get()
        );
    } finally {
        d.close();
    }
});

test('legacy schema upgrade backs up original data and preserves empty catalog and login', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minikiot-upgrade-'));
    const filename = path.join(dir, 'legacy.db');
    const env = {
        ...process.env,
        NKIOT_DB_PATH: filename,
        MINIKIOT_DB_PATH: filename,
        MINIKIOT_ADMIN_PASSWORD: 'Initial-password-123'
    };
    const cwd = path.resolve(__dirname, '..');
    execFileSync(
        process.execPath,
        ['-e', "const db=require('./db');db.initDb();db.getDb().close()"],
        { cwd, env }
    );
    const old = new DatabaseSync(filename);
    const tables = old.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    for (const { name } of tables) {
        if (
            old
                .prepare(`PRAGMA table_info(${name})`)
                .all()
                .some((c) => c.name === 'extra')
        )
            old.exec(`ALTER TABLE ${name} DROP COLUMN extra`);
    }
    old.exec(
        'DROP TABLE app_meta; DROP TABLE schema_migrations; DROP TABLE processed_requests; DROP TABLE audit_log;'
    );
    old.prepare("UPDATE users SET password=? WHERE username='admin'").run('Legacy-password-123');
    old.prepare('INSERT INTO invoices (id,code,items,total) VALUES (?,?,?,?)').run(
        'KEEP',
        'KEEP',
        '[]',
        321
    );
    old.close();
    execFileSync(
        process.execPath,
        [
            '-e',
            "const db=require('./db');db.initDb();db.assertReadableRecords();db.getDb().close()"
        ],
        { cwd, env }
    );
    const backups = fs.readdirSync(dir).filter((file) => file.endsWith('.bak'));
    assert.equal(backups.length, 1);
    const backup = new DatabaseSync(path.join(dir, backups[0]), { readOnly: true });
    try {
        assert.equal(
            backup.prepare("SELECT password FROM users WHERE username='admin'").get().password,
            'Legacy-password-123'
        );
        assert.equal(backup.prepare("SELECT total FROM invoices WHERE id='KEEP'").get().total, 321);
        assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    } finally {
        backup.close();
    }
    const upgraded = new DatabaseSync(filename, { readOnly: true });
    try {
        assert.equal(upgraded.prepare('SELECT COUNT(*) AS n FROM products').get().n, 0);
        assert.deepEqual(
            upgraded
                .prepare('SELECT version FROM schema_migrations ORDER BY version')
                .all()
                .map((row) => row.version),
            [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
        );
        assert.equal(
            upgraded.prepare("SELECT total FROM invoices WHERE id='KEEP'").get().total,
            321
        );
        assert.ok(
            verifyPassword(
                'Legacy-password-123',
                upgraded.prepare("SELECT password FROM users WHERE username='admin'").get().password
            )
        );
    } finally {
        upgraded.close();
    }
    execFileSync(
        process.execPath,
        ['-e', "const db=require('./db');db.initDb();db.getDb().close()"],
        { cwd, env }
    );
    assert.equal(fs.readdirSync(dir).filter((file) => file.endsWith('.bak')).length, 1);
});
