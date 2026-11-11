# P0 — Audit & Kiến trúc (2026-11-11)

## 1. Kết quả audit hai repository (kiểm tra trực tiếp, không đoán)

### bohoa96tb/hazi-viet (từ vựng)
- HEAD `main` = `47dbd5fb4f0888c047886a6a84df2a2a6476625f` — Merge PR #98 (ghi chép B-016). Pages build cho SHA này: **success**.
- PR đang mở: #52, #53, #54, #55 (không thuộc phạm vi Dashboard; không chạm vào).
- Dữ liệu: `data/vocabulary/hanzii-course.json` (7,6 MB, `schemaVersion: 2`):
  - `lessons`: **94 bài** (HSK1: 21, HSK2: 32, HSK3: 41), mỗi bài tối đa 24 `wordIds`, đúng thứ tự gốc.
  - `words`: **2.234 mục** — `id` (vd `hz-h1-64d354d405bb`), `hanzi`, `intro[0].pinyin`, `meaning` (tiếng Việt), `level`, `status`.
  - Bài 1 HSK1 bắt đầu bằng từ `hz-h1-64d354d405bb` （我） — kiểm chứng trong test.
- Điều hướng sâu: `vocabulary.html?word=<id>` mở đúng từ đó (đọc mã `boot()` trong `js/vocabulary.js`); có tham số `step`.
- Tiến độ riêng của app: `localStorage` khóa `hanzi-viet-vocabulary-v1`, thẻ `{learned, favorite, step, due, reviews}`, khoảng ôn của app là [1,3,7,14,30] ngày.
- Audio: TTS `speechSynthesis` zh-CN (`js/audio.js`), không có file mp3 theo từ.
- CORS: GitHub Pages trả `Access-Control-Allow-Origin: *` cho file JSON — đọc trực tiếp được.

### bohoa96tb/HSK3.0 (ngữ pháp & hội thoại)
- HEAD `main` = `88633fc47742ab10210bf23ad3978bdb7ddb278a` — Merge PR #145. Pages build: **success**. Không có PR mở.
- Dữ liệu: `data/content.json` (2,0 MB, `contentVersion: 20261110-hsk2-wb-full30`):
  - `lessons`: 30 bài theo thứ tự chương trình (HSK1: 15, HSK2: 15).
  - Bài có nội dung thật (`publicationStatus: pilot-ready` + có content): **18 bài** — HSK1 bài 1–15, HSK2 bài 1–3. HSK2 bài 4–15 mới ở mức mục lục (`catalogued`), chưa có nội dung — Dashboard chỉ giao các bài đã sẵn sàng, không bịa bài.
  - Nội dung bài ở `pilot` (bài 1) và `additionalLessons` (17 bài còn lại): `intro.goalVi/outcomesVi/estimatedMinutes`, `knowledgePoints[]` gồm `title, explanationVi, pattern, examples[{zh, pinyin, noteVi}]`.
- Điều hướng sâu: `#/lesson/<id>` (vd `#/lesson/hsk1-l01`), có thể kèm section.
- Tiến độ riêng: `localStorage` khóa `hsk30.progress.v1` (`lessons{completedSections}`, `attempts`, `reviewItems`…).

## 2. Quyết định kiến trúc

1. **Dashboard là repo riêng** `bohoa96tb/hsk-daily-dashboard`, site tĩnh GitHub Pages. **Không sửa hai repo gốc** — không cần sửa gì ở cả hai phía.
2. **Adapter đọc dữ liệu thật** (`js/data.js`): fetch hai file JSON công khai, rút gọn thành chỉ mục nhẹ (từ: id/hanzi/pinyin/nghĩa; bài ngữ pháp: tiêu đề/mục tiêu/điểm ngữ pháp/ví dụ) và **cache 24 giờ** trong localStorage để không tải lại ~9,6 MB mỗi ngày. Cập nhật thủ công được ở Cài đặt.
3. **Tiến độ là một nguồn duy nhất của Dashboard**, lưu riêng (xem mục 3). Hai app gốc giữ nguyên cơ chế của chúng.
   - Điểm tận dụng được: cả ba site cùng origin `bohoa96tb.github.io`, nên Dashboard **đọc được (chỉ đọc)** hai khóa tiến độ của hai app trên cùng thiết bị để hiển thị tham khảo ở Thống kê. Dashboard **không bao giờ ghi** hai khóa đó — không thể gây xung đột.
4. **Thuật toán ôn tập neo theo ngày học đầu tiên** đúng ví dụ của chủ dự án: học 11/11 → hạn ôn 12/11, 14/11, 18/11, 25/11, 10/01. Trả lời sai không đổi mốc chính, mà tạo **ôn bổ sung vào ngày mai** + đánh dấu yếu. Quá hạn giữ nguyên trong nhóm "Quá hạn", không tự hoàn thành, không xóa. Chống trùng: một mục không xuất hiện ở hai nhóm; cùng một mốc không chấm hai lần trong một ngày.
5. **Trí nhớ tính từ kiểm tra thật** (quiz chọn nghĩa / tự chấm ngữ pháp có đối chiếu bài gốc). Nút tự đánh dấu "Đã nhớ" chỉ là trạng thái học trong ngày, không tạo "nhớ tốt".

## 3. Lưu trữ (P6)
- Trạng thái học: **IndexedDB** `hsk-daily-dashboard` (object store `kv`, khóa `state`), tự lùi về localStorage nếu IndexedDB lỗi. Dữ liệu có `version: 1`.
- Cài đặt nhỏ (ca, lịch): localStorage `hsk-daily-dashboard.settings-v1`.
- **Xuất/nhập JSON**: nhập theo cơ chế **gộp** — không ghi đè bản ghi hiện có; trùng lặp được khử theo khóa mục/ngày/dòng lịch sử (test `merge import keeps existing and dedupes`).
- Lưu thất bại → hiện cảnh báo và khuyên xuất sao lưu. **Không có backend: không đồng bộ giữa các thiết bị** — ghi rõ trong Cài đặt và README.

## 4. Điều hướng bài gốc (không đoán link)
- Từ vựng: `https://bohoa96tb.github.io/hazi-viet/vocabulary.html?word=<wordId>`
- Ngữ pháp: `https://bohoa96tb.github.io/HSK3.0/#/lesson/<lessonId>`
