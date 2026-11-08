'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
let count = 0;
const folders = ['', 'tests', 'scripts'];
for (const folder of folders) {
    for (const file of fs
        .readdirSync(path.join(root, folder))
        .filter((name) => name.endsWith('.js'))) {
        const result = spawnSync(process.execPath, ['--check', path.join(root, folder, file)], {
            stdio: 'inherit'
        });
        if (result.error) throw result.error;
        if (result.status !== 0) process.exit(result.status || 1);
        count++;
    }
}
console.log(`Syntax checked: ${count} JavaScript files.`);
