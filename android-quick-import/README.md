# NKiot Nhập Hàng Nhanh (Android Native)

Ứng dụng Android viết bằng **Kotlin + Jetpack Compose + CameraX + ML Kit + Room**, kết nối trực tiếp máy chủ **NKiot** hiện tại (qua mạng LAN hoặc HTTPS).

## Tính năng chính

1. **Kết nối trực tiếp NKiot**:
   - Đăng nhập bằng tài khoản NKiot (`POST /api/login`), tự lưu phiên cookie `minikiot_session` và `x-nkiot-csrf`.
   - Đồng bộ danh mục sản phẩm, tồn kho, nhà cung cấp, chi nhánh và `revision` (`GET /api/data`).
   - Gửi phiếu nhập chuẩn giao dịch NKiot (`POST /api/command`, `type = "import"`) kèm chống ghi trùng (`requestId`) và đối soát kết quả (`GET /api/requests/{id}`) khi rớt mạng.
2. **Quét mã vạch SKU & IMEI/Serial liên tục bằng Camera**:
   - Dùng **CameraX + Google ML Kit** quét mã 1D/2D tốc độ cao, có đèn flash, tiếng bíp + rung phản hồi.
   - Quét SKU hàng thường: tự tăng số lượng.
   - Quét SKU hàng IMEI: tự mở chế độ quét IMEI liên tục, chặn trùng IMEI trong phiếu và IMEI đang tồn trên NKiot.
3. **Chụp ảnh & Kiểm định máy (IMEI Inspection)**:
   - Chạm vào từng IMEI để chọn tình trạng (`Mới 100%`, `Như mới`, `Tốt`, `Khá`), gắn tag nhanh (`Pin 100%`, `Zin áp`, `Đẹp keng`...), chụp ảnh trực tiếp hoặc chọn từ thư viện.
   - Ảnh được lưu cục bộ trong bản nháp, tự nén (tối đa 1600px JPEG) và tải lên `/api/upload-media` khi hoàn thành phiếu.
4. **Lưu nháp cục bộ (Offline Draft với Room SQLite)**:
   - Mọi thao tác trên phiếu đều tự động lưu vào cơ sở dữ liệu Room trên điện thoại, không mất dữ liệu khi thoát app hay mất mạng.

## Cách build file `.apk`

### Cách 1: Mở bằng Android Studio (Khuyên dùng)
1. Mở **Android Studio** -> chọn **Open** -> trỏ vào thư mục `android-quick-import/`.
2. Chờ Android Studio tự tải Gradle và SDK (API 35, JDK 17).
3. Chọn **Build -> Build Bundle(s) / APK(s) -> Build APK(s)** để xuất file `.apk` cài lên điện thoại Android, hoặc cắm cáp USB bật USB Debugging rồi bấm **Run**.

### Cách 2: Build bằng dòng lệnh (khi đã cài JDK 17 + Android SDK)
```bash
cd android-quick-import
gradle assembleDebug
# File APK xuất ra tại: app/build/outputs/apk/debug/app-debug.apk
```

## Kết nối với máy chủ NKiot trong mạng LAN
1. Trên máy tính chạy NKiot: `npm start` (mặc định lắng nghe `0.0.0.0:3000`).
2. Đảm bảo điện thoại Android và máy tính dùng chung Wi-Fi.
3. Nhập địa chỉ IP máy tính vào ứng dụng, ví dụ: `http://192.168.1.10:3000`, rồi đăng nhập bằng tài khoản NKiot có quyền `imports` (và `products` để tải ảnh kiểm định).
