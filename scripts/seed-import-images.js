'use strict';
/**
 * scripts/seed-import-images.js
 * Tạo các phiếu nhập hàng test có hình ảnh sản phẩm thực tế ở các cửa hàng.
 */
const crypto = require('node:crypto');

const TENANT_STORES = [
    {
        id: 'techmotion',
        name: 'TechMotion',
        port: 3102,
        imports: [
            {
                supplierCode: 'NCC-SYNNEX-FPT',
                note: 'Phiếu nhập lô hàng Apple chính hãng - Kèm ảnh sản phẩm & IMEI',
                paid: 163500000,
                paymentMethod: 'transfer',
                items: [
                    {
                        code: 'SP-IP15PM-256',
                        qty: 3,
                        price: 26500000,
                        hasImei: true,
                        prefix: 'IP15PM',
                        images: ['/uploads/img_iphone15pm.jpg'],
                        condition: 'new',
                        conditionDetail: 'Hàng chính hãng VNA nguyên seal hộp'
                    },
                    {
                        code: 'SP-MAC-M3',
                        qty: 2,
                        price: 42000000,
                        hasImei: true,
                        prefix: 'MBP14',
                        images: ['/uploads/img_macbook_m3.jpg'],
                        condition: 'new',
                        conditionDetail: 'MacBook Pro 14 M3 Pro nguyên seal'
                    }
                ]
            },
            {
                supplierCode: 'NCC-SAMSUNG-VN',
                note: 'Phiếu nhập lô Galaxy S24 Ultra titan - Đính kèm ảnh máy',
                paid: 50000000,
                paymentMethod: 'transfer',
                items: [
                    {
                        code: 'SP-S24U-512',
                        qty: 4,
                        price: 24000000,
                        hasImei: true,
                        prefix: 'S24U',
                        images: ['/uploads/img_s24ultra.jpg'],
                        condition: 'new',
                        conditionDetail: 'Bản 512GB chính hãng Samsung VN'
                    }
                ]
            },
            {
                supplierCode: 'NCC-ANKER-VN',
                note: 'Phiếu nhập phụ kiện Anker GaN và cáp dù - Có ảnh thực tế',
                paid: 18400000,
                paymentMethod: 'cash',
                items: [
                    {
                        code: 'SP-SAC-ANKER',
                        qty: 20,
                        price: 650000,
                        hasImei: false,
                        images: ['/uploads/img_anker_charger.jpg'],
                        condition: 'new',
                        conditionDetail: 'Hộp nguyên seal tem bảo hành 18 tháng'
                    },
                    {
                        code: 'SP-CAP-C2C',
                        qty: 30,
                        price: 180000,
                        hasImei: false,
                        images: ['/uploads/img_anker_cable.jpg'],
                        condition: 'new',
                        conditionDetail: 'Dây bọc dù cao cấp chống rối chống đứt'
                    }
                ]
            }
        ]
    },
    {
        id: 'kalo',
        name: 'Kalo Sport',
        port: 3101,
        imports: [
            {
                supplierCode: 'NCC-GARMIN',
                note: 'Phiếu nhập lô đồng hồ thể thao Garmin chính hãng - Đầy đủ ảnh & IMEI',
                paid: 59600000,
                paymentMethod: 'transfer',
                items: [
                    {
                        code: 'SP-GARMIN-F7',
                        qty: 2,
                        price: 17500000,
                        hasImei: true,
                        prefix: 'GF7',
                        images: ['/uploads/img_garmin_fenix7.jpg'],
                        condition: 'new',
                        conditionDetail: 'Garmin Fenix 7 Pro Sapphire viền Titanium'
                    },
                    {
                        code: 'SP-GARMIN-F9',
                        qty: 3,
                        price: 8200000,
                        hasImei: true,
                        prefix: 'GFR265',
                        images: ['/uploads/img_garmin_fr265.jpg'],
                        condition: 'new',
                        conditionDetail: 'Garmin Forerunner 265 Music AMOLED'
                    }
                ]
            },
            {
                supplierCode: 'NCC-NIKE',
                note: 'Phiếu nhập giày chạy bộ Nike Pegasus và bình nước trail - Có ảnh',
                paid: 20000000,
                paymentMethod: 'transfer',
                items: [
                    {
                        code: 'SP-NIKE-PEGASUS',
                        qty: 15,
                        price: 2100000,
                        hasImei: false,
                        images: ['/uploads/img_nike_pegasus.jpg'],
                        condition: 'new',
                        conditionDetail: 'Nike Pegasus 40 full box size 40-43'
                    },
                    {
                        code: 'SP-BINH-NUOC',
                        qty: 25,
                        price: 120000,
                        hasImei: false,
                        images: ['/uploads/img_aonijie_bottle.jpg'],
                        condition: 'new',
                        conditionDetail: 'Bình nước mềm TPU chạy trail 500ml'
                    }
                ]
            },
            {
                supplierCode: 'NCC-ADIDAS',
                note: 'Phiếu nhập giày Ultraboost & tai nghe Shokz thể thao - Có ảnh',
                paid: 51200000,
                paymentMethod: 'cash',
                items: [
                    {
                        code: 'SP-ADIDAS-UB',
                        qty: 10,
                        price: 2800000,
                        hasImei: false,
                        images: ['/uploads/img_adidas_ultraboost.jpg'],
                        condition: 'new',
                        conditionDetail: 'Adidas Ultraboost Light 23 đệm Boost'
                    },
                    {
                        code: 'SP-SHOKZ-OPEN',
                        qty: 8,
                        price: 2900000,
                        hasImei: false,
                        images: ['/uploads/img_shokz_openrun.jpg'],
                        condition: 'new',
                        conditionDetail: 'Tai nghe truyền xương Shokz OpenRun Pro chống nước IP55'
                    }
                ]
            }
        ]
    },
    {
        id: 'july',
        name: 'July Fashion',
        port: 3103,
        imports: [
            {
                supplierCode: 'NCC-MAY-VIET',
                note: 'Phiếu nhập đợt 1 Áo Blazer dạ và Sơ mi lụa - Kèm hình ảnh chụp mẫu',
                paid: 17400000,
                paymentMethod: 'transfer',
                items: [
                    {
                        code: 'SP-BLAZER-DEN',
                        qty: 20,
                        price: 450000,
                        hasImei: false,
                        images: ['/uploads/img_blazer.jpg'],
                        condition: 'new',
                        conditionDetail: 'Blazer dạ dáng suông 2 lớp form Hàn Quốc'
                    },
                    {
                        code: 'SP-SO-MI-LUA',
                        qty: 30,
                        price: 280000,
                        hasImei: false,
                        images: ['/uploads/img_so_mi.jpg'],
                        condition: 'new',
                        conditionDetail: 'Sơ mi lụa vân Pháp tay bồng trắng kem'
                    }
                ]
            },
            {
                supplierCode: 'NCC-LUA-BAOLOC',
                note: 'Phiếu nhập Đầm lụa tơ tằm Bảo Lộc & Quần ống rộng - Có hình ảnh đính kèm',
                paid: 10000000,
                paymentMethod: 'transfer',
                items: [
                    {
                        code: 'SP-VAY-LUA-BE',
                        qty: 15,
                        price: 580000,
                        hasImei: false,
                        images: ['/uploads/img_vay_lua.jpg'],
                        condition: 'new',
                        conditionDetail: 'Đầm lụa tơ tằm cổ yếm dáng dài be kem Bảo Lộc'
                    },
                    {
                        code: 'SP-QUAN-ONG-RONG',
                        qty: 25,
                        price: 240000,
                        hasImei: false,
                        images: ['/uploads/img_quan_tay.jpg'],
                        condition: 'new',
                        conditionDetail: 'Quần tây ống rộng cạp cao vải tuyết mưa đứng dáng'
                    }
                ]
            },
            {
                supplierCode: 'NCC-PHUKIEN-PARIS',
                note: 'Phiếu nhập Túi xách da mini & Thắt lưng da bò - Kèm hình ảnh phụ kiện',
                paid: 6580000,
                paymentMethod: 'cash',
                items: [
                    {
                        code: 'SP-TUI-XACH',
                        qty: 12,
                        price: 390000,
                        hasImei: false,
                        images: ['/uploads/img_tui_xach.jpg'],
                        condition: 'new',
                        conditionDetail: 'Túi xách da mini khóa mạ vàng vintage cao cấp'
                    },
                    {
                        code: 'SP-THAT-LUNG',
                        qty: 20,
                        price: 95000,
                        hasImei: false,
                        images: ['/uploads/img_that_lung.jpg'],
                        condition: 'new',
                        conditionDetail: 'Thắt lưng da bò 100% bản nhỏ thời trang'
                    }
                ]
            }
        ]
    }
];

async function seedTenantImports(store) {
    const baseUrl = 'http://127.0.0.1:' + store.port;
    console.log('\n========================================');
    console.log(
        '>>> Đang tạo phiếu nhập hàng có ảnh cho: ' + store.name + ' (Port ' + store.port + ')...'
    );

    const loginRes = await fetch(baseUrl + '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: process.env.NKIOT_SEED_PASSWORD })
    });
    if (!loginRes.ok) throw new Error('Đăng nhập thất bại: ' + loginRes.status);
    const cookie = loginRes.headers.get('set-cookie');
    const loginData = await loginRes.json();
    let csrf = loginData.csrfToken;
    let revision = loginData.revision || 0;
    const branchName = loginData.user.branch || 'Chi nhánh chính';

    const dataRes = await fetch(baseUrl + '/api/data', { headers: { Cookie: cookie } });
    const dataJson = await dataRes.json();
    const storeData = dataJson.data;
    revision = dataJson.revision || revision;

    for (let i = 0; i < store.imports.length; i++) {
        const imp = store.imports[i];
        const marker = `[TEST-IMAGES-v1:${store.id}:${i}]`;
        if (storeData.imports.some((row) => row.note?.includes(marker))) continue;
        const stamp = Date.now().toString().slice(-4) + (i + 1);

        const itemsPayload = imp.items.map((item) => {
            const hasImei = Boolean(item.hasImei);
            const imeis = hasImei
                ? Array.from(
                      { length: item.qty },
                      (_, idx) => item.prefix + '-' + stamp + '-' + (idx + 1)
                  )
                : [];
            const imeiDetails = {};
            if (hasImei) {
                imeis.forEach((im) => {
                    imeiDetails[im] = {
                        images: item.images,
                        condition: item.condition || 'new',
                        conditionDetail: item.conditionDetail || ''
                    };
                });
            }
            return {
                code: item.code,
                name:
                    (storeData.products.find((p) => p.code === item.code) || {}).name || item.code,
                qty: item.qty,
                price: item.price,
                hasImei,
                imeis,
                imeiDetails,
                images: item.images,
                condition: item.condition || 'new',
                conditionDetail: item.conditionDetail || ''
            };
        });

        const commandPayload = {
            type: 'import',
            payload: {
                branch: branchName,
                supplierCode: imp.supplierCode,
                items: itemsPayload,
                paid: imp.paid,
                paymentMethod: imp.paymentMethod,
                note: `${marker} Ảnh minh họa, không phải ảnh xác nhận đúng model. ${imp.note}`
            },
            revision,
            requestId: crypto.createHash('sha256').update(marker).digest('hex')
        };

        const res = await fetch(baseUrl + '/api/command', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                'X-NKiot-CSRF': csrf
            },
            body: JSON.stringify(commandPayload)
        });

        const json = await res.json();
        if (!res.ok || !json.success) {
            throw new Error(json.error || 'Không lưu được phiếu test.');
        }

        revision = json.revision;
        if (json.csrfToken) csrf = json.csrfToken;
        const receipt = json.result;
        console.log(
            '  ✓ [' +
                receipt.code +
                '] ' +
                receipt.nccName +
                ' | Tổng: ' +
                receipt.needPay.toLocaleString('vi-VN') +
                ' đ (Đã trả: ' +
                receipt.paid.toLocaleString('vi-VN') +
                ' đ) | ' +
                receipt.items.length +
                ' mặt hàng có ảnh'
        );
    }
}

async function main() {
    const apply = process.argv.includes('--apply-test-data');
    const selected = process.argv.find((arg) => arg.startsWith('--tenant='))?.slice(9);
    const stores = TENANT_STORES.filter((store) => !selected || store.id === selected);
    if (!stores.length) throw new Error('Tenant không hợp lệ.');
    if (!apply) {
        console.log(
            'DRY RUN: không ghi dữ liệu. Dùng --apply-test-data --tenant=<id> và NKIOT_SEED_PASSWORD trên môi trường test.'
        );
        console.log(stores.map((store) => ({ tenant: store.id, receipts: store.imports.length })));
        return;
    }
    if (process.env.NKIOT_SEED_ENV !== 'test' || !process.env.NKIOT_SEED_PASSWORD)
        throw new Error(
            'Yêu cầu NKIOT_SEED_ENV=test và NKIOT_SEED_PASSWORD. Không chạy trên production.'
        );
    for (const store of stores) await seedTenantImports(store);
}
if (require.main === module)
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
module.exports = { TENANT_STORES };
