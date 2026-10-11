// theme.js — áp dụng dark/light mode + màu chủ đạo tuỳ chỉnh.
// Load script này SỚM (đầu <head>, trước file .css) để tránh nháy sai theme.
(function () {
  const DEFAULT_THEME = "system"; // "system" | "light" | "dark"
  const DEFAULT_ACCENT = "#405de6";

  function resolveTheme(theme) {
    if (theme === "light" || theme === "dark") return theme;
    // "system" hoặc rỗng -> theo prefers-color-scheme của hệ điều hành/trình duyệt
    const prefersDark =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    return prefersDark ? "dark" : "light";
  }

  function applyTheme(theme, accentColor) {
    const root = document.documentElement;
    root.dataset.theme = resolveTheme(theme);
    root.style.setProperty("--accent", accentColor || DEFAULT_ACCENT);
  }

  function loadAndApply() {
    chrome.storage.sync.get(
      { theme: DEFAULT_THEME, accentColor: DEFAULT_ACCENT },
      (s) => applyTheme(s.theme, s.accentColor)
    );
  }

  loadAndApply();

  // Settings đổi theme/màu ở trang khác (hoặc panel khác) -> áp dụng lại ngay.
  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync") return;
      if (changes.theme || changes.accentColor) loadAndApply();
    });
  }

  // Đang ở chế độ "Theo hệ thống" -> theo dõi luôn khi OS đổi light/dark.
  if (window.matchMedia) {
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => {
        chrome.storage.sync.get({ theme: DEFAULT_THEME }, (s) => {
          if (!s.theme || s.theme === "system") loadAndApply();
        });
      });
  }

  // Cho phép options.js gọi lại để xem trước (preview) trước khi bấm Lưu.
  window.IGT_THEME = { apply: applyTheme, DEFAULT_THEME, DEFAULT_ACCENT };
})();
