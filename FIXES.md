# Trạng thái sửa lỗi sau review — 27/10/2026

Đối chiếu các phát hiện trong `CODE_REVIEW.md` và đợt rà soát toàn diện hệ thống NKiot (Backend, Multi-tenant Hub, Security, POS Business Logic, Frontend UI).

| Lĩnh vực | Phát hiện & Nguy cơ | Giải pháp & Thay đổi đã thực hiện |
| --- | --- | --- |
| 1. API/mật khẩu | Đăng nhập server-side, scrypt, cookie HttpOnly/SameSite, phân quyền chi nhánh. Mật khẩu fallback admin-server trước đây hardcode `admin1234`. | Replaced fallback password trong `admin-server.js` bằng `crypto.randomBytes(16).toString('base64url')` sinh ngẫu nhiên và in 1 lần duy nhất lúc khởi động khi thiếu biến môi trường. Không trả password/hash ra API. |
| 2. File upload & Rò rỉ backup | `/api/upload-media` chỉ tin cậy MIME header do client gửi; `/api/backup` trên admin-server có nguy cơ đọng lại file `.bak` tạm nếu client ngắt kết nối giữa chừng. Giới hạn body 8MB có thể lỗi khi upload video/ảnh 10MB base64. | Thêm kiểm tra **Magic Bytes** (JPEG, PNG, GIF, WEBP, MP4/MOV, WEBM) trong `server.js`, từ chối file giả mạo MIME. Nâng `MAX_BODY` lên 16MB. Trong `admin-server.js`, gắn dọn dẹp file `.bak` tự động trên `res.on('finish')`, `res.on('close')`, và `stream.on('error')`. |
| 3. Stored XSS | Một số vị trí innerHTML chưa bọc escape hoặc render template an toàn: video preview (`updateVideoPreview`), nhãn serial active (`activeImeiBanner`), bảng nhập hàng (`renderImportItemsTable`), token nút bấm liên kết Hub (`renderHTML`). | Chuẩn hóa `updateVideoPreview` chỉ chấp nhận giao thức `http:`, `https:` hoặc `/uploads/`, escape thuộc tính thẻ. Sử dụng tag template an toàn `renderHTML` cho bảng nhập hàng (sản phẩm thường & serial), escape nhãn IMEI và toàn bộ action buttons đối tác Hub. |
| 4. CSV Formula Injection | Xuất file báo cáo và danh sách (`app-reports.js`, `app-export.js`) xuất trực tiếp dữ liệu dạng text/csv, người dùng chèn `=CMD()`, `+`, `-`, `@`, `\t` có thể kích hoạt thực thi mã độc trong Excel/Calc. | Bổ sung hàm phòng vệ công thức: tự động thêm dấu nháy đơn `'` phía trước mọi ô bắt đầu bằng ký tự nguy hiểm (`/^[=+\-@\t\r]/`). |
| 5. Quản lý serial IMEI | Hủy phiếu nhập hàng (`cancelImport`) xóa serial khỏi `p.imeis` nhưng còn tồn đọng metadata trong dictionary `p.imeiDetails`. | Cập nhật `domain.js`: tự động dọn dẹp các key serial tương ứng trong `p.imeiDetails` khi hủy phiếu nhập, ngăn chặn tích lũy serial rác và dữ liệu giá vốn cũ. |
| 6. Đồng bộ trạng thái Hub / Tenant | Thao tác hủy liên kết đối tác tại `admin-provision.js` đặt trạng thái chưa đồng nhất với `hub-server.js`. | Đồng nhất trạng thái hủy liên kết đối tác thành `'inactive'` trên cả `admin-provision.js` và `hub-server.js`. |
| 7. Ghi đè & Snapshot SQLite | Transaction `BEGIN IMMEDIATE`, revision, request token chống xử lý lặp, nhật ký thao tác. | Đã xác thực cơ chế rebase sequence outbox độc lập, rebase sequence tenant sau phục hồi backup, và cơ chế journal `DELETE`/`synchronous FULL` an toàn trên ổ đĩa mạng SMB. |

## Kiểm chứng chất lượng & kiểm thử tự động

- `npm run format:check`: Đạt 100% chuẩn định dạng Prettier trên toàn bộ source code JS, tests và scripts.
- `npm run check`: Cú pháp **37 file JavaScript** kiểm tra thành công, không có lỗi.
- `node --test`: **101/101 test case ĐẠT (100% pass)**:
  - `tests/backend.test.js`: **52 test** (bổ sung test kiểm tra dọn dẹp `imeiDetails` khi hủy nhập và test từ chối upload sai magic bytes).
  - `tests/admin-provision.test.js`, `tests/shared-warehouse.test.js`, `tests/hub.test.js`: **12 test** (kiểm thử provisioning đa chi nhánh, liên kết kho đối tác và Hub).
  - `tests/migration.test.js`, `tests/hub-sync.test.js`: **4 test** (kiểm thử nâng cấp schema legacy, sequence outbox và rebase sequence hub).
  - `tests/code-generation.test.js`, `tests/integration.test.js`: **12 test** (kiểm thử sinh mã tự tăng NKiot, luồng bán hàng POS thực tế, xử lý nợ, trả hàng serial, idempotency retry và chống ghi đè phiên).
  - `tests/ui.test.js`: **21 test** (kiểm thử bảo mật XSS giao diện, render template an toàn).

## Khuyến nghị kiến trúc giai đoạn tiếp theo

1. **Phân tách mô-đun frontend (`app.js`)**: `app.js` hiện có dung lượng lớn (~465 KB, >10.000 dòng). Nên tách thành các file chuyên biệt theo nghiệp vụ: `app-pos.js`, `app-inventory.js`, `app-catalog.js` tương tự như `app-reports.js` và `app-export.js`.
2. **Phân trang dữ liệu lịch sử**: `getAllData()` đọc toàn bộ 14 bảng vào bộ nhớ cho mỗi phiên làm việc. Với các cửa hàng bán lẻ quy mô trên 30.000 hóa đơn, cần chuyển dần các bảng lịch sử phát sinh (`invoices`, `importNotes`, `cashFlow`) sang truy vấn SQL có phân trang (cursor/LIMIT).
