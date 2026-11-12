'use strict';
// Lưu cấu hình Viettel Post phía server. Mật khẩu/token được mã hóa; không bao giờ
// gửi về trình duyệt. Cấu hình lưu trong app_meta (không nằm trong snapshot gửi client).

const crypto = require('node:crypto');
const db = require('./db');

const KEY_META = 'vtp_enc_key';
const CFG_META = 'vtp_config';

function encKey() {
    if (process.env.NKIOT_VTP_ENC_KEY) return process.env.NKIOT_VTP_ENC_KEY;
    const d = db.getDb();
    let key = d.prepare('SELECT value FROM app_meta WHERE key=?').get(KEY_META)?.value;
    if (!key) {
        key = crypto.randomBytes(32).toString('hex');
        d.prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)').run(KEY_META, key);
    }
    return key;
}

function encrypt(plain) {
    if (!plain) return '';
    const key = crypto.createHash('sha256').update(encKey()).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    return `enc:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
}

function decrypt(value) {
    if (!value || !value.startsWith('enc:')) return '';
    const [, ivHex, tagHex, dataHex] = value.split(':');
    try {
        const key = crypto.createHash('sha256').update(encKey()).digest();
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
        decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
        return Buffer.concat([
            decipher.update(Buffer.from(dataHex, 'hex')),
            decipher.final()
        ]).toString('utf8');
    } catch {
        return '';
    }
}

// Giá trị thật dùng khi gọi API (password/token đã giải mã).
function getResolvedConfig() {
    const stored = getConfig();
    return {
        baseUrl: stored.baseUrl || process.env.NKIOT_VTP_BASE_URL || '',
        username: stored.username || process.env.NKIOT_VTP_USERNAME || '',
        password: stored.password ? decrypt(stored.password) : process.env.NKIOT_VTP_PASSWORD || '',
        token: stored.token ? decrypt(stored.token) : process.env.NKIOT_VTP_TOKEN || '',
        webhookSecret: stored.webhookSecret || process.env.NKIOT_VTP_WEBHOOK_SECRET || ''
    };
}

function getConfig() {
    const d = db.getDb();
    const row = d.prepare('SELECT value FROM app_meta WHERE key=?').get(CFG_META);
    if (!row) return {};
    try {
        const parsed = JSON.parse(row.value);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

// Không trả password/token về client; chỉ trả trạng thái đã cấu hình hay chưa.
function publicStatus() {
    const c = getConfig();
    return {
        configured: Boolean(c.baseUrl && (c.password || c.token || c.username)),
        baseUrl: c.baseUrl || process.env.NKIOT_VTP_BASE_URL || '',
        username: c.username || process.env.NKIOT_VTP_USERNAME || ''
    };
}

function saveConfig(input) {
    const next = { ...getConfig() };
    if (typeof input.baseUrl === 'string') next.baseUrl = input.baseUrl.trim().slice(0, 500);
    if (typeof input.username === 'string') next.username = input.username.trim().slice(0, 200);
    if (typeof input.password === 'string' && input.password)
        next.password = encrypt(input.password);
    if (typeof input.token === 'string' && input.token) next.token = encrypt(input.token);
    if (typeof input.webhookSecret === 'string' && input.webhookSecret)
        next.webhookSecret = input.webhookSecret.trim().slice(0, 500);
    const d = db.getDb();
    d.prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)').run(
        CFG_META,
        JSON.stringify(next)
    );
    return publicStatus();
}

module.exports = { getConfig, getResolvedConfig, saveConfig, publicStatus };
