# Review UX/UI NKiot — bản hiện tại

## Phạm vi và phương pháp

- Rà mã giao diện POS/quản lý, đăng nhập, biểu mẫu, chứng từ, kho, khách hàng/NCC,
  sổ quỹ, báo cáo, modal và cổng quản trị cửa hàng.
- Chạy Chromium từ Electron đã có trên máy, nạp HTML/CSS/JS của NKiot với dữ liệu
  giả và chặn API bằng phản hồi giả. Không đăng nhập kho thật, gửi tin hoặc ghi DB.
- Đo 7 view (dashboard, products, imports, customers, cashbook, reports, POS) tại
  1440×900, 1024×768, 768×1024, 390×844, 320×700; đo bổ sung checkout và modal hàng hóa.
- Harness nhúng CSS đã build, không nạp font Inter ngoài file; số đo typography
  không thay thế nghiệm thu font thật. Dùng JSDOM/VM tái hiện bàn phím và renderer.
- Không thực hiện kiểm toán WCAG đầy đủ, chưa chạy Safari/iPhone thật, bàn phím ảo,
  screen reader hoặc tất cả modal ở mọi kích thước. Cổng admin được rà mã, chưa
  đo layout trực tiếp như web POS. Không chấm điểm cảm tính cho toàn bộ hệ thống.
- Đã loại bỏ các lần đo không hợp lệ do harness bị đăng xuất bởi mock 401; kết quả
  dưới đây lấy từ lần chạy cuối với mock 503 và fixture đăng nhập đúng.

---

## 1. Phát hiện ban đầu (Baseline Findings U1–U10)

### U1 — Cao: nút thanh toán POS nằm ngoài viewport mobile/tablet

**Bằng chứng Chromium ban đầu:**

| Viewport | Chiều cao khung POS | Vị trí nút thanh toán (y → bottom) |
|---|---:|---:|
| 1440×900 | 900 | 808 → 870 (vùng actions) |
| 768×1024 | 1126 | 1046 → 1097 |
| 390×844 | 928 | 853 → 903 |
| 320×700 | 770 | 694 → 745 |

`/Users/nhattran/Desktop/NKiot/index.html:14-24` đặt zoom 1.1 nhưng chỉ bù kích thước
ở desktop. Rule mobile `:693-694` đặt 100dvh, sau zoom thành 110% chiều cao;
body khóa overflow. Đây không phải phần bảng cuộn bình thường: footer thanh toán
nằm ngoài màn hình ở trạng thái checkout.

### U2 — Cao: điều hướng “Khác” bị cắt trên màn hình 320px

Chromium đo `#management-layout.scrollWidth=381`, clientWidth=320. Nút `#nav-more`
nằm x=319, right=381, trong container overflow-hidden. Nhiều chức năng quản lý
nằm trong menu này, nên mất khả năng khám phá/truy cập bằng chạm.

Nguồn: `/Users/nhattran/Desktop/NKiot/index.html:850`, `:1400-1426` và CSS nav.

### U3 — Cao: đóng form đang sửa làm mất dữ liệu không cảnh báo

Đã tái hiện JSDOM: mở tạo khách hàng → nhập tên → Escape → modal đóng → mở lại
thì tên rỗng. Handler chung ở `/Users/nhattran/Desktop/NKiot/app.js:11878-11889`
ẩn modal trực tiếp; chỉ phiếu nhập có đường đóng riêng bảo vệ nội dung.
Nhiều nút đóng cũng thêm class hidden trực tiếp.

### U4 — Cao: biểu đồ âm/dương và số 0 dễ gây hiểu sai

`/Users/nhattran/Desktop/NKiot/app-reports.js:64-98` dùng Math.abs cho chiều cao
và ép tối thiểu 6%. Tái hiện renderer thật: -1.000.000 và +1.000.000 đều là cột
hướng lên cao 100%, số 0 vẫn vẽ cột 6%. Tooltip ghi đúng dấu nhưng hình chính
không thể hiện lỗ/đảo doanh thu.

### U5 — Cao: thanh toán thẻ bị hiển thị thành “Tiền mặt tại quầy”

`/Users/nhattran/Desktop/NKiot/app-reports.js:1033-1060` chỉ chia chuyển khoản và
mọi thứ còn lại. Renderer với duy nhất phiếu thu `method='Thẻ', amount=100000`
hiển thị 100.000 ở nhóm tiền mặt.

### U6 — Trung bình: bàn phím/screen reader chưa thao tác đầy đủ với bảng

- Header sort ở `/Users/nhattran/Desktop/NKiot/index.html:1829-1864` là th có onclick,
  không có button, tabindex hay aria-sort. Tái hiện th giá bán có tabIndex=-1.
- Checkbox dòng thiếu tên phân biệt đối tượng; một số thao tác đánh dấu sao dùng td.
- Accordion chứng từ mới có nút Chi tiết để bấm, nhưng chưa cập nhật aria-expanded /
  aria-controls cho nội dung mở ra (`app.js:8488`, `:8517`, `:9310`).

### U7 — Trung bình: nhãn trường nhập chưa đầy đủ sau khởi tạo

- Nhóm hàng `prod-category` không có associated label.
- Tìm kiếm hàng/khách, bộ lọc nhập hàng, ngày/quỹ sổ quỹ và tìm báo cáo còn dựa vào
  placeholder/vị trí thay vì tên truy cập rõ ràng.
- POS còn thiếu nhãn liên kết ở ghi chú đơn, tìm khách và ô giảm giá.
- Lỗi validation chỉ hiển thị qua toast chung mà không có inline error với `aria-invalid`.

### U8 — Trung bình: form chưa phản ánh quyền và trạng thái nghiệp vụ

- Nhân viên không phải admin vẫn chỉnh ô công nợ NCC; đã tái hiện với role warehouse.
  Server cấm số dư đầu khác 0 và cấm sửa số dư của đối tượng có sẵn cho non-admin,
  nhưng UI chỉ báo lỗi sau khi người dùng nhập/lưu.
- Modal sửa hàng vẫn gọi số tồn là “Tồn kho ban đầu” dù là tồn hiện tại và read-only.
- Lý do khóa vốn/giá chủ yếu nằm trong title tooltip, khó tiếp cận trên cảm ứng;
  checkbox đổi chế độ IMEI vẫn có thể chọn rồi bị backend từ chối.

### U9 — Trung bình: kích thước điều khiển mobile chưa đồng nhất

Đo modal sửa hàng ở 390px: input 13px; nút đóng 32px, nút lưu/hủy 37.5px.
Ảnh chụp cho thấy nhóm hàng/+Thêm nhóm bị xuống dòng và select hẹp, khó đọc tên.
Input dưới 16px gây nguy cơ Safari iOS tự zoom khi focus.

### U10 — Trung bình: modal admin thiếu quản lý focus nhất quán

Modal xác nhận tự focus nút chấp nhận, chưa có trap Tab/khôi phục focus.
Modal reset password ở `admin.html:579` thiếu role/aria-modal/tên liên kết.

---

## 2. Trạng thái sau khi khắc phục và kiểm chứng thực tế (Resolved State U1–U10)

| Mã | Vấn đề ban đầu | Giải pháp kỹ thuật đã triển khai | Files liên quan | Kiểm chứng tự động | Đo đạc Chromium thực tế |
|---|---|---|---|---|---|
| **U1** | Nút thanh toán POS bị cắt khỏi viewport mobile/tablet | Bỏ `zoom: 1.1` trên màn hình nhỏ/cảm ứng (`< 1024px`), chỉ áp dụng ở desktop `min-width: 1024px`. Đặt `height: 100dvh` kèm `max-h-[100dvh]` và cuộn độc lập cho nội dung giỏ/danh mục; thanh tác vụ checkout `#pos-checkout-actions` luôn neo cố định trong viewport. | `index.html` | `tests/ui.test.js`: Phase 1 test POS layout & viewport | - 320×700: viewport `[320, 700]`, nút thanh toán bottom `677px` (cách đáy 23px).<br>- 390×844: viewport `[390, 844]`, nút thanh toán bottom `821px` (cách đáy 23px).<br>- 768×1024: bottom `997px` (cách đáy 27px).<br>- 1440×900: bottom `870px` (nằm gọn trong vùng actions). |
| **U2** | Menu "Khác" bị cắt trên màn hình 320px (`scrollWidth=381 > 320`) | Tái cấu trúc navigation mobile: bổ sung `#nav-more-menu` dropdown, gom các mục phụ vào menu popover. Nút `#nav-more` hiển thị đầy đủ, không bị tràn ra ngoài màn hình. Đầy đủ phím Escape, phím mũi tên và quản lý focus. | `index.html`, `app.js` | `tests/ui.test.js`: Phase 1 nav dropdown test | - 320×700: `scrollWidth = 320`, `clientWidth = 320` (không tràn ngang).<br>- Nút `#nav-more` nằm tại `x: 196, right: 257, w: 61` (hoàn toàn nằm trong màn hình 320px). |
| **U3** | Đóng form làm mất dữ liệu chưa lưu không cảnh báo | Xây dựng hệ thống snapshot dirty-checking tập trung (`captureFormSnapshot`, `isFormDirty`, `closeModalWithDirtyCheck`). Khi người dùng thay đổi dữ liệu rồi bấm Hủy, nút X hoặc phím Escape, hệ thống hiển thị confirm dialog bảo vệ dữ liệu. Khi dữ liệu chưa đổi hoặc lưu thành công, modal đóng ngay lập tức không hỏi thừa. | `app.js` | `tests/ui.test.js`: Phase 1 dirty-checking test (escape, cancel, dirty confirm, clean close) | Kiểm thử JSDOM: Đổi form → Escape → dialog xuất hiện; Hủy dialog → dữ liệu giữ nguyên; Lưu thành công → snapshot xóa. |
| **U4** | Biểu đồ doanh thu/lợi nhuận hiển thị sai số âm và số 0 | Viết lại `renderDualBarChart` và `renderSingleBarChart`: xác định baseline 0 rõ ràng; giá trị dương vẽ cột hướng lên (`bottom: calc(baseline)`), giá trị âm vẽ cột hướng xuống (`top: calc(baseline)`). Cột giá trị 0 không vẽ chiều cao cột. Tooltip hiển thị đầy đủ tiền VND có dấu rõ ràng. | `app-reports.js` | `tests/ui.test.js`: Phase 2 chart test (âm, dương, 0) | Renderer xác nhận: -1.000.000 vẽ cột âm hướng xuống, +1.000.000 vẽ cột dương hướng lên, 0 không sinh cột. |
| **U5** | Thanh toán thẻ bị gộp thành tiền mặt trong báo cáo | Bổ sung `normalizePaymentMethod` và `getPaymentMethodLabel` tại `app-utils.js`. Chuẩn hóa và phân tách 4 nhóm thanh toán độc lập: Tiền mặt (`cash`), Chuyển khoản (`transfer`), Thẻ (`card`), và Không xác định (`unknown`). Báo cáo dòng tiền và cơ cấu thanh toán hiển thị đúng từng nhóm. | `app-utils.js`, `app-reports.js`, `invoice-reader.js` | `tests/ui.test.js`: Phase 2 payment classification test | Phiếu thu `method: 'Thẻ', amount: 100000` được phân loại đúng vào Thẻ, không bị cộng vào Tiền mặt. Tổng các nhóm khớp đúng 100% tổng dữ liệu vào. |
| **U6** | Bảng dữ liệu và accordion thiếu hỗ trợ bàn phím / ARIA | Chuyển toàn bộ các header sắp xếp sang thẻ `<button type="button">` bên trong `th[aria-sort]`. Cập nhật `aria-sort="ascending|descending|none"`. Toàn bộ các hàng accordion danh mục hàng hóa và chứng từ (Hàng hóa, Hóa đơn, Nhập hàng, Kiểm kho, Chuyển kho) có `tabindex="0"`, `role="row"`, `aria-expanded`, và hỗ trợ kích hoạt bằng bàn phím (Enter / Space). Giữ focus chính xác sau khi re-render. Checkbox dòng có `aria-label` gắn mã sản phẩm/chứng từ. Chi tiết hàng hóa mở rộng inline tương tự đơn hàng, loại bỏ popup modal. | `index.html`, `app.js` | `tests/ui.test.js`: Phase 3 table keyboard & ARIA test + Product detail inline expansion test | Tab vào header bấm Enter/Space kích hoạt sort và cập nhật `aria-sort`; bấm Enter trên hàng mở rộng accordion inline và cập nhật `aria-expanded="true"`. |
| **U7** | Nhãn trường nhập thiếu và lỗi validation mơ hồ | Bổ sung `aria-label` tường minh cho tất cả ô tìm kiếm tĩnh và động (`#product-search-input`, `#invoice-search-input`, `#shared-search-input`, `#pos-order-note`, `#pos-customer-input`, `#pos-discount-input`). Xây dựng hệ thống validation inline (`setFieldValidationError`, `clearFieldValidationError`) với `aria-invalid="true"`, `aria-describedby` và focus tự động tới trường lỗi đầu tiên. | `index.html`, `app.js` | `tests/ui.test.js`: Phase 3 form labels & validation test | Kiểm tra trường lỗi có `aria-invalid="true"`, thông báo lỗi inline hiển thị trực tiếp và tự xóa khi người dùng nhập đúng. |
| **U8** | Form chưa phản ánh đúng quyền và trạng thái nghiệp vụ | Ô nợ ban đầu khách hàng/nhà cung cấp: Nếu người dùng không phải admin (`role !== 'admin'`), trường chuyển sang `readOnly = true` với ghi chú inline giải thích quyền quản trị. Modal sửa hàng hóa: Đổi nhãn "Tồn kho ban đầu" thành "Tồn kho hiện tại" kèm ghi chú hướng dẫn kiểm kho/nhập hàng; khóa giá vốn với giải thích tính giá vốn bình quân; khóa đổi chế độ IMEI khi đã có phát sinh. | `app.js` | `tests/ui.test.js`: Phase 4 permissions & business status test | Non-admin mở form thấy số dư nợ ở trạng thái chỉ đọc và có ghi chú rõ ràng; form sửa sản phẩm hiển thị nhãn "Tồn kho hiện tại". |
| **U9** | Typography mobile gây iOS auto-zoom và mục tiêu chạm nhỏ | Thêm CSS mobile rule: `input, select, textarea { font-size: 16px !important; }` trên màn hình `< 640px` triệt tiêu nguy cơ iOS Safari tự zoom. Nút đóng modal, nút Hủy, nút Lưu đạt chuẩn chiều cao tối thiểu 44px. Bố cục form 2 cột tự co về 1 cột trên mobile (`grid-cols-1 sm:grid-cols-2`). | `index.html`, `public/tailwind.css` | `tests/ui.test.js`: Phase 4 mobile typography & touch target test | Đo Chromium thực tế tại 390px và 320px: `inputFontSize = 16px`; `closeBtn` cao `44px`; `cancelBtn` cao `44px`; `saveBtn` cao `44px`. |
| **U10** | Modal quản trị cửa hàng thiếu quản lý focus | Cập nhật `admin.html` và `admin.js`: Bổ sung `role="dialog"`, `aria-modal="true"`, `aria-labelledby` cho dialog xác nhận và reset password. Thêm trap Tab khép kín bên trong modal, phím Escape đóng an toàn và mặc định focus vào nút an toàn (Hủy) thay vì nút thực hiện thao tác nguy hiểm. | `admin.html`, `admin.js` | `tests/ui.test.js`: Phase 3 admin dialog focus trap test | Mở dialog admin tự focus nút Hủy; phím Tab tuần hoàn trong dialog không thoát ra nền; Escape đóng dialog an toàn. |

---

## 3. Kết quả xác minh toàn diện

### A. Kiểm thử tự động
- Lệnh thực hiện: `npm test`
- Kết quả: **219 / 219 tests PASS** (100%), 0 fail, 0 skipped, thời gian chạy ~15s.
- Toàn bộ các test hồi quy U1–U10 chạy độc lập và ổn định trong `tests/ui.test.js`.

### B. Kiểm tra cú pháp và định dạng mã nguồn
- `npm run check`: **54 / 54 files JavaScript cú pháp chuẩn xác**, exit code 0.
- `npm run format:check`: **All matched files use Prettier code style**, 0 lỗi formatting.
- `git diff --check`: **0 trailing whitespace, 0 conflict markers**.
- `npm run verify` (`format:check && check && test`): **PASS toàn bộ với Exit Code 0**.

### C. Đo đạc Bounding Rect trên Electron Browser thực tế
Chạy harness Electron Chromium headless trên 5 viewports tiêu chuẩn:
- **320×700**:
  - POS viewport: `[320, 700]`
  - Khung checkout actions: `y: 620, bottom: 677, height: 57` (cách đáy viewport 23px)
  - Nút Thanh toán: `y: 631, bottom: 677, height: 46` (hoàn toàn trong tầm nhìn)
  - Management navigation: `scrollWidth = 320, clientWidth = 320` (không tràn)
  - Nút Khác `#nav-more`: `x: 196, right: 257, w: 61` (hiển thị trọn vẹn)
  - Modal input font: `16px`, Touch target: `44px`
- **390×844**:
  - POS viewport: `[390, 844]`
  - Khung checkout actions: `y: 764, bottom: 821, height: 57` (cách đáy viewport 23px)
  - Nút Thanh toán: `y: 775, bottom: 821, height: 46`
  - Management navigation: `scrollWidth = 390, clientWidth = 390`
  - Modal input font: `16px`, Touch target: `44px`
- **768×1024**:
  - POS checkout actions: `y: 940, bottom: 997, height: 57` (cách đáy viewport 27px)
  - Nút Thanh toán: `y: 951, bottom: 997, height: 46`
- **1024×768**:
  - Bố cục tablet/desktop hiển thị đầy đủ cả panel giỏ hàng và danh mục.
- **1440×900**:
  - Bố cục desktop POS và management rộng rãi, không có bất kỳ thành phần nào bị cắt.

---

## 4. Thay đổi hành vi người dùng, Giới hạn và Hướng dẫn áp dụng

1. **Thay đổi hành vi người dùng:**
   - Khi chỉnh sửa dữ liệu trong form (sản phẩm, khách hàng, nhà cung cấp...) mà người dùng ấn nút Hủy, nút X hoặc phím Escape, hệ thống sẽ hiện hộp thoại hỏi xác nhận để tránh mất mát dữ liệu ngoài ý muốn. Nếu form chưa sửa gì, modal sẽ đóng ngay.
   - Nhân viên bán hàng/kho khi xem thông tin khách hàng hoặc nhà cung cấp sẽ thấy số dư công nợ rõ ràng dưới dạng chỉ đọc (read-only) kèm dòng giải thích, thay vì cho nhập rồi báo lỗi từ chối khi lưu như trước.
   - Khi dùng bàn phím hoặc click chuột trên các bảng danh sách hàng hóa và chứng từ (Hàng hóa, Hóa đơn, Nhập hàng, Kiểm kho, Chuyển kho), người dùng có thể click hoặc dùng phím `Tab` để di chuyển đến hàng và ấn phím `Enter` hoặc `Space` để mở rộng chi tiết ngay bên dưới hàng đó (accordion) với đầy đủ thông tin, ảnh/video, IMEI và các nút hành động mà không bị nhảy popup modal che khuất màn hình.
   - Biểu đồ báo cáo kinh doanh hiện rõ phần lỗ (cột âm chúc xuống dưới vạch 0) và lãi (cột dương hướng lên trên vạch 0).

2. **Giới hạn hiện tại:**
   - Số đo typography và touch targets được đo đạc trong môi trường Chromium/Electron engine. Chưa bao gồm hành vi mở bàn phím ảo (virtual onscreen keyboard) của thiết bị vật lý iOS Safari / Android Chrome.
   - Screen reader hỗ trợ đầy đủ chuẩn ngữ nghĩa ARIA (roles, states, expanded, controls, live regions), tuy nhiên trải nghiệm âm thanh thực tế với VoiceOver/TalkBack cần được thử nghiệm bổ sung trên thiết bị cầm tay thực tế của người dùng.
