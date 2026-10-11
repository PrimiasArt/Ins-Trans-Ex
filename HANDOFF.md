# Instagram Live Translator — Tóm tắt dự án (để tiếp tục ở hội thoại mới)

> Dán toàn bộ nội dung file này vào đầu hội thoại mới với Claude để tiếp tục
> làm việc mà không mất ngữ cảnh.

## Mục tiêu
Edge/Chrome extension dạng **side panel**, dịch song song hội thoại
Instagram Direct theo thời gian thực bằng **Gemini API**:
- Dịch tin nhắn ĐẾN sang ngôn ngữ người dùng chọn.
- Dịch tin nhắn người dùng SẮP GỬI sang ngôn ngữ đối phương (chiều ngược lại).

## Trạng thái hiện tại
Đã build xong bản chạy được (v1.2.0), vừa hoàn thành 2 đợt nâng cấp: (1) icon
thật, lưu lịch sử dịch, reload/clear view, phong cách dịch tuỳ chỉnh, gợi ý
trả lời; (2) dropdown ngôn ngữ có tìm kiếm nhanh + dark/light mode + màu chủ
đạo tuỳ chỉnh.

## Kiến trúc & file chính
```
ig-translator/               (cùng source dùng cho cả 2 bản)
├── manifest.json            Manifest V3, permissions: storage, sidePanel,
│                             scripting, tabs, contextMenus. version 1.2.0
├── background.js            Service worker — gọi Gemini API, quản lý
│                             context menu, lưu lịch sử dịch vào
│                             chrome.storage.local, điều phối message
├── content.js                Chạy trên instagram.com/direct/* — quét DOM
│                             (MutationObserver, hiện TẮT theo mặc định),
│                             và chèn text vào ô soạn tin Instagram
├── sidepanel.html/.css/.js   UI chính: feed tin đã dịch (đến + đi), overlay
│                             lịch sử, gợi ý trả lời, quick-select ngôn ngữ
│                             dịch tin đi, ô soạn tin dịch ngược
├── options.html.css/.js     Trang Settings: API key, model (dropdown), 2 ô
│                             chọn ngôn ngữ đích (combobox có tìm kiếm), toggle
│                             auto-scan, hướng dẫn phong cách dịch tuỳ chỉnh,
│                             số lượng câu trả lời gợi ý, dark/light mode +
│                             màu chủ đạo tuỳ chỉnh
├── theme.js                  Dùng chung — áp dụng dark/light mode + màu chủ
│                             đạo qua CSS variable --accent, load sớm nhất
├── langselect.js              Dùng chung — danh sách ~70 ngôn ngữ +
│                             component combobox tìm kiếm nhanh
├── icons/                    Icon chính thức 16/48/128 (logo HAWA, không còn
│                             là placeholder)
└── README.md                 Hướng dẫn cài đặt + lưu ý kỹ thuật
```
Có 2 bản build song song, **code giống hệt nhau**, chỉ khác README (phần cài
đặt + tên thư mục):
- `ig-translator-edge/` — dùng cho Microsoft Edge (`edge://extensions`)
- `ig-translator-chrome/` — dùng cho Google Chrome (`chrome://extensions`)

## Các tính năng đã hoàn thành

### Từ bản trước
1. **Dịch qua chuột phải (cách chính, ổn định):** bôi đen text trên
   Instagram → chuột phải → "Dịch với Instagram Translator" → kết quả hiện
   trong side panel. Dùng `chrome.contextMenus` API.
2. **Auto-scan DOM (tuỳ chọn, mặc định TẮT):** `content.js` dùng
   `MutationObserver` để tự bắt tin nhắn mới, độ ổn định thấp do class name
   Instagram hay đổi — để tuỳ chọn bật lại trong Settings.
3. **Ô soạn tin trong side panel:** gõ tin, Enter để dịch (Shift+Enter xuống
   dòng), **Copy** hoặc **"Chèn vào khung chat"** (best-effort qua
   `window.__igtInsertText`).
4. **Settings cơ bản:** Gemini API key, model qua dropdown (lấy trực tiếp từ
   Gemini API, nút "Tải danh sách"), ngôn ngữ đích cho tin ĐẾN/ĐI, toggle
   auto-scan.

### Mới trong đợt nâng cấp này
5. **Icon thật** — thay icon placeholder bằng logo HAWA (nguồn: file người
   dùng cung cấp `Group 254.png`), render ở 16/48/128px.
6. **Lưu lịch sử dịch (persist):**
   - Mọi bản dịch (tin ĐẾN và tin ĐI) được `background.js` lưu ngay vào
     `chrome.storage.local` (key `igt_history`, tối đa 300 mục gần nhất),
     độc lập với việc side panel có mở hay không.
   - Mở lại side panel sẽ tự nạp lại feed từ lịch sử (không còn mất khi đóng
     panel).
   - Bấm icon 🕘 trên topbar mở overlay xem **toàn bộ** lịch sử (không lọc),
     kèm nút "Xoá lịch sử" để xoá hẳn (có confirm).
7. **Nút ⟳ Reload/clear view:** chỉ set mốc `igt_feed_cleared_at` và xoá các
   card đang hiển thị trong feed hiện tại — **không đụng tới** dữ liệu gốc
   trong `igt_history`. Xem lại đầy đủ qua 🕘.
8. **Hướng dẫn phong cách dịch tuỳ chỉnh** (Settings → `customStyleInstruction`,
   textarea): mô tả văn phong, cách xưng hô, mức trang trọng mong muốn (vd
   "xưng em - anh, giọng thân mật"). Được chèn vào prompt của MỌI lệnh dịch
   (tin đến, tin đi, và gợi ý trả lời) trong `background.js`.
9. **Gợi ý trả lời (💡):**
   - Nút "💡 Gợi ý trả lời" xuất hiện dưới mỗi tin nhắn ĐẾN đã dịch.
   - Bấm lần đầu → gửi message `SUGGEST_REPLIES` tới `background.js`, gọi
     Gemini sinh N câu trả lời (mặc định 3, cấu hình 1–6 trong Settings qua
     `suggestionCount`), mỗi câu gồm `{ vi, translated }` — bản tiếng Việt và
     bản dịch sang ngôn ngữ đối phương, theo đúng phong cách đã cấu hình.
   - Kết quả được lưu kèm vào đúng mục lịch sử (`updateHistoryItem`) nên khi
     nạp lại feed từ lịch sử, các gợi ý đã tạo vẫn hiển thị sẵn (không phải
     gọi lại Gemini). Bấm nút lần 2 chỉ toggle ẩn/hiện.
   - Mỗi gợi ý có nút "Dùng câu này" → đổ thẳng vào ô soạn tin (Vietnamese)
     và ô kết quả dịch (outgoingResult), sẵn sàng Copy/Chèn vào khung chat.
10. **Chọn ngôn ngữ bằng dropdown có ô tìm kiếm nhanh (combobox):**
    - `langselect.js` định nghĩa `IGT_LANGUAGES` (~70 ngôn ngữ, tên tiếng Anh
      — Gemini hiểu tốt nhất khi dùng tên này trong prompt) và hàm dùng
      chung `createLangSelect({container, languages, value, onChange})`.
    - Dùng ở 3 nơi: 2 ô ngôn ngữ trong Settings (`incomingTargetLangSelect`,
      `outgoingTargetLangSelect`) và ô "Dịch sang" ngay trong side panel
      (`outgoingLangQuickSelect`, bản compact — style `.lang-select-compact`).
    - Quick-select trong side panel khi đổi sẽ tự lưu luôn làm
      `outgoingTargetLang` mặc định (gửi `SAVE_SETTINGS` một phần, không
      cần bấm nút Lưu ở trang Settings).
    - Component: gõ để lọc theo substring (không phân biệt hoa/thường),
      click hoặc Enter để chọn, Escape để đóng & revert, tự đóng khi click
      ra ngoài; gõ tự do không khớp lựa chọn nào sẽ tự revert khi blur
      (tránh lưu nhầm chuỗi ngôn ngữ không hợp lệ).
11. **Dark/Light mode + màu chủ đạo tuỳ chỉnh:**
    - Settings mới: `theme` (`"system" | "light" | "dark"`, mặc định
      `"system"`) và `accentColor` (hex, mặc định `#405de6`).
    - `theme.js` (dùng chung, load sớm nhất trong `<head>` cả 2 trang) đọc 2
      giá trị này từ `chrome.storage.sync`, set
      `document.documentElement.dataset.theme` (resolve "system" theo
      `prefers-color-scheme`) và biến CSS `--accent`. Lắng nghe
      `chrome.storage.onChanged` (area "sync") + sự kiện đổi
      `prefers-color-scheme` của OS để tự áp dụng lại khi đang ở chế độ
      "Theo hệ thống".
    - `sidepanel.css`/`options.css` định nghĩa toàn bộ màu qua CSS variables
      ở `:root` (light) và ghi đè ở `:root[data-theme="dark"]`; các nền màu
      "tint" theo accent (lang-tag, outgoing bubble, nút suggest...) dùng
      `color-mix(in srgb, var(--accent) X%, transparent)` thay vì mã màu cố
      định — nên tự động ăn theo màu chủ đạo người dùng chọn.
    - Trang Settings có mục "Giao diện": `<select>` chọn theme + color
      picker + vài preset màu nhanh (`ACCENT_PRESETS` trong `options.js`),
      xem trước (preview) ngay khi đổi qua `window.IGT_THEME.apply(...)`
      (từ `theme.js`), chỉ thực sự lưu khi bấm "Lưu cài đặt".

## Các lỗi đã gặp & đã fix trong quá trình build
- `Tệp kê khai bị thiếu hoặc không thể đọc được` → do Windows giải nén tạo
  thêm 1 lớp thư mục lồng nhau. Cần load đúng thư mục chứa `manifest.json`.
- `Default locale was specified, but _locales subtree is missing` → đã xoá
  field `default_locale` khỏi manifest.
- `API_KEY_INVALID` (400) → lỗi từ phía Gemini API key, không phải code.

## Giới hạn / rủi ro đã biết (quan trọng — đọc trước khi sửa tiếp)
- **Instagram không có API chính thức cho DM** → mọi thao tác đọc/chèn tin
  nhắn đều dựa vào DOM scraping (`role`, `contenteditable`, `aria-label`...),
  KHÔNG dùng class name cụ thể vì bị hash/đổi liên tục. Các hàm liên quan
  trong `content.js`: `findMessageContainer()`, `isIncomingRow()`,
  `findComposeBox()`, `window.__igtInsertText`.
- Nút "Chèn vào khung chat" vẫn là **best-effort**, luôn có nút Copy dự
  phòng.
- Model mặc định trong code (`gemini-2.5-flash`) chỉ là fallback khi chưa
  từng lưu settings.
- Side panel + content script + background giao tiếp qua
  `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage` — tính năng mới
  nên theo đúng pattern message-passing đã có (case trong switch của
  `background.js`).
- `igt_history` lưu trong `chrome.storage.local` (không phải `sync`) vì có
  thể vượt hạn mức 100KB của `sync` khi lịch sử dài — nghĩa là lịch sử KHÔNG
  đồng bộ giữa các máy, chỉ nằm trên máy/trình duyệt đã dịch.
- Giới hạn 300 mục lịch sử gần nhất (`MAX_HISTORY_ITEMS` trong
  `background.js`) — mục cũ hơn sẽ bị cắt bớt tự động, không cảnh báo người
  dùng.

## Việc CHƯA làm / có thể làm tiếp
- Xử lý trường hợp nhiều tab Instagram mở cùng lúc (hiện `INSERT_TO_CHAT`
  lấy tab active đầu tiên khớp `instagram.com`).
- Cân nhắc thêm context menu tương tự cho các nền tảng chat khác nếu người
  dùng muốn mở rộng ngoài Instagram.
- Test thực tế trên Instagram Direct hiện tại (giao diện Instagram có thể đã
  đổi so với lúc code được viết) — đặc biệt phần auto-scan.
- Có thể cân nhắc thêm tìm kiếm/lọc trong overlay lịch sử nếu danh sách dài.
- Có thể cân nhắc cảnh báo người dùng khi lịch sử sắp chạm giới hạn 300 mục.
- Combobox ngôn ngữ (`langselect.js`) chưa hỗ trợ điều hướng bằng phím mũi
  tên lên/xuống trong danh sách gợi ý (mới có Enter = chọn kết quả đầu tiên,
  Escape = đóng) — có thể bổ sung nếu cần trải nghiệm bàn phím đầy đủ hơn.
- Theme dùng CSS `color-mix()` (Chrome 111+/Edge tương đương) cho các màu
  "tint" theo accent — nếu cần hỗ trợ trình duyệt cũ hơn thì phải tính lại
  bằng JS thay vì CSS thuần.

## Thông tin cấu hình người dùng (tham khảo)
- API key: Gemini (lấy tại https://aistudio.google.com/apikey)
- Dùng song song 2 trình duyệt: Edge + Chrome (2 bộ settings riêng vì
  `chrome.storage.sync` không chia sẻ giữa 2 trình duyệt khác nhau; lịch sử
  dịch trong `chrome.storage.local` cũng vậy — mỗi trình duyệt có bản riêng)

## Cập nhật v1.3.0 (2026-09-28) — port tính năng từ app Android v4.4
Nguồn: `E:\SJ\Ins_Translator_to_Phyll_v4.4_Project` (Kotlin).
- Sửa code ở `ig-translator-chrome/` rồi copy sang `ig-translator-edge/` —
  2 bản code giống hệt, chỉ khác README (tiêu đề, phần cài đặt, tên thư mục).
  Đã test cả 2 trên Chromium và Microsoft Edge thật (Gemini giả lập).
- Zip v1.3: `ig-translator-chrome.zip`, `ig-translator-edge.zip`; bản cũ giữ
  lại dạng `*-v1.2.zip`.
- **Phạm vi extension: CHỈ tập trung dịch tin nhắn đến và đi** (quyết định
  của người dùng) — không thêm tính năng học ngôn ngữ.
- Đã port: dịch có ngữ cảnh (N lượt gần nhất), persona văn phong, phiên âm,
  TTS (speechSynthesis), dịch ảnh OCR (context menu ảnh / chọn file / dán ảnh), Dán & dịch, 3 phong
  cách cho tin đi (từ `getStyleSuggestions`), Ctrl+Enter dịch & chèn.
- KHÔNG port (không phù hợp extension / ngoài phạm vi): bong bóng nổi,
  subtitle bar, overlay opacity, và toàn bộ phần học ngôn ngữ: AI Tutor chat,
  chấm điểm phát âm, phân tích ngữ pháp, sổ từ vựng/Flashcards SRS (đã thử
  thêm rồi gỡ ra), đa ngôn ngữ giao diện, dashboard streak.
- Chi tiết message/storage mới: xem README.
