# CHANGELOG

## 2026-11-11 — v1.0 (phát hành đầu tiên)
- P0: Audit toàn bộ hazi-viet (`47dbd5f`) và HSK3.0 (`88633fc`); tài liệu kiến trúc `docs/ARCHITECTURE.md`. Không sửa hai repo gốc.
- Dashboard tĩnh mới: tổng quan hôm nay (JST, ca ngày/tối, % hoàn thành), lịch học hai ca chỉnh sửa được, 24 từ mới/ngày theo 3 nhóm 8 từ với nghe TTS và quiz chọn nghĩa, 1 bài ngữ pháp/ngày với điểm ngữ pháp + ví dụ thật, ôn tập 1–3–7–14–60 ngày neo ngày học đầu (quá hạn giữ nguyên, sai → ôn bổ sung + đánh dấu yếu), thống kê trí nhớ theo kết quả kiểm tra thật, lưu IndexedDB + xuất/nhập sao lưu dạng gộp.
- Kiểm thử: 12 test logic/dữ liệu đạt (`tests/core.test.mjs`).

## 2026-11-11 — v1.1 (bug fix, UX học tập, an toàn dữ liệu)
- P0: Quiz luôn cập nhật SRS item ngay (kể cả sau khi đã tự đánh dấu đủ) + lưu lịch sử mọi lần kiểm tra; loại ôn tường minh regular/extra (trùng ngày không còn nhầm); ôn trễ không hiện lại cùng ngày, không tạo hạn quá khứ; trạng thái hoàn thành chương trình + tự nhận bài mới; migration V1.0 → V1.1 không mất dữ liệu.
- UX: thẻ "Việc tiếp theo" + tổng kết cuối ngày ở trang Hôm nay; quiz 4 dạng (Hán tự→nghĩa, nghĩa→Hán tự, nghe→chọn từ, Hán tự→Pinyin, có trộn) + bộ lọc nhóm từ; ôn tập theo ưu tiên quá hạn→hay sai→đến hạn→bổ sung, lọc từ/ngữ pháp, mỗi lượt tối đa 10 mục; thống kê thêm tỷ lệ đúng, chuỗi ngày học, tiến độ tuần.
- An toàn: nhập sao lưu có 2 chế độ gộp/thay thế (thay thế phải xác nhận; file lỗi bị chặn trước khi chạm dữ liệu); Service Worker network-first + cache dự phòng offline; một nguồn dữ liệu lỗi không sập app; tự tải lại khi qua 00:00 JST.
- Kiểm thử: 22 test đạt (10 test V1.1 mới + hồi quy V1.0 + adapter dữ liệu thật).
