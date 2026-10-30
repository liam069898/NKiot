# NKiot

Ứng dụng bán hàng dùng giao diện JavaScript thuần, máy chủ Node.js và SQLite. Máy chủ kiểm tra đăng nhập, quyền, chi nhánh và thực hiện giao dịch; trình duyệt nhập liệu và hiển thị kết quả.

## Khởi chạy

Yêu cầu **Node.js 24 trở lên**. Máy chủ dùng module `node:sqlite` tích hợp, không cần cài thư viện để chạy:

```bash
npm start
```

Mở `http://localhost:3000`. Thiết bị cùng LAN dùng `http://<IP-máy-chủ>:3000`. Không mở trực tiếp `index.html` bằng `file://`.

- POS và lệnh backup dùng chung thứ tự chọn database: `NKIOT_DB_PATH`, `MINIKIOT_DB_PATH`, rồi `nkiot.db` nếu đã tồn tại, nếu không là `minikiot.db` trong thư mục dự án. Khi vận hành nên luôn đặt đường dẫn tuyệt đối qua biến môi trường.
- `HOST` mặc định `0.0.0.0`, `PORT` mặc định `3000`.
- Database mới có danh mục/chi nhánh mặc định, bảng nghiệp vụ trống và tài khoản `admin`. Mật khẩu ngẫu nhiên được in một lần ở terminal. Có thể đặt `MINIKIOT_ADMIN_PASSWORD` trước lần khởi tạo đầu tiên, từ 8 đến 1024 ký tự.
- Với database có sẵn, tài khoản và mật khẩu đăng nhập được giữ nguyên; mật khẩu được chuyển sang dạng băm. Nên đổi các mật khẩu ngắn/mặc định còn lại.
- Phiên đăng nhập nằm trong bộ nhớ máy chủ; khởi động lại máy chủ yêu cầu đăng nhập lại. Giao dịch chờ và khóa chống ghi trùng vẫn được lưu bền vững.

Tailwind CSS và font Inter được phục vụ từ máy chủ. Hình VietQR vẫn lấy từ dịch vụ ngoài nên cần Internet để hiển thị. Thanh toán chuyển khoản/thẻ là ghi nhận do thu ngân nhập; chưa có xác nhận tự động từ ngân hàng.

## Portal tạo tenant local

Portal local tạo DB, cấu hình riêng và tự chạy POS cho từng nhà bán hàng. Chỉ cần chạy portal trên loopback:

```bash
NKIOT_SUPER_ADMIN_PASSWORD='mat-khau-it-nhat-8-ky-tu' npm run admin:local
```

Mở `http://localhost:4100`, tạo nhà bán hàng và nhấn URL POS được hiển thị. Portal tự tạo database riêng, chạy POS và khởi động Hub local khi cần; không cần chạy lệnh riêng cho từng tenant. Giữ portal chạy để POS hoạt động; khi khởi động lại portal, POS đã tạo sẽ tự chạy lại. Nếu cổng POS đã được chương trình khác dùng, chọn cổng khác. Ví dụ tenant `a` dùng `http://a.localhost:3101`; `a.localhost` giúp browser tách cookie phiên khỏi tenant khác. Dữ liệu local nằm trong `data/local-admin/`, đã được `.gitignore`; `tenant.env` chứa API key Hub và không được gửi lên browser hoặc commit.

## Nâng cấp từ bản cũ

Dừng tiến trình máy chủ cũ trước khi chạy bản mới. Lần nâng cấp schema đầu tiên tự tạo bản sao nhất quán `minikiot.db.before-v2-<timestamp>.bak` bằng SQLite trước khi sửa schema. Nếu sao lưu hoặc nâng cấp thất bại, máy chủ không tiếp tục khởi động. Không chạy đồng thời phiên bản máy chủ cũ và mới trên cùng database.

Dữ liệu nghiệp vụ không được tự thay bằng dữ liệu mẫu khi danh mục sản phẩm trống. Cache LocalStorage cũ được giữ riêng để quản trị viên tải về đối soát, không tự ghi đè database. Bản sao trước nâng cấp có thể chứa mật khẩu dạng cũ; lưu trong thư mục chỉ người quản trị máy chủ có quyền truy cập.

Hóa đơn cũ thiếu giá vốn lịch sử sẽ hiển thị **“Thiếu giá vốn lịch sử”**. Chứng từ thiếu serial hoặc có phiếu trả cũ chưa xác định đủ tiền/nợ phải được đối soát trước khi tiếp tục hoàn/hủy. Không suy đoán rồi tự sửa số liệu lịch sử.

## Lưu giao dịch và mất kết nối

- Bán, nhập, trả, hủy, chuyển kho, nhận hàng, kiểm kho, thu/chi và thanh toán công nợ được xử lý trên máy chủ trong transaction.
- Mỗi yêu cầu có mã chống xử lý lặp và revision. Dữ liệu cũ từ máy khác bị từ chối; tải lại và kiểm tra trước khi gửi lại.
- Mất phản hồi sau khi gửi: trình duyệt giữ yêu cầu chờ, đối soát lại cùng mã để tránh ghi trùng. Không xóa dữ liệu trình duyệt khi còn yêu cầu chưa rõ kết quả.
- Hệ thống **không hỗ trợ tạo giao dịch bán mới hoàn toàn offline**. Cần kết nối máy chủ để xác nhận thành công; không nhầm Internet với kết nối LAN tới máy chủ.
- Nút tải dữ liệu/đối soát và bản tải phục hồi giúp kiểm tra yêu cầu chờ hoặc bị từ chối. Giao dịch sửa nhân viên có mật khẩu không lưu mật khẩu vào hàng đợi LocalStorage; khi tải lại trang, ứng dụng hỏi máy chủ xem yêu cầu đã được ghi hay chưa.
- Giỏ hàng chưa gửi nằm trong bộ nhớ trang và không phải bản nháp được lưu bền vững. Giao dịch đã gửi nhưng chưa rõ kết quả được lưu riêng để phục hồi.

## Sao lưu và phục hồi

Tạo bản sao nhất quán, kể cả dữ liệu đã commit còn nằm trong WAL, bằng:

```bash
npm run backup -- /duong-dan/ban-sao-2026-10-20.db
```

Thư mục đích phải tồn tại và tên file phải mới. Lệnh không ghi đè file cũ. Có thể chạy khi máy chủ đang hoạt động. Giữ nhiều bản sao ở nơi khác với máy vận hành; không chỉ sao chép riêng file `.db` trong lúc đang chạy WAL.

Tạo bản sao theo vòng quay, chỉ xóa bản cũ sau khi `integrity_check` và các bảng cốt lõi được đọc thành công:

```bash
npm run backup -- --rotate /duong-dan/thu-muc-sao-luu 14
npm run backup -- --verify /duong-dan/thu-muc-sao-luu/minikiot-....db
```

Tham số cuối là số bản giữ lại, mặc định `7`. Đặt cron/systemd timer chạy lệnh rotation mỗi ngày. Sao chép thư mục snapshot đã kiểm tra sang máy/vùng lưu trữ khác; kiểm thử phục hồi định kỳ trên đường dẫn database tạm.

Phục hồi:

1. Dừng toàn bộ tiến trình đang sử dụng database.
2. Giữ nguyên bộ file hiện tại (`.db`, `-wal`, `-shm`) trong một thư mục lưu riêng để có thể quay lại.
3. Chép bản sao cần phục hồi thành một file `.db` mới, ở đường dẫn không có WAL/SHM cũ cùng tên.
4. Chạy `npm run backup -- --verify /duong-dan/file-phuc-hoi.db`, đặt `MINIKIOT_DB_PATH` trỏ tới file phục hồi và chạy máy chủ. Kiểm tra số lượng chứng từ, tồn kho và công nợ trước khi tiếp tục bán.

Nút xuất JSON trong giao diện chỉ xuất dữ liệu tài khoản được phép xem và không có mật khẩu. Đó không phải bản sao đầy đủ để khôi phục máy chủ.

## Nhập hàng nhanh

- Phiếu nhập dùng màn hình rộng: hàng nhập bên trái, thanh toán bên phải; điện thoại dùng một cột, nút hoàn thành cố định phía dưới.
- Kho nhận được chọn rõ trên phiếu; khi đang xem toàn bộ chi nhánh phải chọn kho. Nhà cung cấp không tự chọn mặc định, có tìm theo tên/mã/số điện thoại.
- Hàng thường sửa số lượng trực tiếp. Hàng IMEI tự đếm số lượng từ serial đã quét/dán; chọn lại SKU không tăng số lượng ảo. Bảng kiểm định thu gọn, ảnh và tình trạng là tùy chọn; serial mới hiển thị chưa kiểm định thay vì tự gán như mới.
- Thanh toán tách thành chưa trả, trả đủ và trả một phần. Số tiền trả một phần được giữ khi sửa hàng, giá, IMEI hoặc ảnh. Giá gợi ý là giá vốn hiện tại, không phải giá nhập gần nhất.
- Đóng phiếu đang soạn cần xác nhận. Nội dung được giữ trong cùng phiên trang/người dùng khi mở lại, **chưa lưu nháp qua reload**. Trình duyệt có cảnh báo rời trang; không thay thế backup hay lưu nháp bền vững.
- Khi chưa rõ kết quả gửi, phiếu khóa chỉnh sửa và có nút kiểm tra kết quả để đối soát cùng request ID; không lập lại phiếu mới. Sau khi lưu thành công mở chi tiết phiếu để kiểm tra/in.
- Chưa hỗ trợ giá riêng từng IMEI, nhập Excel hoặc lưu nháp đồng bộ nhiều thiết bị.

## Sửa lỗi toàn vẹn dữ liệu sau review

- Trả hàng có IMEI phải gửi/chọn đúng serial nhận lại; backend từ chối serial đã trả, ngoài hóa đơn hoặc không khớp số lượng. Hủy hóa đơn chỉ hoàn các serial chưa trả.
- Hoàn kho tính giá vốn bình quân từ giá vốn lịch sử trên hóa đơn. Chứng từ thiếu giá vốn hoặc lịch sử serial phải đối soát trước; không tự sửa chứng từ cũ.
- Quản lý nhân viên không được đổi mật khẩu/điều chuyển tài khoản vốn thuộc chi nhánh ngoài phạm vi. Chi nhánh chính phải nằm trong danh sách chi nhánh được cấp.
- Kho chung được cập nhật sau nghiệp vụ và sửa danh mục, trước khi lưu/outbox. Danh sách IMEI công khai chỉ gồm thiết bị còn tồn; metadata lịch sử nội bộ được giữ nguyên.
- Báo cáo tồn toàn bộ chi nhánh cộng giá trị từng kho; giá đơn vị tổng hợp là bình quân gia quyền.
- Test backend có bootstrap môi trường riêng trước khi nạp ứng dụng, không kế thừa đường dẫn DB/uploads và credentials Hub vận hành.

Nâng cấp backend và tải lại trình duyệt cùng lúc. Yêu cầu trả hàng cũ đang pending không có IMEI sẽ bị từ chối nếu chưa thực thi; kiểm tra kết quả/chứng từ trước khi lập yêu cầu mới. Dữ liệu tồn/giá vốn đã sai từ trước không được tự động sửa bằng bản cập nhật này.

## Kiểm thử và bảo trì

```bash
npm ci
npm run check
npm test
npm run format:check
```

Các thư viện npm chỉ phục vụ phát triển/kiểm thử. Bộ test dùng SQLite tạm và jsdom, nối frontend tới HTTP handler thật bằng request/response giả lập; không sử dụng `minikiot.db` hiện tại. Bao gồm phân quyền, chống mất/ghi trùng giao dịch, tồn kho/IMEI, hoàn tiền/công nợ, XSS, báo cáo, migration và phục hồi bản sao. Chưa thay thế kiểm thử trên trình duyệt thật, máy in, scanner, mobile và tải lớn.

Nếu dự án nằm trên ổ mạng như SMB, việc nạp jsdom từ `node_modules` có thể quá chậm và làm test UI/integration như bị treo. Chạy kiểm thử trên bản sao ở ổ cục bộ:

```bash
verify_dir="$(mktemp -d /tmp/minikiot-verify.XXXXXX)"
git ls-files -z | rsync -a --from0 --files-from=- ./ "$verify_dir"/
cd "$verify_dir"
npm ci --ignore-scripts
npm run check
npm test
npm run format:check
```

Các module chính:

- `server.js`, `security.js`: HTTP, session, mật khẩu và quyền.
- `application.js`, `domain.js`: revision, giao dịch, validation, nghiệp vụ.
- `db.js`, `backup.js`: SQLite, migration và sao lưu.
- `constants.js`: hằng số dùng chung server/trình duyệt (chi nhánh mặc định cho bản ghi cũ, mã khách lẻ).
- `catalog-patch.js`, `client-store.js`, `ui-safety.js`: tạo thay đổi danh mục tối thiểu, kết nối, phục hồi yêu cầu, render HTML an toàn và in. Nạp `catalog-patch.js` trước `client-store.js`.
- `app-utils.js`, `app-reports.js`, `app-export.js`, `app.js`: tiện ích, báo cáo, mã vạch/xuất file và giao diện. Các script dùng chung phạm vi global, phải được nạp theo thứ tự trong `index.html`; `app.js` được nạp sau cùng.
- `data.js`: dữ liệu ví dụ cho test và mặc định khởi tạo, không phục vụ ra trình duyệt. URL `/data.js` trả về `client-store.js`.

Xem [trạng thái sửa lỗi](FIXES.md), [báo cáo review ban đầu](CODE_REVIEW.md) và [triển khai HTTPS/reverse proxy](DEPLOYMENT.md).

## Bảo mật phiên và dữ liệu vận hành

- API ghi (`POST`) sau đăng nhập yêu cầu header `X-NKiot-CSRF` (hoặc `X-MiniKiot-CSRF`), gắn với từng session. `client-store.js` tự gửi token; client/script tự viết cần lấy token từ `/api/login` hoặc `/api/data`.
- Kết quả chống ghi trùng trong `processed_requests` giữ 30 ngày. Sau đó request cũ trùng `requestId` vẫn bị chặn nhờ `audit_log`; cần đối soát chứng từ thay vì gửi lại.
- `audit_log` chưa tự xóa vì chưa có chính sách lưu trữ nghiệp vụ/pháp lý.
- Chứng từ mới giữ `time` theo giờ máy chủ để hiển thị và thêm `createdAt` ISO UTC để sắp xếp, đối soát. Dữ liệu cũ không bị suy đoán giờ UTC.
- Trạng thái hàng hóa chỉ dùng `active` / `archived`; giá trị cũ `inactive` được migrate sang `archived` khi khởi động.
- Tailwind CSS và font Inter được phục vụ từ máy chủ. Sau khi sửa class trong `index.html` hoặc các file `app*.js`, chạy `npm run assets:build` và commit `public/tailwind.css`.

## Tối ưu hiệu năng đợt 2

- Lưu danh mục dùng command `catalogPatch`: chỉ gửi các dòng thêm/sửa, ID xóa và trường thiết lập thay đổi. Không đưa lịch sử hóa đơn vào request hoặc LocalStorage pending. Dòng sửa là bản ghi đầy đủ, không phải patch từng trường; thứ tự dòng mới được server append.
- Revision, transaction, kiểm tra quyền/chi nhánh, ràng buộc nghiệp vụ và idempotency vẫn do server xử lý. Command `edit` cũ vẫn được hỗ trợ để đối soát yêu cầu đang chờ; không xóa dữ liệu trình duyệt khi nâng cấp.
- Mật khẩu trong patch nhân viên chỉ giữ trong RAM; pending/rejected trong LocalStorage không chứa mật khẩu.
- Sau giao dịch chỉ render màn hình đang mở. Chuyển trang luôn render từ store mới nhất (bao gồm hóa đơn); đăng xuất vẫn dọn các màn hình bằng render toàn bộ.
- Báo cáo dùng Map/Set thay tìm kiếm lặp; giá vốn vẫn lấy từ chứng từ lịch sử.
- Đây chưa phải cập nhật SQL trực tiếp theo command: server vẫn đọc/clone snapshot và diff các bảng khi lưu; browser vẫn giữ bản sao dữ liệu để chỉnh sửa. Phân trang và tách read-model là giai đoạn tiếp theo.

Đo lại trên dữ liệu tổng hợp, không dùng DB vận hành:

```bash
npm run bench -- 20000 5000 10
node scripts/bench-ui.js
```

Benchmark HTTP dùng handler giả lập, so sánh `edit` và `catalogPatch` trên cùng tiến trình; thời gian gồm chuẩn bị payload và xử lý phản hồi. Benchmark UI dùng jsdom so sánh render toàn bộ với refresh POS, không đo layout/paint hoặc tốc độ thiết bị thật. Không dùng kết quả này để suy ra khả năng chịu tải đồng thời.

Khi triển khai: nâng cấp/restart backend trước khi tải frontend mới vì frontend mới gửi `catalogPatch`. Giữ nguyên pending cũ để đối soát.

## Tối ưu hiệu năng đợt 3 — bán hàng

- Command `sale` dùng đường ghi SQL trực tiếp mặc định, vẫn gọi cùng hàm nghiệp vụ tính tiền, phân bổ thanh toán, tồn kho/IMEI và công nợ.
- Trong `BEGIN IMMEDIATE`, server kiểm tra phiên bản snapshot rồi chỉ clone sản phẩm trong giỏ, khách hàng được chọn và danh mục chia sẻ. Lịch sử chứng từ dùng các dòng frozen, không deep-clone toàn DB.
- Chỉ UPDATE các dòng sản phẩm/khách hàng đã clone và trạng thái chia sẻ thay đổi; INSERT hóa đơn/phiếu thu mới. Không ghi lại settings hoặc chứng từ cũ. Danh mục chia sẻ đang active vẫn được đồng bộ theo quy tắc hiện có, kể cả timestamp.
- Dùng chung bộ chuyển đổi cột với writer cũ. Nếu bảng nghiệp vụ có cột legacy khác schema hiện tại thì riêng bảng đó dùng writer diff cũ. Không thay schema hoặc tự sửa dữ liệu lịch sử.
- Audit, revision, idempotency và Hub outbox vẫn commit/rollback cùng giao dịch. Cache không được cập nhật bằng dữ liệu chưa commit; đóng DB xóa cache.
- Chưa loại bỏ quét kiểm tra JSON, quét sinh mã chứng từ, đọc lại snapshot sau commit hoặc diff response. Trả/hủy/nhập/chuyển kho và danh mục vẫn dùng đường ghi snapshot. Chưa phân trang API.

So sánh hai đường ghi trên DB tạm, chạy tuần tự để tránh cạnh tranh CPU:

```bash
NKIOT_SALE_WRITE_MODE=snapshot npm run bench -- 20000 5000 10
npm run bench -- 20000 5000 10
```

Có thể đặt `NKIOT_SALE_WRITE_MODE=snapshot` và restart server để quay lại writer cũ khi cần đối soát; không cần rollback database. Không đặt biến này từ request của client.

## Đợt 4 — danh sách hóa đơn phân trang

- `GET /api/invoices` yêu cầu session và quyền `invoices`. Tham số: `branch`, `status` (`all/completed/returned/cancelled`), `q` (tối đa 200 ký tự), `date` (các preset trên giao diện), `page` và `pageSize` (mặc định 50, tối đa 100). Tổng số và dòng kết quả đều giới hạn theo chi nhánh được phép.
- API trả summary, không có items, giá vốn hoặc thông tin tài khoản. COUNT và SELECT chạy trong cùng read transaction; thứ tự theo rowid như danh sách cũ, hóa đơn mới được prepend.
- Chuyển trang gửi revision của trang trước. Nếu dữ liệu đổi, API trả 409; UI thông báo và tải lại trang đầu. Đổi bộ lọc luôn về trang đầu. Tìm kiếm debounce 250 ms; response cũ không ghi đè kết quả mới.
- Lọc thời gian dùng chung hàm với frontend và giờ local của server. Trường thời gian cũ không parse được giữ nguyên hành vi của bộ lọc hiện tại (không tự sửa dữ liệu); ngày sai cấu trúc vẫn cần đối soát. Không dùng thời gian của browser để thay đổi chứng từ.
- Schema migration 6 chỉ thêm index chi nhánh hóa đơn và mã hóa đơn của phiếu trả. Sao lưu trước khi nâng cấp và restart backend trước khi tải frontend mới. Test EXPLAIN xác nhận index chi nhánh được sử dụng; tìm substring và lọc ngày vẫn có thể quét các dòng trong phạm vi.
- Khi mở chi tiết từ trang có revision khác store, client tải/đối soát store trước rồi mới mở chứng từ đầy đủ. Luồng bán/trả/hủy và pending không bị thay bằng summary.
- **Giới hạn:** `/api/data`, đăng nhập, báo cáo, xuất file vẫn dùng snapshot. Xuất CSV vẫn xuất toàn bộ hóa đơn thuộc chi nhánh từ snapshot hiện có, không chỉ trang/bộ lọc đang hiển thị. API dùng LIMIT/OFFSET; trang rất sâu chưa tối ưu như cursor. Session lookup vẫn có thể dựng lại snapshot nếu cache lạnh.

Benchmark `npm run bench -- 20000 5000 10` có thêm phép đo `/api/invoices` (50 dòng), không phải phép so sánh tương đương với `/api/data` vì hai endpoint trả nội dung khác nhau.

Các bước tiếp theo: API chi tiết và báo cáo riêng để bỏ lịch sử khỏi bootstrap, cursor pagination khi cần, mở rộng SQL theo nghiệp vụ, CSP cưỡng chế và kiểm thử thiết bị thật.

## POS responsive — UX bước 2

- Dưới 1024px: tìm kiếm dùng một ô duy nhất trên hàng riêng, cao 44px; các nút POS có vùng bấm tối thiểu 44×44px. Nhiều tab hóa đơn cuộn trong header, không làm tràn toàn trang.
- Điện thoại dưới 768px: chọn hàng/giỏ/thanh toán là ba màn hình. Thanh tổng tiền nằm ngoài vùng cuộn, hiện tổng số lượng và tiền sau giảm giá; nút Xem giỏ/Thanh toán chỉ chuyển màn hình, không gửi giao dịch. Giỏ trống khóa nút chuyển bước này.
- Tablet 768–1023px: danh mục dùng ba cột; khi xem giỏ hoặc thanh toán, giỏ và phần thanh toán nằm cạnh nhau. Desktop từ 1024px giữ bố cục hiện tại và tùy chọn ẩn/hiện danh mục.
- Trên mobile/tablet, phần nhập liệu thanh toán cuộn riêng; hàng nút thanh toán luôn nằm trong panel. Có dùng `100dvh` và safe-area; chưa xác nhận trên bàn phím ảo iOS/Android thực tế.
- Đã kiểm tra Chrome với viewport 320×568, 390×844, 390×480, 768×1024, 1000×700 và 1440×900 bằng dữ liệu thử, gồm giỏ dài, nhiều tab, resize và trạng thái pending. Test jsdom kiểm tra số tiền, chuyển bước không submit và bảo toàn ô tìm kiếm.
- Không thay đổi API, schema, quyền hoặc cơ chế lưu giao dịch.

## POS UX bước 3 — nhận diện, chữ và bàn phím

- POS hiển thị tên cửa hàng từ settings và chi nhánh hiện tại bằng text an toàn; tên dài tự xuống dòng. Chữ phụ trong POS/IMEI tối thiểu 12px, tăng tương phản nhãn/placeholder, tổng phải trả 24px. Không đổi theme quản lý.
- Danh mục hiển thị số sản phẩm đã tải/tổng số phù hợp, mỗi lần thêm 50 dòng. Đổi từ khóa, nhóm, người dùng hoặc chi nhánh reset giới hạn. Đây là phân lô render từ snapshot hiện có, không phải API phân trang sản phẩm.
- Thẻ hàng dùng button, có tên truy cập và focus; Enter/Space thêm hàng, giữ focus sau render. Hàng hết tồn hiển thị trạng thái nhưng khóa nút chọn.
- Phím tắt chỉ trong POS: F2 tìm hàng, F4 đơn mới, F8 tới ô nhập tiền (không lưu hóa đơn). Không chạy khi đang mở modal, đang lưu/đối soát, có pending, giữ phím hoặc dùng modifier/IME. Trên Mac có thể cần giữ Fn tùy cấu hình bàn phím.
- Chưa bổ sung lưu giỏ nháp qua reload. Vẫn cần kiểm thử screen reader, bàn phím ảo và thiết bị quầy thực tế.

## UX/UI hoàn thiện — các giai đoạn nâng cấp giao diện

Các cải tiến dưới đây không thay đổi API, schema hay cơ chế lưu giao dịch; toàn bộ được kiểm chứng bằng `npm test` (jsdom).

**Bố cục và truy cập (Accessibility)**

- Bù tỉ lệ cho `#view-pos` trên desktop (`width: calc(100vw / 1.1)`, `height: calc(100dvh / 1.1)`) để mức phóng 10% không cắt mất cạnh phải hoặc đáy khung thanh toán.
- Một `MutationObserver` duy nhất quản lý focus modal: ưu tiên `[data-autofocus]`, rồi trường nhập liệu đầu tiên, cuối cùng mới tới nút hành động; trả focus về nút đã mở modal.
- Phím tắt POS chỉ còn F2/F4/F8; F9 không còn tự động chốt đơn. `Escape` đóng modal trên cùng và xóa nhanh ô tìm kiếm đang có nội dung.
- `normalizeTitleCase()` giữ nguyên tên thương hiệu viết hoa giữa từ (`iPhone`, `iPad`, `MacBook`, `eSIM`).

**POS và giỏ hàng**

- Giỏ hàng nháp được lưu vào `sessionStorage` theo `userId` + chi nhánh và khôi phục sau khi tải lại trang; tồn kho, giá vốn và giá niêm yết được đồng bộ lại từ dữ liệu chi nhánh. Xóa nháp khi thanh toán xong hoặc đăng xuất.
- Dropdown tìm hàng và tìm khách hàng hỗ trợ `ArrowDown`/`ArrowUp`/`Enter`/`Escape` để thu ngân thao tác hoàn toàn bằng bàn phím.

**Bảng dữ liệu**

- Mọi bảng (Hàng hóa, Kiểm kho, Chuyển hàng, Hóa đơn, Nhập hàng, Khách hàng, Nhà cung cấp, Sổ quỹ) hỗ trợ sắp xếp theo cột với chỉ báo `↑`/`↓`/`↕`.
- Phân lô 50 dòng kèm nút “Xem thêm” cho Hàng hóa, Nhập hàng, Khách hàng và Sổ quỹ; đổi từ khóa, bộ lọc, chi nhánh hoặc tiêu chí sắp xếp sẽ reset về lô đầu.
- Checkbox tiêu đề chọn/bỏ chọn toàn bộ dòng hiển thị; khi có dòng được chọn, chân bảng hiện “Đã chọn X dòng · Bỏ chọn”. Trạng thái chọn tự reset khi bảng render lại.
- Nút `×` và phím `Escape` xóa nhanh từ khóa ở mọi ô tìm kiếm, gồm cả ô tìm nhà bán hàng trên cổng Super Admin.

**Lọc, đánh dấu và xuất dữ liệu**

- Dashboard có bộ chọn kỳ (tháng này, tháng trước, 7/30 ngày, hôm nay); biểu đồ, doanh thu thuần và bảng Top hàng/Top khách cập nhật theo kỳ.
- Ngôi sao đánh dấu trên Hóa đơn và Nhập hàng được lưu vào `localStorage`, kèm bộ lọc “Đã gắn sao”.
- Xuất CSV ưu tiên các dòng đang tích chọn; nếu không chọn dòng nào thì áp dụng đúng bộ lọc và từ khóa đang hiển thị (nhóm hàng, trạng thái tồn, kỳ và loại quỹ).
- Biểu đồ báo cáo có popover khi hover hoặc focus, dùng được trên thiết bị cảm ứng thay vì chỉ dựa vào tooltip mặc định.

**Super Admin**

- Thông báo trạng thái luôn hiển thị ngoài vùng ẩn của app và tự ẩn sau 4 giây; hộp thoại xác nhận dùng chung một modal thay cho `confirm()`.
- `Escape` đóng modal đang mở; bảng nhà bán hàng thu gọn nút hành động dưới 1360px.

**Chuyển trang (View transitions)**

- `switchView()` render nội dung **khi view còn ẩn**, sau đó mới reveal — tránh khung hình rỗng gây nháy.
- Chỉ animate `opacity`/`transform` (`@keyframes viewEnter`, 180ms `cubic-bezier(0.16, 1, 0.3, 1)`); không animate `filter`, `height` hay `display`.
- Bỏ hết `style.display` ghi đè: ẩn/hiện hoàn toàn bằng class (`.hidden` + `.flex`), nên không còn layout thrash mỗi lần đổi view.
- `contain: layout style` trên `.view-container` cô lập layout; **không** dùng `content-visibility` để tránh cắt shadow và sai `scrollIntoView`.
- Vị trí cuộn từng view được lưu trong `viewScrollPositions` và khôi phục khi quay lại.
- POS ⇄ Quản lý dùng fade 150ms riêng (`#pos-layout.layout-entering`), không gắn `will-change` thường trực lên `#view-pos` (tránh giữ layer 110% viewport).
- `prefers-reduced-motion: reduce` tắt toàn bộ animation; `@media print` cũng tắt.
- Dưới 480px hoặc `prefers-reduced-transparency`, `.glass-*` bỏ `backdrop-filter` để giảm chi phí paint.

**Còn lại cần kiểm thử thủ công:** screen reader, bàn phím ảo trên iOS/Android, máy quét mã vạch và máy in tem thực tế; đo cảm giác chuyển trang trên máy quầy cấu hình thấp.
