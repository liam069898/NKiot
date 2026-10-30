'use strict';
const crypto = require('node:crypto');
const db = require('./db');
const { can, allowedBranches, publicUser, requirePermission, hashPassword } = require('./security');
const {
    execute,
    fail,
    amount,
    branchOf,
    recordActivity,
    syncSharedAvailability
} = require('./domain');
const hub = require('./hub-client');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Idempotency records must outlive any realistic offline/pending reconciliation window.
const PROCESSED_REQUEST_RETENTION_MS = 30 * 86400000;
const BRANCH_SCOPED = new Set([
    'products',
    'invoices',
    'imports',
    'cashbook',
    'returns',
    'stocktakes'
]);
const readable = {
    products: ['pos', 'products', 'imports', 'stocktakes', 'transfers', 'reports', 'dashboard'],
    customers: ['pos', 'customers', 'invoices', 'cashbook'],
    suppliers: ['suppliers', 'imports', 'cashbook'],
    invoices: ['invoices', 'reports', 'dashboard'],
    imports: ['imports', 'reports', 'dashboard'],
    cashbook: ['cashbook', 'reports'],
    returns: ['invoices', 'reports', 'dashboard'],
    stocktakes: ['stocktakes'],
    transfers: ['transfers'],
    users: ['users'],
    shared_products: ['shared_warehouse', 'products'],
    share_orders: ['shared_warehouse', 'products']
};
// Builds the user's view without deep-cloning: new arrays/objects at the top level, rows shared
// with `data`. Callers must treat the result as read-only (it may come from the frozen snapshot).
function project(data, user) {
    const result = { ...data },
        branches = new Set(allowedBranches(user, data));
    for (const [table, perms] of Object.entries(readable)) {
        if (!perms.some((p) => can(user, p))) result[table] = [];
        else if (BRANCH_SCOPED.has(table))
            result[table] = data[table].filter((r) => branches.has(branchOf(r)));
        else if (table === 'transfers')
            result[table] = data[table].filter(
                (r) => branches.has(r.fromBranch) || branches.has(r.toBranch)
            );
    }
    result.users = result.users.map(publicUser);
    // shared_products and share_orders are not branch-scoped; all shared items are globally visible.
    if (result.shared_products && result.shared_products.length) {
        result.shared_products = result.shared_products.filter(
            (sp) => sp.status === 'active' || sp.ownerUserId === user.id || user.role === 'admin'
        );
    }
    // share_orders: show orders where user is requester or owner
    if (result.share_orders && result.share_orders.length) {
        result.share_orders = result.share_orders.filter(
            (o) => o.requesterId === user.id || o.ownerId === user.id || user.role === 'admin'
        );
    }
    // Branch directory is needed to select destinations; inventory is still scoped above.
    result.recentActivities = (data.recentActivities || []).filter(
        (r) => !r.branch || branches.has(r.branch) || r.branch === 'Toàn bộ chi nhánh'
    );
    return result;
}
// Delta between two projected views, so a command response only carries rows that changed.
// Per array table: `rows` (full replacement) or { remove, update, prepend, append, length }.
// Rows are compared by value because derived fields (returned totals, customer aggregates) can
// change on rows the command never touched. `same` walks JSON-shaped values without allocating,
// which is several times faster than stringifying every row.
function same(a, b) {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
        return true;
    }
    if (Array.isArray(b)) return false;
    // Key order matters: the client compares by JSON text, so reordered keys count as a change.
    const ka = Object.keys(a),
        kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (let i = 0; i < ka.length; i++)
        if (ka[i] !== kb[i] || !same(a[ka[i]], b[kb[i]])) return false;
    return true;
}
function diffTable(prev, next) {
    const full = { rows: next };
    const ids = (rows) => {
        const map = new Map();
        for (const r of rows) {
            if (!r || typeof r.id !== 'string' || map.has(r.id)) return null;
            map.set(r.id, r);
        }
        return map;
    };
    const before = ids(prev),
        after = ids(next);
    if (!before || !after) return full;
    const remove = prev.filter((r) => !after.has(r.id)).map((r) => r.id);
    const kept = next.filter((r) => before.has(r.id));
    const order = prev.filter((r) => after.has(r.id));
    if (kept.some((r, i) => r.id !== order[i].id)) return full;
    // New rows must sit entirely before or after the kept block; anything else is a full send.
    let first = next.findIndex((r) => before.has(r.id));
    if (first < 0) first = next.length;
    const last = first + kept.length;
    if (next.slice(first, last).some((r) => !before.has(r.id))) return full;
    const update = kept.filter((r) => !same(r, before.get(r.id)));
    const prepend = next.slice(0, first),
        append = next.slice(last);
    if (!remove.length && !update.length && !prepend.length && !append.length) return null;
    const delta = { length: next.length };
    if (remove.length) delta.remove = remove;
    if (update.length) delta.update = update;
    if (prepend.length) delta.prepend = prepend;
    if (append.length) delta.append = append;
    // A delta bigger than half the table is not worth the client-side merge.
    return update.length + prepend.length + append.length > next.length / 2 && next.length > 20
        ? full
        : delta;
}
function diffViews(prev, next) {
    const keys = Object.keys(next);
    if (Object.keys(prev).length !== keys.length || keys.some((k) => !Object.hasOwn(prev, k)))
        return null;
    const delta = {};
    for (const key of keys) {
        const a = prev[key],
            b = next[key];
        if (Array.isArray(a) && Array.isArray(b)) {
            const d = diffTable(a, b);
            if (d) delta[key] = d;
        } else if (!same(a, b)) delta[key] = { value: b };
    }
    return delta;
}
function revision() {
    return Number(
        db.getDb().prepare("SELECT value FROM app_meta WHERE key='revision'").get().value
    );
}
const editable = {
    products: 'products',
    customers: 'customers',
    suppliers: 'suppliers',
    categories: 'products',
    branches: 'settings',
    users: 'users'
};
const fields = {
    products: [
        'id',
        'code',
        'name',
        'category',
        'costPrice',
        'price',
        'stock',
        'minStock',
        'unit',
        'status',
        'barcode',
        'branch',
        'hasImei',
        'imeis',
        'images',
        'videoUrl',
        'condition',
        'conditionDetail',
        'description',
        'imeiDetails'
    ],
    customers: ['id', 'code', 'name', 'phone', 'address', 'totalSpent', 'debt', 'points', 'note'],
    suppliers: ['id', 'code', 'name', 'phone', 'address', 'debt', 'totalBought', 'note'],
    categories: ['id', 'name', 'parentId'],
    branches: ['id', 'code', 'name', 'phone', 'address', 'isDefault', 'note'],
    users: [
        'id',
        'code',
        'name',
        'username',
        'password',
        'phone',
        'role',
        'roleName',
        'branch',
        'branches',
        'status',
        'permissions'
    ]
};
const AMOUNT_FIELDS = [
    'costPrice',
    'price',
    'stock',
    'minStock',
    'totalSpent',
    'totalBought',
    'debt',
    'points'
];
const NON_STRING_FIELDS = [
    ...AMOUNT_FIELDS,
    'hasImei',
    'isDefault',
    'permissions',
    'branches',
    'imeis',
    'images',
    'imeiDetails'
];
function productHasHistory(data, product) {
    const branch = branchOf(product),
        hasCode = (doc) => doc.items.some((item) => item.code === product.code);
    return (
        ['invoices', 'imports', 'returns', 'stocktakes'].some((table) =>
            data[table].some((doc) => branchOf(doc) === branch && hasCode(doc))
        ) ||
        data.transfers.some(
            (doc) => (doc.fromBranch === branch || doc.toBranch === branch) && hasCode(doc)
        )
    );
}
function branchHasHistory(data, branchName) {
    return (
        ['invoices', 'imports', 'returns', 'stocktakes'].some((table) =>
            data[table].some((doc) => branchOf(doc) === branchName)
        ) ||
        data.transfers.some(
            (doc) => doc.fromBranch === branchName || doc.toBranch === branchName
        ) ||
        (data.cashbook || []).some((doc) => branchOf(doc) === branchName) ||
        data.products.some(
            (p) =>
                branchOf(p) === branchName &&
                (Number(p.stock) > 0 ||
                    (Array.isArray(p.imeis) && p.imeis.length > 0) ||
                    productHasHistory(data, p))
        )
    );
}
function validateRecord(table, row, data, old, user) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) fail('Bản ghi không hợp lệ.');
    if (typeof row.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(row.id))
        fail('ID không hợp lệ.');
    if (
        row.code !== undefined &&
        (typeof row.code !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(row.code))
    )
        fail('Mã chỉ được gồm chữ, số, dấu chấm, gạch ngang hoặc gạch dưới.');
    for (const key of Object.keys(row))
        if (!fields[table].includes(key)) fail(`Trường ${table}.${key} không được hỗ trợ.`);
    if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > 500)
        fail('Tên không hợp lệ.');
    for (const [key, value] of Object.entries(row)) {
        if (!NON_STRING_FIELDS.includes(key) && value != null && typeof value !== 'string')
            fail(`Trường ${key} phải là chuỗi.`);
        if (typeof value === 'string' && value.length > 5000) fail(`Trường ${key} quá dài.`);
        if (
            !['permissions', 'branches', 'imeis', 'images', 'imeiDetails'].includes(key) &&
            value !== null &&
            typeof value === 'object'
        )
            fail(`Trường ${key} không đúng kiểu.`);
    }
    for (const key of AMOUNT_FIELDS) if (key in row) amount(row[key], key);
    if (
        !old &&
        ['customers', 'suppliers'].includes(table) &&
        user.role !== 'admin' &&
        ['debt', 'points', 'totalSpent', 'totalBought'].some((k) => row[k])
    )
        fail('Số dư ban đầu cần quyền quản trị.', 403);
    if (old && ['customers', 'suppliers'].includes(table) && user.role !== 'admin')
        for (const key of ['debt', 'totalSpent', 'totalBought', 'points'])
            if (!equal(row[key], old[key]))
                fail('Điều chỉnh số dư phải qua nghiệp vụ thanh toán hoặc quản trị viên.', 403);
    if (table === 'products') {
        require('./media-validation').validateMedia(row);
        if (!allowedBranches(user, data).includes(branchOf(row)))
            fail('Không được sửa kho khác.', 403);
        if (old && (row.code !== old.code || row.branch !== old.branch))
            fail('Không thể đổi mã/chi nhánh của sản phẩm có sẵn.');
        if (typeof row.hasImei !== 'boolean' || !['active', 'archived'].includes(row.status))
            fail('Trạng thái sản phẩm không hợp lệ.');
        if (
            !Array.isArray(row.imeis) ||
            row.imeis.some((i) => typeof i !== 'string' || !i || i.length > 200) ||
            new Set(row.imeis).size !== row.imeis.length
        )
            fail('Danh sách IMEI không hợp lệ.');
        if (row.hasImei && row.imeis.length !== row.stock)
            fail('Tồn kho phải bằng số IMEI. Nhập hàng có IMEI qua phiếu nhập.');
        if (old && row.hasImei !== old.hasImei && (old.stock || productHasHistory(data, old)))
            fail('Không thể đổi cách quản lý IMEI khi còn tồn kho hoặc lịch sử chứng từ.');
        if (row.images !== undefined) {
            if (
                !Array.isArray(row.images) ||
                row.images.length > 20 ||
                row.images.some((img) => typeof img !== 'string' || img.length > 500)
            )
                fail('Danh sách hình ảnh không hợp lệ.');
        }
        if (
            row.condition !== undefined &&
            !['new', 'like_new', 'good', 'fair'].includes(row.condition)
        )
            fail('Tình trạng sản phẩm không hợp lệ.');
        if (row.imeiDetails !== undefined) {
            if (
                typeof row.imeiDetails !== 'object' ||
                row.imeiDetails === null ||
                Array.isArray(row.imeiDetails)
            ) {
                fail('Chi tiết IMEI không hợp lệ.');
            }
        }
        const otherSerials = new Set(
            data.products.filter((p) => p.id !== row.id).flatMap((p) => p.imeis || [])
        );
        if (row.imeis.some((i) => otherSerials.has(i))) fail('IMEI đã có tại kho khác.');
    }
    if (table === 'branches' && old && row.name !== old.name) {
        if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > 500)
            fail('Tên chi nhánh không hợp lệ.');
        if (
            data.branches.some(
                (b) => b.id !== row.id && b.name.toLowerCase() === row.name.trim().toLowerCase()
            )
        )
            fail('Tên chi nhánh đã tồn tại.');
        if (branchHasHistory(data, old.name))
            fail('Không thể đổi tên chi nhánh đã phát sinh chứng từ hoặc có tồn kho.');

        const oldName = old.name;
        const newName = row.name.trim();
        for (const p of data.products) {
            if (p.branch === oldName) {
                p.branch = newName;
                if (p.id === `${p.code}_${oldName}`) p.id = `${p.code}_${newName}`;
            }
        }
        for (const u of data.users) {
            if (u.branch === oldName) u.branch = newName;
            if (Array.isArray(u.branches)) {
                u.branches = u.branches.map((b) => (b === oldName ? newName : b));
            }
        }
        if (data.settings && data.settings.branch === oldName) {
            data.settings.branch = newName;
        }
    }
    if (table === 'users') {
        if (typeof row.username !== 'string' || !/^[a-z0-9_.-]{1,80}$/.test(row.username))
            fail('Tên đăng nhập không hợp lệ.');
        if (
            !['admin', 'manager', 'cashier', 'warehouse', 'custom'].includes(row.role) ||
            !['active', 'locked'].includes(row.status)
        )
            fail('Vai trò/trạng thái không hợp lệ.');
        if (
            user.role !== 'admin' &&
            (old?.role === 'admin' ||
                (old &&
                    [...(old.branches || []), old.branch]
                        .filter(Boolean)
                        .some((b) => !allowedBranches(user, data).includes(b))) ||
                [...(Array.isArray(row.branches) ? row.branches : []), row.branch]
                    .filter(Boolean)
                    .some((b) => !allowedBranches(user, data).includes(b)))
        )
            fail('Không được quản lý quản trị viên hoặc nhân viên ngoài chi nhánh.', 403);
        if (
            user.role !== 'admin' &&
            (row.role === 'admin' ||
                Object.entries(row.permissions || {}).some(([p, v]) => v && !can(user, p)))
        )
            fail('Không thể cấp quyền vượt quyền hiện tại.', 403);
        if (
            !row.permissions ||
            typeof row.permissions !== 'object' ||
            Array.isArray(row.permissions) ||
            Object.values(row.permissions).some((v) => typeof v !== 'boolean')
        )
            fail('Phân quyền không hợp lệ.');
        if (
            !Array.isArray(row.branches) ||
            !row.branches.length ||
            row.branches.some((b) => !data.branches.some((x) => x.name === b)) ||
            !row.branches.includes(row.branch)
        )
            fail('Chi nhánh nhân viên không hợp lệ.');
        if (row.id === user.id && row.status !== 'active') fail('Không thể tự khóa tài khoản.');
        if (row.password) {
            if (typeof row.password !== 'string') fail('Mật khẩu phải là chuỗi.');
            if (row.password.length < 8 || row.password.length > 1024)
                fail('Mật khẩu mới phải từ 8 đến 1024 ký tự.');
            row.password = hashPassword(row.password);
        } else if (old) row.password = old.password;
        else fail('Nhập mật khẩu cho nhân viên mới.');
    }
}
const SHARED_PRODUCT_FIELDS = ['name', 'category', 'unit', 'barcode', 'hasImei'];
function syncProductCodesAcrossBranches(data, user, originalProducts, oldBranchIds) {
    const sources = new Map();
    for (const row of data.products) {
        const old = originalProducts.get(row.id);
        if (old && SHARED_PRODUCT_FIELDS.every((key) => equal(row[key], old[key]))) continue;
        const current = sources.get(row.code);
        if (current && SHARED_PRODUCT_FIELDS.some((key) => !equal(row[key], current[key])))
            fail('Thông tin chung của sản phẩm bị sửa khác nhau giữa các chi nhánh.');
        sources.set(row.code, row);
    }
    const addedBranches = data.branches.filter((row) => !oldBranchIds.has(row.id));
    if (!sources.size && !addedBranches.length) return;
    const branches = data.branches.map((row) => row.name);
    const scope = allowedBranches(user, data);
    if (addedBranches.length) requirePermission(user, 'products');
    if (branches.some((branch) => !scope.includes(branch)))
        fail('Cần quyền tất cả chi nhánh để đồng bộ thông tin sản phẩm.', 403);
    const ids = new Set(data.products.map((row) => row.id));
    const nextId = (code, branch) => {
        const base = `${code}_${branch.code || branch.id}`;
        let id = base;
        for (let n = 2; ids.has(id); n++) id = `${base}_${n}`;
        if (id.length > 160) fail('Mã sản phẩm quá dài để đồng bộ sang chi nhánh khác.');
        ids.add(id);
        return id;
    };
    const codes = [...sources.keys()];
    if (addedBranches.length)
        for (const row of data.products) if (!codes.includes(row.code)) codes.push(row.code);
    for (const code of codes) {
        const rows = data.products.filter((row) => row.code === code);
        const source = sources.get(code) || rows.find((row) => row.status === 'active') || rows[0];
        if (sources.has(code))
            for (const [index, row] of data.products.entries()) {
                if (row.code !== code || row === source) continue;
                const updated = { ...row };
                for (const key of SHARED_PRODUCT_FIELDS) updated[key] = source[key];
                if (equal(updated, row)) continue;
                validateRecord('products', updated, data, originalProducts.get(row.id), user);
                data.products[index] = updated;
            }
        const targets = sources.has(code) ? data.branches : addedBranches;
        for (const branch of targets) {
            if (rows.some((row) => branchOf(row) === branch.name)) continue;
            const row = {
                ...source,
                id: nextId(code, branch),
                branch: branch.name,
                stock: 0,
                imeis: []
            };
            validateRecord('products', row, data, undefined, user);
            data.products.push(row);
        }
    }
}
function applyCatalogPatch(data, user, patch) {
    const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
    if (
        !object(patch) ||
        Object.keys(patch).some((key) => !['tables', 'settings'].includes(key)) ||
        !object(patch.tables) ||
        !object(patch.settings)
    )
        fail('Thay đổi danh mục không hợp lệ.');
    const visible = project(data, user);
    const incoming = {};
    for (const [table, change] of Object.entries(patch.tables)) {
        if (!Object.hasOwn(editable, table)) fail('Danh mục không được phép cập nhật.', 403);
        requirePermission(user, editable[table]);
        if (
            !object(change) ||
            Object.keys(change).some((key) => !['upsert', 'remove'].includes(key)) ||
            !Array.isArray(change.upsert) ||
            !Array.isArray(change.remove)
        )
            fail('Thay đổi bản ghi không hợp lệ.');
        const visibleIds = new Set(visible[table].map((row) => row.id));
        const existingIds = new Set(data[table].map((row) => row.id));
        const ids = new Set();
        for (const id of change.remove) {
            if (typeof id !== 'string' || ids.has(id)) fail('Mã xóa không hợp lệ hoặc bị trùng.');
            if (!visibleIds.has(id)) fail('Không được xóa dữ liệu ngoài phạm vi.', 403);
            ids.add(id);
        }
        const removed = new Set(ids);
        const updated = new Map();
        for (const row of change.upsert) {
            if (!object(row) || typeof row.id !== 'string' || ids.has(row.id))
                fail('Mã cập nhật không hợp lệ hoặc bị trùng.');
            if (existingIds.has(row.id) && !visibleIds.has(row.id))
                fail('Không được sửa dữ liệu ngoài phạm vi.', 403);
            ids.add(row.id);
            updated.set(row.id, row);
        }
        incoming[table] = visible[table]
            .filter((row) => !removed.has(row.id))
            .map((row) => updated.get(row.id) || row);
        incoming[table].push(...change.upsert.filter((row) => !existingIds.has(row.id)));
    }
    if (Object.keys(patch.settings).length) {
        requirePermission(user, 'settings');
        for (const key of Object.keys(patch.settings))
            if (!Object.hasOwn(data.settings, key) || key === 'branch')
                fail('Trường cài đặt không hợp lệ.');
        incoming.settings = { ...data.settings, ...patch.settings };
    }
    return applyEdit(data, user, incoming, true);
}
function applyEdit(data, user, incoming, partial = false) {
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming))
        fail('Dữ liệu không hợp lệ.');
    const visible = project(data, user);
    const originalProducts = new Map(data.products.map((row) => [row.id, { ...row }]));
    const oldBranchIds = new Set(data.branches.map((row) => row.id));
    for (const table of db.ENTITY_TABLES) {
        if (partial && !Object.hasOwn(incoming, table)) continue;
        if (!Array.isArray(incoming[table])) fail(`Thiếu danh sách ${table}.`);
        const incomingCmp = table === 'users' ? incoming[table].map(publicUser) : incoming[table];
        if (
            equal(visible[table], incomingCmp) &&
            !(table === 'users' && incoming[table].some((row) => row.password))
        )
            continue;
        if (!editable[table])
            fail(`Chứng từ ${table} phải được cập nhật qua nghiệp vụ riêng.`, 403);
        requirePermission(user, editable[table]);
        const rows = incoming[table],
            ids = new Set();
        for (const row of rows) {
            if (!row || typeof row !== 'object' || Array.isArray(row))
                fail('Bản ghi không hợp lệ.');
            if (ids.has(row.id)) fail('Trùng mã bản ghi.');
            ids.add(row.id);
        }
        const visibleIds = new Set(visible[table].map((r) => r.id)),
            oldMap = new Map(data[table].map((r) => [r.id, r])),
            visibleMap = new Map(visible[table].map((r) => [r.id, r]));
        for (const row of rows) {
            const old = oldMap.get(row.id);
            if (old && !visibleIds.has(row.id)) fail('Không được sửa dữ liệu ngoài phạm vi.', 403);
            const before = visibleMap.get(row.id);
            const rowCmp = table === 'users' ? publicUser(row) : row;
            const beforeCmp = table === 'users' && before ? publicUser(before) : before;
            if (!equal(rowCmp, beforeCmp) || (table === 'users' && row.password))
                validateRecord(table, row, data, old, user);
        }
        for (const old of visible[table].filter((r) => !ids.has(r.id))) {
            if (
                table === 'users' &&
                user.role !== 'admin' &&
                (old.role === 'admin' ||
                    (old.branches || [old.branch]).some(
                        (b) => !allowedBranches(user, data).includes(b)
                    ))
            )
                fail('Không được xóa nhân viên ngoài phạm vi.', 403);
            if (table === 'users' && old.id === user.id) fail('Không thể tự xóa tài khoản.');
            if (table === 'categories' && data.categories.some((c) => c.parentId === old.id))
                fail('Nhóm hàng còn nhóm con không thể xóa.');
            if (table === 'branches') fail('Không thể xóa chi nhánh qua danh mục.');
            if (
                table === 'customers' &&
                (old.debt ||
                    data.invoices.some((i) => i.customerId === old.id || i.phone === old.phone))
            )
                fail('Khách hàng còn công nợ/lịch sử không thể xóa.');
            if (
                table === 'suppliers' &&
                (old.debt || data.imports.some((i) => i.nccCode === old.code))
            )
                fail('Nhà cung cấp còn công nợ/lịch sử không thể xóa.');
            if (table === 'products' && (old.stock || productHasHistory(data, old)))
                fail('Sản phẩm còn tồn/lịch sử không thể xóa.');
        }
        for (const row of rows) {
            const before = visibleMap.get(row.id);
            const rowCmp = table === 'users' ? publicUser(row) : row;
            const beforeCmp = table === 'users' && before ? publicUser(before) : before;
            if (!before) {
                recordActivity(data, {
                    type: 'edit',
                    title: user.name || 'Quản lý',
                    action: `Thêm ${table === 'products' ? 'hàng hóa' : table === 'customers' ? 'khách hàng' : table === 'suppliers' ? 'nhà cung cấp' : table === 'users' ? 'nhân viên' : table === 'branches' ? 'chi nhánh' : 'danh mục'}: ${row.name || row.code}`,
                    branch: table === 'products' ? branchOf(row) : row.branch || null
                });
            } else if (!equal(rowCmp, beforeCmp)) {
                recordActivity(data, {
                    type: 'edit',
                    title: user.name || 'Quản lý',
                    action: `Cập nhật ${table === 'products' ? 'hàng hóa' : table === 'customers' ? 'khách hàng' : table === 'suppliers' ? 'nhà cung cấp' : table === 'users' ? 'nhân viên' : table === 'branches' ? 'chi nhánh' : 'danh mục'}: ${row.name || row.code}`,
                    branch: table === 'products' ? branchOf(row) : row.branch || null
                });
            }
        }
        for (const old of visible[table].filter((r) => !ids.has(r.id))) {
            recordActivity(data, {
                type: 'edit',
                title: user.name || 'Quản lý',
                action: `Xóa ${table === 'products' ? 'hàng hóa' : table === 'customers' ? 'khách hàng' : table === 'suppliers' ? 'nhà cung cấp' : table === 'users' ? 'nhân viên' : table === 'branches' ? 'chi nhánh' : 'danh mục'}: ${old.name || old.code}`,
                branch: table === 'products' ? branchOf(old) : old.branch || null
            });
        }

        data[table] = data[table]
            .filter((r) => !visibleIds.has(r.id))
            .concat(
                rows.map((r) =>
                    table === 'users' && !r.password
                        ? { ...r, password: oldMap.get(r.id)?.password }
                        : r
                )
            );
        const keys = new Set();
        for (const r of data[table]) {
            const key =
                table === 'products'
                    ? `${r.branch}:${r.code}`
                    : table === 'users'
                      ? r.username
                      : table === 'categories'
                        ? r.id
                        : table === 'branches'
                          ? r.name
                          : r.code;
            if (keys.has(key)) fail('Mã/tên bị trùng.');
            keys.add(key);
        }
    }
    syncProductCodesAcrossBranches(data, user, originalProducts, oldBranchIds);
    if (
        (!partial || Object.hasOwn(incoming, 'settings')) &&
        !equal(visible.settings, incoming.settings)
    ) {
        requirePermission(user, 'settings');
        if (
            !incoming.settings ||
            typeof incoming.settings !== 'object' ||
            Array.isArray(incoming.settings)
        )
            fail('Cài đặt không hợp lệ.');
        for (const [k, v] of Object.entries(incoming.settings)) {
            const maxLen = k === 'logoUrl' ? 2 * 1024 * 1024 : 1000;
            if (!Object.hasOwn(data.settings, k) || typeof v !== 'string' || v.length > maxLen)
                fail('Trường cài đặt không hợp lệ.');
        }
        if (Object.keys(data.settings).some((k) => !Object.hasOwn(incoming.settings, k)))
            fail('Thiếu trường cài đặt.');
        data.settings = incoming.settings;
        recordActivity(data, {
            type: 'edit',
            title: user.name || 'Quản trị viên',
            action: 'Cập nhật thiết lập cửa hàng'
        });
    }
    const serials = new Set(
        data.transfers
            .filter((t) => t.status === 'shipping')
            .flatMap((t) => t.items.flatMap((i) => i.imeis || []))
    );
    for (const p of data.products) {
        for (const serial of p.imeis || []) {
            if (serials.has(serial)) fail('IMEI bị trùng giữa các sản phẩm/kho.');
            serials.add(serial);
        }
    }
    if (!data.users.some((u) => u.role === 'admin' && u.status === 'active'))
        fail('Phải giữ ít nhất một quản trị viên hoạt động.');
    return { saved: true };
}
function transact(user, envelope) {
    if (
        !envelope ||
        typeof envelope.requestId !== 'string' ||
        !/^[a-zA-Z0-9-]{16,100}$/.test(envelope.requestId)
    )
        fail('Thiếu mã giao dịch hợp lệ.', 400);
    const d = db.getDb(),
        digest = crypto.createHash('sha256').update(JSON.stringify(envelope)).digest('hex');
    d.exec('BEGIN IMMEDIATE');
    try {
        const prior = d
            .prepare('SELECT * FROM processed_requests WHERE id=?')
            .get(envelope.requestId);
        if (prior) {
            if (prior.userId !== user.id || prior.digest !== digest)
                fail('Mã giao dịch đã được dùng với nội dung khác.', 409);
            d.exec('COMMIT');
            return { result: JSON.parse(prior.result), replayed: true };
        }
        // Audit entries outlive cached results; never execute an expired request a second time.
        if (d.prepare('SELECT 1 FROM audit_log WHERE requestId=?').get(envelope.requestId))
            fail('Kết quả giao dịch đã hết hạn lưu. Cần đối soát chứng từ trước khi gửi lại.', 409);
        if (envelope.revision !== revision())
            fail(
                'Dữ liệu đã thay đổi ở máy khác. Hãy tải lại dữ liệu và kiểm tra trước khi thử lại.',
                409
            );
        db.assertReadableRecords();
        const saleDraft =
            envelope.type === 'sale' && process.env.NKIOT_SALE_WRITE_MODE !== 'snapshot'
                ? db.readSaleForWrite(envelope.payload)
                : null;
        const data = saleDraft ? saleDraft.data : db.readForWrite();
        const current = data.users.find((u) => u.id === user.id);
        if (!current || current.status !== 'active') fail('Phiên đăng nhập đã hết hiệu lực.', 401);
        user = current;
        const result =
            envelope.type === 'edit'
                ? applyEdit(data, user, envelope.payload)
                : envelope.type === 'catalogPatch'
                  ? applyCatalogPatch(data, user, envelope.payload)
                  : execute(data, user, envelope.type, envelope.payload || {});
        syncSharedAvailability(data);
        if (saleDraft) db.saveSaleData(saleDraft.base, data);
        else db.saveAllData(data, true);
        // Cùng transaction POS: crash sau commit vẫn còn snapshot để worker gửi lại.
        require('./hub-client').enqueue(data);
        d.prepare('INSERT INTO audit_log (requestId,userId,action,time) VALUES (?,?,?,?)').run(
            envelope.requestId,
            user.id,
            envelope.type,
            new Date().toISOString()
        );
        d.prepare("UPDATE app_meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run();
        const createdAt = new Date().toISOString();
        d.prepare(
            'INSERT INTO processed_requests (id,userId,digest,result,createdAt) VALUES (?,?,?,?,?)'
        ).run(envelope.requestId, user.id, digest, JSON.stringify(result), createdAt);
        d.prepare('DELETE FROM processed_requests WHERE createdAt < ?').run(
            new Date(Date.parse(createdAt) - PROCESSED_REQUEST_RETENTION_MS).toISOString()
        );
        d.exec('COMMIT');
        return { result, replayed: false };
    } catch (e) {
        d.exec('ROLLBACK');
        throw e;
    }
}
module.exports = { project, revision, transact, diffViews };
