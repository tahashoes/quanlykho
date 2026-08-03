# KHO HÀNG TAHA SHOES — Quản lý hàng hóa đa kênh

Ứng dụng quản lý kho dành cho cửa hàng nhỏ và vừa, chạy độc lập trên VPS. Dữ liệu được lưu bền vững bằng SQLite, giao diện hoàn toàn bằng tiếng Việt và có phân quyền đăng nhập.

## Chức năng

- Có sẵn 6 danh mục hàng hóa: Giày, Vớ, Xịt khử mùi, Thùng Carton, Băng keo và Giấy in; ô thêm danh mục mới chỉ kích hoạt nút khi đã nhập tên.
- Biểu mẫu nhập hàng tự thay đổi trường theo danh mục. Size chỉ bắt buộc với Giày; màu sắc, phí vận chuyển, giá bán và hình ảnh chỉ hiện ở những danh mục cần dùng.
- Đơn vị mặc định được khóa theo danh mục: Giày/Vớ là đôi, Xịt khử mùi là chai, Thùng Carton là thùng, Băng keo là cuộn và Giấy in là sấp.
- Nhập lại một mã sản phẩm ngay trên cùng biểu mẫu sẽ cộng tồn và cập nhật giá nhập, phí vận chuyển bình quân; không còn màn hình “Bổ sung tồn”.
- Lịch sử nhập hàng hiển thị sản phẩm, số lượng, đơn giá, người thực hiện và thời gian cập nhật.
- Xuất nhiều đơn hàng cùng lúc cho một kênh; luồng chọn theo thứ tự kênh bán → danh mục → mã sản phẩm và hỗ trợ mọi danh mục đang có.
- Mã đơn mặc định theo mẫu `TAHA-DDMMYYYY-001` và tự tăng theo từng ngày.
- Đơn Giày tự trừ kho bộ hàng đi kèm cố định: Vớ 9.000đ, Xịt khử mùi 10.000đ, Thùng Carton 8.000đ, Băng keo 1.000đ và 1 tờ giấy in 200đ.
- Giấy in có thể nhập theo sấp; hệ thống tự quy đổi 1 sấp thành 500 tờ và trừ 1 tờ cho mỗi đơn Giày.
- Mỗi đơn có bốn tab tài chính theo đúng thứ tự DOANH THU → PHÍ SÀN → GIÁ VỐN → LỢI NHUẬN. Ô phí sàn nằm ngay trong tab PHÍ SÀN và tự quy đổi số tiền sang tỷ lệ phần trăm doanh thu.
- Sáu trạng thái đơn gồm Đang chờ lấy, Đang vận chuyển, Đã giao, Hoàn thành, Trả hàng và Hủy đơn. Hoàn thành/Trả hàng/Hủy đơn là trạng thái kết thúc; Trả/Hủy hoàn kho đúng một lần và đưa doanh thu đơn về 0.
- Hỗ trợ 6 kênh: Facebook, Zalo, TikTok, Shopee, Website và Lazada.
- Mỗi sản phẩm chính trong đơn có số lượng và giá bán riêng; sản phẩm đi kèm dùng số lượng, đơn vị và giá vốn cố định, không sửa tại lúc xuất.
- Một đợt xuất chỉ cập nhật khi toàn bộ đơn hợp lệ; nếu có một dòng sai hoặc không đủ tồn, kho không bị thay đổi.
- Lịch sử xuất hàng gom theo mã đơn, hiển thị sản phẩm chính, hàng đi kèm, phí sàn, giá vốn, lợi nhuận và trạng thái.
- Khi chọn mã sản phẩm để xuất, giao diện hiển thị ngay tên, ảnh và số lượng tồn.
- Luồng xuất hàng đi theo thứ tự kênh bán → danh mục hàng hóa → mã sản phẩm, đồng thời hiển thị size, màu sắc và đơn vị tương ứng của hàng đã nhập.
- Tồn kho giảm ngay khi xuất; không thể xuất vượt quá số lượng hiện có.
- Báo cáo theo ngày, tuần hoặc tháng:
  - doanh thu, phí sàn, giá vốn và lợi nhuận;
  - số đơn hàng bán ra;
  - tổng số lượng sản phẩm bán ra;
  - thống kê riêng từng kênh và tổng tất cả các kênh.
- Biểu đồ tròn trong Báo cáo thể hiện tỷ trọng kênh bán nhiều nhất, ít nhất trong kỳ; biểu đồ cột xếp hạng các sản phẩm bán chạy.
- Biểu đồ tròn và biểu đồ cột ở Tổng quan thống kê kênh nhiều đơn nhất, sản phẩm bán nhiều nhất và sản phẩm tồn kho nhiều nhất.
- Đăng nhập bằng số điện thoại và mật khẩu, có kiểm tra định dạng và nút hiện/ẩn mật khẩu.
- Admin có thể thêm, sửa và xóa tối đa 5 tài khoản quản lý; tên, số điện thoại và mật khẩu là bắt buộc khi tạo mới.
- Admin có thể tự đổi mật khẩu sau khi xác minh mật khẩu hiện tại; các phiên đăng nhập admin khác sẽ được đăng xuất.
- Admin có thể xóa toàn bộ sản phẩm, tồn kho, dữ liệu nhập/xuất và lịch sử sau khi nhập lại mật khẩu; tài khoản và danh mục hàng hóa được giữ nguyên.
- Số điện thoại quản lý phải có đúng 10 số, bắt đầu bằng số 0; mật khẩu tối thiểu 6 ký tự và có ít nhất một ký tự đặc biệt.
- Quản lý được nhập hàng, xuất hàng, xem tồn kho và báo cáo nhưng không được quản lý tài khoản.

Số đơn hàng được đếm theo mã đơn duy nhất, không phụ thuộc số dòng sản phẩm. Doanh thu chỉ tính sản phẩm chính. Giá vốn gồm giá nhập cộng phí vận chuyển của sản phẩm chính và toàn bộ giá cố định của hàng đi kèm. Lợi nhuận bằng doanh thu trừ phí sàn và giá vốn.

## Reset dữ liệu của bản cập nhật 03/08/2026

Trong lần khởi động đầu tiên sau khi triển khai bản cập nhật này, hệ thống tự xóa một lần toàn bộ dữ liệu nghiệp vụ cũ gồm danh mục tự tạo, sản phẩm, tồn kho, lịch sử nhập/xuất, đơn hàng, điều chỉnh kho và tài khoản quản lý. Sáu danh mục mặc định được tạo lại từ đầu. Tài khoản admin được giữ nguyên để không làm mất quyền truy cập; mọi phiên đăng nhập cũ sẽ bị đăng xuất. Các lần khởi động sau không reset lại dữ liệu.

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

Kiểm tra nhanh toàn bộ luồng danh mục, nhập/xuất hàng và đổi mật khẩu:

```bash
npm test
```

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
