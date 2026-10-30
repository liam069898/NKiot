'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const MIGRATIONS = [
    {
        version: 1,
        name: 'initial_schema',
        up(d) {
            d.exec(`
                CREATE TABLE IF NOT EXISTS tenants (
                    id TEXT PRIMARY KEY,
                    slug TEXT UNIQUE NOT NULL,
                    name TEXT NOT NULL,
                    apiKeyHash TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    createdAt TEXT NOT NULL,
                    updatedAt TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS tenant_partners (
                    tenantId TEXT NOT NULL,
                    partnerTenantId TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    createdAt TEXT NOT NULL,
                    PRIMARY KEY (tenantId, partnerTenantId)
                );
                CREATE TABLE IF NOT EXISTS catalog_products (
                    id TEXT PRIMARY KEY,
                    ownerTenantId TEXT NOT NULL,
                    sourceProductId TEXT NOT NULL,
                    code TEXT DEFAULT '', name TEXT NOT NULL, category TEXT DEFAULT '',
                    price REAL NOT NULL DEFAULT 0, wholesalePrice REAL NOT NULL DEFAULT 0,
                    unit TEXT DEFAULT '', barcode TEXT DEFAULT '',
                    availability TEXT NOT NULL DEFAULT 'out_of_stock', minOrderQty INTEGER NOT NULL DEFAULT 1,
                    note TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'active',
                    sourceUpdatedAt TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
                    UNIQUE(ownerTenantId, sourceProductId)
                );
                CREATE INDEX IF NOT EXISTS catalog_products_owner_status ON catalog_products(ownerTenantId, status);
                CREATE TABLE IF NOT EXISTS tenant_sync_state (
                    tenantId TEXT PRIMARY KEY, sequence INTEGER NOT NULL, digest TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS partner_invite_tokens (
                    token TEXT PRIMARY KEY,
                    ownerTenantId TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    consumedByTenantId TEXT,
                    createdAt TEXT NOT NULL,
                    consumedAt TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_invite_tokens_owner ON partner_invite_tokens(ownerTenantId, status);
            `);
        }
    },
    {
        version: 2,
        name: 'catalog_media_and_condition',
        up(d) {
            function hasCol(table, col) {
                return d
                    .prepare(`PRAGMA table_info(${table})`)
                    .all()
                    .some((i) => i.name === col);
            }
            function addCol(table, def) {
                const col = def.split(/\s+/, 1)[0];
                if (!hasCol(table, col)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${def}`);
            }
            addCol('catalog_products', "images TEXT DEFAULT '[]'");
            addCol('catalog_products', "videoUrl TEXT DEFAULT ''");
            addCol('catalog_products', "condition TEXT DEFAULT 'new'");
            addCol('catalog_products', "conditionDetail TEXT DEFAULT ''");
            addCol('catalog_products', "description TEXT DEFAULT ''");
        }
    },
    {
        version: 3,
        name: 'catalog_imei_details',
        up(d) {
            function hasCol(table, col) {
                return d
                    .prepare(`PRAGMA table_info(${table})`)
                    .all()
                    .some((i) => i.name === col);
            }
            function addCol(table, def) {
                const col = def.split(/\s+/, 1)[0];
                if (!hasCol(table, col)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${def}`);
            }
            addCol('catalog_products', "imeiDetails TEXT DEFAULT '{}'");
            addCol('catalog_products', "imeis TEXT DEFAULT '[]'");
        }
    },
    {
        version: 4,
        name: 'tenant_media_store',
        up(d) {
            // Ảnh do tenant đẩy lên Hub để đối tác xem được qua proxy.
            // id = sha256(ownerTenantId + '|' + originalPath) → xác định được, không cần bảng mapping.
            d.exec(`
                CREATE TABLE IF NOT EXISTS tenant_media (
                    id TEXT PRIMARY KEY,
                    ownerTenantId TEXT NOT NULL,
                    originalPath TEXT NOT NULL,
                    mime TEXT NOT NULL,
                    size INTEGER NOT NULL,
                    createdAt TEXT NOT NULL,
                    UNIQUE(ownerTenantId, originalPath)
                );
                CREATE INDEX IF NOT EXISTS idx_tenant_media_owner ON tenant_media(ownerTenantId);
            `);
        }
    }
];

function migrate(d) {
    d.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            appliedAt TEXT NOT NULL
        );
    `);
    const applied = new Set(
        d
            .prepare('SELECT version FROM schema_migrations')
            .all()
            .map(({ version }) => version)
    );
    const record = d.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)');
    for (const migration of MIGRATIONS) {
        if (applied.has(migration.version)) continue;
        migration.up(d);
        record.run(migration.version, migration.name, new Date().toISOString());
    }
}

let db;

function getDb() {
    if (!db) initDb();
    return db;
}

function initDb(file = process.env.NKIOT_HUB_DB_PATH || path.join(__dirname, 'hub.db')) {
    if (db) closeDb();
    db = new DatabaseSync(file);
    db.exec('SELECT 1;');
    try {
        db.exec('PRAGMA journal_mode = WAL;');
    } catch {
        try {
            db.exec('PRAGMA journal_mode = DELETE;');
        } catch {}
    }
    db.exec('BEGIN IMMEDIATE');
    try {
        migrate(db);
        db.exec('COMMIT');
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
    return db;
}

function closeDb() {
    if (db) {
        try {
            db.close();
        } catch {}
    }
    db = null;
}

module.exports = { initDb, getDb, closeDb };
