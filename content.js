const POLARION_PANEL_ID = "polarion-step-assistant-panel";
const POLARION_PANEL_STYLE_ID = "polarion-step-assistant-style";
const BLOCKED_TAGS = new Set([
  "INPUT",
  "NOSCRIPT",
  "OPTION",
  "SCRIPT",
  "STYLE",
  "TEXTAREA"
]);
const POLARION_REFRESH_DELAY = 260;
const POLARION_STEP_REGEX = /^Step\s*:\s*(\d+)\s*$/i;
const POLARION_STEP_FALLBACK_REGEX = /^Step\s*:\s*(\d+)/i;
const POLARION_DESCRIPTION_REGEX = /^Step Description\s*:\s*(.*)$/i;
const POLARION_STOP_REGEX = /^(Expected Result|Actual Result|Step Verdict|Attachments?)\s*:/i;
const REGEX_FLAGS_PATTERN = /^[dgimsuvy]*$/;
const DEFAULT_ASSISTANT_ENABLED = true;
const DEFAULT_PROFILE_ID = "lamp-control";
const DEFAULT_PROFILE_NAME = "LampControl";
const FEATURE_LAMP_SIGNAL_DIFF = "lamp-signal-diff";
const FEATURE_RESERVED = "reserved";
const DEFAULT_SIGNAL_REGEX = "([A-Za-z_][A-Za-z0-9_]*(?:\\s*\\/\\s*[A-Za-z_][A-Za-z0-9_]*)*)\\s*=+\\s*((?:0x[0-9A-Fa-f]+|\\d+)(?:\\s*\\/\\s*(?:0x[0-9A-Fa-f]+|\\d+))*)";

let panelState = {
  assistantEnabled: DEFAULT_ASSISTANT_ENABLED,
  profiles: createDefaultProfiles(),
  activeProfileId: DEFAULT_PROFILE_ID,
  activeProfileName: DEFAULT_PROFILE_NAME,
  activeProfileFeature: FEATURE_LAMP_SIGNAL_DIFF,
  signalRegex: DEFAULT_SIGNAL_REGEX,
  steps: [],
  activeIndex: 0,
  error: ""
};
let panelRefs = null;
let panelObserver = null;
let refreshTimer = 0;

function isPolarionPage() {
  return /\/polarion\b/i.test(window.location.pathname) || /\/polarion\//i.test(window.location.href);
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

function normalizeAssistantEnabled(value) {
  return value !== false;
}

function createDefaultProfile() {
  return {
    id: DEFAULT_PROFILE_ID,
    name: DEFAULT_PROFILE_NAME,
    feature: FEATURE_LAMP_SIGNAL_DIFF,
    signalRegex: DEFAULT_SIGNAL_REGEX
  };
}

function createDefaultProfiles() {
  return [createDefaultProfile()];
}

function normalizeProfileName(value, index) {
  const normalizedValue = String(value ?? "").trim();
  return normalizedValue || `配置${index + 1}`;
}

function inferProfileFeature(profile) {
  const id = String(profile?.id ?? "").trim().toLowerCase();
  const name = String(profile?.name ?? "").trim().toLowerCase();

  if (id === DEFAULT_PROFILE_ID || name === DEFAULT_PROFILE_NAME.toLowerCase()) {
    return FEATURE_LAMP_SIGNAL_DIFF;
  }

  return FEATURE_RESERVED;
}

function normalizeProfileFeature(value, profile) {
  if (value === FEATURE_LAMP_SIGNAL_DIFF || value === FEATURE_RESERVED) {
    return value;
  }

  return inferProfileFeature(profile);
}

function normalizeProfiles(value) {
  if (!Array.isArray(value) || !value.length) {
    return createDefaultProfiles();
  }

  const profiles = [];
  const usedIds = new Set();

  for (const [index, profile] of value.entries()) {
    const baseId = String(profile?.id ?? "").trim() || `profile-${index + 1}`;
    let id = baseId;
    let suffix = 2;

    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }

    usedIds.add(id);
    profiles.push({
      id,
      name: normalizeProfileName(profile?.name, index),
      feature: normalizeProfileFeature(profile?.feature, profile),
      signalRegex: normalizeSignalRegexSource(profile?.signalRegex)
    });
  }

  return profiles.length ? profiles : createDefaultProfiles();
}

function resolveActiveProfile(profiles, activeProfileId) {
  const normalizedId = String(activeProfileId ?? "").trim();
  return profiles.find((profile) => profile.id === normalizedId) || profiles[0];
}

function syncActiveProfileState() {
  const activeProfile = resolveActiveProfile(panelState.profiles, panelState.activeProfileId);
  panelState.activeProfileId = activeProfile.id;
  panelState.activeProfileName = activeProfile.name;
  panelState.activeProfileFeature = activeProfile.feature;
  panelState.signalRegex = activeProfile.signalRegex;
}

function isLampSignalProfile() {
  return panelState.activeProfileFeature === FEATURE_LAMP_SIGNAL_DIFF;
}

function compileSignalRegex(value) {
  const source = normalizeSignalRegexSource(value);
  const regexLiteral = parseRegexLiteral(source);
  const pattern = regexLiteral ? regexLiteral.pattern : source;
  const flags = normalizeFlags(regexLiteral ? regexLiteral.flags : "");

  try {
    return {
      source,
      regex: new RegExp(pattern, flags),
      error: ""
    };
  } catch (error) {
    return {
      source,
      regex: null,
      error: `信号正则无效：${error.message}`
    };
  }
}

function ensurePanelStyle() {
  let style = document.getElementById(POLARION_PANEL_STYLE_ID);

  if (!style) {
    style = document.createElement("style");
    style.id = POLARION_PANEL_STYLE_ID;
    document.documentElement.append(style);
  }

  style.textContent = `
    #${POLARION_PANEL_ID} {
      position: fixed;
      top: 84px;
      right: 18px;
      z-index: 2147483646;
      width: 360px;
      max-height: calc(100vh - 110px);
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 14px;
      overflow: hidden;
      border: 1px solid #d8d1c2;
      border-radius: 16px;
      background: rgba(255, 250, 241, 0.96);
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.18);
      color: #1f2937;
      font: 13px/1.45 "Segoe UI", sans-serif;
      backdrop-filter: blur(8px);
    }

    #${POLARION_PANEL_ID} *,
    #${POLARION_PANEL_ID} *::before,
    #${POLARION_PANEL_ID} *::after {
      box-sizing: border-box;
    }

    #${POLARION_PANEL_ID} button,
    #${POLARION_PANEL_ID} select {
      font: inherit;
    }

    .psa-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }

    .psa-title {
      margin: 0;
      font-size: 16px;
      font-weight: 700;
      line-height: 1.2;
    }

    .psa-subtitle {
      margin-top: 4px;
      color: #6b7280;
      font-size: 12px;
    }

    .psa-refresh,
    .psa-nav {
      border: 0;
      border-radius: 10px;
      background: #c2410c;
      color: #fff;
      cursor: pointer;
    }

    .psa-refresh {
      padding: 8px 10px;
      white-space: nowrap;
    }

    .psa-refresh:disabled,
    .psa-nav:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .psa-select:focus {
      outline: none;
      border-color: #c2410c;
      box-shadow: 0 0 0 3px rgba(194, 65, 12, 0.14);
    }

    .psa-controls {
      display: grid;
      grid-template-columns: 72px 1fr 72px;
      gap: 8px;
      align-items: center;
    }

    .psa-nav {
      padding: 10px 8px;
    }

    .psa-select {
      width: 100%;
      min-width: 0;
      padding: 10px 12px;
      border: 1px solid #d6d3d1;
      border-radius: 12px;
      background: #fffdfa;
      color: inherit;
    }

    .psa-status {
      min-height: 18px;
      color: #4b5563;
      font-size: 12px;
    }

    .psa-status.is-error {
      color: #b91c1c;
    }

    .psa-summary {
      padding: 10px 12px;
      border-radius: 12px;
      background: #f5efe3;
      color: #374151;
      font-size: 12px;
    }

    .psa-summary strong {
      display: block;
      margin-bottom: 6px;
      color: #111827;
      font-size: 13px;
    }

    .psa-signal-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-height: 64px;
      max-height: 38vh;
      overflow: auto;
      padding-right: 2px;
    }

    .psa-empty {
      padding: 12px;
      border-radius: 12px;
      background: #f9f5ee;
      color: #6b7280;
      text-align: center;
    }

    .psa-signal {
      padding: 10px 12px;
      border: 1px solid #eadfcd;
      border-radius: 12px;
      background: #fffdfa;
    }

    .psa-signal-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
    }

    .psa-signal-name {
      font-weight: 700;
      color: #111827;
      word-break: break-all;
    }

    .psa-signal-value {
      color: #047857;
      font-weight: 700;
      white-space: nowrap;
    }

    .psa-signal-meta {
      margin-top: 4px;
      color: #6b7280;
      font-size: 12px;
    }
  `;
}

function createPanelElement(tagName, className, textContent) {
  const element = document.createElement(tagName);

  if (className) {
    element.className = className;
  }

  if (textContent !== undefined) {
    element.textContent = textContent;
  }

  return element;
}

function ensurePanel() {
  if (!isPolarionPage()) {
    return null;
  }

  if (panelRefs?.root?.isConnected) {
    return panelRefs;
  }

  ensurePanelStyle();

  const root = document.createElement("aside");
  root.id = POLARION_PANEL_ID;
  root.innerHTML = `
    <div class="psa-header">
      <div>
        <div class="psa-title">Polarion 工步助手</div>
        <div class="psa-subtitle">工步切换与变化信号</div>
      </div>
      <button class="psa-refresh" type="button">刷新</button>
    </div>
    <div class="psa-controls">
      <button class="psa-nav" type="button" data-direction="-1">上一条</button>
      <select class="psa-select" aria-label="工步选择"></select>
      <button class="psa-nav" type="button" data-direction="1">下一条</button>
    </div>
    <div class="psa-status"></div>
    <div class="psa-summary"></div>
    <div class="psa-signal-list"></div>
  `;

  document.body.append(root);

  const refreshButton = root.querySelector(".psa-refresh");
  const prevButton = root.querySelector('[data-direction="-1"]');
  const nextButton = root.querySelector('[data-direction="1"]');
  const stepSelect = root.querySelector(".psa-select");
  const status = root.querySelector(".psa-status");
  const summary = root.querySelector(".psa-summary");
  const signalList = root.querySelector(".psa-signal-list");
  const subtitle = root.querySelector(".psa-subtitle");

  refreshButton.addEventListener("click", () => {
    scheduleRefresh(0);
  });

  prevButton.addEventListener("click", () => {
    selectStep(panelState.activeIndex - 1, true);
  });

  nextButton.addEventListener("click", () => {
    selectStep(panelState.activeIndex + 1, true);
  });

  stepSelect.addEventListener("change", () => {
    selectStep(Number.parseInt(stepSelect.value, 10), true);
  });

  panelRefs = {
    root,
    refreshButton,
    prevButton,
    nextButton,
    stepSelect,
    subtitle,
    status,
    summary,
    signalList
  };

  return panelRefs;
}

function renderPanel() {
  const refs = ensurePanel();

  if (!refs) {
    return;
  }

  refs.subtitle.textContent = isLampSignalProfile()
    ? `${panelState.activeProfileName} · 工步切换与变化信号`
    : `${panelState.activeProfileName} · 测试用例配置入口`;

  if (!isLampSignalProfile()) {
    refs.stepSelect.replaceChildren();
    refs.stepSelect.disabled = true;
    refs.prevButton.disabled = true;
    refs.nextButton.disabled = true;
    refs.status.classList.remove("is-error");
    refs.status.textContent = "当前配置还没有绑定页面解析逻辑。";
    refs.summary.textContent = `${panelState.activeProfileName} 目前只是独立配置入口位，后面可以扩展成这个测试用例自己的功能。`;
    refs.signalList.replaceChildren();
    refs.signalList.append(
      createPanelElement("div", "psa-empty", "这个配置不会使用 LampControl 的正则提取逻辑。")
    );
    return;
  }

  refs.stepSelect.replaceChildren();

  for (const [index, step] of panelState.steps.entries()) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = buildStepOptionLabel(step);
    refs.stepSelect.append(option);
  }

  const activeStep = panelState.steps[panelState.activeIndex] || null;
  refs.stepSelect.disabled = !panelState.steps.length;
  refs.prevButton.disabled = !panelState.steps.length || panelState.activeIndex <= 0;
  refs.nextButton.disabled = !panelState.steps.length || panelState.activeIndex >= panelState.steps.length - 1;

  if (activeStep) {
    refs.stepSelect.value = String(panelState.activeIndex);
  }

  refs.status.classList.toggle("is-error", Boolean(panelState.error));

  if (panelState.error) {
    refs.status.textContent = panelState.error;
  } else if (!panelState.steps.length) {
    refs.status.textContent = "正在等待当前页面工步加载。";
  } else {
    refs.status.textContent = `已识别 ${panelState.steps.length} 条工步，显示的是相对前序工步发生变化的信号。`;
  }

  refs.summary.replaceChildren();

  if (activeStep) {
    const title = createPanelElement("strong", "", `当前工步: Step ${activeStep.number}`);
    const meta = createPanelElement(
      "div",
      "",
      `提取 ${activeStep.signals.length} 个信号，变化 ${activeStep.changedSignals.length} 个`
    );
    const description = createPanelElement(
      "div",
      "",
      activeStep.descriptionText || "未提取到 Step Description 内容。"
    );
    refs.summary.append(title, meta, description);
  } else {
    refs.summary.textContent = "当前页面还没有识别到可切换的工步。";
  }

  refs.signalList.replaceChildren();

  if (!activeStep) {
    refs.signalList.append(
      createPanelElement("div", "psa-empty", "识别到工步后，这里会显示当前工步发生变化的信号。")
    );
    return;
  }

  if (!activeStep.changedSignals.length) {
    refs.signalList.append(
      createPanelElement("div", "psa-empty", "当前工步没有相对前序步骤发生变化的信号。")
    );
    return;
  }

  for (const signal of activeStep.changedSignals) {
    const card = createPanelElement("div", "psa-signal");
    const head = createPanelElement("div", "psa-signal-head");
    const name = createPanelElement("div", "psa-signal-name", signal.name);
    const value = createPanelElement("div", "psa-signal-value", signal.value);
    const meta = createPanelElement(
      "div",
      "psa-signal-meta",
      signal.previousValue === undefined ? "初始值" : `前值 ${signal.previousValue}`
    );

    head.append(name, value);
    card.append(head, meta);
    refs.signalList.append(card);
  }
}

function buildStepOptionLabel(step) {
  const summary = step.descriptionText.replace(/\s+/g, " ").slice(0, 24);
  return summary ? `Step ${step.number} · ${summary}` : `Step ${step.number}`;
}

function scrollToStep(step) {
  if (!step?.anchorElement) {
    return;
  }

  step.anchorElement.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
}

function selectStep(index, shouldScroll = false) {
  if (!panelState.steps.length) {
    return;
  }

  const safeIndex = Math.min(Math.max(index, 0), panelState.steps.length - 1);
  panelState.activeIndex = safeIndex;
  renderPanel();

  if (shouldScroll) {
    scrollToStep(panelState.steps[safeIndex]);
  }
}

function getElementFromNode(node) {
  if (node instanceof Element) {
    return node;
  }

  if (node instanceof Text) {
    return node.parentElement;
  }

  return null;
}

function isPanelNode(node) {
  const element = getElementFromNode(node);

  if (!element) {
    return false;
  }

  return Boolean(
    element.id === POLARION_PANEL_STYLE_ID
    || element.closest(`#${POLARION_PANEL_ID}`)
  );
}

function hasNonPanelNodes(nodeList) {
  for (const node of nodeList) {
    if (!isPanelNode(node)) {
      return true;
    }
  }

  return false;
}

function mutationNeedsRefresh(mutation) {
  if (mutation.type === "characterData") {
    return !isPanelNode(mutation.target);
  }

  return hasNonPanelNodes(mutation.addedNodes) || hasNonPanelNodes(mutation.removedNodes);
}

function scheduleRefresh(delay = POLARION_REFRESH_DELAY) {
  if (!isPolarionPage()) {
    return;
  }

  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    refreshPanel();
  }, delay);
}

function removePanel() {
  window.clearTimeout(refreshTimer);

  if (panelObserver) {
    panelObserver.disconnect();
    panelObserver = null;
  }

  if (panelRefs?.root?.isConnected) {
    panelRefs.root.remove();
  }

  panelRefs = null;
}

function startObserver() {
  if (panelObserver || !document.documentElement) {
    return;
  }

  panelObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (!mutationNeedsRefresh(mutation)) {
        continue;
      }

      scheduleRefresh();
      return;
    }
  });

  panelObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

function collectTextEntries() {
  const root = document.body || document.documentElement;

  if (!root) {
    return [];
  }

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;

        if (!parent || !node.nodeValue || !node.nodeValue.trim()) {
          return NodeFilter.FILTER_REJECT;
        }

        if (BLOCKED_TAGS.has(parent.tagName) || parent.isContentEditable) {
          return NodeFilter.FILTER_REJECT;
        }

        if (parent.closest(`#${POLARION_PANEL_ID}`)) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const entries = [];
  let currentNode = walker.nextNode();

  while (currentNode) {
    entries.push({
      node: currentNode,
      text: currentNode.nodeValue.trim()
    });
    currentNode = walker.nextNode();
  }

  return entries;
}

function extractStepDescription(entries) {
  let collecting = false;
  const parts = [];

  for (const entry of entries) {
    const descriptionMatch = entry.text.match(POLARION_DESCRIPTION_REGEX);

    if (!collecting) {
      if (!descriptionMatch) {
        continue;
      }

      collecting = true;

      if (descriptionMatch[1]) {
        parts.push(descriptionMatch[1]);
      }

      continue;
    }

    if (POLARION_STOP_REGEX.test(entry.text)) {
      break;
    }

    parts.push(entry.text);
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function readStepEntry(entries, index) {
  const entry = entries[index];

  if (!entry) {
    return null;
  }

  const inlineMatch = entry.text.match(POLARION_STEP_REGEX) || entry.text.match(POLARION_STEP_FALLBACK_REGEX);

  if (inlineMatch) {
    return {
      startIndex: index,
      anchorEntry: entry,
      number: Number.parseInt(inlineMatch[1], 10)
    };
  }

  if (/^Step\s*:\s*$/i.test(entry.text)) {
    const nextEntry = entries[index + 1];

    if (nextEntry && /^\d+$/.test(nextEntry.text)) {
      return {
        startIndex: index,
        anchorEntry: nextEntry,
        number: Number.parseInt(nextEntry.text, 10)
      };
    }
  }

  return null;
}

function collectSteps(entries = collectTextEntries()) {
  const stepEntries = [];

  for (const [index] of entries.entries()) {
    const stepEntry = readStepEntry(entries, index);

    if (stepEntry) {
      stepEntries.push(stepEntry);
    }
  }

  const steps = [];

  for (const [index, stepEntry] of stepEntries.entries()) {
    const stepEndIndex = stepEntries[index + 1]?.startIndex ?? entries.length;
    const slice = entries.slice(stepEntry.startIndex, stepEndIndex);
    const descriptionText = extractStepDescription(slice);

    if (!descriptionText && slice.length < 3) {
      continue;
    }

    steps.push({
      number: stepEntry.number,
      descriptionText,
      anchorElement: stepEntry.anchorEntry.node.parentElement
    });
  }

  return steps;
}

function normalizeSignalNames(rawName) {
  return String(rawName)
    .split(/\s*\/\s*/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function resolveSignalMatch(match) {
  let rawName = "";
  let rawValue = "";

  if (match.groups?.name && match.groups?.value) {
    rawName = match.groups.name;
    rawValue = match.groups.value;
  } else if (match.length >= 3) {
    rawName = match[1];
    rawValue = match[2];
  } else {
    const fullMatch = String(match[0] || "");
    const separatorIndex = fullMatch.indexOf("=");

    if (separatorIndex < 0) {
      return [];
    }

    rawName = fullMatch.slice(0, separatorIndex);
    rawValue = fullMatch.slice(separatorIndex + 1);
  }

  const value = String(rawValue)
    .trim()
    .replace(/[，。；;,)\]]+$/g, "");

  return normalizeSignalNames(rawName).map((name) => ({
    name,
    value
  }));
}

function extractSignalsFromText(text, regex) {
  if (!regex) {
    return [];
  }

  const signalsByName = new Map();
  const signalOrder = [];

  regex.lastIndex = 0;
  let match = regex.exec(text);

  while (match) {
    const fullMatch = match[0];

    if (!fullMatch) {
      regex.lastIndex += 1;
      match = regex.exec(text);
      continue;
    }

    for (const signal of resolveSignalMatch(match)) {
      if (!signalsByName.has(signal.name)) {
        signalOrder.push(signal.name);
      }

      signalsByName.set(signal.name, signal);
    }

    match = regex.exec(text);
  }

  return signalOrder.map((name) => signalsByName.get(name));
}

function buildStepData(signalRegexSource, entries) {
  const compiledRegex = compileSignalRegex(signalRegexSource);
  const rawSteps = collectSteps(entries);
  const previousSignals = new Map();
  const steps = rawSteps.map((step) => {
    const signals = extractSignalsFromText(step.descriptionText, compiledRegex.regex);
    const changedSignals = [];

    for (const signal of signals) {
      const previousValue = previousSignals.get(signal.name);

      if (previousValue !== signal.value) {
        changedSignals.push({
          name: signal.name,
          value: signal.value,
          previousValue
        });
      }

      previousSignals.set(signal.name, signal.value);
    }

    return {
      ...step,
      signals,
      changedSignals
    };
  });

  return {
    signalRegex: compiledRegex.source,
    steps,
    error: compiledRegex.error
  };
}

function refreshPanel() {
  if (!isPolarionPage()) {
    removePanel();
    return;
  }

  if (!panelState.assistantEnabled) {
    removePanel();
    return;
  }

  if (!isLampSignalProfile()) {
    panelState.steps = [];
    panelState.activeIndex = 0;
    panelState.error = "";
    renderPanel();
    return;
  }

  startObserver();
  const entries = collectTextEntries();

  const currentStep = panelState.steps[panelState.activeIndex];
  const preferredStepNumber = currentStep?.number;
  const result = buildStepData(panelState.signalRegex, entries);

  panelState.signalRegex = result.signalRegex;
  panelState.steps = result.steps;
  panelState.error = result.error;

  if (!result.steps.length) {
    panelState.activeIndex = 0;
  } else if (preferredStepNumber !== undefined) {
    const matchedIndex = result.steps.findIndex((step) => step.number === preferredStepNumber);
    panelState.activeIndex = matchedIndex >= 0
      ? matchedIndex
      : Math.min(panelState.activeIndex, result.steps.length - 1);
  } else {
    panelState.activeIndex = Math.min(panelState.activeIndex, result.steps.length - 1);
  }

  renderPanel();
}

function initialize() {
  if (!isPolarionPage()) {
    return;
  }

  chrome.storage.sync
    .get({
      polarionAssistantEnabled: DEFAULT_ASSISTANT_ENABLED,
      polarionProfiles: createDefaultProfiles(),
      polarionActiveProfileId: DEFAULT_PROFILE_ID
    })
    .then(({ polarionAssistantEnabled, polarionProfiles, polarionActiveProfileId }) => {
      panelState.assistantEnabled = normalizeAssistantEnabled(polarionAssistantEnabled);
      panelState.profiles = normalizeProfiles(polarionProfiles);
      panelState.activeProfileId = polarionActiveProfileId;
      syncActiveProfileState();
      refreshPanel();
    })
    .catch(() => {
      refreshPanel();
    });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") {
    return;
  }

  let shouldRefresh = false;

  if (changes.polarionAssistantEnabled) {
    panelState.assistantEnabled = normalizeAssistantEnabled(changes.polarionAssistantEnabled.newValue);

    if (!panelState.assistantEnabled) {
      removePanel();
      return;
    }

    shouldRefresh = true;
  }

  if (changes.polarionProfiles) {
    panelState.profiles = normalizeProfiles(changes.polarionProfiles.newValue);
    shouldRefresh = true;
  }

  if (changes.polarionActiveProfileId) {
    panelState.activeProfileId = String(changes.polarionActiveProfileId.newValue ?? "").trim();
    shouldRefresh = true;
  }

  if (changes.polarionProfiles || changes.polarionActiveProfileId) {
    syncActiveProfileState();
  }

  if (shouldRefresh) {
    scheduleRefresh(0);
  }
});

window.addEventListener("hashchange", () => {
  if (!isPolarionPage()) {
    removePanel();
    return;
  }

  scheduleRefresh(80);
});

initialize();
