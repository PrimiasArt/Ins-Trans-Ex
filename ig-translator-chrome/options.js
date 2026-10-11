const els = {
  apiKey: document.getElementById("apiKey"),
  model: document.getElementById("model"),
  loadModelsBtn: document.getElementById("loadModelsBtn"),
  modelHint: document.getElementById("modelHint"),
  autoTranslateIncoming: document.getElementById("autoTranslateIncoming"),
  customStyleInstruction: document.getElementById("customStyleInstruction"),
  suggestionCount: document.getElementById("suggestionCount"),
  personaStyle: document.getElementById("personaStyle"),
  contextTurns: document.getElementById("contextTurns"),
  themeSelect: document.getElementById("themeSelect"),
  accentColor: document.getElementById("accentColor"),
  accentPresets: document.getElementById("accentPresets"),
  resetAccentBtn: document.getElementById("resetAccentBtn"),
  saveBtn: document.getElementById("saveBtn"),
  savedMsg: document.getElementById("savedMsg"),
};

const ACCENT_PRESETS = [
  "#405de6", // xanh mặc định (IG blue/purple)
  "#e1306c", // hồng Instagram
  "#f56040", // cam
  "#1a8a3e", // xanh lá
  "#8a3ffc", // tím
  "#00a0b0", // xanh ngọc
];

let incomingLangSelect = null;
let outgoingLangSelect = null;

function initLangSelects() {
  incomingLangSelect = createLangSelect({
    container: document.getElementById("incomingTargetLangSelect"),
    languages: window.IGT_LANGUAGES,
    value: "Vietnamese",
    placeholder: "Tìm & chọn ngôn ngữ...",
  });
  outgoingLangSelect = createLangSelect({
    container: document.getElementById("outgoingTargetLangSelect"),
    languages: window.IGT_LANGUAGES,
    value: "English",
    placeholder: "Tìm & chọn ngôn ngữ...",
  });
}

function initPersonaSelect() {
  (window.IGT_PERSONAS || []).forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.value;
    opt.textContent = p.label;
    els.personaStyle.appendChild(opt);
  });
}

function renderAccentPresets() {
  els.accentPresets.innerHTML = "";
  ACCENT_PRESETS.forEach((color) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "accent-swatch";
    swatch.style.background = color;
    swatch.title = color;
    swatch.addEventListener("click", () => {
      els.accentColor.value = color;
      previewTheme();
    });
    els.accentPresets.appendChild(swatch);
  });
}

// Xem trước theme ngay trong trang Settings (chưa lưu vào storage).
function previewTheme() {
  if (window.IGT_THEME) {
    window.IGT_THEME.apply(els.themeSelect.value, els.accentColor.value);
  }
}

const DEFAULT_MODEL_HINT = els.modelHint.textContent;

function setModelHint(text, type) {
  els.modelHint.textContent = text;
  els.modelHint.classList.remove("error", "success");
  if (type) els.modelHint.classList.add(type);
}

function resetModelHint() {
  setModelHint(DEFAULT_MODEL_HINT, null);
}

function populateModelSelect(models, selectedValue) {
  els.model.innerHTML = "";

  if (!models.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.disabled = true;
    opt.selected = true;
    opt.textContent = "-- Không tìm thấy model nào --";
    els.model.appendChild(opt);
    return;
  }

  // Nếu model đã lưu trước đó không còn trong danh sách mới (bị Google gỡ),
  // vẫn thêm vào đầu list để không mất lựa chọn hiện tại của người dùng.
  const values = models.map((m) => m.value);
  if (selectedValue && !values.includes(selectedValue)) {
    const opt = document.createElement("option");
    opt.value = selectedValue;
    opt.textContent = `${selectedValue} (đã lưu, không còn trong danh sách)`;
    els.model.appendChild(opt);
  }

  for (const m of models) {
    const opt = document.createElement("option");
    opt.value = m.value;
    opt.textContent = m.label;
    els.model.appendChild(opt);
  }

  if (selectedValue && values.includes(selectedValue)) {
    els.model.value = selectedValue;
  } else if (!selectedValue) {
    els.model.value = values[0];
  }
}

/**
 * Gọi Gemini API models.list để lấy danh sách model hỗ trợ generateContent.
 * Chạy trực tiếp từ trang options (đã có host_permissions trong manifest).
 */
async function fetchAvailableModels(apiKey) {
  const models = [];
  let pageToken = "";

  do {
    const url = new URL(
      "https://generativelanguage.googleapis.com/v1beta/models"
    );
    url.searchParams.set("key", apiKey);
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      const msg = errBody?.error?.message || `Lỗi HTTP ${res.status}`;
      throw new Error(msg);
    }
    const data = await res.json();
    for (const m of data.models || []) {
      const methods = m.supportedGenerationMethods || [];
      if (!methods.includes("generateContent")) continue;
      const value = (m.name || "").replace(/^models\//, "");
      if (!value) continue;
      models.push({
        value,
        label: m.displayName ? `${m.displayName} (${value})` : value,
      });
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);

  // Model mới thường được thêm ở cuối theo response; sắp theo tên cho dễ tìm.
  models.sort((a, b) => a.value.localeCompare(b.value));
  return models;
}

async function loadModelsFromApi({ preserveSelection = true } = {}) {
  const apiKey = els.apiKey.value.trim();
  if (!apiKey) {
    setModelHint("Nhập Gemini API key trước, sau đó bấm Tải danh sách.", "error");
    return;
  }

  const previousSelection = preserveSelection ? els.model.value : "";

  els.loadModelsBtn.disabled = true;
  els.loadModelsBtn.textContent = "Đang tải...";
  setModelHint("Đang tải danh sách model từ Gemini API...", null);

  try {
    const models = await fetchAvailableModels(apiKey);
    populateModelSelect(models, previousSelection);
    setModelHint(
      `Đã tải ${models.length} model. Chọn model muốn dùng ở trên.`,
      "success"
    );
  } catch (err) {
    setModelHint(`Không tải được danh sách model: ${err.message}`, "error");
  } finally {
    els.loadModelsBtn.disabled = false;
    els.loadModelsBtn.textContent = "Tải danh sách";
  }
}

async function load() {
  const res = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  const s = res?.settings || {};
  els.apiKey.value = s.apiKey || "";
  incomingLangSelect.setValue(s.incomingTargetLang || "Vietnamese");
  outgoingLangSelect.setValue(s.outgoingTargetLang || "English");
  els.autoTranslateIncoming.checked = s.autoTranslateIncoming !== false;
  els.customStyleInstruction.value = s.customStyleInstruction || "";
  els.suggestionCount.value = s.suggestionCount || 3;
  els.personaStyle.value = s.personaStyle || "default";
  els.contextTurns.value = s.contextTurns ?? 5;
  els.themeSelect.value = s.theme || "system";
  els.accentColor.value = s.accentColor || "#405de6";

  // Nếu đã có model + API key đã lưu trước đó, hiện tạm option đó rồi tự
  // tải lại danh sách mới nhất để đối chiếu.
  if (s.model) {
    const opt = document.createElement("option");
    opt.value = s.model;
    opt.textContent = `${s.model} (đã lưu)`;
    els.model.innerHTML = "";
    els.model.appendChild(opt);
  }

  if (s.apiKey) {
    await loadModelsFromApi({ preserveSelection: true });
    if (s.model) els.model.value = s.model;
  } else {
    resetModelHint();
  }
}

renderAccentPresets();
initLangSelects();
initPersonaSelect();

els.themeSelect.addEventListener("change", previewTheme);
els.accentColor.addEventListener("input", previewTheme);
els.resetAccentBtn.addEventListener("click", () => {
  els.accentColor.value = window.IGT_THEME?.DEFAULT_ACCENT || "#405de6";
  previewTheme();
});

els.loadModelsBtn.addEventListener("click", () =>
  loadModelsFromApi({ preserveSelection: true })
);

els.saveBtn.addEventListener("click", async () => {
  if (!els.model.value) {
    setModelHint("Hãy chọn 1 model trước khi lưu.", "error");
    return;
  }

  const clampedSuggestionCount = Math.min(
    6,
    Math.max(1, parseInt(els.suggestionCount.value, 10) || 3)
  );
  els.suggestionCount.value = clampedSuggestionCount;

  const parsedTurns = parseInt(els.contextTurns.value, 10);
  const clampedContextTurns = Math.min(
    10,
    Math.max(0, Number.isNaN(parsedTurns) ? 5 : parsedTurns)
  );
  els.contextTurns.value = clampedContextTurns;

  const settings = {
    apiKey: els.apiKey.value.trim(),
    model: els.model.value,
    incomingTargetLang: incomingLangSelect.getValue() || "Vietnamese",
    outgoingTargetLang: outgoingLangSelect.getValue() || "English",
    autoTranslateIncoming: els.autoTranslateIncoming.checked,
    customStyleInstruction: els.customStyleInstruction.value.trim(),
    suggestionCount: clampedSuggestionCount,
    personaStyle: els.personaStyle.value,
    contextTurns: clampedContextTurns,
    theme: els.themeSelect.value,
    accentColor: els.accentColor.value,
  };
  await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings });
  els.savedMsg.classList.remove("hidden");
  setTimeout(() => els.savedMsg.classList.add("hidden"), 1500);
});

load();
