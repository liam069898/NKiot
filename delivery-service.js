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
const MAX_CREATE_ORDER_RETRY = 3;
const MAX_NETWORK_RETRY = 5;

const enabled = () => vtp.enabled();

function nowIso() {
    return new Date().toISOString();
}

function text(value, max) {
    return typeof value === 'string' ? value.slice(0, max) : '';
}

// Ánh xạ trạng thái Viettel Post sang trạng thái nội bộ. Chỉ đổi trạng thái khi hợp lệ
// và không lùi trạng thái: sự kiện trễ (hủy/hoàn sau khi đã giao) không được ghi đè trạng thái cuối.
// Trả về trạng thái nội bộ cho một mã trạng thái Viettel Post (hoặc null nếu không liên quan).
function mapVtpStatus(statusCode) {
    if (statusCode === 200) return 'handed_over'; // lấy hàng thành công
    if (statusCode === 501) return 'delivered'; // phát thành công
    if (statusCode === 504) return 'returning'; // chuyển hoàn người gửi
    // 505 chỉ là "yêu cầu chuyển hoàn", cửa hàng còn quyền chọn hoàn/phát tiếp qua UpdateOrder.
    // Không tự đổi sang "đang hoàn" vì hàng có thể được phát tiếp sau đó.
    if (statusCode === 505) return null;
    if (statusCode === 503) return null; // tiêu hủy theo yêu cầu: nghiệp vụ riêng, không tự đổi
    if ([101, 107, 201].includes(statusCode)) return 'cancelled'; // hủy
    return null;
}

function applyStatus(record, statusCode) {
    const nextStatus = mapVtpStatus(statusCode);
    if (!nextStatus) return record;
    const current = record.status;
    // Trạng thái cuối: không thay đổi gì thêm.
    if (['delivered', 'returned', 'cancelled'].includes(current)) return record;
    // Đang hoàn (504 chuyển hoàn người gửi là trạng thái cuối): chỉ cửa hàng nhận hoàn
    // (returned) mới chuyển tiếp, không tự lùi hay giao lại.
    if (current === 'returning' && nextStatus !== 'returning') return record;
    // Hủy chỉ hợp lệ trước khi bàn giao (confirmed/submitted); sau bàn giao thì là hoàn hàng.
    if (nextStatus === 'cancelled' && !['confirmed', 'submitted'].includes(current)) return record;
    // Giao thành công/đang hoàn chỉ hợp lệ sau khi đã bàn giao hoặc đã gửi hãng.
    if (
        ['delivered', 'returning'].includes(nextStatus) &&
        !['handed_over', 'submitted', 'returning'].includes(current)
    )
        return record;
    record.status = nextStatus;
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
    // Ghi ngoài transaction POS: tăng revision để client đang mở thấy trạng thái vận đơn mới.
    db.bumpRevision();
}

// Dựng payload createOrderNlp từ delivery_orders (địa chỉ dạng chữ, hãng tự chuẩn hóa).
// Không gửi token hay dữ liệu thừa; chuỗi tự do cắt theo byte để không vượt giới hạn hãng.
function buildCreateOrderPayload(record) {
    const cod = record.paymentType === 3 || record.paymentType === 2;
    const items = Array.isArray(record.items) ? record.items : [];
    const totalQty = items.reduce((n, it) => n + (Number(it.qty) || 0), 0);
    const listItem = items.slice(0, 50).map((it) => ({
        PRODUCT_NAME: vtp.bytes(it.name || it.code, 150),
        PRODUCT_QUANTITY: Number(it.qty) || 1,
        PRODUCT_PRICE: Math.max(0, Number(it.price) || 0),
        PRODUCT_WEIGHT: Math.max(0, Number(it.weightGram) || 0)
    }));
    return {
        ORDER_NUMBER: record.shipmentReference || record.code,
        CHECK_UNIQUE: true,
        PRODUCT_TYPE: record.productType || 'HH',
        PRODUCT_WEIGHT: Number(record.weightGram) || 50,
        ORDER_PAYMENT: record.paymentType || 1,
        ORDER_SERVICE: vtp.bytes(record.service || '', 20),
        ORDER_SERVICE_ADD: vtp.bytes(record.serviceAdd || '', 20),
        MONEY_COLLECTION: cod ? Number(record.codRequested) || 0 : 0,
        PRODUCT_NAME: vtp.bytes(
            items.length === 1 ? items[0].name || items[0].code : 'Hàng hóa',
            150
        ),
        PRODUCT_QUANTITY: totalQty || 1,
        PRODUCT_PRICE: Math.max(0, Number(record.productTotal) || 0),
        SENDER_FULLNAME: vtp.bytes(record.senderName, 150),
        SENDER_PHONE: vtp.bytes(record.senderPhone, 20),
        SENDER_ADDRESS: vtp.bytes(record.senderAddress, 150),
        RECEIVER_FULLNAME: vtp.bytes(record.receiverName, 150),
        RECEIVER_PHONE: vtp.bytes(record.receiverPhone, 20),
        RECEIVER_ADDRESS: vtp.bytes(record.receiverAddress, 150),
        ORDER_NOTE: vtp.bytes(record.note || '', 150),
        LIST_ITEM: listItem
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
        const response = await vtp.createOrderNlp(buildCreateOrderPayload(record));
        const orderNumber = text(response?.data?.ORDER_NUMBER, 200);
        if (!orderNumber) throw new Error('Viettel Post không trả mã vận đơn.');
        finishTask(task.id, {
            status: 'done',
            delivery: { id: record.id, shipmentCode: orderNumber, status: 'submitted' }
        });
    } catch (error) {
        const detail = String(error.message || error).slice(0, 500);
        const isNetwork = Boolean(error.network);
        const attempt = (Number(task.attempt) || 0) + 1;
        // Lỗi mạng/timeout: có thể hãng chưa nhận, thử lại có giới hạn rồi giữ unknown để đối soát.
        if (isNetwork) {
            finishTask(task.id, {
                status: 'unknown',
                lastError: detail,
                nextAttemptAt: attempt < MAX_NETWORK_RETRY ? Date.now() + RETRY_MS : null
            });
            return;
        }
        // Hãng đã trả lời rõ: thử lại tối đa vài lần (để che lỗi thoáng qua), sau đó đánh dấu
        // thất bại để UI hiển thị cho nhân viên, thay vì retry vô hạn.
        finishTask(task.id, {
            status: attempt < MAX_CREATE_ORDER_RETRY ? 'unknown' : 'failed',
            lastError: detail,
            nextAttemptAt: attempt < MAX_CREATE_ORDER_RETRY ? Date.now() + RETRY_MS : null
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
    // Ưu tiên tìm theo mã vận đơn; nếu chưa có (kết quả tạo vận đơn bị mất) thì dùng ORDER_REFERENCE
    // — chính là mã tham chiếu NKiot đã gửi khi tạo vận đơn.
    let record = d
        .prepare('SELECT * FROM delivery_orders WHERE shipmentCode=?')
        .get(text(data.ORDER_NUMBER, 200));
    const reference = text(data.ORDER_REFERENCE, 200);
    if (!record && reference) {
        record = d
            .prepare(
                'SELECT * FROM delivery_orders WHERE shipmentReference=? OR code=? OR orderNumber=?'
            )
            .get(reference, reference, reference);
        if (record) {
            d.prepare('UPDATE delivery_orders SET shipmentCode=?, updatedAt=? WHERE id=?').run(
                text(data.ORDER_NUMBER, 200),
                nowIso(),
                record.id
            );
            db.bumpRevision();
        }
    }
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
            text(data.ORDER_NUMBER, 200),
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
    if (next.status === record.status)
        return { recorded: true, deliveryId: record.id, status: statusCode, unchanged: true };

    // Khi hãng xác nhận hủy (101/107/201) trước bàn giao, đảo ngược luôn chứng từ bán gốc
    // (hoàn kho, IMEI, tiền cọc, công nợ) để tránh hóa đơn "mồ côi" còn trừ kho/giữ doanh thu.
    if (next.status === 'cancelled') {
        try {
            const domain = require('./domain');
            d.exec('BEGIN IMMEDIATE');
            const dataObj = db.readForWrite();
            const orderInData = (dataObj.delivery_orders || []).find(
                (o) => o.id === record.id || o.code === record.id
            );
            const admin = (dataObj.users || []).find(
                (u) => u.role === 'admin' && u.status === 'active'
            );
            if (orderInData && admin && orderInData.status !== 'cancelled') {
                domain.cancelDeliveryOrder(
                    dataObj,
                    admin,
                    {
                        id: orderInData.id,
                        reason: text(data.STATUS_NAME, 500) || 'Viettel Post hủy vận đơn'
                    },
                    true
                );
            }
            db.saveAllData(dataObj, true);
            db.bumpRevision();
            d.exec('COMMIT');
        } catch (error) {
            if (d.isTransaction) d.exec('ROLLBACK');
            console.error('Không thể đảo ngược đơn giao hàng khi hãng hủy:', error.message);
            // Giữ trạng thái hủy ở bảng vận đơn (đã chốt) và không làm rơi webhook.
        }
        // Đồng bộ lại trạng thái cuối từ DB (đã được domain cập nhật).
        const finalRow = d.prepare('SELECT status FROM delivery_orders WHERE id=?').get(record.id);
        return {
            recorded: true,
            deliveryId: record.id,
            status: statusCode,
            finalStatus: finalRow?.status
        };
    }

    d.prepare('UPDATE delivery_orders SET status=?, updatedAt=? WHERE id=?').run(
        next.status,
        nowIso(),
        record.id
    );
    db.bumpRevision();
    return { recorded: true, deliveryId: record.id, status: statusCode };
}

module.exports = {
    enabled,
    processPendingTasks,
    scheduleDelivery,
    handleWebhook,
    applyStatus,
    mapVtpStatus
};
