'use strict';
// Worker + webhook cho bán giao hàng Viettel Post.
// Token chỉ ở backend; không bao giờ gửi về trình duyệt. Task chạy ngoài transaction.

const crypto = require('node:crypto');
const db = require('./db');
const vtp = require('./viettelpost-client');

// Ưu tiên cấu hình đã lưu trong DB (đã giải mã) trước biến môi trường.
try {
    const vtpConfig = require('./viettelpost-config');
    vtp.setConfigResolver(() => vtpConfig.getResolvedConfig());
} catch {}

let timer = null;
let running = null;
const RETRY_MS = 30000;

const enabled = () => vtp.enabled();

function nowIso() {
    return new Date().toISOString();
}

function text(value, max) {
    return typeof value === 'string' ? value.slice(0, max) : '';
}

// Cập nhật trạng thái giao hàng khi hãng báo lấy hàng thành công (ORDER_STATUS = 200).
// Bản đầu xuất kho ngay khi xác nhận đơn; ở đây chỉ đánh dấu đã bàn giao, không trừ tồn thêm.
function applyStatus(record, statusCode) {
    if (statusCode === 200 && ['confirmed', 'submitted'].includes(record.status))
        record.status = 'handed_over';
    if ([501, 503, 504].includes(statusCode)) record.status = 'delivered';
    if ([505].includes(statusCode)) record.status = 'returning';
    if ([107, 101, 201].includes(statusCode)) record.status = 'cancelled';
    return record;
}

// Lấy task đầu tiên đến hạn, đánh dấu running trong một transaction độc lập.
function claimNextTask() {
    const d = db.getDb();
    d.exec('BEGIN IMMEDIATE');
    try {
        const row = d
            .prepare(
                `SELECT * FROM delivery_tasks
                 WHERE status IN ('pending','unknown')
                   AND (nextAttemptAt IS NULL OR nextAttemptAt <= ?)
                 ORDER BY rowid LIMIT 1`
            )
            .get(Date.now());
        if (!row) {
            d.exec('COMMIT');
            return null;
        }
        d.prepare("UPDATE delivery_tasks SET status='running', updatedAt=? WHERE id=?").run(
            nowIso(),
            row.id
        );
        d.exec('COMMIT');
        return row;
    } catch (e) {
        d.exec('ROLLBACK');
        throw e;
    }
}

function finishTask(id, { status, lastError = '', delivery = null, nextAttemptAt = null }) {
    const d = db.getDb();
    d.prepare(
        `UPDATE delivery_tasks
         SET status=?, lastError=?, attempt=attempt+1, nextAttemptAt=?, updatedAt=?
         WHERE id=?`
    ).run(status, lastError, nextAttemptAt, nowIso(), id);
    if (delivery) {
        const fields = Object.keys(delivery).filter((k) => k !== 'id');
        if (fields.length) {
            const set = fields.map((k) => `${k}=?`).join(',');
            d.prepare(`UPDATE delivery_orders SET ${set}, updatedAt=? WHERE id=?`).run(
                ...fields.map((k) => delivery[k]),
                nowIso(),
                delivery.id
            );
        }
    }
}

// Dựng payload createOrder từ delivery_orders, không gửi token hay dữ liệu thừa.
function buildCreateOrderPayload(record) {
    const cod = record.paymentType === 3 || record.paymentType === 2;
    return {
        ORDER_NUMBER: record.shipmentReference || record.code,
        CHECK_UNIQUE: true,
        PRODUCT_TYPE: record.productType || 'HH',
        PRODUCT_WEIGHT: record.weightGram || 50,
        ORDER_PAYMENT: record.paymentType || 1,
        ORDER_SERVICE: record.service || '',
        ORDER_SERVICE_ADD: record.serviceAdd || '',
        MONEY_COLLECTION: cod ? record.codRequested : 0,
        SENDER_FULLNAME: record.senderName,
        SENDER_PHONE: record.senderPhone,
        SENDER_ADDRESS: record.senderAddress,
        SENDER_PROVINCE: record.senderProvinceId,
        SENDER_DISTRICT: record.senderDistrictId,
        SENDER_WARD: record.senderWardId,
        RECEIVER_FULLNAME: record.receiverName,
        RECEIVER_PHONE: record.receiverPhone,
        RECEIVER_ADDRESS: record.receiverAddress,
        RECEIVER_PROVINCE: record.receiverProvinceId,
        RECEIVER_DISTRICT: record.receiverDistrictId,
        RECEIVER_WARD: record.receiverWardId,
        ORDER_NOTE: record.note || ''
    };
}

async function processTask(task) {
    const d = db.getDb();
    const record = d.prepare('SELECT * FROM delivery_orders WHERE id=?').get(task.deliveryId);
    if (!record || record.status !== 'confirmed') {
        finishTask(task.id, { status: 'done' });
        return;
    }
    if (task.action !== 'create_order') {
        finishTask(task.id, { status: 'failed', lastError: `Không hỗ trợ action ${task.action}.` });
        return;
    }
    try {
        const response = await vtp.createOrder(buildCreateOrderPayload(record));
        const orderNumber = text(response?.data?.ORDER_NUMBER, 200);
        if (!orderNumber) throw new Error('Viettel Post không trả mã vận đơn.');
        finishTask(task.id, {
            status: 'done',
            delivery: { id: record.id, shipmentCode: orderNumber, status: 'submitted' }
        });
    } catch (error) {
        const detail = String(error.message || error).slice(0, 500);
        // Không biết hãng có nhận yêu cầu hay chưa; giữ unknown để đối soát thủ công.
        finishTask(task.id, {
            status: 'unknown',
            lastError: detail,
            nextAttemptAt: Date.now() + RETRY_MS
        });
    }
}

async function processPendingTasks() {
    if (running) return running;
    running = (async () => {
        if (!enabled()) return { processed: 0 };
        let processed = 0;
        for (let i = 0; i < 25; i++) {
            const task = claimNextTask();
            if (!task) break;
            await processTask(task);
            processed++;
        }
        return { processed };
    })();
    try {
        return await running;
    } finally {
        running = null;
    }
}

function scheduleDelivery(delay = 0) {
    if (!enabled()) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
        processPendingTasks()
            .then(() => scheduleDelivery(RETRY_MS))
            .catch((error) => {
                console.error('Xử lý đơn giao hàng thất bại:', error.message);
                scheduleDelivery(RETRY_MS);
            });
    }, delay);
}

// Nhận webhook Viettel Post. Trả về true nếu đã ghi nhận (idempotent), không ném với sự kiện trùng.
function handleWebhook(payload) {
    const data = payload && payload.DATA ? payload.DATA : payload;
    if (!data || !data.ORDER_NUMBER) throw new Error('Webhook thiếu mã vận đơn.');
    const d = db.getDb();
    const record = d
        .prepare('SELECT * FROM delivery_orders WHERE shipmentCode=?')
        .get(text(data.ORDER_NUMBER, 200));
    if (!record) {
        // Không rõ vận đơn của cửa hàng nào (nhiều tenant dùng chung tài khoản).
        return { recorded: false, reason: 'unknown_shipment' };
    }
    const statusDate = text(data.ORDER_STATUSDATE, 40) || nowIso();
    const statusCode = Number(data.ORDER_STATUS);
    if (!Number.isInteger(statusCode)) throw new Error('Webhook thiếu trạng thái hợp lệ.');
    const id = `WH-${crypto
        .createHash('sha256')
        .update(`${record.id}|${statusCode}|${statusDate}`)
        .digest('hex')
        .slice(0, 32)}`;
    const already = d.prepare('SELECT 1 FROM delivery_status_history WHERE id=?').get(id);
    if (!already) {
        d.prepare(
            `INSERT INTO delivery_status_history
             (id, deliveryId, orderNumber, statusCode, statusName, statusDate, reasonCode, note, receivedAt, processedAt)
             VALUES (?,?,?,?,?,?,?,?,?,?)`
        ).run(
            id,
            record.id,
            record.shipmentCode,
            statusCode,
            text(data.STATUS_NAME, 200),
            statusDate,
            data.REASON_CODE != null ? text(String(data.REASON_CODE), 50) : null,
            text(data.NOTE, 500),
            nowIso(),
            nowIso()
        );
    }
    const next = applyStatus({ ...record }, statusCode);
    if (next.status !== record.status) {
        d.prepare('UPDATE delivery_orders SET status=?, updatedAt=? WHERE id=?').run(
            next.status,
            nowIso(),
            record.id
        );
    }
    return { recorded: true, deliveryId: record.id, status: statusCode };
}

module.exports = {
    enabled,
    processPendingTasks,
    scheduleDelivery,
    handleWebhook,
    applyStatus
};
