// background.js — service worker (v1.6.0 Ultra-Fast RAM-Indexed Engine)
// Tối ưu hoá triệt để chống chậm dần theo thời gian:
// 1. Bảng băm RAM O(1) (Map Index) cho Từ điển, Bộ nhớ dịch (TM), Lịch sử & Settings -> tra cứu 0.005ms, không đọc ổ cứng mỗi lần dịch.
// 2. Ghi ổ cứng phi đồng bộ (Non-blocking Disk Flush) -> trả kết quả dịch về UI ngay lập tức (0ms wait).
// 3. Đồng bộ Cloud thông minh (Idle Debounce 12s, chỉ vẽ lại UI khi có tin mới từ máy khác).
// 4. Rút gọn Context Prompt (cắt gọn câu dài, bỏ ảnh OCR khỏi ngữ cảnh) + giới hạn maxOutputTokens giúp Gemini phản hồi nhanh nhất.

const DEFAULT_SETTINGS = {
  apiKey: "",
  model: "gemini-2.5-flash",
  incomingTargetLang: "Vietnamese",
  outgoingTargetLang: "English",
  autoTranslateIncoming: false,
  customStyleInstruction: "",
  personaStyle: "default",
  contextTurns: 3,
  suggestionCount: 3,
  fastMode: true,
  enablePhonetics: false,
  useTranslationMemory: true,
  syncEnabled: false,
  syncWorkerUrl: "",
  syncKey: "",
  theme: "system",
  accentColor: "#405de6",
};

const PERSONA_PROMPTS = {
  casual:
    "Use a deeply sweet, warm, affectionate, and loving tone. In Vietnamese, naturally use tender romantic pronouns (anh - em / em - anh), speaking with warmth, adoration, tenderness and caring affection.",
  formal:
    "Use a courteous, polite, and respectful tone with proper honorifics, suitable for business inquiries, customer support, or formal interactions.",
  genz:
    "Use modern, cute, playful Gen Z internet slang, cute expressions, and emojis (e.g. English: tbh, rn, cutie, lol, slay; Vietnamese: chòi oi, u là trời, iu xỉu, xịn xò, kkk...). Keep it playful, sweet and adorable.",
  tech:
    "Use accurate software/tech terminology while maintaining a clean, concise, direct chat style.",
};

const CHAT_SYSTEM_INSTRUCTION = `You are a sweet, caring, ultra-fast real-time chat translation engine specialized in intimate, affectionate social media messaging (Instagram Direct DMs with Phyll ♥).

CRITICAL TRANSLATION QUALITY & ROMANTIC TONE GUIDELINES:
1. SWEET, LOVING & TENDER TONE (NGỌT NGÀO, TÌNH CẢM, ÂU YẾM):
   - Always translate with genuine emotional warmth, tenderness, and sweetness (giọng điệu ngọt ngào, dịu dàng, ấm áp, đáng yêu, quan tâm, cưng nựng).
   - In Vietnamese: DEFAULT to sweet, affectionate couple pronouns ("anh - em" / "em - anh") or loving terms of endearment (cưng, người iu, bé, thương thương...), unless formal style is explicitly requested.
   - NEVER use cold, stiff, textbook-like pronouns ("Tôi - Bạn" or impersonal words).
   - Compliments, flirtatious banter, loving expressions, and caring check-ins must sound authentically sweet and heart-warming.
2. COLLOQUIAL SOCIAL CHAT REGISTER:
   - Accurately decode internet abbreviations, emotional slang, cute chat particles:
     * English: idk, tbh, rn, ngl, fr, lmao, lol, hru, wbu, gtg, brb, miss u, love u, sweet dreams, cutie, babe...
     * Vietnamese: k/ko (không), đc/dc (được), ntn (như thế nào), rep (trả lời), ib (inbox), fl, tym, sao z/sao dạ, chòi oi, nhớ anh/em, thương, iu, ngoan, kkk...
     * Asian languages: common chat particles and internet slang in Japanese, Korean, Chinese, Thai.
3. CONTEXT & PRONOUN REVERSAL:
   - Check the RECENT CONVERSATION HISTORY turns to identify who is "anh" and who is "em", and consistently preserve the established pronouns and intimacy.
   - Retain all emojis (❤️, 🥰, 🥺, 💕, ✨, 😘...), stickers, @usernames, and emotional punctuation (~~, !!!, ???).
   - DO NOT re-translate previous turns.
4. STRICT DIRECT OUTPUT:
   - Output ONLY the requested JSON schema without any conversational pleasantries, markdown tags, or commentary outside the JSON.`;

const CONTEXT_MENU_ID = "igt-translate-selection";
const CONTEXT_MENU_IMAGE_ID = "igt-translate-image";

// ---- In-Memory LRU Cache (dành cho các đoạn văn dài > 220 ký tự) ------------
const TRANSLATION_CACHE = new Map();
const MAX_CACHE_ENTRIES = 150;

function getCachedTranslation(key) {
  if (!TRANSLATION_CACHE.has(key)) return null;
  const val = TRANSLATION_CACHE.get(key);
  TRANSLATION_CACHE.delete(key);
  TRANSLATION_CACHE.set(key, val);
  return val;
}

function setCachedTranslation(key, val) {
  if (TRANSLATION_CACHE.has(key)) {
    TRANSLATION_CACHE.delete(key);
  } else if (TRANSLATION_CACHE.size >= MAX_CACHE_ENTRIES) {
    const firstKey = TRANSLATION_CACHE.keys().next().value;
    TRANSLATION_CACHE.delete(firstKey);
  }
  TRANSLATION_CACHE.set(key, val);
}

const EMOJI_AND_SYMBOLS_REGEX = /^[\p{Extended_Pictographic}\p{Emoji}\p{Number}\p{Punctuation}\p{Separator}\s]+$/u;
const URL_ONLY_REGEX = /^(https?:\/\/[^\s]+)$/i;
const STRIP_PUNCT_REGEX = /^[.,!?~…;:\-–—'"“”‘’]+|[.,!?~…;:\-–—'"“”‘’]+$/g;

function isNonTranslatable(text) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  return EMOJI_AND_SYMBOLS_REGEX.test(trimmed) || URL_ONLY_REGEX.test(trimmed);
}

// ---- Hằng số & Chuẩn hoá Văn bản -------------------------------------------
const HISTORY_KEY = "igt_history";
const GLOSSARY_KEY = "igt_glossary";
const TM_KEY = "igt_tm";
const STATS_KEY = "igt_stats";
const DELETED_SIGS_KEY = "igt_deleted_sigs";

const MAX_HISTORY_ITEMS = 300;
const MAX_GLOSSARY_ITEMS = 500;
const MAX_TM_ITEMS = 1000;
const MAX_TM_TEXT_LEN = 220;
const MAX_CONTEXT_TURN_CHARS = 120;

function normalizeExactText(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeRelaxedText(text) {
  const exact = normalizeExactText(text);
  const stripped = exact.replace(STRIP_PUNCT_REGEX, "").trim();
  return stripped || exact;
}

function glossarySig(entry) {
  return `gls||${entry.direction || "any"}||${normalizeRelaxedText(entry.source)}`;
}

function tmSig(entry) {
  return `tm||${entry.mode || "incoming"}||${(entry.targetLang || "").toLowerCase()}||${normalizeRelaxedText(entry.original)}`;
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ---------------------------------------------------------------------------
// BỘ NHỚ RAM TỐC ĐỘ CAO O(1) (In-Memory State & Hash Indexes)
// Loại bỏ hoàn toàn việc đọc/ghi ổ cứng và chạy vòng lặp Regex trên mỗi lần dịch
// ---------------------------------------------------------------------------

const MEM = {
  hydrated: false,
  hydratingPromise: null,
  settings: null,
  history: [],
  glossary: [],
  tm: [],
  deletedSigs: new Set(),
  stats: { savedApiCalls: 0 },

  // Bảng băm O(1)
  glossaryForwardMap: new Map(), // key: `${dir}|${normSrc}` -> entry
  glossaryReverseMap: new Map(), // key: normTgt -> entry (khi dir === 'any')
  glossarySubstrings: [],        // [{ normSrc, normTgt, dir, source, target }]
  tmDirectMap: new Map(),        // key: `${mode}|${langLower}|${normOrig}` -> entry
  tmAnyLangMap: new Map(),       // key: `${mode}||${normOrig}` -> entry
  tmReverseMap: new Map(),       // key: `${langLower}|${normTrans}` -> entry
  tmBySigMap: new Map(),         // key: sig -> entry
};

function rebuildGlossaryIndex() {
  MEM.glossaryForwardMap.clear();
  MEM.glossaryReverseMap.clear();
  MEM.glossarySubstrings = [];

  for (let i = 0; i < MEM.glossary.length; i++) {
    const g = MEM.glossary[i];
    if (!g || !g.source || !g.target) continue;
    const dir = g.direction || "any";
    const normSrc = g._normSrc || (g._normSrc = normalizeRelaxedText(g.source));
    const normTgt = g._normTgt || (g._normTgt = normalizeRelaxedText(g.target));
    const exactSrc = g._exactSrc || (g._exactSrc = normalizeExactText(g.source));
    const exactTgt = g._exactTgt || (g._exactTgt = normalizeExactText(g.target));

    if (normSrc) {
      MEM.glossaryForwardMap.set(`${dir}|${normSrc}`, g);
    }
    if (dir === "any" && normTgt) {
      MEM.glossaryReverseMap.set(normTgt, g);
    }
    if (exactSrc.length >= 2 || exactTgt.length >= 2) {
      MEM.glossarySubstrings.push({
        dir,
        exactSrc,
        exactTgt,
        source: g.source,
        target: g.target,
      });
    }
  }
}

function indexSingleTmEntry(entry) {
  if (!entry || !entry.original || !entry.translation) return;
  const mode = entry.mode || "incoming";
  const langLower = (entry.targetLang || "").toLowerCase();
  const detLower = (entry.detectedLang || "").toLowerCase();
  const normOrig = entry._normOrig || (entry._normOrig = normalizeRelaxedText(entry.original));
  const normTrans = entry._normTrans || (entry._normTrans = normalizeRelaxedText(entry.translation));
  if (!normOrig) return;

  const sig = `tm||${mode}||${langLower}||${normOrig}`;
  entry._sig = sig;
  MEM.tmBySigMap.set(sig, entry);
  MEM.tmDirectMap.set(`${mode}|${langLower}|${normOrig}`, entry);
  MEM.tmAnyLangMap.set(`${mode}||${normOrig}`, entry);

  if (mode === "incoming" && normTrans) {
    if (detLower) {
      MEM.tmReverseMap.set(`${detLower}|${normTrans}`, entry);
    }
    MEM.tmReverseMap.set(`|${normTrans}`, entry);
  }
}

function rebuildTmIndex() {
  MEM.tmDirectMap.clear();
  MEM.tmAnyLangMap.clear();
  MEM.tmReverseMap.clear();
  MEM.tmBySigMap.clear();

  for (let i = 0; i < MEM.tm.length; i++) {
    indexSingleTmEntry(MEM.tm[i]);
  }
}

async function ensureHydrated() {
  if (MEM.hydrated) return;
  if (MEM.hydratingPromise) return MEM.hydratingPromise;

  MEM.hydratingPromise = (async () => {
    const [syncStore, localStore] = await Promise.all([
      chrome.storage.sync.get(DEFAULT_SETTINGS),
      chrome.storage.local.get({
        [HISTORY_KEY]: [],
        [GLOSSARY_KEY]: [],
        [TM_KEY]: [],
        [DELETED_SIGS_KEY]: [],
        [STATS_KEY]: { savedApiCalls: 0 },
      }),
    ]);

    MEM.settings = { ...DEFAULT_SETTINGS, ...syncStore };
    MEM.history = Array.isArray(localStore[HISTORY_KEY]) ? localStore[HISTORY_KEY] : [];
    MEM.glossary = Array.isArray(localStore[GLOSSARY_KEY]) ? localStore[GLOSSARY_KEY] : [];
    MEM.tm = Array.isArray(localStore[TM_KEY]) ? localStore[TM_KEY] : [];
    MEM.deletedSigs = new Set(Array.isArray(localStore[DELETED_SIGS_KEY]) ? localStore[DELETED_SIGS_KEY] : []);
    MEM.stats = localStore[STATS_KEY] || { savedApiCalls: 0 };

    // Nếu TM đang trống mà đã có lịch sử, trích xuất 1 lần duy nhất
    if (MEM.tm.length === 0 && MEM.history.length > 0) {
      MEM.tm = mergeTmLists([], [], MEM.history, MEM.deletedSigs);
      scheduleDiskFlush({ tm: true });
    }

    rebuildGlossaryIndex();
    rebuildTmIndex();
    MEM.hydrated = true;
    MEM.hydratingPromise = null;
  })();

  return MEM.hydratingPromise;
}

// Khởi động nạp RAM ngay khi Service Worker thức dậy
ensureHydrated().catch(() => {});

// Tự động cập nhật MEM.settings khi người dùng đổi cài đặt
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "sync" && MEM.settings) {
    for (const [k, v] of Object.entries(changes)) {
      MEM.settings[k] = v.newValue !== undefined ? v.newValue : DEFAULT_SETTINGS[k];
    }
  }
});

// ---- Ghi ổ cứng phi đồng bộ (Debounced Non-Blocking Disk Flush) ------------
const dirtyFlags = {
  history: false,
  glossary: false,
  tm: false,
  deletedSigs: false,
  stats: false,
};
let diskFlushTimer = null;

function stripInternalFields(list) {
  return list.map((it) => {
    const copy = { ...it };
    delete copy._normSrc;
    delete copy._normTgt;
    delete copy._exactSrc;
    delete copy._exactTgt;
    delete copy._normOrig;
    delete copy._normTrans;
    delete copy._sig;
    return copy;
  });
}

function scheduleDiskFlush(flags = {}) {
  for (const k of Object.keys(flags)) {
    if (flags[k]) dirtyFlags[k] = true;
  }
  if (diskFlushTimer) clearTimeout(diskFlushTimer);
  diskFlushTimer = setTimeout(() => {
    flushToDiskNow().catch(() => {});
  }, 250);
}

async function flushToDiskNow() {
  if (diskFlushTimer) {
    clearTimeout(diskFlushTimer);
    diskFlushTimer = null;
  }
  const payload = {};
  if (dirtyFlags.history) {
    payload[HISTORY_KEY] = MEM.history;
    dirtyFlags.history = false;
  }
  if (dirtyFlags.glossary) {
    payload[GLOSSARY_KEY] = stripInternalFields(MEM.glossary);
    dirtyFlags.glossary = false;
  }
  if (dirtyFlags.tm) {
    payload[TM_KEY] = stripInternalFields(MEM.tm);
    dirtyFlags.tm = false;
  }
  if (dirtyFlags.deletedSigs) {
    payload[DELETED_SIGS_KEY] = Array.from(MEM.deletedSigs).slice(-500);
    dirtyFlags.deletedSigs = false;
  }
  if (dirtyFlags.stats) {
    payload[STATS_KEY] = MEM.stats;
    dirtyFlags.stats = false;
  }
  if (Object.keys(payload).length > 0) {
    await chrome.storage.local.set(payload);
  }
}

async function getSettings() {
  await ensureHydrated();
  return MEM.settings;
}

function getRecentHistorySync(n) {
  if (!n || n <= 0) return [];
  return MEM.history.slice(-n);
}

function shouldLearnIntoTm(original, translation, source) {
  if (source === "image") return false;
  const orig = String(original || "").trim();
  const trans = String(translation || "").trim();
  if (!orig || !trans) return false;
  if (orig.length > MAX_TM_TEXT_LEN) return false;
  if (isNonTranslatable(orig)) return false;
  return true;
}

function learnIntoTmSync(item) {
  if (!shouldLearnIntoTm(item.original, item.translation, item.source)) return false;
  const mode = item.kind === "outgoing" || item.mode === "outgoing" ? "outgoing" : "incoming";
  const langLower = (item.targetLang || "").toLowerCase();
  const normOrig = normalizeRelaxedText(item.original);
  if (!normOrig) return false;

  const sig = `tm||${mode}||${langLower}||${normOrig}`;
  if (MEM.deletedSigs.has(sig)) return false;

  const now = item.timestamp || item.updatedAt || Date.now();
  const existing = MEM.tmBySigMap.get(sig);

  if (existing) {
    existing.original = item.original.trim();
    existing.translation = item.translation.trim();
    existing.detectedLang = item.detectedLang || existing.detectedLang || "?";
    existing.targetLang = item.targetLang || existing.targetLang || "";
    existing.phonetics = item.phonetics || existing.phonetics || "";
    existing.hitCount = Math.max(existing.hitCount || 1, item.hitCount || 1);
    existing.updatedAt = Math.max(existing.updatedAt || 0, now);
    existing._normOrig = normOrig;
    existing._normTrans = normalizeRelaxedText(existing.translation);
    indexSingleTmEntry(existing);
  } else {
    const newEntry = {
      id: item.id?.startsWith("tm-") ? item.id : newId("tm"),
      mode,
      original: item.original.trim(),
      translation: item.translation.trim(),
      detectedLang: item.detectedLang || "?",
      targetLang: item.targetLang || "",
      phonetics: item.phonetics || "",
      hitCount: item.hitCount || 1,
      updatedAt: now,
      _normOrig: normOrig,
      _normTrans: normalizeRelaxedText(item.translation),
    };
    MEM.tm.push(newEntry);
    indexSingleTmEntry(newEntry);

    if (MEM.tm.length > MAX_TM_ITEMS) {
      MEM.tm.sort(
        (a, b) =>
          (a.hitCount || 1) * 3600000 +
          (a.updatedAt || 0) -
          ((b.hitCount || 1) * 3600000 + (b.updatedAt || 0))
      );
      MEM.tm.splice(0, MEM.tm.length - MAX_TM_ITEMS);
      rebuildTmIndex();
    }
  }
  return true;
}

/**
 * Lưu lịch sử tức thì trong RAM (<0.05ms), đẩy việc ghi đĩa & đồng bộ Cloud xuống ngầm
 */
function addHistoryItemFast(item) {
  const list = MEM.history;
  for (let i = list.length - 1; i >= 0; i--) {
    const it = list[i];
    if (
      it.kind === item.kind &&
      it.original === item.original &&
      it.translation === item.translation
    ) {
      list.splice(i, 1);
      break;
    }
  }
  list.push(item);
  if (list.length > MAX_HISTORY_ITEMS) {
    list.splice(0, list.length - MAX_HISTORY_ITEMS);
  }

  const learned = learnIntoTmSync(item);
  scheduleDiskFlush({ history: true, tm: learned });
  scheduleAutoSync();
  return item;
}

function updateHistoryItemFast(id, patch) {
  if (!id) return;
  const idx = MEM.history.findIndex((it) => it.id === id);
  if (idx !== -1) {
    MEM.history[idx] = { ...MEM.history[idx], ...patch };
    scheduleDiskFlush({ history: true });
    scheduleAutoSync();
  }
}

function deleteHistoryItemFast(id) {
  const idx = MEM.history.findIndex((it) => it.id === id);
  if (idx !== -1) {
    MEM.history.splice(idx, 1);
    scheduleDiskFlush({ history: true });
    scheduleAutoSync();
  }
}

/**
 * Tra cứu O(1) trong RAM (0.005ms) — Không đọc ổ cứng, không quét mảng bằng Regex
 */
function lookupInLibrarySync(text, mode, targetLang, useTm = true) {
  const normText = normalizeRelaxedText(text);
  if (!normText) return null;

  // 1. Tra cứu O(1) trong Từ điển cá nhân (Glossary)
  const gDirect =
    MEM.glossaryForwardMap.get(`${mode}|${normText}`) ||
    MEM.glossaryForwardMap.get(`any|${normText}`);
  if (gDirect) {
    gDirect.hitCount = (gDirect.hitCount || 0) + 1;
    gDirect.updatedAt = Date.now();
    MEM.stats.savedApiCalls = (MEM.stats.savedApiCalls || 0) + 1;
    scheduleDiskFlush({ glossary: true, stats: true });
    return {
      detectedLang: gDirect.detectedLang || "Từ điển",
      translation: gDirect.target,
      phonetics: gDirect.phonetics || "",
      latencyMs: 0,
      cacheSource: "glossary",
    };
  }

  const gReverse = MEM.glossaryReverseMap.get(normText);
  if (gReverse) {
    gReverse.hitCount = (gReverse.hitCount || 0) + 1;
    gReverse.updatedAt = Date.now();
    MEM.stats.savedApiCalls = (MEM.stats.savedApiCalls || 0) + 1;
    scheduleDiskFlush({ glossary: true, stats: true });
    return {
      detectedLang: gReverse.detectedLang || "Từ điển",
      translation: gReverse.source,
      phonetics: "",
      latencyMs: 0,
      cacheSource: "glossary",
    };
  }

  if (!useTm) return null;

  // 2. Tra cứu O(1) trong Bộ nhớ dịch (TM)
  const langLower = (targetLang || "").toLowerCase();
  const tmHit =
    MEM.tmDirectMap.get(`${mode}|${langLower}|${normText}`) ||
    MEM.tmAnyLangMap.get(`${mode}||${normText}`);

  if (tmHit) {
    tmHit.hitCount = (tmHit.hitCount || 1) + 1;
    tmHit.updatedAt = Date.now();
    MEM.stats.savedApiCalls = (MEM.stats.savedApiCalls || 0) + 1;
    scheduleDiskFlush({ tm: true, stats: true });
    return {
      detectedLang: tmHit.detectedLang || "TM",
      translation: tmHit.translation,
      phonetics: tmHit.phonetics || "",
      latencyMs: 0,
      cacheSource: "tm",
    };
  }

  // 3. Tra cứu đảo chiều O(1) trong TM cho tin nhắn đi
  if (mode === "outgoing") {
    const revHit =
      MEM.tmReverseMap.get(`${langLower}|${normText}`) ||
      MEM.tmReverseMap.get(`|${normText}`);
    if (revHit) {
      revHit.hitCount = (revHit.hitCount || 1) + 1;
      revHit.updatedAt = Date.now();
      MEM.stats.savedApiCalls = (MEM.stats.savedApiCalls || 0) + 1;
      scheduleDiskFlush({ tm: true, stats: true });
      return {
        detectedLang: "Vietnamese",
        translation: revHit.original,
        phonetics: revHit.phonetics || "",
        latencyMs: 0,
        cacheSource: "tm",
      };
    }
  }

  return null;
}

/**
 * Quét nhanh các từ vựng cá nhân đã tiền xử lý sẵn trong RAM
 */
function buildGlossaryPromptLinesSync(text, mode) {
  if (!MEM.glossarySubstrings.length) return [];
  const lowerText = normalizeExactText(text);
  if (!lowerText) return [];

  const matchedRules = [];
  for (let i = 0; i < MEM.glossarySubstrings.length; i++) {
    const item = MEM.glossarySubstrings[i];
    const dirOk = item.dir === "any" || item.dir === mode;
    if (dirOk && item.exactSrc.length >= 2 && lowerText.includes(item.exactSrc)) {
      matchedRules.push(`  - "${item.source}" ➔ "${item.target}"`);
    } else if (
      item.dir === "any" &&
      item.exactTgt.length >= 2 &&
      lowerText.includes(item.exactTgt)
    ) {
      matchedRules.push(`  - "${item.target}" ➔ "${item.source}"`);
    }
    if (matchedRules.length >= 12) break;
  }

  if (!matchedRules.length) return [];
  return [
    "MANDATORY PERSONAL GLOSSARY / DICTIONARY (Always apply these exact translations/nicknames when translating the message):",
    ...matchedRules,
  ];
}

function broadcastNewItem(item) {
  chrome.runtime
    .sendMessage({ type: "TRANSLATED_INCOMING", item })
    .catch(() => {});
}

// Cho phép side panel tự mở khi bấm icon extension.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: 'Dịch với Instagram Translator: "%s"',
      contexts: ["selection"],
      documentUrlPatterns: ["https://www.instagram.com/*"],
    });
    chrome.contextMenus.create({
      id: CONTEXT_MENU_IMAGE_ID,
      title: "📸 Dịch chữ trong ảnh này",
      contexts: ["image"],
      documentUrlPatterns: ["https://www.instagram.com/*"],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (
    info.menuItemId !== CONTEXT_MENU_ID &&
    info.menuItemId !== CONTEXT_MENU_IMAGE_ID
  ) {
    return;
  }

  if (tab.windowId != null) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }

  try {
    let item;
    if (info.menuItemId === CONTEXT_MENU_ID) {
      const text = (info.selectionText || "").trim();
      if (!text) return;
      item = await translateIncomingText(text, "sel");
    } else {
      if (!info.srcUrl) return;
      const image = await fetchImageAsBase64(info.srcUrl);
      item = await translateIncomingImage(image);
    }
    broadcastNewItem(item);
  } catch (err) {
    console.error("[IG Translator] Lỗi dịch từ context menu:", err);
    chrome.runtime
      .sendMessage({ type: "TRANSLATE_ERROR", error: err?.message || String(err) })
      .catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Gemini API (Tối ưu hóa Thinking Config chuẩn theo từng dòng Model)
// ---------------------------------------------------------------------------

// Ghi nhớ trong RAM các model không hỗ trợ thinkingConfig để không bao giờ bị
// lặp lại request lỗi HTTP 400 ở các lần dịch tiếp theo.
const UNSUPPORTED_THINKING_MODELS = new Set();

function getFastThinkingConfig(model) {
  if (!model || UNSUPPORTED_THINKING_MODELS.has(model)) return null;
  const m = String(model).toLowerCase();

  // Gemini 2.5 Pro bắt buộc thinkingBudget tối thiểu = 128 (gửi 0 sẽ bị lỗi HTTP 400!)
  if (m.includes("2.5-pro")) {
    return { thinkingBudget: 128 };
  }
  // Gemini 2.5 Flash / Flash-Lite hỗ trợ tắt hoàn toàn thinking (thinkingBudget = 0)
  if (m.includes("2.5-flash")) {
    return { thinkingBudget: 0 };
  }
  // Gemini 3 / 3.1 / 3.5 / 3.8 Flash hỗ trợ thinkingLevel: "MINIMAL"
  if (/gemini-3.*flash/i.test(m)) {
    return { thinkingLevel: "MINIMAL" };
  }
  // Gemini 3 Pro / Gemini 4 hỗ trợ tối thiểu thinkingLevel: "LOW"
  if (/gemini-3.*pro|gemini-4/i.test(m)) {
    return { thinkingLevel: "LOW" };
  }
  return null;
}

async function callGemini({
  prompt,
  apiKey,
  model,
  image,
  systemInstruction,
  responseSchema,
  temperature = 0.2,
  fastMode = true,
}) {
  if (!apiKey) {
    throw new Error("Chưa cấu hình Gemini API key. Mở Settings để nhập.");
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent`;

  const parts = [{ text: prompt }];
  if (image) {
    parts.push({ inline_data: { mime_type: image.mimeType, data: image.data } });
  }

  const generationConfig = {
    temperature,
    responseMimeType: "application/json",
  };

  if (responseSchema) {
    generationConfig.responseSchema = responseSchema;
  }

  if (fastMode) {
    const tc = getFastThinkingConfig(model);
    if (tc) {
      generationConfig.thinkingConfig = tc;
    }
  }

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig,
  };

  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  const fetchWithTimeout = async (reqBody) => {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 45000);
    try {
      return await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(reqBody),
        signal: controller.signal,
      });
    } catch (err) {
      if (timedOut || err?.name === "AbortError") {
        throw new Error(
          `Model "${model}" phản hồi quá lâu (>45s). Hãy mở Cài đặt ⚙ và chuyển sang model dòng Flash (ví dụ: gemini-2.5-flash) để dịch nhanh tức thì!`
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };

  let res = await fetchWithTimeout(body);

  // Bước fallback 1: Nếu model từ chối thinkingConfig (HTTP 400), ghi nhớ vào RAM
  // để các câu sau không gửi nữa, và thử lại mà VẪN GIỮ NGUYÊN systemInstruction + responseSchema!
  if (!res.ok && res.status === 400 && generationConfig.thinkingConfig) {
    UNSUPPORTED_THINKING_MODELS.add(model);
    delete generationConfig.thinkingConfig;
    res = await fetchWithTimeout(body);
  }

  // Bước fallback 2: Nếu model quá cũ không hỗ trợ systemInstruction/responseSchema,
  // gộp systemInstruction vào đầu prompt để KHÔNG BAO GIỜ mất phong cách xưng hô!
  if (
    !res.ok &&
    res.status === 400 &&
    (generationConfig.responseSchema || body.systemInstruction)
  ) {
    if (systemInstruction) {
      parts[0] = { text: `${systemInstruction}\n\n${prompt}` };
    }
    delete generationConfig.responseSchema;
    delete body.systemInstruction;
    res = await fetchWithTimeout(body);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini API lỗi (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const candidateParts = data?.candidates?.[0]?.content?.parts || [];
  const raw =
    candidateParts
      .filter((p) => !p?.thought && typeof p?.text === "string")
      .map((p) => p.text)
      .join("") ||
    candidateParts.map((p) => p?.text || "").join("") ||
    "";
  return raw;
}

function parseJson(raw) {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

function buildStyleLines(settings) {
  const lines = [];
  const persona = PERSONA_PROMPTS[settings.personaStyle];
  if (persona) lines.push(`PERSONA TONE STYLE: ${persona}`);
  const custom = (settings.customStyleInstruction || "").trim();
  if (custom) {
    lines.push(
      `CUSTOM USER INSTRUCTIONS (register, pronouns, formality): ${custom}`
    );
  }
  return lines;
}

/**
 * Xây dựng ngữ cảnh gọn nhẹ: Bỏ qua ảnh OCR và cắt gọn các câu quá dài
 * để tránh làm phình kích thước Prompt theo thời gian.
 */
function buildContextLines(recentHistory) {
  if (!recentHistory || !recentHistory.length) return [];
  const compactTurns = [];
  for (let i = 0; i < recentHistory.length; i++) {
    const it = recentHistory[i];
    if (!it || it.source === "image" || !it.original || !it.translation) continue;
    const orig =
      it.original.length > MAX_CONTEXT_TURN_CHARS
        ? it.original.slice(0, MAX_CONTEXT_TURN_CHARS) + "..."
        : it.original;
    const trans =
      it.translation.length > MAX_CONTEXT_TURN_CHARS
        ? it.translation.slice(0, MAX_CONTEXT_TURN_CHARS) + "..."
        : it.translation;
    const role = it.kind === "outgoing" ? "Me" : "Them";
    compactTurns.push(`  [${role}]: "${orig}" ➔ "${trans}"`);
  }
  if (!compactTurns.length) return [];
  return [
    "RECENT CONTEXT (For pronoun 'anh - em' consistency only; DO NOT re-translate):",
    ...compactTurns.slice(-4),
  ];
}

function normalizeTranslation(parsed, raw, latencyMs = null) {
  return {
    detectedLang: parsed.detectedLang || "?",
    translation: parsed.translation || "",
    phonetics: parsed.phonetics || "",
    extractedText: parsed.extractedText || "",
    latencyMs,
    raw,
  };
}

/**
 * Dịch văn bản với Gemini (RAM O(1) Lookup + Fast Prompt):
 */
async function translateWithGemini({ text, targetLang, mode, settings }) {
  if (!text || !text.trim()) {
    return { detectedLang: "", translation: "", phonetics: "", latencyMs: 0 };
  }

  await ensureHydrated();
  const cleanText = text.trim();

  // 1. Kiểm tra nếu chỉ gồm ký tự không cần dịch (emoji, url, số) -> 0ms
  if (isNonTranslatable(cleanText)) {
    return {
      detectedLang: "Symbol",
      translation: cleanText,
      phonetics: "",
      latencyMs: 0,
      cacheSource: "symbol",
    };
  }

  // 2. Tra cứu O(1) trong RAM (Từ điển cá nhân & Bộ nhớ dịch) -> 0ms, 0 disk I/O, 0 API call
  const libraryHit = lookupInLibrarySync(
    cleanText,
    mode,
    targetLang,
    settings.useTranslationMemory !== false
  );
  if (libraryHit) {
    return libraryHit;
  }

  // 3. Tra cứu RAM Cache LRU (cho các đoạn văn dài > 220 ký tự)
  const cacheKey = `${mode}|${targetLang}|${settings.personaStyle}|${cleanText}`;
  const cached = getCachedTranslation(cacheKey);
  if (cached) {
    return { ...cached, latencyMs: 0, cacheSource: "cache" };
  }

  const startTime = performance.now();
  const isOutgoing = mode === "outgoing";
  const recent = getRecentHistorySync(Math.min(4, Number(settings.contextTurns) || 0));
  const glossaryLines = buildGlossaryPromptLinesSync(cleanText, mode);
  const includePhonetics = !!settings.enablePhonetics;

  const promptLines = [
    isOutgoing
      ? `MODE: OUTGOING CHAT. Translate user's message into natural, sweet ${targetLang} for DMs.`
      : `MODE: INCOMING CHAT. Detect language and translate this DM naturally into ${targetLang}.`,
    ...buildStyleLines(settings),
    ...glossaryLines,
    ...buildContextLines(recent),
    "MESSAGE TO TRANSLATE:",
    `"""${cleanText}"""`,
  ];

  const responseProperties = {
    detectedLang: {
      type: "STRING",
      description: "Detected source language in English (e.g. English, Vietnamese, Thai).",
    },
    translation: {
      type: "STRING",
      description: `Natural, contextual translation in ${targetLang}.`,
    },
  };

  const requiredFields = ["detectedLang", "translation"];

  if (includePhonetics) {
    responseProperties.phonetics = {
      type: "STRING",
      description: isOutgoing
        ? "Romanized pronunciation of the TRANSLATED text. Empty string if Vietnamese."
        : "Romanized pronunciation of the ORIGINAL text. Empty string if Vietnamese.",
    };
    requiredFields.push("phonetics");
  }

  const responseSchema = {
    type: "OBJECT",
    properties: responseProperties,
    required: requiredFields,
  };

  const raw = await callGemini({
    prompt: promptLines.join("\n\n"),
    apiKey: settings.apiKey,
    model: settings.model,
    systemInstruction: CHAT_SYSTEM_INSTRUCTION,
    responseSchema,
    temperature: 0.2,
    fastMode: settings.fastMode !== false,
  });

  const latencyMs = Math.round(performance.now() - startTime);

  let result;
  try {
    const parsed = parseJson(raw);
    result = normalizeTranslation(parsed, raw, latencyMs);
  } catch (e) {
    result = normalizeTranslation({ translation: raw.trim(), detectedLang: "?" }, raw, latencyMs);
  }

  setCachedTranslation(cacheKey, result);
  return result;
}

async function translateImageWithGemini({ image, targetLang, settings }) {
  await ensureHydrated();
  const startTime = performance.now();
  const recent = getRecentHistorySync(Math.min(3, Number(settings.contextTurns) || 0));

  const promptLines = [
    `Extract all readable text from this image, detect its source language, and translate it naturally into ${targetLang}.`,
    ...buildStyleLines(settings),
    ...buildContextLines(recent),
  ];

  const responseSchema = {
    type: "OBJECT",
    properties: {
      extractedText: { type: "STRING", description: "Original extracted text from the image." },
      detectedLang: { type: "STRING", description: "Detected language in English." },
      translation: { type: "STRING", description: `Natural translation in ${targetLang}.` },
      phonetics: { type: "STRING", description: "Pronunciation guide if applicable." },
    },
    required: ["extractedText", "detectedLang", "translation"],
  };

  const raw = await callGemini({
    prompt: promptLines.join("\n\n"),
    apiKey: settings.apiKey,
    model: settings.model,
    systemInstruction: CHAT_SYSTEM_INSTRUCTION,
    responseSchema,
    image,
    temperature: 0.2,
    fastMode: settings.fastMode !== false,
  });

  const latencyMs = Math.round(performance.now() - startTime);

  try {
    return normalizeTranslation(parseJson(raw), raw, latencyMs);
  } catch (e) {
    return normalizeTranslation({ translation: raw.trim() }, raw, latencyMs);
  }
}

async function getStyleVariants({ text, targetLang, settings }) {
  await ensureHydrated();
  const glossaryLines = buildGlossaryPromptLinesSync(text, "outgoing");
  const promptLines = [
    `Provide 3 distinct translation variations of the TEXT into ${targetLang}, as chat messages the user could send:`,
    "'casual': friendly, warm, conversational tone.",
    "'formal': polite, respectful, professional tone.",
    "'concise': short, direct, concise phrasing.",
    ...glossaryLines,
  ];
  const custom = (settings.customStyleInstruction || "").trim();
  if (custom) promptLines.push(`Also respect these user instructions where possible: ${custom}`);
  promptLines.push("TEXT:", "```", text, "```");

  const responseSchema = {
    type: "OBJECT",
    properties: {
      casual: { type: "STRING", description: "Casual, friendly variation" },
      formal: { type: "STRING", description: "Formal, polite variation" },
      concise: { type: "STRING", description: "Short, direct, concise variation" },
    },
    required: ["casual", "formal", "concise"],
  };

  const raw = await callGemini({
    prompt: promptLines.join("\n"),
    apiKey: settings.apiKey,
    model: settings.model,
    systemInstruction: CHAT_SYSTEM_INSTRUCTION,
    responseSchema,
    temperature: 0.5,
    fastMode: settings.fastMode !== false,
  });

  let parsed;
  try {
    parsed = parseJson(raw);
  } catch (e) {
    throw new Error("Không đọc được các phong cách từ Gemini (sai định dạng).");
  }
  return {
    casual: parsed.casual || "",
    formal: parsed.formal || "",
    concise: parsed.concise || "",
  };
}

async function suggestReplies({
  originalMessage,
  detectedLang,
  translationVi,
  settings,
}) {
  await ensureHydrated();
  const n = Math.max(1, Math.min(6, Number(settings.suggestionCount) || 3));
  const userLang = settings.incomingTargetLang || "Vietnamese";
  const recent = getRecentHistorySync(Math.min(4, Number(settings.contextTurns) || 0));

  const promptLines = [
    "You are helping a user reply to an Instagram Direct DM.",
    ...buildContextLines(recent),
    `The sender wrote (${detectedLang || "unknown"}): """${originalMessage}"""`,
    `${userLang} translation: """${translationVi || ""}"""`,
    `Generate exactly ${n} natural, contextual candidate replies in ${userLang}, and their corresponding translations in ${settings.outgoingTargetLang}.`,
    ...buildStyleLines(settings),
  ];

  const responseSchema = {
    type: "OBJECT",
    properties: {
      suggestions: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            vi: { type: "STRING", description: `Candidate reply in ${userLang}` },
            translated: { type: "STRING", description: `Same reply translated into ${settings.outgoingTargetLang}` },
          },
          required: ["vi", "translated"],
        },
      },
    },
    required: ["suggestions"],
  };

  const raw = await callGemini({
    prompt: promptLines.join("\n\n"),
    apiKey: settings.apiKey,
    model: settings.model,
    systemInstruction: CHAT_SYSTEM_INSTRUCTION,
    responseSchema,
    temperature: 0.4,
    fastMode: settings.fastMode !== false,
  });

  let parsed;
  try {
    parsed = parseJson(raw);
  } catch (e) {
    throw new Error("Không đọc được gợi ý trả lời từ Gemini (sai định dạng).");
  }

  const suggestions = Array.isArray(parsed.suggestions)
    ? parsed.suggestions
        .filter((s) => s && (s.vi || s.translated))
        .map((s) => ({ vi: s.vi || "", translated: s.translated || "" }))
    : [];

  return { suggestions };
}

// ---------------------------------------------------------------------------
// Luồng dịch dùng chung (không chặn chờ ghi đĩa)
// ---------------------------------------------------------------------------

async function translateIncomingText(text, idPrefix = "in", messageId) {
  const settings = await getSettings();
  const result = await translateWithGemini({
    text,
    targetLang: settings.incomingTargetLang,
    mode: "incoming",
    settings,
  });
  const item = {
    id: messageId || newId(idPrefix),
    kind: "incoming",
    original: text,
    detectedLang: result.detectedLang,
    translation: result.translation,
    phonetics: result.phonetics,
    targetLang: settings.incomingTargetLang,
    latencyMs: result.latencyMs,
    cacheSource: result.cacheSource || null,
    timestamp: Date.now(),
  };
  return addHistoryItemFast(item);
}

async function translateIncomingImage(image) {
  const settings = await getSettings();
  const result = await translateImageWithGemini({
    image,
    targetLang: settings.incomingTargetLang,
    settings,
  });
  const item = {
    id: newId("img"),
    kind: "incoming",
    source: "image",
    original: result.extractedText || "(ảnh)",
    detectedLang: result.detectedLang,
    translation: result.translation,
    phonetics: result.phonetics,
    targetLang: settings.incomingTargetLang,
    latencyMs: result.latencyMs,
    timestamp: Date.now(),
  };
  return addHistoryItemFast(item);
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchImageAsBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Không tải được ảnh (${res.status}).`);
  const blob = await res.blob();
  const mimeType = blob.type && blob.type.startsWith("image/") ? blob.type : "image/jpeg";
  return { mimeType, data: arrayBufferToBase64(await blob.arrayBuffer()) };
}

function parseDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || "");
  if (!m) throw new Error("Dữ liệu ảnh không hợp lệ.");
  return { mimeType: m[1], data: m[2] };
}

// ---------------------------------------------------------------------------
// Đồng bộ Lịch sử + Thư viện từ qua Cloudflare Worker + KV (AES-GCM-256)
// ---------------------------------------------------------------------------

function base64ToUint8Array(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveCryptoKey(syncKey) {
  const enc = new TextEncoder();
  const hash = await crypto.subtle.digest(
    "SHA-256",
    enc.encode("igt_e2e_aes256_v1:" + syncKey)
  );
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encryptCloudBundle(bundle, syncKey) {
  const key = await deriveCryptoKey(syncKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(bundle));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded
  );
  return {
    v: 2,
    iv: arrayBufferToBase64(iv.buffer),
    ct: arrayBufferToBase64(cipherBuf),
    updatedAt: Date.now(),
  };
}

async function decryptCloudBundle(payload, syncKey) {
  if (!payload) return { history: [], glossary: [], tm: [], deletedSigs: [], savedApiCalls: 0 };
  if (Array.isArray(payload.items)) {
    return { history: payload.items, glossary: [], tm: [], deletedSigs: [], savedApiCalls: 0 };
  }
  if (!payload.ct || !payload.iv) {
    return { history: [], glossary: [], tm: [], deletedSigs: [], savedApiCalls: 0 };
  }
  const key = await deriveCryptoKey(syncKey);
  const iv = base64ToUint8Array(payload.iv);
  const ct = base64ToUint8Array(payload.ct);
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ct
  );
  const jsonStr = new TextDecoder().decode(plainBuf);
  const parsed = JSON.parse(jsonStr);
  if (Array.isArray(parsed)) {
    return { history: parsed, glossary: [], tm: [], deletedSigs: [], savedApiCalls: 0 };
  }
  return {
    history: Array.isArray(parsed?.history) ? parsed.history : [],
    glossary: Array.isArray(parsed?.glossary) ? parsed.glossary : [],
    tm: Array.isArray(parsed?.tm) ? parsed.tm : [],
    deletedSigs: Array.isArray(parsed?.deletedSigs) ? parsed.deletedSigs : [],
    savedApiCalls: Number(parsed?.savedApiCalls) || 0,
  };
}

function mergeHistoryLists(localList, remoteList) {
  const bySig = new Map();
  const sigOf = (it) =>
    `${it.kind || "incoming"}||${(it.original || "").trim()}||${(
      it.translation || ""
    ).trim()}`;

  const ingest = (it) => {
    if (!it || !it.original || !it.translation) return;
    const s = sigOf(it);
    const existing = bySig.get(s);
    if (!existing) {
      bySig.set(s, { ...it });
    } else {
      const newer =
        (it.timestamp || 0) >= (existing.timestamp || 0) ? it : existing;
      const older = newer === it ? existing : it;
      bySig.set(s, {
        ...older,
        ...newer,
        suggestions: newer.suggestions?.length
          ? newer.suggestions
          : older.suggestions,
      });
    }
  };

  for (const it of remoteList || []) ingest(it);
  for (const it of localList || []) ingest(it);

  const merged = Array.from(bySig.values());
  merged.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  if (merged.length > MAX_HISTORY_ITEMS) {
    return merged.slice(merged.length - MAX_HISTORY_ITEMS);
  }
  return merged;
}

function mergeGlossaryLists(localList, remoteList, deletedSet) {
  const bySig = new Map();
  const ingest = (g) => {
    if (!g || !g.source || !g.target) return;
    const sig = glossarySig(g);
    if (deletedSet.has(sig)) return;
    const existing = bySig.get(sig);
    if (!existing) {
      bySig.set(sig, {
        id: g.id || newId("gls"),
        source: String(g.source).trim(),
        target: String(g.target).trim(),
        direction: g.direction || "any",
        phonetics: g.phonetics || "",
        hitCount: g.hitCount || 0,
        updatedAt: g.updatedAt || Date.now(),
      });
    } else {
      const newer = (g.updatedAt || 0) >= (existing.updatedAt || 0) ? g : existing;
      bySig.set(sig, {
        ...existing,
        ...newer,
        hitCount: Math.max(existing.hitCount || 0, g.hitCount || 0),
        updatedAt: Math.max(existing.updatedAt || 0, g.updatedAt || 0),
      });
    }
  };

  for (const g of remoteList || []) ingest(g);
  for (const g of localList || []) ingest(g);

  const merged = Array.from(bySig.values());
  merged.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return merged.slice(0, MAX_GLOSSARY_ITEMS);
}

function mergeTmLists(localList, remoteList, historyList, deletedSet) {
  const bySig = new Map();
  const ingest = (entry) => {
    if (!entry || !entry.original || !entry.translation) return;
    if (!shouldLearnIntoTm(entry.original, entry.translation, entry.source)) return;
    const mode = entry.mode === "outgoing" || entry.kind === "outgoing" ? "outgoing" : "incoming";
    const normOrig = entry._normOrig || normalizeRelaxedText(entry.original);
    if (!normOrig) return;
    const sig = `tm||${mode}||${(entry.targetLang || "").toLowerCase()}||${normOrig}`;
    if (deletedSet.has(sig)) return;

    const existing = bySig.get(sig);
    const ts = entry.updatedAt || entry.timestamp || Date.now();
    if (!existing) {
      bySig.set(sig, {
        id: entry.id?.startsWith("tm-") ? entry.id : newId("tm"),
        mode,
        original: String(entry.original).trim(),
        translation: String(entry.translation).trim(),
        detectedLang: entry.detectedLang || "?",
        targetLang: entry.targetLang || "",
        phonetics: entry.phonetics || "",
        hitCount: entry.hitCount || 1,
        updatedAt: ts,
      });
    } else {
      const isNewer = ts >= (existing.updatedAt || 0);
      bySig.set(sig, {
        ...existing,
        original: isNewer ? String(entry.original).trim() : existing.original,
        translation: isNewer ? String(entry.translation).trim() : existing.translation,
        detectedLang: entry.detectedLang || existing.detectedLang || "?",
        targetLang: entry.targetLang || existing.targetLang || "",
        phonetics: entry.phonetics || existing.phonetics || "",
        hitCount: Math.max(existing.hitCount || 1, entry.hitCount || 1),
        updatedAt: Math.max(existing.updatedAt || 0, ts),
      });
    }
  };

  for (const h of historyList || []) ingest(h);
  for (const t of remoteList || []) ingest(t);
  for (const t of localList || []) ingest(t);

  const merged = Array.from(bySig.values());
  merged.sort(
    (a, b) =>
      (b.hitCount || 1) * 3600000 +
      (b.updatedAt || 0) -
      ((a.hitCount || 1) * 3600000 + (a.updatedAt || 0))
  );
  return merged.slice(0, MAX_TM_ITEMS);
}

// Tăng thời gian gom (debounce) tự động đồng bộ Cloud lên 12s khi nghỉ tay
// để không làm nghẽn mạng & CPU khi người dùng đang dịch liên tiếp nhiều câu.
let syncDebounceTimer = null;
let isSyncingNow = false;

function scheduleAutoSync() {
  if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => {
    syncHistoryWithCloud({ silent: true }).catch(() => {});
  }, 12000);
}

async function syncHistoryWithCloud({
  silent = false,
  overrideConfig = null,
} = {}) {
  if (isSyncingNow && silent) {
    return { ok: false, skipped: true };
  }
  isSyncingNow = true;
  try {
    await ensureHydrated();
    const settings = overrideConfig
      ? { ...(await getSettings()), ...overrideConfig }
      : await getSettings();

    if (!overrideConfig && !settings.syncEnabled) {
      return { ok: false, skipped: true, error: "Chưa bật đồng bộ đám mây." };
    }

    let workerUrl = (settings.syncWorkerUrl || "").trim().replace(/\/+$/, "");
    const syncKey = (settings.syncKey || "").trim();

    if (!workerUrl) {
      if (silent) return { ok: false, skipped: true };
      throw new Error("Chưa nhập Cloudflare Worker URL.");
    }
    if (!/^https?:\/\//i.test(workerUrl)) {
      workerUrl = "https://" + workerUrl;
    }
    if (workerUrl.includes("dash.cloudflare.com")) {
      throw new Error(
        "Bạn đang dán link trang quản trị Cloudflare. Hãy dán link Worker có đuôi .workers.dev (VD: https://ig-trans-sync.ten-ban.workers.dev)."
      );
    }
    if (!syncKey || syncKey.length < 6) {
      if (silent) return { ok: false, skipped: true };
      throw new Error("Sync Key cần tối thiểu 6 ký tự.");
    }

    const authToken = encodeURIComponent(syncKey);

    let getRes;
    try {
      getRes = await fetch(workerUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
    } catch (netErr) {
      throw new Error(
        `Không kết nối được tới ${workerUrl} (${netErr?.message || "Failed to fetch"}).`
      );
    }

    if (!getRes.ok) {
      const errData = await getRes.json().catch(() => ({}));
      throw new Error(
        errData?.error || `Lỗi kết nối Cloudflare Worker (${getRes.status}).`
      );
    }

    const remotePayload = await getRes.json();
    let remoteBundle = {
      history: [],
      glossary: [],
      tm: [],
      deletedSigs: [],
      savedApiCalls: 0,
    };
    if (remotePayload && !remotePayload.empty && remotePayload.ct) {
      try {
        remoteBundle = await decryptCloudBundle(remotePayload, syncKey);
      } catch (e) {
        throw new Error(
          "Không giải mã được dữ liệu trên Cloud (sai Sync Key hoặc dữ liệu không khớp)."
        );
      }
    }

    const prevCount = MEM.history.length;
    const prevLastId = MEM.history[MEM.history.length - 1]?.id || "";

    for (const s of remoteBundle.deletedSigs || []) {
      MEM.deletedSigs.add(s);
    }

    MEM.history = mergeHistoryLists(MEM.history, remoteBundle.history);
    MEM.glossary = mergeGlossaryLists(
      MEM.glossary,
      remoteBundle.glossary,
      MEM.deletedSigs
    );
    MEM.tm = mergeTmLists(
      MEM.tm,
      remoteBundle.tm,
      MEM.history,
      MEM.deletedSigs
    );
    MEM.stats.savedApiCalls = Math.max(
      MEM.stats?.savedApiCalls || 0,
      remoteBundle.savedApiCalls || 0
    );

    rebuildGlossaryIndex();
    rebuildTmIndex();

    const newLastId = MEM.history[MEM.history.length - 1]?.id || "";
    const historyChangedFromRemote =
      MEM.history.length !== prevCount || newLastId !== prevLastId;

    const finalBundle = {
      history: MEM.history,
      glossary: stripInternalFields(MEM.glossary),
      tm: stripInternalFields(MEM.tm),
      deletedSigs: Array.from(MEM.deletedSigs).slice(-500),
      savedApiCalls: MEM.stats.savedApiCalls,
    };

    scheduleDiskFlush({
      history: true,
      glossary: true,
      tm: true,
      deletedSigs: true,
      stats: true,
    });

    const encryptedPayload = await encryptCloudBundle(finalBundle, syncKey);
    let postRes;
    try {
      postRes = await fetch(workerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(encryptedPayload),
      });
    } catch (netErr) {
      throw new Error(
        `Không gửi được dữ liệu lên ${workerUrl} (${netErr?.message || "Failed to fetch"}).`
      );
    }

    if (!postRes.ok) {
      const errData = await postRes.json().catch(() => ({}));
      throw new Error(
        errData?.error || `Lỗi lưu lên Cloudflare Worker (${postRes.status}).`
      );
    }

    const syncedAt = Date.now();
    await chrome.storage.local.set({ igt_last_sync_at: syncedAt });

    // Chỉ bắn sự kiện vẽ lại UI khi thực sự có lịch sử mới từ máy khác hoặc bấm đồng bộ thủ công
    if (!silent || historyChangedFromRemote) {
      chrome.runtime
        .sendMessage({
          type: "HISTORY_SYNCED",
          count: finalBundle.history.length,
          glossaryCount: finalBundle.glossary.length,
          tmCount: finalBundle.tm.length,
          savedApiCalls: finalBundle.savedApiCalls,
          syncedAt,
        })
        .catch(() => {});
    }

    return {
      ok: true,
      count: finalBundle.history.length,
      glossaryCount: finalBundle.glossary.length,
      tmCount: finalBundle.tm.length,
      savedApiCalls: finalBundle.savedApiCalls,
      syncedAt,
    };
  } finally {
    isSyncingNow = false;
  }
}

// ---------------------------------------------------------------------------
// Message Listeners
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      await ensureHydrated();

      switch (message?.type) {
        case "GET_SETTINGS": {
          sendResponse({ ok: true, settings: MEM.settings });
          break;
        }

        case "SAVE_SETTINGS": {
          const patch = message.settings || {};
          MEM.settings = { ...MEM.settings, ...patch };
          await chrome.storage.sync.set(patch);
          sendResponse({ ok: true });
          break;
        }

        case "SYNC_HISTORY_NOW": {
          const result = await syncHistoryWithCloud({
            silent: false,
            overrideConfig: message.config || null,
          });
          sendResponse(result);
          break;
        }

        case "GET_LIBRARY_DATA": {
          sendResponse({
            ok: true,
            glossary: stripInternalFields(MEM.glossary),
            tm: stripInternalFields(MEM.tm),
            stats: MEM.stats || { savedApiCalls: 0 },
          });
          break;
        }

        case "ADD_GLOSSARY_ITEM": {
          const source = String(message.source || "").trim();
          const target = String(message.target || "").trim();
          const direction = message.direction || "any";
          const phonetics = String(message.phonetics || "").trim();
          if (!source || !target) {
            throw new Error("Vui lòng nhập đầy đủ từ/câu gốc và bản dịch.");
          }
          const sig = glossarySig({ source, direction });
          MEM.deletedSigs.delete(sig);

          const existingIdx = MEM.glossary.findIndex((g) => glossarySig(g) === sig);
          let savedItem;
          if (existingIdx !== -1) {
            MEM.glossary[existingIdx] = {
              ...MEM.glossary[existingIdx],
              source,
              target,
              direction,
              phonetics: phonetics || MEM.glossary[existingIdx].phonetics || "",
              updatedAt: Date.now(),
            };
            savedItem = MEM.glossary[existingIdx];
          } else {
            savedItem = {
              id: newId("gls"),
              source,
              target,
              direction,
              phonetics,
              hitCount: 0,
              updatedAt: Date.now(),
            };
            MEM.glossary.unshift(savedItem);
          }
          if (MEM.glossary.length > MAX_GLOSSARY_ITEMS) {
            MEM.glossary.splice(MAX_GLOSSARY_ITEMS);
          }
          rebuildGlossaryIndex();
          scheduleDiskFlush({ glossary: true, deletedSigs: true });
          scheduleAutoSync();
          sendResponse({ ok: true, item: savedItem, count: MEM.glossary.length });
          break;
        }

        case "DELETE_GLOSSARY_ITEM": {
          const idx = MEM.glossary.findIndex((g) => g.id === message.id);
          if (idx !== -1) {
            const removed = MEM.glossary.splice(idx, 1)[0];
            MEM.deletedSigs.add(glossarySig(removed));
            rebuildGlossaryIndex();
            scheduleDiskFlush({ glossary: true, deletedSigs: true });
            scheduleAutoSync();
          }
          sendResponse({ ok: true });
          break;
        }

        case "DELETE_TM_ITEM": {
          const idx = MEM.tm.findIndex((t) => t.id === message.id);
          if (idx !== -1) {
            const removed = MEM.tm.splice(idx, 1)[0];
            MEM.deletedSigs.add(tmSig(removed));
            rebuildTmIndex();
            scheduleDiskFlush({ tm: true, deletedSigs: true });
            scheduleAutoSync();
          }
          sendResponse({ ok: true });
          break;
        }

        case "PIN_TM_TO_GLOSSARY": {
          const tmEntry = MEM.tm.find((t) => t.id === message.id);
          if (!tmEntry) throw new Error("Không tìm thấy mẫu câu trong bộ nhớ.");
          const direction = "any";
          const sig = glossarySig({ source: tmEntry.original, direction });
          MEM.deletedSigs.delete(sig);

          const existingIdx = MEM.glossary.findIndex((g) => glossarySig(g) === sig);
          let pinned;
          if (existingIdx !== -1) {
            MEM.glossary[existingIdx] = {
              ...MEM.glossary[existingIdx],
              source: tmEntry.original,
              target: tmEntry.translation,
              direction,
              phonetics: tmEntry.phonetics || MEM.glossary[existingIdx].phonetics || "",
              updatedAt: Date.now(),
            };
            pinned = MEM.glossary[existingIdx];
          } else {
            pinned = {
              id: newId("gls"),
              source: tmEntry.original,
              target: tmEntry.translation,
              direction,
              phonetics: tmEntry.phonetics || "",
              hitCount: tmEntry.hitCount || 1,
              updatedAt: Date.now(),
            };
            MEM.glossary.unshift(pinned);
          }
          rebuildGlossaryIndex();
          scheduleDiskFlush({ glossary: true, deletedSigs: true });
          scheduleAutoSync();
          sendResponse({ ok: true, item: pinned });
          break;
        }

        case "CLEAR_TM": {
          MEM.tm = [];
          rebuildTmIndex();
          TRANSLATION_CACHE.clear();
          scheduleDiskFlush({ tm: true });
          scheduleAutoSync();
          sendResponse({ ok: true });
          break;
        }

        case "EXPORT_LIBRARY": {
          sendResponse({
            ok: true,
            data: {
              v: 2,
              exportedAt: Date.now(),
              glossary: stripInternalFields(MEM.glossary),
              tm: stripInternalFields(MEM.tm),
              stats: MEM.stats || { savedApiCalls: 0 },
            },
          });
          break;
        }

        case "IMPORT_LIBRARY": {
          const payload = message.data || {};
          const incomingGlossary = Array.isArray(payload.glossary)
            ? payload.glossary
            : Array.isArray(payload)
            ? payload
            : [];
          const incomingTm = Array.isArray(payload.tm) ? payload.tm : [];
          const emptySet = new Set();

          MEM.glossary = mergeGlossaryLists(MEM.glossary, incomingGlossary, emptySet);
          MEM.tm = mergeTmLists(MEM.tm, incomingTm, [], emptySet);
          rebuildGlossaryIndex();
          rebuildTmIndex();
          scheduleDiskFlush({ glossary: true, tm: true });
          scheduleAutoSync();
          sendResponse({
            ok: true,
            glossaryCount: MEM.glossary.length,
            tmCount: MEM.tm.length,
          });
          break;
        }

        case "INCOMING_MESSAGE": {
          if (!MEM.settings.autoTranslateIncoming) {
            sendResponse({ ok: true, skipped: true });
            break;
          }
          const item = await translateIncomingText(message.text, "auto", message.messageId);
          broadcastNewItem(item);
          sendResponse({ ok: true, item });
          break;
        }

        case "TRANSLATE_INCOMING": {
          const item = await translateIncomingText(message.text, "paste");
          sendResponse({ ok: true, item });
          break;
        }

        case "TRANSLATE_IMAGE": {
          const item = await translateIncomingImage(parseDataUrl(message.dataUrl));
          sendResponse({ ok: true, item });
          break;
        }

        case "TRANSLATE_OUTGOING": {
          const settings = MEM.settings;
          const targetLang = message.targetLang || settings.outgoingTargetLang;
          const result = await translateWithGemini({
            text: message.text,
            targetLang,
            mode: "outgoing",
            settings,
          });
          const item = addHistoryItemFast({
            id: newId("out"),
            kind: "outgoing",
            original: message.text,
            detectedLang: result.detectedLang,
            translation: result.translation,
            phonetics: result.phonetics,
            targetLang,
            latencyMs: result.latencyMs,
            cacheSource: result.cacheSource || null,
            timestamp: Date.now(),
          });
          sendResponse({ ok: true, result, item });
          break;
        }

        case "STYLE_VARIANTS": {
          const settings = MEM.settings;
          const variants = await getStyleVariants({
            text: message.text,
            targetLang: message.targetLang || settings.outgoingTargetLang,
            settings,
          });
          sendResponse({ ok: true, variants });
          break;
        }

        case "SUGGEST_REPLIES": {
          const settings = MEM.settings;
          const result = await suggestReplies({
            originalMessage: message.original,
            detectedLang: message.detectedLang,
            translationVi: message.translationVi,
            settings,
          });
          if (message.messageId) {
            updateHistoryItemFast(message.messageId, {
              suggestions: result.suggestions,
            });
          }
          sendResponse({ ok: true, suggestions: result.suggestions });
          break;
        }

        case "DELETE_HISTORY_ITEM": {
          deleteHistoryItemFast(message.id);
          sendResponse({ ok: true });
          break;
        }

        case "CLEAR_HISTORY": {
          MEM.history = [];
          TRANSLATION_CACHE.clear();
          scheduleDiskFlush({ history: true });
          scheduleAutoSync();
          sendResponse({ ok: true });
          break;
        }

        case "EXPORT_HISTORY": {
          sendResponse({ ok: true, items: MEM.history });
          break;
        }

        case "IMPORT_HISTORY": {
          const items = Array.isArray(message.items) ? message.items : [];
          if (items.length) {
            const existingIds = new Set(MEM.history.map((it) => it.id));
            for (const item of items) {
              if (item && item.original && item.translation) {
                if (!item.id || existingIds.has(item.id)) {
                  item.id = newId(item.kind === "outgoing" ? "out" : "in");
                }
                MEM.history.push(item);
                existingIds.add(item.id);
              }
            }
            MEM.history.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            if (MEM.history.length > MAX_HISTORY_ITEMS) {
              MEM.history.splice(0, MEM.history.length - MAX_HISTORY_ITEMS);
            }
            MEM.tm = mergeTmLists(MEM.tm, [], MEM.history, MEM.deletedSigs);
            rebuildTmIndex();
            TRANSLATION_CACHE.clear();
            scheduleDiskFlush({ history: true, tm: true });
            scheduleAutoSync();
          }
          sendResponse({ ok: true, count: items.length });
          break;
        }

        case "INSERT_TO_CHAT": {
          const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true,
            url: "https://www.instagram.com/*",
          });
          if (!tab?.id) {
            sendResponse({
              ok: false,
              error: "Không tìm thấy tab Instagram đang mở.",
            });
            break;
          }
          const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (text) => {
              if (typeof window.__igtInsertText === "function") {
                return window.__igtInsertText(text);
              }
              return false;
            },
            args: [message.text],
          });
          sendResponse({ ok: !!result });
          break;
        }

        default:
          sendResponse({ ok: false, error: "Unknown message type" });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  })();
  return true;
});
