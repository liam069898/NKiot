'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { defaultData } = require('../data');
const domain = require('../domain');

function loadClientStore(initialData) {
    const ctx = {
        FALLBACK_BRANCH: 'Kalo HCM',
        generateCode: require('../constants').generateCode,
        CODE_PREFIXES: require('../constants').CODE_PREFIXES,
        crypto: globalThis.crypto,
        window: { addEventListener() {} },
        document: {
            getElementById() {
                return null;
            }
        },
        localStorage: {
            getItem() {
                return null;
            },
            setItem() {},
            removeItem() {}
        }
    };
    vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, '..', 'client-store.js'), 'utf8') +
            ';this.KVStore = KVStore; this.makeCode = makeCode; this.makeRequestId = makeRequestId;',
        ctx
    );
    if (initialData) {
        ctx.KVStore.data = JSON.parse(JSON.stringify(initialData));
    }
    return ctx;
}

test('frontend makeCode generates NKiot auto-increment numbers for default data', () => {
    const ctx = loadClientStore(defaultData);
    const { makeCode, KVStore } = ctx;

    assert.equal(makeCode('SP'), 'SP010');
    assert.equal(makeCode('HD'), 'HD005703');
    assert.equal(makeCode('PN'), 'PN003091');
    assert.equal(makeCode('PCH'), 'PCH000003');
    assert.equal(makeCode('PKK'), 'PKK000003');
    assert.equal(makeCode('TH'), 'TH000002');
    assert.equal(makeCode('KH'), 'KH0014');
    assert.equal(makeCode('NCC'), 'NCC000043');
    assert.equal(makeCode('PT'), 'PT0005');
    assert.equal(makeCode('PC'), 'PC0004');
    assert.equal(makeCode('CN'), 'CN03');
    assert.equal(makeCode('NV'), 'NV0005');
    assert.equal(makeCode('CAT'), 'CAT0303');

    // Simulate adding SP010 and check next
    KVStore.data.products.push({ id: 'SP010', code: 'SP010' });
    assert.equal(makeCode('SP'), 'SP011');
});

test('frontend makeCode handles empty data and custom prefixes correctly', () => {
    const emptyData = {
        products: [],
        invoices: [],
        imports: [],
        transfers: [],
        stocktakes: [],
        returns: [],
        customers: [],
        suppliers: [],
        cashbook: [],
        branches: [],
        users: [],
        categories: []
    };
    const ctx = loadClientStore(emptyData);
    const { makeCode } = ctx;

    assert.equal(makeCode('SP'), 'SP001');
    assert.equal(makeCode('HD'), 'HD000001');
    assert.equal(makeCode('PN'), 'PN000001');
    assert.equal(makeCode('PCH'), 'PCH000001');
    assert.equal(makeCode('PKK'), 'PKK000001');
    assert.equal(makeCode('TH'), 'TH000001');
    assert.equal(makeCode('KH'), 'KH0001');
    assert.equal(makeCode('NCC'), 'NCC000001');
    assert.equal(makeCode('PT'), 'PT0001');
    assert.equal(makeCode('PC'), 'PC0001');
    assert.equal(makeCode('CN'), 'CN01');
    assert.equal(makeCode('NV'), 'NV0001');
    assert.equal(makeCode('CAT'), 'CAT01');
    assert.equal(makeCode('TX'), 'TX000001');
});

test('shared generator treats a row code and ID as occupied values', () => {
    const { generateCode } = require('../constants');
    assert.equal(generateCode({ products: [{ id: 'SP010', code: 'SKU-A' }] }, 'SP'), 'SP011');
    assert.equal(
        generateCode({ cashbook: [{ id: 'PT0007', code: 'PT0007', type: 'chi' }] }, 'PT'),
        'PT0001'
    );
});

test('backend domain commands generate NKiot auto-increment numbers', () => {
    const data = JSON.parse(JSON.stringify(defaultData));
    const user = { ...defaultData.users[0], status: 'active' };

    // Sale generates HD005697
    const inv = domain.execute(data, user, 'sale', {
        branch: 'Kalo HCM',
        items: [{ code: 'SP001', qty: 1 }],
        customerId: null,
        given: 6000000,
        paymentMethod: 'cash'
    });
    assert.equal(inv.code, 'HD005703');
    assert.equal(inv.id, 'HD005703');

    // Return generates TH000002
    const ret = domain.execute(data, user, 'return', {
        invoiceId: inv.id,
        items: [{ code: 'SP001', qty: 1, imeis: inv.items[0].imeis }],
        refundMethod: 'cash'
    });
    assert.equal(ret.code, 'TH000002');
    assert.equal(ret.id, 'TH000002');

    // Transfer generates PCH000003
    const tr = domain.execute(data, user, 'transfer', {
        fromBranch: 'Kalo HCM',
        toBranch: 'Chi nhánh Hà Nội',
        items: [{ code: 'SP001', qty: 1 }]
    });
    assert.equal(tr.code, 'PCH000003');
    assert.equal(tr.id, 'PCH000003');

    // Stocktake generates PKK000003
    const pSP = data.products.find((p) => p.code === 'SP001' && p.branch === 'Kalo HCM');
    const st = domain.execute(data, user, 'stocktake', {
        branch: 'Kalo HCM',
        items: [{ code: 'SP001', systemStock: pSP.stock, actualStock: pSP.stock }],
        balance: false
    });
    assert.equal(st.code, 'PKK000003');
    assert.equal(st.id, 'PKK000003');

    // Cash voucher generates PT0006 (since sale already generated PT0005)
    domain.execute(data, user, 'cash', {
        branch: 'Kalo HCM',
        type: 'thu',
        category: 'Thu khác',
        amount: 50000,
        person: 'Nguyễn Văn A',
        method: 'cash'
    });
    assert.equal(data.cashbook[0].code, 'PT0006');

    // Cash voucher generates PC0005 (since return refund already generated PC0004)
    domain.execute(data, user, 'cash', {
        branch: 'Kalo HCM',
        type: 'chi',
        category: 'Chi khác',
        amount: 25000,
        person: 'Nguyễn Văn B',
        method: 'cash'
    });
    assert.equal(data.cashbook[0].code, 'PC0005');
});
