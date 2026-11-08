# Review logic nghiệp vụ NKiot — 2026-11-07

> Cập nhật: vòng 2 đã siết quyền giá theo nguyên tắc chỉ cho phép khi được cấp,
> chặn thay tập IMEI trong danh mục, bỏ ngoại lệ admin sửa giá vốn có lịch sử,
> giới hạn metadata phiếu nhập và sửa tra cứu mã hoa/thường. Xem
> `/Users/nhattran/Desktop/NKiot/LOGIC_REVIEW_ROUND2.md` để biết trạng thái mới nhất;
> các mô tả sửa F1/F2 bên dưới là lịch sử bản sửa đầu tiên.

## Kết luận và phạm vi

Đối chiếu domain, transaction, phân quyền, UI, báo cáo, kho chia sẻ, catalog, Open API
và client pending/retry. Chạy `npm run verify`: exit 0, 202/202 test đạt. Các lỗi dưới
đây được tái hiện bổ sung bằng script có assertion với dữ liệu thử, DB tạm qua
`/Users/nhattran/Desktop/NKiot/tests/test-env.js`, HTTP local và VM/JSDOM.

Không sửa logic sản xuất, không thay DB thật, không gửi tin hoặc gọi Hub thật.
Các script tái hiện được chạy tạm, chưa đưa vào bộ regression test: khi sửa cần
thêm test khẳng định hành vi đúng, không thêm test xanh xác nhận hành vi lỗi.
Đây không phải cam kết đã kiểm tra mọi tổ hợp thao tác hoặc kiểm toán toàn diện.

## F1 — Cao: đi vòng quyền sửa giá POS qua danh mục

- Vị trí: `/Users/nhattran/Desktop/NKiot/application.js:150-151`, `:274-303`;
  `/Users/nhattran/Desktop/NKiot/domain.js:184-191`;
  `/Users/nhattran/Desktop/NKiot/app.js:11302-11318`.
- Preset thu ngân có `products=true`, `pos=true`, `posPrice=false`. Server kiểm tra
  `posPrice` khi `salePrice` khác giá danh mục, nhưng sửa giá danh mục chỉ cần `products`.
- Tái hiện qua `application.transact` và SQLite: bán tùy chỉnh từ 100.000 xuống 1
  bị từ chối; dùng `catalogPatch` đổi `price` thành 1 rồi bán không truyền giá tùy
  chỉnh thì thành công, hóa đơn tổng 1 đồng.
- Hậu quả: cấu hình không cho sửa giá tại POS không ngăn thu ngân thay đổi giá bán
  thực tế, thậm chí đổi luôn giá danh mục cho người khác.
- Hướng sửa: tách quyền xem hàng/sửa danh mục/sửa giá; chỉnh preset thu ngân và
  kiểm quyền giá phía server. Nếu chủ đích cho thu ngân sửa giá danh mục, cần mô tả
  rõ giới hạn `posPrice`; hiện cấu hình dễ tạo cảm giác bảo vệ sai.

## F2 — Cao: sửa tồn và giá vốn qua danh mục không có chứng từ kho

- Vị trí: `/Users/nhattran/Desktop/NKiot/application.js:274-303`;
  `/Users/nhattran/Desktop/NKiot/app.js:5767-5769`, `:5803-5812`;
  `/Users/nhattran/Desktop/NKiot/index.html:5389-5399`.
- Trường có nhãn “Tồn kho ban đầu” vẫn được đọc/lưu khi sửa sản phẩm đã có lịch sử.
  API chỉ kiểm số nguyên không âm; không bắt buộc phiếu kho khi tồn/giá vốn thay đổi.
- Tái hiện: hàng thường tồn 10, vốn 50.000; bán 1 còn 9; thu ngân chỉ có quyền
  `products` sửa thành tồn 999, vốn 0 qua `catalogPatch` thành công. Không có phiếu
  nhập hoặc kiểm kho tương ứng. Vẫn có audit thao tác danh mục, nhưng không có
  chứng từ giải thích biến động tồn/giá vốn.
- Hậu quả: lệch sổ kho và định giá tồn, ảnh hưởng giá vốn/lợi nhuận giao dịch sau.
- Hướng sửa: chỉ cho khai báo tồn đầu khi tạo mới theo quyền rõ ràng; sản phẩm đã
  có lịch sử phải qua nghiệp vụ điều chỉnh kho/giá vốn có chứng từ. Khóa ở API,
  không chỉ disable input. Giữ snapshot giá vốn hóa đơn cũ.

## F3 — Cao: đổi chế độ IMEI qua phiếu nhập làm kẹt trả hàng cũ

- Vị trí: `/Users/nhattran/Desktop/NKiot/domain.js:540-552`, `:392-405`;
  đối chiếu `/Users/nhattran/Desktop/NKiot/application.js:302-303`.
- Danh mục cấm đổi chế độ IMEI khi đã có lịch sử, nhưng nhập hàng chỉ cấm bật
  IMEI khi tồn hiện tại lớn hơn 0.
- Tái hiện: bán hết 1 sản phẩm không IMEI → nhập thêm 1 chiếc cùng mã với
  `hasImei=true`, `imeis=['NEW1']` → thành công → trả chiếc của hóa đơn trước đó
  bị từ chối vì hóa đơn cũ không có lịch sử IMEI.
- Hậu quả: hai đường ghi áp dụng quy tắc khác nhau; hàng đã bán trước khi đổi
  chế độ không thể hoàn theo nghiệp vụ bình thường.
- Hướng sửa: dùng cùng invariant về chế độ IMEI cho nhập hàng và sửa danh mục;
  sản phẩm có lịch sử nên dùng mã mới khi đổi cách quản lý. Thêm test chuỗi
  bán hết → nhập đổi chế độ → trả/hủy hóa đơn cũ.

## F4 — Trung bình: mã hàng hợp lệ nhưng Open API chi tiết trả 404

- Vị trí: `/Users/nhattran/Desktop/NKiot/application.js:254-258`;
  `/Users/nhattran/Desktop/NKiot/server.js:253-258`.
- Danh mục cho phép `[A-Za-z0-9_.:-]`, route chi tiết chỉ nhận `[A-Za-z0-9_-]`.
- Tái hiện HTTP với token chi nhánh trên DB tạm: danh sách trả mã `SP.01`, nhưng
  `GET /api/v1/open/products/SP.01` trả 404. Dấu `:` cũng không được route nhận.
- Hậu quả: CRM có thể tìm thấy hàng nhưng bước đọc chi tiết/xác nhận trước gửi thất bại.
- Hướng sửa: thống nhất quy tắc mã, decode đúng segment và validate sau decode;
  thêm test dấu chấm, dấu hai chấm và dạng URL-encoded, không nới thành đường dẫn tùy ý.

## F5 — Trung bình: chuyển kho tạo hàng mới mất thông tin media hàng thường

- Vị trí: `/Users/nhattran/Desktop/NKiot/domain.js:848-870`, `:895-935`.
- Phiếu chuyển snapshot thông tin chung hạn chế và ảnh theo IMEI. Khi kho đích
  chưa có sản phẩm, không sao chép `images`, `videoUrl`, `description`, `condition`,
  `conditionDetail` của hàng thường.
- Tái hiện `execute(transfer)` rồi `execute(receive)` với sản phẩm có ảnh, mô tả,
  tình trạng đã dùng: tồn đích = 1 nhưng các trường trên không có. Qua DB, giá trị
  mặc định có thể khiến tình trạng hiển thị thành `new`.
- Phạm vi: đường tạo sản phẩm mới khi nhận kho (dữ liệu cũ/kho thiếu mã), không phải
  mọi phiếu chuyển. Đồng bộ mã hiện tại có thể đã tạo sẵn dòng ở kho đích.
- Hướng sửa: snapshot metadata cần thiết ngay khi lập phiếu; dùng snapshot khi
  tạo dòng đích. Không ghi đè ảnh/mô tả đã được quản lý riêng ở dòng đích hiện có.

## Điểm cần chốt nghiệp vụ, chưa kết luận là lỗi số liệu

### Phương thức thanh toán trong báo cáo doanh thu

- `/Users/nhattran/Desktop/NKiot/app-reports.js:566-598` lọc hóa đơn theo ngày bán,
  rồi cộng toàn bộ `inv.payments`, không lọc ngày của từng khoản thu/hoàn.
- Đã tái hiện bằng renderer thật trong VM: hóa đơn tháng 10 được thu 100.000 tiền
  mặt tháng 11; xem tháng 10 vẫn có 100.000 trong biểu đồ phương thức thanh toán.
- Hợp lý nếu ý nghĩa là “tình trạng thanh toán hiện tại của hóa đơn phát sinh trong
  kỳ”; không hợp lý nếu người dùng hiểu “tiền thu trong kỳ”. Cần đổi nhãn/mô tả hoặc
  chuyển nguồn sang chứng từ dòng tiền theo ngày. Không tự thay vì sẽ đổi ý nghĩa báo cáo.

### Catalog công khai là snapshot

- `/Users/nhattran/Desktop/NKiot/catalog-service.js` lưu snapshot và bộ test có chủ
  đích giữ bất biến. Không được suy ra tồn hiện tại từ trạng thái snapshot cũ.
- Cần thống nhất thông điệp cho khách hoặc kiểm tra tồn lại khi chốt đơn; không
  đổi catalog thành dữ liệu realtime chỉ vì khác Open API hiện tại.

## Các cơ chế đã thấy được bảo vệ trong mã và kiểm thử hiện có

- Transaction `BEGIN IMMEDIATE`, rollback, revision chống ghi đè dữ liệu cũ.
- Request ID + digest chống thực hiện lại, audit giữ dấu khi cache kết quả hết hạn.
- Bán hàng trừ tồn, tiền nguyên VND, phân bổ giảm giá; snapshot giá vốn hóa đơn.
- Trả từng phần/hủy phần còn lại; trả serial đúng hóa đơn; giảm nợ trước hoàn tiền.
- Thanh toán nhiều phương thức và thu nợ có phân bổ chứng từ.
- Kiểm kho nháp không ghi đè bán hàng phát sinh sau; chuyển kho không nhận hai lần.
- Chi nhánh, phiên đăng nhập, quyền API và token/media có các kiểm thử phủ hiện có.
- Pending phía client giữ request gốc khi mất kết nối; đối soát trước tạo giao dịch mới.
- Hub outbox giữ dữ liệu trong lỗi mạng và phục hồi sequence khi restore backup.

Các kiểm thử xanh chứng minh những kịch bản cụ thể, không loại trừ lỗi ở các đường
ghi khác như F1–F3.

## Trạng thái đã khắc phục (2026-11-07)

Toàn bộ 5 lỗi logic F1–F5 đã được sửa và bổ sung kiểm thử hồi quy:

1. **F1:** Preset thu ngân đặt `products: false` (POS vẫn đọc được hàng nhờ quyền `pos`). Tại server (`application.js`), kiểm tra chặn đổi giá nếu tài khoản bị cấm sửa giá (`user.permissions?.posPrice === false`). Đã kiểm thử `catalog price change is forbidden when posPrice is explicitly false (F1)`.
2. **F2:** `application.js` chặn sửa trực tiếp `stock` và `costPrice` khi sản phẩm đã phát sinh giao dịch (`productHasHistory`). Giao diện `app.js` khóa ô nhập tồn kho thành read-only khi sửa sản phẩm có sẵn và giữ nguyên tồn thực tế khi lưu form. Đã kiểm thử `catalog stock and cost edits on products with transaction history are rejected (F2)`.
3. **F3:** `domain.js:importGoods` bổ sung điều kiện chặn chuyển sang quản lý IMEI nếu sản phẩm đã phát sinh giao dịch (`productHasHistory`). Đã kiểm thử `import cannot toggle a sold non-IMEI product to IMEI when history exists (F3)`.
4. **F4:** `server.js` route Open API chi tiết sản phẩm nhận regex `([^/]+)` kèm `decodeURIComponent` và kiểm tra ký tự theo chuẩn mã hàng (`[A-Za-z0-9_.:-]`). Đã kiểm thử `GET /api/v1/open/products/DH.SEIKO%3A01` trả HTTP 200.
5. **F5:** `domain.js:transfer` lưu snapshot đầy đủ `images`, `videoUrl`, `condition`, `conditionDetail`, `description` của sản phẩm; `domain.js:receive` khôi phục đầy đủ các trường này khi tạo sản phẩm mới tại kho đích. Đã kiểm thử `transfer and receive into branch without existing product preserves metadata and media (F5)`.

Kết quả xác minh: `npm run verify` chạy 206/206 test thành công, exit code 0.