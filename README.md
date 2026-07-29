# Kho Hàng — Quản lý hàng hóa đa kênh

Ứng dụng quản lý kho dành cho cửa hàng nhỏ và vừa, chạy độc lập trên VPS. Dữ liệu được lưu bền vững bằng SQLite, giao diện hoàn toàn bằng tiếng Việt và có phân quyền đăng nhập.

## Chức năng

- Thêm hàng hóa: mã sản phẩm, tên, số lượng, đơn giá nhập, giá bán và ảnh sản phẩm tùy chọn.
- Nhập thêm hàng; giá nhập bình quân được cập nhật tự động.
- Xuất hàng theo mã đơn hàng không trùng và 6 kênh: Facebook, Zalo, TikTok, Shopee, Website và Lazada.
- Khi chọn mã sản phẩm để xuất, giao diện hiển thị ngay tên, ảnh và số lượng tồn.
- Tồn kho giảm ngay khi xuất; không thể xuất vượt quá số lượng hiện có.
- Báo cáo theo ngày, tuần hoặc tháng:
  - doanh thu và lợi nhuận;
  - số đơn hàng bán ra;
  - tổng số lượng sản phẩm bán ra;
  - thống kê riêng từng kênh và tổng tất cả các kênh.
- Đăng nhập bằng số điện thoại và mật khẩu, có kiểm tra định dạng và nút hiện/ẩn mật khẩu.
- Admin có thể thêm, sửa và xóa tối đa 5 tài khoản quản lý; mỗi tài khoản gồm tên, số điện thoại và mật khẩu.
- Quản lý được nhập hàng, xuất hàng, xem tồn kho và báo cáo nhưng không được quản lý tài khoản.

Mỗi lần xác nhận **Xuất hàng** được tính là một đơn hàng. Số sản phẩm bán ra là tổng số lượng của các đơn.

## Công nghệ

- **Node.js 24**: máy chủ HTTP nhẹ, không cần phụ thuộc ngoài.
- **SQLite**: dữ liệu nằm trong một tệp, dễ sao lưu và phù hợp cửa hàng nhỏ hoặc vừa.
- **HTML/CSS/JavaScript thuần**: giao diện nhanh, không cần bước biên dịch.
- **Docker Compose**: triển khai và cập nhật bằng một lệnh.

Mật khẩu được băm bằng `scrypt`; phiên đăng nhập được lưu bằng cookie `HttpOnly`, `SameSite=Lax`.

## Chạy thử trên máy

Yêu cầu Node.js 24 trở lên:

```bash
node server.js
```

Mở `http://localhost:3000`. Khi chạy thử không đặt `NODE_ENV=production`, tài khoản mặc định là:

- Số điện thoại: `0900000000`
- Mật khẩu: `Admin@123`

Không sử dụng tài khoản mặc định này cho môi trường thực tế.

## Triển khai VPS bằng Docker

1. Cài Docker Engine và Docker Compose.
2. Clone repository và vào thư mục dự án.
3. Tạo cấu hình môi trường:

   ```bash
   cp .env.example .env
   ```

4. Mở `.env`, thay `ADMIN_PHONE` và `ADMIN_PASSWORD` bằng thông tin admin thật. Mật khẩu phải có ít nhất 8 ký tự.
5. Khởi chạy:

   ```bash
   docker compose up -d --build
   ```

6. Mở `http://IP-VPS:3000` và đăng nhập bằng tài khoản admin trong `.env`.

Khi đã cấu hình tên miền và HTTPS qua Nginx hoặc Caddy, đổi `COOKIE_SECURE=true` trong `.env` rồi chạy lại:

```bash
docker compose up -d
```

## Sao lưu

Toàn bộ dữ liệu và tài khoản nằm trong `data/quanlykho.db`. Sao chép thư mục `data/` sang vị trí an toàn để sao lưu. Nên dừng container ngắn hạn trước khi sao chép để có bản sao nhất quán:

```bash
docker compose stop
cp -r data data-backup
docker compose start
```

## Lưu ý bảo mật

- Không commit tệp `.env` lên GitHub.
- Dùng mật khẩu admin mạnh và riêng biệt.
- Đặt Nginx hoặc Caddy với HTTPS trước ứng dụng khi đưa lên Internet.
- Chỉ bật `COOKIE_SECURE=true` sau khi website đã truy cập qua HTTPS.
