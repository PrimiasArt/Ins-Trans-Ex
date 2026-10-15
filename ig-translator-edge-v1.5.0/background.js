// background.js — service worker (v1.5.0 Cloud Translation Memory & Glossary Edition)
// Xử lý: mở side panel khi bấm icon, gọi Gemini API để dịch (text + ảnh),
// Thư viện từ & Bộ nhớ dịch (Translation Memory + Custom Glossary) 0ms đồng bộ Cloud,
// tối ưu độ trễ với thinkingConfig: 0, bộ nhớ đệm cache LRU,
// hệ thống prompt hội thoại tự nhiên, lưu lịch sử vào storage.local.

const DEFAULT_SETTINGS = {
  apiKey: "",
  model: "gemini-2.5-flash",
  incomingTargetLang: "Vietnamese",
  outgoingTargetLang: "English",
  // Mặc định TẮT auto-scan bằng MutationObserver vì DOM Instagram hay đổi,
  // dễ bỏ sót/bắt nhầm tin. Cách đáng tin cậy hơn: bôi đen text -> chuột phải
  // -> "Dịch với Instagram Translator" (xem CONTEXT_MENU_ID bên dưới).
  autoTranslateIncoming: false,
  // Hướng dẫn phong cách dịch tuỳ chỉnh (văn phong, nhân xưng...), áp dụng
  // cho mọi bản dịch (tin đến, tin đi, gợi ý trả lời). Để trống = mặc định.
  customStyleInstruction: "",
  // Văn phong dịch nhanh (persona): default | casual | formal | genz | tech
  personaStyle: "default",
  // Số lượt dịch gần nhất gửi kèm làm ngữ cảnh (giữ xưng hô nhất quán).
  // 0 = không gửi ngữ cảnh.
  contextTurns: 5,
  // Số lượng câu trả lời gợi ý được tạo mỗi lần bấm "Gợi ý trả lời".
  suggestionCount: 3,
  // Chế độ siêu tốc: Tắt suy nghĩ reasoning (thinkingBudget: 0) của Gemini 2.5
  // giúp phản hồi tức thì (<500ms) thay vì chờ 3-5 giây.
  fastMode: true,
  // Tạo phiên âm: Tắt mặc định để tăng tốc độ phản hồi gấp 2 lần. Bật khi cần.
  enablePhonetics: false,
  // Tự động tra cứu & học mẫu câu vào Thư viện từ (Translation Memory + Glossary)
  useTranslationMemory: true,
  // Đồng bộ lịch sử & thư viện từ qua Cloudflare Worker + KV (Mã hóa đầu cuối AES-256)
  syncEnabled: false,
  syncWorkerUrl: "",
  syncKey: "",
  // Giao diện: "system" | "light" | "dark", và màu chủ đạo (hex).
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
     * Asian languages: common chat particles and internet slang in Japanese, Korean, Chinese.
3. CONTEXT & PRONOUN REVERSAL:
   - Check the RECENT CONVERSATION HISTORY turns to identify who is "anh" and who is "em", and consistently preserve the established pronouns and intimacy.
   - Retain all emojis (❤️, 🥰, 🥺, 💕, ✨, 😘...), stickers, @usernames, and emotional punctuation (~~, !!!, ???).
   - DO NOT re-translate previous turns.
4. STRICT DIRECT OUTPUT:
   - Output ONLY the requested JSON schema without any conversational pleasantries, markdown tags, or commentary outside the JSON.`;

const CONTEXT_MENU_ID = "igt-translate-selection";
const CONTEXT_MENU_IMAGE_ID = "igt-translate-image";

// ---- In-Memory LRU Cache (giúp các từ/câu lặp lại phản hồi trong 0ms) -----
const TRANSLATION_CACHE = new Map();
const MAX_CACHE_ENTRIES = 120;

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

// Bỏ qua gọi API cho các tin nhắn thuần emoji, số, link, dấu câu
function isNonTranslatable(text) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  const emojiAndSymbolsRegex = /^[\p{Extended_Pictographic}\p{Emoji}\p{Number}\p{Punctuation}\p{Separator}\s]+$/u;
  const urlRegex = /^(https?:\/\/[^\s]+)$/i;
  return emojiAndSymbolsRegex.test(trimmed) || urlRegex.test(trimmed);
}

// ---- Lịch sử dịch & Thư viện từ (persist qua storage.local + Cloud Sync) ---
const HISTORY_KEY = "igt_history";
const GLOSSARY_KEY = "igt_glossary";
const TM_KEY = "igt_tm";
const STATS_KEY = "igt_stats";
const DELETED_SIGS_KEY = "igt_deleted_sigs";

const MAX_HISTORY_ITEMS = 300;
const MAX_GLOSSARY_ITEMS = 500;
const MAX_TM_ITEMS = 1000;
const MAX_TM_TEXT_LEN = 220;

function normalizeExactText(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeRelaxedText(text) {
  const exact = normalizeExactText(text);
  const stripped = exact
    .replace(/^[.,!?~…;:\-–—'"“”‘’]+|[.,!?~…;:\-–—'"“”‘’]+$/g, "")
    .trim();
  return stripped || exact;
}

function glossarySig(entry) {
  return `gls||${entry.direction || "any"}||${normalizeRelaxedText(entry.source)}`;
}

function tmSig(entry) {
  return `tm||${entry.mode || "incoming"}||${(entry.targetLang || "").toLowerCase()}||${normalizeRelaxedText(entry.original)}`;
}

// Mọi thao tác ghi storage chạy tuần tự để tránh race condition
let storageQueue = Promise.resolve();
function withLocalStore(defaults, fn) {
  const run = storageQueue.then(async () => {
    const store = await chrome.storage.local.get(defaults);
    const result = await fn(store);
    await chrome.storage.local.set(store);
    return result;
  });
  storageQueue = run.catch(() => {});
  return run;
}

function withHistory(fn) {
  return withLocalStore({ [HISTORY_KEY]: [] }, async (store) => {
    return fn(store[HISTORY_KEY]);
  });
}

async function incrementSavedApiCalls() {
  return withLocalStore({ [STATS_KEY]: { savedApiCalls: 0 } }, (store) => {
    const current = store[STATS_KEY]?.savedApiCalls || 0;
    store[STATS_KEY] = { ...store[STATS_KEY], savedApiCalls: current + 1 };
    return store[STATS_KEY].savedApiCalls;
  });
}

/**
 * Tự động học câu dịch vào Bộ nhớ dịch (Translation Memory - igt_tm)
 */
function shouldLearnIntoTm(original, translation, source) {
  if (source === "image") return false;
  const orig = String(original || "").trim();
  const trans = String(translation || "").trim();
  if (!orig || !trans) return false;
  if (orig.length > MAX_TM_TEXT_LEN) return false;
  if (isNonTranslatable(orig)) return false;
  return true;
}

function upsertTmEntryInList(tmList, item, deletedSet = null) {
  if (!shouldLearnIntoTm(item.original, item.translation, item.source)) return false;
  const mode = item.kind === "outgoing" || item.mode === "outgoing" ? "outgoing" : "incoming";
  const normOrig = normalizeRelaxedText(item.original);
  if (!normOrig) return false;

  const sig = `tm||${mode}||${(item.targetLang || "").toLowerCase()}||${normOrig}`;
  if (deletedSet && deletedSet.has(sig)) return false;

  const existingIdx = tmList.findIndex((it) => tmSig(it) === sig);
  const now = item.timestamp || item.updatedAt || Date.now();

  if (existingIdx !== -1) {
    const prev = tmList[existingIdx];
    tmList[existingIdx] = {
      ...prev,
      original: item.original.trim(),
      translation: item.translation.trim(),
      detectedLang: item.detectedLang || prev.detectedLang || "?",
      targetLang: item.targetLang || prev.targetLang || "",
      phonetics: item.phonetics || prev.phonetics || "",
      hitCount: Math.max(prev.hitCount || 1, item.hitCount || 1),
      updatedAt: Math.max(prev.updatedAt || 0, now),
    };
  } else {
    tmList.push({
      id: item.id?.startsWith("tm-") ? item.id : newId("tm"),
      mode,
      original: item.original.trim(),
      translation: item.translation.trim(),
      detectedLang: item.detectedLang || "?",
      targetLang: item.targetLang || "",
      phonetics: item.phonetics || "",
      hitCount: item.hitCount || 1,
      updatedAt: now,
    });
  }

  if (tmList.length > MAX_TM_ITEMS) {
    tmList.sort(
      (a, b) =>
        (a.hitCount || 1) * 3600000 +
        (a.updatedAt || 0) -
        ((b.hitCount || 1) * 3600000 + (b.updatedAt || 0))
    );
    tmList.splice(0, tmList.length - MAX_TM_ITEMS);
  }
  return true;
}

function addHistoryItem(item) {
  return withLocalStore(
    { [HISTORY_KEY]: [], [TM_KEY]: [], [DELETED_SIGS_KEY]: [] },
    (store) => {
      const list = store[HISTORY_KEY];
      for (let i = list.length - 1; i >= 0; i--) {
        const it = list[i];
        if (
          it.kind === item.kind &&
          it.original === item.original &&
          it.translation === item.translation
        ) {
          list.splice(i, 1);
        }
      }
      list.push(item);
      if (list.length > MAX_HISTORY_ITEMS) {
        list.splice(0, list.length - MAX_HISTORY_ITEMS);
      }

      // Tự động nạp câu vừa dịch vào Bộ nhớ từ (Translation Memory)
      const deletedSet = new Set(store[DELETED_SIGS_KEY] || []);
      upsertTmEntryInList(store[TM_KEY], item, deletedSet);

      scheduleAutoSync();
      return item;
    }
  );
}

function updateHistoryItem(id, patch) {
  if (!id) return Promise.resolve();
  return withHistory((list) => {
    const idx = list.findIndex((it) => it.id === id);
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...patch };
      scheduleAutoSync();
    }
  });
}

function deleteHistoryItem(id) {
  return withHistory((list) => {
    const idx = list.findIndex((it) => it.id === id);
    if (idx !== -1) {
      list.splice(idx, 1);
      scheduleAutoSync();
    }
  });
}

async function getRecentHistory(n) {
  if (!n || n <= 0) return [];
  const store = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
  return store[HISTORY_KEY].slice(-n);
}

/**
 * Tra cứu câu cần dịch trong Từ điển cá nhân (Glossary) & Bộ nhớ dịch (TM)
 * Trả về ngay trong 0ms nếu khớp toàn câu, không cần gọi Gemini API.
 */
async function lookupInLibrary(text, mode, targetLang, useTm = true) {
  const normText = normalizeRelaxedText(text);
  if (!normText) return null;

  const store = await chrome.storage.local.get({
    [GLOSSARY_KEY]: [],
    [TM_KEY]: [],
  });
  const glossary = store[GLOSSARY_KEY] || [];
  const tm = store[TM_KEY] || [];

  // 1. Ưu tiên cao nhất: Từ điển cá nhân & câu ghim (igt_glossary)
  for (let i = glossary.length - 1; i >= 0; i--) {
    const g = glossary[i];
    if (!g || !g.source || !g.target) continue;
    const dirOk = !g.direction || g.direction === "any" || g.direction === mode;
    if (dirOk && normalizeRelaxedText(g.source) === normText) {
      g.hitCount = (g.hitCount || 0) + 1;
      g.updatedAt = Date.now();
      chrome.storage.local.set({ [GLOSSARY_KEY]: glossary }).catch(() => {});
      incrementSavedApiCalls().catch(() => {});
      return {
        detectedLang: g.detectedLang || "Từ điển",
        translation: g.target,
        phonetics: g.phonetics || "",
        latencyMs: 0,
        cacheSource: "glossary",
      };
    }
    // Hỗ trợ tra cứu đảo chiều nếu mục từ điển để direction === "any"
    if (
      (!g.direction || g.direction === "any") &&
      normalizeRelaxedText(g.target) === normText
    ) {
      g.hitCount = (g.hitCount || 0) + 1;
      g.updatedAt = Date.now();
      chrome.storage.local.set({ [GLOSSARY_KEY]: glossary }).catch(() => {});
      incrementSavedApiCalls().catch(() => {});
      return {
        detectedLang: g.detectedLang || "Từ điển",
        translation: g.source,
        phonetics: "",
        latencyMs: 0,
        cacheSource: "glossary",
      };
    }
  }

  if (!useTm) return null;

  // 2. Tra cứu trong Bộ nhớ dịch tự động (igt_tm)
  const targetLangLower = (targetLang || "").toLowerCase();
  for (let i = tm.length - 1; i >= 0; i--) {
    const entry = tm[i];
    if (!entry || !entry.original || !entry.translation) continue;
    const sameMode = (entry.mode || "incoming") === mode;
    const sameLang =
      !entry.targetLang ||
      !targetLangLower ||
      entry.targetLang.toLowerCase() === targetLangLower;

    if (sameMode && sameLang && normalizeRelaxedText(entry.original) === normText) {
      entry.hitCount = (entry.hitCount || 1) + 1;
      entry.updatedAt = Date.now();
      chrome.storage.local.set({ [TM_KEY]: tm }).catch(() => {});
      incrementSavedApiCalls().catch(() => {});
      return {
        detectedLang: entry.detectedLang || "TM",
        translation: entry.translation,
        phonetics: entry.phonetics || "",
        latencyMs: 0,
        cacheSource: "tm",
      };
    }
  }

  // 3. Tra cứu đảo chiều thông minh trong TM (VD: đối phương từng nhắn câu gốc X -> dịch ra Việt Y,
  // nay bạn gõ đúng câu tiếng Việt Y để dịch sang ngôn ngữ đối phương)
  if (mode === "outgoing") {
    for (let i = tm.length - 1; i >= 0; i--) {
      const entry = tm[i];
      if (!entry || entry.mode !== "incoming") continue;
      if (
        (!entry.detectedLang ||
          entry.detectedLang.toLowerCase() === targetLangLower) &&
        normalizeRelaxedText(entry.translation) === normText
      ) {
        entry.hitCount = (entry.hitCount || 1) + 1;
        entry.updatedAt = Date.now();
        chrome.storage.local.set({ [TM_KEY]: tm }).catch(() => {});
        incrementSavedApiCalls().catch(() => {});
        return {
          detectedLang: "Vietnamese",
          translation: entry.original,
          phonetics: entry.phonetics || "",
          latencyMs: 0,
          cacheSource: "tm",
        };
      }
    }
  }

  return null;
}

/**
 * Tìm các từ vựng / biệt danh trong Từ điển cá nhân xuất hiện bên trong câu dài
 * để đính kèm vào prompt cho Gemini dịch chuẩn 100% biệt danh/cách gọi.
 */
async function buildGlossaryPromptLines(text, mode) {
  const lowerText = normalizeExactText(text);
  if (!lowerText) return [];

  const store = await chrome.storage.local.get({ [GLOSSARY_KEY]: [] });
  const glossary = store[GLOSSARY_KEY] || [];
  if (!glossary.length) return [];

  const matchedRules = [];
  for (const g of glossary) {
    if (!g || !g.source || !g.target) continue;
    const dirOk = !g.direction || g.direction === "any" || g.direction === mode;
    const normSrc = normalizeExactText(g.source);
    const normTgt = normalizeExactText(g.target);

    if (dirOk && normSrc.length >= 2 && lowerText.includes(normSrc)) {
      matchedRules.push(`  - "${g.source}" ➔ "${g.target}"`);
    } else if (
      (!g.direction || g.direction === "any") &&
      normTgt.length >= 2 &&
      lowerText.includes(normTgt)
    ) {
      matchedRules.push(`  - "${g.target}" ➔ "${g.source}"`);
    }
    if (matchedRules.length >= 15) break;
  }

  if (!matchedRules.length) return [];
  return [
    "MANDATORY PERSONAL GLOSSARY / DICTIONARY (Always apply these exact translations/nicknames when translating the message):",
    ...matchedRules,
  ];
}

// ID duy nhất kể cả khi nhiều bản dịch xong trong cùng 1 mili-giây.
function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function broadcastNewItem(item) {
  chrome.runtime
    .sendMessage({ type: "TRANSLATED_INCOMING", item })
    .catch(() => {
      /* side panel có thể đang đóng, bỏ qua */
    });
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
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

// Bôi đen text / chuột phải vào ảnh trên Instagram -> dịch ngay, đẩy kết quả
// vào side panel.
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  if (
    info.menuItemId !== CONTEXT_MENU_ID &&
    info.menuItemId !== CONTEXT_MENU_IMAGE_ID
  ) {
    return;
  }

  // Mở side panel ngay (context menu click tính là user gesture nên được phép).
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
// Gemini API (Tối ưu hóa siêu tốc & JSON Schema)
// ---------------------------------------------------------------------------

/**
 * Gọi Gemini API với các tuỳ chọn tối ưu tốc độ phản hồi:
 * - systemInstruction phân tách riêng để tận dụng prompt caching của Google.
 * - thinkingBudget: 0 giúp tắt thinking reasoning của Gemini 2.5/Gemini 3 -> phản hồi tức thì.
 * - responseSchema đảm bảo cấu trúc trả về chuẩn 100%, không sinh token thừa.
 */
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

  // Gemini 2.5 Flash / Pro hoặc Gemini 3 mặc định suy nghĩ ngầm (tốn 1000+ token và 3-5 giây).
  // Khi bật fastMode, đặt thinkingBudget = 0 để tắt reasoning -> phản hồi siêu tốc (<500ms).
  const isThinkingModel = /2\.5|thinking|gemini-3/i.test(model);
  if (fastMode && isThinkingModel) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
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

  let res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  // Cơ chế tự phục hồi (Fallback): Nếu model không hỗ trợ thinkingConfig hoặc responseSchema (HTTP 400),
  // thử lại với cấu hình cơ bản để đảm bảo không bao giờ bị lỗi kết nối.
  if (!res.ok && res.status === 400 && (generationConfig.thinkingConfig || generationConfig.responseSchema || body.systemInstruction)) {
    delete generationConfig.thinkingConfig;
    delete generationConfig.responseSchema;
    delete body.systemInstruction;
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini API lỗi (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
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

function buildContextLines(recentHistory) {
  if (!recentHistory || !recentHistory.length) return [];
  const turns = recentHistory.map((it, i) => {
    const role = it.kind === "outgoing" ? "Me (Outgoing)" : "Them (Incoming)";
    return `  [Turn ${i + 1} - ${role}]: "${it.original}" ➔ "${it.translation}"`;
  });
  return [
    "RECENT CONVERSATION HISTORY (Use ONLY for pronouns, relationship and context consistency; DO NOT re-translate or repeat them):",
    ...turns,
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
 * Dịch văn bản với Gemini:
 * - Tự động tra cứu Từ điển cá nhân (Glossary) & Bộ nhớ dịch (Translation Memory) (0ms, 0 API call)
 * - Tự động tra cứu Cache LRU (0ms)
 * - Tự động phát hiện Emoji / số / ký hiệu không cần dịch (0ms)
 * - Tự động đính kèm từ vựng cá nhân (Glossary Injection) vào câu dài
 * - Chế độ siêu tốc (tắt thinking) & Schema JSON chuẩn OpenAPI
 */
async function translateWithGemini({ text, targetLang, mode, settings }) {
  if (!text || !text.trim()) {
    return { detectedLang: "", translation: "", phonetics: "", latencyMs: 0 };
  }

  const cleanText = text.trim();

  // 1. Kiểm tra nếu chỉ gồm ký tự không cần dịch (emoji, url, số)
  if (isNonTranslatable(cleanText)) {
    return {
      detectedLang: "Symbol",
      translation: cleanText,
      phonetics: "",
      latencyMs: 0,
      cacheSource: "symbol",
    };
  }

  // 2. Tra cứu trong Từ điển cá nhân (Glossary) & Bộ nhớ dịch tự động (TM) -> 0ms, 0 API call
  const libraryHit = await lookupInLibrary(
    cleanText,
    mode,
    targetLang,
    settings.useTranslationMemory !== false
  );
  if (libraryHit) {
    return libraryHit;
  }

  // 3. Tra cứu RAM Cache LRU
  const cacheKey = `${mode}|${targetLang}|${settings.personaStyle}|${cleanText}`;
  const cached = getCachedTranslation(cacheKey);
  if (cached) {
    return { ...cached, latencyMs: 0, cacheSource: "cache" };
  }

  const startTime = performance.now();
  const isOutgoing = mode === "outgoing";
  const recent = await getRecentHistory(Number(settings.contextTurns) || 0);
  const glossaryLines = await buildGlossaryPromptLines(cleanText, mode);
  const includePhonetics = !!settings.enablePhonetics;

  const promptLines = [
    isOutgoing
      ? `MODE: OUTGOING CHAT. The user is typing a message in their language to send in ${targetLang}. Translate it into natural, authentic ${targetLang} as a native speaker would message in DMs.`
      : `MODE: INCOMING CHAT. The user received this DM message and wants to understand it in ${targetLang}. Detect the source language and translate it accurately and naturally into ${targetLang}.`,
    ...buildStyleLines(settings),
    ...glossaryLines,
    ...buildContextLines(recent),
    "CURRENT MESSAGE TO TRANSLATE:",
    `"""${cleanText}"""`,
  ];

  // Cấu hình Schema cho phản hồi JSON
  const responseProperties = {
    detectedLang: {
      type: "STRING",
      description: "Detected source language name in English (e.g. English, Vietnamese, Korean, Thai).",
    },
    translation: {
      type: "STRING",
      description: `Natural, contextual translation in ${targetLang}. Keep pronouns and emotions authentic.`,
    },
  };

  const requiredFields = ["detectedLang", "translation"];

  if (includePhonetics) {
    responseProperties.phonetics = {
      type: "STRING",
      description: isOutgoing
        ? "Romanized pronunciation guide (IPA/romaji/pinyin) of the TRANSLATED text. Empty string if Vietnamese."
        : "Romanized pronunciation guide (IPA/romaji/pinyin) of the ORIGINAL text. Empty string if Vietnamese.",
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
    // Fallback: nếu parse JSON lỗi, lấy trực tiếp nội dung raw
    result = normalizeTranslation({ translation: raw.trim(), detectedLang: "?" }, raw, latencyMs);
  }

  // Lưu vào Cache
  setCachedTranslation(cacheKey, result);

  return result;
}

/**
 * Dịch chữ trong ảnh (OCR + dịch) sang targetLang.
 */
async function translateImageWithGemini({ image, targetLang, settings }) {
  const startTime = performance.now();
  const recent = await getRecentHistory(Number(settings.contextTurns) || 0);

  const promptLines = [
    `Extract all readable text from this image (DM screenshot, meme, or photo), detect its source language, and translate it naturally into ${targetLang}.`,
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

/**
 * 3 biến thể phong cách cho 1 tin nhắn đi: thân mật / trang trọng / súc tích.
 */
async function getStyleVariants({ text, targetLang, settings }) {
  const glossaryLines = await buildGlossaryPromptLines(text, "outgoing");
  const promptLines = [
    `Provide 3 distinct translation variations of the TEXT into ${targetLang}, as chat messages the user could send:`,
    "'casual': friendly, warm, conversational tone.",
    "'formal': polite, respectful, professional tone.",
    "'concise': short, direct, concise phrasing.",
    ...glossaryLines,
  ];
  const custom = (settings.customStyleInstruction || "").trim();
  if (custom) promptLines.push(`Also respect these user instructions where possible: ${custom}`);
  promptLines.push(
    "TEXT:",
    "```",
    text,
    "```"
  );

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

/**
 * Sinh N câu trả lời gợi ý bằng ngôn ngữ của người dùng kèm bản dịch sang ngôn ngữ đối phương.
 */
async function suggestReplies({
  originalMessage,
  detectedLang,
  translationVi,
  settings,
}) {
  const n = Math.max(1, Math.min(6, Number(settings.suggestionCount) || 3));
  const userLang = settings.incomingTargetLang || "Vietnamese";
  const recent = await getRecentHistory(Number(settings.contextTurns) || 0);

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
// Luồng dịch dùng chung (context menu, auto-scan, Dán & dịch, ảnh)
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
  return addHistoryItem(item);
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
  return addHistoryItem(item);
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
  // Tương thích ngược với v1.4.0 (khi dữ liệu giải mã là mảng lịch sử)
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
    const normOrig = normalizeRelaxedText(entry.original);
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

  // Tự động trích xuất từ lịch sử dịch để làm giàu Bộ nhớ từ (TM)
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

let syncDebounceTimer = null;
function scheduleAutoSync() {
  if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => {
    syncHistoryWithCloud({ silent: true }).catch(() => {});
  }, 1500);
}

async function syncHistoryWithCloud({
  silent = false,
  overrideConfig = null,
} = {}) {
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

  // 1. Kéo dữ liệu từ Cloudflare KV
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
      `Không kết nối được tới ${workerUrl} (${netErr?.message || "Failed to fetch"}). Hãy kiểm tra: (1) Đã bấm Reload 🔄 extension trong chrome://extensions chưa, (2) Đã dán code worker.js & bấm Deploy trên Cloudflare chưa, (3) Link .workers.dev có viết đúng không.`
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

  // 2. Gộp hai chiều cả 3 kho: Lịch sử + Từ điển cá nhân + Bộ nhớ dịch (TM)
  let finalBundle = null;
  await withLocalStore(
    {
      [HISTORY_KEY]: [],
      [GLOSSARY_KEY]: [],
      [TM_KEY]: [],
      [DELETED_SIGS_KEY]: [],
      [STATS_KEY]: { savedApiCalls: 0 },
    },
    (store) => {
      const deletedSet = new Set([
        ...(store[DELETED_SIGS_KEY] || []),
        ...(remoteBundle.deletedSigs || []),
      ]);
      const finalDeletedSigs = Array.from(deletedSet).slice(-500);

      const mergedHistory = mergeHistoryLists(
        store[HISTORY_KEY],
        remoteBundle.history
      );
      const mergedGlossary = mergeGlossaryLists(
        store[GLOSSARY_KEY],
        remoteBundle.glossary,
        deletedSet
      );
      const mergedTm = mergeTmLists(
        store[TM_KEY],
        remoteBundle.tm,
        mergedHistory,
        deletedSet
      );
      const mergedSavedCalls = Math.max(
        store[STATS_KEY]?.savedApiCalls || 0,
        remoteBundle.savedApiCalls || 0
      );

      store[HISTORY_KEY] = mergedHistory;
      store[GLOSSARY_KEY] = mergedGlossary;
      store[TM_KEY] = mergedTm;
      store[DELETED_SIGS_KEY] = finalDeletedSigs;
      store[STATS_KEY] = { ...store[STATS_KEY], savedApiCalls: mergedSavedCalls };

      finalBundle = {
        history: mergedHistory,
        glossary: mergedGlossary,
        tm: mergedTm,
        deletedSigs: finalDeletedSigs,
        savedApiCalls: mergedSavedCalls,
      };
    }
  );

  // 3. Mã hóa gói dữ liệu đã gộp và đẩy ngược lên Cloud
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

  return {
    ok: true,
    count: finalBundle.history.length,
    glossaryCount: finalBundle.glossary.length,
    tmCount: finalBundle.tm.length,
    savedApiCalls: finalBundle.savedApiCalls,
    syncedAt,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message?.type) {
        case "GET_SETTINGS": {
          sendResponse({ ok: true, settings: await getSettings() });
          break;
        }

        case "SAVE_SETTINGS": {
          await chrome.storage.sync.set(message.settings || {});
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

        // Quản lý Thư viện từ (Glossary + Translation Memory)
        case "GET_LIBRARY_DATA": {
          const data = await withLocalStore(
            {
              [HISTORY_KEY]: [],
              [GLOSSARY_KEY]: [],
              [TM_KEY]: [],
              [DELETED_SIGS_KEY]: [],
              [STATS_KEY]: { savedApiCalls: 0 },
            },
            (store) => {
              // Nếu TM chưa được khởi tạo nhưng đã có Lịch sử, tự động trích xuất từ Lịch sử sang TM
              if (store[TM_KEY].length === 0 && store[HISTORY_KEY].length > 0) {
                const deletedSet = new Set(store[DELETED_SIGS_KEY] || []);
                store[TM_KEY] = mergeTmLists(
                  [],
                  [],
                  store[HISTORY_KEY],
                  deletedSet
                );
              }
              return {
                glossary: store[GLOSSARY_KEY],
                tm: store[TM_KEY],
                stats: store[STATS_KEY] || { savedApiCalls: 0 },
              };
            }
          );
          sendResponse({ ok: true, ...data });
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
          const result = await withLocalStore(
            { [GLOSSARY_KEY]: [], [DELETED_SIGS_KEY]: [] },
            (store) => {
              const list = store[GLOSSARY_KEY];
              const sig = glossarySig({ source, direction });
              store[DELETED_SIGS_KEY] = (store[DELETED_SIGS_KEY] || []).filter(
                (s) => s !== sig
              );
              const existingIdx = list.findIndex((g) => glossarySig(g) === sig);
              let savedItem;
              if (existingIdx !== -1) {
                list[existingIdx] = {
                  ...list[existingIdx],
                  source,
                  target,
                  direction,
                  phonetics: phonetics || list[existingIdx].phonetics || "",
                  updatedAt: Date.now(),
                };
                savedItem = list[existingIdx];
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
                list.unshift(savedItem);
              }
              if (list.length > MAX_GLOSSARY_ITEMS) {
                list.splice(MAX_GLOSSARY_ITEMS);
              }
              return { item: savedItem, count: list.length };
            }
          );
          scheduleAutoSync();
          sendResponse({ ok: true, ...result });
          break;
        }

        case "DELETE_GLOSSARY_ITEM": {
          await withLocalStore(
            { [GLOSSARY_KEY]: [], [DELETED_SIGS_KEY]: [] },
            (store) => {
              const list = store[GLOSSARY_KEY];
              const idx = list.findIndex((g) => g.id === message.id);
              if (idx !== -1) {
                const removed = list.splice(idx, 1)[0];
                const sig = glossarySig(removed);
                if (!store[DELETED_SIGS_KEY].includes(sig)) {
                  store[DELETED_SIGS_KEY].push(sig);
                }
              }
            }
          );
          scheduleAutoSync();
          sendResponse({ ok: true });
          break;
        }

        case "DELETE_TM_ITEM": {
          await withLocalStore(
            { [TM_KEY]: [], [DELETED_SIGS_KEY]: [] },
            (store) => {
              const list = store[TM_KEY];
              const idx = list.findIndex((t) => t.id === message.id);
              if (idx !== -1) {
                const removed = list.splice(idx, 1)[0];
                const sig = tmSig(removed);
                if (!store[DELETED_SIGS_KEY].includes(sig)) {
                  store[DELETED_SIGS_KEY].push(sig);
                }
              }
            }
          );
          scheduleAutoSync();
          sendResponse({ ok: true });
          break;
        }

        case "PIN_TM_TO_GLOSSARY": {
          const tmId = message.id;
          const pinned = await withLocalStore(
            { [TM_KEY]: [], [GLOSSARY_KEY]: [], [DELETED_SIGS_KEY]: [] },
            (store) => {
              const tmEntry = store[TM_KEY].find((t) => t.id === tmId);
              if (!tmEntry) throw new Error("Không tìm thấy mẫu câu trong bộ nhớ.");
              const direction = "any";
              const sig = glossarySig({ source: tmEntry.original, direction });
              store[DELETED_SIGS_KEY] = (store[DELETED_SIGS_KEY] || []).filter(
                (s) => s !== sig
              );
              const list = store[GLOSSARY_KEY];
              const existingIdx = list.findIndex((g) => glossarySig(g) === sig);
              if (existingIdx !== -1) {
                list[existingIdx] = {
                  ...list[existingIdx],
                  source: tmEntry.original,
                  target: tmEntry.translation,
                  direction,
                  phonetics: tmEntry.phonetics || list[existingIdx].phonetics || "",
                  updatedAt: Date.now(),
                };
                return list[existingIdx];
              }
              const newItem = {
                id: newId("gls"),
                source: tmEntry.original,
                target: tmEntry.translation,
                direction,
                phonetics: tmEntry.phonetics || "",
                hitCount: tmEntry.hitCount || 1,
                updatedAt: Date.now(),
              };
              list.unshift(newItem);
              return newItem;
            }
          );
          scheduleAutoSync();
          sendResponse({ ok: true, item: pinned });
          break;
        }

        case "CLEAR_TM": {
          await withLocalStore({ [TM_KEY]: [] }, (store) => {
            store[TM_KEY] = [];
          });
          TRANSLATION_CACHE.clear();
          scheduleAutoSync();
          sendResponse({ ok: true });
          break;
        }

        case "EXPORT_LIBRARY": {
          const store = await chrome.storage.local.get({
            [GLOSSARY_KEY]: [],
            [TM_KEY]: [],
            [STATS_KEY]: { savedApiCalls: 0 },
          });
          sendResponse({
            ok: true,
            data: {
              v: 2,
              exportedAt: Date.now(),
              glossary: store[GLOSSARY_KEY] || [],
              tm: store[TM_KEY] || [],
              stats: store[STATS_KEY] || { savedApiCalls: 0 },
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

          const counts = await withLocalStore(
            { [GLOSSARY_KEY]: [], [TM_KEY]: [], [DELETED_SIGS_KEY]: [] },
            (store) => {
              const deletedSet = new Set();
              store[GLOSSARY_KEY] = mergeGlossaryLists(
                store[GLOSSARY_KEY],
                incomingGlossary,
                deletedSet
              );
              store[TM_KEY] = mergeTmLists(
                store[TM_KEY],
                incomingTm,
                [],
                deletedSet
              );
              return {
                glossaryCount: store[GLOSSARY_KEY].length,
                tmCount: store[TM_KEY].length,
              };
            }
          );
          scheduleAutoSync();
          sendResponse({ ok: true, ...counts });
          break;
        }

        // Content script báo có tin nhắn ĐẾN mới từ Instagram
        case "INCOMING_MESSAGE": {
          const settings = await getSettings();
          if (!settings.autoTranslateIncoming) {
            sendResponse({ ok: true, skipped: true });
            break;
          }
          const item = await translateIncomingText(message.text, "auto", message.messageId);
          // Đẩy kết quả cho side panel
          broadcastNewItem(item);
          sendResponse({ ok: true, item });
          break;
        }

        // Side panel: "Dán & dịch" — dịch 1 đoạn text như tin ĐẾN
        case "TRANSLATE_INCOMING": {
          const item = await translateIncomingText(message.text, "paste");
          sendResponse({ ok: true, item });
          break;
        }

        // Side panel: dịch chữ trong ảnh (chọn file / dán ảnh)
        case "TRANSLATE_IMAGE": {
          const item = await translateIncomingImage(parseDataUrl(message.dataUrl));
          sendResponse({ ok: true, item });
          break;
        }

        // Side panel yêu cầu dịch tin nhắn user sắp gửi (chiều ngược lại)
        case "TRANSLATE_OUTGOING": {
          const settings = await getSettings();
          const targetLang = message.targetLang || settings.outgoingTargetLang;
          const result = await translateWithGemini({
            text: message.text,
            targetLang,
            mode: "outgoing",
            settings,
          });
          const item = await addHistoryItem({
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

        // Side panel: 3 biến thể phong cách cho tin nhắn đi
        case "STYLE_VARIANTS": {
          const settings = await getSettings();
          const variants = await getStyleVariants({
            text: message.text,
            targetLang: message.targetLang || settings.outgoingTargetLang,
            settings,
          });
          sendResponse({ ok: true, variants });
          break;
        }

        // Side panel yêu cầu gợi ý câu trả lời cho 1 tin nhắn đến đã dịch
        case "SUGGEST_REPLIES": {
          const settings = await getSettings();
          const result = await suggestReplies({
            originalMessage: message.original,
            detectedLang: message.detectedLang,
            translationVi: message.translationVi,
            settings,
          });
          if (message.messageId) {
            await updateHistoryItem(message.messageId, {
              suggestions: result.suggestions,
            });
          }
          sendResponse({ ok: true, suggestions: result.suggestions });
          break;
        }

        case "DELETE_HISTORY_ITEM": {
          await deleteHistoryItem(message.id);
          sendResponse({ ok: true });
          break;
        }

        case "CLEAR_HISTORY": {
          await withHistory((list) => {
            list.length = 0;
          });
          TRANSLATION_CACHE.clear();
          scheduleAutoSync();
          sendResponse({ ok: true });
          break;
        }

        case "EXPORT_HISTORY": {
          const store = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
          sendResponse({ ok: true, items: store[HISTORY_KEY] || [] });
          break;
        }

        case "IMPORT_HISTORY": {
          const items = Array.isArray(message.items) ? message.items : [];
          if (items.length) {
            await withLocalStore(
              { [HISTORY_KEY]: [], [TM_KEY]: [], [DELETED_SIGS_KEY]: [] },
              (store) => {
                const list = store[HISTORY_KEY];
                const existingIds = new Set(list.map((it) => it.id));
                for (const item of items) {
                  if (item && item.original && item.translation) {
                    if (!item.id || existingIds.has(item.id)) {
                      item.id = newId(item.kind === "outgoing" ? "out" : "in");
                    }
                    list.push(item);
                    existingIds.add(item.id);
                  }
                }
                list.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                if (list.length > MAX_HISTORY_ITEMS) {
                  list.splice(0, list.length - MAX_HISTORY_ITEMS);
                }
                const deletedSet = new Set(store[DELETED_SIGS_KEY] || []);
                store[TM_KEY] = mergeTmLists(store[TM_KEY], [], list, deletedSet);
              }
            );
            TRANSLATION_CACHE.clear();
            scheduleAutoSync();
          }
          sendResponse({ ok: true, count: items.length });
          break;
        }

        // Side panel muốn chèn văn bản đã dịch vào khung chat Instagram đang mở
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
  return true; // giữ kênh async mở cho sendResponse
});
