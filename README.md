# IELTS Listening Practice Suite — Chuẩn Giao diện Thi máy IDP (Vol 7 – Vol 10)

Ứng dụng web luyện thi IELTS Listening theo chuẩn giao diện phòng thi máy IDP (Computer-Delivered IELTS), sử dụng **100% file đề PDF và Audio gốc từ bộ Vol 7 – Vol 10** (tuyệt đối không dùng giọng đọc tổng hợp TTS). Hỗ trợ chạy trực tiếp trên **localhost** hoặc triển khai tĩnh qua **GitHub Pages** nhờ đường dẫn tương đối (`./data/...` và `HashRouter`).

---

## 1. Tính năng chính

- **Phòng thi IELTS Listening chuẩn IDP**:
  - Thanh đầu trang (IDP Header): Mã đề, đồng hồ đếm ngược chuẩn `30 phút nghe + 2 phút kiểm tra` hoặc chế độ `Tự do`, chỉnh âm lượng, cỡ chữ (`A- / A / A+`), 3 chế độ tương phản (`Sáng / Tối / Vàng trên đen`), và nút **`Hide`** tạm ẩn màn hình.
  - Bố cục chia đôi màn hình (**Split-Screen** kéo thả thay đổi tỷ lệ):
    - **Bên trái**: Render nguyên bản PDF gốc (`pdfjs-dist`), giữ nguyên bản đồ Map, sơ đồ Diagram, bảng biểu; cuộn độc lập, Zoom 65%–220%, nút ẩn trang Key cuối file (như Vol 7 Test 11), kèm **Ghi chú nháp (Notepad)** tự động lưu theo đề.
    - **Bên phải**: Phiếu điền đáp án 1–40 chia rõ Part 1–4, hỗ trợ `Tab` / `Enter` nhảy ô nhanh, cắm cờ (**Flag**) xem lại.
  - Thanh **Question Palette** 40 ô dưới đáy màn hình hiển thị trạng thái Chưa làm / Đã làm / Gắn cờ.
  - Trình phát Audio gốc: Chế độ **Thi thật** (phát một mạch, khóa thanh tua & tốc độ) và chế độ **Luyện tập** (tua `±5s`, tốc độ `0.75x – 1.5x`, nhảy Part 1–4).
- **Chấm điểm tự động & Giải thích chi tiết từng câu**:
  - Áp dụng quy tắc chấm IELTS (không phân biệt hoa/thường, biến thể Anh–Mỹ, gạch chéo `/`, từ tùy chọn `(...)`, ngày tháng, và nhóm câu chọn nhiều đáp án không phân biệt thứ tự).
  - Quy đổi Band IELTS Listening tham khảo, đối chiếu từng câu kèm trích dẫn Transcript, cặp **Paraphrase (Đề PDF → Audio)**, phân tích bẫy **Distractor**, nút **`Nghe lại`** nhảy đúng đoạn audio gốc và nút lưu từ vựng.
- **Module Dictation (Đoạn ngắn & Đoạn dài)**:
  - Đọc trực tiếp trên file audio gốc với 2 chế độ **Đoạn ngắn (3–10 giây)** và **Đoạn dài (20–45 giây)**.
  - Chấm lỗi so sánh từng từ (**Word-level Diff**: Đúng, Sai chính tả, Thiếu, Dư + `%` chính xác), gợi ý chữ cái/từ tiếp theo, lặp đoạn, phím tắt `Ctrl+Space`, và trình biên tập **Timestamp / Nhập `.SRT` `.VTT` `.LRC`**.
- **Bộ Flashcard & Spaced Learning (SM-2)**:
  - Kho 160+ từ vựng cốt lõi IELTS Listening + lưu từ mới trực tiếp từ Transcript/Dictation Vol 7–10.
  - 2 chế độ: **Flashcard 2 mặt** và **Kiểm tra gõ chính tả (Spelling Practice)**, chấm nhớ 4 nút `Quên / Khó / Tốt / Dễ` theo thuật toán SM-2 lưu vào IndexedDB.
- **Quản lý dữ liệu & Kiểm kê nguồn (Source Audit)**:
  - Hiển thị trạng thái đủ/thiếu cho từng Test của Vol 7, Vol 8, Vol 9, Vol 10.
  - Cho phép nạp file cục bộ (PDF, Audio, Key, Transcript/SRT) trực tiếp trên trình duyệt cho các bài thiếu (như Vol 10).

---

## 2. Cấu trúc thư mục dự án

```text
ielts-listening-idp/
├── .github/workflows/deploy.yml   # GitHub Actions tự động build & deploy GitHub Pages
├── public/data/
│   ├── manifest.json              # Bảng kiểm kê nguồn Vol 7 – Vol 10
│   ├── vocab-core.json            # Bộ từ vựng cốt lõi IELTS Listening
│   ├── vol-7/test-1..11/          # exam.pdf + audio.mp3 + data.json
│   ├── vol-8/test-1..8/           # exam.pdf (chuyển từ DOCX giữ nguyên hình) + audio.mp3 + data.json
│   ├── vol-9/test-1..9/           # exam.pdf + audio.mp3 + data.json
│   └── vol-10/README.md           # Ghi chú trạng thái thiếu file Listening của Vol 10
├── scripts/
│   ├── prepare-data.py            # Script chuẩn hóa PDF, nén nhẹ MP3 audio-only & tạo JSON
│   └── check-size.mjs             # Kiểm tra giới hạn dung lượng GitHub (50MB/100MB/950MB)
├── src/
│   ├── components/                # IdpHeader, PdfExamViewer, AnswerSheet, QuestionPalette, ExamReviewView...
│   ├── db/                        # Dexie IndexedDB (lịch sử thi, local overrides, SM-2 vocab, dictation)
│   ├── lib/                       # grading.ts, dictationDiff.ts, sm2.ts, subtitleParser.ts, dataLoader.ts
│   └── pages/                     # HomePage, ExamPage, DictationPage, VocabPage, DataManagerPage
├── .gitattributes                 # Mẫu cấu hình Git LFS (khi dùng file nặng >50MB)
├── deploy.sh / deploy.bat         # Script kiểm tra dung lượng, test, build và đẩy lên GitHub
└── vite.config.ts                 # base: './' tương thích GitHub Pages subpath
```

---

## 3. Chạy trên máy cục bộ (Localhost)

Yêu cầu: **Node.js 20+** (trên Windows PowerShell sử dụng `npm.cmd` nếuExecutionPolicy chặn `npm`).

```bash
npm.cmd install
npm.cmd run test -- --run
npm.cmd run dev
```

Mở trình duyệt tại địa chỉ Vite hiển thị (mặc định `http://localhost:5173`).

---

## 4. Tối ưu dung lượng & Triển khai lên GitHub Pages

- **Lưu ý giới hạn GitHub**: GitHub từ chối file đơn lẻ `> 100 MB` (cảnh báo `> 50 MB`) và khuyến nghị site GitHub Pages `< 1 GB`.
- Trong kho gốc, 28 file audio gồm nhiều file `.mp4` chứa track video không cần thiết (tổng `~945 MB`). Script `scripts/prepare-data.py` trích xuất 100% âm thanh gốc sang MP3 mono 64 kbps (`~11–14 MB/bài`, tổng cả kho còn dưới 400 MB) giúp giữ nguyên giọng đọc & tốc độ gốc mà vẫn chạy mượt trên GitHub Pages mà không cần Git LFS.

### Đẩy code + data bằng script tự động
- **Windows**: chạy `deploy.bat`
- **macOS / Linux**: chạy `bash deploy.sh`

### Hoặc đẩy thủ công lần đầu lên GitHub
```bash
git init -b main
node scripts/check-size.mjs
git add .
git commit -m "feat: IELTS Listening IDP practice suite (Vol 7-10)"
git remote add origin https://github.com/[ten-tai-khoan]/[ten-repo].git
git push -u origin main
```

Sau khi push, vào **Settings → Pages → Source: GitHub Actions** trên GitHub repository; workflow `.github/workflows/deploy.yml` sẽ tự động build và xuất bản web tại `https://[ten-tai-khoan].github.io/[ten-repo]/`.
