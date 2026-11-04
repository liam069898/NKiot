'use strict';

const { hashPassword } = require('./security');
const { FALLBACK_BRANCH } = require('./constants');

function hasColumn(db, table, column) {
    return db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((item) => item.name === column);
}

function addColumn(db, table, definition) {
    const column = definition.split(/\s+/, 1)[0];
    if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

// Append-only. Every step must be idempotent: legacy databases predating schema_migrations
// run the whole list once and may already contain part of each change.
const MIGRATIONS = [
    {
        version: 1,
        name: 'legacy_columns',
        up(db, { entityTables }) {
            addColumn(db, 'imports', 'paymentMethod TEXT DEFAULT "bank"');
            addColumn(db, 'products', 'hasImei INTEGER DEFAULT 0');
            addColumn(db, 'products', 'imeis TEXT DEFAULT "[]"');
            addColumn(db, 'users', 'branches TEXT DEFAULT "[]"');
            addColumn(db, 'shared_products', 'ownerName TEXT DEFAULT ""');
            addColumn(db, 'shared_products', 'ownerPhone TEXT DEFAULT ""');
            for (const table of entityTables)
                addColumn(db, table, "extra TEXT NOT NULL DEFAULT '{}'");
        }
    },
    {
        version: 2,
        name: 'meta_audit_idempotency',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY, requestId TEXT UNIQUE, userId TEXT NOT NULL, action TEXT NOT NULL, time TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS processed_requests (id TEXT PRIMARY KEY, userId TEXT NOT NULL, digest TEXT NOT NULL, result TEXT NOT NULL, createdAt TEXT NOT NULL DEFAULT '');
                INSERT OR IGNORE INTO app_meta VALUES ('revision', '0');
            `);
            addColumn(db, 'processed_requests', "createdAt TEXT NOT NULL DEFAULT ''");
            // Legacy rows have no timestamp; retention starts counting from this upgrade.
            db.prepare("UPDATE processed_requests SET createdAt=? WHERE createdAt=''").run(
                new Date().toISOString()
            );
            db.exec(
                'CREATE INDEX IF NOT EXISTS processed_requests_createdAt ON processed_requests(createdAt)'
            );
        }
    },
    {
        version: 3,
        name: 'hub_outbox_sequence',
        up(db) {
            db.exec(
                'CREATE TABLE IF NOT EXISTS hub_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, sequence INTEGER, digest TEXT NOT NULL, payload TEXT NOT NULL, createdAt TEXT NOT NULL)'
            );
            // Hub sequence is a durable counter, independent of outbox row ids, so it survives
            // outbox deletion and can be advanced when the hub reports a newer sequence.
            addColumn(db, 'hub_outbox', 'sequence INTEGER');
            db.exec('UPDATE hub_outbox SET sequence=id WHERE sequence IS NULL');
            db.exec(
                'CREATE UNIQUE INDEX IF NOT EXISTS hub_outbox_sequence ON hub_outbox(sequence)'
            );
            const lastRowId =
                db.prepare("SELECT seq FROM sqlite_sequence WHERE name='hub_outbox'").get()?.seq ||
                0;
            const lastQueued = db.prepare('SELECT MAX(sequence) AS s FROM hub_outbox').get().s || 0;
            db.prepare("INSERT OR IGNORE INTO app_meta VALUES ('hub_sequence', ?)").run(
                String(Math.max(Number(lastRowId), Number(lastQueued)))
            );
        }
    },
    {
        version: 4,
        name: 'product_media_and_condition',
        up(db) {
            addColumn(db, 'products', "images TEXT DEFAULT '[]'");
            addColumn(db, 'products', "videoUrl TEXT DEFAULT ''");
            addColumn(db, 'products', "condition TEXT DEFAULT 'new'");
            addColumn(db, 'products', "conditionDetail TEXT DEFAULT ''");
            addColumn(db, 'products', "description TEXT DEFAULT ''");
            addColumn(db, 'shared_products', "images TEXT DEFAULT '[]'");
            addColumn(db, 'shared_products', "videoUrl TEXT DEFAULT ''");
            addColumn(db, 'shared_products', "condition TEXT DEFAULT 'new'");
            addColumn(db, 'shared_products', "conditionDetail TEXT DEFAULT ''");
            addColumn(db, 'shared_products', "description TEXT DEFAULT ''");
        }
    },
    {
        version: 5,
        name: 'imei_media_and_details',
        up(db) {
            addColumn(db, 'products', "imeiDetails TEXT DEFAULT '{}'");
            addColumn(db, 'shared_products', "imeiDetails TEXT DEFAULT '{}'");
        }
    },
    {
        version: 6,
        name: 'invoice_list_indexes',
        up(db) {
            db.exec(
                `CREATE INDEX IF NOT EXISTS invoices_branch_list ON invoices(COALESCE(NULLIF(branch,''), '${FALLBACK_BRANCH.replace(/'/g, "''")}'))`
            );
            db.exec('CREATE INDEX IF NOT EXISTS returns_invoice_code ON returns(invoiceCode)');
        }
    },
    {
        version: 7,
        name: 'public_catalogs',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS public_catalogs (
                    id TEXT PRIMARY KEY,
                    token TEXT NOT NULL UNIQUE,
                    branch TEXT NOT NULL DEFAULT '',
                    createdBy TEXT NOT NULL,
                    createdByName TEXT NOT NULL DEFAULT '',
                    title TEXT NOT NULL,
                    message TEXT NOT NULL DEFAULT '',
                    contactName TEXT NOT NULL DEFAULT '',
                    contactPhone TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'active',
                    expiresAt TEXT,
                    createdAt TEXT NOT NULL,
                    updatedAt TEXT NOT NULL,
                    revokedAt TEXT
                );
                CREATE TABLE IF NOT EXISTS public_catalog_items (
                    id TEXT PRIMARY KEY,
                    catalogId TEXT NOT NULL,
                    sourceType TEXT NOT NULL DEFAULT 'local',
                    sourceProductId TEXT NOT NULL DEFAULT '',
                    productCode TEXT NOT NULL DEFAULT '',
                    imei TEXT NOT NULL DEFAULT '',
                    sortOrder INTEGER NOT NULL DEFAULT 0,
                    name TEXT NOT NULL,
                    category TEXT NOT NULL DEFAULT '',
                    displayPrice REAL NOT NULL DEFAULT 0,
                    description TEXT NOT NULL DEFAULT '',
                    condition TEXT NOT NULL DEFAULT 'new',
                    conditionDetail TEXT NOT NULL DEFAULT '',
                    images TEXT NOT NULL DEFAULT '[]',
                    availabilitySnapshot TEXT NOT NULL DEFAULT 'in_stock',
                    createdAt TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS public_catalogs_token_active ON public_catalogs(token, status, expiresAt);
                CREATE INDEX IF NOT EXISTS public_catalog_items_catalog_order ON public_catalog_items(catalogId, sortOrder);
            `);
        }
    },
    {
        version: 8,
        name: 'public_catalog_item_imei',
        up(db) {
            addColumn(db, 'public_catalog_items', "imei TEXT NOT NULL DEFAULT ''");
        }
    },
    {
        version: 9,
        name: 'api_tokens',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS api_tokens (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    tokenHash TEXT NOT NULL UNIQUE,
                    maskedToken TEXT NOT NULL,
                    branch TEXT NOT NULL DEFAULT '',
                    createdBy TEXT NOT NULL,
                    createdByName TEXT NOT NULL DEFAULT '',
                    scopes TEXT NOT NULL DEFAULT '["products:read"]',
                    status TEXT NOT NULL DEFAULT 'active',
                    expiresAt TEXT,
                    lastUsedAt TEXT,
                    createdAt TEXT NOT NULL,
                    updatedAt TEXT NOT NULL,
                    revokedAt TEXT
                );
                CREATE INDEX IF NOT EXISTS api_tokens_hash_status ON api_tokens(tokenHash, status, expiresAt);
            `);
        }
    },
    {
        version: 10,
        name: 'deplao_send_jobs',
        up(db) {
            db.exec(`
                CREATE TABLE IF NOT EXISTS deplao_send_jobs (
                    id TEXT PRIMARY KEY,
                    userId TEXT NOT NULL,
                    branch TEXT NOT NULL,
                    digest TEXT NOT NULL,
                    status TEXT NOT NULL,
                    uploaded INTEGER NOT NULL DEFAULT 0,
                    total INTEGER NOT NULL,
                    result TEXT NOT NULL DEFAULT '{}',
                    createdAt TEXT NOT NULL,
                    updatedAt TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS deplao_send_jobs_user ON deplao_send_jobs(userId, createdAt);
            `);
        }
    }
];

const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

// Caller owns the transaction so schema changes commit or roll back with seeding.
function applyMigrations(db, context) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, appliedAt TEXT NOT NULL);
    `);
    const applied = new Set(
        db
            .prepare('SELECT version FROM schema_migrations')
            .all()
            .map((row) => row.version)
    );
    const record = db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)');
    for (const migration of MIGRATIONS) {
        if (applied.has(migration.version)) continue;
        migration.up(db, context);
        record.run(migration.version, migration.name, new Date().toISOString());
    }
    db.prepare("INSERT OR REPLACE INTO app_meta VALUES ('schema_version', ?)").run(
        String(LATEST_SCHEMA_VERSION)
    );
}

// Data invariants checked on every start, independent of schema version.
function repairData(db) {
    db.prepare("UPDATE products SET status='archived' WHERE status='inactive'").run();
    // Migrate existing credentials without changing the user's password or business data.
    for (const user of db.prepare('SELECT id, password FROM users').all()) {
        if (!user.password?.startsWith('scrypt$'))
            db.prepare('UPDATE users SET password=? WHERE id=?').run(
                hashPassword(user.password || ''),
                user.id
            );
    }
}

module.exports = { applyMigrations, repairData, LATEST_SCHEMA_VERSION, MIGRATIONS };
