'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const db = require('./db');
const { FALLBACK_BRANCH } = require('./constants');

const MAX_CATALOG_ITEMS = 50;
const MAX_IMAGES_PER_ITEM = 10;
const TOKEN_REGEX = /^[A-Za-z0-9_-]{16,64}$/;
const MEDIA_ID_REGEX = /^[a-f0-9]{24}$/;

function fail(message, status = 400) {
    throw Object.assign(new Error(message), { status });
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function allowedBranchesForUser(user, snapshot) {
    if (user?.role === 'admin') {
        return new Set((snapshot.branches || []).map((b) => b.name).concat([FALLBACK_BRANCH]));
    }
    const list =
        Array.isArray(user?.branches) && user.branches.length
            ? user.branches
            : [user?.branch || FALLBACK_BRANCH];
    return new Set(list);
}

function canAccessBranch(user, branch, snapshot) {
    if (!branch) return true;
    if (user?.role === 'admin') return true;
    return allowedBranchesForUser(user, snapshot).has(branch);
}

function computeCatalogMediaId(token, uploadPath) {
    return crypto.createHash('sha256').update(`${token}|${uploadPath}`).digest('hex').slice(0, 24);
}

function normalizeUploadPath(raw) {
    const str = String(raw || '').trim();
    if (/^\/uploads\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(str)) return str;
    if (/^https?:\/\//i.test(str) && !/^https?:\/\/[^/]*@/i.test(str)) return str;
    return '';
}

function effectiveStatus(row, nowIso = new Date().toISOString()) {
    if (!row) return 'not_found';
    if (row.status === 'revoked' || row.revokedAt) return 'revoked';
    if (row.expiresAt && row.expiresAt <= nowIso) return 'expired';
    return row.status || 'active';
}

function parseImages(raw) {
    if (Array.isArray(raw)) return raw;
    try {
        const parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function resolveExpiresAt(input, nowMs = Date.now()) {
    if (input?.expiresAt === null || input?.expiresInHours === 0 || input?.expiresInHours === '0') {
        return null;
    }
    if (typeof input?.expiresAt === 'string' && input.expiresAt.trim()) {
        const parsed = Date.parse(input.expiresAt.trim());
        if (!Number.isFinite(parsed) || parsed <= nowMs) {
            fail('Thời điểm hết hạn phải lớn hơn thời gian hiện tại.', 400);
        }
        return new Date(parsed).toISOString();
    }
    const hours = Number(input?.expiresInHours ?? 72);
    if (!Number.isFinite(hours) || hours < 0 || hours > 24 * 365) {
        fail('Thời hạn hiệu lực không hợp lệ.', 400);
    }
    if (hours === 0) return null;
    return new Date(nowMs + hours * 3600 * 1000).toISOString();
}

function generateUniqueToken(database) {
    const check = database.prepare('SELECT 1 FROM public_catalogs WHERE token=?');
    for (let i = 0; i < 8; i++) {
        const token = crypto.randomBytes(18).toString('base64url');
        if (!check.get(token)) return token;
    }
    fail('Không thể sinh token catalog duy nhất.', 500);
}

function collectProductImages(product, specificImei = '') {
    const list = [];
    if (specificImei) {
        const detail =
            product.imeiDetails && typeof product.imeiDetails === 'object'
                ? product.imeiDetails[specificImei]
                : null;
        for (const img of parseImages(detail?.images)) {
            const clean = normalizeUploadPath(img);
            if (clean && !list.includes(clean)) list.push(clean);
        }
        if (list.length > 0) return list.slice(0, MAX_IMAGES_PER_ITEM);
    }
    for (const img of parseImages(product.images)) {
        const clean = normalizeUploadPath(img);
        if (clean && !list.includes(clean)) list.push(clean);
    }
    if (!specificImei && product.imeiDetails && typeof product.imeiDetails === 'object') {
        const imeis = Array.isArray(product.imeis)
            ? product.imeis
            : Object.keys(product.imeiDetails);
        for (const serial of imeis) {
            const detail = product.imeiDetails[serial];
            for (const img of parseImages(detail?.images)) {
                const clean = normalizeUploadPath(img);
                if (clean && !list.includes(clean)) list.push(clean);
            }
        }
    }
    return list.slice(0, MAX_IMAGES_PER_ITEM);
}

function formatCatalogRow(row, items, nowIso = new Date().toISOString()) {
    const status = effectiveStatus(row, nowIso);
    return {
        id: row.id,
        token: row.token,
        url: `/catalog/${row.token}`,
        branch: row.branch,
        createdBy: row.createdBy,
        createdByName: row.createdByName || '',
        title: row.title,
        message: row.message || '',
        contactName: row.contactName || '',
        contactPhone: row.contactPhone || '',
        status,
        rawStatus: row.status,
        expiresAt: row.expiresAt || null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        revokedAt: row.revokedAt || null,
        itemCount: items.length,
        items: items.map((item) => ({
            id: item.id,
            sourceType: item.sourceType,
            sourceProductId: item.sourceProductId,
            productCode: item.productCode,
            imei: item.imei || '',
            sortOrder: item.sortOrder,
            name: item.name,
            category: item.category,
            displayPrice: Number(item.displayPrice) || 0,
            description: item.description || '',
            condition: item.condition || 'new',
            conditionDetail: item.conditionDetail || '',
            images: parseImages(item.images),
            availabilitySnapshot: item.availabilitySnapshot || 'in_stock'
        }))
    };
}

function createCatalog(user, input = {}) {
    if (!user) fail('Vui lòng đăng nhập.', 401);
    const title = String(input.title || '').trim();
    if (!title) fail('Vui lòng nhập tiêu đề catalog.', 400);
    if (title.length > 200) fail('Tiêu đề catalog tối đa 200 ký tự.', 400);
    const message = String(input.message || '').trim();
    if (message.length > 1000) fail('Lời nhắn tư vấn tối đa 1000 ký tự.', 400);
    const rawItems = Array.isArray(input.items) ? input.items : [];
    if (!rawItems.length) fail('Vui lòng chọn ít nhất 1 sản phẩm cho catalog.', 400);
    if (rawItems.length > MAX_CATALOG_ITEMS)
        fail(`Mỗi catalog chỉ tối đa ${MAX_CATALOG_ITEMS} sản phẩm.`, 400);

    const snapshot = db.readSnapshot();
    const targetBranch = String(input.branch || user.branch || FALLBACK_BRANCH).trim();
    if (targetBranch && targetBranch !== 'ALL' && !canAccessBranch(user, targetBranch, snapshot))
        fail('Bạn không có quyền tạo catalog cho chi nhánh này.', 403);

    const allowedBranches = allowedBranchesForUser(user, snapshot);
    const products = snapshot.products || [];
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = resolveExpiresAt(input, now.getTime());
    const contactName = String(
        input.contactName ?? user.name ?? snapshot.settings?.storeName ?? 'NKiot'
    )
        .trim()
        .slice(0, 120);
    const contactPhone = String(
        input.contactPhone ??
            user.phone ??
            snapshot.settings?.hotline ??
            snapshot.settings?.phone ??
            ''
    )
        .trim()
        .slice(0, 40);

    const expandedEntries = [];
    for (const entry of rawItems) {
        const itemObj = typeof entry === 'string' ? { code: entry } : entry || {};
        if (Array.isArray(itemObj.imeis) && itemObj.imeis.length > 0) {
            for (const im of itemObj.imeis) {
                const cleanImei = String(im || '').trim();
                if (cleanImei)
                    expandedEntries.push({ ...itemObj, imei: cleanImei, imeis: undefined });
            }
        } else {
            expandedEntries.push(itemObj);
        }
    }
    if (!expandedEntries.length) fail('Vui lòng chọn ít nhất 1 sản phẩm cho catalog.', 400);
    if (expandedEntries.length > MAX_CATALOG_ITEMS)
        fail(`Mỗi catalog chỉ tối đa ${MAX_CATALOG_ITEMS} sản phẩm/máy.`, 400);

    const resolvedItems = expandedEntries.map((itemObj, idx) => {
        const wantId = String(itemObj.productId || itemObj.id || '').trim();
        const wantCode = String(itemObj.code || itemObj.productCode || '').trim();
        const wantImei = String(itemObj.imei || itemObj.serial || '').trim();
        const candidates = products.filter((p) => {
            const branchName = p.branch || FALLBACK_BRANCH;
            if (user.role !== 'admin' && !allowedBranches.has(branchName)) return false;
            return (wantId && String(p.id) === wantId) || (wantCode && p.code === wantCode);
        });
        if (!candidates.length) fail(`Không tìm thấy sản phẩm hợp lệ ở mục #${idx + 1}.`, 404);

        let matchedCandidate = null;
        let imeiDetail = null;
        if (wantImei) {
            for (const cand of candidates) {
                const imeiList = Array.isArray(cand.imeis) ? cand.imeis : [];
                const details =
                    cand.imeiDetails && typeof cand.imeiDetails === 'object'
                        ? cand.imeiDetails
                        : {};
                if (imeiList.includes(wantImei) || Object.hasOwn(details, wantImei)) {
                    matchedCandidate = cand;
                    imeiDetail = details[wantImei] || null;
                    break;
                }
            }
            if (!matchedCandidate) {
                fail(`Không tìm thấy IMEI "${wantImei}" trong kho ở mục #${idx + 1}.`, 404);
            }
        }

        const primary =
            matchedCandidate ||
            candidates.find((c) => targetBranch && c.branch === targetBranch) ||
            candidates[0];
        const totalStock = wantImei
            ? Array.isArray(primary.imeis) && primary.imeis.includes(wantImei)
                ? 1
                : 0
            : candidates.reduce((sum, c) => sum + (Number(c.stock) || 0), 0);
        const defaultPrice = Number(primary.price) || 0;
        const customPrice =
            itemObj.displayPrice !== undefined &&
            itemObj.displayPrice !== null &&
            itemObj.displayPrice !== ''
                ? Number(itemObj.displayPrice)
                : defaultPrice;
        if (!Number.isFinite(customPrice) || customPrice < 0)
            fail(`Giá hiển thị không hợp lệ ở sản phẩm "${primary.name}".`, 400);
        const customDesc =
            typeof itemObj.description === 'string'
                ? itemObj.description.trim()
                : String(imeiDetail?.note || primary.description || primary.notes || '').trim();

        const allImages = [];
        if (wantImei) {
            for (const img of collectProductImages(primary, wantImei)) {
                if (!allImages.includes(img)) allImages.push(img);
            }
        } else {
            for (const cand of candidates) {
                for (const img of collectProductImages(cand)) {
                    if (!allImages.includes(img)) allImages.push(img);
                }
            }
        }

        const resolvedCond = String(imeiDetail?.condition || primary.condition || 'new');
        const resolvedCondDetail = String(
            imeiDetail?.conditionDetail ?? primary.conditionDetail ?? ''
        ).slice(0, 300);

        return {
            id: crypto.randomUUID(),
            sourceType: 'local',
            sourceProductId: String(primary.id || primary.code || ''),
            productCode: String(primary.code || ''),
            imei: wantImei,
            sortOrder: idx,
            name: String(itemObj.name || primary.name || '').trim() || primary.name,
            category: String(primary.category || ''),
            displayPrice: Math.round(customPrice),
            description: customDesc.slice(0, 1000),
            condition: resolvedCond,
            conditionDetail: resolvedCondDetail,
            images: allImages.slice(0, MAX_IMAGES_PER_ITEM),
            availabilitySnapshot: totalStock > 0 ? 'in_stock' : 'out_of_stock'
        };
    });

    const database = db.getDb();
    const catalogId = `CAT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const token = generateUniqueToken(database);
    const catalogBranch =
        targetBranch === 'ALL' ? user.branch || FALLBACK_BRANCH : targetBranch || FALLBACK_BRANCH;

    database.exec('BEGIN IMMEDIATE');
    try {
        database
            .prepare(
                `INSERT INTO public_catalogs (id, token, branch, createdBy, createdByName, title, message, contactName, contactPhone, status, expiresAt, createdAt, updatedAt, revokedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL)`
            )
            .run(
                catalogId,
                token,
                catalogBranch,
                user.id || user.username || '',
                user.name || user.username || '',
                title,
                message,
                contactName,
                contactPhone,
                expiresAt,
                nowIso,
                nowIso
            );
        const insertItem = database.prepare(
            `INSERT INTO public_catalog_items (id, catalogId, sourceType, sourceProductId, productCode, imei, sortOrder, name, category, displayPrice, description, condition, conditionDetail, images, availabilitySnapshot, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const item of resolvedItems) {
            insertItem.run(
                item.id,
                catalogId,
                item.sourceType,
                item.sourceProductId,
                item.productCode,
                item.imei || '',
                item.sortOrder,
                item.name,
                item.category,
                item.displayPrice,
                item.description,
                item.condition,
                item.conditionDetail,
                JSON.stringify(item.images),
                item.availabilitySnapshot,
                nowIso
            );
        }
        database.exec('COMMIT');
    } catch (err) {
        database.exec('ROLLBACK');
        throw err;
    }
    return getCatalogForUser(user, catalogId);
}

function loadCatalogItemsMap(database, catalogIds) {
    const map = new Map();
    if (!catalogIds.length) return map;
    const placeholders = catalogIds.map(() => '?').join(',');
    const rows = database
        .prepare(
            `SELECT * FROM public_catalog_items WHERE catalogId IN (${placeholders}) ORDER BY sortOrder ASC`
        )
        .all(...catalogIds);
    for (const r of rows) {
        if (!map.has(r.catalogId)) map.set(r.catalogId, []);
        map.get(r.catalogId).push(r);
    }
    return map;
}

function listCatalogs(user, searchParams) {
    if (!user) fail('Vui lòng đăng nhập.', 401);
    const snapshot = db.readSnapshot();
    const allowed = allowedBranchesForUser(user, snapshot);
    const database = db.getDb();
    const rows = database.prepare('SELECT * FROM public_catalogs ORDER BY createdAt DESC').all();
    const nowIso = new Date().toISOString();
    const filterBranch = searchParams?.get ? String(searchParams.get('branch') || '').trim() : '';
    const filterStatus = searchParams?.get ? String(searchParams.get('status') || '').trim() : '';

    const visibleRows = rows.filter((row) => {
        if (user.role !== 'admin' && !allowed.has(row.branch)) return false;
        if (filterBranch && filterBranch !== 'ALL' && row.branch !== filterBranch) return false;
        if (filterStatus && filterStatus !== 'ALL') {
            if (effectiveStatus(row, nowIso) !== filterStatus) return false;
        }
        return true;
    });
    const itemsMap = loadCatalogItemsMap(
        database,
        visibleRows.map((r) => r.id)
    );
    return visibleRows.map((row) => formatCatalogRow(row, itemsMap.get(row.id) || [], nowIso));
}

function requireCatalogAccess(user, catalogId) {
    if (!user) fail('Vui lòng đăng nhập.', 401);
    const database = db.getDb();
    const row = database
        .prepare('SELECT * FROM public_catalogs WHERE id=?')
        .get(String(catalogId || ''));
    if (!row) fail('Không tìm thấy catalog.', 404);
    const snapshot = db.readSnapshot();
    if (!canAccessBranch(user, row.branch, snapshot))
        fail('Bạn không có quyền thao tác catalog của chi nhánh này.', 403);
    return { database, row, snapshot };
}

function getCatalogForUser(user, catalogId) {
    const { database, row } = requireCatalogAccess(user, catalogId);
    const items = database
        .prepare('SELECT * FROM public_catalog_items WHERE catalogId=? ORDER BY sortOrder ASC')
        .all(row.id);
    return formatCatalogRow(row, items);
}

function revokeCatalog(user, catalogId) {
    const { database, row } = requireCatalogAccess(user, catalogId);
    const nowIso = new Date().toISOString();
    database
        .prepare("UPDATE public_catalogs SET status='revoked', revokedAt=?, updatedAt=? WHERE id=?")
        .run(nowIso, nowIso, row.id);
    return getCatalogForUser(user, row.id);
}

function extendCatalog(user, catalogId, input = {}) {
    const { database, row } = requireCatalogAccess(user, catalogId);
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = resolveExpiresAt(input, now.getTime());
    database
        .prepare(
            "UPDATE public_catalogs SET status='active', expiresAt=?, revokedAt=NULL, updatedAt=? WHERE id=?"
        )
        .run(expiresAt, nowIso, row.id);
    return getCatalogForUser(user, row.id);
}

function duplicateCatalog(user, catalogId, input = {}) {
    const { database, row } = requireCatalogAccess(user, catalogId);
    const items = database
        .prepare('SELECT * FROM public_catalog_items WHERE catalogId=? ORDER BY sortOrder ASC')
        .all(row.id);
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = resolveExpiresAt(
        input.expiresInHours !== undefined || input.expiresAt !== undefined
            ? input
            : { expiresInHours: 72 },
        now.getTime()
    );
    const newId = `CAT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const newToken = generateUniqueToken(database);
    const newTitle = String(input.title || `${row.title} (Bản sao)`)
        .trim()
        .slice(0, 200);

    database.exec('BEGIN IMMEDIATE');
    try {
        database
            .prepare(
                `INSERT INTO public_catalogs (id, token, branch, createdBy, createdByName, title, message, contactName, contactPhone, status, expiresAt, createdAt, updatedAt, revokedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL)`
            )
            .run(
                newId,
                newToken,
                row.branch,
                user.id || user.username || '',
                user.name || user.username || '',
                newTitle,
                input.message !== undefined
                    ? String(input.message).trim().slice(0, 1000)
                    : row.message,
                row.contactName,
                row.contactPhone,
                expiresAt,
                nowIso,
                nowIso
            );
        const insertItem = database.prepare(
            `INSERT INTO public_catalog_items (id, catalogId, sourceType, sourceProductId, productCode, imei, sortOrder, name, category, displayPrice, description, condition, conditionDetail, images, availabilitySnapshot, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const item of items) {
            insertItem.run(
                crypto.randomUUID(),
                newId,
                item.sourceType,
                item.sourceProductId,
                item.productCode,
                item.imei || '',
                item.sortOrder,
                item.name,
                item.category,
                item.displayPrice,
                item.description,
                item.condition,
                item.conditionDetail,
                item.images,
                item.availabilitySnapshot,
                nowIso
            );
        }
        database.exec('COMMIT');
    } catch (err) {
        database.exec('ROLLBACK');
        throw err;
    }
    return getCatalogForUser(user, newId);
}

function rewritePublicImageUrl(token, rawUrl) {
    const clean = normalizeUploadPath(rawUrl);
    if (!clean) return '';
    if (clean.startsWith('/uploads/')) {
        const mediaId = computeCatalogMediaId(token, clean);
        return `/catalog-media/${encodeURIComponent(token)}/${mediaId}`;
    }
    return clean;
}

function getPublicCatalogByToken(token, nowIso = new Date().toISOString()) {
    const cleanToken = String(token || '').trim();
    if (!TOKEN_REGEX.test(cleanToken)) return { state: 'not_found', catalog: null };
    const database = db.getDb();
    const row = database.prepare('SELECT * FROM public_catalogs WHERE token=?').get(cleanToken);
    if (!row) return { state: 'not_found', catalog: null };

    const snapshot = db.readSnapshot();
    const storeName = String(
        snapshot.settings?.storeName || snapshot.settings?.logoText || 'NKiot'
    );
    const storeHotline = String(snapshot.settings?.hotline || snapshot.settings?.phone || '');
    const storeAddress = String(snapshot.settings?.address || '');

    const status = effectiveStatus(row, nowIso);
    if (status !== 'active') {
        return {
            state: status,
            catalog: {
                title: row.title,
                branch: row.branch,
                contactName: row.contactName || storeName,
                contactPhone: row.contactPhone || storeHotline,
                storeName,
                storeHotline,
                storeAddress,
                expiresAt: row.expiresAt || null,
                revokedAt: row.revokedAt || null
            }
        };
    }

    const items = database
        .prepare('SELECT * FROM public_catalog_items WHERE catalogId=? ORDER BY sortOrder ASC')
        .all(row.id);

    return {
        state: 'active',
        catalog: {
            id: row.id,
            token: row.token,
            branch: row.branch,
            title: row.title,
            message: row.message || '',
            contactName: row.contactName || row.createdByName || storeName,
            contactPhone: row.contactPhone || storeHotline,
            storeName,
            storeHotline,
            storeAddress,
            expiresAt: row.expiresAt || null,
            createdAt: row.createdAt,
            items: items.map((item) => {
                const imgs = parseImages(item.images)
                    .map((u) => rewritePublicImageUrl(row.token, u))
                    .filter(Boolean);
                const rawImei = String(item.imei || '').trim();
                const unitTag = rawImei
                    ? rawImei.length > 6
                        ? `***${rawImei.slice(-6)}`
                        : rawImei
                    : '';
                return {
                    id: item.id,
                    name: item.name,
                    unitTag,
                    category: item.category || '',
                    displayPrice: Number(item.displayPrice) || 0,
                    description: item.description || '',
                    condition: item.condition || 'new',
                    conditionDetail: item.conditionDetail || '',
                    images: imgs,
                    availability: item.availabilitySnapshot || 'in_stock'
                };
            })
        }
    };
}

function resolveCatalogMediaFile(token, mediaId, uploadsDir, nowIso = new Date().toISOString()) {
    const cleanToken = String(token || '').trim();
    const cleanMediaId = String(mediaId || '')
        .trim()
        .toLowerCase();
    if (!TOKEN_REGEX.test(cleanToken) || !MEDIA_ID_REGEX.test(cleanMediaId)) return null;

    const database = db.getDb();
    const row = database.prepare('SELECT * FROM public_catalogs WHERE token=?').get(cleanToken);
    if (!row || effectiveStatus(row, nowIso) !== 'active') return null;

    const items = database
        .prepare('SELECT images FROM public_catalog_items WHERE catalogId=?')
        .all(row.id);
    let matchedUploadPath = '';
    for (const item of items) {
        for (const rawImg of parseImages(item.images)) {
            const clean = normalizeUploadPath(rawImg);
            if (
                clean.startsWith('/uploads/') &&
                computeCatalogMediaId(cleanToken, clean) === cleanMediaId
            ) {
                matchedUploadPath = clean;
                break;
            }
        }
        if (matchedUploadPath) break;
    }
    if (!matchedUploadPath) return null;

    const filename = path.basename(matchedUploadPath);
    const resolvedDir = path.resolve(uploadsDir);
    const safePath = path.resolve(resolvedDir, filename);
    if (path.dirname(safePath) !== resolvedDir) return null;
    return { safePath, filename };
}

function formatCurrencyVnd(amount) {
    const num = Math.round(Number(amount) || 0);
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ';
}

function conditionLabel(cond) {
    const map = {
        new: 'Mới 100%',
        like_new: 'Like New 99%',
        good: 'Đẹp 97-98%',
        fair: 'Trầy xước nhẹ',
        used: 'Đã qua sử dụng'
    };
    return map[cond] || '';
}

function formatDateTimeVn(iso) {
    if (!iso) return 'Không giới hạn';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderCatalogCardHtml(item, cleanPhone) {
    const primaryImg = item.images[0] || '';
    const condText = conditionLabel(item.condition);
    const availBadge =
        item.availability === 'in_stock'
            ? '<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">Sẵn hàng</span>'
            : '<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">Liên hệ xác nhận</span>';
    const unitBadge = item.unitTag
        ? `<span class="px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-slate-900/75 text-white">Máy ${escapeHtml(item.unitTag)}</span>`
        : '';
    const imgHtml = primaryImg
        ? `<img src="${escapeHtml(primaryImg)}" alt="${escapeHtml(item.name)}" loading="lazy" class="catalog-main-img w-full h-full object-cover">`
        : '<div class="text-slate-400 text-xs font-medium px-4 text-center">Chưa có ảnh</div>';
    const thumbRow =
        Array.isArray(item.images) && item.images.length > 1
            ? `<div class="flex gap-1.5 px-3.5 pt-2 overflow-x-auto">${item.images
                  .map(
                      (u, idx) =>
                          `<button type="button" onclick="var m=this.closest('article').querySelector('.catalog-main-img');if(m)m.src=this.dataset.src;" data-src="${escapeHtml(u)}" class="w-10 h-10 rounded-lg overflow-hidden border ${idx === 0 ? 'border-blue-500' : 'border-slate-200'} shrink-0"><img src="${escapeHtml(u)}" alt="" loading="lazy" class="w-full h-full object-cover"></button>`
                  )
                  .join('')}</div>`
            : '';
    const imgCount = Array.isArray(item.images) ? item.images.length : 0;
    const downloadAllBtn =
        imgCount > 0
            ? `<button type="button" data-download-all-images data-images="${escapeHtml(JSON.stringify(item.images))}" data-item-name="${escapeHtml(item.name)}" onclick="downloadCatalogItemImages(this)" class="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer" title="Tải tất cả ${imgCount} ảnh của sản phẩm này">⬇ Tải tất cả ảnh (${imgCount})</button>`
            : '';
    const metaText = [condText, item.conditionDetail].filter(Boolean).join(' · ');
    const ctaBtn = cleanPhone
        ? `<a href="tel:${escapeHtml(cleanPhone)}" class="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition">Liên hệ</a>`
        : '';
    return `<article class="catalog-card bg-white rounded-2xl border border-slate-200/90 shadow-xs hover:shadow-md transition overflow-hidden flex flex-col" data-item-id="${escapeHtml(item.id)}"><div class="relative aspect-square bg-slate-100 flex items-center justify-center overflow-hidden">${imgHtml}<div class="absolute top-2.5 left-2.5 flex flex-wrap gap-1">${availBadge}${unitBadge}</div></div>${thumbRow}<div class="p-3.5 sm:p-4 flex-1 flex flex-col justify-between gap-2"><div>${item.category ? `<p class="text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-0.5">${escapeHtml(item.category)}</p>` : ''}<h2 class="font-bold text-slate-900 text-[14.5px] sm:text-[15px] leading-snug">${escapeHtml(item.name)}</h2>${metaText ? `<p class="text-xs text-slate-600 mt-1">${escapeHtml(metaText)}</p>` : ''}${item.description ? `<p class="text-xs text-slate-500 mt-1.5 leading-relaxed">${escapeHtml(item.description)}</p>` : ''}</div><div class="pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 mt-1"><span class="text-[16px] sm:text-[17px] font-extrabold text-rose-600 tabular-nums">${escapeHtml(formatCurrencyVnd(item.displayPrice))}</span><div class="flex items-center gap-1.5">${downloadAllBtn}${ctaBtn}</div></div></div></article>`;
}

function renderPublicCatalogHtml(lookup) {
    const state = lookup?.state || 'not_found';
    const cat = lookup?.catalog || null;
    const storeName = escapeHtml(cat?.storeName || 'NKiot');
    const contactName = escapeHtml(cat?.contactName || cat?.storeName || 'Tư vấn viên');
    const contactPhone = escapeHtml(cat?.contactPhone || cat?.storeHotline || '');
    const cleanPhone = String(cat?.contactPhone || cat?.storeHotline || '').replace(/[^0-9+]/g, '');

    if (state !== 'active' || !cat) {
        const heading =
            state === 'expired'
                ? 'Catalog này đã hết thời gian hiệu lực'
                : state === 'revoked'
                  ? 'Catalog này đã được thu hồi'
                  : 'Không tìm thấy catalog';
        const sub =
            state === 'expired' || state === 'revoked'
                ? 'Danh sách sản phẩm tư vấn này đã kết thúc hiệu lực. Vui lòng liên hệ trực tiếp cửa hàng để nhận báo giá và mẫu mới nhất.'
                : 'Đường dẫn catalog không chính xác hoặc đã bị xóa.';
        const cta = cleanPhone
            ? `<a href="tel:${escapeHtml(cleanPhone)}" class="inline-flex items-center justify-center w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition">Liên hệ ${contactName} (${contactPhone})</a>`
            : '';
        return `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${escapeHtml(heading)} - ${storeName}</title><link rel="stylesheet" href="/assets/inter.css"><link rel="stylesheet" href="/assets/tailwind.css"></head><body class="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-4"><main class="max-w-md w-full bg-white rounded-2xl border border-slate-200 shadow-lg p-6 text-center"><p class="text-xs font-semibold uppercase tracking-wider text-blue-600 mb-1">${storeName}</p><h1 class="text-lg font-bold text-slate-900 mb-2">${escapeHtml(heading)}</h1><p class="text-sm text-slate-600 leading-relaxed mb-5">${escapeHtml(sub)}</p>${cta}</main></body></html>`;
    }

    const cardsHtml = cat.items.map((item) => renderCatalogCardHtml(item, cleanPhone)).join('\n');
    const headerCta = cleanPhone
        ? `<a href="tel:${escapeHtml(cleanPhone)}" class="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold transition">Gọi ${contactPhone}</a>`
        : '';
    const msgHtml = cat.message
        ? `<div class="mb-5 p-4 rounded-2xl bg-blue-50/80 border border-blue-200/70 text-sm text-slate-700 leading-relaxed"><strong>Lời nhắn từ ${contactName}:</strong> ${escapeHtml(cat.message)}</div>`
        : '';

    const downloadScript = `<script>function downloadCatalogItemImages(btn){try{var urls=JSON.parse(btn.getAttribute('data-images')||'[]');if(!urls.length)return;var rawName=btn.getAttribute('data-item-name')||'san-pham';var slug=rawName.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase()||'san-pham';var orig=btn.textContent;btn.disabled=true;urls.forEach(function(u,idx){setTimeout(function(){var sep=u.indexOf('?')===-1?'?':'&';var href=u+sep+'download=1&name='+encodeURIComponent(slug+'-'+(idx+1));var a=document.createElement('a');a.href=href;a.download=slug+'-'+(idx+1);document.body.appendChild(a);a.click();a.remove();if(idx===urls.length-1){btn.disabled=false;btn.textContent=orig;}},idx*280);});}catch(e){btn.disabled=false;}}</script>`;

    return `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${escapeHtml(cat.title)} - ${storeName}</title><link rel="stylesheet" href="/assets/inter.css"><link rel="stylesheet" href="/assets/tailwind.css"></head><body class="min-h-screen bg-slate-50 text-slate-900"><header class="bg-white border-b border-slate-200/80 sticky top-0 z-20"><div class="max-w-6xl mx-auto px-4 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"><div><div class="flex items-center gap-2"><span class="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-blue-50 text-blue-700">${storeName}</span>${cat.branch ? `<span class="text-xs text-slate-500">${escapeHtml(cat.branch)}</span>` : ''}</div><h1 class="text-lg sm:text-xl font-bold text-slate-900 mt-1">${escapeHtml(cat.title)}</h1></div><div class="flex items-center gap-2 text-xs text-slate-600"><span>Hiệu lực đến: <strong>${escapeHtml(formatDateTimeVn(cat.expiresAt))}</strong></span>${headerCta}</div></div></header><main class="max-w-6xl mx-auto px-4 py-5">${msgHtml}<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">${cardsHtml}</div></main>${downloadScript}</body></html>`;
}

module.exports = {
    createCatalog,
    listCatalogs,
    getCatalogForUser,
    revokeCatalog,
    extendCatalog,
    duplicateCatalog,
    getPublicCatalogByToken,
    resolveCatalogMediaFile,
    renderPublicCatalogHtml,
    computeCatalogMediaId
};
