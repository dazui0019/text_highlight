const termsInput = document.querySelector("#terms");
const statusText = document.querySelector("#status");
const highlightButton = document.querySelector("#highlightButton");
const clearButton = document.querySelector("#clearButton");
const REGEX_FLAGS_PATTERN = /^[dgimsuvy]*$/;

function parseTerms(rawValue) {
  const seen = new Set();

  return rawValue
    .split(/\r?\n/)
    .map((term) => term.trim())
    .filter((term) => {
      if (!term || seen.has(term)) {
        return false;
      }

      seen.add(term);
      return true;
    });
}

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.style.color = isError ? "#b91c1c" : "#4b5563";
}

function parseRegexLiteral(term) {
  if (!term.startsWith("/")) {
    return null;
  }

  const lastSlashIndex = term.lastIndexOf("/");

  if (lastSlashIndex <= 0) {
    return null;
  }

  const pattern = term.slice(1, lastSlashIndex);
  const flags = term.slice(lastSlashIndex + 1);

  if (!REGEX_FLAGS_PATTERN.test(flags)) {
    return null;
  }

  return { pattern, flags };
}

function normalizeFlags(flags) {
  return [...new Set(`${flags}g`)].join("");
}

function validateTerms(terms) {
  for (const [index, term] of terms.entries()) {
    const regexLiteral = parseRegexLiteral(term);

    if (!regexLiteral) {
      continue;
    }

    try {
      new RegExp(regexLiteral.pattern, normalizeFlags(regexLiteral.flags));
    } catch (error) {
      throw new Error(`第 ${index + 1} 行正则无效：${error.message}`);
    }
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tab;
}

function isRestrictedPage(url) {
  return /^(about|chrome|chrome-extension|devtools|edge|moz-extension):/i.test(url);
}

function isWebStorePage(url) {
  return url.startsWith("https://chrome.google.com/webstore")
    || url.startsWith("https://chromewebstore.google.com");
}

function isMissingReceiverError(error) {
  return String(error?.message || "").includes("Receiving end does not exist");
}

function getInjectionErrorMessage(tab, error) {
  const url = tab?.url || "";

  if (url.startsWith("file://")) {
    return "这是本地文件页面，请先在 chrome://extensions/ 为该扩展开启“允许访问文件网址”，再刷新页面重试。";
  }

  if (isRestrictedPage(url) || isWebStorePage(url)) {
    return "当前页面是浏览器限制页面，无法注入脚本。请切到普通网页后再试。";
  }

  return "当前页面仍无法注入脚本。请刷新页面后重试；如果是 PDF 预览页或浏览器内置页面，也可能不支持。";
}

async function sendMessageToActiveTab(message) {
  const tab = await getActiveTab();

  if (!tab?.id) {
    throw new Error("无法找到当前标签页。");
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      error.tab = tab;
      throw error;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });

      return await chrome.tabs.sendMessage(tab.id, message);
    } catch (injectionError) {
      injectionError.tab = tab;
      throw injectionError;
    }
  }
}

async function loadSavedTerms() {
  const { terms = [] } = await chrome.storage.sync.get({ terms: [] });
  termsInput.value = Array.isArray(terms) ? terms.join("\n") : "";
}

async function handleHighlight() {
  const terms = parseTerms(termsInput.value);

  try {
    validateTerms(terms);
  } catch (error) {
    setStatus(error.message, true);
    return;
  }

  await chrome.storage.sync.set({ terms });

  try {
    const result = await sendMessageToActiveTab({
      type: "apply-highlights",
      terms
    });

    if (result?.error) {
      setStatus(result.error, true);
      return;
    }

    if (!terms.length) {
      setStatus("输入为空，已清除当前页面高亮。");
      return;
    }

    const count = result?.count ?? 0;
    setStatus(`已高亮 ${count} 处匹配内容。`);
  } catch (error) {
    setStatus(getInjectionErrorMessage(error.tab, error), true);
  }
}

async function handleClear() {
  termsInput.value = "";
  await chrome.storage.sync.set({ terms: [] });

  try {
    await sendMessageToActiveTab({ type: "clear-highlights" });
    setStatus("已清除当前页面高亮。");
  } catch (error) {
    setStatus(`已清空保存内容，但${getInjectionErrorMessage(error.tab, error)}`, true);
  }
}

highlightButton.addEventListener("click", () => {
  handleHighlight().catch(() => {
    setStatus("操作失败，请稍后重试。", true);
  });
});

clearButton.addEventListener("click", () => {
  handleClear().catch(() => {
    setStatus("清除失败，请稍后重试。", true);
  });
});

loadSavedTerms().catch(() => {
  setStatus("无法读取已保存的高亮内容。", true);
});
