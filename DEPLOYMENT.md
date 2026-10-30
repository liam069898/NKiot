# Triển khai HTTPS và reverse proxy

NKiot chỉ phục vụ HTTP. Khi dùng ngoài một LAN tin cậy, đặt máy chủ sau reverse proxy kết thúc TLS và chỉ cho proxy truy cập cổng Node.

## Hub kho chung đối tác

Hub chạy DB riêng, không dùng DB của tenant. Tenant chỉ đẩy catalog đã được chia sẻ: không có giá vốn, tồn kho chính xác, khách hàng, hóa đơn hoặc user nội bộ.

```bash
# hub.nkiot.site
HOST=127.0.0.1 PORT=4000 NKIOT_HUB_DB_PATH=/var/lib/nkiot-hub/hub.db node hub-server.js

# Chạy một lần ở máy hub. Lưu secret vào secret manager, không commit hoặc gửi cho browser.
NKIOT_HUB_DB_PATH=/var/lib/nkiot-hub/hub.db node scripts/hub-admin.js create-tenant kalo Kalo
NKIOT_HUB_DB_PATH=/var/lib/nkiot-hub/hub.db node scripts/hub-admin.js create-tenant techmotion Techmotion
NKIOT_HUB_DB_PATH=/var/lib/nkiot-hub/hub.db node scripts/hub-admin.js link kalo techmotion
```

Mỗi tenant cấu hình biến môi trường riêng:

```bash
NKIOT_HUB_URL=https://hub.nkiot.site NKIOT_HUB_API_KEY='tenant.secret' npm start
```

- `NKIOT_HUB_API_KEY` chỉ nằm trong môi trường server tenant. Không đưa vào `index.html`, bundle browser hoặc log.
- Lệnh `create-tenant` tạo secret mới, nên cũng là cách xoay secret. Cập nhật tenant trước, rồi khởi động lại service tenant.
- `link`/`unlink` bật hoặc tắt quyền xem song phương. Hub tự xác định tenant từ key; không tin tenant/owner ID từ body.
- Tenant lưu POS local trước. Mỗi commit ghi snapshot catalog công khai vào outbox cùng transaction; worker gửi tuần tự, chỉ xóa sau khi hub xác nhận, retry sau 30 giây khi lỗi hoặc restart. Danh sách đối tác cache 60 giây, có thể trả bản cache cũ tối đa 30 phút khi hub tạm lỗi.
- Hub ghi `sequence` và `digest` cuối của từng tenant. Retry cùng snapshot là idempotent; snapshot cũ bị bỏ qua. Code hiện tự rebase sequence và gửi catalog local khi Hub báo snapshot cũ/xung đột. Vì vậy khi restore phải tắt kết nối Hub, đối soát catalog local trước rồi mới bật lại; bản backup cũ có thể ghi đè catalog mới hơn trên Hub.
- `GET /health` kiểm tra hub DB. `GET /api/status` của tenant (quyền settings) trả `hub.configured`, `hub.pending`, `hub.lastSyncAt`, `hub.lastError`.
- Hub cần TLS, private network hoặc firewall chỉ cho tenant được phép. Đặt reverse proxy riêng cho `hub.nkiot.site`.
- Catalog tối đa 5.000 sản phẩm và 2 MB cho toàn bộ request JSON. POS kiểm tra trước khi đưa vào outbox; vượt giới hạn không rollback giao dịch POS, nhưng ghi lỗi bền vững tại `GET /api/status` → `hub.lastError`. Giảm số sản phẩm/chi tiết chia sẻ để tạo snapshot hợp lệ mới; catalog trên Hub chưa được cập nhật trong thời gian lỗi.
- Với snapshot cũ bị Hub từ chối 400/413/422, worker có thể thử snapshot mới hơn. Chỉ xóa các snapshot bị thay thế sau khi Hub xác nhận bản mới thành công; lỗi mạng/5xx giữ nguyên hàng đợi. Không tự chia nhỏ snapshot vì Hub coi mỗi request là toàn bộ catalog.
- IMEI công khai phản ánh thiết bị còn tồn, có thể suy ra số lượng hàng quản lý serial; không chia sẻ sản phẩm nếu thông tin này cần được giữ kín.

## Chạy ứng dụng

```bash
HOST=127.0.0.1 PORT=3000 MINIKIOT_SECURE_COOKIE=1 \
MINIKIOT_DB_PATH=/var/lib/minikiot/minikiot.db npm start
```

`MINIKIOT_SECURE_COOKIE=1` gắn cờ `Secure` cho cookie phiên. Chỉ bật khi người dùng truy cập bằng HTTPS; nếu không trình duyệt sẽ không gửi cookie.

Không mở trực tiếp cổng `3000` ra Internet. Chạy bằng tài khoản hệ thống riêng, quyền ghi chỉ cho thư mục database và backup.

## Nginx

```nginx
server {
    listen 80;
    server_name pos.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name pos.example.com;

    ssl_certificate /etc/letsencrypt/live/pos.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pos.example.com/privkey.pem;
    add_header Strict-Transport-Security "max-age=31536000" always;
    client_max_body_size 8m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

Giữ `proxy_set_header Host $host`: máy chủ so sánh `Origin` với `Host` để chặn request từ website khác. Ứng dụng chưa dùng `X-Forwarded-For` cho giới hạn đăng nhập; mọi lần thử đi qua proxy được tính theo IP proxy. Cần thêm rate limit ở proxy nếu mở ra Internet.

Bật HSTS chỉ sau khi HTTPS hoạt động ổn định trên tên miền này.

## Caddy

```caddyfile
pos.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy tự cấp/gia hạn chứng chỉ và chuyển tiếp `Host` mặc định.

## Kiểm tra sau triển khai

1. Mở `https://pos.example.com`, đăng nhập, bán thử một giao dịch trên dữ liệu thử.
2. Trong DevTools, cookie `minikiot_session` phải có `HttpOnly`, `Secure`, `SameSite=Strict`.
3. Không có request nào tới `cdn.tailwindcss.com` hoặc `fonts.googleapis.com`.
4. `http://pos.example.com` chuyển sang HTTPS; cổng `3000` không truy cập được từ ngoài máy chủ.
5. Chạy `npm run backup -- --rotate /var/backups/minikiot 14` thủ công một lần, rồi kiểm tra lại bằng `--verify`.

## Nâng cấp an toàn DB và media

- POS không còn tự copy database lỗi sang `/tmp` rồi ghi ngược. Mở DB thất bại sẽ dừng; đặt SQLite trên ổ local của server, không chạy nhiều máy trên một DB qua SMB.
- Portal chạy mỗi tenant với `NKIOT_UPLOADS_DIR=<thư-mục-tenant>/uploads`, kể cả tenant.env cũ. Bản chạy POS độc lập cần đặt biến này riêng cho từng cửa hàng.
- `/uploads/` yêu cầu phiên đăng nhập và không cache công khai. Symlink không được phục vụ. Upload không phải kho file công khai cho đối tác.
- **Trước khi khởi động lại tenant cũ:** sao lưu DB và thư mục `public/uploads`, đối soát các URL trong sản phẩm/IMEI rồi copy đúng file thuộc tenant sang thư mục uploads riêng (giữ nguyên tên). Không copy toàn bộ thư mục chung sang mọi tenant. Code không tự di chuyển vì chưa có metadata sở hữu đáng tin cậy.
- Nút backup và CLI hiện chỉ sao lưu SQLite, **không bao gồm ảnh/video**. Dừng ghi khi chụp bộ backup DB + uploads; lưu cùng nhau, kiểm tra phục hồi cả chứng từ và media. Chưa có gói backup media/manifest tự động.
- URL media tương đối `/uploads/...` của đối tác không dùng được giữa các tenant đã cách ly. Cần kho media công khai có kiểm soát hoặc proxy Hub được phân quyền ở giai đoạn tiếp theo; không mở lại toàn bộ upload để khắc phục. URL HTTPS công khai hợp lệ vẫn được hỗ trợ.
- URL media mới chỉ nhận HTTP/HTTPS không chứa credentials hoặc `/uploads/<tên-file>`. Dữ liệu cũ không tự sửa; khi sửa bản ghi chứa URL không hợp lệ cần thay URL trước khi lưu.

## Hub Media Proxy (ảnh theo từng IMEI cho hàng cũ)

Trước đây ảnh của đối tác hiển thị vỡ vì `/uploads/...` chỉ tồn tại trong tenant sở hữu. Từ migration Hub v4, ảnh đi qua Hub:

- **Lưu trữ:** `POST /v1/media` (cần API key). Thân JSON `{ path, data }` với `path` là `/uploads/<tệp>` và `data` là base64. Hub kiểm tra magic bytes (JPEG/PNG/GIF/WEBP/MP4/WEBM), giới hạn 10MB, ghi vào `NKIOT_HUB_MEDIA_DIR` (mặc định `data/hub-media`).
- **Định danh:** `id = sha256(ownerTenantId + '|' + path)[0..32]` — xác định được nên upload lặp lại **không** tạo bản ghi trùng; không cần bảng mapping.
- **Phân quyền:** `GET /v1/media/:id` chỉ cho tenant sở hữu hoặc tenant đã liên kết `status='active'`; ngoài ra trả 403. Tệp biến mất khỏi đĩa trả 410.
- **Khi chia sẻ:** tenant gọi `/api/command` với `type='shareProduct'`; `server.js` đẩy toàn bộ ảnh sản phẩm + ảnh từng IMEI lên Hub. Lỗi upload **không** làm hỏng giao dịch — chỉ ghi log.
- **Khi nhận catalog:** `partnerCatalog()` đổi `/uploads/...` → `/v1/media/<id>` cho cả `images`, `videoUrl` và `imeiDetails[serial].images`. Ảnh chưa có trên Hub giữ nguyên đường dẫn gốc.
- **Phía tenant nhận:** `hub-client.rewritePartnerMedia()` đổi tiếp `/v1/media/<id>` → `/hub-media/<id>`; `server.js` stream từ Hub kèm API key. **Browser không bao giờ thấy API key Hub.**
- **Bảo mật:** `/hub-media/` yêu cầu phiên đăng nhập, chỉ nhận id hex 32 ký tự, trả `private, max-age=86400` (id bất biến theo nội dung đường dẫn).

**Kiểm thử:** `tests/hub.test.js` xác nhận upload idempotent, đối tác liên kết tải được, tenant ngoài bị 403, media lạ 404, và rewrite proxy đúng cho cả ảnh cấp sản phẩm lẫn ảnh từng IMEI.

**Vận hành:** khi sao lưu cần gồm cả `NKIOT_HUB_MEDIA_DIR`, không chỉ `hub.db`. Mất thư mục này thì ảnh đối tác ngừng hiển thị cho tới khi tenant chia sẻ lại.


## CSP

POS và Hub gửi `Content-Security-Policy-Report-Only` để ghi nhận vi phạm, chưa chặn. Giao diện POS còn inline event handler, inline script/style. Sẽ chuyển sang `Content-Security-Policy` sau khi tách các phần này khỏi `index.html`/`app.js`. Portal quản trị local đã bật CSP thật.
