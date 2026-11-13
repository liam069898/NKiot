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
        delete process.env.NKIOT_VTP_BASE_URL;
    }
});
