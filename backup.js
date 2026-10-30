'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// VACUUM INTO includes committed WAL data and creates a consistent standalone file.
function backupDatabase(source, destination) {
    if (!fs.existsSync(source)) throw new Error('Không tìm thấy cơ sở dữ liệu nguồn.');
    if (fs.existsSync(destination)) throw new Error('File đích đã tồn tại; chọn tên mới.');
    const database = new DatabaseSync(source, { readOnly: true });
    try {
        database.exec('PRAGMA busy_timeout = 5000');
        database.prepare('VACUUM INTO ?').run(path.resolve(destination));
    } finally {
        database.close();
    }
    return path.resolve(destination);
}

// Validate independently before relying on a snapshot or removing older snapshots.
function validateBackup(filename) {
    if (!fs.existsSync(filename)) throw new Error('Không tìm thấy bản sao.');
    const database = new DatabaseSync(filename, { readOnly: true });
    try {
        const integrity = database.prepare('PRAGMA integrity_check').all();
        if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok')
            throw new Error('Bản sao không vượt qua integrity_check.');
        for (const table of ['app_meta', 'users', 'products', 'invoices', 'audit_log'])
            database.prepare(`SELECT count(*) FROM ${table}`).get();
        return true;
    } finally {
        database.close();
    }
}

function rotateBackups(source, directory, keep = 7) {
    if (!Number.isSafeInteger(keep) || keep < 1) throw new Error('Số bản sao phải lớn hơn 0.');
    const dir = path.resolve(directory);
    if (!fs.statSync(dir).isDirectory()) throw new Error('Đường dẫn đích không phải thư mục.');
    const filename = `minikiot-${new Date().toISOString().replace(/[:.]/g, '-')}-${require('node:crypto').randomBytes(4).toString('hex')}.db`;
    const destination = path.join(dir, filename);
    backupDatabase(source, destination);
    try {
        validateBackup(destination);
    } catch (error) {
        // An unverified file must never count as one of the retained good snapshots.
        fs.unlinkSync(destination);
        throw error;
    }
    const files = fs
        .readdirSync(dir)
        .filter((name) => /^minikiot-\d{4}-\d\d-\d\dT[\d-]+Z-[0-9a-f]{8}\.db$/.test(name))
        .sort()
        .reverse();
    for (const old of files.slice(keep)) fs.unlinkSync(path.join(dir, old));
    return destination;
}

if (require.main === module) {
    const source = require('./runtime-paths').resolveDbPath();
    const [first, second, third] = process.argv.slice(2);
    try {
        if (first === '--verify' && second) {
            validateBackup(second);
            console.log('Bản sao hợp lệ:', path.resolve(second));
        } else if (first === '--rotate' && second) {
            const keep = third === undefined ? 7 : Number(third);
            console.log('Đã sao lưu và kiểm tra:', rotateBackups(source, second, keep));
        } else if (first && !first.startsWith('--')) {
            const destination = backupDatabase(source, first);
            validateBackup(destination);
            console.log('Đã sao lưu và kiểm tra:', destination);
        } else {
            console.error(
                'Cách dùng:\n  npm run backup -- /duong-dan/ban-sao.db\n  npm run backup -- --rotate /thu-muc-sao-luu [so-ban-giu=7]\n  npm run backup -- --verify /duong-dan/ban-sao.db'
            );
            process.exitCode = 1;
        }
    } catch (error) {
        console.error('Sao lưu thất bại:', error.message);
        process.exitCode = 1;
    }
}

module.exports = { backupDatabase, validateBackup, rotateBackups };
