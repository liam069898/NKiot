'use strict';
require('./test-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nkiot-shared-'));
process.env.NKIOT_DB_PATH = path.join(dir, 'test.sqlite');
process.env.MINIKIOT_ADMIN_PASSWORD = 'Test-password-123';
const db = require('../db');
const { transact, project, revision } = require('../application');

function setupTestDb() {
    db.closeDb();
    const testFile = path.join(
        dir,
        `test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
    );
    process.env.NKIOT_DB_PATH = testFile;
    db.initDb(testFile);
    const fixture = db.getAllData();
    fixture.products = JSON.parse(JSON.stringify(require('../data').defaultData.products));
    fixture.suppliers = JSON.parse(JSON.stringify(require('../data').defaultData.suppliers));
    db.saveAllData(fixture);
    return () => {
        db.closeDb();
    };
}

test('Shared Warehouse: share, update, unshare and auto-sync stock availability', () => {
    const cleanup = setupTestDb();
    try {
        const initial = db.getAllData();
        const adminUser = initial.users.find((u) => u.role === 'admin');
        const prod = initial.products.find((p) => p.stock > 0);
        assert.ok(prod, 'Sample product with stock exists');

        const makeReqId = () =>
            `req-${Date.now()}-${Math.random().toString(36).slice(2).padEnd(16, '0')}`;

        // 1. Share product
        const shareResult = transact(adminUser, {
            requestId: makeReqId(),
            revision: revision(),
            type: 'shareProduct',
            payload: {
                productId: prod.id,
                wholesalePrice: 150000,
                minOrderQty: 2,
                note: 'Hàng sẵn tại kho, giao ngay'
            }
        });

        assert.ok(shareResult.result.id.startsWith('SKC'), 'Generates SKC code');
        assert.equal(shareResult.result.wholesalePrice, 150000);
        assert.equal(shareResult.result.minOrderQty, 2);
        assert.equal(shareResult.result.availability, 'in_stock');

        // Verify persisted in DB
        const dataAfterShare = db.getAllData();
        const shared = dataAfterShare.shared_products.find((s) => s.sourceProductId === prod.id);
        assert.ok(shared, 'Shared product exists in database');
        assert.equal(shared.status, 'active');

        // 2. Update shared product
        transact(adminUser, {
            requestId: makeReqId(),
            revision: revision(),
            type: 'updateSharedProduct',
            payload: {
                sharedProductId: shared.id,
                wholesalePrice: 140000,
                minOrderQty: 5,
                note: 'Ưu đãi đối tác lớn'
            }
        });

        const dataAfterUpdate = db.getAllData();
        const updatedShared = dataAfterUpdate.shared_products.find((s) => s.id === shared.id);
        assert.equal(updatedShared.wholesalePrice, 140000);
        assert.equal(updatedShared.minOrderQty, 5);
        assert.equal(updatedShared.note, 'Ưu đãi đối tác lớn');

        // 3. Auto-sync availability on sale
        // Sell remaining stock so stock reaches 0
        const currProd = dataAfterUpdate.products.find((p) => p.id === prod.id);
        const totalSale = currProd.price * currProd.stock;
        transact(adminUser, {
            requestId: makeReqId(),
            revision: revision(),
            type: 'sale',
            payload: {
                branch: currProd.branch,
                given: totalSale,
                paid: totalSale,
                paymentMethod: 'cash',
                items: [
                    {
                        code: currProd.code,
                        qty: currProd.stock,
                        price: currProd.price,
                        costPrice: currProd.costPrice
                    }
                ]
            }
        });

        const dataAfterSale = db.getAllData();
        const sharedAfterSale = dataAfterSale.shared_products.find((s) => s.id === shared.id);
        assert.equal(
            sharedAfterSale.availability,
            'out_of_stock',
            'Auto-synced to out_of_stock when product stock is 0'
        );

        // 4. Project: Public system-wide visibility
        const regularUser = initial.users.find((u) => u.role !== 'admin');
        if (regularUser) {
            const projected = project(dataAfterSale, regularUser);
            assert.ok(
                projected.shared_products.some((s) => s.id === shared.id),
                'Shared product is visible system-wide to other users with products permission'
            );
        }

        // 5. Unshare product
        transact(adminUser, {
            requestId: makeReqId(),
            revision: revision(),
            type: 'unshareProduct',
            payload: {
                sharedProductId: shared.id
            }
        });

        const dataAfterUnshare = db.getAllData();
        const sharedAfterUnshare = dataAfterUnshare.shared_products.find((s) => s.id === shared.id);
        assert.equal(sharedAfterUnshare.status, 'removed');
    } finally {
        cleanup();
    }
});

test('Shared Warehouse: inherits media (images, video) and condition grading from initial stock-in product', () => {
    const cleanup = setupTestDb();
    try {
        const initial = db.getAllData();
        const adminUser = initial.users.find((u) => u.role === 'admin');
        const makeReqId = () =>
            `req-${Date.now()}-${Math.random().toString(36).slice(2).padEnd(16, '0')}`;

        // 1. Create a used product (e.g. from stock-in) with rich media & condition
        const productPayload = {
            id: 'SP_IPHONE12_USED',
            code: 'IP12_99',
            name: 'iPhone 12 Pro Max 128GB Xanh',
            category: 'Điện thoại',
            costPrice: 9000000,
            price: 11500000,
            stock: 3,
            minStock: 1,
            unit: 'Chiếc',
            branch: initial.products[0].branch,
            status: 'active',
            hasImei: false,
            imeis: [],
            condition: 'like_new',
            conditionDetail: 'Pin 95%, máy nguyên zin chưa qua sửa chữa, viền phẩy nhẹ',
            description: 'Tặng kèm củ sạc 20W, cáp type C, bảo hành 6 tháng.',
            images: ['/uploads/ip12_front.jpg', '/uploads/ip12_back.jpg'],
            videoUrl: '/uploads/ip12_review.mp4'
        };

        const incoming = {
            ...project(initial, adminUser),
            products: [...initial.products, productPayload]
        };

        transact(adminUser, {
            requestId: makeReqId(),
            revision: revision(),
            type: 'edit',
            payload: incoming
        });

        const dataAfterCreate = db.getAllData();
        const createdProd = dataAfterCreate.products.find((p) => p.id === 'SP_IPHONE12_USED');
        assert.ok(createdProd, 'Product created in DB');
        assert.equal(createdProd.condition, 'like_new');
        assert.equal(
            createdProd.conditionDetail,
            'Pin 95%, máy nguyên zin chưa qua sửa chữa, viền phẩy nhẹ'
        );
        assert.deepEqual(createdProd.images, ['/uploads/ip12_front.jpg', '/uploads/ip12_back.jpg']);
        assert.equal(createdProd.videoUrl, '/uploads/ip12_review.mp4');

        // 2. Share to Kho Chung without re-uploading - automatically inherits media & condition!
        const shareResult = transact(adminUser, {
            requestId: makeReqId(),
            revision: revision(),
            type: 'shareProduct',
            payload: {
                productId: createdProd.id,
                wholesalePrice: 10200000,
                minOrderQty: 1,
                note: 'Bao test 15 ngày cho đối tác'
            }
        });

        assert.equal(shareResult.result.condition, 'like_new');
        assert.equal(
            shareResult.result.conditionDetail,
            'Pin 95%, máy nguyên zin chưa qua sửa chữa, viền phẩy nhẹ'
        );
        assert.equal(
            shareResult.result.description,
            'Tặng kèm củ sạc 20W, cáp type C, bảo hành 6 tháng.'
        );
        assert.deepEqual(shareResult.result.images, [
            '/uploads/ip12_front.jpg',
            '/uploads/ip12_back.jpg'
        ]);
        assert.equal(shareResult.result.videoUrl, '/uploads/ip12_review.mp4');

        // 3. Verify hub localCatalog() includes all 5 media/condition fields
        const hubClient = require('../hub-client');
        const catalog = hubClient.localCatalog(db.getAllData());
        const catItem = catalog.find((i) => i.code === 'IP12_99');
        assert.ok(catItem, 'Product appears in hub catalog payload');
        assert.equal(catItem.condition, 'like_new');
        assert.equal(
            catItem.conditionDetail,
            'Pin 95%, máy nguyên zin chưa qua sửa chữa, viền phẩy nhẹ'
        );
        assert.equal(catItem.description, 'Tặng kèm củ sạc 20W, cáp type C, bảo hành 6 tháng.');
        assert.deepEqual(catItem.images, ['/uploads/ip12_front.jpg', '/uploads/ip12_back.jpg']);
        assert.equal(catItem.videoUrl, '/uploads/ip12_review.mp4');
    } finally {
        cleanup();
    }
});

test('Import goods with per-IMEI media & condition, verifying product.imeiDetails, shared_product.imeiDetails, and hub catalog serialization', () => {
    const cleanup = setupTestDb();
    try {
        const initial = db.getAllData();
        const adminUser = initial.users.find((u) => u.role === 'admin');
        const makeReqId = () =>
            `req-${Date.now()}-${Math.random().toString(36).slice(2).padEnd(16, '0')}`;

        // 1. Create a clean master product SKU (no media at creation)
        const newProduct = {
            id: 'SP_IPHONE13_USED',
            code: 'IP13_USED',
            name: 'iPhone 13 128GB Cũ',
            category: 'Điện thoại cũ',
            unit: 'Chiếc',
            price: 13500000,
            costPrice: 11000000,
            stock: 0,
            status: 'active',
            hasImei: true,
            imeis: [],
            imeiDetails: {},
            branch: initial.products[0].branch
        };

        const incoming = {
            ...project(initial, adminUser),
            products: [...initial.products, newProduct]
        };

        transact(adminUser, {
            requestId: makeReqId(),
            revision: revision(),
            type: 'edit',
            payload: incoming
        });

        // 2. Import 2 units with individual IMEIs, photos, and condition ratings
        const imei1 = '354892019283741';
        const imei2 = '354892019283742';
        const supplier = initial.suppliers[0];

        const imeiDetailsPayload = {
            [imei1]: {
                images: ['/uploads/ip13_imei1_front.jpg', '/uploads/ip13_imei1_back.jpg'],
                videoUrl: '/uploads/ip13_imei1_clip.mp4',
                condition: 'like_new',
                conditionDetail: 'Pin 99%, sạc 25 lần, ngoại hình keng 99%'
            },
            [imei2]: {
                images: ['/uploads/ip13_imei2_body.jpg'],
                videoUrl: '',
                condition: 'good',
                conditionDetail: 'Pin 87%, màn phẩy dăm lông mèo, vỏ đẹp 97%'
            }
        };

        const importPayload = {
            branch: initial.products[0].branch,
            supplierCode: supplier.code,
            time: '24/10/2026 10:00',
            discount: 0,
            paid: 22000000,
            paymentMethod: 'cash',
            items: [
                {
                    code: 'IP13_USED',
                    qty: 2,
                    price: 11000000,
                    hasImei: true,
                    imeis: [imei1, imei2],
                    imeiDetails: imeiDetailsPayload
                }
            ]
        };

        const importResult = transact(adminUser, {
            requestId: makeReqId(),
            revision: revision(),
            type: 'import',
            payload: importPayload
        });

        assert.ok(importResult.result.code.startsWith('PN'), 'Import receipt created');

        // 3. Check product state in DB
        const dataAfterImport = db.getAllData();
        const importedProd = dataAfterImport.products.find((p) => p.code === 'IP13_USED');
        assert.ok(importedProd, 'Product exists');
        assert.equal(importedProd.stock, 2);
        assert.deepEqual(importedProd.imeis, [imei1, imei2]);
        assert.ok(importedProd.imeiDetails, 'Product has imeiDetails');
        assert.deepEqual(importedProd.imeiDetails[imei1].images, [
            '/uploads/ip13_imei1_front.jpg',
            '/uploads/ip13_imei1_back.jpg'
        ]);
        assert.equal(importedProd.imeiDetails[imei1].condition, 'like_new');
        assert.equal(
            importedProd.imeiDetails[imei1].conditionDetail,
            'Pin 99%, sạc 25 lần, ngoại hình keng 99%'
        );
        assert.deepEqual(importedProd.imeiDetails[imei2].images, ['/uploads/ip13_imei2_body.jpg']);
        assert.equal(importedProd.imeiDetails[imei2].condition, 'good');

        // First IMEI photos auto-promoted to product representative images
        assert.deepEqual(importedProd.images, [
            '/uploads/ip13_imei1_front.jpg',
            '/uploads/ip13_imei1_back.jpg'
        ]);
        assert.equal(importedProd.condition, 'like_new');

        // Import receipt item preserves imeiDetails
        const savedImport = dataAfterImport.imports.find(
            (i) => i.code === importResult.result.code
        );
        assert.ok(savedImport, 'Import record saved');
        assert.deepEqual(savedImport.items[0].imeiDetails, imeiDetailsPayload);

        // 4. Share to Kho Chung: inherits imeiDetails and imeis
        const shareResult = transact(adminUser, {
            requestId: makeReqId(),
            revision: revision(),
            type: 'shareProduct',
            payload: {
                productId: importedProd.id,
                wholesalePrice: 12000000,
                minOrderQty: 1,
                note: 'Kho máy cũ zin chuẩn, chọn theo từng IMEI'
            }
        });

        assert.ok(shareResult.result.id.startsWith('SKC'));
        assert.deepEqual(Object.keys(shareResult.result.imeiDetails), [imei1, imei2]);
        assert.deepEqual(shareResult.result.imeiDetails, imeiDetailsPayload);

        const dataAfterShare = db.getAllData();
        const savedShared = dataAfterShare.shared_products.find(
            (sp) => sp.sourceProductId === importedProd.id
        );
        assert.ok(savedShared, 'Shared product saved in DB');
        assert.deepEqual(savedShared.imeiDetails, imeiDetailsPayload);

        // 5. Hub localCatalog includes imeiDetails and imeis
        const hubClient = require('../hub-client');
        const catalog = hubClient.localCatalog(dataAfterShare);
        const hubItem = catalog.find((i) => i.code === 'IP13_USED');
        assert.ok(hubItem, 'Hub catalog contains the shared used product');
        assert.deepEqual(hubItem.imeis, [imei1, imei2]);
        assert.deepEqual(hubItem.imeiDetails, imeiDetailsPayload);
    } finally {
        cleanup();
    }
});
