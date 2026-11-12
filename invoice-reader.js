'use strict';
const db = require('./db');
const { requirePermission, allowedBranches } = require('./security');
const { FALLBACK_BRANCH, ALL_BRANCHES } = require('./constants');
const { matchesDateFilter } = require('./app-utils');
const registered = new WeakSet();
const bad = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
};
function integer(value, fallback, min, max) {
    if (value === null) return fallback;
    if (!/^\d+$/.test(value)) bad('Tham số phân trang không hợp lệ.');
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < min || n > max) bad('Tham số phân trang ngoài giới hạn.');
    return n;
}
function listInvoices(user, params) {
    requirePermission(user, 'invoices');
    const page = integer(params.get('page'), 1, 1, 1000000);
    const pageSize = integer(params.get('pageSize'), 50, 1, 100);
    const expectedRevision = integer(params.get('revision'), null, 0, Number.MAX_SAFE_INTEGER);
    const status = params.get('status') || 'all';
    const channel = params.get('channel') || 'all';
    const date = params.get('date') || 'all';
    const q = (params.get('q') || '').trim().toLowerCase();
    if (q.length > 200) bad('Từ khóa quá dài.');
    if (!['all', 'completed', 'returned', 'cancelled'].includes(status))
        bad('Trạng thái không hợp lệ.');
    if (!['all', 'counter', 'delivery'].includes(channel)) bad('Kênh bán không hợp lệ.');
    if (
        ![
            'all',
            'today',
            'yesterday',
            '7days',
            '30days',
            'this_month',
            'last_month',
            'this_quarter',
            'this_year'
        ].includes(date)
    )
        bad('Bộ lọc ngày không hợp lệ.');
    const d = db.getDb();
    if (!registered.has(d)) {
        d.function('nkiot_lower', { deterministic: true }, (value) =>
            String(value || '').toLowerCase()
        );
        d.function('nkiot_matches_date', (time, filter) =>
            matchesDateFilter(time, filter) ? 1 : 0
        );
        registered.add(d);
    }
    d.exec('BEGIN');
    try {
        const revision = Number(
            d.prepare("SELECT value FROM app_meta WHERE key='revision'").get().value
        );
        if (expectedRevision !== null && expectedRevision !== revision)
            bad('Danh sách đã thay đổi. Đã quay về trang đầu; hãy kiểm tra lại.', 409);
        const branches = allowedBranches(user, {
            branches: d.prepare('SELECT name FROM branches').all()
        });
        const requested = params.get('branch') || user.branch || FALLBACK_BRANCH;
        if (requested !== ALL_BRANCHES && !branches.includes(requested))
            bad('Không được xem chi nhánh này.', 403);
        const scope = requested === ALL_BRANCHES ? branches : [requested];
        const where = [],
            args = [];
        if (!scope.length) where.push('0');
        else {
            where.push(
                `COALESCE(NULLIF(i.branch,''), '${FALLBACK_BRANCH.replace(/'/g, "''")}') IN (${scope.map(() => '?').join(',')})`
            );
            args.push(...scope);
        }
        const extraJson = `CASE WHEN json_valid(i.extra) THEN i.extra ELSE '{}' END`;
        const returned = `(EXISTS(SELECT 1 FROM returns r WHERE r.invoiceCode=i.code) OR COALESCE(json_extract(${extraJson},'$.hasReturned'),0) != 0)`;
        const isDeliveryExpr = `(COALESCE(json_extract(${extraJson},'$.cod'),0) != 0 OR json_extract(${extraJson},'$.channel')='delivery' OR EXISTS(SELECT 1 FROM delivery_orders d WHERE d.invoiceId=i.id))`;
        if (status === 'completed') where.push(`i.status='completed' AND NOT ${returned}`);
        if (status === 'returned') where.push(returned);
        if (status === 'cancelled') where.push("i.status='cancelled'");
        if (channel === 'delivery') where.push(isDeliveryExpr);
        if (channel === 'counter') where.push(`NOT ${isDeliveryExpr}`);
        if (q) {
            where.push(
                "(instr(nkiot_lower(i.code),?)>0 OR instr(nkiot_lower(i.customer),?)>0 OR instr(COALESCE(i.phone,''),?)>0)"
            );
            args.push(q, q, q);
        }
        if (date !== 'all') {
            where.push('nkiot_matches_date(i.time,?)=1');
            args.push(date);
        }
        const clause = where.join(' AND ');
        const total = Number(
            d.prepare(`SELECT COUNT(*) AS n FROM invoices i WHERE ${clause}`).get(...args).n
        );
        const pages = Math.max(1, Math.ceil(total / pageSize));
        const actualPage = Math.min(page, pages);
        const rows = d
            .prepare(
                `SELECT i.id,i.code,i.time,i.customer,i.phone,i.total,i.paid,COALESCE(i.discount,0) AS discount,i.status,
            i.branch,i.redPaid,
            (SELECT r.code FROM returns r WHERE r.invoiceCode=i.code LIMIT 1) AS returnCode,
            (SELECT d.code FROM delivery_orders d WHERE d.invoiceId=i.id LIMIT 1) AS deliveryCode,
            (SELECT c.code FROM customers c WHERE (c.phone IS NOT NULL AND c.phone != '' AND c.phone=i.phone) OR c.name=i.customer LIMIT 1) AS customerCode,
            ${isDeliveryExpr} AS isDelivery,
            ${returned} AS hasReturned FROM invoices i
            WHERE ${clause} ORDER BY i.rowid LIMIT ? OFFSET ?`
            )
            .all(...args, pageSize, (actualPage - 1) * pageSize)
            .map((row) => ({
                ...row,
                total: Number(row.total) || 0,
                paid: Number(row.paid) || 0,
                discount: Number(row.discount) || 0,
                redPaid: !!row.redPaid,
                isDelivery: !!row.isDelivery,
                channel: row.isDelivery ? 'delivery' : 'counter',
                deliveryCode: row.deliveryCode || '',
                hasReturned: !!row.hasReturned,
                returnCode: row.returnCode || '',
                customerCode: row.customerCode || ''
            }));
        d.exec('COMMIT');
        return { success: true, rows, total, page: actualPage, pageSize, pages, revision };
    } catch (error) {
        d.exec('ROLLBACK');
        throw error;
    }
}
module.exports = { listInvoices };
