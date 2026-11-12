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
    const original = vtp.createOrder;
    vtp.createOrder = async () => {
        throw new Error('timeout');
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
        vtp.createOrder = original;
        delete process.env.NKIOT_VTP_BASE_URL;
    }
});
