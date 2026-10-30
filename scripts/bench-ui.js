'use strict';
// Synthetic jsdom CPU measurement, not browser paint time. No DB/network access.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
    url: 'http://localhost',
    runScripts: 'outside-only'
});
const w = dom.window;
try {
    for (const file of [
        'constants.js',
        'catalog-patch.js',
        'ui-safety.js',
        'client-store.js',
        'app-utils.js',
        'app-reports.js',
        'app-export.js',
        'app.js'
    ])
        vm.runInContext(
            fs
                .readFileSync(path.join(root, file), 'utf8')
                .replace("window.addEventListener('DOMContentLoaded', initApp);", ''),
            dom.getInternalVMContext()
        );
    const fixture = structuredClone(require('../data').defaultData);
    const product = fixture.products[0],
        invoice = fixture.invoices[0];
    fixture.products = Array.from({ length: 2000 }, (_, i) => ({
        ...product,
        id: `P${i}`,
        code: `P${i}`,
        name: `Product ${i}`,
        hasImei: false,
        imeis: []
    }));
    fixture.invoices = Array.from({ length: 5000 }, (_, i) => ({
        ...invoice,
        id: `HD${i}`,
        code: `HD${i}`,
        items: [
            {
                code: `P${i % 2000}`,
                name: `Product ${i % 2000}`,
                qty: 1,
                price: 100000,
                costPrice: 50000,
                total: 100000
            }
        ],
        total: 100000,
        paid: 100000,
        status: 'completed'
    }));
    fixture.users = fixture.users.map(({ password, ...user }) => user);
    w.fixture = fixture;
    vm.runInContext(
        'KVStore.data=fixture;KVStore.user=fixture.users[0];state.currentView="pos";',
        dom.getInternalVMContext()
    );
    console.log('jsdom: 5000 invoices, 2000 products; 1 warmup + 10 samples.');
    for (const name of ['renderAllViews', 'refreshCurrentView']) {
        w[name]();
        const times = [];
        for (let i = 0; i < 10; i++) {
            const start = performance.now();
            w[name]();
            times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        console.log(`${name}: median ${times[5].toFixed(1)} ms, p90 ${times[9].toFixed(1)} ms`);
    }
} finally {
    w.close();
}
