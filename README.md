# Kho Hàng — Quản lý hàng hóa

Ứng dụng quản lý kho đơn giản, chạy độc lập trên VPS. Giao diện hoàn toàn bằng tiếng Việt và dữ liệu được lưu bền vững bằng SQLite.

## Chức năng

- Thêm hàng hóa: mã sản phẩm, tên, số lượng, đơn giá nhập, giá bán.
- Nhập thêm hàng cho sản phẩm đã có; giá nhập bình quân sẽ được cập nhật tự động.
- Xuất hàng theo mã sản phẩm, ghi nhận tên, số lượng và giá bán.
- Tồn kho giảm ngay khi xuất; không thể xuất vượt quá số lượng hiện có.
- Báo cáo tổng quan: doanh thu, chi phí nhập, giá vốn hàng bán, lợi nhuận, giá trị tồn, hàng sắp hết và nhật ký giao dịch.
- Mã bảo vệ API tùy chọn để bảo vệ trang khi triển khai công khai.

## Công nghệ

- **Node.js 24**: máy chủ HTTP nhẹ, không cần cài framework hay phụ thuộc ngoài.
- **SQLite**: một tệp dữ liệu duy nhất, rất phù hợp cho cửa hàng nhỏ và vừa; được lưu trên ổ đĩa VPS.
- **HTML/CSS/JavaScript thuần**: giao diện nhanh, không cần bước biên dịch, dễ bảo trì.
- **Docker Compose**: khởi chạy bằng một lệnh và dễ sao lưu/chuyển VPS.

## Chạy trên VPS bằng Docker

1. Cài Docker Engine và Docker Compose trên VPS.
2. Sao chép mã nguồn lên máy chủ (hoặc clone từ GitHub sau khi đã xuất bản).
3. Mở `compose.yaml`, đổi giá trị `INVENTORY_API_TOKEN` thành một mã bí mật mạnh.
4. Khởi chạy:

   ```bash
   docker compose up -d --build
   ```

5. Mở `http://IP-VPS:3000`, chọn **Thiết lập bảo mật** và nhập đúng mã bí mật đã đặt ở bước 3.

Sau khi thay đổi mã nguồn, cập nhật bằng:

```bash
docker compose up -d --build
```

## Sao lưu dữ liệu

Toàn bộ dữ liệu nằm trong thư mục `data/`, đặc biệt là tệp `data/quanlykho.db`. Sao chép thư mục này sang vị trí an toàn để sao lưu. Nên sao lưu khi ứng dụng ít giao dịch hoặc dừng container ngắn hạn để có một bản sao nhất quán.

## Lưu ý bảo mật khi triển khai thật

- Luôn đổi `INVENTORY_API_TOKEN`; không đưa mã bí mật vào GitHub.
- Dùng tường lửa chỉ mở cổng cần thiết hoặc đặt Nginx/Caddy với HTTPS trước ứng dụng.
- Nếu thay đổi token, người dùng cần nhập lại token tại nút **Thiết lập bảo mật**.
