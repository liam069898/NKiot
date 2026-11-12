'use strict';
// Client gọi API Viettel Post. Token chỉ nằm ở backend, không bao giờ gửi về trình duyệt.
// Hợp đồng bám theo tài liệu Viettel Post: header `Token`, envelope { status, error, message, data }.

const config = () => ({
    baseUrl: (process.env.NKIOT_VTP_BASE_URL || '').replace(/\/+$/, ''),
    username: process.env.NKIOT_VTP_USERNAME || '',
    password: process.env.NKIOT_VTP_PASSWORD || '',
    token: process.env.NKIOT_VTP_TOKEN || ''
});

let configResolver = null;
function setConfigResolver(fn) {
    configResolver = fn;
}
function effectiveConfig() {
    if (configResolver) {
        try {
            const stored = configResolver();
            if (stored && (stored.baseUrl || stored.token || stored.username || stored.password))
                return stored;
        } catch {}
    }
    return config();
}

const enabled = () => {
    const c = effectiveConfig();
    return !!c.baseUrl;
};

function assertBaseUrl(baseUrl) {
    let url;
    try {
        url = new URL(baseUrl);
    } catch {
        throw Object.assign(new Error('NKIOT_VTP_BASE_URL không phải URL hợp lệ.'), {
            status: 500
        });
    }
    if (!(
        url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    ))
        throw Object.assign(
            new Error('NKIOT_VTP_BASE_URL phải là HTTPS (HTTP chỉ cho 127.0.0.1/localhost).'),
            {
                status: 500
            }
        );
    return url.origin;
}

async function request(method, path, { body, token, timeoutMs = 15000 } = {}) {
    const effective = effectiveConfig();
    const origin = assertBaseUrl(effective.baseUrl);
    const auth = token || effective.token;
    const headers = { 'Content-Type': 'application/json;charset=UTF-8' };
    if (auth) headers.Token = auth;
    let res;
    try {
        res = await fetch(origin + path, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(timeoutMs),
            redirect: 'error'
        });
    } catch (err) {
        throw Object.assign(
            new Error(`Viettel Post không phản hồi: ${(err && err.message) || 'lỗi mạng'}.`),
            {
                status: 502
            }
        );
    }
    const payload = await res.json().catch(() => null);
    if (!res.ok && !payload) {
        throw Object.assign(new Error(`Viettel Post trả HTTP ${res.status}.`), { status: 502 });
    }
    // Envelope lỗi: error=true kèm message (chuỗi hoặc mảng).
    if (!payload || payload.error === true || payload.error === 'true') {
        const message = Array.isArray(payload?.message)
            ? payload.message.join('; ')
            : payload?.message || `Viettel Post trả HTTP ${res.status}.`;
        throw Object.assign(new Error(String(message)), { status: res.ok ? 502 : res.status });
    }
    return payload;
}

// Lấy token ngắn hạn bằng tài khoản Partner.
async function login() {
    const { username, password } = effectiveConfig();
    if (!username || !password)
        throw Object.assign(
            new Error('Chưa cấu hình tài khoản Viettel Post (NKIOT_VTP_USERNAME/PASSWORD).'),
            {
                status: 500
            }
        );
    return request('POST', '/v2/user/Login', { body: { USERNAME: username, PASSWORD: password } });
}

// Lấy token dài hạn/ủy quyền từ token của bước Login.
async function ownerConnect(token) {
    const { username, password } = effectiveConfig();
    return request('POST', '/v2/user/ownerconnect', {
        body: { USERNAME: username, PASSWORD: password },
        token
    });
}

// Danh mục địa chỉ hành chính mới (V3).
async function provincesNew() {
    return request('GET', '/v3/categories/listProvinceNew');
}
async function wardsNew(provinceId) {
    return request(
        'GET',
        `/v3/categories/listWardsNew?provinceId=${encodeURIComponent(provinceId)}`
    );
}

// Danh sách dịch vụ khả dụng + cước theo địa chỉ ID / địa chỉ chi tiết.
async function getPriceAll(payload) {
    return request('POST', '/v2/order/getPriceAll', { body: payload });
}
async function getPriceAllNlp(payload) {
    return request('POST', '/v2/order/getPriceAllNlp', { body: payload });
}

// Tính cước một dịch vụ cụ thể.
async function getPrice(payload) {
    return request('POST', '/v2/order/getPrice', { body: payload });
}
async function getPriceNlp(payload) {
    return request('POST', '/v2/order/getPriceNlp', { body: payload });
}

// Tạo vận đơn. CHECK_UNIQUE bật để hãng từ chối nếu ORDER_NUMBER đã tồn tại.
async function createOrder(payload) {
    return request('POST', '/v2/order/createOrder', { body: payload });
}
async function createOrderNlp(payload) {
    return request('POST', '/v2/order/createOrderNlp', { body: payload });
}

// TYPE: 1 duyệt đơn, 2 đồng ý hoàn, 3 phát tiếp, 4 hủy, 5 xóa đơn đã hủy.
async function updateOrder(type, orderNumber, note = '') {
    return request('POST', '/v2/order/UpdateOrder', {
        body: { TYPE: type, ORDER_NUMBER: orderNumber, NOTE: note }
    });
}

// Lấy mã in cho tối đa 100 vận đơn; mã in có thời hạn EXPIRY_TIME (milliseconds).
async function printingCode(orderNumbers, expiryTimeMs) {
    return request('POST', '/v2/order/printing-code', {
        body: { EXPIRY_TIME: expiryTimeMs, ORDER_ARRAY: orderNumbers }
    });
}

module.exports = {
    config,
    setConfigResolver,
    enabled,
    login,
    ownerConnect,
    provincesNew,
    wardsNew,
    getPriceAll,
    getPriceAllNlp,
    getPrice,
    getPriceNlp,
    createOrder,
    createOrderNlp,
    updateOrder,
    printingCode
};
