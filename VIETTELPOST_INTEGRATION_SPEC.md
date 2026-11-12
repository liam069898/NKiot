# Đặc tả tích hợp Viettel Post vào POS NKiot

Trạng thái: **Bản thiết kế / chưa triển khai code.** Căn cứ tài liệu Viettel Post do
anh cung cấp tại `/Users/nhattran/Desktop/Viettel_Post_Toan_bo_tai_lieu_API_2026-11-09.html`
và kiến trúc NKiot hiện tại. Không mô tả endpoint hay trường ngoài tài liệu; các điểm
chưa rõ được đánh dấu **CẦN XÁC MINH** thay vì tự bịa.

## 1. Mục tiêu và phạm vi bản đầu

Cho phép bán hàng tại POS theo chế độ **Giao hàng qua Viettel Post**:

- Nhập người nhận, địa chỉ lấy hàng và địa chỉ giao.
- Tra dịch vụ và tính cước trước khi tạo vận đơn.
- Ghi nhận tiền nhận trước, tiền hàng thu hộ và bên trả cước.
- Tạo vận đơn, in nhãn, theo dõi trạng thái bằng webhook.
- Hủy/phát tiếp/duyệt hoàn theo quy tắc Viettel Post.
- Nhận hàng hoàn và đối soát COD thủ công có lịch sử.

**Chưa làm bản đầu:** chia một đơn thành nhiều chuyến, giao một phần/COD một phần,
đổi hàng hai chiều, nhiều hãng vận chuyển, giao quốc tế, tự đối soát COD qua API.

Nguyên tắc cố định:

- Không gọi API Viettel Post bên trong transaction SQLite đang khóa.
- Không trả token Viettel Post về trình duyệt, log, bản in hoặc yêu cầu webhook.
- Không tạo vận đơn trùng; timeout phải vào trạng thái “Chưa rõ kết quả”.
- Không ghi COD chưa thu là tiền đã nhận.
- Không tự trả hàng về tồn bán được khi chỉ nhận tín hiệu “đang hoàn”.
- Lỗi Viettel Post không làm mất đơn bán hoặc gây ghi kép tiền/tồn.

## 2. Mô hình trạng thái tách biệt

Đơn bán, vận chuyển và tiền không dùng chung một trạng thái.

### 2.1 Đơn bán (giữ nguyên bảng invoices)

Hiện `sale()` ghi `invoices` với `status: 'completed'`. Với đơn giao hàng:

| Trạng thái đề xuất | Ý nghĩa |
|---|---|
| `confirmed` | Đã xác nhận đơn và giữ hàng |
| `handed_over` | Đã bàn giao kiện cho đơn vị vận chuyển, đã xuất kho |
| `delivered` | Hãng xác nhận phát thành công |
| `returning` | Đang chuyển hoàn, hàng chưa về kho |
| `returned` | Cửa hàng đã nhận và kiểm tra hàng hoàn |
| `cancelled` | Hủy trước bàn giao; giải phóng hàng đã giữ |

Không đổi `invoices.status` có sẵn khi làm bản đầu; thêm bảng phụ ở mục 5. Giữ
`completed` cho bán tại quầy hiện tại để không làm vỡ báo cáo đang có.

### 2.2 Vận chuyển (theo trạng thái Viettel Post)

Ánh xạ cốt lõi từ tài liệu:

| VTP | Tên | Xử lý nội bộ |
|---:|---|---|
| 103 | Điều phối bưu cục lấy hàng | Chờ lấy hàng |
| 104 | Lấy hàng điều phối bưu tá | Chờ lấy hàng |
| 200 | Lấy hàng thành công | Đánh dấu đã bàn giao/xuất kho |
| 300/400 | Khai thác | Đang vận chuyển |
| 500 | Giao bưu tá đi phát | Đang giao |
| 501 | Phát thành công | Giao thành công; chưa là tiền đã về |
| 504 | Chuyển hoàn người gửi | Đang hoàn, chờ nhận kiểm |
| 506/507 | Phát thất bại | Theo dõi lý do; chưa tăng tồn |
| 505 | Yêu cầu chuyển hoàn | Chờ cửa hàng chọn hoàn/phát tiếp |
| 107 | Đối tác yêu cầu hủy | Đã hủy |
| 101/201 | Hủy bởi VTP | Đã hủy |
| 503 | Tiêu hủy theo yêu cầu | Kết thúc, xử lý nghiệp vụ riêng |

CẦN XÁC MINH: phần mô tả nói trạng thái cuối gồm 101/107/201/501/503/504 nhưng bảng
đánh dấu 104 là cuối. Triển khai theo trạng thái cuối do Viettel Post xác nhận trên
môi trường Development, không theo cả hai cùng lúc.

### 2.3 Thanh toán / COD

| Trạng thái | Ý nghĩa |
|---|---|
| `unpaid` | Chưa thu tiền hàng còn lại |
| `partial_prepaid` | Đã nhận trước một phần |
| `carrier_collected` | Hãng báo đã thu hộ |
| `awaiting_settlement` | Chờ hãng chuyển tiền |
| `settled` | Đã đối soát tiền về |
| `disputed` | Chênh lệch cần đối soát thủ công |

CẦN XÁC MINH: tài liệu này chưa có API đối soát/chuyển tiền COD. Bản đầu đối soát
thủ công, không giả định tự động.

## 3. Luồng POS

```text
Chọn hàng + IMEI
→ Chọn “Giao hàng”
→ Nhập người nhận (khác người mua nếu cần)
→ Tra dịch vụ khả dụng + tính cước
→ Kiểm tra tiền nhận trước / tiền hàng thu hộ / bên trả cước
→ “Xác nhận đơn & tạo vận đơn”
→ Lưu đơn giao hàng + yêu cầu tạo vận đơn
→ In nhãn
```

Nút cuối ghi rõ “Xác nhận đơn & tạo vận đơn”, không ghi “Thanh toán” khi tiền chưa
về. Nút chỉ tắt khi chưa đủ dữ liệu; không dùng `guardMutation` để xóa báo lỗi.

Khi tạo vận đơn lỗi/timeout, thông báo phải phân biệt:

- Đơn đã lưu, chưa có vận đơn.
- Đã gửi hãng nhưng chưa rõ kết quả.

Không để nhân viên tạo lại đơn bán hoặc vận đơn mới trước khi đối soát.

## 4. Tiền và cước

### 4.1 Ánh xạ ORDER_PAYMENT

Từ tài liệu:

| Giá trị | Nghĩa | Dùng khi |
|---:|---|---|
| 1 | Không thu hộ | Khách đã trả đủ tiền hàng và cước |
| 2 | Thu hộ tiền hàng + tiền cước | Người nhận trả cả hàng và cước |
| 3 | Thu hộ tiền hàng, không thu cước | Cửa hàng thanh toán cước với hãng |
| 4 | Thu hộ tiền cước, không thu tiền hàng | Hàng đã trả đủ, chỉ còn cước |

`MONEY_COLLECTION` là **tiền hàng cần thu hộ**, không gồm tiền cước. Không cộng cước
vào `MONEY_COLLECTION` rồi đồng thời chọn chế độ thu hộ cước, tránh thu khách hai lần.

### 4.2 Tách khoản tiền trong bảng phụ

Không gộp chung một trường “phí ship”:

1. `productTotal` — tiền hàng sau giảm giá.
2. `prepaid` — khách đã trả trước.
3. `codRequested` — tiền hàng yêu cầu thu hộ = productTotal − prepaid.
4. `carrierFee` — cước hãng báo.
5. `customerShippingFee` — phí giao cửa hàng thu khách (nếu dùng).
6. `codCollected` / `codSettled` — theo dõi hãng đã thu / đã về.

Ví dụ productTotal 2.000.000đ, prepaid 500.000đ → codRequested 1.500.000đ, không
cộng cước vào đây trừ khi chế độ `ORDER_PAYMENT` yêu cầu và được kiểm chứng.

## 5. Bảng dữ liệu đề xuất

Cấu trúc SQLite gắn với `ENTITY_TABLES` + `ROW_WRITERS`, hoặc bảng phụ riêng.
Đề xuất dùng bảng phụ để không ép thêm cột vào snapshot viết lại toàn bộ.

### 5.1 delivery_orders

Mỗi đơn giao hàng một dòng, tham chiếu `invoices.id`.

```text
id, invoiceId, branch, orderNumber, senderName, senderPhone, senderAddress,
senderProvinceId, senderDistrictId, senderWardId,
receiverName, receiverPhone, receiverAddress,
receiverProvinceId, receiverDistrictId, receiverWardId,
service, serviceAdd, paymentType, weightGram, productType, note,
productTotal, prepaid, codRequested, carrierFee, shippingFeeToCustomer,
shipmentCode, printCode, createdAt, updatedAt, cancelledAt
```

### 5.2 delivery_status_history

Mỗi sự kiện webhook một dòng, có idempotency.

```text
id, deliveryId, orderNumber, statusCode, statusName, statusDate,
reasonCode, note, rawEvent, receivedAt, processedAt
```

### 5.3 delivery_tasks

Hàng đợi tác vụ ngoài transaction (tạo vận đơn, hủy, tra cứu).

```text
id, deliveryId, action, payload, attempt, nextAttemptAt,
status (pending|running|done|unknown|failed), lastError, createdAt, updatedAt
```

`unknown` dùng cho timeout chưa biết hãng có nhận yêu cầu hay không.

### 5.4 delivery_cod_records

Theo dõi tiền COD theo chu kỳ đối soát.

```text
id, deliveryId, codRequested, codCollected, carrierFee, settlementAmount,
status, settledAt, note, createdAt, updatedAt
```

## 6. Thêm quyền

Thêm `shipping` trong `security.js`/permissions để tách khỏi `pos` và `invoices`:

- Tạo đơn giao hàng.
- Tra cước/dịch vụ.
- Hủy/phát tiếp/duyệt hoàn.
- Xác nhận nhận hàng hoàn và đối soát COD.

Không dùng quyền `settings` cho toàn bộ việc cấu hình hãng vận chuyển.

## 7. Cấu hình Viettel Post

Không lưu token trong mã hoặc gửi về UI:

```text
NKIOT_VTP_BASE_URL    = https://partnerdev.viettelpost.vn  (dev)
                     | https://partner.viettelpost.vn      (prod)
NKIOT_VTP_USERNAME / NKIOT_VTP_PASSWORD   (hoặc token dài hạn)
NKIOT_VTP_WEBHOOK_SECRET                  (kiểm nguồn gốc callback)
NKIOT_VTP_WEBHOOK_BASE_URL                (URL public nhận callback)
```

Lưu token trong cấu hình backend an toàn, làm mới chủ động trước khi hết hạn.
Token dài hạn theo tài liệu có thời hạn 1 năm; không coi là không bao giờ hết hạn.

## 8. Kết nối API

Header xác thực theo tài liệu là `Token`, không mặc định `Authorization: Bearer`.
Danh mục địa chỉ ưu tiên bản V3 hai cấp; CẦN XÁC MINH cách điền huyện khi API tạo
đơn/tính cước vẫn yêu cầu ba cấp.

Nên đóng gói trong module `viettelpost-client.js` (mẫu theo `hub-client.js`):

- `login()` / `ownerconnect()` — token.
- `provinces()` / `wards(provinceId)` — danh mục V3.
- `services(...)` / `price(...)` — getPriceAll/getPrice và bản NLP.
- `createOrder(payload)` — createOrder/createOrderNlp.
- `updateOrder(type, orderNumber, note)` — hủy/phát tiếp/duyệt hoàn.
- `printCodes(orderNumbers)` — lấy mã in, tự làm mới khi hết hạn.

## 9. Tạo vận đơn chống trùng

Dùng mã tham chiếu cố định từ NKiot:

```text
requestId → shipmentReference (ổn định qua các lần retry)
CHECK_UNIQUE = true
ORDER_NUMBER = shipmentReference
```

Lưu `shipmentReference` trong `delivery_orders`; `shipmentCode` chỉ ghi khi hãng trả về.
Khi timeout: giữ nguyên `shipmentReference`, chuyển `delivery_tasks.status = unknown`.
CẦN XÁC MINH API tra lại vận đơn theo mã tham chiếu; chưa có thì dùng đối soát thủ công.

## 10. Webhook

- Một URL cho tài khoản; phản hồi HTTP 200 trong dưới 1 giây.
- Lưu bền vững sự kiện trước khi xử lý nghiệp vụ.
- Idempotent theo `orderNumber + statusCode + statusDate` (và raw event nếu cần).
- Chấp nhận trạng thái đến trùng/trễ mà không ghi đè trạng thái mới hơn.
- Không tính báo cáo/đối soát COD ngay trong request.
- Xác minh token webhook trước khi lưu.

NKiot chạy local cần HTTPS public an toàn để nhận callback; không tự mở localhost.

## 11. Nhận hàng hoàn và COD

- Nhận hoàn: kiểm IMEI trùng khớp phiếu giao; chỉ khi đủ mới tăng tồn bán được.
- Hủy trước bàn giao: giải phóng số lượng/IMEI đã giữ, không ghi tiền.
- COD: cập nhật từ webhook, nhưng “đã về tài khoản” chỉ khi có bằng chứng đối soát.

## 12. Kiểm thử nghiệm thu

1. Hai nhân viên chọn cùng IMEI trong hai đơn giao.
2. Bấm “Xác nhận đơn & tạo vận đơn” hai lần liên tiếp.
3. Tạo vận đơn timeout sau khi hãng đã nhận.
4. Webhook trùng, đến sai thứ tự, gửi sau trạng thái cuối.
5. Giao thất bại/đang hoàn nhưng hàng chưa về kho.
6. COD thực nhận lệch dự kiến.
7. Token hết hạn giữa phiên làm việc.
8. Khách trả đủ/trả trước/trả sau ở từng chế độ ORDER_PAYMENT.
9. Hủy ở từng khoảng trạng thái (< 200, 107, sau khi hãng nhận).
10. In nhãn với nhiều vận đơn, mã in hết hạn.

## 13. Trình tự triển khai

1. Đặc tả này được duyệt; xác minh các điểm CẦN XÁC MINH trên dev.
2. Cấu hình + module `viettelpost-client.js` + test mock hợp đồng.
3. Bảng dữ liệu + migration + quyền `shipping`.
4. Domain: tạo đơn giao, giữ hàng/IMEI, hủy trước bàn giao.
5. Hàng đợi tạo vận đơn + webhook + lịch sử trạng thái.
6. POS: chế độ giao hàng + tính cước + xác nhận + in nhãn.
7. Sau bán: hoàn hàng + đối soát COD.
8. Chạy `npm run verify` và nghiệm thu trên dev trước khi mở production.