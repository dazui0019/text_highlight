const termsInput = document.querySelector("#terms");
const statusText = document.querySelector("#status");
const clearButton = document.querySelector("#clearButton");
const enabledToggle = document.querySelector("#enabledToggle");
const backgroundColorInput = document.querySelector("#backgroundColor");
const textColorInput = document.querySelector("#textColor");
const borderRadiusInput = document.querySelector("#borderRadius");
const REGEX_FLAGS_PATTERN = /^[dgimsuvy]*$/;
const AUTO_APPLY_DELAY = 180;
const DEFAULT_HIGHLIGHT_STYLE = {
  backgroundColor: "#ffe066",
  textColor: "#1f2937",
  borderRadius: 2
};
let autoApplyTimer = 0;

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

function isHexColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function normalizeBorderRadius(value) {
  const radius = Number.parseInt(value, 10);

  if (!Number.isFinite(radius)) {
    return DEFAULT_HIGHLIGHT_STYLE.borderRadius;
  }

  return Math.min(Math.max(radius, 0), 16);
}

function normalizeHighlightStyle(style) {
  const source = style && typeof style === "object" ? style : {};

  return {
    backgroundColor: isHexColor(source.backgroundColor)
      ? source.backgroundColor
      : DEFAULT_HIGHLIGHT_STYLE.backgroundColor,
    textColor: isHexColor(source.textColor)
      ? source.textColor
      : DEFAULT_HIGHLIGHT_STYLE.textColor,
    borderRadius: normalizeBorderRadius(source.borderRadius)
  };
}

function readHighlightStyle() {
  return normalizeHighlightStyle({
    backgroundColor: backgroundColorInput.value,
    textColor: textColorInput.value,
    borderRadius: borderRadiusInput.value
  });
}

function applyHighlightStyleToForm(style) {
  const normalizedStyle = normalizeHighlightStyle(style);
  backgroundColorInput.value = normalizedStyle.backgroundColor;
  textColorInput.value = normalizedStyle.textColor;
  borderRadiusInput.value = String(normalizedStyle.borderRadius);
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

function readCurrentConfig() {
  return {
    terms: parseTerms(termsInput.value),
    highlightStyle: readHighlightStyle(),
    enabled: enabledToggle.checked
  };
}

async function clearHighlightsOnPage() {
  return sendMessageToActiveTab({ type: "clear-highlights" });
}

async function applyCurrentConfig(config) {
  if (!config.enabled) {
    try {
      await clearHighlightsOnPage();
      setStatus("已关闭自动高亮。");
    } catch (error) {
      setStatus(getInjectionErrorMessage(error.tab, error), true);
    }

    return;
  }

  try {
    validateTerms(config.terms);
  } catch (error) {
    try {
      await clearHighlightsOnPage();
    } catch (clearError) {}

    setStatus(error.message, true);
    return;
  }

  try {
    const result = await sendMessageToActiveTab({
      type: "apply-highlights",
      terms: config.terms,
      highlightStyle: config.highlightStyle
    });

    if (result?.error) {
      setStatus(result.error, true);
      return;
    }

    if (!config.terms.length) {
      setStatus("自动高亮已开启，当前规则为空。");
      return;
    }

    const count = result?.count ?? 0;
    setStatus(`已自动高亮 ${count} 处匹配内容。`);
  } catch (error) {
    setStatus(getInjectionErrorMessage(error.tab, error), true);
  }
}

async function persistCurrentConfig() {
  const config = readCurrentConfig();

  await chrome.storage.sync.set(config);
  return config;
}

function scheduleAutoApply() {
  window.clearTimeout(autoApplyTimer);
  autoApplyTimer = window.setTimeout(() => {
    persistCurrentConfig()
      .then((config) => {
        if (!config.enabled) {
          return;
        }

        return applyCurrentConfig(config);
      })
      .catch(() => {
        setStatus("操作失败，请稍后重试。", true);
      });
  }, AUTO_APPLY_DELAY);
}

async function loadSavedConfig() {
  const {
    terms = [],
    highlightStyle = DEFAULT_HIGHLIGHT_STYLE,
    enabled = false
  } = await chrome.storage.sync.get({
    terms: [],
    highlightStyle: DEFAULT_HIGHLIGHT_STYLE,
    enabled: false
  });

  termsInput.value = Array.isArray(terms) ? terms.join("\n") : "";
  applyHighlightStyleToForm(highlightStyle);
  enabledToggle.checked = Boolean(enabled);

  if (enabled) {
    await applyCurrentConfig({
      terms: Array.isArray(terms) ? terms : [],
      highlightStyle,
      enabled: true
    });
  }
}

async function handleToggleChange() {
  const config = await persistCurrentConfig();
  await applyCurrentConfig(config);
}

async function handleClear() {
  termsInput.value = "";

  try {
    const config = await persistCurrentConfig();

    if (config.enabled) {
      await applyCurrentConfig(config);
      return;
    }

    setStatus("已清空规则。");
  } catch (error) {
    setStatus("清空失败，请稍后重试。", true);
  }
}

enabledToggle.addEventListener("change", () => {
  handleToggleChange().catch(() => {
    setStatus("操作失败，请稍后重试。", true);
  });
});

clearButton.addEventListener("click", () => {
  handleClear().catch(() => {
    setStatus("清空失败，请稍后重试。", true);
  });
});

termsInput.addEventListener("input", scheduleAutoApply);
backgroundColorInput.addEventListener("input", scheduleAutoApply);
textColorInput.addEventListener("input", scheduleAutoApply);
borderRadiusInput.addEventListener("input", scheduleAutoApply);

loadSavedConfig().catch(() => {
  setStatus("无法读取已保存的高亮内容。", true);
});
