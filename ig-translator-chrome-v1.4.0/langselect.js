// langselect.js — danh sách ngôn ngữ dùng chung + component dropdown có ô
// tìm kiếm nhanh (combobox), dùng cho cả trang Settings và side panel.

// Tên tiếng Anh (Gemini hiểu tốt nhất khi dùng tên này trong prompt dịch).
const IGT_LANGUAGES = [
  "Vietnamese",
  "English",
  "Chinese (Simplified)",
  "Chinese (Traditional)",
  "Japanese",
  "Korean",
  "Thai",
  "Indonesian",
  "Malay",
  "Filipino (Tagalog)",
  "Khmer",
  "Lao",
  "Burmese",
  "Hindi",
  "Bengali",
  "Urdu",
  "Punjabi",
  "Tamil",
  "Telugu",
  "Marathi",
  "Gujarati",
  "Kannada",
  "Malayalam",
  "Nepali",
  "Sinhala",
  "Arabic",
  "Persian (Farsi)",
  "Turkish",
  "Hebrew",
  "French",
  "German",
  "Spanish",
  "Portuguese",
  "Portuguese (Brazil)",
  "Italian",
  "Dutch",
  "Polish",
  "Russian",
  "Ukrainian",
  "Czech",
  "Slovak",
  "Romanian",
  "Hungarian",
  "Greek",
  "Swedish",
  "Norwegian",
  "Danish",
  "Finnish",
  "Bulgarian",
  "Croatian",
  "Serbian",
  "Slovenian",
  "Lithuanian",
  "Latvian",
  "Estonian",
  "Icelandic",
  "Irish",
  "Welsh",
  "Catalan",
  "Swahili",
  "Amharic",
  "Zulu",
  "Afrikaans",
  "Mongolian",
  "Kazakh",
  "Uzbek",
  "Azerbaijani",
  "Georgian",
  "Armenian",
  "Albanian",
  "Bosnian",
  "Macedonian",
  "Maltese",
  "Haitian Creole",
];

/**
 * Tạo 1 dropdown chọn ngôn ngữ có ô tìm kiếm nhanh (gõ để lọc).
 * options:
 *  - container: element rỗng sẽ chứa component
 *  - languages: mảng string (mặc định IGT_LANGUAGES)
 *  - value: giá trị đã chọn ban đầu
 *  - placeholder: placeholder cho ô nhập
 *  - onChange(lang): gọi khi người dùng chọn 1 ngôn ngữ mới
 * Trả về { getValue(), setValue(lang) }
 */
function createLangSelect({
  container,
  languages,
  value,
  placeholder,
  onChange,
}) {
  const list = languages && languages.length ? languages : IGT_LANGUAGES;
  container.classList.add("lang-select");
  container.innerHTML = "";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "lang-select-input";
  input.placeholder = placeholder || "Tìm & chọn ngôn ngữ...";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.value = value || "";

  const dropdown = document.createElement("div");
  dropdown.className = "lang-select-dropdown hidden";

  container.appendChild(input);
  container.appendChild(dropdown);

  let currentValue = value || "";

  function renderList(filterText) {
    const q = (filterText || "").trim().toLowerCase();
    const filtered = q ? list.filter((l) => l.toLowerCase().includes(q)) : list;

    dropdown.innerHTML = "";
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "lang-option lang-option-empty";
      empty.textContent = "Không tìm thấy ngôn ngữ phù hợp";
      dropdown.appendChild(empty);
      return;
    }
    filtered.forEach((lang) => {
      const opt = document.createElement("div");
      opt.className = "lang-option";
      if (lang === currentValue) opt.classList.add("active");
      opt.textContent = lang;
      // mousedown (không phải click) để chạy TRƯỚC sự kiện blur của input
      opt.addEventListener("mousedown", (e) => {
        e.preventDefault();
        selectValue(lang);
      });
      dropdown.appendChild(opt);
    });
  }

  function selectValue(lang) {
    currentValue = lang;
    input.value = lang;
    closeDropdown();
    if (typeof onChange === "function") onChange(lang);
  }

  function openDropdown() {
    dropdown.classList.remove("hidden");
    renderList("");
  }

  function closeDropdown() {
    dropdown.classList.add("hidden");
  }

  input.addEventListener("focus", () => {
    input.select();
    openDropdown();
  });

  input.addEventListener("input", () => {
    dropdown.classList.remove("hidden");
    renderList(input.value);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.value = currentValue;
      closeDropdown();
      input.blur();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const first = dropdown.querySelector(
        ".lang-option:not(.lang-option-empty)"
      );
      if (first) selectValue(first.textContent);
    }
  });

  input.addEventListener("blur", () => {
    // Gõ tự do không khớp lựa chọn nào -> revert về giá trị đã chọn gần nhất
    // (tránh lưu nhầm 1 chuỗi ngôn ngữ tự chế không có trong danh sách).
    setTimeout(() => {
      if (input.value !== currentValue) input.value = currentValue;
    }, 0);
  });

  document.addEventListener("click", (e) => {
    if (!container.contains(e.target)) closeDropdown();
  });

  return {
    getValue: () => currentValue,
    setValue: (lang) => {
      currentValue = lang || "";
      input.value = currentValue;
    },
  };
}

// Mã BCP-47 cho đọc to (speechSynthesis) theo tên ngôn ngữ ở trên.
const IGT_LANG_CODES = {
  Vietnamese: "vi-VN", English: "en-US", "Chinese (Simplified)": "zh-CN",
  "Chinese (Traditional)": "zh-TW", Japanese: "ja-JP", Korean: "ko-KR",
  Thai: "th-TH", Indonesian: "id-ID", Malay: "ms-MY", "Filipino (Tagalog)": "fil-PH",
  Khmer: "km-KH", Lao: "lo-LA", Burmese: "my-MM", Hindi: "hi-IN", Bengali: "bn-IN",
  Urdu: "ur-PK", Punjabi: "pa-IN", Tamil: "ta-IN", Telugu: "te-IN", Marathi: "mr-IN",
  Gujarati: "gu-IN", Kannada: "kn-IN", Malayalam: "ml-IN", Nepali: "ne-NP",
  Sinhala: "si-LK", Arabic: "ar-SA", "Persian (Farsi)": "fa-IR", Turkish: "tr-TR",
  Hebrew: "he-IL", French: "fr-FR", German: "de-DE", Spanish: "es-ES",
  Portuguese: "pt-PT", "Portuguese (Brazil)": "pt-BR", Italian: "it-IT", Dutch: "nl-NL",
  Polish: "pl-PL", Russian: "ru-RU", Ukrainian: "uk-UA", Czech: "cs-CZ", Slovak: "sk-SK",
  Romanian: "ro-RO", Hungarian: "hu-HU", Greek: "el-GR", Swedish: "sv-SE",
  Norwegian: "nb-NO", Danish: "da-DK", Finnish: "fi-FI", Bulgarian: "bg-BG",
  Croatian: "hr-HR", Serbian: "sr-RS", Slovenian: "sl-SI", Lithuanian: "lt-LT",
  Latvian: "lv-LV", Estonian: "et-EE", Icelandic: "is-IS", Irish: "ga-IE", Welsh: "cy-GB",
  Catalan: "ca-ES", Swahili: "sw-KE", Amharic: "am-ET", Zulu: "zu-ZA", Afrikaans: "af-ZA",
  Mongolian: "mn-MN", Kazakh: "kk-KZ", Uzbek: "uz-UZ", Azerbaijani: "az-AZ",
  Georgian: "ka-GE", Armenian: "hy-AM", Albanian: "sq-AL", Bosnian: "bs-BA",
  Macedonian: "mk-MK", Maltese: "mt-MT", "Haitian Creole": "ht-HT",
};

/**
 * Tên ngôn ngữ (có thể do Gemini trả về, vd "Thai", "thai language",
 * "Chinese") -> mã BCP-47. Trả về "" nếu không đoán được.
 */
function igtLangCode(name) {
  if (!name) return "";
  if (IGT_LANG_CODES[name]) return IGT_LANG_CODES[name];
  const q = String(name).toLowerCase();
  const hit = Object.keys(IGT_LANG_CODES).find(
    (k) => q.startsWith(k.toLowerCase().split(" ")[0])
  );
  return hit ? IGT_LANG_CODES[hit] : "";
}

// Văn phong dịch nhanh — key phải khớp PERSONA_PROMPTS trong background.js.
const IGT_PERSONAS = [
  { value: "default", label: "Mặc định" },
  { value: "casual", label: "💖 Thân mật" },
  { value: "formal", label: "💼 Trang trọng" },
  { value: "genz", label: "🤣 Gen Z / lóng" },
  { value: "tech", label: "💻 Kỹ thuật / IT" },
];

window.IGT_LANGUAGES = IGT_LANGUAGES;
window.IGT_LANG_CODES = IGT_LANG_CODES;
window.IGT_PERSONAS = IGT_PERSONAS;
window.igtLangCode = igtLangCode;
window.createLangSelect = createLangSelect;
