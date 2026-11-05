'use strict';
// Deplao local runtime. Secret file is read by backend only, never via settings.get.
const fs = require('node:fs');
const path = require('node:path');
function configuration(ctx) {
    let stored;
    try {
        const filename = path.join(ctx.dataDir, 'nkiot-connection.json');
        const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try {
            const stat = fs.fstatSync(fd);
            if (
                !stat.isFile() ||
                stat.size > 4096 ||
                (process.platform !== 'win32' && stat.mode & 0o077)
            )
                throw new Error('permissions');
            stored = JSON.parse(fs.readFileSync(fd, 'utf8'));
        } finally {
            fs.closeSync(fd);
        }
    } catch {
        throw new Error(
            'Thiếu nkiot-connection.json hợp lệ trong dataDir plugin (quyền 0600). Xem README cài đặt.'
        );
    }
    let url;
    try {
        url = new URL(stored.baseUrl);
    } catch {
        throw new Error('Địa chỉ NKiot trong file cấu hình không hợp lệ.');
    }
    if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/' ||
        !(
            url.protocol === 'https:' ||
            (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
        )
    ) {
        throw new Error('Dùng origin HTTPS (HTTP chỉ loopback), không có đường dẫn hoặc mật khẩu.');
    }
    const token = stored.token;
    if (typeof token !== 'string' || !/^nk_live_[A-Za-z0-9_-]+$/.test(token))
        throw new Error('Thiếu token NKiot hợp lệ (nk_live_...) trong nkiot-connection.json.');
    return { origin: url.origin, token };
}
async function get(ctx, route, binary = false) {
    const cfg = configuration(ctx);
    let res;
    try {
        res = await ctx.deplao.http.fetch(cfg.origin + route, {
            method: 'GET',
            headers: { Authorization: `Bearer ${cfg.token}` },
            timeoutMs: 12000,
            responseType: binary ? 'base64' : 'text'
        });
    } catch {
        throw new Error(
            'Không kết nối được NKiot. Kiểm tra HTTPS, mạng và chính sách chặn IP nội bộ của Deplao.'
        );
    }
    if (res.url !== cfg.origin + route)
        throw new Error('NKiot chuyển hướng URL; hãy cấu hình địa chỉ đích trực tiếp.');
    if (res.truncated)
        throw new Error(
            'Dữ liệu vượt giới hạn SDK Deplao (5 MB); giảm số sản phẩm hoặc kích thước ảnh.'
        );
    if (res.status !== 200) {
        const errors = {
            401: 'Token NKiot sai, hết hạn hoặc đã thu hồi.',
            403: 'Token không có quyền.',
            404: 'Sản phẩm hoặc ảnh không còn khả dụng.',
            429: 'Quá nhiều yêu cầu; chờ rồi thử lại.'
        };
        throw new Error(errors[res.status] || `NKiot trả HTTP ${res.status}.`);
    }
    return res;
}
const mediaPath = (value) =>
    typeof value === 'string' && /^\/api\/v1\/open\/media\/[a-f0-9]{64}$/.test(value);
const text = (value, max = 5000) => (typeof value === 'string' ? value.slice(0, max) : '');
const images = (list) => (Array.isArray(list) ? list.filter(mediaPath).slice(0, 20) : []);
async function search(params, ctx) {
    const page = Number(params.page || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000)
        throw new Error('Trang không hợp lệ.');
    const query = new URLSearchParams({ q: text(params.q, 200), page: String(page), limit: '12' });
    if (params.inStock === true) query.set('in_stock', 'true');
    for (const [field, key] of [
        ['minPrice', 'min_price'],
        ['maxPrice', 'max_price']
    ]) {
        if (params[field] !== undefined && params[field] !== '') {
            const n = Number(params[field]);
            if (!Number.isFinite(n) || n < 0) throw new Error('Giá không hợp lệ.');
            query.set(key, String(n));
        }
    }
    const response = await get(ctx, `/api/v1/open/products?${query}`);
    let out;
    try {
        out = JSON.parse(response.text);
    } catch {
        throw new Error('Phản hồi NKiot không phải JSON hợp lệ.');
    }
    if (!out.success || !Array.isArray(out.data))
        throw new Error('Phản hồi NKiot không đúng cấu trúc.');
    return {
        page,
        hasMore: out.hasMore === true,
        products: out.data.slice(0, 12).map((p) => ({
            code: text(p.code, 200),
            name: text(p.name, 200),
            description: text(p.description),
            price: Number.isFinite(p.price) ? p.price : 0,
            availability: p.availability === 'in_stock' ? 'in_stock' : 'out_of_stock',
            conditionDetail: text(p.conditionDetail),
            images: images(p.images),
            units: (Array.isArray(p.units) ? p.units : []).map((u) => ({
                id: text(u.id, 64),
                serialMasked: text(u.serialMasked, 32),
                conditionDetail: text(u.conditionDetail),
                images: images(u.images)
            }))
        }))
    };
}
async function image(params, ctx) {
    if (!mediaPath(params.path)) throw new Error('Đường dẫn ảnh không hợp lệ.');
    const res = await get(ctx, params.path, true);
    const mime = String(res.headers?.['content-type'] || '')
        .split(';')[0]
        .toLowerCase();
    if (
        !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime) ||
        typeof res.base64 !== 'string' ||
        res.base64.length > 7 * 1024 * 1024 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(res.base64)
    )
        throw new Error('Ảnh không hợp lệ hoặc quá lớn.');
    return { src: `data:${mime};base64,${res.base64}` };
}
module.exports = { commands: { search, image } };
