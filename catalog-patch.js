'use strict';
// Build a small catalog command without cloning or serializing transaction history.
// Shared by Node benchmarks/tests and the browser (loaded before client-store.js).
const CATALOG_TABLES = ['branches', 'categories', 'products', 'customers', 'suppliers', 'users'];
function buildCatalogPatch(base, draft) {
    const tables = {};
    for (const table of CATALOG_TABLES) {
        const previous = base[table] || [];
        const rows = draft[table];
        if (!Array.isArray(rows)) throw new Error(`Thiếu danh sách ${table}.`);
        const before = new Map(previous.map((row) => [row.id, row]));
        const seen = new Set();
        const upsert = [];
        for (const row of rows) {
            if (!row || typeof row.id !== 'string' || seen.has(row.id))
                throw new Error(`Mã bản ghi ${table} không hợp lệ hoặc bị trùng.`);
            seen.add(row.id);
            if (JSON.stringify(row) !== JSON.stringify(before.get(row.id))) upsert.push(row);
        }
        const remove = previous.filter((row) => !seen.has(row.id)).map((row) => row.id);
        if (upsert.length || remove.length) tables[table] = { upsert, remove };
    }
    const settings = {};
    for (const [key, value] of Object.entries(draft.settings || {})) {
        // The selected branch is local UI state, not a store setting edit.
        if (key !== 'branch' && value !== base.settings[key]) settings[key] = value;
    }
    for (const key of Object.keys(base.settings))
        if (!Object.hasOwn(draft.settings || {}, key)) throw new Error('Thiếu trường cài đặt.');
    return { tables, settings };
}
if (typeof module !== 'undefined') module.exports = { buildCatalogPatch, CATALOG_TABLES };
