# Plugin Kho hàng NKiot cho Deplao

Tra cứu tên, mô tả, giá và ảnh thực tế từng máy từ NKiot ngay trong Deplao. Plugin
**chỉ đọc** dữ liệu và chèn nội dung vào ô soạn; nó **không tự gửi tin** cho khách.

## Kiến trúc tin cậy

- API token NKiot (`nk_live_...`) **không bao giờ** đi qua giao diện hoặc settings của plugin.
  Backend đọc token từ biến môi trường của tiến trình Deplao.
- UI gọi `backend.call('search' | 'image')`; chỉ backend mới thấy token và gọi NKiot.
- Backend chặn redirect, giới hạn kích thước ảnh và chỉ nhận đường dẫn media hợp lệ
  dạng `/api/v1/open/media/<64 hex>`.

## Chuẩn bị phía NKiot

1. Đăng nhập NKiot bằng tài khoản quản trị.
2. Vào **Cài đặt → Kết nối API (CRM & Website ngoài)**.
3. Tạo token mới, chọn **một chi nhánh cụ thể** và thời hạn phù hợp.
4. Sao chép token `nk_live_...` ngay (chỉ hiện một lần).

NKiot phải truy cập được từ máy chạy Deplao qua **HTTPS** (hoặc `http://127.0.0.1`,
`http://localhost` nếu cùng máy). Không dùng `localhost` của máy Deplao để trỏ sang
máy NKiot khác.

## Nạp plugin để chạy thử trong Deplao

Deplao gọi plugin là *ứng dụng*. Các bước dưới đây dùng chế độ "thư mục đang phát
triển" (dev), không cần đóng gói zip.

1. Mở Deplao → **Cài đặt → Ứng dụng, API & Webhook → Phát triển ứng dụng**.
2. Bấm **Thêm thư mục đang phát triển**, chọn thư mục `integrations/deplao-nkiot`
   (thư mục chứa `deplao-plugin.json`).
3. Deplao kiểm tra manifest, thêm ứng dụng **Kho hàng NKiot** vào danh sách dev và hỏi
   cấp quyền `network`, `ui:pages`, `ui:chat-panel`, `ui:composer`. Đồng ý.
4. Mở chi tiết ứng dụng, nhập **Địa chỉ NKiot** (ví dụ `https://pos.cuahang.vn`) để
   hiển thị tham khảo, rồi **bật** ứng dụng.

Muốn kiểm tra manifest trước bằng dòng lệnh (trong repo Deplao):

```bash
node packages/plugin-cli/bin/deplao-plugin.js validate /Users/nhattran/Desktop/NKiot/integrations/deplao-nkiot
```

## Cấu hình kết nối (file bí mật trong dataDir)

Deplao **không** truyền biến môi trường tùy ý vào backend ứng dụng và **không** để UI
chạm vào ổ đĩa. Vì vậy backend đọc `baseUrl` và `token` từ một file bí mật trong
`dataDir` mà Deplao cấp riêng cho ứng dụng này.

`dataDir` nằm tại:

```text
<userData Deplao>/plugin-data/<workspace>/vn.nkiot.catalog/
```

Trên macOS, `<userData Deplao>` thường là
`~/Library/Application Support/<tên app Deplao>`. Cách chắc chắn nhất để biết đường
dẫn: sau khi bật ứng dụng, backend sẽ báo lỗi thiếu file và bạn xem log ứng dụng để
thấy đúng `dataDir`; hoặc tạm thêm `console.log(ctx.dataDir)` khi chạy dev.

Tạo file cấu hình (thay `<dataDir>` bằng đường dẫn thật):

```bash
cat > "<dataDir>/nkiot-connection.json" <<'JSON'
{
  "baseUrl": "https://pos.cuahang.vn/",
  "token": "nk_live_xxxxxxxxxxxxxxxxxxxx"
}
JSON
chmod 600 "<dataDir>/nkiot-connection.json"
```

Ràng buộc backend kiểm tra:

- `baseUrl` là origin HTTPS (HTTP chỉ cho loopback), không username/password, không
  query, không hash, đường dẫn đúng `/`.
- `token` đúng định dạng `nk_live_...`.
- File `≤ 4096 byte`, là file thường, không phải symlink, không có quyền cho
  group/other (trên hệ không phải Windows).

Sau khi tạo file, vào chi tiết ứng dụng bấm **Tải lại** rồi mở lại trang/panel.

## Sử dụng

- Mở trang **Kho hàng NKiot** hoặc panel cùng tên trong một hội thoại.
- Tìm theo tên/mã, lọc khoảng giá và "chỉ còn hàng".
- Chọn máy theo serial để xem đúng ảnh và tình trạng của chiếc đó.
- Bấm từng ảnh để tải theo yêu cầu (tối đa 5 MB/ảnh theo SDK).
- **Chèn tên và mô tả vào ô soạn** để sale tự kiểm tra rồi mới gửi.

## Giới hạn hiện tại

- Chỉ đọc: tên, mô tả, giá, tình trạng, serial đã che, ảnh. Không trả IMEI đầy đủ,
  giá vốn hay số tồn chính xác.
- Không tự gửi tin; việc gửi do sale thực hiện trong Deplao.
- Mỗi token gắn một chi nhánh; cần nhiều chi nhánh thì tạo nhiều token và cấu hình
  riêng.
- Ảnh ngoài `/uploads/` của NKiot (URL bên ngoài, kho đối tác qua Hub) không hiển thị.
