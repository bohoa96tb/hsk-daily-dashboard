# CHECKPOINT — HSK Daily Dashboard

Cập nhật: 2026-11-11 (JST) — V1.1

## Đã hoàn thành
- **P0 Audit**: hazi-viet HEAD `47dbd5f` (Pages success), HSK3.0 HEAD `88633fc` (Pages success). Cấu trúc dữ liệu, ID bài, deep-link, cơ chế lưu tiến độ và audio của cả hai đã kiểm chứng trực tiếp từ mã nguồn — xem `docs/ARCHITECTURE.md`. Repo Dashboard đã tạo (public, trống lúc tạo).
- **P1 Giao diện**: mobile-first 360–430px, 6 tab (Hôm nay / Học từ / Ngữ pháp / Ôn tập / Thống kê / Cài đặt), nút ≥44px.
- **P2 Tích hợp dữ liệu thật**: adapter đọc `hanzii-course.json` (94 bài, 2.234 từ) và `content.json` (18 bài ngữ pháp có nội dung), cache chỉ mục nhẹ 24h, deep-link đúng định dạng gốc.
- **P3 Lịch ca**: mẫu ca ngày / ca tối đúng đặc tả, sửa giờ/việc/phút trực tiếp, đổi ca từng ngày + ca mặc định theo thứ trong tuần.
- **P4 Ôn tập**: mốc 1–3–7–14–60 neo ngày học đầu; nhóm hạn R1/R3/R7/R14/R60 + Quá hạn + Ôn bổ sung; sai → yếu + ôn bổ sung ngày mai; chống trùng theo ngày/mốc.
- **P5 Thống kê**: trí nhớ từ theo kết quả kiểm tra thật (Mới học / Đang ghi nhớ / Nhớ tốt / Cần củng cố / Qua 60 ngày), thống kê ngữ pháp, đọc tham khảo tiến độ hai app gốc (chỉ đọc).
- **P6 Lưu trữ**: IndexedDB + fallback localStorage, settings ở localStorage, xuất/nhập JSON gộp không ghi đè, cảnh báo khi lưu thất bại.
- **P7 Kiểm thử (logic + dữ liệu)**: 12 test Node đạt, gồm: lịch SRS đúng ví dụ 11/11→10/01; quá hạn giữ nguyên; sai→yếu+ôn bổ sung; không trùng mục ôn; chấm trùng trong ngày bị chặn; tiến độ ngày 8/24→24/24; phân loại trí nhớ không dựa nút tự đánh dấu; gộp sao lưu không ghi đè; adapter trên dữ liệu thật của cả hai repo; mẫu lịch ca; ngày theo JST.

## V1.1 (2026-11-11)
- Đã sửa 7 lỗi xác minh ở `docs/V1.1_AUDIT.md` (ghi kết quả quiz, loại ôn regular/extra, SRS ôn trễ, kết thúc chương trình, offline một nguồn lỗi, rollover JST, nhập sao lưu 2 chế độ) kèm migration tương thích ngược.
- Mới: thẻ việc tiếp theo + tổng kết ngày; quiz 4 dạng + bộ lọc; ôn tập ưu tiên + lượt 10 mục; thống kê độ chính xác/chuỗi ngày/tuần; Service Worker.
- Test: 22/22 đạt.

## Chưa hoàn thành / giới hạn đã biết
- Kiểm thử trên Android thật (mở trang, đóng/mở lại trình duyệt, viewport 390px) — cần xác minh sau khi Pages phát hành; kiểm thử logic tương ứng (lưu/tải lại, đổi ca, link gốc) đã đạt ở mức hàm trạng thái.
- HSK2 bài 4–15 của HSK3.0 chưa có nội dung nên Dashboard chỉ giao đến HSK2 bài 3; khi HSK3.0 phát hành thêm, adapter tự nhận bài mới (cache tối đa 24h).
- Chưa có đồng bộ đám mây (không backend) — sao lưu JSON thủ công là cơ chế chuyển thiết bị.
- Từ vựng HSK3 (41 bài) có trong hàng đợi sau HSK1/HSK2 theo thứ tự gốc; một số từ ở trạng thái chưa có bài chi tiết sâu trên Hazi-Viet vẫn học được ở mức thẻ (Hán tự/Pinyin/nghĩa) và mở bài gốc bình thường.
