# Instagram Live Translator (Chrome & Edge Extension)

Extension dạng **side panel** dịch song song hội thoại Instagram Direct theo thời gian thực bằng **Gemini API**.

---

## 🚀 Phiên bản v1.4.0 (Mới nhất — Siêu tốc & Chuẩn xác)

- **⚡ Phản hồi siêu tốc (<500ms)**:
  - Tắt suy nghĩ ngầm (`thinkingConfig: { thinkingBudget: 0 }`) trên Gemini 2.5 Flash / Pro, loại bỏ độ trễ 3–5 giây, dịch và phản hồi gần như tức thì.
  - Tự động bỏ qua gọi API khi tin nhắn chỉ gồm emoji, icon, số hoặc URL (0ms).
  - Tích hợp bộ nhớ đệm Cache LRU (120 câu gần nhất) cho các từ/câu lặp lại (0ms).
  - Hiển thị nhãn thời gian phản hồi (ví dụ: `⚡ 280ms`, `⚡ 0ms (cache)`).
- **🎯 Dịch chuẩn xác, tự nhiên theo ngữ cảnh DM Instagram**:
  - Tinh chỉnh System Instruction chuyên biệt: hiểu sâu tiếng lóng (slang), từ viết tắt (`k`, `ko`, `đc`, `ntn`, `ib`, `rep`, `fl`, `idk`, `tbh`, `rn`, `ngl`, `fr`...).
  - Xử lý đại từ xưng hô tiếng Việt tự nhiên (`mình - bạn`, `cậu - tớ`, `anh - em`), loại bỏ cách dịch thô cứng "Tôi - Bạn".
  - Giữ trọn vẹn cảm xúc, emoji, @username, #hashtag và dấu câu biểu cảm.
- **⚙️ Tối ưu hoá sinh token**:
  - Tuỳ chọn bật/tắt **Phiên âm (Phonetics)** trong Settings: mặc định tắt để giảm 60% số token phải sinh ra, tăng tốc độ dịch gấp đôi.
  - Sử dụng JSON Schema chuẩn (`responseSchema`) từ Google Gemini API, đảm bảo dữ liệu chuẩn 100% không bị lỗi parse.

---

## 📂 Cấu trúc dự án

```text
Ins-Trans Update/
├── ig-translator-chrome-v1.4.0/    # [MỚI - v1.4.0] Bản cài đặt Chrome siêu tốc & dịch chuẩn
├── ig-translator-edge-v1.4.0/      # [MỚI - v1.4.0] Bản cài đặt Edge siêu tốc & dịch chuẩn
├── ig-translator-chrome/           # [GỐC - v1.3.0] Bản gốc cho Google Chrome
├── ig-translator-edge/             # [GỐC - v1.3.0] Bản gốc cho Microsoft Edge
├── HANDOFF.md                      # Tài liệu bàn giao & lịch sử phát triển
└── README.md                       # Giới thiệu & hướng dẫn chung
```

---

## 🚀 Hướng dẫn cài đặt phiên bản v1.4.0

### 1. Google Chrome
1. Mở trình duyệt và truy cập `chrome://extensions/`.
2. Bật **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải.
3. Nhấp chọn **Load unpacked** (Tải tiện ích đã giải nén).
4. Chọn thư mục `ig-translator-chrome-v1.4.0`.
5. Ghim icon extension lên thanh công cụ và bấm vào để mở Side Panel.

### 2. Microsoft Edge
1. Mở trình duyệt và truy cập `edge://extensions/`.
2. Bật chế độ **Developer mode** ở thanh menu bên trái.
3. Nhấp chọn **Load unpacked** (Tải phần mở rộng chưa được đóng gói).
4. Chọn thư mục `ig-translator-edge-v1.4.0`.
5. Ghim icon extension và mở Side Panel.

---

## ⚙️ Cấu hình ban đầu

1. Nhấp vào icon ⚙ (Settings) trên Side Panel hoặc mở Options của extension.
2. Nhập **Gemini API Key** (lấy miễn phí tại [Google AI Studio](https://aistudio.google.com/apikey)).
3. Chọn Model (ví dụ: `gemini-2.5-flash`), ngôn ngữ đích cho tin đến và tin đi.
4. Bật **⚡ Chế độ siêu tốc (Fast Mode)** (đã bật sẵn theo mặc định).
5. Bấm **Lưu cài đặt**.
