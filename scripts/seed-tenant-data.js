'use strict';
/**
 * scripts/seed-tenant-data.js
 * Generates realistic import and sales data for kalo, techmotion, and july.
 */
const crypto = require('node:crypto');

const TENANTS = {
    kalo: {
        port: 3101,
        name: 'Kalo Sport',
        suppliers: [
            {
                id: 'NCC01',
                code: 'NCC-GARMIN',
                name: 'Garmin Việt Nam Official',
                phone: '0287771234',
                address: 'Quận 1, TP.HCM',
                debt: 0,
                totalBought: 0
            },
            {
                id: 'NCC02',
                code: 'NCC-NIKE',
                name: 'Công ty TNHH Nike Đông Nam Á',
                phone: '0243987654',
                address: 'Hai Bà Trưng, Hà Nội',
                debt: 0,
                totalBought: 0
            },
            {
                id: 'NCC03',
                code: 'NCC-ADIDAS',
                name: 'Nhà phân phối Adidas Việt Nam',
                phone: '0283822990',
                address: 'Quận 7, TP.HCM',
                debt: 0,
                totalBought: 0
            }
        ],
        customers: [
            {
                id: 'KH01',
                code: 'KH0001',
                name: 'Hoàng Long',
                phone: '0912345678',
                address: 'Cầu Giấy, Hà Nội',
                debt: 0,
                totalSpent: 0
            },
            {
                id: 'KH02',
                code: 'KH0002',
                name: 'Thu Thảo',
                phone: '0987654321',
                address: 'Đống Đa, Hà Nội',
                debt: 0,
                totalSpent: 0
            },
            {
                id: 'KH03',
                code: 'KH0003',
                name: 'Quốc Hưng',
                phone: '0905123456',
                address: 'Thanh Xuân, Hà Nội',
                debt: 0,
                totalSpent: 0
            }
        ],
        products: [
            {
                id: 'SP-GARMIN-F7',
                code: 'SP-GARMIN-F7',
                name: 'Đồng hồ Garmin Fenix 7 Pro Sapphire',
                category: 'Đồng hồ',
                costPrice: 17500000,
                price: 22000000,
                stock: 0,
                minStock: 2,
                unit: 'Chiếc',
                hasImei: true,
                imeis: []
            },
            {
                id: 'SP-GARMIN-F9',
                code: 'SP-GARMIN-F9',
                name: 'Đồng hồ Garmin Forerunner 265 Music',
                category: 'Đồng hồ',
                costPrice: 8200000,
                price: 10500000,
                stock: 0,
                minStock: 2,
                unit: 'Chiếc',
                hasImei: true,
                imeis: []
            },
            {
                id: 'SP-SHOKZ-OPEN',
                code: 'SP-SHOKZ-OPEN',
                name: 'Tai nghe truyền xương Shokz OpenRun Pro',
                category: 'Tai nghe',
                costPrice: 2900000,
                price: 3990000,
                stock: 0,
                minStock: 3,
                unit: 'Chiếc',
                hasImei: false,
                imeis: []
            },
            {
                id: 'SP-NIKE-PEGASUS',
                code: 'SP-NIKE-PEGASUS',
                name: 'Giày chạy bộ Nike Air Zoom Pegasus 40',
                category: 'Đồ thể thao & Dã ngoại',
                costPrice: 2100000,
                price: 3200000,
                stock: 0,
                minStock: 5,
                unit: 'Đôi',
                hasImei: false,
                imeis: []
            },
            {
                id: 'SP-ADIDAS-UB',
                code: 'SP-ADIDAS-UB',
                name: 'Giày chạy bộ Adidas Ultraboost Light 23',
                category: 'Đồ thể thao & Dã ngoại',
                costPrice: 2800000,
                price: 4100000,
                stock: 0,
                minStock: 5,
                unit: 'Đôi',
                hasImei: false,
                imeis: []
            },
            {
                id: 'SP-BINH-NUOC',
                code: 'SP-BINH-NUOC',
                name: 'Bình nước thể thao chạy trail Aonijie 500ml',
                category: 'Phụ kiện',
                costPrice: 120000,
                price: 220000,
                stock: 0,
                minStock: 10,
                unit: 'Bình',
                hasImei: false,
                imeis: []
            }
        ],
        imports: [
            {
                supplierCode: 'NCC-GARMIN',
                paid: 100000000,
                paymentMethod: 'transfer',
                items: [
                    { code: 'SP-GARMIN-F7', qty: 3, price: 17500000, hasImei: true },
                    { code: 'SP-GARMIN-F9', qty: 6, price: 8200000, hasImei: true }
                ]
            },
            {
                supplierCode: 'NCC-NIKE',
                paid: 50000000,
                paymentMethod: 'transfer',
                items: [
                    { code: 'SP-NIKE-PEGASUS', qty: 15, price: 2100000, hasImei: false },
                    { code: 'SP-SHOKZ-OPEN', qty: 10, price: 2900000, hasImei: false },
                    { code: 'SP-BINH-NUOC', qty: 30, price: 120000, hasImei: false }
                ]
            },
            {
                supplierCode: 'NCC-ADIDAS',
                paid: 30000000,
                paymentMethod: 'cash',
                items: [{ code: 'SP-ADIDAS-UB', qty: 12, price: 2800000, hasImei: false }]
            }
        ],
        sales: [
            {
                customerId: 'KH01',
                customerPhone: '0912345678',
                given: 22000000,
                paymentMethod: 'transfer',
                discount: 0,
                items: [{ code: 'SP-GARMIN-F7', qty: 1, price: 22000000 }]
            },
            {
                customerId: 'KH02',
                customerPhone: '0987654321',
                given: 10500000,
                paymentMethod: 'transfer',
                discount: 0,
                items: [{ code: 'SP-GARMIN-F9', qty: 1, price: 10500000 }]
            },
            {
                customerId: 'KH03',
                customerPhone: '0905123456',
                given: 7530000,
                paymentMethod: 'card',
                discount: 100000,
                items: [
                    { code: 'SP-NIKE-PEGASUS', qty: 1, price: 3200000 },
                    { code: 'SP-SHOKZ-OPEN', qty: 1, price: 3990000 },
                    { code: 'SP-BINH-NUOC', qty: 2, price: 220000 }
                ]
            },
            {
                customerPhone: 'Tại quầy',
                given: 4100000,
                paymentMethod: 'cash',
                discount: 0,
                items: [{ code: 'SP-ADIDAS-UB', qty: 1, price: 4100000 }]
            }
        ]
    },
    techmotion: {
        port: 3102,
        name: 'TechMotion',
        suppliers: [
            {
                id: 'NCC01',
                code: 'NCC-SYNNEX-FPT',
                name: 'Synnex FPT Distribution',
                phone: '02473006666',
                address: 'Ba Đình, Hà Nội',
                debt: 0,
                totalBought: 0
            },
            {
                id: 'NCC02',
                code: 'NCC-SAMSUNG-VN',
                name: 'Samsung Electronics VN',
                phone: '02838275555',
                address: 'Quận 1, TP.HCM',
                debt: 0,
                totalBought: 0
            },
            {
                id: 'NCC03',
                code: 'NCC-ANKER-VN',
                name: 'Anker Innovations Vietnam',
                phone: '02839118899',
                address: 'Quận 3, TP.HCM',
                debt: 0,
                totalBought: 0
            }
        ],
        customers: [
            {
                id: 'KH01',
                code: 'KH0001',
                name: 'Nguyễn Văn An',
                phone: '0933221100',
                address: 'Quận 3, TP.HCM',
                debt: 0,
                totalSpent: 0
            },
            {
                id: 'KH02',
                code: 'KH0002',
                name: 'Trần Minh Đức',
                phone: '0977889900',
                address: 'Bình Thạnh, TP.HCM',
                debt: 0,
                totalSpent: 0
            },
            {
                id: 'KH03',
                code: 'KH0003',
                name: 'Công ty CP NexTech Solutions',
                phone: '0918000999',
                address: 'Quận 1, TP.HCM',
                debt: 0,
                totalSpent: 0
            }
        ],
        products: [
            {
                id: 'SP-IP15PM-256',
                code: 'SP-IP15PM-256',
                name: 'iPhone 15 Pro Max 256GB Titan Tự Nhiên',
                category: 'Điện thoại & Công nghệ',
                costPrice: 26500000,
                price: 29990000,
                stock: 0,
                minStock: 3,
                unit: 'Máy',
                hasImei: true,
                imeis: []
            },
            {
                id: 'SP-S24U-512',
                code: 'SP-S24U-512',
                name: 'Samsung Galaxy S24 Ultra 512GB Xám Titan',
                category: 'Điện thoại & Công nghệ',
                costPrice: 24000000,
                price: 28490000,
                stock: 0,
                minStock: 2,
                unit: 'Máy',
                hasImei: true,
                imeis: []
            },
            {
                id: 'SP-MAC-M3',
                code: 'SP-MAC-M3',
                name: 'MacBook Pro 14 M3 Pro 18GB/512GB Space Black',
                category: 'Điện thoại & Công nghệ',
                costPrice: 42000000,
                price: 48900000,
                stock: 0,
                minStock: 2,
                unit: 'Máy',
                hasImei: true,
                imeis: []
            },
            {
                id: 'SP-SAC-ANKER',
                code: 'SP-SAC-ANKER',
                name: 'Củ sạc nhanh Anker GaNPrime 67W 3 cổng',
                category: 'Phụ kiện',
                costPrice: 650000,
                price: 950000,
                stock: 0,
                minStock: 10,
                unit: 'Củ',
                hasImei: false,
                imeis: []
            },
            {
                id: 'SP-CAP-C2C',
                code: 'SP-CAP-C2C',
                name: 'Cáp sạc Type-C to Type-C Anker 1.8m bọc dù',
                category: 'Phụ kiện',
                costPrice: 180000,
                price: 320000,
                stock: 0,
                minStock: 20,
                unit: 'Sợi',
                hasImei: false,
                imeis: []
            }
        ],
        imports: [
            {
                supplierCode: 'NCC-SYNNEX-FPT',
                paid: 150000000,
                paymentMethod: 'transfer',
                items: [
                    { code: 'SP-IP15PM-256', qty: 5, price: 26500000, hasImei: true },
                    { code: 'SP-MAC-M3', qty: 3, price: 42000000, hasImei: true }
                ]
            },
            {
                supplierCode: 'NCC-SAMSUNG-VN',
                paid: 80000000,
                paymentMethod: 'transfer',
                items: [{ code: 'SP-S24U-512', qty: 4, price: 24000000, hasImei: true }]
            },
            {
                supplierCode: 'NCC-ANKER-VN',
                paid: 20000000,
                paymentMethod: 'transfer',
                items: [
                    { code: 'SP-SAC-ANKER', qty: 30, price: 650000, hasImei: false },
                    { code: 'SP-CAP-C2C', qty: 50, price: 180000, hasImei: false }
                ]
            }
        ],
        sales: [
            {
                customerId: 'KH02',
                customerPhone: '0977889900',
                given: 29990000,
                paymentMethod: 'transfer',
                discount: 0,
                items: [{ code: 'SP-IP15PM-256', qty: 1, price: 29990000 }]
            },
            {
                customerId: 'KH03',
                customerPhone: '0918000999',
                given: 49850000,
                paymentMethod: 'transfer',
                discount: 0,
                items: [
                    { code: 'SP-MAC-M3', qty: 1, price: 48900000 },
                    { code: 'SP-SAC-ANKER', qty: 1, price: 950000 }
                ]
            },
            {
                customerId: 'KH01',
                customerPhone: '0933221100',
                given: 28490000,
                paymentMethod: 'cash',
                discount: 0,
                items: [{ code: 'SP-S24U-512', qty: 1, price: 28490000 }]
            },
            {
                customerPhone: 'Tại quầy',
                given: 1270000,
                paymentMethod: 'cash',
                discount: 0,
                items: [
                    { code: 'SP-SAC-ANKER', qty: 1, price: 950000 },
                    { code: 'SP-CAP-C2C', qty: 1, price: 320000 }
                ]
            }
        ]
    },
    july: {
        port: 3103,
        name: 'July Fashion',
        suppliers: [
            {
                id: 'NCC01',
                code: 'NCC-MAY-VIET',
                name: 'Xưởng May Xuất Khẩu Việt Hưng',
                phone: '0243555888',
                address: 'Hoàng Mai, Hà Nội',
                debt: 0,
                totalBought: 0
            },
            {
                id: 'NCC02',
                code: 'NCC-LUA-BAOLOC',
                name: 'Công ty Cổ Phần Tơ Lụa Bảo Lộc Silk',
                phone: '0263386868',
                address: 'Bảo Lộc, Lâm Đồng',
                debt: 0,
                totalBought: 0
            },
            {
                id: 'NCC03',
                code: 'NCC-PHUKIEN-PARIS',
                name: 'Công ty Thời Trang & Phụ Kiện Châu Âu',
                phone: '0283999111',
                address: 'Quận 1, TP.HCM',
                debt: 0,
                totalBought: 0
            }
        ],
        customers: [
            {
                id: 'KH01',
                code: 'KH0001',
                name: 'Mai Lan',
                phone: '0944556677',
                address: 'Tây Hồ, Hà Nội',
                debt: 0,
                totalSpent: 0
            },
            {
                id: 'KH02',
                code: 'KH0002',
                name: 'Hồng Nhung',
                phone: '0911223344',
                address: 'Cầu Giấy, Hà Nội',
                debt: 0,
                totalSpent: 0
            },
            {
                id: 'KH03',
                code: 'KH0003',
                name: 'Đăng Khoa',
                phone: '0988776655',
                address: 'Ba Đình, Hà Nội',
                debt: 0,
                totalSpent: 0
            }
        ],
        products: [
            {
                id: 'SP-VAY-LUA-BE',
                code: 'SP-VAY-LUA-BE',
                name: 'Đầm lụa tơ tằm cổ yếm dáng dài be kem',
                category: 'Thời trang & Phụ kiện',
                costPrice: 580000,
                price: 1250000,
                stock: 0,
                minStock: 5,
                unit: 'Chiếc',
                hasImei: false,
                imeis: []
            },
            {
                id: 'SP-BLAZER-DEN',
                code: 'SP-BLAZER-DEN',
                name: 'Áo khoác Blazer dạ dáng suông đen Hàn Quốc',
                category: 'Thời trang & Phụ kiện',
                costPrice: 450000,
                price: 890000,
                stock: 0,
                minStock: 5,
                unit: 'Chiếc',
                hasImei: false,
                imeis: []
            },
            {
                id: 'SP-SO-MI-LUA',
                code: 'SP-SO-MI-LUA',
                name: 'Áo sơ mi lụa vân Pháp tay bồng trắng',
                category: 'Thời trang & Phụ kiện',
                costPrice: 280000,
                price: 590000,
                stock: 0,
                minStock: 10,
                unit: 'Chiếc',
                hasImei: false,
                imeis: []
            },
            {
                id: 'SP-QUAN-ONG-RONG',
                code: 'SP-QUAN-ONG-RONG',
                name: 'Quần tây ống rộng cạp cao tôn dáng đen',
                category: 'Thời trang & Phụ kiện',
                costPrice: 240000,
                price: 480000,
                stock: 0,
                minStock: 10,
                unit: 'Chiếc',
                hasImei: false,
                imeis: []
            },
            {
                id: 'SP-TUI-XACH',
                code: 'SP-TUI-XACH',
                name: 'Túi xách da mini phối khóa mạ vàng vintage',
                category: 'Thời trang & Phụ kiện',
                costPrice: 390000,
                price: 750000,
                stock: 0,
                minStock: 5,
                unit: 'Chiếc',
                hasImei: false,
                imeis: []
            },
            {
                id: 'SP-THAT-LUNG',
                code: 'SP-THAT-LUNG',
                name: 'Thắt lưng da bò cao cấp bản nhỏ',
                category: 'Thời trang & Phụ kiện',
                costPrice: 95000,
                price: 220000,
                stock: 0,
                minStock: 15,
                unit: 'Chiếc',
                hasImei: false,
                imeis: []
            }
        ],
        imports: [
            {
                supplierCode: 'NCC-LUA-BAOLOC',
                paid: 25000000,
                paymentMethod: 'transfer',
                items: [
                    { code: 'SP-VAY-LUA-BE', qty: 30, price: 580000, hasImei: false },
                    { code: 'SP-SO-MI-LUA', qty: 40, price: 280000, hasImei: false }
                ]
            },
            {
                supplierCode: 'NCC-MAY-VIET',
                paid: 20000000,
                paymentMethod: 'transfer',
                items: [
                    { code: 'SP-BLAZER-DEN', qty: 35, price: 450000, hasImei: false },
                    { code: 'SP-QUAN-ONG-RONG', qty: 50, price: 240000, hasImei: false }
                ]
            },
            {
                supplierCode: 'NCC-PHUKIEN-PARIS',
                paid: 10000000,
                paymentMethod: 'cash',
                items: [
                    { code: 'SP-TUI-XACH', qty: 20, price: 390000, hasImei: false },
                    { code: 'SP-THAT-LUNG', qty: 30, price: 95000, hasImei: false }
                ]
            }
        ],
        sales: [
            {
                customerId: 'KH01',
                customerPhone: '0944556677',
                given: 2000000,
                paymentMethod: 'transfer',
                discount: 0,
                items: [
                    { code: 'SP-VAY-LUA-BE', qty: 1, price: 1250000 },
                    { code: 'SP-TUI-XACH', qty: 1, price: 750000 }
                ]
            },
            {
                customerId: 'KH02',
                customerPhone: '0911223344',
                given: 1480000,
                paymentMethod: 'transfer',
                discount: 0,
                items: [
                    { code: 'SP-BLAZER-DEN', qty: 1, price: 890000 },
                    { code: 'SP-SO-MI-LUA', qty: 1, price: 590000 }
                ]
            },
            {
                customerId: 'KH03',
                customerPhone: '0988776655',
                given: 1250000,
                paymentMethod: 'cash',
                discount: 0,
                items: [{ code: 'SP-VAY-LUA-BE', qty: 1, price: 1250000 }]
            },
            {
                customerPhone: 'Tại quầy',
                given: 700000,
                paymentMethod: 'cash',
                discount: 0,
                items: [
                    { code: 'SP-QUAN-ONG-RONG', qty: 1, price: 480000 },
                    { code: 'SP-THAT-LUNG', qty: 1, price: 220000 }
                ]
            }
        ]
    }
};

async function postJson(url, data, cookie = '', csrf = '') {
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(cookie ? { Cookie: cookie } : {}),
            ...(csrf ? { 'X-NKiot-CSRF': csrf } : {})
        },
        body: JSON.stringify(data)
    });
    const setCookie = res.headers.get('set-cookie');
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json, cookie: setCookie || cookie };
}

async function getJson(url, cookie = '') {
    const res = await fetch(url, {
        headers: {
            'Content-Type': 'application/json',
            ...(cookie ? { Cookie: cookie } : {})
        }
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
}

async function seedTenant(id, cfg) {
    const baseUrl = `http://127.0.0.1:${cfg.port}`;
    console.log(`\n========================================`);
    console.log(`Bắt đầu tạo dữ liệu mẫu cho: ${cfg.name} (${id}) trên port ${cfg.port}...`);

    // 1. Login
    const loginRes = await postJson(`${baseUrl}/api/login`, {
        username: 'admin',
        password: 'admin1234'
    });
    if (!loginRes.ok || !loginRes.json.success) {
        throw new Error(`Đăng nhập thất bại vào ${id}: ${JSON.stringify(loginRes.json)}`);
    }
    const cookie = loginRes.cookie.split(';')[0];
    let csrf = loginRes.json.csrfToken;
    let revision = loginRes.json.revision || 0;
    const branchName = loginRes.json.user.branch || 'Chi nhánh chính';

    console.log(`✓ Đăng nhập thành công! CSRF: ${csrf.slice(0, 8)}... (Revision: ${revision})`);

    // 2. Fetch fresh data
    const dataRes = await getJson(`${baseUrl}/api/data`, cookie);
    const storeData = dataRes.json.data;
    revision = dataRes.json.revision;

    // 3. Update Catalog: Categories, Suppliers, Customers, Products via command 'edit'
    console.log(`-> Nạp danh mục, nhà cung cấp, khách hàng và danh mục hàng hóa...`);
    const catalogPayload = {
        ...storeData,
        suppliers: cfg.suppliers,
        customers: cfg.customers,
        products: cfg.products.map((p) => {
            const existing = (storeData.products || []).find((ep) => ep.code === p.code);
            return {
                ...p,
                stock: existing ? existing.stock : 0,
                costPrice: existing ? existing.costPrice : p.costPrice,
                imeis: existing && Array.isArray(existing.imeis) ? existing.imeis : [],
                branch: branchName,
                status: 'active'
            };
        })
    };

    const editRes = await postJson(
        `${baseUrl}/api/command`,
        {
            type: 'edit',
            payload: catalogPayload,
            revision,
            requestId: crypto.randomUUID()
        },
        cookie,
        csrf
    );

    if (!editRes.ok || editRes.json.error) {
        throw new Error(
            `Lỗi cập nhật danh mục cho ${id}: ${editRes.json.error || JSON.stringify(editRes.json)}`
        );
    }
    revision = editRes.json.revision;
    if (editRes.json.csrfToken) csrf = editRes.json.csrfToken;
    console.log(
        `✓ Đã nạp ${cfg.products.length} sản phẩm, ${cfg.suppliers.length} nhà cung cấp, ${cfg.customers.length} khách hàng!`
    );

    // 4. Execute Imports
    console.log(`-> Đang tiến hành tạo ${cfg.imports.length} đơn nhập hàng thực tế...`);
    for (let i = 0; i < cfg.imports.length; i++) {
        const imp = cfg.imports[i];
        const importItems = imp.items.map((item) => {
            if (item.hasImei) {
                const uniqueImeis = Array.from(
                    { length: item.qty },
                    (_, idx) =>
                        `${item.code.replace('SP-', '').slice(0, 6)}-${Date.now().toString().slice(-5)}${Math.floor(Math.random() * 900 + 100)}-${idx + 1}`
                );
                return { ...item, imeis: uniqueImeis };
            }
            return item;
        });

        const impRes = await postJson(
            `${baseUrl}/api/command`,
            {
                type: 'import',
                payload: {
                    branch: branchName,
                    supplierCode: imp.supplierCode,
                    items: importItems,
                    paid: imp.paid,
                    paymentMethod: imp.paymentMethod
                },
                revision,
                requestId: crypto.randomUUID()
            },
            cookie,
            csrf
        );

        if (!impRes.ok || impRes.json.error) {
            throw new Error(`Lỗi tạo đơn nhập hàng #${i + 1} cho ${id}: ${impRes.json.error}`);
        }
        revision = impRes.json.revision;
        if (impRes.json.csrfToken) csrf = impRes.json.csrfToken;
        const result = impRes.json.result;
        console.log(
            `   + [Nhập hàng] ${result.code}: Nhập từ ${result.nccName} | Tổng tiền: ${(result.needPay || 0).toLocaleString()}đ (Đã trả: ${(result.paid || 0).toLocaleString()}đ)`
        );
    }

    // 5. Fetch fresh stock to select available IMEIs for sale
    const freshDataRes = await getJson(`${baseUrl}/api/data`, cookie);
    const updatedProducts = freshDataRes.json.data.products;
    revision = freshDataRes.json.revision;

    // 6. Execute Sales
    console.log(`-> Đang tiến hành tạo ${cfg.sales.length} đơn bán hàng / hóa đơn POS...`);
    for (let i = 0; i < cfg.sales.length; i++) {
        const s = cfg.sales[i];
        const saleItems = s.items.map((item) => {
            const prod = updatedProducts.find((p) => p.code === item.code);
            if (
                prod &&
                prod.hasImei &&
                Array.isArray(prod.imeis) &&
                prod.imeis.length >= item.qty
            ) {
                const selectedImeis = prod.imeis.splice(0, item.qty);
                return { ...item, imeis: selectedImeis };
            }
            return item;
        });

        const saleRes = await postJson(
            `${baseUrl}/api/command`,
            {
                type: 'sale',
                payload: {
                    branch: branchName,
                    customerId: s.customerId || undefined,
                    phone: s.customerPhone,
                    items: saleItems,
                    discount: s.discount || 0,
                    given: s.given,
                    paymentMethod: s.paymentMethod
                },
                revision,
                requestId: crypto.randomUUID()
            },
            cookie,
            csrf
        );

        if (!saleRes.ok || saleRes.json.error) {
            throw new Error(`Lỗi tạo hóa đơn #${i + 1} cho ${id}: ${saleRes.json.error}`);
        }
        revision = saleRes.json.revision;
        if (saleRes.json.csrfToken) csrf = saleRes.json.csrfToken;
        const inv = saleRes.json.result;
        console.log(
            `   + [Bán hàng] ${inv.code}: Khách ${inv.customer || inv.phone} | Tổng đơn: ${(inv.total || 0).toLocaleString()}đ (${inv.paymentMethod})`
        );
    }

    console.log(`✓ Hoàn tất tạo dữ liệu test cho ${cfg.name}!`);
}

async function main() {
    console.log('--- KHỞI CHẠY TẠO DỮ LIỆU TEST NHẬP HÀNG & BÁN HÀNG ---');
    for (const [id, cfg] of Object.entries(TENANTS)) {
        await seedTenant(id, cfg);
    }
    console.log('\n========================================');
    console.log('TẤT CẢ 3 CỬA HÀNG ĐÃ ĐƯỢC TẠO DỮ LIỆU THÀNH CÔNG!');
}

main().catch((err) => {
    console.error('\nLỖI TẠO DỮ LIỆU:', err);
    process.exit(1);
});
