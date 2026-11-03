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

// Call only while every writer to the DB and uploads directory is stopped.
function hashFile(filename) {
    const crypto = require('node:crypto');
    const hash = crypto.createHash('sha256');
    const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const buffer = Buffer.allocUnsafe(64 * 1024);
        let count;
        while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0)
            hash.update(buffer.subarray(0, count));
    } finally {
        fs.closeSync(fd);
    }
    return hash.digest('hex');
}

function scanFiles(root) {
    const files = [];
    function visit(dir, prefix) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) visit(full, relative);
            else if (entry.isFile()) files.push(relative);
            else
                throw new Error(
                    `Không hỗ trợ symlink hoặc file đặc biệt trong bộ sao lưu: ${relative}`
                );
        }
    }
    visit(root, '');
    return files.sort();
}

function verifyBundle(directory) {
    const root = path.resolve(directory);
    const manifestPath = path.join(root, 'manifest.json');
    if (!fs.lstatSync(root).isDirectory() || !fs.lstatSync(manifestPath).isFile())
        throw new Error('Bộ sao lưu không hợp lệ.');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.version !== 1 || !Array.isArray(manifest.files))
        throw new Error('Manifest không hợp lệ.');
    const actual = scanFiles(root).filter((name) => name !== 'manifest.json');
    const expected = manifest.files.map((item) => item.path);
    if (
        new Set(expected).size !== expected.length ||
        JSON.stringify(actual) !== JSON.stringify([...expected].sort())
    )
        throw new Error('Danh sách file không khớp manifest.');
    if (!expected.includes('database.db')) throw new Error('Thiếu database trong bộ sao lưu.');
    for (const item of manifest.files) {
        if (
            typeof item.path !== 'string' ||
            !/^(database\.db|uploads\/[^\\]+)$/.test(item.path) ||
            item.path.split('/').some((part) => !part || part === '.' || part === '..')
        )
            throw new Error('Đường dẫn manifest không hợp lệ.');
        const file = path.join(root, ...item.path.split('/'));
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.size !== item.size || hashFile(file) !== item.sha256)
            throw new Error(`File sao lưu bị thay đổi: ${item.path}`);
    }
    validateBackup(path.join(root, 'database.db'));
    return manifest;
}

function createBundle(source, uploads, destination) {
    const target = path.resolve(destination);
    const media = path.resolve(uploads);
    if (!fs.lstatSync(media).isDirectory()) throw new Error('Thư mục uploads không hợp lệ.');
    const realMedia = fs.realpathSync(media);
    const parent = fs.realpathSync(path.dirname(target));
    const resolvedTarget = path.join(parent, path.basename(target));
    if (resolvedTarget === realMedia || resolvedTarget.startsWith(realMedia + path.sep))
        throw new Error('Không đặt bộ sao lưu trong thư mục uploads.');
    fs.mkdirSync(resolvedTarget, { mode: 0o700 });
    try {
        backupDatabase(source, path.join(resolvedTarget, 'database.db'));
        const out = path.join(resolvedTarget, 'uploads');
        fs.mkdirSync(out, { mode: 0o700 });
        for (const relative of scanFiles(realMedia)) {
            const dest = path.join(out, ...relative.split('/'));
            fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
            fs.copyFileSync(
                path.join(realMedia, ...relative.split('/')),
                dest,
                fs.constants.COPYFILE_EXCL
            );
            fs.chmodSync(dest, 0o600);
        }
        const files = scanFiles(resolvedTarget).map((relative) => {
            const file = path.join(resolvedTarget, ...relative.split('/'));
            return { path: relative, size: fs.statSync(file).size, sha256: hashFile(file) };
        });
        fs.writeFileSync(
            path.join(resolvedTarget, 'manifest.json'),
            JSON.stringify({ version: 1, createdAt: new Date().toISOString(), files }, null, 2) +
                '\n',
            { mode: 0o600, flag: 'wx' }
        );
        verifyBundle(resolvedTarget);
        return resolvedTarget;
    } catch (error) {
        fs.rmSync(resolvedTarget, { recursive: true, force: true });
        throw error;
    }
}

if (require.main === module) {
    const source = require('./runtime-paths').resolveDbPath();
    const [first, second, third] = process.argv.slice(2);
    try {
        if (first === '--bundle' && second && third === '--writers-stopped') {
            const uploads =
                process.env.NKIOT_UPLOADS_DIR || path.join(__dirname, 'public', 'uploads');
            console.log(
                'Đã sao lưu và kiểm tra DB + uploads:',
                createBundle(source, uploads, second)
            );
        } else if (first === '--verify-bundle' && second) {
            verifyBundle(second);
            console.log('Bộ sao lưu DB + uploads hợp lệ:', path.resolve(second));
        } else if (first === '--verify' && second) {
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
                'Cách dùng:\n  npm run backup -- /duong-dan/ban-sao.db\n  npm run backup -- --rotate /thu-muc-sao-luu [so-ban-giu=7]\n  npm run backup -- --verify /duong-dan/ban-sao.db\n  npm run backup -- --bundle /thu-muc-moi --writers-stopped\n  npm run backup -- --verify-bundle /thu-muc-moi\nDừng mọi tiến trình ghi DB và uploads trước khi tạo bundle.'
            );
            process.exitCode = 1;
        }
    } catch (error) {
        console.error('Sao lưu thất bại:', error.message);
        process.exitCode = 1;
    }
}

module.exports = { backupDatabase, validateBackup, rotateBackups, createBundle, verifyBundle };
