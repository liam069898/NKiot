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
    if (targetBranch === 'ALL' || targetBranch === 'Toàn bộ chi nhánh')
        fail('Vui lòng chọn một chi nhánh cụ thể để tạo catalog.', 400);
    if (!canAccessBranch(user, targetBranch, snapshot))
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

    const selectedImeis = new Set();
    const resolvedItems = expandedEntries.map((itemObj, idx) => {
        const wantId = String(itemObj.productId || itemObj.id || '').trim();
        const wantCode = String(itemObj.code || itemObj.productCode || '').trim();
        const wantImei = String(itemObj.imei || itemObj.serial || '').trim();
        const candidates = products.filter((p) => {
            const branchName = p.branch || FALLBACK_BRANCH;
            if (branchName !== targetBranch) return false;
            if (user.role !== 'admin' && !allowedBranches.has(branchName)) return false;
            return (wantId && String(p.id) === wantId) || (wantCode && p.code === wantCode);
        });
        if (!candidates.length) fail(`Không tìm thấy sản phẩm hợp lệ ở mục #${idx + 1}.`, 404);
        if (!wantImei && candidates.some((product) => product.hasImei))
            fail(`Vui lòng chọn IMEI cho sản phẩm ở mục #${idx + 1}.`, 400);

        let matchedCandidate = null;
        let imeiDetail = null;
        if (wantImei) {
            if (selectedImeis.has(wantImei)) fail('IMEI đã được chọn trong catalog.', 400);
            selectedImeis.add(wantImei);
            for (const cand of candidates) {
                const imeiList = Array.isArray(cand.imeis) ? cand.imeis : [];
                const details =
                    cand.imeiDetails && typeof cand.imeiDetails === 'object'
                        ? cand.imeiDetails
                        : {};
                if (imeiList.includes(wantImei)) {
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

function listCatalogs(user, searchParams) {
    if (!user) fail('Vui lòng đăng nhập.', 401);
    const snapshot = db.readSnapshot();
    const allowed = allowedBranchesForUser(user, snapshot);
    const database = db.getDb();
    const nowIso = new Date().toISOString();
    const filterBranch = searchParams?.get ? String(searchParams.get('branch') || '').trim() : '';
    const filterStatus = searchParams?.get ? String(searchParams.get('status') || '').trim() : '';
    const page = Number(searchParams?.get('page') || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) fail('Trang không hợp lệ.');
    const limit = 25;
    const clauses = [];
    const args = [];
    if (user.role !== 'admin') {
        if (!allowed.size) return { catalogs: [], page, hasMore: false };
        clauses.push(`branch IN (${Array.from(allowed, () => '?').join(',')})`);
        args.push(...allowed);
    }
    if (filterBranch && filterBranch !== 'ALL') {
        clauses.push('branch = ?');
        args.push(filterBranch);
    }
    if (filterStatus && filterStatus !== 'ALL') {
        if (filterStatus === 'revoked')
            clauses.push("(status = 'revoked' OR revokedAt IS NOT NULL)");
        else if (filterStatus === 'expired') {
            clauses.push(
                "status != 'revoked' AND revokedAt IS NULL AND expiresAt IS NOT NULL AND expiresAt <= ?"
            );
            args.push(nowIso);
        } else if (filterStatus === 'active') {
            clauses.push(
                "status = 'active' AND revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > ?)"
            );
            args.push(nowIso);
        } else fail('Trạng thái không hợp lệ.');
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = database
        .prepare(
            `SELECT *, (SELECT COUNT(*) FROM public_catalog_items i WHERE i.catalogId = c.id) AS itemCount FROM public_catalogs c ${where} ORDER BY createdAt DESC, id DESC LIMIT ? OFFSET ?`
        )
        .all(...args, limit + 1, (page - 1) * limit);
    const hasMore = rows.length > limit;
    const catalogs = rows.slice(0, limit).map((row) => {
        const { items, ...summary } = formatCatalogRow(row, [], nowIso);
        return { ...summary, itemCount: row.itemCount };
    });
    return { catalogs, page, hasMore };
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
    let baseTime = now.getTime();
    if (row.status === 'active' && row.expiresAt) {
        const currentExpMs = Date.parse(row.expiresAt);
        if (Number.isFinite(currentExpMs) && currentExpMs > baseTime) {
            baseTime = currentExpMs;
        }
    }
    const expiresAt = resolveExpiresAt(input, baseTime);
    if (row.status === 'active' && !row.expiresAt && expiresAt && input.allowLimited !== true)
        fail('Link đang không giới hạn; cần xác nhận rõ khi đặt thời hạn.', 400);
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
            ? '<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500 text-white shadow-xs"><span class="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>Sẵn hàng</span>'
            : '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500 text-white shadow-xs">Liên hệ xác nhận</span>';
    const unitBadge = item.unitTag
        ? `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-slate-900/85 text-white shadow-xs">Máy ${escapeHtml(item.unitTag)}</span>`
        : '';
    const imgCount = Array.isArray(item.images) ? item.images.length : 0;
    const countBadge =
        imgCount > 1
            ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-xs text-white text-[10.5px] font-medium">📷 ${imgCount} ảnh</span>`
            : '';

    const imgHtml = primaryImg
        ? `<button type="button" class="w-full h-full flex items-center justify-center p-0 bg-transparent border-0 cursor-zoom-in" onclick="openCatalogLightbox(this.querySelector('img').src, this.querySelector('img').alt)" aria-label="Xem ảnh lớn: ${escapeHtml(item.name)}"><img src="${escapeHtml(primaryImg)}" alt="${escapeHtml(item.name)}" loading="lazy" class="catalog-main-img w-full h-full object-contain p-3 transition-transform duration-300 group-hover:scale-105"></button>`
        : `<div class="w-full h-full flex flex-col items-center justify-center p-6 text-center select-none bg-gradient-to-b from-slate-50 to-slate-100/80">
            <div class="w-14 h-14 rounded-2xl bg-white border border-slate-200/90 shadow-2xs flex items-center justify-center text-slate-300 mb-2">
                <svg class="w-7 h-7" fill="none" stroke="currentColor" stroke-width="1.6" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"/></svg>
            </div>
            <span class="text-[12px] font-semibold text-slate-500">Chưa có ảnh</span>
            <span class="text-[10.5px] text-slate-400 mt-0.5">Liên hệ để nhận ảnh chụp thực tế</span>
        </div>`;

    const thumbRow =
        imgCount > 1
            ? `<div class="flex gap-1.5 px-3 py-2 bg-slate-50/70 border-b border-slate-100 overflow-x-auto no-scrollbar">${item.images
                  .map(
                      (u, idx) =>
                          `<button type="button" aria-label="Xem ảnh ${idx + 1}/${imgCount}" aria-pressed="${idx === 0}" onclick="selectCardThumb(this, this.dataset.src)" data-src="${escapeHtml(u)}" class="catalog-thumb-btn w-9 h-9 rounded-lg overflow-hidden border-2 ${idx === 0 ? 'border-blue-600 ring-2 ring-blue-500/20' : 'border-slate-200 opacity-70 hover:opacity-100'} shrink-0 transition cursor-pointer bg-white"><img src="${escapeHtml(u)}" alt="" loading="lazy" class="w-full h-full object-cover"></button>`
                  )
                  .join('')}</div>`
            : '';

    const downloadAllBtn =
        imgCount > 0
            ? `<button type="button" data-download-all-images data-images="${escapeHtml(JSON.stringify(item.images))}" data-item-name="${escapeHtml(item.name)}" onclick="downloadCatalogItemImages(this)" class="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer flex items-center gap-1" title="Tải tất cả ${imgCount} ảnh của sản phẩm này">⬇ Tải tất cả ảnh (${imgCount})</button>`
            : '';

    const downloadLinks = imgCount
        ? `<details class="px-3 pb-2 text-xs text-slate-600"><summary class="cursor-pointer font-semibold">Tải từng ảnh</summary><div class="flex flex-wrap gap-2 pt-2">${item.images
              .map((u, idx) => {
                  const local = u.startsWith('/catalog-media/');
                  const href = local ? `${u}?download=1` : u;
                  return `<a href="${escapeHtml(href)}" ${local ? 'download' : 'target="_blank" rel="noopener noreferrer"'} class="text-blue-700 underline">Ảnh ${idx + 1}</a>`;
              })
              .join(
                  ''
              )}</div><p>Ảnh từ nguồn bên ngoài sẽ mở ở tab mới; cách lưu tùy trình duyệt.</p></details>`
        : '';

    const metaParts = [condText, item.conditionDetail].filter(Boolean);
    const metaHtml = metaParts.length
        ? `<div class="flex flex-wrap items-center gap-1.5 text-xs text-slate-600 font-medium">${metaParts.map((t) => `<span class="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[11.5px]">${escapeHtml(t)}</span>`).join('')}</div>`
        : '';

    const ctaBtn = cleanPhone
        ? `<a href="tel:${escapeHtml(cleanPhone)}" class="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition shadow-xs">Liên hệ</a>`
        : '';

    return `<article class="catalog-card group bg-white rounded-2xl border border-slate-200/90 shadow-xs hover:shadow-xl hover:border-blue-400/60 transition-all duration-300 overflow-hidden flex flex-col h-full" data-item-id="${escapeHtml(item.id)}"><div class="relative w-full aspect-square bg-gradient-to-b from-slate-50/60 to-white flex items-center justify-center overflow-hidden border-b border-slate-100 flex-shrink-0">${imgHtml}<div class="absolute top-2.5 left-2.5 flex flex-wrap gap-1">${availBadge}${unitBadge}</div>${countBadge ? `<div class="absolute bottom-2.5 right-2.5">${countBadge}</div>` : ''}</div>${thumbRow}${downloadLinks}<div class="p-3.5 sm:p-4 flex-1 flex flex-col justify-between gap-3"><div>${item.category ? `<p class="text-[10.5px] font-bold text-blue-600 uppercase tracking-wider mb-1">${escapeHtml(item.category)}</p>` : ''}<h2 class="font-bold text-slate-900 text-[14.5px] sm:text-[15px] leading-snug line-clamp-2 min-h-[42px]">${escapeHtml(item.name)}</h2><div class="mt-2 space-y-1">${metaHtml}${item.description ? `<p class="text-xs text-slate-500 line-clamp-2 leading-relaxed mt-1">${escapeHtml(item.description)}</p>` : ''}</div></div><div class="pt-3 border-t border-slate-100/90 flex flex-wrap items-center justify-between gap-2 mt-auto"><div class="flex flex-col"><span class="text-[10.5px] text-slate-400 font-medium">Giá tư vấn</span><span class="text-[17px] sm:text-[18.5px] font-extrabold text-rose-600 tabular-nums">${escapeHtml(formatCurrencyVnd(item.displayPrice))}</span></div><div class="flex items-center gap-1.5">${downloadAllBtn}${ctaBtn}</div></div></div></article>`;
}

function getCatalogClientScripts() {
    return `<script>
var lastLightboxTrigger=null;
function selectCardThumb(btn,src){var card=btn.closest('article');if(!card)return;var main=card.querySelector('.catalog-main-img');if(main)main.src=src;card.querySelectorAll('.catalog-thumb-btn').forEach(function(b){b.className='catalog-thumb-btn w-9 h-9 rounded-lg overflow-hidden border-2 border-slate-200 opacity-70 hover:opacity-100 shrink-0 transition cursor-pointer bg-white';b.setAttribute('aria-pressed','false');});btn.className='catalog-thumb-btn w-9 h-9 rounded-lg overflow-hidden border-2 border-blue-600 ring-2 ring-blue-500/20 shrink-0 transition cursor-pointer bg-white';btn.setAttribute('aria-pressed','true');}
function openCatalogLightbox(src,title){var m=document.getElementById('catalog-lightbox-modal');if(!m)return;lastLightboxTrigger=document.activeElement;document.getElementById('catalog-lightbox-img').src=src;document.getElementById('catalog-lightbox-title').textContent=title||'';m.classList.remove('hidden');document.body.style.overflow='hidden';var c=document.getElementById('catalog-lightbox-close');if(c)c.focus();}
function closeCatalogLightbox(){var m=document.getElementById('catalog-lightbox-modal');if(!m)return;m.classList.add('hidden');document.body.style.overflow='';if(lastLightboxTrigger&&typeof lastLightboxTrigger.focus==='function'){lastLightboxTrigger.focus();lastLightboxTrigger=null;}}
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeCatalogLightbox();var m=document.getElementById('catalog-lightbox-modal');if(m&&!m.classList.contains('hidden')&&e.key==='Tab'){var f=m.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');if(f.length){var first=f[0];var last=f[f.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}}});
function downloadCatalogItemImages(btn){try{var urls=JSON.parse(btn.getAttribute('data-images')||'[]');var local=urls.filter(function(u){return u.indexOf('/catalog-media/')===0;});var external=urls.length-local.length;if(!local.length){window.alert('Ảnh từ nguồn ngoài không hỗ trợ tải tự động. Vui lòng chọn “Tải từng ảnh”.');return;}var rawName=btn.getAttribute('data-item-name')||'san-pham';var slug=rawName.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase()||'san-pham';btn.disabled=true;local.forEach(function(u,idx){setTimeout(function(){var a=document.createElement('a');a.href=u+'?download=1&name='+encodeURIComponent(slug+'-'+(idx+1));a.download=slug+'-'+(idx+1);document.body.appendChild(a);a.click();a.remove();if(idx===local.length-1){btn.disabled=false;}},idx*280);});if(local.length>1||external)window.alert('Trình duyệt có thể chặn tải nhiều file. Nếu thiếu ảnh, hãy chọn “Tải từng ảnh”.'+(external?' Ảnh từ nguồn ngoài cần tải riêng.':''));}catch(e){btn.disabled=false;window.alert('Không thể tải ảnh. Vui lòng chọn “Tải từng ảnh”.');}}
</script>`;
}

function getCatalogLightboxModal() {
    return `<div id="catalog-lightbox-modal" role="dialog" aria-modal="true" aria-labelledby="catalog-lightbox-title" class="hidden fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4" onclick="if(event.target===this)closeCatalogLightbox()"><div class="relative max-w-4xl w-full max-h-[92vh] flex flex-col items-center"><div class="w-full flex items-center justify-between text-white pb-3 px-1"><span id="catalog-lightbox-title" class="font-bold text-sm sm:text-base truncate"></span><button type="button" id="catalog-lightbox-close" onclick="closeCatalogLightbox()" class="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center text-lg font-bold transition cursor-pointer" aria-label="Đóng xem ảnh lớn">✕</button></div><div class="relative w-full max-h-[82vh] bg-black/40 rounded-2xl overflow-hidden flex items-center justify-center border border-white/10"><img id="catalog-lightbox-img" src="" alt="" class="max-w-full max-h-[80vh] object-contain select-none"></div></div></div>`;
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
            ? `<div class="flex flex-col sm:flex-row gap-2.5 mt-5">
                <a href="tel:${escapeHtml(cleanPhone)}" class="inline-flex items-center justify-center flex-1 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition shadow-xs">Liên hệ ${contactName} (${contactPhone})</a>
                <a href="https://zalo.me/${cleanPhone.startsWith('0') ? '84' + cleanPhone.slice(1) : cleanPhone}" target="_blank" rel="noopener" class="inline-flex items-center justify-center py-2.5 px-4 rounded-xl bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 font-semibold text-sm transition">Zalo</a>
               </div>`
            : '';
        return `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${escapeHtml(heading)} - ${storeName}</title><link rel="stylesheet" href="/assets/inter.css"><link rel="stylesheet" href="/assets/tailwind.css"></head><body class="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-4"><main class="max-w-md w-full bg-white rounded-3xl border border-slate-200/90 shadow-xl p-6 sm:p-8 text-center"><div class="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-3 text-2xl font-bold border border-amber-200/70">!</div><p class="text-xs font-bold uppercase tracking-widest text-blue-600 mb-1.5">${storeName}</p><h1 class="text-lg sm:text-xl font-bold text-slate-900 mb-2">${escapeHtml(heading)}</h1><p class="text-sm text-slate-600 leading-relaxed">${escapeHtml(sub)}</p>${cta}</main></body></html>`;
    }

    const cardsHtml = cat.items.map((item) => renderCatalogCardHtml(item, cleanPhone)).join('\n');
    const zaloPhone = cleanPhone.startsWith('0') ? '84' + cleanPhone.slice(1) : cleanPhone;
    const headerCta = cleanPhone
        ? `<div class="flex items-center gap-2">
            <a href="https://zalo.me/${escapeHtml(zaloPhone)}" target="_blank" rel="noopener" class="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold transition border border-blue-200/80"><span>💬</span><span>Nhắn Zalo</span></a>
            <a href="tel:${escapeHtml(cleanPhone)}" class="px-3.5 py-1.5 rounded-xl bg-[#0066cc] hover:bg-blue-700 text-white text-xs font-bold transition shadow-xs flex items-center gap-1.5"><span>📞</span><span>Gọi ${contactPhone}</span></a>
           </div>`
        : '';
    const msgHtml = cat.message
        ? `<div class="mb-6 p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-blue-50/90 via-indigo-50/50 to-blue-50/80 border border-blue-200/80 shadow-xs flex items-start gap-3.5"><div class="w-10 h-10 rounded-xl bg-[#0066cc] text-white font-bold flex items-center justify-center shrink-0 shadow-xs text-sm">${escapeHtml((contactName || 'T').charAt(0).toUpperCase())}</div><div class="min-w-0 flex-1"><div class="flex items-center gap-2 mb-0.5"><span class="text-xs font-bold text-blue-950">${contactName}</span><span class="text-[11px] text-blue-600/80 font-medium">· Tư vấn viên</span></div><p class="text-sm text-slate-700 leading-relaxed font-normal">${escapeHtml(cat.message)}</p></div></div>`
        : '';

    const floatingMobileCta = cleanPhone
        ? `<div class="sm:hidden fixed bottom-4 right-4 z-40 flex items-center gap-2">
            <a href="https://zalo.me/${escapeHtml(zaloPhone)}" target="_blank" rel="noopener" class="w-12 h-12 rounded-full bg-white border border-blue-300 text-blue-600 flex items-center justify-center shadow-lg font-bold text-lg">💬</a>
            <a href="tel:${escapeHtml(cleanPhone)}" class="h-12 px-4 rounded-full bg-blue-600 text-white flex items-center gap-2 shadow-lg font-bold text-xs"><span>📞</span><span>Gọi ngay</span></a>
           </div>`
        : '';

    return `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>${escapeHtml(cat.title)} - ${storeName}</title><link rel="stylesheet" href="/assets/inter.css"><link rel="stylesheet" href="/assets/tailwind.css"></head><body class="min-h-screen bg-slate-50/90 text-slate-900 antialiased"><header class="bg-white/95 backdrop-blur-md border-b border-slate-200/80 sticky top-0 z-30 shadow-2xs"><div class="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"><div><div class="flex items-center gap-2"><span class="text-xs font-black uppercase tracking-wider px-2.5 py-0.5 rounded-lg bg-blue-50 text-blue-700 border border-blue-200/60">${storeName}</span>${cat.branch ? `<span class="text-xs text-slate-500 font-medium">${escapeHtml(cat.branch)}</span>` : ''}</div><h1 class="text-lg sm:text-2xl font-black text-slate-900 mt-1 tracking-tight">${escapeHtml(cat.title)}</h1></div><div class="flex items-center gap-2.5 text-xs text-slate-600 justify-between sm:justify-end"><span class="px-2.5 py-1 rounded-lg bg-slate-100/90 border border-slate-200/60 text-slate-600">Hiệu lực đến: <strong>${escapeHtml(formatDateTimeVn(cat.expiresAt))}</strong></span>${headerCta}</div></div></header><main class="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8"><div class="mb-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-50/90 border border-amber-200/70 text-amber-800 text-[11.5px] font-medium shadow-2xs"><span>ℹ️</span><span>Thông tin và giá được ghi nhận tại thời điểm tạo catalog · Vui lòng liên hệ để xác nhận tồn kho thực tế.</span></div>${msgHtml}<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6 items-stretch">${cardsHtml}</div></main>${floatingMobileCta}${getCatalogLightboxModal()}${getCatalogClientScripts()}</body></html>`;
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
