'use strict';
require('./test-env');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

let server;
let baseUrl;
let requests = [];

function respond(res, payload, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
}

before(async () => {
    server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (chunk) => (raw += chunk));
        req.on('end', () => {
            let body;
            try {
                body = raw ? JSON.parse(raw) : undefined;
            } catch {
                body = null;
            }
            requests.push({ method: req.method, url: req.url, headers: req.headers, body });
            if (req.url === '/v2/user/Login')
                return respond(res, {
                    status: 200,
                    error: false,
                    message: 'OK',
                    data: { token: 'short-token' }
                });
            if (req.url === '/v2/user/ownerconnect')
                return respond(res, {
                    status: 200,
                    error: false,
                    message: 'OK',
                    data: { token: 'long-token' }
                });
            if (req.url === '/v3/categories/listProvinceNew')
                return respond(res, {
                    status: 200,
                    error: false,
                    message: 'OK',
                    data: [{ PROVINCE_ID: 1 }]
                });
            if (req.url === '/v2/order/getPriceAll')
                return respond(res, {
                    status: 200,
                    error: false,
                    message: 'OK',
                    data: { services: [] }
                });
            if (req.url === '/v2/order/createOrder')
                return respond(res, {
                    status: 200,
                    error: false,
                    message: 'OK',
                    data: { ORDER_NUMBER: 'VP123', MONEY_COLLECTION: 1500000 }
                });
            if (req.url === '/v2/order/printing-code')
                return respond(res, {
                    status: 200,
                    error: false,
                    message: 'PRINT_CODE',
                    data: null
                });
            respond(res, { status: 404, error: true, message: 'not found' }, 404);
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    process.env.NKIOT_VTP_BASE_URL = baseUrl;
    process.env.NKIOT_VTP_USERNAME = 'partner';
    process.env.NKIOT_VTP_PASSWORD = 'secret';
    delete process.env.NKIOT_VTP_TOKEN;
});

after(async () => {
    delete process.env.NKIOT_VTP_BASE_URL;
    delete process.env.NKIOT_VTP_USERNAME;
    delete process.env.NKIOT_VTP_PASSWORD;
    await new Promise((resolve) => server.close(resolve));
});

test('viettelpost client uses Token header and the documented envelope', async () => {
    const client = require('../viettelpost-client');
    const out = await client.createOrder({ ORDER_NUMBER: 'REF1', CHECK_UNIQUE: true });
    assert.equal(out.data.ORDER_NUMBER, 'VP123');
    const call = requests.find((r) => r.url === '/v2/order/createOrder');
    assert.equal(call.headers['content-type'], 'application/json;charset=UTF-8');
    assert.equal(call.headers.token, undefined, 'login token not yet set');
    assert.equal(call.body.CHECK_UNIQUE, true);
});

test('viettelpost client maps error envelopes to thrown errors', async () => {
    const client = require('../viettelpost-client');
    const before = requests.length;
    await assert.rejects(client.wardsNew(1), /not found/);
    assert.equal(requests.length, before + 1);
});

test('viettelpost client rejects non-HTTPS base URL outside loopback', async () => {
    const previous = process.env.NKIOT_VTP_BASE_URL;
    process.env.NKIOT_VTP_BASE_URL = 'http://pos.example.test';
    const client = require('../viettelpost-client');
    await assert.rejects(client.provincesNew(), /HTTPS/);
    process.env.NKIOT_VTP_BASE_URL = previous;
});

test('viettelpost login and ownerconnect reuse username/password', async () => {
    const client = require('../viettelpost-client');
    const short = await client.login();
    assert.equal(short.data.token, 'short-token');
    const long = await client.ownerConnect('short-token');
    assert.equal(long.data.token, 'long-token');
    const connect = requests.find((r) => r.url === '/v2/user/ownerconnect');
    assert.equal(connect.headers.token, 'short-token');
});
