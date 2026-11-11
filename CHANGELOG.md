# CHANGELOG

## 2026-11-11 — v1.0 (phát hành đầu tiên)
- P0: Audit toàn bộ hazi-viet (`47dbd5f`) và HSK3.0 (`88633fc`); tài liệu kiến trúc `docs/ARCHITECTURE.md`. Không sửa hai repo gốc.
- Dashboard tĩnh mới: tổng quan hôm nay (JST, ca ngày/tối, % hoàn thành), lịch học hai ca chỉnh sửa được, 24 từ mới/ngày theo 3 nhóm 8 từ với nghe TTS và quiz chọn nghĩa, 1 bài ngữ pháp/ngày với điểm ngữ pháp + ví dụ thật, ôn tập 1–3–7–14–60 ngày neo ngày học đầu (quá hạn giữ nguyên, sai → ôn bổ sung + đánh dấu yếu), thống kê trí nhớ theo kết quả kiểm tra thật, lưu IndexedDB + xuất/nhập sao lưu dạng gộp.
- Kiểm thử: 12 test logic/dữ liệu đạt (`tests/core.test.mjs`).
