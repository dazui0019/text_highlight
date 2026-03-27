const signalRegexInput = document.querySelector("#signalRegex");
const statusText = document.querySelector("#status");
const saveButton = document.querySelector("#saveButton");
const resetButton = document.querySelector("#resetButton");
const REGEX_FLAGS_PATTERN = /^[dgimsuvy]*$/;
const DEFAULT_SIGNAL_REGEX = "([A-Za-z_][A-Za-z0-9_]*(?:\\s*\\/\\s*[A-Za-z_][A-Za-z0-9_]*)*)\\s*=+\\s*((?:0x[0-9A-Fa-f]+|\\d+)(?:\\s*\\/\\s*(?:0x[0-9A-Fa-f]+|\\d+))*)";

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

function normalizeSignalRegexSource(value) {
  const normalizedValue = String(value ?? "").trim();
  return normalizedValue || DEFAULT_SIGNAL_REGEX;
}

function validateSignalRegex(value) {
  const source = normalizeSignalRegexSource(value);
  const regexLiteral = parseRegexLiteral(source);
  const pattern = regexLiteral ? regexLiteral.pattern : source;
  const flags = normalizeFlags(regexLiteral ? regexLiteral.flags : "");

  try {
    new RegExp(pattern, flags);
  } catch (error) {
    throw new Error(`信号正则无效：${error.message}`);
  }

  return source;
}

async function loadConfig() {
  const { polarionSignalRegex = DEFAULT_SIGNAL_REGEX } = await chrome.storage.sync.get({
    polarionSignalRegex: DEFAULT_SIGNAL_REGEX
  });

  signalRegexInput.value = normalizeSignalRegexSource(polarionSignalRegex);
}

async function saveConfig(value) {
  const source = validateSignalRegex(value);
  await chrome.storage.sync.set({ polarionSignalRegex: source });
  signalRegexInput.value = source;
  setStatus("已保存，Polarion 页面上的工步助手会自动刷新。");
}

saveButton.addEventListener("click", () => {
  saveConfig(signalRegexInput.value).catch((error) => {
    setStatus(error.message || "保存失败，请稍后重试。", true);
  });
});

resetButton.addEventListener("click", () => {
  saveConfig(DEFAULT_SIGNAL_REGEX).catch((error) => {
    setStatus(error.message || "恢复失败，请稍后重试。", true);
  });
});

loadConfig().catch(() => {
  setStatus("无法读取已保存的配置。", true);
});
