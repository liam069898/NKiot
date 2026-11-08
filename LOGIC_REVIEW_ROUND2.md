# Review logic vòng 2 — 2026-11-07

## Cập nhật khắc phục sau review

Đã xử lý R1–R5 trong mã nguồn; phần bên dưới giữ lại mô tả hiện trạng lúc review.

- **R1:** Đổi giá sản phẩm có sẵn dùng `requirePermission(user, 'posPrice')` ở
  validator chung của edit/catalogPatch. Thiếu quyền và false đều bị từ chối;
  admin hoặc người có quyền vẫn sửa được. UI khóa giá khi thiếu quyền.
- **R2:** Không cho thay tập IMEI của sản phẩm có sẵn qua danh mục, kể cả chưa có
  lịch sử; thay thứ tự đơn thuần vẫn được. Kiểm thử xác nhận trả đúng IMEI rồi
  bán lại hợp lệ vẫn hoạt động, lỗi bị rollback và không tăng revision.
- **R3:** Metadata nhập chỉ được chứa serial của dòng nhập. Từ chối serial ngoài
  phạm vi, kể cả metadata IMEI gắn vào hàng thường. Kiểm thử nhiều dòng bảo đảm
  rollback cả dòng đã xử lý trước và không ghi đè máy đang tồn.
- **R4:** Giữ mã phân biệt hoa/thường như danh mục/POS. Open API ưu tiên khớp
  chính xác; chỉ dùng fallback không phân biệt hoa/thường khi có đúng một kết quả.
  Kết quả fallback mơ hồ vẫn trả 409. Không đổi mã dữ liệu cũ. Kiểm thử HTTP bao
  gồm mã có dấu hai chấm và sản phẩm cùng mã ở chi nhánh khác.
- **R5:** Bỏ ngoại lệ admin khi sửa giá vốn đã có lịch sử. UI khóa giá vốn sản phẩm
  có sẵn vì client có thể không được đọc đủ lịch sử; tạo mới vẫn nhập giá vốn được.
  Chưa bổ sung nghiệp vụ điều chỉnh giá vốn độc lập; không sửa dữ liệu lịch sử.

Xác minh sau sửa: **212/212** test đạt, `npm run verify` exit **0**, kiểm tra định
dạng/cú pháp đạt. Thêm 6 test và mở rộng test quyền/API hiện có. Log:
`/tmp/nkiot-round2-final-verify.log`. Không khởi động lại server, không migrate DB,
không tự thay quyền tài khoản đã lưu và không commit.

**Lưu ý triển khai:** tài khoản chỉ có quyền hàng hóa nhưng chưa được cấp `posPrice`
sẽ không còn sửa giá bán sản phẩm có sẵn. Quản trị viên cần cấp quyền rõ ràng nếu
đây là chức năng được phép. Để áp dụng backend mới cần khởi động lại tiến trình
NKiot trong thời điểm phù hợp và tải lại giao diện.

Các quan sát về hoàn nguyên metadata khi hủy nhập và ý nghĩa báo cáo thanh toán
vẫn chưa thay đổi; chúng không nằm trong 5 lỗi đã xác nhận của vòng này.

## Phạm vi và kết quả

Review lại các bản sửa F1–F5 và các đường ghi liên quan danh mục, serial, nhập/hủy
nhập, thanh toán nợ, Open API và báo cáo. Không sửa mã thực thi hoặc dữ liệu thật.

`npm run verify` đạt **206/206**, exit **0**. Tái hiện bổ sung bằng assertion qua
`application.transact`, SQLite tạm do `tests/test-env.js` cấp và helper API thật.
Các script tái hiện chạy tạm, không thêm test khẳng định hành vi lỗi vào bộ CI.

Kết luận lượt trước rằng đã sửa toàn bộ và hệ thống nhất quán là quá mạnh: vẫn còn
các trường hợp dưới đây. Kiểm thử xanh chỉ xác nhận các kịch bản đã được phủ.

## R1 — Cao: thiếu trường quyền vẫn đi vòng được quyền sửa giá

- `/Users/nhattran/Desktop/NKiot/application.js:292-298` chỉ chặn khi
  `permissions.posPrice === false`.
- `/Users/nhattran/Desktop/NKiot/security.js:21-25` coi mọi giá trị khác `true`,
  bao gồm thiếu trường, là không có quyền. POS dùng cơ chế này.
- Tái hiện với nhân viên active, `products=true`, `pos=true`, không có `posPrice`:
  bán tùy chỉnh giá 1 thay vì 100.000 bị 403; sửa danh mục thành 1 rồi bán thành công.
- Hướng sửa: thống nhất kiểm quyền bằng `can/requirePermission`, không chỉ chặn
  explicit false. Bổ sung test thiếu quyền, false, true, admin, cả edit/catalogPatch.
- Phạm vi: tài khoản tùy chỉnh/cũ có quyền hàng hóa nhưng không khai báo posPrice;
  preset thu ngân mới không loại bỏ rủi ro với tài khoản đã lưu.

## R2 — Cao: đổi danh sách IMEI giữ nguyên stock cho phép bán trùng thiết bị

- `/Users/nhattran/Desktop/NKiot/application.js:299-322`, `:345-348` kiểm thay đổi
  stock, số lượng và trùng IMEI đang tồn; không bảo vệ thay đổi tập serial khi
  stock không đổi và sản phẩm có lịch sử.
- Tái hiện: tồn I1/I2/I3 → bán I1 → sửa `imeis` từ I2/I3 thành I1/I3, giữ stock=2
  → thành công → bán tiếp I1 → hai hóa đơn khác nhau cùng xuất I1 mà không có
  chứng từ nhập/trả đưa I1 trở lại kho.
- Hậu quả: số lượng nhìn vẫn đúng nhưng danh tính thiết bị sai, có thể xuất thiết
  bị không còn trong kho. Đây là đường bỏ qua ràng buộc kho của bản sửa F2.
- Hướng sửa: thay đổi serial hàng có sẵn phải qua nghiệp vụ có chứng từ; bảo vệ
  cả `stock` và tập IMEI ở API. Không cấm serial lịch sử một cách tuyệt đối vì
  nghiệp vụ trả hàng hoặc mua lại hợp lệ vẫn cần được hỗ trợ.

## R3 — Cao: phiếu nhập ghi đè thông tin máy không thuộc phiếu

- `/Users/nhattran/Desktop/NKiot/domain.js:556-568` xác minh danh sách serial nhập
  nhưng merge toàn bộ `row.imeiDetails` vào sản phẩm.
- `/Users/nhattran/Desktop/NKiot/media-validation.js` kiểm cấu trúc/URL, không
  ràng buộc key trong imeiDetails với danh sách serial của dòng nhập.
- Tái hiện: nhập I4, kèm `imeiDetails.I2` có ảnh và tình trạng mới → I2 đang tồn
  bị đổi ảnh/tình trạng dù không thuộc phiếu. Thực hiện bằng nhân viên active có
  quyền nhập hàng qua transaction thật, không phải sửa trực tiếp DB.
- Hậu quả: ảnh thật từng máy trong kho/CRM có thể bị gán sai; quyền nhập hàng được
  dùng để sửa metadata ngoài phạm vi dòng nhập.
- Hướng sửa: từ chối key ngoài `row.imeis` trước khi merge; kiểm thử ảnh I2 không
  thay đổi, dữ liệu I4 được lưu và rollback toàn giao dịch khi payload sai.

## R4 — Trung bình: mã chỉ khác hoa/thường tạo được nhưng API chi tiết xung đột

- `/Users/nhattran/Desktop/NKiot/application.js:653-665` kiểm trùng mã phân biệt
  chữ hoa/thường; `/Users/nhattran/Desktop/NKiot/open-api-service.js:306-311` lại
  so sánh bằng `toLowerCase()` và báo 409 nếu nhiều kết quả.
- Tái hiện: tạo mã `P` và `p` cùng chi nhánh qua catalogPatch thành công; đọc
  chi tiết `P` qua helper Open API trả 409 vì khớp cả hai.
- Hậu quả: hàng hợp lệ theo danh mục không truy cập được chi tiết qua CRM.
- Hướng sửa: chốt mã phân biệt hoa/thường hay không, áp dụng thống nhất. Nếu không,
  cần kiểm tra va chạm dữ liệu cũ trước khi chuẩn hóa; không tự đổi mã chứng từ.

## R5 — Trung bình: admin vẫn sửa giá vốn có lịch sử không qua chứng từ

- `/Users/nhattran/Desktop/NKiot/application.js:304-310` có ngoại lệ admin.
- Tái hiện: bán một chiếc, admin đổi giá vốn sản phẩm còn tồn từ 50.000 thành 0
  qua catalogPatch thành công, không có chứng từ điều chỉnh giá trị tồn.
- Đây là phần F2 chưa được giải quyết hoàn toàn, không phải lỗi mới xuất hiện.
  Hóa đơn cũ vẫn giữ snapshot giá vốn, nhưng giá trị kho và các lần bán tiếp bị đổi.
- Hướng sửa: nếu cho admin điều chỉnh, cần nghiệp vụ điều chỉnh giá vốn riêng có
  giá trước/sau, lý do và người duyệt; nếu chưa có nghiệp vụ này thì chặn sửa trực
  tiếp sau lịch sử. Audit chung sửa danh mục không thay thế chứng từ định giá.

## Quan sát cần chốt quy tắc, không gộp vào lỗi đã xác nhận

- Nhập hàng → trả nợ → hủy nhập: đã chạy chuỗi giá trị 50.000, trả trước 10.000,
  trả nợ 40.000; hủy hoàn 50.000 về đúng tồn=0, nợ=0, tổng mua=0 và dòng tiền ròng=0.
  Tuy nhiên ảnh/tình trạng cập nhật lúc nhập vẫn còn sau khi hủy. Cần quyết định
  hủy phiếu có hoàn nguyên metadata không; không được hoàn nguyên đè các chỉnh
  sửa hợp lệ phát sinh sau đó.
- Biểu đồ phương thức thanh toán theo kỳ hóa đơn đã nêu ở vòng 1 chưa được sửa;
  tiếp tục cần xác định rõ là thanh toán hiện tại của nhóm hóa đơn hay thu trong kỳ.
- `productHasHistory` tồn tại cả ở application.js và domain.js: chưa tìm thấy
  sai lệch nghiệp vụ mới từ hai bản, nhưng đây chưa phải helper dùng chung như
  mô tả lần sửa trước, dễ lệch khi thay đổi sau này.

## Ưu tiên và test cần bổ sung

1. R2: bảo vệ tập serial, thử cả sản phẩm có/không lịch sử và nhập/trả hợp lệ.
2. R1: kiểm quyền mặc định từ chối, bao gồm tài khoản cũ thiếu trường quyền.
3. R3: ràng buộc metadata nhập với serial nhập, kiểm rollback và không sửa máy khác.
4. R4: thống nhất hợp đồng mã giữa danh mục/POS/API, xử lý dữ liệu cũ rõ ràng.
5. R5: chốt nghiệp vụ điều chỉnh giá vốn có chứng từ cho admin.

Không khẳng định các chức năng còn lại đều không lỗi. Chưa nghiệm thu toàn bộ UI
hoặc kiểm thử mọi tổ hợp chứng từ nhiều chi nhánh. Log verify:
`/tmp/nkiot-review-round2-verify.log` (file tạm).