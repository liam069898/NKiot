'use strict';
require('./test-env');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
    scheduledFilename,
    writeVerifiedBackup,
    validateHubBackup,
    pruneBackups,
    backupStatus
} = require('../backup');

function makeDb(source) {
    const db = new DatabaseSync(source);
    db.exec(
        'CREATE TABLE app_meta (key, value); CREATE TABLE users (id); CREATE TABLE products (id); CREATE TABLE invoices (id); CREATE TABLE audit_log (id); INSERT INTO products VALUES (1)'
    );
    db.close();
}

test('public/tailwind.css is built from the current source', () => {
    // Chặn phát hành giao diện thiếu style: file CSS phải khớp bản build từ source.
    const { execFileSync } = require('node:child_process');
    const root = path.join(__dirname, '..');
    const output = execFileSync(process.execPath, [path.join(root, 'scripts', 'check-assets.js')], {
        cwd: root,
        encoding: 'utf8'
    });
    assert.match(output, /đồng bộ với source/);
});

test('scheduled filenames are stable per day and per ISO week', () => {
    const d = new Date('2026-11-18T05:00:00Z');
    assert.equal(scheduledFilename('daily', d).name, 'daily-20261118.db');
    assert.equal(
        scheduledFilename('daily', new Date('2026-11-18T23:30:00Z')).name,
        'daily-20261118.db'
    );
    // 18/11/2026 là Thứ Tư của tuần ISO 47.
    assert.equal(scheduledFilename('weekly', d).name, 'weekly-2026-W47.db');
    assert.equal(
        scheduledFilename('weekly', new Date('2026-11-16T00:00:00Z')).name,
        'weekly-2026-W47.db'
    );
    assert.notEqual(
        scheduledFilename('weekly', new Date('2026-11-23T00:00:00Z')).name,
        'weekly-2026-W47.db'
    );
});

test('verified backup writes atomically, replaces same-day file and reports status', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nkiot-sched-backup-'));
    try {
        const source = path.join(root, 'source.db');
        makeDb(source);
        const dir = path.join(root, 'backups', 'kalo');
        const target = path.join(
            dir,
            scheduledFilename('daily', new Date('2026-11-18T02:00:00Z')).name
        );

        writeVerifiedBackup(source, target);
        assert.ok(fs.existsSync(target));
        const firstSize = fs.statSync(target).size;
        assert.equal(
            new DatabaseSync(target, { readOnly: true })
                .prepare('SELECT count(*) c FROM products')
                .get().c,
            1
        );
        // Không còn file tạm sau khi ghi.
        assert.deepEqual(
            fs.readdirSync(dir).filter((name) => name.includes('.tmp-')),
            []
        );

        // Ghi đè trong cùng ngày: vẫn chỉ một file daily.
        const db = new DatabaseSync(source);
        db.exec('INSERT INTO products VALUES (2)');
        db.close();
        writeVerifiedBackup(source, target);
        assert.deepEqual(
            fs.readdirSync(dir).filter((n) => n.startsWith('daily-')),
            [path.basename(target)]
        );
        assert.ok(fs.statSync(target).size >= firstSize);

        const status = backupStatus(dir);
        assert.equal(status.daily, 1);
        assert.equal(status.weekly, 0);
        assert.equal(status.latest.name, path.basename(target));
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('prune keeps newest daily and weekly snapshots only', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nkiot-prune-'));
    try {
        const dir = path.join(root, 'backups');
        fs.mkdirSync(dir, { recursive: true });
        for (const day of ['01', '02', '03', '04', '05', '06', '07', '08', '09'])
            fs.writeFileSync(path.join(dir, `daily-202611${day}.db`), 'x');
        for (const week of ['44', '45', '46', '47', '48', '49'])
            fs.writeFileSync(path.join(dir, `weekly-2026-W${week}.db`), 'x');
        fs.writeFileSync(path.join(dir, 'minikiot-manual.db'), 'x');
        pruneBackups(dir, { dailyKeep: 7, weeklyKeep: 4 });
        const names = fs.readdirSync(dir).sort();
        assert.equal(names.filter((n) => n.startsWith('daily-')).length, 7);
        assert.equal(names.filter((n) => n.startsWith('weekly-')).length, 4);
        // Giữ bản mới nhất, xóa bản cũ nhất.
        assert.ok(names.includes('daily-20261109.db'));
        assert.ok(!names.includes('daily-20261101.db'));
        assert.ok(names.includes('weekly-2026-W49.db'));
        assert.ok(!names.includes('weekly-2026-W44.db'));
        // Không đụng file không thuộc lịch.
        assert.ok(names.includes('minikiot-manual.db'));
        assert.throws(() => pruneBackups(dir, { dailyKeep: 0 }), /hơn 0/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('legacy databases upgraded to v14 gain the missing extra column without data loss', () => {
    // DB đã chạy migration 14 bản đầu (bảng import_returns thiếu cột `extra`) phải được vá.
    const { applyMigrations } = require('../migrations');
    const d = new DatabaseSync(':memory:');
    try {
        d.exec(`
            CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, appliedAt TEXT NOT NULL);
            CREATE TABLE invoices (id TEXT PRIMARY KEY, branch TEXT);
            CREATE TABLE returns (invoiceCode TEXT);
            CREATE TABLE import_returns (id TEXT PRIMARY KEY, code TEXT, importCode TEXT, time TEXT,
                nccCode TEXT, nccName TEXT, items TEXT, totalRefund REAL DEFAULT 0, refundMethod TEXT,
                reason TEXT, cashier TEXT, branch TEXT);
            INSERT INTO schema_migrations VALUES (14, 'import_returns', '2026-11-19T00:00:00Z');
            INSERT INTO import_returns (id, code, importCode, items, branch)
                VALUES ('PTN1', 'PTN1', 'PN1', '[]', 'A');
        `);
        applyMigrations(d, { entityTables: ['import_returns'] });
        assert.ok(
            d
                .prepare('PRAGMA table_info(import_returns)')
                .all()
                .some((c) => c.name === 'extra'),
            'phải thêm cột extra'
        );
        // Dữ liệu cũ phải còn nguyên.
        assert.equal(d.prepare('SELECT count(*) c FROM import_returns').get().c, 1);
        assert.equal(
            d.prepare("SELECT code FROM import_returns WHERE id='PTN1'").get().code,
            'PTN1'
        );
        assert.ok(d.prepare('SELECT MAX(version) v FROM schema_migrations').get().v >= 15);
    } finally {
        d.close();
    }
});

test('migration 16 creates the exchanges table with the extra column', () => {
    const { applyMigrations, LATEST_SCHEMA_VERSION } = require('../migrations');
    const d = new DatabaseSync(':memory:');
    try {
        d.exec(`
            CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, appliedAt TEXT NOT NULL);
            CREATE TABLE invoices (id TEXT PRIMARY KEY, branch TEXT);
            CREATE TABLE returns (invoiceCode TEXT);
        `);
        applyMigrations(d, { entityTables: ['exchanges'] });
        const columns = d
            .prepare('PRAGMA table_info(exchanges)')
            .all()
            .map((c) => c.name);
        assert.ok(columns.includes('extra'), 'bảng exchanges phải có cột extra');
        assert.ok(columns.includes('sourceCode'), 'bảng exchanges phải có cột sourceCode');
        assert.ok(
            d
                .prepare(
                    "SELECT 1 FROM sqlite_master WHERE type='index' AND name='exchanges_source'"
                )
                .get(),
            'phải có index exchanges_source'
        );
        assert.equal(
            d.prepare('SELECT MAX(version) v FROM schema_migrations').get().v,
            LATEST_SCHEMA_VERSION
        );
    } finally {
        d.close();
    }
});

test('hub snapshots validate against the hub schema instead of tenant tables', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nkiot-hub-backup-'));
    try {
        const source = path.join(root, 'hub.db');
        const db = new DatabaseSync(source);
        db.exec('CREATE TABLE tenants (id TEXT PRIMARY KEY)');
        db.prepare('INSERT INTO tenants VALUES (?)').run('kalo');
        db.close();
        const target = path.join(root, 'backups', 'hub', 'daily-20261118.db');
        writeVerifiedBackup(source, target, { validate: validateHubBackup });
        const restored = new DatabaseSync(target, { readOnly: true });
        assert.equal(restored.prepare('SELECT count(*) c FROM tenants').get().c, 1);
        restored.close();
        // Bộ kiểm tra của tenant phải từ chối DB hub (thiếu bảng nghiệp vụ).
        assert.throws(() =>
            writeVerifiedBackup(source, path.join(root, 'backups', 'hub', 'wrong.db'))
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('a failed backup never replaces the last good snapshot', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nkiot-bad-backup-'));
    try {
        const dir = path.join(root, 'backups');
        const target = path.join(dir, 'daily-20261118.db');
        fs.mkdirSync(dir, { recursive: true });
        // Bản sao hợp lệ trước đó.
        const good = path.join(root, 'good.db');
        makeDb(good);
        writeVerifiedBackup(good, target);
        const before = fs.readFileSync(target);

        // Nguồn không phải SQLite hợp lệ -> integrity_check thất bại.
        const broken = path.join(root, 'broken.db');
        fs.writeFileSync(broken, 'not a database');
        assert.throws(() => writeVerifiedBackup(broken, target));
        assert.deepEqual(fs.readFileSync(target), before, 'bản tốt phải được giữ nguyên');
        assert.deepEqual(
            fs.readdirSync(dir).filter((name) => name.includes('.tmp-')),
            []
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
