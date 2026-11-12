// Legacy example data for tests; only settings, branches and categories seed a new database.

const defaultData = {
    settings: {
        storeName: 'Kalo HCM - Thiết Bị Thể Thao Cao Cấp',
        branch: 'Kalo HCM',
        phone: '0981886057',
        hotline: '1900 6522',
        address: '103 Võ Văn Tần, P.6, Quận 3, TP.HCM',
        bankCode: 'VCB',
        bankName: 'Vietcombank',
        bankAccount: '1028889999',
        bankOwner: 'TRAN VAN NHAT',
        cashier: 'Trần Văn Nhất',
        logoUrl: '',
        logoText: 'NKiot',
        billConfig: ''
    },
    products: [
        {
            id: 'SP001',
            code: 'SP001',
            name: 'Đồng hồ thông minh Garmin MarQ II, Golfer, GPS Watch, SEA',
            category: 'Đồng hồ Garmin',
            costPrice: 4500000,
            price: 6000000,
            stock: 12,
            minStock: 5,
            unit: 'Chiếc',
            status: 'active',
            barcode: '8935001001',
            branch: 'Kalo HCM',
            hasImei: true,
            imeis: [
                'GM26001001',
                'GM26001002',
                'GM26001003',
                'GM26001004',
                'GM26001005',
                'GM26001006',
                'GM26001007',
                'GM26001008',
                'GM26001009',
                'GM26001010',
                'GM26001011',
                'GM26001012'
            ]
        },
        {
            id: 'SP002',
            code: 'SP002',
            name: 'Tai nghe Thể thao Shokz OpenRun Pro',
            category: 'Tai nghe thể thao',
            costPrice: 2800000,
            price: 3990000,
            stock: 25,
            minStock: 8,
            unit: 'Chiếc',
            status: 'active',
            barcode: '8935001002',
            branch: 'Kalo HCM',
            hasImei: false,
            imeis: []
        },
        {
            id: 'SP003',
            code: 'SP003',
            name: 'Dây đeo Garmin QuickFit 22mm Silicone',
            category: 'Phụ kiện',
            costPrice: 750000,
            price: 1200000,
            stock: 40,
            minStock: 10,
            unit: 'Dây',
            status: 'active',
            barcode: '8935001003',
            branch: 'Kalo HCM',
            hasImei: false,
            imeis: []
        },
        {
            id: 'SP004',
            code: 'SP004',
            name: 'Đồng hồ thể thao Garmin Forerunner 965',
            category: 'Đồng hồ Garmin',
            costPrice: 12000000,
            price: 16500000,
            stock: 8,
            minStock: 3,
            unit: 'Chiếc',
            status: 'active',
            barcode: '8935001004',
            branch: 'Kalo HCM',
            hasImei: true,
            imeis: [
                'FR965001',
                'FR965002',
                'FR965003',
                'FR965004',
                'FR965005',
                'FR965006',
                'FR965007',
                'FR965008'
            ]
        },
        {
            id: 'SP005',
            code: 'SP005',
            name: 'Đồng hồ Garmin Fenix 7 Pro Sapphire Solar',
            category: 'Đồng hồ Garmin',
            costPrice: 15500000,
            price: 21490000,
            stock: 5,
            minStock: 2,
            unit: 'Chiếc',
            status: 'active',
            barcode: '8935001005',
            branch: 'Kalo HCM',
            hasImei: true,
            imeis: ['FN7P0001', 'FN7P0002', 'FN7P0003', 'FN7P0004', 'FN7P0005']
        },
        {
            id: 'SP006',
            code: 'SP006',
            name: 'Tai nghe truyền xương Shokz OpenMove',
            category: 'Tai nghe thể thao',
            costPrice: 1300000,
            price: 1990000,
            stock: 18,
            minStock: 5,
            unit: 'Chiếc',
            status: 'active',
            barcode: '8935001006',
            branch: 'Kalo HCM',
            hasImei: false,
            imeis: []
        },
        {
            id: 'SP007',
            code: 'SP007',
            name: 'Cáp sạc Garmin USB-C chính hãng (1m)',
            category: 'Phụ kiện',
            costPrice: 250000,
            price: 450000,
            stock: 55,
            minStock: 15,
            unit: 'Sợi',
            status: 'active',
            barcode: '8935001007',
            branch: 'Kalo HCM',
            hasImei: false,
            imeis: []
        },
        {
            id: 'SP008',
            code: 'SP008',
            name: 'Kính cường lực bảo vệ Garmin 47mm',
            category: 'Phụ kiện',
            costPrice: 40000,
            price: 120000,
            stock: 3,
            minStock: 10,
            unit: 'Miếng',
            status: 'active',
            barcode: '8935001008',
            branch: 'Kalo HCM',
            hasImei: false,
            imeis: []
        },
        {
            id: 'SP009',
            code: 'SP009',
            name: 'Đai đeo đo nhịp tim Garmin HRM-Pro Plus',
            category: 'Phụ kiện',
            costPrice: 2100000,
            price: 2990000,
            stock: 14,
            minStock: 4,
            unit: 'Bộ',
            status: 'active',
            barcode: '8935001009',
            branch: 'Kalo HCM',
            hasImei: false,
            imeis: []
        },
        // Chi nhánh Hà Nội (hàng nhận chuyển kho & hàng tạo riêng tại Hà Nội)
        {
            id: 'SP001_HN',
            code: 'SP001',
            name: 'Đồng hồ thông minh Garmin MarQ II, Golfer, GPS Watch, SEA',
            category: 'Đồng hồ Garmin',
            costPrice: 4500000,
            price: 6000000,
            stock: 3,
            minStock: 2,
            unit: 'Chiếc',
            status: 'active',
            barcode: '8935001001',
            branch: 'Chi nhánh Hà Nội',
            hasImei: true,
            imeis: ['GM26HN001', 'GM26HN002', 'GM26HN003']
        },
        {
            id: 'SP002_HN',
            code: 'SP002',
            name: 'Tai nghe Thể thao Shokz OpenRun Pro',
            category: 'Tai nghe thể thao',
            costPrice: 2800000,
            price: 3990000,
            stock: 2,
            minStock: 2,
            unit: 'Chiếc',
            status: 'active',
            barcode: '8935001002',
            branch: 'Chi nhánh Hà Nội',
            hasImei: false,
            imeis: []
        },
        {
            id: 'HN001',
            code: 'HN001',
            name: 'Đồng hồ thông minh Garmin Forerunner 265 Music',
            category: 'Đồng hồ Garmin',
            costPrice: 9000000,
            price: 11990000,
            stock: 8,
            minStock: 3,
            unit: 'Chiếc',
            status: 'active',
            barcode: '8935002001',
            branch: 'Chi nhánh Hà Nội',
            hasImei: true,
            imeis: [
                'FR265HN01',
                'FR265HN02',
                'FR265HN03',
                'FR265HN04',
                'FR265HN05',
                'FR265HN06',
                'FR265HN07',
                'FR265HN08'
            ]
        },
        {
            id: 'HN002',
            code: 'HN002',
            name: 'Tai nghe chạy bộ Shokz OpenFit True Wireless',
            category: 'Tai nghe thể thao',
            costPrice: 3500000,
            price: 4990000,
            stock: 10,
            minStock: 4,
            unit: 'Chiếc',
            status: 'active',
            barcode: '8935002002',
            branch: 'Chi nhánh Hà Nội',
            hasImei: false,
            imeis: []
        }
    ],
    customers: [
        {
            id: 'KH0001',
            code: 'KH0001',
            name: 'Anh Đạt',
            phone: '0857927778',
            address: '45 Lê Duẩn, Q.1, TP.HCM',
            totalSpent: 36000000,
            debt: 0,
            points: 360
        },
        {
            id: 'KH0002',
            code: 'KH0002',
            name: 'Chị Thuý',
            phone: '0946745931',
            address: '88 Nguyễn Thị Minh Khai, Q.3, TP.HCM',
            totalSpent: 18500000,
            debt: 0,
            points: 185
        },
        {
            id: 'KH0003',
            code: 'KH0003',
            name: 'Anh Tuấn',
            phone: '0332689205',
            address: '12 Điện Biên Phủ, Bình Thạnh',
            totalSpent: 12400000,
            debt: 2900000,
            points: 95
        },
        {
            id: 'KH0004',
            code: 'KH0004',
            name: 'Anh Vũ',
            phone: '0366761866',
            address: '105 Trần Hưng Đạo, Q.5, TP.HCM',
            totalSpent: 24000000,
            debt: 0,
            points: 240
        },
        {
            id: 'KH0005',
            code: 'KH0005',
            name: 'Anh Đức',
            phone: '0965116758',
            address: '23 Võ Văn Ngân, TP. Thủ Đức',
            totalSpent: 15000000,
            debt: 0,
            points: 150
        },
        {
            id: 'KH0006',
            code: 'KH0006',
            name: 'Anh Thịnh',
            phone: '0865525745',
            address: '19 Hoàng Hoa Thám, Tân Bình',
            totalSpent: 8080000,
            debt: 0,
            points: 80
        },
        {
            id: 'KH0007',
            code: 'KH0007',
            name: 'Phan Thị Kim Anh',
            phone: '0395653433',
            address: '44 Cao Thắng, Q.3, TP.HCM',
            totalSpent: 12000000,
            debt: 0,
            points: 120
        },
        {
            id: 'KH0008',
            code: 'KH0008',
            name: 'Chị Chíp',
            phone: '0797010897',
            address: '302 Nguyễn Trãi, Q.5, TP.HCM',
            totalSpent: 18000000,
            debt: 0,
            points: 180
        },
        {
            id: 'KH0009',
            code: 'KH0009',
            name: 'Nguyễn Lộc Thọ',
            phone: '0901066621',
            address: '77 CMT8, Q.10, TP.HCM',
            totalSpent: 5400000,
            debt: 1800000,
            points: 36
        },
        {
            id: 'KH0010',
            code: 'KH0010',
            name: 'Thẩm Hoàng Năm',
            phone: '0348350555',
            address: '92 Pasteur, Q.1, TP.HCM',
            totalSpent: 15600000,
            debt: 4900000,
            points: 107
        },
        {
            id: 'KH0011',
            code: 'KH0011',
            name: 'Khách lẻ',
            phone: '0981886000',
            address: 'Tại quầy',
            totalSpent: 85000000,
            debt: 0,
            points: 0
        },
        {
            id: 'KH0012',
            code: 'KH0012',
            name: 'Anh Tuấn Anh',
            phone: '0912345678',
            address: '18 Hàng Bài, Hoàn Kiếm, Hà Nội',
            totalSpent: 6000000,
            debt: 0,
            points: 60
        },
        {
            id: 'KH0013',
            code: 'KH0013',
            name: 'Chị Mai Linh',
            phone: '0987654321',
            address: '55 Phố Huế, Hai Bà Trưng, Hà Nội',
            totalSpent: 3990000,
            debt: 0,
            points: 40
        }
    ],
    suppliers: [
        {
            id: 'NCC000001',
            code: 'NCC000001',
            name: 'An Tiến',
            phone: '0904000111',
            address: '103 Võ Văn Tần, Q.3, TP.HCM',
            debt: 0,
            totalBought: 158000000
        },
        {
            id: 'NCC000009',
            code: 'NCC000009',
            name: 'Anh Tâm',
            phone: '0938111222',
            address: '18 Lý Thường Kiệt, Q.10, TP.HCM',
            debt: 0,
            totalBought: 45000000
        },
        {
            id: 'NCC000040',
            code: 'NCC000040',
            name: 'Thuận Nguyễn',
            phone: '0918333444',
            address: '55 An Dương Vương, Q.5, TP.HCM',
            debt: 0,
            totalBought: 12000000
        },
        {
            id: 'NCC000041',
            code: 'NCC000041',
            name: 'Hoàng Văn Niên',
            phone: '0977555666',
            address: '29 Hai Bà Trưng, Q.1, TP.HCM',
            debt: 0,
            totalBought: 28000000
        },
        {
            id: 'NCC000042',
            code: 'NCC000042',
            name: 'Nguyễn Ngọc Huy',
            phone: '0988666777',
            address: '140 Nguyễn Đình Chiểu, Q.3, TP.HCM',
            debt: 0,
            totalBought: 19500000
        }
    ],
    invoices: [
        {
            id: 'HD005696',
            code: 'HD005696',
            time: '16/10/2026 10:59',
            customer: 'Anh Đạt',
            phone: '0857927778',
            items: [
                {
                    code: 'SP001',
                    name: 'Đồng hồ thông minh Garmin MarQ II',
                    qty: 1,
                    price: 6000000,
                    total: 6000000
                }
            ],
            total: 6000000,
            paid: 6000000,
            discount: 0,
            redPaid: false,
            grayBg: false,
            status: 'completed',
            cashier: 'Trần Văn Nhất',
            branch: 'Kalo HCM'
        },
        {
            id: 'HD005681',
            code: 'HD005681',
            time: '11/10/2026 16:13',
            customer: 'Chị Thuý',
            phone: '0946745931',
            items: [
                {
                    code: 'SP002',
                    name: 'Tai nghe Thể thao Shokz OpenRun Pro',
                    qty: 1,
                    price: 3990000,
                    total: 3990000
                }
            ],
            total: 3990000,
            paid: 3990000,
            discount: 0,
            redPaid: false,
            grayBg: false,
            status: 'completed',
            cashier: 'Trần Văn Nhất',
            branch: 'Kalo HCM'
        },
        {
            id: 'HD005680',
            code: 'HD005680',
            time: '11/10/2026 16:11',
            customer: 'Anh Tuấn',
            phone: '0332689205',
            items: [
                {
                    code: 'SP003',
                    name: 'Dây đeo Garmin QuickFit 22mm',
                    qty: 1,
                    price: 1200000,
                    total: 1200000
                },
                {
                    code: 'SP006',
                    name: 'Tai nghe Shokz OpenMove',
                    qty: 1,
                    price: 2000000,
                    total: 2000000
                }
            ],
            total: 3200000,
            paid: 300000,
            discount: 0,
            redPaid: true,
            grayBg: false,
            status: 'completed',
            cashier: 'Trần Văn Nhất',
            branch: 'Kalo HCM'
        },
        {
            id: 'HD005677',
            code: 'HD005677',
            time: '10/10/2026 14:37',
            customer: 'Anh Vũ',
            phone: '0366761866',
            items: [
                {
                    code: 'SP001',
                    name: 'Đồng hồ thông minh Garmin MarQ II',
                    qty: 1,
                    price: 6500000,
                    total: 6500000
                }
            ],
            total: 6500000,
            paid: 6500000,
            discount: 0,
            redPaid: false,
            grayBg: true,
            status: 'completed',
            cashier: 'Trần Văn Nhất',
            branch: 'Kalo HCM'
        },
        {
            id: 'HD005675',
            code: 'HD005675',
            time: '10/10/2026 13:12',
            customer: 'Anh Đức',
            phone: '0965116758',
            items: [
                {
                    code: 'SP001',
                    name: 'Đồng hồ thông minh Garmin MarQ II',
                    qty: 1,
                    price: 7500000,
                    total: 7500000
                }
            ],
            total: 7500000,
            paid: 7500000,
            discount: 0,
            redPaid: false,
            grayBg: false,
            status: 'completed',
            cashier: 'Trần Văn Nhất',
            branch: 'Kalo HCM'
        },
        {
            id: 'HD005672',
            code: 'HD005672',
            time: '09/10/2026 16:14',
            customer: 'Anh Thịnh',
            phone: '0865525745',
            items: [
                {
                    code: 'SP002',
                    name: 'Tai nghe Shokz OpenRun Pro',
                    qty: 1,
                    price: 4040000,
                    total: 4040000
                }
            ],
            total: 4040000,
            paid: 4040000,
            discount: 0,
            redPaid: false,
            grayBg: false,
            status: 'completed',
            cashier: 'Trần Văn Nhất',
            branch: 'Kalo HCM'
        },
        {
            id: 'HD005671',
            code: 'HD005671',
            time: '09/10/2026 15:51',
            customer: 'Phan Thị Kim Anh',
            phone: '0395653433',
            items: [
                {
                    code: 'SP001',
                    name: 'Đồng hồ Garmin MarQ II',
                    qty: 1,
                    price: 6000000,
                    total: 6000000
                }
            ],
            total: 6000000,
            paid: 6000000,
            discount: 0,
            redPaid: false,
            grayBg: false,
            status: 'completed',
            cashier: 'Trần Văn Nhất',
            branch: 'Kalo HCM'
        },
        {
            id: 'HD005669',
            code: 'HD005669',
            time: '09/10/2026 15:27',
            customer: 'Chị Chíp',
            phone: '0797010897',
            items: [
                {
                    code: 'SP001',
                    name: 'Đồng hồ Garmin MarQ II',
                    qty: 1,
                    price: 6000000,
                    total: 6000000
                }
            ],
            total: 6000000,
            paid: 6000000,
            discount: 0,
            redPaid: false,
            grayBg: false,
            status: 'completed',
            cashier: 'Trần Văn Nhất',
            branch: 'Kalo HCM'
        },
        {
            id: 'HD005667',
            code: 'HD005667',
            time: '09/10/2026 10:04',
            customer: 'Nguyễn Lộc Thọ',
            phone: '0901066621',
            items: [
                { code: 'SP003', name: 'Dây đeo Garmin', qty: 1, price: 1800000, total: 1800000 }
            ],
            total: 1800000,
            paid: 0,
            discount: 0,
            redPaid: true,
            grayBg: false,
            status: 'completed',
            cashier: 'Trần Văn Nhất',
            branch: 'Kalo HCM'
        },
        {
            id: 'HD005661',
            code: 'HD005661',
            time: '08/10/2026 14:35',
            customer: 'Phương Nam',
            phone: '0937045730',
            items: [
                {
                    code: 'SP002',
                    name: 'Tai nghe Shokz OpenRun Pro',
                    qty: 1,
                    price: 3800000,
                    total: 3800000
                }
            ],
            total: 3800000,
            paid: 3800000,
            discount: 0,
            redPaid: false,
            grayBg: false,
            status: 'completed',
            cashier: 'Trần Văn Nhất',
            branch: 'Kalo HCM'
        },
        {
            id: 'HD005653',
            code: 'HD005653',
            time: '06/10/2026 16:03',
            customer: 'Thẩm Hoàng Năm',
            phone: '0348350555',
            items: [
                {
                    code: 'SP001',
                    name: 'Đồng hồ Garmin MarQ II',
                    qty: 1,
                    price: 5200000,
                    total: 5200000
                }
            ],
            total: 5200000,
            paid: 300000,
            discount: 0,
            redPaid: true,
            grayBg: false,
            status: 'completed',
            cashier: 'Trần Văn Nhất',
            branch: 'Kalo HCM'
        },
        {
            id: 'HD005651',
            code: 'HD005651',
            time: '06/10/2026 13:58',
            customer: 'Anh Khánh',
            phone: '0902803056',
            items: [
                {
                    code: 'SP001',
                    name: 'Đồng hồ Garmin MarQ II',
                    qty: 1,
                    price: 5700000,
                    total: 5700000
                }
            ],
            total: 5700000,
            paid: 5700000,
            discount: 0,
            redPaid: false,
            grayBg: false,
            status: 'completed',
            cashier: 'Trần Văn Nhất',
            branch: 'Kalo HCM'
        },
        {
            id: 'HD005650',
            code: 'HD005650',
            time: '06/10/2026 12:40',
            customer: 'MCMA',
            phone: '0563505635',
            items: [
                { code: 'SP007', name: 'Cáp sạc Garmin', qty: 1, price: 435000, total: 435000 }
            ],
            total: 435000,
            paid: 435000,
            discount: 0,
            redPaid: false,
            grayBg: false,
            status: 'completed',
            cashier: 'Trần Văn Nhất',
            branch: 'Kalo HCM'
        },
        {
            id: 'HD005666',
            code: 'HD005666',
            time: '05/10/2026 21:59',
            customer: 'Anh An',
            phone: '0345493999',
            items: [
                {
                    code: 'SP001',
                    name: 'Đồng hồ Garmin MarQ II',
                    qty: 1,
                    price: 6900000,
                    total: 6900000
                }
            ],
            total: 6900000,
            paid: 6900000,
            discount: 0,
            redPaid: false,
            grayBg: false,
            status: 'completed',
            cashier: 'Trần Văn Nhất',
            branch: 'Kalo HCM'
        },
        {
            id: 'HD005668',
            code: 'HD005668',
            time: '05/10/2026 13:53',
            customer: 'Phạm Nguyễn Vĩnh An',
            phone: '0907643366',
            items: [
                {
                    code: 'SP001',
                    name: 'Đồng hồ Garmin MarQ II',
                    qty: 1,
                    price: 6000000,
                    total: 6000000
                }
            ],
            total: 6000000,
            paid: 6000000,
            discount: 0,
            redPaid: false,
            grayBg: false,
            status: 'completed',
            cashier: 'Trần Văn Nhất',
            branch: 'Kalo HCM'
        },
        // Hóa đơn tạo tại Chi nhánh Hà Nội
        {
            id: 'HD005701',
            code: 'HD005701',
            time: '18/10/2026 15:30',
            customer: 'Anh Tuấn Anh',
            phone: '0912345678',
            items: [
                {
                    code: 'SP001',
                    name: 'Đồng hồ thông minh Garmin MarQ II, Golfer, GPS Watch, SEA',
                    qty: 1,
                    price: 6000000,
                    total: 6000000
                }
            ],
            total: 6000000,
            paid: 6000000,
            discount: 0,
            redPaid: false,
            grayBg: false,
            status: 'completed',
            cashier: 'Thu Ngân Hà Nội',
            branch: 'Chi nhánh Hà Nội'
        },
        {
            id: 'HD005702',
            code: 'HD005702',
            time: '19/10/2026 10:15',
            customer: 'Chị Mai Linh',
            phone: '0987654321',
            items: [
                {
                    code: 'SP002',
                    name: 'Tai nghe Thể thao Shokz OpenRun Pro',
                    qty: 1,
                    price: 3990000,
                    total: 3990000
                }
            ],
            total: 3990000,
            paid: 3990000,
            discount: 0,
            redPaid: false,
            grayBg: false,
            status: 'completed',
            cashier: 'Thu Ngân Hà Nội',
            branch: 'Chi nhánh Hà Nội'
        }
    ],
    imports: [
        {
            id: 'PN003088',
            code: 'PN003088',
            time: '11/10/2026 15:51',
            nccCode: 'NCC000042',
            nccName: 'Nguyễn Ngọc Huy',
            items: [
                { code: 'SP007', name: 'Cáp sạc Garmin', qty: 5, price: 250000, total: 1250000 },
                { code: 'SP009', name: 'Đai tim Garmin', qty: 1, price: 1385000, total: 1385000 }
            ],
            needPay: 2635000,
            paid: 2635000,
            note: '35k ship',
            status: 'imported',
            creator: 'Trần Văn Nhất',
            branch: 'Kalo HCM'
        },
        {
            id: 'PN003086',
            code: 'PN003086',
            time: '11/10/2026 15:38',
            nccCode: 'NCC000001',
            nccName: 'An Tiến',
            items: [
                {
                    code: 'SP002',
                    name: 'Tai nghe Shokz OpenRun Pro',
                    qty: 3,
                    price: 2800000,
                    total: 8400000
                },
                { code: 'SP007', name: 'Cáp sạc Garmin', qty: 2, price: 310000, total: 620000 }
            ],
            needPay: 9020000,
            paid: 9020000,
            note: 'Lấy hàng ở Võ Văn Tần, đã thanh toán.<br>11/10/2026 13:13:25 FT26285881004320',
            status: 'imported',
            creator: 'Trần Hùng',
            branch: 'Kalo HCM'
        },
        {
            id: 'PN003084',
            code: 'PN003084',
            time: '10/10/2026 14:27',
            nccCode: 'NCC000041',
            nccName: 'Hoàng Văn Niên',
            items: [
                { code: 'SP001', name: 'Garmin MarQ II', qty: 1, price: 6000000, total: 6000000 }
            ],
            needPay: 6000000,
            paid: 6000000,
            note: '',
            status: 'imported',
            creator: 'Trần Văn Nhất',
            branch: 'Kalo HCM'
        },
        {
            id: 'PN003079',
            code: 'PN003079',
            time: '09/10/2026 16:03',
            nccCode: 'NCC000009',
            nccName: 'Anh Tâm',
            items: [
                {
                    code: 'SP004',
                    name: 'Garmin Forerunner 965',
                    qty: 1,
                    price: 12000000,
                    total: 12000000
                },
                { code: 'SP001', name: 'Garmin MarQ II', qty: 1, price: 6500000, total: 6500000 }
            ],
            needPay: 18500000,
            paid: 18500000,
            note: '',
            status: 'imported',
            creator: 'Trần Hùng',
            branch: 'Kalo HCM'
        },
        {
            id: 'PN003077',
            code: 'PN003077',
            time: '09/10/2026 10:29',
            nccCode: 'NCC000001',
            nccName: 'An Tiến',
            items: [
                {
                    code: 'SP005',
                    name: 'Garmin Fenix 7 Pro',
                    qty: 1,
                    price: 11140000,
                    total: 11140000
                }
            ],
            needPay: 11140000,
            paid: 11140000,
            note: '05/10/2026 16:58:07 FT26278225669032',
            status: 'imported',
            creator: 'Trần Văn Nhất',
            branch: 'Kalo HCM'
        },
        {
            id: 'PN003076',
            code: 'PN003076',
            time: '09/10/2026 10:26',
            nccCode: 'NCC000001',
            nccName: 'An Tiến',
            items: [
                { code: 'SP002', name: 'Shokz OpenRun', qty: 2, price: 2785000, total: 5570000 }
            ],
            needPay: 5570000,
            paid: 5570000,
            note: '05/10/2026 16:58:07 FT26278225669032',
            status: 'imported',
            creator: 'Trần Văn Nhất',
            branch: 'Kalo HCM'
        },
        {
            id: 'PN003075',
            code: 'PN003075',
            time: '09/10/2026 09:56',
            nccCode: 'NCC000040',
            nccName: 'Thuận Nguyễn',
            items: [
                { code: 'SP003', name: 'Dây đeo Garmin', qty: 1, price: 1000000, total: 1000000 }
            ],
            needPay: 1000000,
            paid: 1000000,
            note: '',
            status: 'imported',
            creator: 'Trần Văn Nhất',
            branch: 'Kalo HCM'
        },
        {
            id: 'PN003071',
            code: 'PN003071',
            time: '08/10/2026 11:53',
            nccCode: 'NCC000001',
            nccName: 'An Tiến',
            items: [
                { code: 'SP006', name: 'Shokz OpenMove', qty: 3, price: 1150000, total: 3450000 }
            ],
            needPay: 3450000,
            paid: 3450000,
            note: '',
            status: 'imported',
            creator: 'Trần Văn Nhất',
            branch: 'Kalo HCM'
        },
        // Nhập hàng tạo tại Chi nhánh Hà Nội
        {
            id: 'PN003090',
            code: 'PN003090',
            time: '17/10/2026 11:00',
            nccCode: 'NCC000001',
            nccName: 'An Tiến Hà Nội',
            items: [
                {
                    code: 'HN001',
                    name: 'Garmin Forerunner 265 Music',
                    qty: 8,
                    price: 9000000,
                    total: 72000000
                },
                {
                    code: 'HN002',
                    name: 'Shokz OpenFit True Wireless',
                    qty: 10,
                    price: 3500000,
                    total: 35000000
                }
            ],
            needPay: 107000000,
            paid: 107000000,
            note: 'Nhập hàng ban đầu cho chi nhánh Hà Nội',
            status: 'imported',
            creator: 'Thu Ngân Hà Nội',
            branch: 'Chi nhánh Hà Nội'
        }
    ],
    cashbook: [
        {
            id: 'PT0001',
            code: 'PT0001',
            time: '16/10/2026 10:59',
            type: 'thu',
            category: 'Bán hàng',
            amount: 6000000,
            person: 'Anh Đạt',
            method: 'Chuyển khoản',
            note: 'Thu tiền hóa đơn HD005696',
            branch: 'Kalo HCM'
        },
        {
            id: 'PT0002',
            code: 'PT0002',
            time: '11/10/2026 16:13',
            type: 'thu',
            category: 'Bán hàng',
            amount: 3990000,
            person: 'Chị Thuý',
            method: 'Tiền mặt',
            note: 'Thu tiền hóa đơn HD005681',
            branch: 'Kalo HCM'
        },
        {
            id: 'PC0001',
            code: 'PC0001',
            time: '11/10/2026 15:51',
            type: 'chi',
            category: 'Nhập hàng',
            amount: 2635000,
            person: 'Nguyễn Ngọc Huy',
            method: 'Tiền mặt',
            note: 'Chi trả tiền nhập hàng PN003088',
            branch: 'Kalo HCM'
        },
        {
            id: 'PC0002',
            code: 'PC0002',
            time: '11/10/2026 15:38',
            type: 'chi',
            category: 'Nhập hàng',
            amount: 9020000,
            person: 'An Tiến',
            method: 'Chuyển khoản',
            note: 'Chi trả tiền nhập hàng PN003086',
            branch: 'Kalo HCM'
        },
        {
            id: 'PC0003',
            code: 'PC0003',
            time: '01/10/2026 09:00',
            type: 'chi',
            category: 'Chi phí mặt bằng',
            amount: 15000000,
            person: 'Chủ nhà Võ Văn Tần',
            method: 'Chuyển khoản',
            note: 'Tiền thuê mặt bằng tháng 10/2026',
            branch: 'Kalo HCM'
        },
        // Sổ quỹ tạo tại Chi nhánh Hà Nội
        {
            id: 'PT0003',
            code: 'PT0003',
            time: '18/10/2026 15:30',
            type: 'thu',
            category: 'Bán hàng',
            amount: 6000000,
            person: 'Anh Tuấn Anh',
            method: 'Chuyển khoản',
            note: 'Thu tiền hóa đơn HD005701',
            branch: 'Chi nhánh Hà Nội'
        },
        {
            id: 'PT0004',
            code: 'PT0004',
            time: '19/10/2026 10:15',
            type: 'thu',
            category: 'Bán hàng',
            amount: 3990000,
            person: 'Chị Mai Linh',
            method: 'Tiền mặt',
            note: 'Thu tiền hóa đơn HD005702',
            branch: 'Chi nhánh Hà Nội'
        }
    ],
    returns: [
        {
            id: 'TH000001',
            code: 'TH000001',
            invoiceCode: 'HD005677',
            time: '10/10/2026 15:30',
            customer: 'Anh Vũ',
            phone: '0366761866',
            items: [
                {
                    code: 'SP001',
                    name: 'Đồng hồ thông minh Garmin MarQ II',
                    qty: 1,
                    price: 6500000,
                    total: 6500000
                }
            ],
            totalRefund: 6500000,
            refundMethod: 'Chuyển khoản',
            reason: 'Khách muốn đổi sang mẫu Fenix 7 Pro',
            cashier: 'Trần Văn Nhất',
            branch: 'Kalo HCM'
        }
    ],
    categories: [
        { id: 'CAT01', name: 'Đồng hồ', parentId: null },
        { id: 'CAT0101', name: 'Đồng hồ Garmin', parentId: 'CAT01' },
        { id: 'CAT0102', name: 'Đồng hồ Apple', parentId: 'CAT01' },
        { id: 'CAT02', name: 'Tai nghe', parentId: null },
        { id: 'CAT0201', name: 'Tai nghe thể thao', parentId: 'CAT02' },
        { id: 'CAT03', name: 'Phụ kiện', parentId: null },
        { id: 'CAT0301', name: 'Dây đeo', parentId: 'CAT03' },
        { id: 'CAT0302', name: 'Cáp sạc & Kính cường lực', parentId: 'CAT03' },
        { id: 'CAT04', name: 'Quà tặng & Khác', parentId: null }
    ],
    branches: [
        {
            id: 'CN01',
            code: 'CN01',
            name: 'Kalo HCM',
            phone: '0981886057',
            address: '103 Võ Văn Tần, P.6, Quận 3, TP.HCM',
            isDefault: true,
            note: 'Chi nhánh trụ sở chính'
        },
        {
            id: 'CN02',
            code: 'CN02',
            name: 'Chi nhánh Hà Nội',
            phone: '0904000111',
            address: '29 Hai Bà Trưng, Hoàn Kiếm, Hà Nội',
            isDefault: false,
            note: 'Chi nhánh miền Bắc'
        }
    ],
    users: [
        {
            id: 'NV0001',
            code: 'NV0001',
            name: 'Trần Văn Nhất',
            username: 'admin',
            password: '123',
            phone: '0981886057',
            role: 'admin',
            roleName: 'Quản trị viên',
            branch: 'Kalo HCM',
            branches: ['Kalo HCM', 'Chi nhánh Hà Nội'],
            status: 'active',
            permissions: {
                dashboard: true,
                products: true,
                stocktakes: true,
                transfers: true,
                imports: true,
                suppliers: true,
                invoices: true,
                customers: true,
                cashbook: true,
                reports: true,
                pos: true,
                users: true,
                settings: true
            }
        },
        {
            id: 'NV0002',
            code: 'NV0002',
            name: 'Nguyễn Thu Ngân',
            username: 'thungan',
            password: '123',
            phone: '0901234567',
            role: 'cashier',
            roleName: 'Thu ngân',
            branch: 'Kalo HCM',
            branches: ['Kalo HCM'],
            status: 'active',
            permissions: {
                dashboard: true,
                products: true,
                stocktakes: false,
                transfers: false,
                imports: false,
                suppliers: false,
                invoices: true,
                customers: true,
                cashbook: false,
                reports: false,
                pos: true,
                users: false,
                settings: false
            }
        },
        {
            id: 'NV0003',
            code: 'NV0003',
            name: 'Lê Kho Vận',
            username: 'nhankho',
            password: '123',
            phone: '0912345678',
            role: 'warehouse',
            roleName: 'Thủ kho',
            branch: 'Kalo HCM',
            branches: ['Kalo HCM'],
            status: 'active',
            permissions: {
                dashboard: true,
                products: true,
                stocktakes: true,
                transfers: true,
                imports: true,
                suppliers: true,
                invoices: false,
                customers: false,
                cashbook: false,
                reports: false,
                pos: false,
                users: false,
                settings: false
            }
        },
        {
            id: 'NV0004',
            code: 'NV0004',
            name: 'Thu Ngân Hà Nội',
            username: 'thungan_hn',
            password: '123',
            phone: '0987654321',
            role: 'cashier',
            roleName: 'Thu ngân',
            branch: 'Chi nhánh Hà Nội',
            branches: ['Chi nhánh Hà Nội'],
            status: 'active',
            permissions: {
                dashboard: true,
                products: true,
                stocktakes: false,
                transfers: false,
                imports: false,
                suppliers: false,
                invoices: true,
                customers: true,
                cashbook: false,
                reports: false,
                pos: true,
                users: false,
                settings: false
            }
        }
    ],
    stocktakes: [
        {
            id: 'PKK000001',
            code: 'PKK000001',
            time: '15/10/2026 17:30',
            cashier: 'Trần Văn Nhất',
            branch: 'Kalo HCM',
            status: 'balanced', // 'balanced' (Đã cân bằng kho), 'draft' (Phiếu tạm)
            note: 'Kiểm kho định kỳ giữa tháng 10',
            totalActual: 174,
            totalVariance: -1,
            items: [
                {
                    code: 'SP001',
                    name: 'Đồng hồ thông minh Garmin MarQ II, Golfer, GPS Watch, SEA',
                    unit: 'Chiếc',
                    systemStock: 12,
                    actualStock: 12,
                    variance: 0,
                    reason: ''
                },
                {
                    code: 'SP002',
                    name: 'Tai nghe Thể thao Shokz OpenRun Pro',
                    unit: 'Chiếc',
                    systemStock: 26,
                    actualStock: 25,
                    variance: -1,
                    reason: 'Hao hụt trưng bày'
                },
                {
                    code: 'SP003',
                    name: 'Dây đeo Garmin QuickFit 22mm Silicone',
                    unit: 'Dây',
                    systemStock: 40,
                    actualStock: 40,
                    variance: 0,
                    reason: ''
                }
            ]
        },
        {
            id: 'PKK000002',
            code: 'PKK000002',
            time: '18/10/2026 18:00',
            cashier: 'Thu Ngân Hà Nội',
            branch: 'Chi nhánh Hà Nội',
            status: 'balanced',
            note: 'Kiểm kho đầu kỳ Chi nhánh Hà Nội',
            totalActual: 5,
            totalVariance: 0,
            items: [
                {
                    code: 'SP001',
                    name: 'Đồng hồ thông minh Garmin MarQ II, Golfer, GPS Watch, SEA',
                    unit: 'Chiếc',
                    systemStock: 3,
                    actualStock: 3,
                    variance: 0,
                    reason: ''
                },
                {
                    code: 'SP002',
                    name: 'Tai nghe Thể thao Shokz OpenRun Pro',
                    unit: 'Chiếc',
                    systemStock: 2,
                    actualStock: 2,
                    variance: 0,
                    reason: ''
                }
            ]
        }
    ],
    transfers: [
        {
            id: 'PCH000001',
            code: 'PCH000001',
            time: '14/10/2026 11:20',
            fromBranch: 'Kalo HCM',
            toBranch: 'Chi nhánh Hà Nội',
            cashier: 'Trần Văn Nhất',
            status: 'completed', // 'completed' (Đã nhận), 'shipping' (Đang chuyển), 'cancelled' (Đã hủy)
            receivedTime: '15/10/2026 09:30',
            receiver: 'Thu Ngân Hà Nội',
            totalQty: 5,
            totalValue: 30000000,
            note: 'Điều chuyển bổ sung hàng hot cho chi nhánh Hà Nội',
            items: [
                {
                    code: 'SP001',
                    name: 'Đồng hồ thông minh Garmin MarQ II, Golfer, GPS Watch, SEA',
                    unit: 'Chiếc',
                    qty: 3,
                    price: 6000000,
                    total: 18000000
                },
                {
                    code: 'SP002',
                    name: 'Tai nghe Thể thao Shokz OpenRun Pro',
                    unit: 'Chiếc',
                    qty: 2,
                    price: 3990000,
                    total: 7980000
                }
            ]
        },
        {
            id: 'PCH000002',
            code: 'PCH000002',
            time: '19/10/2026 09:15',
            fromBranch: 'Kalo HCM',
            toBranch: 'Chi nhánh Hà Nội',
            cashier: 'Trần Văn Nhất',
            status: 'shipping', // 'shipping' (Đang chuyển)
            totalQty: 2,
            totalValue: 7980000,
            note: 'Chuyển gấp đợt 2 cho Chi nhánh Hà Nội',
            items: [
                {
                    code: 'SP002',
                    name: 'Tai nghe Thể thao Shokz OpenRun Pro',
                    unit: 'Chiếc',
                    qty: 2,
                    price: 3990000,
                    total: 7980000
                }
            ]
        }
    ],
    delivery_orders: [],
    delivery_status_history: [],
    delivery_tasks: [],
    delivery_cod_records: []
};

// Server-only fixture/default settings. Never served to the browser.
module.exports = { defaultData };
