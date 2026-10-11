const feedEl = document.getElementById("feed");
const emptyStateEl = document.getElementById("emptyState");
const statusBarEl = document.getElementById("statusBar");
const composeInputEl = document.getElementById("composeInput");
const translateBtn = document.getElementById("translateBtn");
const outgoingResultEl = document.getElementById("outgoingResult");
const outgoingTextEl = document.getElementById("outgoingText");
const outgoingPhoneticsEl = document.getElementById("outgoingPhonetics");
const speakOutgoingBtn = document.getElementById("speakOutgoingBtn");
const variantsBtn = document.getElementById("variantsBtn");
const variantsPanelEl = document.getElementById("variantsPanel");
const copyBtn = document.getElementById("copyBtn");
const insertBtn = document.getElementById("insertBtn");
const openSettingsBtn = document.getElementById("openSettings");
const historyBtn = document.getElementById("historyBtn");
const reloadBtn = document.getElementById("reloadBtn");
const historyOverlayEl = document.getElementById("historyOverlay");
const historyListEl = document.getElementById("historyList");
const closeHistoryBtn = document.getElementById("closeHistoryBtn");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const exportHistoryBtn = document.getElementById("exportHistoryBtn");
const importHistoryBtn = document.getElementById("importHistoryBtn");
const importHistoryInput = document.getElementById("importHistoryInput");
const pasteTranslateBtn = document.getElementById("pasteTranslateBtn");
const imageBtn = document.getElementById("imageBtn");
const imageInputEl = document.getElementById("imageInput");
const personaSelectEl = document.getElementById("personaSelect");

const HISTORY_KEY = "igt_history";
const FEED_CLEARED_KEY = "igt_feed_cleared_at";
const MAX_IMAGE_SIDE = 1600;

let currentSettings = null;
let outgoingLangQuickSelect = null;
// Bản dịch tin ĐI đang hiển thị trong khung kết quả (để Copy/Chèn/Đọc/Phong cách).
let lastOutgoing = null;

function showStatus(msg, isError = false) {
  statusBarEl.textContent = msg;
  statusBarEl.classList.remove("hidden");
  statusBarEl.classList.toggle("error", isError);
}

function clearStatus() {
  statusBarEl.classList.add("hidden");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : str;
  return div.innerHTML;
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleString("vi-VN");
  } catch (e) {
    return "";
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function smallBtn(label, title, onClick, extraClass = "") {
  const b = el("button", `btn small ${extraClass}`.trim(), label);
  if (title) b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

function flash(btn, label, ms = 1200) {
  const prev = btn.textContent;
  btn.textContent = label;
  setTimeout(() => (btn.textContent = prev), ms);
}

// ---------------------------------------------------------------------------
// Đọc to (Text-to-Speech) bằng giọng có sẵn của trình duyệt / hệ điều hành
// ---------------------------------------------------------------------------

function speak(text, langName) {
  if (!text || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const code = window.igtLangCode(langName);
  if (code) {
    u.lang = code;
    const voices = speechSynthesis.getVoices();
    const base = code.split("-")[0];
    const voice =
      voices.find((v) => v.lang === code) ||
      voices.find((v) => v.lang.toLowerCase().startsWith(base));
    if (voice) {
      u.voice = voice;
    } else if (voices.length) {
      showStatus(
        `Máy chưa có giọng đọc ${langName}. Cài thêm giọng trong Windows Settings → Time & language → Speech.`
      );
    }
  }
  speechSynthesis.speak(u);
}
// Chrome nạp danh sách giọng bất đồng bộ — gọi trước để lần đọc đầu có sẵn.
window.speechSynthesis?.getVoices();

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function initPersonaSelect() {
  personaSelectEl.innerHTML = "";
  (window.IGT_PERSONAS || []).forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.value;
    opt.textContent = p.label;
    personaSelectEl.appendChild(opt);
  });
  personaSelectEl.addEventListener("change", async () => {
    currentSettings.personaStyle = personaSelectEl.value;
    await chrome.runtime.sendMessage({
      type: "SAVE_SETTINGS",
      settings: { personaStyle: personaSelectEl.value },
    });
  });
}

async function loadSettings() {
  const res = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  currentSettings = res?.settings || {};

  if (!outgoingLangQuickSelect) {
    outgoingLangQuickSelect = createLangSelect({
      container: document.getElementById("outgoingLangQuickSelect"),
      languages: window.IGT_LANGUAGES,
      value: currentSettings.outgoingTargetLang || "English",
      placeholder: "Ngôn ngữ...",
      onChange: async (lang) => {
        currentSettings.outgoingTargetLang = lang;
        // Chọn nhanh ở đây cũng lưu luôn làm mặc định cho lần sau.
        await chrome.runtime.sendMessage({
          type: "SAVE_SETTINGS",
          settings: { outgoingTargetLang: lang },
        });
      },
    });
  } else {
    outgoingLangQuickSelect.setValue(currentSettings.outgoingTargetLang || "English");
  }

  personaSelectEl.value = currentSettings.personaStyle || "default";

  if (!currentSettings.apiKey) {
    showStatus(
      "Chưa có Gemini API key. Nhấn ⚙ để mở Settings và nhập key.",
      true
    );
  } else {
    clearStatus();
  }
}

// ---------------------------------------------------------------------------
// Feed cards (tin nhắn ĐẾN đã dịch + tin nhắn ĐI đã dịch)
// ---------------------------------------------------------------------------

function buildMeta(item) {
  const meta = el("div", "msg-original");
  if (item.kind === "outgoing") {
    meta.appendChild(el("span", "lang-tag outgoing-tag", `Bạn → ${item.targetLang || "?"}`));
  } else {
    if (item.source === "image") meta.appendChild(el("span", "lang-tag", "📸 Ảnh"));
    meta.appendChild(el("span", "lang-tag", item.detectedLang || "?"));
  }
  if (item.latencyMs != null) {
    const latLabel = item.latencyMs === 0 ? "⚡ 0ms (cache)" : `⚡ ${item.latencyMs}ms`;
    meta.appendChild(el("span", "latency-badge", latLabel));
  }
  meta.appendChild(document.createTextNode(item.original || ""));
  return meta;
}

function buildIncomingCard(item) {
  const card = el("div", "msg-card");
  card.dataset.id = item.id;

  card.appendChild(buildMeta(item));
  if (item.phonetics) card.appendChild(el("div", "phonetics", item.phonetics));
  card.appendChild(el("div", "msg-translation", item.translation));

  const actionsEl = el("div", "msg-actions");
  actionsEl.appendChild(
    smallBtn("🔊", "Đọc to câu gốc", () => speak(item.original, item.detectedLang))
  );

  const suggestBtn = el("button", "btn small suggest-btn", "💡 Gợi ý trả lời");
  actionsEl.appendChild(suggestBtn);

  const suggestionsPanel = el("div", "suggestions-panel hidden");
  suggestBtn.addEventListener("click", () =>
    onSuggestClick(item, suggestBtn, suggestionsPanel)
  );

  card.appendChild(actionsEl);
  card.appendChild(suggestionsPanel);

  // Nếu item đã có sẵn suggestions (đọc lại từ lịch sử), hiển thị luôn.
  if (Array.isArray(item.suggestions) && item.suggestions.length) {
    suggestionsPanel.classList.remove("hidden");
    suggestionsPanel.dataset.loaded = "1";
    renderSuggestions(suggestionsPanel, item.suggestions);
  }

  return card;
}

function buildOutgoingCard(item) {
  const card = el("div", "msg-card outgoing");
  card.dataset.id = item.id;

  card.appendChild(buildMeta(item));
  card.appendChild(el("div", "msg-translation", item.translation));
  if (item.phonetics) card.appendChild(el("div", "phonetics", item.phonetics));

  const actionsEl = el("div", "msg-actions");
  actionsEl.appendChild(
    smallBtn("🔊", "Đọc to bản dịch", () => speak(item.translation, item.targetLang))
  );
  actionsEl.appendChild(
    smallBtn("Copy", "Copy bản dịch", async (e) => {
      await navigator.clipboard.writeText(item.translation || "");
      flash(e.currentTarget, "Đã copy!");
    })
  );
  card.appendChild(actionsEl);
  return card;
}

function renderCard(item) {
  if (!item) return;
  emptyStateEl.classList.add("hidden");
  // Lịch sử đã bỏ bản dịch trùng (cùng chiều, câu gốc, bản dịch) -> bỏ luôn
  // thẻ cũ trùng trong feed cho khớp.
  const sig = JSON.stringify([item.kind, item.original, item.translation]);
  feedEl.querySelectorAll(".msg-card").forEach((c) => {
    if (c.dataset.id === item.id || c.dataset.sig === sig) c.remove();
  });
  const card =
    item.kind === "outgoing" ? buildOutgoingCard(item) : buildIncomingCard(item);
  card.dataset.sig = sig;
  feedEl.appendChild(card);
  feedEl.scrollTop = feedEl.scrollHeight;
}

function clearFeedUi() {
  feedEl.querySelectorAll(".msg-card").forEach((el) => el.remove());
  emptyStateEl.classList.remove("hidden");
}

// Nạp lại feed từ lịch sử đã lưu (chỉ những mục sau lần "reload" gần nhất).
async function loadFeedFromHistory() {
  const store = await chrome.storage.local.get({
    [HISTORY_KEY]: [],
    [FEED_CLEARED_KEY]: 0,
  });
  const clearedAt = store[FEED_CLEARED_KEY] || 0;
  const items = (store[HISTORY_KEY] || []).filter(
    (it) => it.timestamp > clearedAt
  );

  clearFeedUi();
  items.forEach((it) => renderCard(it));
}

// ---------------------------------------------------------------------------
// Gợi ý trả lời
// ---------------------------------------------------------------------------

function renderSuggestions(panel, suggestions) {
  panel.innerHTML = "";
  if (!suggestions.length) {
    panel.innerHTML =
      '<div class="suggestion-error">Không tạo được gợi ý nào.</div>';
    return;
  }
  suggestions.forEach((s) => {
    const row = el("div", "suggestion-item");
    row.appendChild(el("div", "suggestion-vi", s.vi));
    row.appendChild(el("div", "suggestion-translated", s.translated));
    row.appendChild(
      smallBtn("Dùng câu này", null, () => useSuggestion(s), "primary")
    );
    panel.appendChild(row);
  });
}

function showOutgoingResult({ original, translation, phonetics, targetLang }) {
  lastOutgoing = { original, translation, phonetics, targetLang };
  outgoingTextEl.textContent = translation || "";
  outgoingPhoneticsEl.textContent = phonetics || "";
  outgoingPhoneticsEl.classList.toggle("hidden", !phonetics);
  variantsPanelEl.classList.add("hidden");
  variantsPanelEl.innerHTML = "";
  outgoingResultEl.classList.remove("hidden");
}

function useSuggestion(s) {
  composeInputEl.value = s.vi || "";
  showOutgoingResult({
    original: s.vi,
    translation: s.translated,
    phonetics: "",
    targetLang: currentSettings?.outgoingTargetLang,
  });
  outgoingResultEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function onSuggestClick(item, btn, panel) {
  // Nếu đã tải rồi, chỉ toggle hiện/ẩn thay vì gọi API lại.
  if (panel.dataset.loaded === "1") {
    panel.classList.toggle("hidden");
    return;
  }

  btn.disabled = true;
  const prevLabel = btn.textContent;
  btn.textContent = "Đang tạo gợi ý...";
  panel.classList.remove("hidden");
  panel.innerHTML =
    '<div class="suggestion-loading">Đang tạo gợi ý trả lời...</div>';

  try {
    const res = await chrome.runtime.sendMessage({
      type: "SUGGEST_REPLIES",
      original: item.original,
      detectedLang: item.detectedLang,
      translationVi: item.translation,
      messageId: item.id,
    });
    if (!res?.ok) throw new Error(res?.error || "Không tạo được gợi ý.");
    panel.dataset.loaded = "1";
    renderSuggestions(panel, res.suggestions || []);
  } catch (err) {
    panel.innerHTML = `<div class="suggestion-error">${escapeHtml(
      err.message || String(err)
    )}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = prevLabel;
  }
}

// ---------------------------------------------------------------------------
// Lịch sử dịch (overlay xem toàn bộ + xoá)
// ---------------------------------------------------------------------------

async function renderHistoryOverlay() {
  const store = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
  const items = store[HISTORY_KEY] || [];

  historyListEl.innerHTML = "";

  if (!items.length) {
    historyListEl.innerHTML =
      '<div class="empty-state">Chưa có lịch sử dịch nào.</div>';
    return;
  }

  [...items].reverse().forEach((item) => {
    const row = el("div", "history-item");

    const tag =
      item.kind === "outgoing"
        ? `Bạn → ${escapeHtml(item.targetLang || "?")}`
        : `${item.source === "image" ? "📸 " : ""}<span class="lang-tag">${escapeHtml(
            item.detectedLang || "?"
          )}</span>`;

    const latBadge =
      item.latencyMs != null
        ? `<span class="latency-badge">${item.latencyMs === 0 ? "⚡ 0ms" : `⚡ ${item.latencyMs}ms`}</span>`
        : "";

    row.innerHTML = `
      <div class="history-time">${escapeHtml(formatTime(item.timestamp))} · ${tag} ${latBadge}</div>
      <div class="history-original">${escapeHtml(item.original)}</div>
      <div class="history-translation">${escapeHtml(item.translation)}</div>
    `;
    if (item.phonetics) row.appendChild(el("div", "phonetics", item.phonetics));

    const actions = el("div", "msg-actions");
    actions.appendChild(
      smallBtn("Xoá", "Xoá mục này khỏi lịch sử", async () => {
        await chrome.runtime.sendMessage({ type: "DELETE_HISTORY_ITEM", id: item.id });
        row.remove();
        feedEl.querySelector(`.msg-card[data-id="${CSS.escape(item.id)}"]`)?.remove();
      }, "danger")
    );
    row.appendChild(actions);
    historyListEl.appendChild(row);
  });
}

historyBtn.addEventListener("click", async () => {
  historyOverlayEl.classList.remove("hidden");
  await renderHistoryOverlay();
});

closeHistoryBtn.addEventListener("click", () => {
  historyOverlayEl.classList.add("hidden");
});

clearHistoryBtn.addEventListener("click", async () => {
  if (!confirm("Xoá toàn bộ lịch sử dịch? Hành động này không thể hoàn tác.")) {
    return;
  }
  await chrome.runtime.sendMessage({ type: "CLEAR_HISTORY" });
  await chrome.storage.local.set({ [FEED_CLEARED_KEY]: 0 });
  await renderHistoryOverlay();
  clearFeedUi();
});

exportHistoryBtn.addEventListener("click", async () => {
  const store = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
  const items = store[HISTORY_KEY] || [];
  if (!items.length) {
    alert("Chưa có lịch sử dịch để xuất.");
    return;
  }
  const blob = new Blob([JSON.stringify(items, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `igt_history_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

importHistoryBtn.addEventListener("click", () => {
  importHistoryInput.click();
});

importHistoryInput.addEventListener("change", async () => {
  const file = importHistoryInput.files?.[0];
  importHistoryInput.value = "";
  if (!file) return;

  try {
    const text = await file.text();
    let data = JSON.parse(text);
    if (data && !Array.isArray(data) && Array.isArray(data.igt_history)) {
      data = data.igt_history;
    }
    if (!Array.isArray(data)) {
      throw new Error("File JSON không hợp lệ (cần là mảng chứa lịch sử dịch).");
    }

    const res = await chrome.runtime.sendMessage({
      type: "IMPORT_HISTORY",
      items: data,
    });

    if (res?.ok) {
      await renderHistoryOverlay();
      await loadFeedFromHistory();
      showStatus(`Đã nhập thành công ${res.count || data.length} mục lịch sử!`);
    } else {
      throw new Error(res?.error || "Không thể nhập lịch sử.");
    }
  } catch (err) {
    alert("Lỗi khi nhập lịch sử: " + err.message);
  }
});

// Reload = chỉ xoá khung chat đang hiển thị, KHÔNG đụng tới lịch sử đã lưu.
reloadBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({ [FEED_CLEARED_KEY]: Date.now() });
  clearFeedUi();
});

// ---------------------------------------------------------------------------
// Lắng nghe tin nhắn đến đã được background dịch sẵn (context menu / auto-scan)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "TRANSLATED_INCOMING" && message.item) {
    clearStatus();
    renderCard(message.item);
  } else if (message?.type === "TRANSLATE_ERROR") {
    showStatus(message.error || "Dịch thất bại.", true);
  }
});

// ---------------------------------------------------------------------------
// Dán & dịch (clipboard -> dịch như tin ĐẾN)
// ---------------------------------------------------------------------------

async function runBusy(btn, busyLabel, fn) {
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = busyLabel;
  clearStatus();
  try {
    await fn();
  } catch (err) {
    showStatus(err.message || String(err), true);
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

// Clipboard có ảnh (chụp màn hình, "Sao chép hình ảnh"...) -> dịch ảnh;
// có chữ -> dịch chữ. Ưu tiên ảnh vì khi copy ảnh từ web, clipboard thường
// kèm thêm HTML/URL chứ không phải nội dung tin nhắn.
async function readClipboardImage() {
  if (!navigator.clipboard.read) return null;
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith("image/"));
    if (type) return item.getType(type);
  }
  return null;
}

pasteTranslateBtn.addEventListener("click", () =>
  runBusy(pasteTranslateBtn, "Đang dịch...", async () => {
    const image = await readClipboardImage().catch(() => null);
    if (image) {
      pasteTranslateBtn.textContent = "Đang đọc ảnh...";
      await translateImage(image);
      return;
    }
    const text = (await navigator.clipboard.readText()).trim();
    if (!text) {
      throw new Error("Clipboard trống — hãy copy tin nhắn hoặc ảnh cần dịch trước.");
    }
    const res = await chrome.runtime.sendMessage({ type: "TRANSLATE_INCOMING", text });
    if (!res?.ok) throw new Error(res?.error || "Không thể dịch.");
    renderCard(res.item);
  })
);

// ---------------------------------------------------------------------------
// Dịch ảnh (chọn file hoặc dán ảnh vào ô soạn tin)
// ---------------------------------------------------------------------------

// Thu nhỏ ảnh lớn trước khi gửi để request nhẹ, nhanh hơn.
async function imageFileToDataUrl(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (e) {
    throw new Error("Không đọc được file ảnh (file hỏng hoặc định dạng không hỗ trợ).");
  }
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.9);
}

// file: File hoặc Blob ảnh (từ chọn file, dán vào ô soạn tin, hoặc clipboard).
async function translateImage(file) {
  const dataUrl = await imageFileToDataUrl(file);
  const res = await chrome.runtime.sendMessage({ type: "TRANSLATE_IMAGE", dataUrl });
  if (!res?.ok) throw new Error(res?.error || "Không dịch được ảnh.");
  renderCard(res.item);
}

function translateImageFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  return runBusy(imageBtn, "Đang đọc ảnh...", () => translateImage(file));
}

imageBtn.addEventListener("click", () => imageInputEl.click());
imageInputEl.addEventListener("change", () => {
  const file = imageInputEl.files?.[0];
  imageInputEl.value = "";
  translateImageFile(file);
});

composeInputEl.addEventListener("paste", (e) => {
  const file = [...(e.clipboardData?.items || [])]
    .find((it) => it.kind === "file" && it.type.startsWith("image/"))
    ?.getAsFile();
  if (file) {
    e.preventDefault();
    translateImageFile(file);
  }
});

// ---------------------------------------------------------------------------
// Soạn tin ĐI
// ---------------------------------------------------------------------------

// Enter để dịch nhanh (giống gửi chat); Ctrl+Enter dịch xong chèn luôn vào
// khung chat; Shift+Enter để xuống dòng như bình thường.
composeInputEl.addEventListener("keydown", async (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (translateBtn.disabled) return;
    const ok = await translateOutgoing();
    if (ok && (e.ctrlKey || e.metaKey)) insertBtn.click();
  }
});

async function translateOutgoing() {
  const text = composeInputEl.value.trim();
  if (!text) return false;

  translateBtn.disabled = true;
  translateBtn.textContent = "Đang dịch...";
  clearStatus();

  try {
    const res = await chrome.runtime.sendMessage({
      type: "TRANSLATE_OUTGOING",
      text,
      targetLang: currentSettings?.outgoingTargetLang,
    });

    if (!res?.ok) {
      throw new Error(res?.error || "Không thể dịch.");
    }

    showOutgoingResult({
      original: text,
      translation: res.result.translation,
      phonetics: res.result.phonetics,
      targetLang: res.item?.targetLang,
    });

    if (res.item) renderCard(res.item);
    return true;
  } catch (err) {
    showStatus(err.message || String(err), true);
    return false;
  } finally {
    translateBtn.disabled = false;
    translateBtn.textContent = "Dịch";
  }
}

translateBtn.addEventListener("click", () => translateOutgoing());

speakOutgoingBtn.addEventListener("click", () => {
  if (lastOutgoing) speak(lastOutgoing.translation, lastOutgoing.targetLang);
});

const VARIANT_LABELS = {
  casual: "💖 Thân mật",
  formal: "💼 Trang trọng",
  concise: "✂️ Súc tích",
};

variantsBtn.addEventListener("click", () => {
  if (!lastOutgoing?.original) return;
  if (variantsPanelEl.dataset.for === lastOutgoing.original && variantsPanelEl.childElementCount) {
    variantsPanelEl.classList.toggle("hidden");
    return;
  }
  return runBusy(variantsBtn, "Đang tạo...", async () => {
    variantsPanelEl.classList.remove("hidden");
    variantsPanelEl.innerHTML =
      '<div class="suggestion-loading">Đang tạo 3 phong cách...</div>';
    const source = lastOutgoing;
    const res = await chrome.runtime.sendMessage({
      type: "STYLE_VARIANTS",
      text: source.original,
      targetLang: source.targetLang,
    });
    if (!res?.ok) {
      variantsPanelEl.innerHTML = "";
      throw new Error(res?.error || "Không tạo được phong cách.");
    }
    variantsPanelEl.innerHTML = "";
    variantsPanelEl.dataset.for = source.original;
    Object.entries(VARIANT_LABELS).forEach(([key, label]) => {
      const text = res.variants[key];
      if (!text) return;
      const row = el("div", "suggestion-item");
      row.appendChild(el("div", "suggestion-translated", label));
      row.appendChild(el("div", "suggestion-vi", text));
      row.appendChild(
        smallBtn("Dùng câu này", null, () => {
          lastOutgoing = { ...source, translation: text, phonetics: "" };
          outgoingTextEl.textContent = text;
          outgoingPhoneticsEl.classList.add("hidden");
        }, "primary")
      );
      variantsPanelEl.appendChild(row);
    });
  });
});

copyBtn.addEventListener("click", async () => {
  const text = outgoingTextEl.textContent;
  if (!text) return;
  await navigator.clipboard.writeText(text);
  flash(copyBtn, "Đã copy!");
});

insertBtn.addEventListener("click", async () => {
  const text = outgoingTextEl.textContent;
  if (!text) return;
  insertBtn.disabled = true;
  const prevLabel = insertBtn.textContent;
  insertBtn.textContent = "Đang chèn...";
  try {
    const res = await chrome.runtime.sendMessage({
      type: "INSERT_TO_CHAT",
      text,
    });
    if (!res?.ok) {
      throw new Error(
        res?.error ||
          "Không tìm thấy ô soạn tin trên Instagram. Hãy mở đúng hội thoại."
      );
    }
  } catch (err) {
    showStatus(err.message || String(err), true);
  } finally {
    insertBtn.disabled = false;
    insertBtn.textContent = prevLabel;
  }
});

openSettingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

// Refresh settings mỗi khi storage "sync" (Settings) thay đổi.
// (Lịch sử dịch nằm ở storage.local nên không kích hoạt loadSettings ở đây.)
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync") loadSettings();
});

initPersonaSelect();
loadSettings();
loadFeedFromHistory();
