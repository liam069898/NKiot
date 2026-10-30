'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCatalogPatch, CATALOG_TABLES } = require('../catalog-patch');
function fixture() {
    return {
        ...Object.fromEntries(CATALOG_TABLES.map((table) => [table, []])),
        settings: { branch: 'A', storeName: 'Store' }
    };
}
test('patch builder skips transaction history and sends only changed rows/settings', () => {
    const base = fixture();
    base.products = Array.from({ length: 5000 }, (_, i) => ({
        id: `P${i}`,
        name: `Product ${i}`,
        price: 10
    }));
    const draft = structuredClone(base);
    draft.products[123].price = 11;
    draft.settings.branch = 'B';
    draft.settings.storeName = 'Updated';
    Object.defineProperty(base, 'invoices', {
        get() {
            throw new Error('History must not be read');
        }
    });
    Object.defineProperty(draft, 'invoices', {
        get() {
            throw new Error('History must not be read');
        }
    });
    const patch = buildCatalogPatch(base, draft);
    assert.deepEqual(patch, {
        tables: { products: { upsert: [draft.products[123]], remove: [] } },
        settings: { storeName: 'Updated' }
    });
    assert.ok(Buffer.byteLength(JSON.stringify(patch)) < 500);
});
test('patch builder detects removals, rejects duplicate IDs and ignores unchanged saves', () => {
    const base = fixture();
    base.customers = [
        { id: 'A', name: 'A' },
        { id: 'B', name: 'B' }
    ];
    const draft = structuredClone(base);
    assert.deepEqual(buildCatalogPatch(base, draft), { tables: {}, settings: {} });
    draft.customers.shift();
    draft.customers.push({ id: 'C', name: 'C' });
    assert.deepEqual(buildCatalogPatch(base, draft).tables.customers, {
        upsert: [{ id: 'C', name: 'C' }],
        remove: ['A']
    });
    draft.customers.push({ id: 'C', name: 'Duplicate' });
    assert.throws(() => buildCatalogPatch(base, draft), /bị trùng/);
});
