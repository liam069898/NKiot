'use strict';
// Kiểm tra public/tailwind.css đã build lại từ source chưa.
// Thêm class Tailwind mới vào HTML/JS mà quên chạy `npm run assets:build` sẽ bị phát hiện ở đây
// (và trong CI), tránh phát hành giao diện thiếu style.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const committedPath = path.join(root, 'public', 'tailwind.css');
const fresh = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nkiot-assets-')), 'tailwind.css');

try {
    const tailwind = path.join(root, 'node_modules', '.bin', 'tailwindcss');
    execFileSync(tailwind, ['-i', './tailwind.input.css', '-o', fresh, '--minify'], {
        cwd: root,
        stdio: 'ignore'
    });
} catch (error) {
    console.error('Không build được Tailwind. Chạy `npm ci` trước.');
    process.exit(1);
}

const selectors = (css) => new Set((css.match(/\.[^{},]+(?=[{,])/g) || []).map((s) => s.trim()));
const toClass = (raw) => raw.replace(/\\/g, '').replace(/^\./, '');
const committed = selectors(fs.readFileSync(committedPath, 'utf8'));
const built = selectors(fs.readFileSync(fresh, 'utf8'));
fs.rmSync(path.dirname(fresh), { recursive: true, force: true });

const missing = [...built].filter((s) => !committed.has(s)).map(toClass);
const extra = [...committed].filter((s) => !built.has(s)).map(toClass);

if (!missing.length && !extra.length) {
    console.log(`Tailwind CSS đồng bộ với source (${committed.size} class).`);
    process.exit(0);
}
if (missing.length)
    console.error(
        `Thiếu ${missing.length} class đang dùng trong source: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}`
    );
if (extra.length)
    console.error(
        `Thừa ${extra.length} class không còn dùng: ${extra.slice(0, 10).join(', ')}${extra.length > 10 ? '…' : ''}`
    );
console.error('Chạy `npm run assets:build` rồi commit public/tailwind.css.');
process.exit(1);
