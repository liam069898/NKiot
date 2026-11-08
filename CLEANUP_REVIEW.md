# Rà soát và dọn mã NKiot — 2026-11-07

## Phạm vi và cách kiểm tra

- Kiểm kê mã ứng dụng, backend, quản trị cửa hàng, Hub, script vận hành, tài nguyên,
  tài liệu, CI và kiểm thử trong `/Users/nhattran/Desktop/NKiot`.
- Phân tích khai báo hàm bằng Acorn, đối chiếu tham chiếu trong JavaScript, HTML
  (bao gồm handler inline), kiểm thử và tài liệu; kiểm tra các require tương đối.
- Đọc các vùng nghi ngờ trước khi xóa; không suy luận rằng một hàm không có lời gọi
  trực tiếp trong JS là thừa, vì giao diện sử dụng global và handler trong HTML.
- Chạy kiểm thử trước/sau, kiểm tra định dạng/cú pháp, dựng lại CSS.
- Đây là rà soát cấu trúc/tham chiếu và dọn mã có bằng chứng, **không phải** chứng
  nhận mọi dòng mã đều đúng hoặc kiểm toán bảo mật toàn diện. Chưa nghiệm thu thủ
  công toàn bộ màn hình với dữ liệu thật.

## Các thay đổi đã thực hiện

### 1. Hoàn tất tách plugin Deplao

- Đã so sánh nội dung 10 file plugin và ZIP 0.2.2 với bản tại
  `/Users/nhattran/Desktop/deplao-nkiot` trước khi xóa bản sao khỏi NKiot.
- Xóa bản sao mã plugin, hai ZIP 0.2.1/0.2.2 và hai file kiểm thử plugin khỏi NKiot.
  Không sửa bản plugin đã cài trong Deplao hoặc kho Git của dự án plugin riêng.
- Bỏ đường dẫn plugin khỏi script format/check của NKiot.
- Thay kiểm thử phụ thuộc backend plugin bằng kiểm thử hợp đồng HTTP độc lập:
  Bearer token → danh sách → chi tiết → ảnh từng máy → thu hồi token.
- Giữ nguyên Open API, màn hình tạo/quản lý API Key và kiểm tra phạm vi chi nhánh.

### 2. Loại bỏ mã UI không có nơi gọi

Trong `/Users/nhattran/Desktop/NKiot/app.js`:

- `getViewScroller`: đã thay bằng lưu/khôi phục nhiều vùng cuộn.
- `handleProductImageUpload`, `handleProductVideoUpload`: không còn được gắn vào
  input hoặc sự kiện. Giữ `uploadMediaFile` và luồng upload ảnh nhập kho đang dùng.
- `copyContactPhone`: không có nút hoặc lời gọi. Giữ hiển thị/liên kết gọi đối tác.
- `syncItemQtyWithImeis`: không còn lời gọi; luồng nhập IMEI hiện tại tự đồng bộ SL.
- `addImportItem`: alias không có nơi dùng; giữ `selectImportProduct`.
- `showDbInfoModal`: không còn nút mở. Xóa markup `db-info-modal` tương ứng trong
  `/Users/nhattran/Desktop/NKiot/index.html`.

Giữ `forceSyncDatabase`, nút đối soát POS và xuất JSON ở màn hình còn sử dụng.
Bổ sung kiểm thử bảo vệ ba hành vi này. JS + HTML giảm 13.560 byte so với lúc bắt
đầu lượt dọn (chưa tính plugin hoặc CSS).

### 3. Gọn luồng Open API

- Bỏ tham số URL/host/key thô không được dùng trong các hàm xác thực/đọc sản phẩm.
- Không trả key thô từ helper xác thực về handler sau khi đã xác thực xong.
- Cập nhật mọi nơi gọi nội bộ; không thay đổi endpoint hoặc cấu trúc JSON công khai.
- Sửa tên/chú thích kiểm thử: query token bị từ chối, không phải được hỗ trợ.
- Sửa tài liệu trường tồn kho thành `availability`; query lọc là `in_stock=true`.

## Những phần cố ý giữ lại

| Thành phần | Lý do |
|---|---|
| `/Users/nhattran/Desktop/NKiot/data.js` | Khởi tạo mặc định, dữ liệu test và benchmark vẫn sử dụng |
| Migration `deplao_send_jobs` và bảng cũ | Giữ lịch sử nâng cấp; không drop bảng/dữ liệu vận hành |
| Biến môi trường `MINIKIOT_*`, cookie cũ, URL `/data.js` | Tương thích triển khai và client hiện có |
| Command chỉnh sửa cũ và xử lý pending | Cần đối soát giao dịch chưa rõ kết quả; không xóa vì ít dùng |
| Script seed/provision/Hub/backup | Công cụ vận hành, không phải module giao diện nên không thể chỉ dựa vào import graph để xóa |
| Font, license, CSS sinh tự động | Đang được server phục vụ; CSS được build lại, không xóa thủ công class theo cảm tính |
| DB, WAL/SHM, backup và uploads | Dữ liệu người dùng, nằm ngoài phạm vi dọn code |

## Phát hiện cần xử lý ở đợt riêng

1. **Modal IMEI nhập hàng cũ:** `editImportItemImeis` không có nơi gọi trong runtime,
   nhưng chuỗi renderer/modal còn được kiểm thử chống XSS. Cần chuyển kiểm thử sang
   luồng nhập inline đang sử dụng rồi mới loại bỏ toàn bộ cụm, không xóa từng hàm.
2. **`fillMultiPaymentRemainder`:** chỉ thấy kiểm thử gọi; cần quyết định sản phẩm về
   thao tác điền số tiền còn thiếu trước khi loại bỏ helper và kiểm thử tương ứng.
3. **Preview ảnh sản phẩm cũ:** thiếu host DOM ở giao diện thật nhưng renderer còn
   được gọi và kiểm thử. Cần rà lại UX chỉnh sửa ảnh riêng, không bỏ trạng thái ảnh
   có nguy cơ làm mất dữ liệu khi lưu sản phẩm.
4. **Mã giao diện lớn:** `/Users/nhattran/Desktop/NKiot/app.js` vẫn khoảng 594 KB,
   `/Users/nhattran/Desktop/NKiot/index.html` khoảng 588 KB. Tách module theo nghiệp
   vụ là refactor riêng; không trộn với xóa mã vì đang phụ thuộc thứ tự script/global.
5. **Dự án plugin riêng:** `/Users/nhattran/Desktop/deplao-nkiot/package.json` thiếu
   devDependency `jsdom`, README còn đường dẫn NKiot cũ và script pack phụ thuộc CLI
   Deplao cạnh thư mục dự án. Lần này không sửa ngoài phạm vi NKiot; kiểm thử UI
   plugin dùng `NODE_PATH=/Users/nhattran/Desktop/NKiot/node_modules` để kiểm tra bản
   sao trước khi dọn. Cần khai báo/cài dependency ở dự án plugin để chạy độc lập.
6. **Browserslist:** build CSS cảnh báo `caniuse-lite` cũ. Build vẫn thành công;
   không nâng dependency/lockfile tự động trong lượt dọn này.

## Xác minh

- Trước dọn: 221 kiểm thử đạt (gồm 20 kiểm thử plugin).
- Sau dọn: `npm run verify` exit code **0**: định dạng đạt, kiểm tra cú pháp **54**
  file JavaScript, **202/202** kiểm thử NKiot đạt.
- Bản plugin riêng: **20/20** kiểm thử đạt với môi trường thư viện ghi rõ ở trên.
- `npm run assets:build` thành công; `public/tailwind.css` được cập nhật.
- Kiểm tra require tương đối của JavaScript cấp gốc: không có module bị thiếu.
- Không thay dữ liệu kho thật; không khởi động lại server, không gửi tin Deplao,
  không commit hoặc hoàn tác các thay đổi có sẵn của người dùng.

Các file đã xóa khỏi bản sao plugin được lưu dự phòng ngoài repository tại
`/var/folders/nm/hbl5jy2x1t32p6vcl_j_stlh0000gn/T/nkiot-cleanup-jdBG88`.
Đây là thư mục tạm có thể bị hệ điều hành dọn; bản chính của plugin vẫn nằm ở
`/Users/nhattran/Desktop/deplao-nkiot`.