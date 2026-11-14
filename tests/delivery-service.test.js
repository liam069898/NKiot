'use strict';
require('./test-env');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const db = require('../db');
const delivery = require('../delivery-service');
const vtp = require('../viettelpost-client');

function seedDelivery(status = 'confirmed', shipmentCode = '') {
    const id = `GH${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const now = new Date().toISOString();
    db.getDb()
        .prepare(
            `INSERT INTO delivery_orders
             (id, invoiceId, branch, code, receiverName, receiverPhone, receiverAddress,
              paymentType, weightGram, productType, productTotal, prepaid, codRequested,
              shipmentReference, shipmentCode, status, createdAt, updatedAt)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
            id,
            `HD-${id}`,
            'A',
            id,
            'Người nhận',
            '0987654321',
            'Địa chỉ',
            3,
            500,
            'HH',
            100000,
            0,
            100000,
            id,
            shipmentCode,
            status,
            now,
            now
        );
    return id;
}

before(() => db.initDb());
after(() => db.closeDb());
beforeEach(() => {
    db.getDb().exec(
        'DELETE FROM delivery_status_history; DELETE FROM delivery_tasks; DELETE FROM delivery_cod_records; DELETE FROM delivery_orders;'
    );
});

test('handleWebhook dedupes identical events and updates handover status', () => {
    const id = seedDelivery('confirmed', 'VP-ORDER-1');
    const payload = {
        DATA: {
            ORDER_NUMBER: 'VP-ORDER-1',
            ORDER_STATUSDATE: '09/11/2026 12:00:00',
            ORDER_STATUS: 200,
            STATUS_NAME: 'Lấy hàng thành công'
        }
    };
    assert.equal(delivery.handleWebhook(payload).recorded, true);
    assert.equal(delivery.handleWebhook(payload).recorded, true);
    const history = db
        .getDb()
        .prepare('SELECT COUNT(*) AS n FROM delivery_status_history WHERE deliveryId=?')
        .get(id).n;
    assert.equal(history, 1, 'sự kiện trùng chỉ ghi một lần');
    assert.equal(
        db.getDb().prepare('SELECT status FROM delivery_orders WHERE id=?').get(id).status,
        'handed_over'
    );
});

test('handleWebhook ignores unknown shipment without throwing', () => {
    const outcome = delivery.handleWebhook({ DATA: { ORDER_NUMBER: 'NOPE', ORDER_STATUS: 200 } });
    assert.equal(outcome.recorded, false);
    assert.equal(outcome.reason, 'unknown_shipment');
});

test('applyStatus maps Viettel Post codes correctly and never steps backwards', () => {
    // 200 -> handed_over
    assert.equal(delivery.applyStatus({ status: 'confirmed' }, 200).status, 'handed_over');
    assert.equal(delivery.applyStatus({ status: 'submitted' }, 200).status, 'handed_over');
    // 501 -> delivered (chỉ sau khi bàn giao/đã gửi hãng)
    assert.equal(delivery.applyStatus({ status: 'handed_over' }, 501).status, 'delivered');
    assert.equal(delivery.applyStatus({ status: 'confirmed' }, 501).status, 'confirmed');
    // 504 -> returning (chuyển hoàn người gửi), không phải giao thành công
    assert.equal(delivery.applyStatus({ status: 'handed_over' }, 504).status, 'returning');
    // 505 chỉ là "yêu cầu chuyển hoàn", cửa hàng còn quyền chọn hoàn/phát tiếp: không tự đổi trạng thái
    assert.equal(delivery.applyStatus({ status: 'handed_over' }, 505).status, 'handed_over');
    // 503 -> không tự đổi trạng thái
    assert.equal(delivery.applyStatus({ status: 'handed_over' }, 503).status, 'handed_over');
    // 101/107/201 -> cancelled (chỉ trước bàn giao)
    assert.equal(delivery.applyStatus({ status: 'confirmed' }, 101).status, 'cancelled');
    assert.equal(delivery.applyStatus({ status: 'submitted' }, 107).status, 'cancelled');
    // Không lùi trạng thái: đã giao thì sự kiện hủy/hoàn không ghi đè
    assert.equal(delivery.applyStatus({ status: 'delivered' }, 101).status, 'delivered');
    assert.equal(delivery.applyStatus({ status: 'delivered' }, 504).status, 'delivered');
    assert.equal(delivery.applyStatus({ status: 'returning' }, 501).status, 'returning');
});

test('mapVtpStatus maps documented codes to internal statuses', () => {
    assert.equal(delivery.mapVtpStatus(200), 'handed_over');
    assert.equal(delivery.mapVtpStatus(501), 'delivered');
    assert.equal(delivery.mapVtpStatus(504), 'returning');
    // 505 = yêu cầu chuyển hoàn (chờ cửa hàng chọn), chưa phải "đang hoàn"
    assert.equal(delivery.mapVtpStatus(505), null);
    assert.equal(delivery.mapVtpStatus(503), null);
    assert.equal(delivery.mapVtpStatus(107), 'cancelled');
    assert.equal(delivery.mapVtpStatus(300), null);
});

test('processPendingTasks marks unknown on client failure and done on success', async () => {
    const id = seedDelivery('confirmed');
    db.getDb()
        .prepare(
            `INSERT INTO delivery_tasks (id, deliveryId, action, payload, attempt, nextAttemptAt, status, lastError, createdAt, updatedAt)
             VALUES (?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
            `T-${id}`,
            id,
            'create_order',
            '{}',
            0,
            Date.now() - 1000,
            'pending',
            '',
            new Date().toISOString(),
            new Date().toISOString()
        );
    const original = vtp.createOrderNlp;
    const originalServices = vtp.availableServices;
    vtp.availableServices = async () => [
        { code: 'VCN', name: 'Nhanh', price: 20000, time: '24 giờ' }
    ];
    vtp.createOrderNlp = async () => {
        // Lỗi mạng/timeout: không biết hãng đã nhận chưa, giữ unknown để thử lại có giới hạn.
        throw Object.assign(new Error('timeout'), { network: true });
    };
    process.env.NKIOT_VTP_BASE_URL = 'https://partnerdev.viettelpost.vn';
    try {
        await delivery.processPendingTasks();
        assert.equal(
            db.getDb().prepare('SELECT status FROM delivery_tasks WHERE id=?').get(`T-${id}`)
                .status,
            'unknown'
        );
    } finally {
        vtp.createOrderNlp = original;
        vtp.availableServices = originalServices;
        delete process.env.NKIOT_VTP_BASE_URL;
    }
});

test('create_order task stops retrying after a carrier-side error and surfaces it as failed', async () => {
    const id = seedDelivery('confirmed');
    // attempt đã đủ ngưỡng: lỗi nghiệp vụ từ hãng phải chuyển thành failed (không retry vô hạn).
    db.getDb()
        .prepare(
            `INSERT INTO delivery_tasks (id, deliveryId, action, payload, attempt, nextAttemptAt, status, lastError, createdAt, updatedAt)
             VALUES (?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
            `T-${id}`,
            id,
            'create_order',
            '{}',
            2,
            Date.now() - 1000,
            'unknown',
            '',
            new Date().toISOString(),
            new Date().toISOString()
        );
    const original = vtp.createOrderNlp;
    const originalServices = vtp.availableServices;
    vtp.availableServices = async () => [
        { code: 'VCN', name: 'Nhanh', price: 20000, time: '24 giờ' }
    ];
    vtp.createOrderNlp = async () => {
        throw new Error('Incorrect data: ORDER_SERVICE');
    };
    process.env.NKIOT_VTP_BASE_URL = 'https://partnerdev.viettelpost.vn';
    try {
        await delivery.processPendingTasks();
        const row = db
            .getDb()
            .prepare('SELECT status, lastError, nextAttemptAt FROM delivery_tasks WHERE id=?')
            .get(`T-${id}`);
        assert.equal(row.status, 'failed');
        assert.match(row.lastError, /ORDER_SERVICE/);
        assert.equal(row.nextAttemptAt, null);
    } finally {
        vtp.createOrderNlp = original;
        vtp.availableServices = originalServices;
        delete process.env.NKIOT_VTP_BASE_URL;

        test('create_order picks a service that applies to the route instead of the stored one', async () => {
            // Đơn lưu dịch vụ VCN (không áp dụng tuyến); hãng chỉ có LCOD/NCOD/VHT.
            const id = seedDelivery('confirmed');
            db.getDb().prepare("UPDATE delivery_orders SET service='VCN' WHERE id=?").run(id);
            db.getDb()
                .prepare(
                    `INSERT INTO delivery_tasks (id, deliveryId, action, payload, attempt, nextAttemptAt, status, lastError, createdAt, updatedAt)
             VALUES (?,?,?,?,?,?,?,?,?,?)`
                )
                .run(
                    `T-${id}`,
                    id,
                    'create_order',
                    '{}',
                    0,
                    Date.now() - 1000,
                    'pending',
                    '',
                    new Date().toISOString(),
                    new Date().toISOString()
                );
            const originalServices = vtp.availableServices;
            const originalCreate = vtp.createOrderNlp;
            vtp.availableServices = async () => [
                { code: 'NCOD', name: 'Nhanh', price: 43120, time: '36 giờ' },
                { code: 'LCOD', name: 'Tiết kiệm', price: 34720, time: '72 giờ' }
            ];
            let sentService = '';
            vtp.createOrderNlp = async (payload) => {
                sentService = payload.ORDER_SERVICE;
                return { data: { ORDER_NUMBER: 'VP-OK-1' } };
            };
            process.env.NKIOT_VTP_BASE_URL = 'https://partnerdev.viettelpost.vn';
            try {
                await delivery.processPendingTasks();
                assert.equal(sentService, 'LCOD', 'phải gửi dịch vụ hợp lệ rẻ nhất');
                assert.equal(
                    db.getDb().prepare('SELECT service FROM delivery_orders WHERE id=?').get(id)
                        .service,
                    'LCOD',
                    'dịch vụ đã chọn được lưu lại để UI hiển thị đúng'
                );
            } finally {
                vtp.availableServices = originalServices;
                vtp.createOrderNlp = originalCreate;
                delete process.env.NKIOT_VTP_BASE_URL;
            }
        });
    }
});

test('enqueueOrderAction validates state before queueing an update task', () => {
    const noCode = seedDelivery('submitted', '');
    assert.equal(delivery.enqueueOrderAction(noCode, 'cancel').reason, 'no_shipment_code');

    const confirmed = seedDelivery('confirmed', 'VP-ACT-2');
    assert.equal(delivery.enqueueOrderAction(confirmed, 'cancel').reason, 'not_cancellable');
    assert.equal(delivery.enqueueOrderAction(confirmed, 'redeliver').reason, 'not_returning');
    assert.equal(delivery.enqueueOrderAction(confirmed, 'bogus').reason, 'unknown_action');

    const submitted = seedDelivery('submitted', 'VP-ACT-1');
    assert.equal(delivery.enqueueOrderAction(submitted, 'cancel').ok, true);
    // Chặn xếp trùng khi đã có thao tác đang chờ
    assert.equal(delivery.enqueueOrderAction(submitted, 'cancel').reason, 'action_pending');

    const task = db
        .getDb()
        .prepare('SELECT action, status, payload FROM delivery_tasks WHERE deliveryId=?')
        .get(submitted);
    assert.equal(task.action, 'update_order');
    assert.equal(task.status, 'pending');
    assert.equal(JSON.parse(task.payload).type, 4);
});

test('update_order task calls Viettel Post UpdateOrder and completes', async () => {
    const id = seedDelivery('returning', 'VP-ACT-3');
    assert.equal(delivery.enqueueOrderAction(id, 'redeliver').ok, true);
    const calls = [];
    const original = vtp.updateOrder;
    vtp.updateOrder = async (type, code, note) => {
        calls.push({ type, code, note });
        return { status: 200, error: false };
    };
    process.env.NKIOT_VTP_BASE_URL = 'https://partnerdev.viettelpost.vn';
    try {
        await delivery.processPendingTasks();
        assert.deepEqual(calls, [{ type: 3, code: 'VP-ACT-3', note: '' }]);
        const task = db
            .getDb()
            .prepare('SELECT status, lastError FROM delivery_tasks WHERE deliveryId=?')
            .get(id);
        assert.equal(task.status, 'done');
        assert.equal(task.lastError, '');
    } finally {
        vtp.updateOrder = original;
        delete process.env.NKIOT_VTP_BASE_URL;
    }
});

test('labelUrl builds the official DigitalizePrint link and reuses the cached print code', async () => {
    const id = seedDelivery('submitted', 'VP-LABEL-1');
    const original = vtp.printingCode;
    let called = 0;
    vtp.printingCode = async () => {
        called++;
        return { status: 200, error: false, message: 'PRINTCODE123', data: null };
    };
    process.env.NKIOT_VTP_BASE_URL = 'https://partnerdev.viettelpost.vn';
    try {
        const first = await delivery.labelUrl(id, { size: 'A5', showPostage: 1 });
        assert.match(first.url, /dev-release-print\.viettelpost\.vn/);
        assert.match(first.url, /bill=PRINTCODE123/);
        assert.match(first.url, /type=1/);
        assert.match(first.url, /showPostage=1/);
        const second = await delivery.labelUrl(id, { size: 'A5', showPostage: 0 });
        assert.equal(called, 1, 'dùng lại mã in còn hạn, không gọi hãng lại');
        assert.equal(second.printCode, 'PRINTCODE123');
        assert.match(second.url, /showPostage=0/);
        const row = db
            .getDb()
            .prepare('SELECT printCode, printExpiresAt FROM delivery_orders WHERE id=?')
            .get(id);
        assert.equal(row.printCode, 'PRINTCODE123');
        assert.ok(Number(row.printExpiresAt) > Date.now());
    } finally {
        vtp.printingCode = original;
        delete process.env.NKIOT_VTP_BASE_URL;
    }

    test('webhook records the COD amount the carrier collected and flags a mismatch', () => {
        const id = seedDelivery('handed_over', 'VP-COD-1');
        db.getDb()
            .prepare(
                `INSERT INTO delivery_cod_records (id, deliveryId, codRequested, codCollected, carrierFee, settlementAmount, status, settledAt, note, createdAt, updatedAt)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`
            )
            .run(
                `COD-${id}`,
                id,
                100000,
                0,
                0,
                0,
                'unpaid',
                null,
                '',
                new Date().toISOString(),
                new Date().toISOString()
            );

        delivery.handleWebhook({
            DATA: {
                ORDER_NUMBER: 'VP-COD-1',
                ORDER_STATUS: 501,
                ORDER_STATUSDATE: '13/11/2026 10:00:00',
                MONEY_COLLECTION: 100000
            }
        });
        let rec = db
            .getDb()
            .prepare('SELECT status, codCollected FROM delivery_cod_records WHERE deliveryId=?')
            .get(id);
        assert.equal(rec.status, 'carrier_collected');
        assert.equal(rec.codCollected, 100000);

        // Hãng báo thu thiếu -> disputed, giữ số thực thu để đối soát
        delivery.handleWebhook({
            DATA: {
                ORDER_NUMBER: 'VP-COD-1',
                ORDER_STATUS: 501,
                ORDER_STATUSDATE: '13/11/2026 11:00:00',
                MONEY_COLLECTION: 90000
            }
        });
        rec = db
            .getDb()
            .prepare(
                'SELECT status, codCollected, note FROM delivery_cod_records WHERE deliveryId=?'
            )
            .get(id);
        assert.equal(rec.status, 'disputed');
        assert.equal(rec.codCollected, 90000);
        assert.match(rec.note, /thiếu 10000/);
    });

    test('webhook stores route details and delivery photos, and maps failure reasons', () => {
        const id = seedDelivery('handed_over', 'VP-HIS-1');
        delivery.handleWebhook({
            DATA: {
                ORDER_NUMBER: 'VP-HIS-1',
                ORDER_STATUS: 506,
                ORDER_STATUSDATE: '13/11/2026 12:00:00',
                REASON_CODE: 36,
                NOTE: 'Gọi 2 lần',
                LOCATION_CURRENTLY: 'HNI, Bưu cục Gia Lâm',
                EMPLOYEE_NAME: 'Nguyễn A',
                EMPLOYEE_PHONE: '0912345678',
                EXPECTED_DELIVERY: '24 giờ',
                POD: { IMAGES: ['https://img.example/1.jpg'] }
            }
        });
        const h = db
            .getDb()
            .prepare(
                'SELECT location, employeeName, employeePhone, expectedDelivery, podImages, reasonCode, note FROM delivery_status_history WHERE deliveryId=? ORDER BY rowid DESC LIMIT 1'
            )
            .get(id);
        assert.equal(h.location, 'HNI, Bưu cục Gia Lâm');
        assert.equal(h.employeeName, 'Nguyễn A');
        assert.equal(h.employeePhone, '0912345678');
        assert.equal(h.expectedDelivery, '24 giờ');
        assert.match(h.podImages, /img\.example\/1\.jpg/);
        assert.equal(h.reasonCode, '36');
        assert.match(h.note, /Không liên lạc được khách hàng nhận/);
        assert.match(h.note, /Gọi 2 lần/);

        assert.match(delivery.failureReasonText(36), /Không liên lạc được/);
        assert.equal(delivery.failureReasonText(999), '');
        assert.equal(delivery.failureReasonText(null), '');
    });

    test('edit_order task sends the edit to Viettel Post and updates the order', async () => {
        const id = seedDelivery('submitted', 'VP-EDIT-1');
        const patch = { receiverPhone: '0999888777', codRequested: 555000 };
        assert.equal(delivery.enqueueOrderEdit(id, patch).ok, true);
        // Đã có thao tác đang chờ nên không xếp thêm
        assert.equal(delivery.enqueueOrderEdit(id, { note: 'x' }).reason, 'action_pending');

        const calls = [];
        const original = vtp.editOrder;
        vtp.editOrder = async (payload) => {
            calls.push(payload);
            return { status: 200, error: false };
        };
        process.env.NKIOT_VTP_BASE_URL = 'https://partnerdev.viettelpost.vn';
        try {
            await delivery.processPendingTasks();
            assert.equal(calls.length, 1);
            assert.equal(calls[0].ORDER_NUMBER, 'VP-EDIT-1');
            const row = db
                .getDb()
                .prepare('SELECT receiverPhone, codRequested FROM delivery_orders WHERE id=?')
                .get(id);
            assert.equal(row.receiverPhone, '0999888777');
            assert.equal(row.codRequested, 555000);
        } finally {
            vtp.editOrder = original;
            delete process.env.NKIOT_VTP_BASE_URL;
        }

        // Đơn chưa gửi hãng thì không sửa qua VTP được
        const confirmed = seedDelivery('confirmed', 'VP-EDIT-2');
        assert.equal(delivery.enqueueOrderEdit(confirmed, { note: 'x' }).reason, 'not_editable');
    });

    test('quoteService normalizes the carrier price response', async () => {
        const original = vtp.getPriceNlp;
        vtp.getPriceNlp = async () => ({
            data: { MONEY_TOTAL: 45000, MONEY_TOTAL_FEE: 40909, MONEY_VAT: 4091, KPI_HT: 24 }
        });
        try {
            const q = await delivery.quoteService({
                senderAddress: 'A',
                receiverAddress: 'B',
                weightGram: 200,
                service: 'VCN'
            });
            assert.equal(q.price, 45000);
            assert.equal(q.fee, 40909);
            assert.equal(q.vat, 4091);
            assert.equal(q.etaHours, 24);
        } finally {
            vtp.getPriceNlp = original;
        }
    });

    test('batchLabelUrl prints several orders with one print code', async () => {
        const a = seedDelivery('submitted', 'VP-B1');
        const b = seedDelivery('submitted', 'VP-B2');
        seedDelivery('confirmed', ''); // chưa có mã -> bỏ qua
        const original = vtp.printingCode;
        let captured = null;
        vtp.printingCode = async (codes, expiry) => {
            captured = { codes, expiry };
            return { message: 'BATCHCODE' };
        };
        process.env.NKIOT_VTP_BASE_URL = 'https://partnerdev.viettelpost.vn';
        try {
            const out = await delivery.batchLabelUrl([a, b, 'NOPE'], { size: 'A6' });
            assert.equal(out.count, 2);
            assert.deepEqual(captured.codes.slice().sort(), ['VP-B1', 'VP-B2']);
            assert.match(out.url, /bill=BATCHCODE/);
            assert.match(out.url, /type=2/);
        } finally {
            vtp.printingCode = original;
            delete process.env.NKIOT_VTP_BASE_URL;
        }
    });
});
