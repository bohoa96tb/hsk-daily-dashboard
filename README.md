# Học tập hôm nay — HSK Daily Dashboard

Trung tâm điều phối học tiếng Trung hằng ngày, kết nối hai app hiện có mà **không sửa đổi chúng**:

- Từ vựng: [Hazi-Viet](https://bohoa96tb.github.io/hazi-viet/) — mỗi ngày 24 từ mới (1 bài, đúng thứ tự gốc).
- Ngữ pháp & hội thoại: [HSK3.0](https://bohoa96tb.github.io/HSK3.0/) — mỗi ngày 1 bài tiếp theo trong chương trình (chỉ giao 18 bài đã có nội dung thật).

Trang web: https://bohoa96tb.github.io/hsk-daily-dashboard/

## Cách dùng mỗi ngày
1. Mở Dashboard: xem ngày (giờ Nhật), ca làm việc, % hoàn thành, số lượt ôn đến hạn.
2. Theo lịch ca ngày / ca tối (sửa giờ được trong Cài đặt), học 24 từ theo 3 nhóm 8 từ, nghe phát âm, mở bài gốc khi cần.
3. Kiểm tra từ mới bằng quiz chọn nghĩa — kết quả thật quyết định thống kê trí nhớ.
4. Học 1 bài ngữ pháp, đánh dấu hoàn thành khi xong.
5. Ôn các mục đến hạn theo mốc 1–3–7–14–60 ngày (neo theo ngày học đầu tiên). Quá hạn vẫn ở đó để ôn bù; trả lời sai → thêm ôn bổ sung ngày mai và đánh dấu yếu.

## Dữ liệu & sao lưu
- Tiến độ lưu tự động trên thiết bị (IndexedDB), cài đặt ở localStorage. Có phiên bản dữ liệu (v1).
- **Chưa có đồng bộ đám mây**: dữ liệu chỉ ở trên thiết bị đang dùng. Hãy vào **Cài đặt → Xuất bản sao lưu (JSON)** định kỳ; khôi phục bằng **Nhập bản sao lưu** — nhập sẽ *gộp*, không ghi đè dữ liệu hiện có.
- Dashboard chỉ *đọc* tiến độ của hai app gốc (cùng thiết bị) để hiển thị tham khảo; không ghi đè chúng.

## Phát triển
- Logic thuần (SRS, tiến độ ngày, gộp sao lưu, adapter dữ liệu) ở `js/core.js`, `js/data.js` — kiểm thử: `AUDIT_DIR=<thư mục chứa hai repo> node tests/core.test.mjs` (phần adapter cần hai repo nguồn; các test còn lại chạy độc lập).
- Kiến trúc và kết quả audit P0: `docs/ARCHITECTURE.md`. Tiến độ triển khai: `docs/CHECKPOINT.md`, `CHANGELOG.md`.
