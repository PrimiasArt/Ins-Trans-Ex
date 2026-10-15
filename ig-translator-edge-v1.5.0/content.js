// content.js — chạy trên https://www.instagram.com/direct/*
// LƯU Ý QUAN TRỌNG:
// Instagram dùng class name bị obfuscate (hash) và có thể đổi bất cứ lúc nào.
// Script này dùng các thuộc tính tương đối ổn định (role, aria-label, contenteditable)
// thay vì class name cụ thể. Nếu Instagram đổi UI và script ngừng hoạt động,
// hãy mở DevTools, kiểm tra lại các selector bên dưới (đánh dấu SELECTOR) và cập nhật.

(() => {
  const SEEN = new Set(); // tránh xử lý trùng 1 tin nhắn nhiều lần
  let observer = null;

  function hashText(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return String(h);
  }

  // SELECTOR: khung chứa toàn bộ danh sách tin nhắn của 1 thread đang mở.
  // Instagram thường render các dòng tin nhắn với role="row" bên trong 1 vùng scroll.
  function findMessageContainer() {
    // Thử vài chiến lược khác nhau, ưu tiên từ cụ thể -> chung chung.
    const candidates = [
      document.querySelector('div[role="grid"]'),
      document.querySelector('div[aria-label="Message list"]'),
      document.querySelector('div[role="main"] section'),
    ].filter(Boolean);
    return candidates[0] || document.querySelector('div[role="main"]');
  }

  // SELECTOR: xác định 1 "row" tin nhắn và text bên trong nó.
  function extractTextFromRow(rowEl) {
    // Instagram thường bọc nội dung text trong các <div> / <span> lồng nhau.
    // Loại bỏ các phần tử thường KHÔNG phải nội dung tin (nút reaction, avatar...).
    const text = rowEl.innerText?.trim();
    return text || "";
  }

  // Heuristic phân biệt tin ĐẾN (của đối phương) và tin ĐI (của mình):
  // Instagram thường canh tin của mình sang phải (justify-content / margin-left auto),
  // tin của đối phương canh trái. Đây là heuristic, có thể cần chỉnh theo giao diện thật.
  function isIncomingRow(rowEl) {
    const style = window.getComputedStyle(rowEl);
    if (style.flexDirection === "row-reverse") return false;
    if (style.justifyContent === "flex-end") return false;
    // Kiểm tra thêm: nếu row nằm bên trái nhiều hơn nửa chiều rộng container -> coi là incoming
    const rect = rowEl.getBoundingClientRect();
    const parentRect =
      rowEl.closest('[role="grid"]')?.getBoundingClientRect() ||
      rowEl.parentElement?.getBoundingClientRect();
    if (parentRect) {
      const centerX = rect.left + rect.width / 2;
      const parentCenterX = parentRect.left + parentRect.width / 2;
      return centerX < parentCenterX;
    }
    return true; // mặc định coi là incoming nếu không xác định được
  }

  function handleNewRow(rowEl) {
    const text = extractTextFromRow(rowEl);
    if (!text) return;

    const id = hashText(text + "|" + (rowEl.dataset.igtId || ""));
    if (SEEN.has(id)) return;
    SEEN.add(id);

    if (!isIncomingRow(rowEl)) return; // chỉ dịch tin ĐẾN

    chrome.runtime
      .sendMessage({
        type: "INCOMING_MESSAGE",
        text,
        messageId: id,
      })
      .catch(() => {
        /* background có thể chưa sẵn sàng, bỏ qua lỗi lặt vặt */
      });
  }

  function scanExistingRows(container) {
    const rows = container.querySelectorAll('div[role="row"]');
    rows.forEach((row) => handleNewRow(row));
  }

  function startObserving() {
    const container = findMessageContainer();
    if (!container) {
      // Instagram SPA có thể chưa render xong, thử lại sau 1.5s
      setTimeout(startObserving, 1500);
      return;
    }

    if (observer) observer.disconnect();

    scanExistingRows(container);

    observer = new MutationObserver((mutations) => {
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
  }

  // Instagram là SPA (React) — chuyển thread không load lại trang.
  // Theo dõi thay đổi URL để re-attach observer vào container mới.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      SEEN.clear();
      startObserving();
    }
  }, 1000);

  startObserving();

  // ---- Chèn text vào ô soạn tin (được background gọi qua executeScript) ----
  // SELECTOR: ô soạn tin của Instagram Direct là 1 div[contenteditable="true"],
  // thường có aria-label chứa "Message" hoặc placeholder tương tự.
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

    // Chèn text theo cách React kiểm soát input sẽ nhận diện được:
    // dùng execCommand (vẫn hoạt động trong contenteditable dù deprecated)
    // để trigger đúng input events mà React lắng nghe.
    document.execCommand("selectAll", false, undefined);
    document.execCommand("insertText", false, text);

    // Fallback nếu execCommand không có tác dụng (một số trình duyệt/site chặn):
    if (box.innerText.trim() !== text.trim()) {
      box.innerText = text;
      box.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
    return true;
  };
})();
