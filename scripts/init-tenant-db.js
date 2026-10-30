'use strict';
const db = require('../db');
const { hashPassword } = require('../security');

const name = process.env.NKIOT_TENANT_NAME || '';
const username = process.env.NKIOT_TENANT_ADMIN_USERNAME || '';
const password = process.env.NKIOT_TENANT_ADMIN_PASSWORD || '';
if (!name || !username || password.length < 8) throw new Error('Thiếu cấu hình khởi tạo tenant.');

const BRANCH = 'Chi nhánh chính';
// Seed data belongs to the demo store; a new seller starts with its own name and blank contacts.
const BLANK_SETTINGS = [
    'phone',
    'hotline',
    'address',
    'bankCode',
    'bankName',
    'bankAccount',
    'bankOwner'
];

db.initDb();
const database = db.getDb();
const admin = database.prepare('SELECT id FROM users ORDER BY rowid LIMIT 1').get();
if (!admin) throw new Error('Không tạo được tài khoản quản trị.');
const setting = database.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
database.exec('BEGIN IMMEDIATE');
try {
    database.exec('DELETE FROM branches');
    database
        .prepare(
            "INSERT INTO branches (id, code, name, phone, address, isDefault, note) VALUES ('CN01', 'CN01', ?, '', '', 1, '')"
        )
        .run(BRANCH);
    for (const [key, value] of [
        ['storeName', name],
        ['logoText', name],
        ['branch', BRANCH],
        ['cashier', name],
        ...BLANK_SETTINGS.map((key) => [key, ''])
    ])
        setting.run(key, JSON.stringify(value));
    database
        .prepare(
            "UPDATE users SET name=?, username=?, password=?, phone='', branch=?, branches=? WHERE id=?"
        )
        .run(name, username, hashPassword(password), BRANCH, JSON.stringify([BRANCH]), admin.id);
    database.exec('COMMIT');
} catch (error) {
    database.exec('ROLLBACK');
    throw error;
}
database.close();
