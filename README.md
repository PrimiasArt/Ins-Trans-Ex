# Instagram Live Translator (Chrome & Edge Extension) — v1.3.0

Extension dạng **side panel** dịch song song hội thoại Instagram Direct theo thời gian thực bằng **Gemini API**.

---

## 🌟 Tính năng nổi bật

- **Dịch song song 2 chiều (Đến & Đi)**:
  - Tự động nhận diện ngôn ngữ và dịch tin nhắn ĐẾN sang ngôn ngữ bạn muốn hiểu.
  - Ô soạn tin dịch ngược tin nhắn bạn sắp gửi sang ngôn ngữ của đối phương.
- **Dịch có ngữ cảnh (Context-aware)**: Gửi kèm N lượt hội thoại gần nhất giúp Gemini duy trì ngôi xưng và văn phong nhất quán.
- **Phong cách & Persona**:
  - Hướng dẫn phong cách tuỳ chỉnh (formality, ngôi xưng...).
  - Quick persona: Mặc định, 💖 Thân mật, 💼 Trang trọng, 🤣 Gen Z, 💻 Kỹ thuật.
  - Gợi ý 3 biến thể phong cách cho tin nhắn đi (Thân mật / Trang trọng / Súc tích).
- **Gợi ý câu trả lời thông minh (💡)**: Tự động đề xuất các câu trả lời kèm bản dịch để phản hồi nhanh.
- **Dịch ảnh (OCR) & Dán & dịch (📋)**:
  - Chuột phải vào ảnh để dịch chữ trong ảnh.
  - Dán trực tiếp ảnh hoặc chữ từ clipboard (`Ctrl+V`).
- **Phát âm & Đọc to (TTS)**: Hỗ trợ phiên âm ngữ âm và phát âm bằng giọng đọc của hệ thống/trình duyệt.
- **Lưu lịch sử dịch**: Tự động lưu tối đa 300 mục gần nhất vào `chrome.storage.local`, không mất khi tắt side panel.
- **Giao diện hiện đại**: Hỗ trợ Dark/Light mode và tuỳ chỉnh màu chủ đạo (Accent color).

---

## 📂 Cấu trúc dự án

```text
Ins-Trans Update/
├── ig-translator-chrome/    # Bản cài đặt cho Google Chrome
├── ig-translator-edge/      # Bản cài đặt cho Microsoft Edge
├── HANDOFF.md               # Tài liệu bàn giao & lịch sử phát triển
└── README.md                # Giới thiệu & hướng dẫn chung
```

---

## 🚀 Hướng dẫn cài đặt

### 1. Google Chrome
1. Mở trình duyệt và truy cập `chrome://extensions/`.
2. Bật **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải.
3. Nhấp chọn **Load unpacked** (Tải tiện ích đã giải nén).
4. Chọn thư mục `ig-translator-chrome`.
5. Ghim icon extension lên thanh công cụ và bấm vào để mở Side Panel.

### 2. Microsoft Edge
1. Mở trình duyệt và truy cập `edge://extensions/`.
2. Bật chế độ **Developer mode** ở thanh menu bên trái.
3. Nhấp chọn **Load unpacked** (Tải phần mở rộng chưa được đóng gói).
4. Chọn thư mục `ig-translator-edge`.
5. Ghim icon extension và mở Side Panel.

---

## ⚙️ Cấu hình ban đầu

1. Nhấp vào icon ⚙ (Settings) trên Side Panel hoặc mở Options của extension.
2. Nhập **Gemini API Key** (lấy miễn phí tại [Google AI Studio](https://aistudio.google.com/apikey)).
3. Chọn Model (ví dụ: `gemini-2.5-flash`), ngôn ngữ đích cho tin đến và tin đi.
4. Bấm **Lưu cài đặt**.
