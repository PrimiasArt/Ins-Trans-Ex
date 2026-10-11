# Instagram Live Translator (Microsoft Edge Extension) — v1.3.0

Extension side panel dịch song song hội thoại Instagram Direct theo thời gian
thực, dùng Gemini API.

## Tính năng
- Khi có người nhắn tới trong hội thoại Instagram Direct đang mở, extension tự
  phát hiện ngôn ngữ nguồn và dịch sang ngôn ngữ bạn cấu hình, hiển thị trong
  side panel.
- Ô soạn tin trong side panel: gõ tin nhắn của bạn, dịch sang ngôn ngữ đích
  khác (cấu hình riêng), sau đó **Copy** hoặc **Chèn vào khung chat** để gửi.
- Cài đặt Gemini API key, model, và 2 ngôn ngữ đích (đến / đi) trong trang
  Settings.
- **Lịch sử dịch được lưu tự động** (`chrome.storage.local`) — đóng/mở lại
  side panel không mất dữ liệu. Bấm 🕘 để xem toàn bộ lịch sử, có nút "Xoá
  lịch sử" để xoá hẳn nếu muốn.
- **Nút ⟳ (Reload)** chỉ xoá khung chat đang hiển thị cho gọn mắt — không
  đụng tới lịch sử đã lưu; lịch sử đầy đủ vẫn xem được qua 🕘.
- **Hướng dẫn phong cách dịch tuỳ chỉnh** trong Settings — mô tả văn phong,
  cách xưng hô, mức trang trọng mong muốn; áp dụng cho mọi bản dịch (tin đến,
  tin đi) và cả gợi ý trả lời.
- **Gợi ý trả lời (💡)** dưới mỗi tin nhắn đã dịch: bấm để Gemini tạo sẵn vài
  câu trả lời tự nhiên bằng tiếng Việt kèm bản dịch sang ngôn ngữ đối phương,
  theo đúng văn phong đã cấu hình. Bấm "Dùng câu này" để đưa thẳng vào ô soạn
  tin. Số lượng gợi ý cấu hình trong Settings (1–6).
- **Chọn ngôn ngữ bằng dropdown có ô tìm kiếm nhanh** — cả 2 ô ngôn ngữ
  trong Settings và ô "Dịch sang" ngay trong side panel đều gõ để lọc trong
  ~70 ngôn ngữ, không cần gõ tay tên ngôn ngữ nữa.
- **Dark/Light mode + màu chủ đạo tuỳ chỉnh** — chọn Sáng / Tối / Theo hệ
  thống và 1 màu accent bất kỳ (hoặc chọn nhanh từ vài màu gợi ý) trong
  Settings, áp dụng ngay cho cả side panel lẫn trang Settings.

- **[v1.3] Dịch có ngữ cảnh hội thoại** — gửi kèm N bản dịch gần nhất
  (mặc định 5, chỉnh 0–10 trong Settings) để Gemini giữ xưng hô, giọng điệu
  nhất quán.
- **[v1.3] Văn phong nhanh (persona)** — Mặc định / 💖 Thân mật / 💼 Trang
  trọng / 🤣 Gen Z / 💻 Kỹ thuật; chọn ngay trong side panel hoặc Settings,
  áp dụng thêm cùng hướng dẫn phong cách tuỳ chỉnh.
- **[v1.3] Phiên âm** — mỗi bản dịch kèm phiên âm (romanize/IPA) của câu
  tiếng nước ngoài, để đọc được tin nhắn.
- **[v1.3] 🔊 Đọc to** câu gốc / bản dịch bằng giọng đọc của trình duyệt.
- **[v1.3] 📸 Dịch ảnh (OCR)** — chuột phải vào ảnh trên Instagram → "Dịch
  chữ trong ảnh này", bấm 📋 Dán & dịch khi clipboard đang có ảnh (chụp màn
  hình Win+Shift+S, "Sao chép hình ảnh"...), bấm 📸 chọn file, hoặc dán ảnh
  (Ctrl+V) vào ô soạn tin.
- **[v1.3] 📋 Dán & dịch** — copy tin nhắn **hoặc ảnh** rồi bấm 1 nút để
  dịch như tin ĐẾN; tự nhận biết clipboard là ảnh hay chữ (ưu tiên ảnh).
- **[v1.3] 🎨 3 phong cách cho tin ĐI** — thân mật / trang trọng / súc tích,
  bấm "Dùng câu này" để thay bản dịch.
- **[v1.3] Ctrl+Enter** trong ô soạn tin = dịch xong chèn luôn vào khung chat.
- **[v1.3]** Xoá từng mục trong 🕘 lịch sử; lịch sử tự bỏ bản dịch trùng; ghi
  lịch sử tuần tự (không mất mục khi nhiều bản dịch xong cùng lúc); API key
  gửi qua header `x-goog-api-key` thay vì query string.

## Cài đặt (Microsoft Edge)
1. Mở `edge://extensions`.
2. Bật **Developer mode** (Chế độ dành cho nhà phát triển — thanh bên trái).
3. Chọn **Load unpacked** (Tải tiện ích đã giải nén), trỏ tới thư mục `ig-translator-edge` này.
   Cần Edge 114 trở lên (hỗ trợ side panel cho extension).
4. Ghim icon extension lên toolbar, bấm vào icon để mở side panel.
5. Bấm nút ⚙ trong side panel (hoặc chuột phải icon → Options) để nhập:
   - **Gemini API Key** — lấy tại https://aistudio.google.com/apikey
   - **Model** — ví dụ `gemini-2.5-flash` (chọn từ dropdown (bấm Tải danh sách sau khi nhập API key để lấy danh sách model mới nhất — không cần cập nhật extension khi Google ra model mới)
   - **Ngôn ngữ đích cho tin ĐẾN** — vd `Vietnamese`
   - **Ngôn ngữ đích cho tin ĐI** — vd `English`
   - **Hướng dẫn phong cách dịch** (tuỳ chọn) — vd "xưng em - anh, giọng thân
     mật, lịch sự"
   - **Văn phong dịch mặc định**, **Số lượt hội thoại gửi kèm làm ngữ cảnh**
   - **Số lượng câu trả lời gợi ý** — mặc định 3
6. Mở `instagram.com/direct/...`, chọn 1 hội thoại, mở side panel song song.

## Cách hoạt động
- `content.js` chạy trên trang Instagram Direct, dùng `MutationObserver` theo
  dõi khung tin nhắn, phát hiện tin nhắn mới và phân biệt tin ĐẾN/ĐI bằng
  heuristic (vị trí căn trái/phải).
- Khi có tin ĐẾN mới, nó gửi text về `background.js` (service worker).
- `background.js` gọi Gemini API (`generateContent`) để phát hiện ngôn ngữ +
  dịch, rồi đẩy kết quả sang side panel qua `chrome.runtime.sendMessage`.
- Side panel (`sidepanel.js`) hiển thị danh sách tin đã dịch, và có ô soạn
  tin gọi ngược `TRANSLATE_OUTGOING` để dịch tin bạn gõ.
- Nút "Chèn vào khung chat" gửi message `INSERT_TO_CHAT` → background dùng
  `chrome.scripting.executeScript` gọi hàm `window.__igtInsertText` mà
  `content.js` đã định nghĩa sẵn trên trang Instagram.
- Mọi bản dịch (tin đến, tin đi) được `background.js` lưu vào
  `chrome.storage.local` (khoá `igt_history`, tối đa 300 mục gần nhất) ngay
  khi dịch xong — độc lập với việc side panel có đang mở hay không.
- Side panel nạp lại feed từ `igt_history` mỗi lần mở, lọc theo mốc thời gian
  `igt_feed_cleared_at` (được set khi bấm nút ⟳) để "làm sạch" khung chat
  hiện tại mà không xoá dữ liệu gốc. Overlay 🕘 đọc thẳng toàn bộ
  `igt_history`, không qua bộ lọc này.
- Nút "💡 Gợi ý trả lời" gửi message `SUGGEST_REPLIES` (kèm tin gốc + bản
  dịch) → `background.js` gọi Gemini sinh N câu trả lời (tiếng Việt + bản
  dịch), lưu kèm vào đúng mục lịch sử tương ứng rồi trả về cho side panel.
- `langselect.js` (dùng chung cho `sidepanel.html` + `options.html`) định
  nghĩa danh sách ~70 ngôn ngữ (`IGT_LANGUAGES`) và component combobox
  `createLangSelect()` — gõ để lọc, click hoặc Enter để chọn.
- `theme.js` load sớm nhất (đầu `<head>`) ở cả 2 trang, đọc `theme` +
  `accentColor` từ `chrome.storage.sync`, set `document.documentElement.
  dataset.theme` và biến CSS `--accent`; lắng nghe cả `storage.onChanged`
  lẫn thay đổi `prefers-color-scheme` của hệ điều hành khi đang ở chế độ
  "Theo hệ thống".

- **[v1.3]** Message mới: `TRANSLATE_INCOMING` (Dán & dịch), `TRANSLATE_IMAGE`
  (ảnh dạng data URL từ side panel), `STYLE_VARIANTS`, `DELETE_HISTORY_ITEM`,
  `CLEAR_HISTORY`, và `TRANSLATE_ERROR` (background → side panel khi dịch từ
  context menu lỗi). Mục lịch sử có thêm `phonetics`,
  `source: "image"`.
- **[v1.3]** Quyền mới: `clipboardRead` (Dán & dịch) và host
  `*.cdninstagram.com` / `*.fbcdn.net` (tải ảnh Instagram để dịch).

## ⚠️ Lưu ý quan trọng — Instagram DOM dễ thay đổi
Instagram không có API chính thức công khai cho việc đọc/gửi tin nhắn Direct,
nên extension này phải "đọc" DOM (giao diện) trực tiếp. Instagram dùng class
name bị mã hoá (hash) và **có thể đổi cấu trúc UI bất cứ lúc nào**, khiến các
selector trong `content.js` (đánh dấu `// SELECTOR:`) ngừng hoạt động. Nếu
gặp tình trạng này:
1. Mở DevTools trên trang Instagram Direct → tab Elements.
2. Xác định lại selector cho: khung chứa danh sách tin nhắn, từng dòng tin
   nhắn (`role="row"`), và ô soạn tin (`contenteditable`).
3. Cập nhật các hàm `findMessageContainer()`, `isIncomingRow()`,
   `findComposeBox()` trong `content.js`.

Vì lý do tương tự, **tính năng "Chèn vào khung chat" là best-effort** — nếu
Instagram chặn `execCommand`/thay đổi cách React quản lý input, bạn vẫn có
thể dùng nút **Copy** rồi dán tay.

## Bảo mật
- API key chỉ lưu cục bộ (`chrome.storage.sync`), extension gọi thẳng tới
  `generativelanguage.googleapis.com`, không qua server trung gian nào khác.
- Cân nhắc giới hạn (restrict) API key trong Google Cloud Console theo
  HTTP referrer / extension ID nếu muốn tăng bảo mật.

## Cấu trúc thư mục
```
ig-translator-edge/
├── manifest.json
├── background.js       # service worker: gọi Gemini API, điều phối message
├── content.js           # theo dõi DOM Instagram, chèn text vào khung chat
├── sidepanel.html/.css/.js   # UI side panel chính (feed, lịch sử, gợi ý trả lời)
├── options.html/.css/.js     # trang Settings (API key, model, ngôn ngữ, phong cách, số gợi ý, giao diện)
├── theme.js                   # áp dụng dark/light mode + màu chủ đạo (dùng chung)
├── langselect.js               # danh sách ngôn ngữ + combobox tìm kiếm (dùng chung)
└── icons/                    # icon chính thức (16/48/128)
```
