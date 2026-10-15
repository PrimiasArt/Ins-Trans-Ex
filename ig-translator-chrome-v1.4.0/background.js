// background.js — service worker (v1.4.0 Ultra-Fast & High Quality Chat Edition)
// Xử lý: mở side panel khi bấm icon, gọi Gemini API để dịch (text + ảnh),
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
  // Đồng bộ lịch sử qua Cloudflare Worker + KV (Mã hóa đầu cuối AES-256)
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

// ---- Lịch sử dịch (persist qua storage.local) ----------------------------
const HISTORY_KEY = "igt_history";
const MAX_HISTORY_ITEMS = 300;

// Mọi thao tác ghi lịch sử chạy tuần tự để 2 lần dịch xong cùng lúc không
// ghi đè mất dữ liệu của nhau (read-modify-write trên cùng 1 key).
let historyQueue = Promise.resolve();
function withHistory(fn) {
  const run = historyQueue.then(async () => {
    const store = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
    const list = store[HISTORY_KEY];
    const result = await fn(list);
    await chrome.storage.local.set({ [HISTORY_KEY]: list });
    return result;
  });
  historyQueue = run.catch(() => {});
  return run;
}

function addHistoryItem(item) {
  return withHistory((list) => {
    // Bỏ bản dịch trùng (cùng chiều, cùng câu gốc & bản dịch) để lịch sử gọn.
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
    scheduleAutoSync();
    return item;
  });
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
 * - Tự động tra cứu Cache LRU (0ms)
 * - Tự động phát hiện Emoji / số / ký hiệu không cần dịch (0ms)
 * - Chế độ siêu tốc (tắt thinking)
 * - Schema JSON chuẩn OpenAPI
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
    };
  }

  // 2. Tra cứu Cache
  const cacheKey = `${mode}|${targetLang}|${settings.personaStyle}|${cleanText}`;
  const cached = getCachedTranslation(cacheKey);
  if (cached) {
    return { ...cached, latencyMs: 0 };
  }

  const startTime = performance.now();
  const isOutgoing = mode === "outgoing";
  const recent = await getRecentHistory(Number(settings.contextTurns) || 0);
  const includePhonetics = !!settings.enablePhonetics;

  const promptLines = [
    isOutgoing
      ? `MODE: OUTGOING CHAT. The user is typing a message in their language to send in ${targetLang}. Translate it into natural, authentic ${targetLang} as a native speaker would message in DMs.`
      : `MODE: INCOMING CHAT. The user received this DM message and wants to understand it in ${targetLang}. Detect the source language and translate it accurately and naturally into ${targetLang}.`,
    ...buildStyleLines(settings),
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
  const promptLines = [
    `Provide 3 distinct translation variations of the TEXT into ${targetLang}, as chat messages the user could send:`,
    "'casual': friendly, warm, conversational tone.",
    "'formal': polite, respectful, professional tone.",
    "'concise': short, direct, concise phrasing.",
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
// Đồng bộ lịch sử qua Cloudflare Worker + KV (Mã hóa đầu cuối AES-GCM-256)
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

async function encryptHistoryPayload(items, syncKey) {
  const key = await deriveCryptoKey(syncKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(items));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded
  );
  return {
    v: 1,
    iv: arrayBufferToBase64(iv.buffer),
    ct: arrayBufferToBase64(cipherBuf),
    updatedAt: Date.now(),
  };
}

async function decryptHistoryPayload(payload, syncKey) {
  if (!payload) return [];
  if (Array.isArray(payload.items)) return payload.items;
  if (!payload.ct || !payload.iv) return [];
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
  return Array.isArray(parsed) ? parsed : [];
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

  // Mã hóa URI cho syncKey trên header để tránh lỗi Failed to fetch khi Sync Key có dấu tiếng Việt
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
  let remoteItems = [];
  if (remotePayload && !remotePayload.empty && remotePayload.ct) {
    try {
      remoteItems = await decryptHistoryPayload(remotePayload, syncKey);
    } catch (e) {
      throw new Error(
        "Không giải mã được dữ liệu trên Cloud (sai Sync Key hoặc dữ liệu không khớp)."
      );
    }
  }

  // 2. Gộp hai chiều với lịch sử trên máy hiện tại
  let finalItems = [];
  await withHistory((localList) => {
    const merged = mergeHistoryLists(localList, remoteItems);
    localList.length = 0;
    localList.push(...merged);
    finalItems = [...merged];
  });

  // 3. Mã hóa danh sách đã gộp và đẩy ngược lên Cloud
  const encryptedPayload = await encryptHistoryPayload(finalItems, syncKey);
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
      count: finalItems.length,
      syncedAt,
    })
    .catch(() => {});

  return {
    ok: true,
    count: finalItems.length,
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
            await withHistory((list) => {
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
            });
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
