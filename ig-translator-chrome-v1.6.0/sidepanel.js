const feedEl = document.getElementById("feed");
const emptyStateEl = document.getElementById("emptyState");
const statusBarEl = document.getElementById("statusBar");
const composeInputEl = document.getElementById("composeInput");
const translateBtn = document.getElementById("translateBtn");
const outgoingResultEl = document.getElementById("outgoingResult");
const outgoingTextEl = document.getElementById("outgoingText");
const outgoingPhoneticsEl = document.getElementById("outgoingPhonetics");
const speakOutgoingBtn = document.getElementById("speakOutgoingBtn");
const pinOutgoingBtn = document.getElementById("pinOutgoingBtn");
const variantsBtn = document.getElementById("variantsBtn");
const variantsPanelEl = document.getElementById("variantsPanel");
const copyBtn = document.getElementById("copyBtn");
const insertBtn = document.getElementById("insertBtn");
const openSettingsBtn = document.getElementById("openSettings");
const syncBtn = document.getElementById("syncBtn");
const libraryBtn = document.getElementById("libraryBtn");
const historyBtn = document.getElementById("historyBtn");
const reloadBtn = document.getElementById("reloadBtn");

const libraryOverlayEl = document.getElementById("libraryOverlay");
const closeLibraryBtn = document.getElementById("closeLibraryBtn");
const exportLibraryBtn = document.getElementById("exportLibraryBtn");
const importLibraryBtn = document.getElementById("importLibraryBtn");
const importLibraryInput = document.getElementById("importLibraryInput");
const tabGlossaryBtn = document.getElementById("tabGlossaryBtn");
const tabTmBtn = document.getElementById("tabTmBtn");
const glossaryAddBox = document.getElementById("glossaryAddBox");
const glossarySourceInput = document.getElementById("glossarySourceInput");
const glossaryTargetInput = document.getElementById("glossaryTargetInput");
const glossaryDirectionSelect = document.getElementById("glossaryDirectionSelect");
const addGlossaryBtn = document.getElementById("addGlossaryBtn");
const librarySearchInput = document.getElementById("librarySearchInput");
const clearTmBtn = document.getElementById("clearTmBtn");
const libraryListEl = document.getElementById("libraryList");
const statGlossaryCount = document.getElementById("statGlossaryCount");
const statTmCount = document.getElementById("statTmCount");
const statSavedCalls = document.getElementById("statSavedCalls");

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
const MAX_FEED_CARDS = 60;
const MAX_LIBRARY_RENDER = 150;

let currentSettings = null;
let outgoingLangQuickSelect = null;
// Bản dịch tin ĐI đang hiển thị trong khung kết quả (để Copy/Chèn/Đọc/Phong cách).
let lastOutgoing = null;
let activeLibraryTab = "glossary"; // "glossary" | "tm"
let cachedLibraryData = { glossary: [], tm: [], stats: { savedApiCalls: 0 } };
let searchDebounceTimer = null;

function showStatus(msg, isError = false) {
  statusBarEl.textContent = msg;
  statusBarEl.classList.remove("hidden");
  statusBarEl.classList.toggle("error", isError);
}

function clearStatus() {
  statusBarEl.classList.add("hidden");
}

const HTML_ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
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

async function quickPinToGlossary(source, target, phonetics, btnEl) {
  if (!source || !target) return;
  try {
    const res = await chrome.runtime.sendMessage({
      type: "ADD_GLOSSARY_ITEM",
      source,
      target,
      direction: "any",
      phonetics: phonetics || "",
    });
    if (!res?.ok) throw new Error(res?.error || "Không lưu được từ.");
    if (btnEl) flash(btnEl, "✅ Đã lưu!", 1500);
  } catch (err) {
    showStatus(err.message || String(err), true);
  }
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

function buildLatencyBadgeEl(item) {
  if (item.latencyMs == null) return null;
  if (item.cacheSource === "glossary") {
    return el("span", "latency-badge library-hit", "📌 0ms (từ điển)");
  }
  if (item.cacheSource === "tm") {
    return el("span", "latency-badge library-hit", "📚 0ms (bộ nhớ từ)");
  }
  if (item.latencyMs === 0) {
    return el("span", "latency-badge", "⚡ 0ms (cache)");
  }
  return el("span", "latency-badge", `⚡ ${item.latencyMs}ms`);
}

function buildMeta(item) {
  const meta = el("div", "msg-original");
  if (item.kind === "outgoing") {
    meta.appendChild(el("span", "lang-tag outgoing-tag", `Bạn → ${item.targetLang || "?"}`));
  } else {
    if (item.source === "image") meta.appendChild(el("span", "lang-tag", "📸 Ảnh"));
    meta.appendChild(el("span", "lang-tag", item.detectedLang || "?"));
  }
  const badge = buildLatencyBadgeEl(item);
  if (badge) meta.appendChild(badge);
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
  actionsEl.appendChild(
    smallBtn("📌 Lưu từ", "Ghim câu này vào Từ điển cá nhân (lần sau dịch 0ms)", (e) =>
      quickPinToGlossary(item.original, item.translation, item.phonetics, e.currentTarget)
    )
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
    smallBtn("📌 Lưu từ", "Ghim câu này vào Từ điển cá nhân (lần sau dịch 0ms)", (e) =>
      quickPinToGlossary(item.original, item.translation, item.phonetics, e.currentTarget)
    )
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

function computeCardSig(item) {
  return `${item.kind || ""}\u0000${item.original || ""}\u0000${item.translation || ""}`;
}

function createCardElement(item) {
  const card =
    item.kind === "outgoing" ? buildOutgoingCard(item) : buildIncomingCard(item);
  card.dataset.sig = computeCardSig(item);
  return card;
}

function renderCard(item) {
  if (!item) return;
  emptyStateEl.classList.add("hidden");
  const sig = computeCardSig(item);
  const existingCards = feedEl.querySelectorAll(".msg-card");
  for (const c of existingCards) {
    if (c.dataset.id === item.id || c.dataset.sig === sig) {
      c.remove();
    }
  }
  const card = createCardElement(item);
  feedEl.appendChild(card);

  // Giới hạn số thẻ trên khung live feed để DOM luôn nhẹ & phản hồi tức thì
  const allCards = feedEl.querySelectorAll(".msg-card");
  if (allCards.length > MAX_FEED_CARDS) {
    const excess = allCards.length - MAX_FEED_CARDS;
    for (let i = 0; i < excess; i++) {
      allCards[i].remove();
    }
  }
  feedEl.scrollTop = feedEl.scrollHeight;
}

function clearFeedUi() {
  feedEl.querySelectorAll(".msg-card").forEach((el) => el.remove());
  emptyStateEl.classList.remove("hidden");
}

// Nạp lại feed từ lịch sử đã lưu (chỉ những mục sau lần "reload" gần nhất).
// Gom toàn bộ vào DocumentFragment và chỉ scroll 1 lần duy nhất (tránh 300x layout reflow).
async function loadFeedFromHistory() {
  const store = await chrome.storage.local.get({
    [HISTORY_KEY]: [],
    [FEED_CLEARED_KEY]: 0,
  });
  const clearedAt = store[FEED_CLEARED_KEY] || 0;
  const rawItems = (store[HISTORY_KEY] || []).filter(
    (it) => it.timestamp > clearedAt
  );

  // Khử trùng theo sig từ cuối lên (giữ mục mới nhất) và chỉ lấy MAX_FEED_CARDS mục cuối
  const seenSigs = new Set();
  const deduped = [];
  for (let i = rawItems.length - 1; i >= 0; i--) {
    const it = rawItems[i];
    if (!it) continue;
    const sig = computeCardSig(it);
    if (seenSigs.has(sig)) continue;
    seenSigs.add(sig);
    deduped.push(it);
    if (deduped.length >= MAX_FEED_CARDS) break;
  }
  deduped.reverse();

  clearFeedUi();
  if (!deduped.length) return;

  emptyStateEl.classList.add("hidden");
  const frag = document.createDocumentFragment();
  for (const it of deduped) {
    frag.appendChild(createCardElement(it));
  }
  feedEl.appendChild(frag);
  feedEl.scrollTop = feedEl.scrollHeight;
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
// Thư viện từ & Bộ nhớ dịch (Glossary + Translation Memory Overlay)
// ---------------------------------------------------------------------------

function directionLabel(dir) {
  if (dir === "incoming") return "📥 Tin đến";
  if (dir === "outgoing") return "📤 Tin đi";
  return "↔ 2 chiều";
}

async function refreshLibraryData() {
  const res = await chrome.runtime.sendMessage({ type: "GET_LIBRARY_DATA" });
  if (res?.ok) {
    cachedLibraryData = {
      glossary: res.glossary || [],
      tm: res.tm || [],
      stats: res.stats || { savedApiCalls: 0 },
    };
  }
  statGlossaryCount.textContent = cachedLibraryData.glossary.length;
  statTmCount.textContent = cachedLibraryData.tm.length;
  statSavedCalls.textContent = cachedLibraryData.stats?.savedApiCalls || 0;
  renderLibraryList();
}

function setLibraryTab(tab) {
  activeLibraryTab = tab;
  tabGlossaryBtn.classList.toggle("active", tab === "glossary");
  tabTmBtn.classList.toggle("active", tab === "tm");
  glossaryAddBox.classList.toggle("hidden", tab !== "glossary");
  clearTmBtn.classList.toggle("hidden", tab !== "tm");
  renderLibraryList();
}

function renderLibraryList() {
  const query = (librarySearchInput.value || "").trim().toLowerCase();
  libraryListEl.innerHTML = "";
  const frag = document.createDocumentFragment();

  if (activeLibraryTab === "glossary") {
    const filtered = cachedLibraryData.glossary.filter((g) => {
      if (!query) return true;
      return (
        (g.source || "").toLowerCase().includes(query) ||
        (g.target || "").toLowerCase().includes(query)
      );
    });

    if (!filtered.length) {
      libraryListEl.innerHTML = `<div class="empty-state">${
        query
          ? "Không tìm thấy từ vựng khớp từ khoá."
          : "Chưa có từ vựng hay câu ghim nào.<br/>Hãy thêm từ/biệt danh ở khung trên hoặc bấm <b>📌 Lưu từ</b> trên các tin nhắn đã dịch!"
      }</div>`;
      return;
    }

    const slice = filtered.slice(0, MAX_LIBRARY_RENDER);
    slice.forEach((g) => {
      const row = el("div", "history-item");
      const hits = g.hitCount ? ` · 🔥 Dùng ${g.hitCount} lần` : "";
      row.innerHTML = `
        <div class="history-time"><span class="lang-tag">${escapeHtml(
          directionLabel(g.direction)
        )}</span>${escapeHtml(hits)}</div>
        <div class="history-original">${escapeHtml(g.source)}</div>
        <div class="history-translation">${escapeHtml(g.target)}</div>
      `;
      if (g.phonetics) row.appendChild(el("div", "phonetics", g.phonetics));

      const actions = el("div", "msg-actions");
      actions.appendChild(
        smallBtn("📋 Dùng", "Đưa vào ô soạn tin hoặc copy", async (e) => {
          composeInputEl.value = g.source;
          await navigator.clipboard.writeText(g.target || "");
          flash(e.currentTarget, "Đã copy nghĩa!");
        })
      );
      actions.appendChild(
        smallBtn("✏️ Sửa", "Chỉnh sửa mục từ điển này", () => {
          glossarySourceInput.value = g.source || "";
          glossaryTargetInput.value = g.target || "";
          glossaryDirectionSelect.value = g.direction || "any";
          glossarySourceInput.focus();
        })
      );
      actions.appendChild(
        smallBtn(
          "Xoá",
          "Xoá khỏi từ điển",
          async () => {
            await chrome.runtime.sendMessage({
              type: "DELETE_GLOSSARY_ITEM",
              id: g.id,
            });
            await refreshLibraryData();
          },
          "danger"
        )
      );
      row.appendChild(actions);
      frag.appendChild(row);
    });
    libraryListEl.appendChild(frag);
  } else {
    const filtered = cachedLibraryData.tm.filter((t) => {
      if (!query) return true;
      return (
        (t.original || "").toLowerCase().includes(query) ||
        (t.translation || "").toLowerCase().includes(query)
      );
    });

    if (!filtered.length) {
      libraryListEl.innerHTML = `<div class="empty-state">${
        query
          ? "Không tìm thấy mẫu câu khớp từ khoá."
          : "Bộ nhớ tự động đang trống.<br/>Các câu bạn dịch hàng ngày sẽ tự động được lưu vào đây để lần sau dịch tức thì 0ms!"
      }</div>`;
      return;
    }

    const slice = filtered.slice(0, MAX_LIBRARY_RENDER);
    slice.forEach((t) => {
      const row = el("div", "history-item");
      const modeTag =
        t.mode === "outgoing"
          ? `📤 Bạn → ${escapeHtml(t.targetLang || "?")}`
          : `📥 ${escapeHtml(t.detectedLang || "?")} → Việt`;
      const hits = ` · 🔥 ${t.hitCount || 1} lần`;

      row.innerHTML = `
        <div class="history-time"><span class="lang-tag">${modeTag}</span>${escapeHtml(
        hits
      )}</div>
        <div class="history-original">${escapeHtml(t.original)}</div>
        <div class="history-translation">${escapeHtml(t.translation)}</div>
      `;
      if (t.phonetics) row.appendChild(el("div", "phonetics", t.phonetics));

      const actions = el("div", "msg-actions");
      actions.appendChild(
        smallBtn(
          "📌 Ghim sang Từ điển",
          "Chuyển câu này sang Từ điển cá nhân cố định",
          async (e) => {
            await chrome.runtime.sendMessage({
              type: "PIN_TM_TO_GLOSSARY",
              id: t.id,
            });
            flash(e.currentTarget, "✅ Đã ghim!");
            await refreshLibraryData();
          },
          "primary"
        )
      );
      actions.appendChild(
        smallBtn("Copy", "Copy bản dịch", async (e) => {
          await navigator.clipboard.writeText(t.translation || "");
          flash(e.currentTarget, "Đã copy!");
        })
      );
      actions.appendChild(
        smallBtn(
          "Xoá",
          "Xoá mẫu câu này khỏi bộ nhớ tự động",
          async () => {
            await chrome.runtime.sendMessage({
              type: "DELETE_TM_ITEM",
              id: t.id,
            });
            await refreshLibraryData();
          },
          "danger"
        )
      );
      row.appendChild(actions);
      frag.appendChild(row);
    });
    libraryListEl.appendChild(frag);
  }
}

libraryBtn?.addEventListener("click", async () => {
  historyOverlayEl.classList.add("hidden");
  libraryOverlayEl.classList.remove("hidden");
  await refreshLibraryData();
});

closeLibraryBtn?.addEventListener("click", () => {
  libraryOverlayEl.classList.add("hidden");
});

tabGlossaryBtn?.addEventListener("click", () => setLibraryTab("glossary"));
tabTmBtn?.addEventListener("click", () => setLibraryTab("tm"));
librarySearchInput?.addEventListener("input", () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => renderLibraryList(), 120);
});

addGlossaryBtn?.addEventListener("click", async () => {
  const source = glossarySourceInput.value.trim();
  const target = glossaryTargetInput.value.trim();
  const direction = glossaryDirectionSelect.value || "any";
  if (!source || !target) {
    showStatus("Vui lòng nhập cả Từ/câu gốc và Bản dịch cố định.", true);
    return;
  }
  const res = await chrome.runtime.sendMessage({
    type: "ADD_GLOSSARY_ITEM",
    source,
    target,
    direction,
  });
  if (!res?.ok) {
    showStatus(res?.error || "Không thêm được vào từ điển.", true);
    return;
  }
  glossarySourceInput.value = "";
  glossaryTargetInput.value = "";
  clearStatus();
  flash(addGlossaryBtn, "✅ Đã lưu!");
  await refreshLibraryData();
});

glossaryTargetInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addGlossaryBtn.click();
  }
});

clearTmBtn?.addEventListener("click", async () => {
  if (
    !confirm(
      "Xoá toàn bộ Bộ nhớ câu tự động? (Từ điển cá nhân & câu ghim của bạn vẫn được giữ nguyên)."
    )
  ) {
    return;
  }
  await chrome.runtime.sendMessage({ type: "CLEAR_TM" });
  await refreshLibraryData();
});

exportLibraryBtn?.addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "EXPORT_LIBRARY" });
  if (!res?.ok || !res.data) return;
  const blob = new Blob([JSON.stringify(res.data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `igt_library_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

importLibraryBtn?.addEventListener("click", () => {
  importLibraryInput.click();
});

importLibraryInput?.addEventListener("change", async () => {
  const file = importLibraryInput.files?.[0];
  importLibraryInput.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const res = await chrome.runtime.sendMessage({
      type: "IMPORT_LIBRARY",
      data: parsed,
    });
    if (!res?.ok) throw new Error(res?.error || "Không nhập được thư viện.");
    await refreshLibraryData();
    showStatus(
      `📚 Đã nhập: ${res.glossaryCount || 0} mục từ điển · ${res.tmCount || 0} câu bộ nhớ!`
    );
  } catch (err) {
    alert("Lỗi khi nhập Thư viện từ: " + err.message);
  }
});

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

  const frag = document.createDocumentFragment();
  [...items].reverse().forEach((item) => {
    const row = el("div", "history-item");

    const tag =
      item.kind === "outgoing"
        ? `Bạn → ${escapeHtml(item.targetLang || "?")}`
        : `${item.source === "image" ? "📸 " : ""}<span class="lang-tag">${escapeHtml(
            item.detectedLang || "?"
          )}</span>`;

    let latBadge = "";
    if (item.latencyMs != null) {
      if (item.cacheSource === "glossary") {
        latBadge = '<span class="latency-badge library-hit">📌 0ms (từ điển)</span>';
      } else if (item.cacheSource === "tm") {
        latBadge = '<span class="latency-badge library-hit">📚 0ms (bộ nhớ từ)</span>';
      } else {
        latBadge = `<span class="latency-badge">${
          item.latencyMs === 0 ? "⚡ 0ms" : `⚡ ${item.latencyMs}ms`
        }</span>`;
      }
    }

    row.innerHTML = `
      <div class="history-time">${escapeHtml(formatTime(item.timestamp))} · ${tag} ${latBadge}</div>
      <div class="history-original">${escapeHtml(item.original)}</div>
      <div class="history-translation">${escapeHtml(item.translation)}</div>
    `;
    if (item.phonetics) row.appendChild(el("div", "phonetics", item.phonetics));

    const actions = el("div", "msg-actions");
    actions.appendChild(
      smallBtn("📌 Lưu từ", "Ghim câu này vào Từ điển cá nhân", (e) =>
        quickPinToGlossary(item.original, item.translation, item.phonetics, e.currentTarget)
      )
    );
    actions.appendChild(
      smallBtn("Xoá", "Xoá mục này khỏi lịch sử", async () => {
        await chrome.runtime.sendMessage({ type: "DELETE_HISTORY_ITEM", id: item.id });
        row.remove();
        feedEl.querySelector(`.msg-card[data-id="${CSS.escape(item.id)}"]`)?.remove();
      }, "danger")
    );
    row.appendChild(actions);
    frag.appendChild(row);
  });
  historyListEl.appendChild(frag);
}

historyBtn.addEventListener("click", async () => {
  libraryOverlayEl.classList.add("hidden");
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

syncBtn?.addEventListener("click", async () => {
  if (!currentSettings?.syncWorkerUrl || !currentSettings?.syncKey) {
    showStatus("Chưa cấu hình Cloudflare Sync. Nhấn ⚙ để nhập Worker URL và Sync Key.", true);
    return;
  }
  syncBtn.disabled = true;
  const prev = syncBtn.textContent;
  syncBtn.textContent = "⏳";
  clearStatus();
  try {
    const res = await chrome.runtime.sendMessage({
      type: "SYNC_HISTORY_NOW",
      config: { syncEnabled: true },
    });
    if (!res?.ok) throw new Error(res?.error || "Đồng bộ thất bại.");
    await loadFeedFromHistory();
    if (!historyOverlayEl.classList.contains("hidden")) {
      await renderHistoryOverlay();
    }
    if (!libraryOverlayEl.classList.contains("hidden")) {
      await refreshLibraryData();
    }
    showStatus(
      `☁️ Đã đồng bộ: ${res.count || 0} lịch sử · ${res.glossaryCount || 0} từ điển · ${res.tmCount || 0} bộ nhớ từ!`
    );
    setTimeout(() => clearStatus(), 3000);
  } catch (err) {
    showStatus(err.message || String(err), true);
  } finally {
    syncBtn.disabled = false;
    syncBtn.textContent = prev;
  }
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
  } else if (message?.type === "HISTORY_SYNCED") {
    loadFeedFromHistory();
    if (!historyOverlayEl.classList.contains("hidden")) {
      renderHistoryOverlay();
    }
    if (!libraryOverlayEl.classList.contains("hidden")) {
      refreshLibraryData();
    }
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

pinOutgoingBtn?.addEventListener("click", () => {
  if (!lastOutgoing?.original || !lastOutgoing?.translation) return;
  quickPinToGlossary(
    lastOutgoing.original,
    lastOutgoing.translation,
    lastOutgoing.phonetics,
    pinOutgoingBtn
  );
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
loadSettings().then(() => {
  if (currentSettings?.syncEnabled && currentSettings?.syncWorkerUrl && currentSettings?.syncKey) {
    chrome.runtime.sendMessage({ type: "SYNC_HISTORY_NOW" }).catch(() => {});
  }
});
loadFeedFromHistory();
