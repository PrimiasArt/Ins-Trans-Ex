// content.js — chạy trên https://www.instagram.com/direct/*
// LƯU Ý QUAN TRỌNG:
// Instagram dùng class name bị obfuscate (hash) và có thể đổi bất cứ lúc nào.
// Script này dùng các thuộc tính tương đối ổn định (role, aria-label, contenteditable)
// thay vì class name cụ thể. Nếu Instagram đổi UI và script ngừng hoạt động,
// hãy mở DevTools, kiểm tra lại các selector bên dưới (đánh dấu SELECTOR) và cập nhật.

(() => {
  const SEEN = new Set(); // tránh xử lý trùng 1 tin nhắn nhiều lần
  const MAX_SEEN = 500;
  let observer = null;
  let urlTimer = null;
  let retryTimer = null;
  let autoTranslateEnabled = false;
  let lastUrl = location.href;

  function hashText(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return String(h);
  }

  // SELECTOR: khung chứa toàn bộ danh sách tin nhắn của 1 thread đang mở.
  function findMessageContainer() {
    const candidates = [
      document.querySelector('div[role="grid"]'),
      document.querySelector('div[aria-label="Message list"]'),
      document.querySelector('div[role="main"] section'),
    ].filter(Boolean);
    return candidates[0] || document.querySelector('div[role="main"]');
  }

  function extractTextFromRow(rowEl) {
    const text = rowEl.innerText?.trim();
    return text || "";
  }

  function isIncomingRow(rowEl) {
    const style = window.getComputedStyle(rowEl);
    if (style.flexDirection === "row-reverse") return false;
    if (style.justifyContent === "flex-end") return false;
    const rect = rowEl.getBoundingClientRect();
    const parentRect =
      rowEl.closest('[role="grid"]')?.getBoundingClientRect() ||
      rowEl.parentElement?.getBoundingClientRect();
    if (parentRect) {
      const centerX = rect.left + rect.width / 2;
      const parentCenterX = parentRect.left + parentRect.width / 2;
      return centerX < parentCenterX;
    }
    return true;
  }

  function handleNewRow(rowEl) {
    if (!autoTranslateEnabled) return;
    const text = extractTextFromRow(rowEl);
    if (!text) return;

    const id = hashText(text + "|" + (rowEl.dataset.igtId || ""));
    if (SEEN.has(id)) return;
    if (SEEN.size >= MAX_SEEN) {
      const oldest = SEEN.values().next().value;
      if (oldest !== undefined) SEEN.delete(oldest);
    }
    SEEN.add(id);

    if (!isIncomingRow(rowEl)) return;

    chrome.runtime
      .sendMessage({
        type: "INCOMING_MESSAGE",
        text,
        messageId: id,
      })
      .catch(() => {});
  }

  function scanExistingRows(container) {
    const rows = container.querySelectorAll('div[role="row"]');
    rows.forEach((row) => handleNewRow(row));
  }

  function stopObserving() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (urlTimer) {
      clearInterval(urlTimer);
      urlTimer = null;
    }
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function startObserving() {
    if (!autoTranslateEnabled) {
      stopObserving();
      return;
    }
    const container = findMessageContainer();
    if (!container) {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(startObserving, 1500);
      return;
    }

    if (observer) observer.disconnect();

    scanExistingRows(container);

    observer = new MutationObserver((mutations) => {
      if (!autoTranslateEnabled) return;
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches?.('div[role="row"]')) {
            handleNewRow(node);
          } else {
            node.querySelectorAll?.('div[role="row"]').forEach((row) =>
              handleNewRow(row)
            );
          }
        });
      }
    });

    observer.observe(container, { childList: true, subtree: true });

    if (!urlTimer) {
      urlTimer = setInterval(() => {
        if (!autoTranslateEnabled) return;
        if (location.href !== lastUrl) {
          lastUrl = location.href;
          SEEN.clear();
          startObserving();
        }
      }, 1500);
    }
  }

  // Chỉ bật MutationObserver khi người dùng thực sự bật "Tự động dịch tin đến"
  // để không làm chậm trang Instagram Direct và không bắn message thừa về background.
  chrome.storage.sync.get({ autoTranslateIncoming: false }, (res) => {
    autoTranslateEnabled = Boolean(res?.autoTranslateIncoming);
    if (autoTranslateEnabled) {
      startObserving();
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && changes.autoTranslateIncoming) {
      autoTranslateEnabled = Boolean(changes.autoTranslateIncoming.newValue);
      if (autoTranslateEnabled) {
        startObserving();
      } else {
        stopObserving();
      }
    }
  });

  // ---- Chèn text vào ô soạn tin (được background gọi qua executeScript) ----
  function findComposeBox() {
    const candidates = [
      document.querySelector('div[aria-label="Message"][contenteditable="true"]'),
      document.querySelector('div[contenteditable="true"][role="textbox"]'),
      document.querySelector('div[contenteditable="true"]'),
    ].filter(Boolean);
    return candidates[0] || null;
  }

  window.__igtInsertText = function (text) {
    const box = findComposeBox();
    if (!box) return false;

    box.focus();

    document.execCommand("selectAll", false, undefined);
    document.execCommand("insertText", false, text);

    if (box.innerText.trim() !== text.trim()) {
      box.innerText = text;
      box.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
    return true;
  };
})();
