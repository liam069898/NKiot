'use strict';
// Đo hiệu năng HTTP handler trên database tạm với dữ liệu giả.
// Dùng: node scripts/bench.js [số_hóa_đơn=5000] [số_sản_phẩm=2000] [số_lần=20]
const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path'),
    crypto = require('node:crypto');
const { PassThrough } = require('node:stream');
const [invoiceCount = 5000, productCount = 2000, runs = 20] = process.argv
    .slice(2)
    .map((v) => Number.parseInt(v, 10));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minikiot-bench-'));
process.env.NKIOT_DB_PATH = process.env.MINIKIOT_DB_PATH = path.join(dir, 'bench.db');
process.env.NKIOT_UPLOADS_DIR = path.join(dir, 'uploads');
// Benchmarks must never contact an operational Hub inherited from the shell.
delete process.env.NKIOT_HUB_URL;
delete process.env.NKIOT_HUB_API_KEY;
process.env.MINIKIOT_ADMIN_PASSWORD = 'Bench-password-123';
const db = require('../db');
const { handler } = require('../server');
const { hashPassword } = require('../security');
const { defaultData } = require('../data');

function seed() {
    const d = JSON.parse(JSON.stringify(defaultData));
    for (const table of db.ENTITY_TABLES)
        if (!['branches', 'categories'].includes(table)) d[table] = [];
    const branch = d.branches[0].name;
    for (let i = 0; i < productCount; i++)
        d.products.push({
            id: `P${i}`,
            code: `P${i}`,
            name: `Sản phẩm ${i}`,
            category: 'Bench',
            price: 100000,
            costPrice: 50000,
            stock: 1000000,
            minStock: 0,
            unit: 'Chiếc',
            barcode: '',
            status: 'active',
            branch,
            hasImei: false,
            imeis: []
        });
    for (let i = 0; i < 500; i++)
        d.customers.push({
            id: `C${i}`,
            code: `C${i}`,
            name: `Khách ${i}`,
            phone: `09${String(i).padStart(8, '0')}`,
            address: '',
            debt: 0,
            totalSpent: 0,
            points: 0
        });
    for (let i = 0; i < invoiceCount; i++) {
        const code = `P${i % productCount}`;
        d.invoices.push({
            id: `HD${i}`,
            code: `HD${i}`,
            time: '01/01/2026 08:00',
            customerId: `C${i % 500}`,
            customer: `Khách ${i % 500}`,
            phone: `09${String(i % 500).padStart(8, '0')}`,
            items: [
                {
                    code,
                    name: code,
                    qty: 1,
                    price: 100000,
                    costPrice: 50000,
                    total: 100000,
                    discount: 0,
                    netTotal: 100000
                }
            ],
            total: 100000,
            discount: 0,
            paid: 100000,
            status: 'completed',
            cashier: 'Admin',
            branch,
            paymentMethod: 'cash'
        });
    }
    d.users = [
        {
            ...defaultData.users[0],
            password: hashPassword('Bench-password-123'),
            status: 'active'
        }
    ];
    return { data: d, branch };
}

function request(method, url, input, cookie, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
        const req = new PassThrough();
        req.method = method;
        req.url = url;
        req.headers = {
            host: 'localhost',
            'content-type': 'application/json',
            ...(cookie ? { cookie } : {}),
            ...extraHeaders
        };
        req.socket = { remoteAddress: '127.0.0.1' };
        const headers = {};
        const res = {
            headersSent: false,
            setHeader(k, v) {
                headers[k.toLowerCase()] = v;
            },
            writeHead(status, h) {
                this.status = status;
                Object.assign(headers, h);
                this.headersSent = true;
            },
            end(body) {
                resolve({ status: this.status, headers, body });
            }
        };
        handler(req, res).catch(reject);
        req.end(input === undefined ? '' : JSON.stringify(input));
    });
}

async function time(label, fn) {
    const samples = [];
    let size = 0;
    for (let i = 0; i < runs; i++) {
        const start = process.hrtime.bigint();
        const res = await fn();
        samples.push(Number(process.hrtime.bigint() - start) / 1e6);
        if (res.status >= 400) throw new Error(`${label}: HTTP ${res.status} ${res.body}`);
        size = res.body ? Buffer.byteLength(res.body) : 0;
    }
    samples.sort((a, b) => a - b);
    const pick = (q) => samples[Math.min(samples.length - 1, Math.floor(samples.length * q))];
    console.log(
        `${label.padEnd(30)} median ${pick(0.5).toFixed(1).padStart(8)} ms` +
            `   p90 ${pick(0.9).toFixed(1).padStart(8)} ms   body ${(size / 1024).toFixed(0)} KB`
    );
}

async function main() {
    db.initDb();
    const { data, branch } = seed();
    db.saveAllData(data);
    const login = await request('POST', '/api/login', {
        username: 'admin',
        password: 'Bench-password-123'
    });
    if (login.status !== 200) throw new Error(`Login thất bại: ${login.body}`);
    const cookie = login.headers['set-cookie'].split(';')[0];
    console.log(`Dữ liệu: ${invoiceCount} hóa đơn, ${productCount} sản phẩm, 500 khách.`);
    console.log(
        `Mỗi phép đo chạy ${runs} lần. Sale writer: ${process.env.NKIOT_SALE_WRITE_MODE === 'snapshot' ? 'snapshot' : 'direct'}.\n`
    );
    await time('GET /api/data', () => request('GET', '/api/data', undefined, cookie));
    await time('GET /api/invoices (50)', () =>
        request('GET', '/api/invoices?pageSize=50', undefined, cookie)
    );
    await time('GET /api/data (gzip)', () =>
        request('GET', '/api/data', undefined, cookie, { 'accept-encoding': 'gzip' })
    );
    let revision = JSON.parse((await request('GET', '/api/data', undefined, cookie)).body).revision;
    for (const delta of [false, true])
        await time(`POST /api/command (sale${delta ? ', delta' : ''})`, async () => {
            const res = await request(
                'POST',
                '/api/command',
                {
                    type: 'sale',
                    requestId: crypto.randomUUID(),
                    revision,
                    payload: {
                        branch,
                        items: [{ code: 'P1', qty: 1 }],
                        discount: 0,
                        given: 100000,
                        paymentMethod: 'cash'
                    }
                },
                cookie,
                {
                    'x-minikiot-csrf': JSON.parse(login.body).csrfToken,
                    ...(delta ? { 'x-minikiot-base': String(revision) } : {})
                }
            );
            if (res.status === 200) revision = JSON.parse(res.body).revision;
            return res;
        });
    const application = require('../application');
    const { buildCatalogPatch } = require('../catalog-patch');
    for (const type of ['edit', 'catalogPatch']) {
        let requestBytes = 0;
        await time(`POST catalog (${type})`, async () => {
            const snapshot = db.readSnapshot();
            const base = application.project(snapshot, snapshot.users[0]);
            const draft = {
                ...base,
                products: base.products.map((p, index) =>
                    index === 0 ? { ...p, price: p.price + 1 } : p
                )
            };
            const payload =
                type === 'edit' ? structuredClone(draft) : buildCatalogPatch(base, draft);
            const envelope = { type, payload, revision, requestId: crypto.randomUUID() };
            requestBytes = Buffer.byteLength(JSON.stringify(envelope));
            const res = await request('POST', '/api/command', envelope, cookie, {
                'x-minikiot-csrf': JSON.parse(login.body).csrfToken,
                'x-minikiot-base': String(revision)
            });
            if (res.status === 200) revision = JSON.parse(res.body).revision;
            return res;
        });
        console.log(`  Request payload: ${requestBytes} bytes`);
    }
    await time('GET /app.js', () => request('GET', '/app.js'));
    await time('GET /app.js (gzip)', () =>
        request('GET', '/app.js', undefined, undefined, { 'accept-encoding': 'gzip' })
    );
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => {
        try {
            db.getDb().close();
        } catch {}
        fs.rmSync(dir, { recursive: true, force: true });
    });
