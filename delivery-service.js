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

// Dựng payload tính cước từ delivery_orders (dùng cho việc chọn dịch vụ khả dụng).
function buildPricePayload(record) {
    const cod = record.paymentType === 3 || record.paymentType === 2;
    return {
        SENDER_ADDRESS: vtp.bytes(record.senderAddress, 150),
        RECEIVER_ADDRESS: vtp.bytes(record.receiverAddress, 150),
        PRODUCT_TYPE: record.productType || 'HH',
        PRODUCT_WEIGHT: Number(record.weightGram) || 50,
        PRODUCT_PRICE: Math.max(0, Number(record.productTotal) || 0),
        MONEY_COLLECTION: cod ? Number(record.codRequested) || 0 : 0,
        TYPE: 1
    };
}

// Trả danh sách dịch vụ khả dụng cho một tuyến (dùng cho POS chọn dịch vụ).
async function listServices(input) {
    return vtp.availableServices({
        SENDER_ADDRESS: vtp.bytes(input?.senderAddress, 150),
        RECEIVER_ADDRESS: vtp.bytes(input?.receiverAddress, 150),
        PRODUCT_TYPE: input?.productType === 'TH' ? 'TH' : 'HH',
        PRODUCT_WEIGHT: Number(input?.weightGram) || 50,
        PRODUCT_PRICE: Math.max(0, Number(input?.productTotal) || 0),
        MONEY_COLLECTION: Math.max(0, Number(input?.codRequested) || 0),
        TYPE: 1
    });
}

// Chọn mã dịch vụ hợp lệ cho tuyến: giữ dịch vụ đang chọn nếu hãng chấp nhận,
// ngược lại lấy dịch vụ rẻ nhất trong danh sách khả dụng.
async function resolveService(record) {
    let services;
    try {
        // buildPricePayload đã trả payload đúng định dạng Viettel Post (key chữ hoa),
        // nên gọi thẳng availableServices thay vì listServices (nhận input chữ thường).
        services = await vtp.availableServices(buildPricePayload(record));
    } catch (error) {
        // Lỗi mạng: không kết luận được, để lần thử sau xử lý.
        throw Object.assign(error, { network: true });
    }
    const wanted = String(record.service || '').trim();
    if (wanted && services.some((s) => s.code === wanted)) return wanted;
    if (!services.length) return '';
    return services.slice().sort((a, b) => a.price - b.price)[0].code;
}

// Đảo ngược chứng từ bán khi hãng/cửa hàng hủy vận đơn trước bàn giao:
// hoàn kho, IMEI, tiền cọc, công nợ. Dùng chung cho webhook và thao tác hủy qua hãng.
function cancelWithReversal(orderId, reason) {
    const d = db.getDb();
    const domain = require('./domain');
    d.exec('BEGIN IMMEDIATE');
    try {
        const dataObj = db.readForWrite();
        const orderInData = (dataObj.delivery_orders || []).find(
            (o) => o.id === orderId || o.code === orderId
        );
        const admin = (dataObj.users || []).find(
            (u) => u.role === 'admin' && u.status === 'active'
        );
        if (orderInData && admin && orderInData.status !== 'cancelled') {
            domain.cancelDeliveryOrder(
                dataObj,
                admin,
                { id: orderInData.id, reason: reason || 'Hủy vận đơn Viettel Post' },
                true
            );
        }
        db.saveAllData(dataObj, true);
        db.bumpRevision();
        d.exec('COMMIT');
    } catch (error) {
        if (d.isTransaction) d.exec('ROLLBACK');
        throw error;
    }
}

// Loại cập nhật theo tài liệu UpdateOrder.
const VTP_ACTIONS = {
    approve: 1, // duyệt đơn hàng
    approve_return: 2, // duyệt hoàn (khi hãng báo 505)
    redeliver: 3, // phát tiếp (khi hãng báo 505)
    cancel: 4, // hủy đơn (chỉ khi hãng chưa lấy hàng)
    delete: 5 // xóa đơn đã hủy
};

// Xếp hành động cập nhật trạng thái vận đơn qua hãng vào hàng đợi worker.
// Không gọi API trong transaction SQLite; worker sẽ gọi và cập nhật lại chứng từ.
function enqueueOrderAction(deliveryId, action, note = '') {
    const type = VTP_ACTIONS[action];
    if (!type) return { ok: false, reason: 'unknown_action' };
    const d = db.getDb();
    const order = d
        .prepare('SELECT * FROM delivery_orders WHERE id=? OR code=?')
        .get(deliveryId, deliveryId);
    if (!order) return { ok: false, reason: 'unknown_order' };
    if (order.carrierType === 'self') return { ok: false, reason: 'self_delivery' };
    if (!order.shipmentCode) return { ok: false, reason: 'no_shipment_code' };

    // Điều kiện theo tài liệu: hủy chỉ khi hãng chưa lấy hàng (ORDER_STATUS < 200).
    if (action === 'cancel' && order.status !== 'submitted')
        return { ok: false, reason: 'not_cancellable' };
    if (['approve_return', 'redeliver'].includes(action) && order.status !== 'returning')
        return { ok: false, reason: 'not_returning' };
    if (action === 'delete' && order.status !== 'cancelled')
        return { ok: false, reason: 'not_cancelled' };

    const pending = d
        .prepare(
            "SELECT 1 FROM delivery_tasks WHERE deliveryId=? AND action='update_order' AND status IN ('pending','running')"
        )
        .get(order.id);
    if (pending) return { ok: false, reason: 'action_pending' };

    const now = nowIso();
    d.prepare(
        `INSERT INTO delivery_tasks (id, deliveryId, action, payload, attempt, nextAttemptAt, status, lastError, createdAt, updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(
        `VTP-ACT-${order.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        order.id,
        'update_order',
        JSON.stringify({ type, action, note: text(note, 200) }),
        0,
        Date.now(),
        'pending',
        '',
        now,
        now
    );
    db.bumpRevision();
    return { ok: true, type };
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
    if (!record) {
        finishTask(task.id, { status: 'done' });
        return;
    }
    if (task.action === 'update_order') {
        await processOrderAction(task, record);
        return;
    }
    if (task.action === 'edit_order') {
        await processOrderEdit(task, record);
        return;
    }
    if (record.status !== 'confirmed') {
        finishTask(task.id, { status: 'done' });
        return;
    }
    if (task.action !== 'create_order') {
        finishTask(task.id, { status: 'failed', lastError: `Không hỗ trợ action ${task.action}.` });
        return;
    }
    try {
        // Chọn dịch vụ khả dụng cho tuyến trước khi tạo đơn: tránh lỗi
        // "Price does not apply to this itinerary!" do dịch vụ không áp dụng tuyến.
        const resolved = await resolveService(record);
        if (!resolved) {
            const err = new Error(
                'Viettel Post không có dịch vụ vận chuyển cho tuyến này. Kiểm tra lại địa chỉ gửi/nhận.'
            );
            err.permanent = true;
            throw err;
        }
        if (resolved !== record.service) {
            d.prepare('UPDATE delivery_orders SET service=?, updatedAt=? WHERE id=?').run(
                resolved,
                nowIso(),
                record.id
            );
            record.service = resolved;
            db.bumpRevision();
        }
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
        // Lỗi không thể tự khỏi (ví dụ tuyến không có dịch vụ): đánh dấu thất bại ngay để
        // nhân viên sửa địa chỉ/dịch vụ rồi bấm "Tạo lại vận đơn", tránh retry vô ích.
        if (error.permanent) {
            finishTask(task.id, { status: 'failed', lastError: detail });
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

// Xử lý hành động cập nhật trạng thái vận đơn qua hãng (UpdateOrder TYPE 1–5).
async function processOrderAction(task, record) {
    let payload = {};
    try {
        payload = JSON.parse(task.payload || '{}');
    } catch {}
    const type = Number(payload.type);
    const attempt = (Number(task.attempt) || 0) + 1;
    if (![1, 2, 3, 4, 5].includes(type)) {
        finishTask(task.id, {
            status: 'failed',
            lastError: 'Loại cập nhật vận đơn không hợp lệ.'
        });
        return;
    }
    if (!record.shipmentCode) {
        finishTask(task.id, {
            status: 'failed',
            lastError: 'Đơn chưa có mã vận đơn Viettel Post để cập nhật.'
        });
        return;
    }
    try {
        await vtp.updateOrder(type, record.shipmentCode, text(payload.note, 150));
        if (type === 4) {
            // Hãng đã xác nhận hủy: đảo chứng từ ngay để kho/tiền không bị treo,
            // không phụ thuộc webhook (webhook 107 đến sau sẽ bị bỏ qua do đã hủy).
            try {
                cancelWithReversal(record.id, payload.note || 'Hủy vận đơn qua Viettel Post');
            } catch (error) {
                console.error('Không đảo được chứng từ khi hủy qua hãng:', error.message);
            }
        }
        finishTask(task.id, { status: 'done' });
    } catch (error) {
        const detail = String(error.message || error).slice(0, 500);
        if (error.network) {
            finishTask(task.id, {
                status: 'unknown',
                lastError: detail,
                nextAttemptAt: attempt < MAX_NETWORK_RETRY ? Date.now() + RETRY_MS : null
            });
            return;
        }
        finishTask(task.id, {
            status: attempt < MAX_CREATE_ORDER_RETRY ? 'unknown' : 'failed',
            lastError: detail,
            nextAttemptAt: attempt < MAX_CREATE_ORDER_RETRY ? Date.now() + RETRY_MS : null
        });
    }
}

// Xử lý yêu cầu sửa thông tin đơn trên hệ thống hãng (A3).
async function processOrderEdit(task, record) {
    let patch = {};
    try {
        patch = JSON.parse(task.payload || '{}');
    } catch {}
    const attempt = (Number(task.attempt) || 0) + 1;
    const fail = (message) => finishTask(task.id, { status: 'failed', lastError: message });
    if (!record.shipmentCode) return fail('Đơn chưa có mã vận đơn Viettel Post để sửa.');
    if (record.status !== 'submitted')
        return fail('Chỉ sửa được đơn hãng chưa lấy hàng (đã gửi hãng).');
    if (!patch || !Object.keys(patch).length) return fail('Không có thông tin cần cập nhật.');
    try {
        await vtp.editOrder(buildEditPayload({ ...record, ...patch }));
        const fields = Object.keys(patch);
        db.getDb()
            .prepare(
                `UPDATE delivery_orders SET ${fields.map((k) => `${k}=?`).join(',')}, updatedAt=? WHERE id=?`
            )
            .run(...fields.map((k) => patch[k]), nowIso(), record.id);
        finishTask(task.id, { status: 'done' });
    } catch (error) {
        const detail = String(error.message || error).slice(0, 500);
        if (error.network) {
            finishTask(task.id, {
                status: 'unknown',
                lastError: detail,
                nextAttemptAt: attempt < MAX_NETWORK_RETRY ? Date.now() + RETRY_MS : null
            });
            return;
        }
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
        // Lưu kèm chi tiết hành trình (C2) và ảnh giao hàng POD nếu hãng gửi.
        const pods = Array.isArray(data.POD?.IMAGES) ? data.POD.IMAGES.filter(Boolean) : [];
        // C3: gộp lý do phát thất bại (mã 20–47) vào ghi chú để hiển thị tiếng Việt.
        const reasonText = failureReasonText(data.REASON_CODE);
        const noteText = [text(data.NOTE, 300), reasonText].filter(Boolean).join(' — ');
        d.prepare(
            `INSERT INTO delivery_status_history
             (id, deliveryId, orderNumber, statusCode, statusName, statusDate, reasonCode, note, receivedAt, processedAt,
              location, employeeName, employeePhone, expectedDelivery, podImages)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).run(
            id,
            record.id,
            text(data.ORDER_NUMBER, 200),
            statusCode,
            text(data.STATUS_NAME, 200),
            statusDate,
            data.REASON_CODE != null ? text(String(data.REASON_CODE), 50) : null,
            text(noteText, 500),
            nowIso(),
            nowIso(),
            text(data.LOCATION_CURRENTLY || data.LOCALION_CURRENTLY, 500),
            text(data.EMPLOYEE_NAME, 120),
            text(data.EMPLOYEE_PHONE, 40),
            text(data.EXPECTED_DELIVERY, 200),
            pods.length ? JSON.stringify(pods.slice(0, 10)) : ''
        );
    }
    // C1: đối soát COD theo số tiền hãng báo đã thu. Chỉ ghi nhận "hãng đã thu",
    // KHÔNG coi là đã về tài khoản; đối soát tiền về vẫn do cửa hàng xác nhận.
    if (!already) reconcileCod(record.id, data);
    const next = applyStatus({ ...record }, statusCode);
    if (next.status === record.status)
        return { recorded: true, deliveryId: record.id, status: statusCode, unchanged: true };

    // Khi hãng xác nhận hủy (101/107/201) trước bàn giao, đảo ngược luôn chứng từ bán gốc
    // (hoàn kho, IMEI, tiền cọc, công nợ) để tránh hóa đơn "mồ côi" còn trừ kho/giữ doanh thu.
    if (next.status === 'cancelled') {
        try {
            cancelWithReversal(record.id, text(data.STATUS_NAME, 500));
        } catch (error) {
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

// Cho phép nhân viên yêu cầu tạo lại vận đơn sau khi sửa lỗi (ví dụ đã nhập địa chỉ người gửi).
// Đặt lại task create_order failed về pending để worker thử lại, không chạm đến chứng từ bán.
function requeueCreateOrderTask(deliveryId) {
    const d = db.getDb();
    const order = d
        .prepare('SELECT * FROM delivery_orders WHERE id=? OR code=?')
        .get(deliveryId, deliveryId);
    if (!order) return { ok: false, reason: 'unknown_order' };
    if (order.status !== 'confirmed') return { ok: false, reason: 'not_confirmed' };
    const task = d
        .prepare(
            `SELECT * FROM delivery_tasks
             WHERE deliveryId=? AND action='create_order'
             ORDER BY rowid DESC LIMIT 1`
        )
        .get(order.id);
    if (!task) {
        // Không có task (hiếm gặp): tạo mới.
        const now = nowIso();
        d.prepare(
            `INSERT INTO delivery_tasks (id, deliveryId, action, payload, attempt, nextAttemptAt, status, lastError, createdAt, updatedAt)
             VALUES (?,?,?,?,?,?,?,?,?,?)`
        ).run(
            `VTP-${order.id}`,
            order.id,
            'create_order',
            '{}',
            0,
            Date.now(),
            'pending',
            '',
            now,
            now
        );
    } else if (task.status === 'failed' || task.status === 'unknown') {
        d.prepare(
            `UPDATE delivery_tasks SET status='pending', attempt=0, lastError='', nextAttemptAt=?, updatedAt=? WHERE id=?`
        ).run(Date.now(), nowIso(), task.id);
    } else {
        return { ok: false, reason: 'task_not_retryable' };
    }
    db.bumpRevision();
    return { ok: true };
}

// ===== A1: In nhãn chính thức của Viettel Post =====
// Hãng trả mã in (printing-code) có hạn; nhãn in là link DigitalizePrint kèm mã in đó.
const LABEL_HOST_DEV = 'https://dev-release-print.viettelpost.vn';
const LABEL_HOST_PROD = 'https://digitalize.viettelpost.vn';
const LABEL_TYPES = { A5: '1', A6: '2', A6_1: 'a6_1', A7: '100', A7_1: '1001' };
const LABEL_TTL_MS = 15 * 60 * 1000;

// Trả link in nhãn chính thức cho một vận đơn. Mã in được lưu lại tới khi hết hạn
// để in nhiều lần không phải gọi hãng lại.
async function labelUrl(orderId, { size = 'A5', showPostage = 0 } = {}) {
    const d = db.getDb();
    const order = d
        .prepare('SELECT * FROM delivery_orders WHERE id=? OR code=?')
        .get(orderId, orderId);
    if (!order) {
        const error = new Error('Không tìm thấy vận đơn.');
        error.status = 404;
        throw error;
    }
    if (!order.shipmentCode) {
        const error = new Error('Đơn chưa có mã vận đơn Viettel Post nên chưa in nhãn được.');
        error.status = 409;
        throw error;
    }
    const now = Date.now();
    let printCode = order.printCode || '';
    let expiresAt = Number(order.printExpiresAt) || 0;
    if (!printCode || !expiresAt || expiresAt <= now) {
        const nextExpiry = now + LABEL_TTL_MS;
        const res = await vtp.printingCode([order.shipmentCode], nextExpiry);
        printCode = typeof res?.message === 'string' ? res.message.trim() : '';
        if (!printCode) {
            const error = new Error('Viettel Post không trả mã in vận đơn.');
            error.status = 502;
            throw error;
        }
        expiresAt = nextExpiry;
        d.prepare(
            'UPDATE delivery_orders SET printCode=?, printExpiresAt=?, updatedAt=? WHERE id=?'
        ).run(printCode, expiresAt, nowIso(), order.id);
        db.bumpRevision();
    }
    const host = /partnerdev/i.test(vtp.currentBaseUrl()) ? LABEL_HOST_DEV : LABEL_HOST_PROD;
    const type = LABEL_TYPES[String(size).toUpperCase()] || LABEL_TYPES.A5;
    const url = `${host}/DigitalizePrint/report.do?type=${encodeURIComponent(type)}&bill=${encodeURIComponent(printCode)}&showPostage=${showPostage ? 1 : 0}`;
    return { url, expiresAt, printCode };
}

// ===== C3: Lý do phát thất bại theo bảng của Viettel Post =====
const VTP_FAILURE_REASONS = {
    20: 'Khách từ chối nhận: sai màu sắc',
    21: 'Khách từ chối nhận: sai kích thước',
    22: 'Khách từ chối nhận: sai kiểu dáng',
    23: 'Khách từ chối nhận: chất lượng kém',
    25: 'Khách từ chối nhận: sai số lượng',
    26: 'Khách từ chối nhận: sai tiền thu hộ',
    27: 'Sai định dạng số điện thoại người nhận',
    30: 'Khách hàng không có nhu cầu nhận hàng',
    31: 'Khách hàng không đặt đơn',
    32: 'Khách từ chối nhận: sai địa chỉ',
    35: 'Người nhận hẹn phát lại',
    36: 'Không liên lạc được khách hàng nhận',
    37: 'Bưu tá hẹn phát lại',
    38: 'Khách hàng đến bưu cục nhận',
    43: 'Người gửi yêu cầu chuyển hoàn',
    46: 'Phát thất bại nhiều lần: người nhận hẹn phát lại',
    47: 'Phát thất bại nhiều lần: không liên lạc được'
};
function failureReasonText(code) {
    if (code === null || code === undefined || code === '') return '';
    return VTP_FAILURE_REASONS[String(code).trim()] || '';
}

// ===== C1: Đối soát COD từ webhook =====
// Chỉ ghi nhận "hãng đã thu" và cảnh báo lệch; KHÔNG tự coi là tiền đã về tài khoản.
function reconcileCod(deliveryId, data) {
    const d = db.getDb();
    const rec = d.prepare('SELECT * FROM delivery_cod_records WHERE deliveryId=?').get(deliveryId);
    if (!rec || ['settled', 'cancelled'].includes(rec.status)) return;
    const expected = Number(rec.codRequested) || 0;
    const collected = Number(data.MONEY_COLLECTION);
    if (!expected || !Number.isFinite(collected) || collected <= 0) return;
    const now = nowIso();
    const status = collected >= expected ? 'carrier_collected' : 'disputed';
    const note =
        collected >= expected
            ? `Hãng báo đã thu ${collected}đ (dự kiến ${expected}đ). Chờ tiền về tài khoản để đối soát.`
            : `Hãng thu ${collected}đ, thiếu ${expected - collected}đ so với dự kiến ${expected}đ.`;
    d.prepare(
        'UPDATE delivery_cod_records SET codCollected=?, status=?, note=?, updatedAt=? WHERE id=?'
    ).run(collected, status, text(note, 500), now, rec.id);
    // codStatus nằm trong cột `extra` (JSON) của delivery_orders, không phải cột riêng.
    const row = d.prepare('SELECT extra FROM delivery_orders WHERE id=?').get(deliveryId);
    if (row) {
        let extra = {};
        try {
            extra = JSON.parse(row.extra || '{}');
        } catch {}
        extra.codStatus = status;
        d.prepare('UPDATE delivery_orders SET extra=?, updatedAt=? WHERE id=?').run(
            JSON.stringify(extra),
            now,
            deliveryId
        );
    }
    db.bumpRevision();
}

// ===== A3: Sửa thông tin vận đơn đã gửi hãng =====
const EDITABLE_FIELDS = [
    'receiverName',
    'receiverPhone',
    'receiverAddress',
    'note',
    'weightGram',
    'codRequested'
];

function buildEditPayload(record) {
    const cod = record.paymentType === 3 || record.paymentType === 2;
    const items = Array.isArray(record.items) ? record.items : [];
    const totalQty = items.reduce((n, it) => n + (Number(it.qty) || 0), 0);
    return {
        ORDER_NUMBER: record.shipmentCode,
        SENDER_FULLNAME: vtp.bytes(record.senderName, 150),
        SENDER_PHONE: vtp.bytes(record.senderPhone, 20),
        SENDER_ADDRESS: vtp.bytes(record.senderAddress, 150),
        RECEIVER_FULLNAME: vtp.bytes(record.receiverName, 150),
        RECEIVER_PHONE: vtp.bytes(record.receiverPhone, 20),
        RECEIVER_ADDRESS: vtp.bytes(record.receiverAddress, 150),
        PRODUCT_NAME: vtp.bytes(
            items.length === 1 ? items[0].name || items[0].code : 'Hàng hóa',
            150
        ),
        PRODUCT_QUANTITY: totalQty || 1,
        PRODUCT_PRICE: Math.max(0, Number(record.productTotal) || 0),
        PRODUCT_WEIGHT: Number(record.weightGram) || 50,
        ORDER_PAYMENT: record.paymentType || 1,
        ORDER_SERVICE: vtp.bytes(record.service || '', 20),
        ORDER_SERVICE_ADD: vtp.bytes(record.serviceAdd || '', 20),
        MONEY_COLLECTION: cod ? Number(record.codRequested) || 0 : 0,
        ORDER_NOTE: vtp.bytes(record.note || '', 150),
        PRODUCT_TYPE: record.productType || 'HH'
    };
}

// Xếp yêu cầu sửa vận đơn (chỉ khi hãng chưa lấy hàng).
function enqueueOrderEdit(deliveryId, changes = {}) {
    const d = db.getDb();
    const order = d
        .prepare('SELECT * FROM delivery_orders WHERE id=? OR code=?')
        .get(deliveryId, deliveryId);
    if (!order) return { ok: false, reason: 'unknown_order' };
    if (order.carrierType === 'self') return { ok: false, reason: 'self_delivery' };
    if (!order.shipmentCode) return { ok: false, reason: 'no_shipment_code' };
    if (order.status !== 'submitted') return { ok: false, reason: 'not_editable' };
    const patch = {};
    for (const key of EDITABLE_FIELDS) {
        if (changes[key] === undefined || changes[key] === '') continue;
        if (key === 'weightGram' || key === 'codRequested') {
            const n = Number(changes[key]);
            if (!Number.isFinite(n) || n < 0) return { ok: false, reason: 'invalid_value' };
            patch[key] = Math.round(n);
        } else {
            patch[key] = text(String(changes[key]), 200).trim();
        }
    }
    if (!Object.keys(patch).length) return { ok: false, reason: 'nothing_to_change' };
    const pending = d
        .prepare(
            "SELECT 1 FROM delivery_tasks WHERE deliveryId=? AND action IN ('edit_order','update_order') AND status IN ('pending','running')"
        )
        .get(order.id);
    if (pending) return { ok: false, reason: 'action_pending' };
    const now = nowIso();
    d.prepare(
        `INSERT INTO delivery_tasks (id, deliveryId, action, payload, attempt, nextAttemptAt, status, lastError, createdAt, updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(
        `VTP-EDIT-${order.id}-${Date.now()}`,
        order.id,
        'edit_order',
        JSON.stringify(patch),
        0,
        Date.now(),
        'pending',
        '',
        now,
        now
    );
    db.bumpRevision();
    return { ok: true, fields: Object.keys(patch) };
}

// ===== A4: Tính cước một dịch vụ cụ thể (kèm dịch vụ cộng thêm) =====
async function quoteService(input) {
    const res = await vtp.getPriceNlp({
        SENDER_ADDRESS: vtp.bytes(input?.senderAddress, 150),
        RECEIVER_ADDRESS: vtp.bytes(input?.receiverAddress, 150),
        PRODUCT_TYPE: input?.productType === 'TH' ? 'TH' : 'HH',
        PRODUCT_WEIGHT: Number(input?.weightGram) || 50,
        PRODUCT_PRICE: Math.max(0, Number(input?.productTotal) || 0),
        MONEY_COLLECTION: Math.max(0, Number(input?.codRequested) || 0),
        ORDER_SERVICE: vtp.bytes(input?.service || '', 20),
        ORDER_SERVICE_ADD: vtp.bytes(input?.serviceAdd || '', 20),
        NATIONAL_TYPE: 1
    });
    const data = res?.data && typeof res.data === 'object' ? res.data : res || {};
    return {
        price: Number(data.MONEY_TOTAL ?? data.MONEY_TOTAL_FEE ?? 0) || 0,
        fee: Number(data.MONEY_TOTAL_FEE ?? 0) || 0,
        vat: Number(data.MONEY_VAT ?? 0) || 0,
        collectionFee: Number(data.MONEY_COLLECTION_FEE ?? 0) || 0,
        etaHours: data.KPI_HT ?? null
    };
}

// ===== D4: In nhãn hàng loạt (tối đa 100 vận đơn/lần) =====
async function batchLabelUrl(orderIds, { size = 'A5', showPostage = 0 } = {}) {
    const d = db.getDb();
    const ids = [...new Set((Array.isArray(orderIds) ? orderIds : []).map(String))].slice(0, 100);
    const orders = [];
    for (const id of ids) {
        const o = d
            .prepare('SELECT id, shipmentCode FROM delivery_orders WHERE id=? OR code=?')
            .get(id, id);
        if (o && o.shipmentCode) orders.push(o);
    }
    if (!orders.length) {
        const error = new Error('Không có vận đơn nào đã có mã để in.');
        error.status = 409;
        throw error;
    }
    const expiresAt = Date.now() + LABEL_TTL_MS;
    const res = await vtp.printingCode(
        orders.map((o) => o.shipmentCode),
        expiresAt
    );
    const printCode = typeof res?.message === 'string' ? res.message.trim() : '';
    if (!printCode) {
        const error = new Error('Viettel Post không trả mã in vận đơn.');
        error.status = 502;
        throw error;
    }
    const now = nowIso();
    for (const o of orders)
        d.prepare(
            'UPDATE delivery_orders SET printCode=?, printExpiresAt=?, updatedAt=? WHERE id=?'
        ).run(printCode, expiresAt, now, o.id);
    db.bumpRevision();
    const host = /partnerdev/i.test(vtp.currentBaseUrl()) ? LABEL_HOST_DEV : LABEL_HOST_PROD;
    const type = LABEL_TYPES[String(size).toUpperCase()] || LABEL_TYPES.A5;
    return {
        url: `${host}/DigitalizePrint/report.do?type=${encodeURIComponent(type)}&bill=${encodeURIComponent(printCode)}&showPostage=${showPostage ? 1 : 0}`,
        count: orders.length,
        expiresAt
    };
}

module.exports = {
    enabled,
    processPendingTasks,
    scheduleDelivery,
    handleWebhook,
    applyStatus,
    mapVtpStatus,
    listServices,
    enqueueOrderAction,
    enqueueOrderEdit,
    quoteService,
    batchLabelUrl,
    labelUrl,
    failureReasonText,
    requeueCreateOrderTask
};
