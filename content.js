const HIGHLIGHT_CLASS = "text-highlight-extension-mark";
const HIGHLIGHT_STYLE_ID = "text-highlight-extension-style";
const BLOCKED_TAGS = new Set([
  "INPUT",
  "NOSCRIPT",
  "OPTION",
  "SCRIPT",
  "STYLE",
  "TEXTAREA"
]);
const REGEX_FLAGS_PATTERN = /^[dgimsuvy]*$/;
const REAPPLY_DELAY = 200;
const DEFAULT_HIGHLIGHT_STYLE = {
  backgroundColor: "#ffe066",
  textColor: "#1f2937",
  borderRadius: 2
};
let currentConfig = {
  terms: [],
  highlightStyle: DEFAULT_HIGHLIGHT_STYLE,
  enabled: false
};
let mutationObserver = null;
let reapplyTimer = 0;

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

function ensureHighlightStyle(highlightStyle) {
  let style = document.getElementById(HIGHLIGHT_STYLE_ID);

  if (!style) {
    style = document.createElement("style");
    style.id = HIGHLIGHT_STYLE_ID;
    document.documentElement.append(style);
  }

  const normalizedStyle = normalizeHighlightStyle(highlightStyle);
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      background: ${normalizedStyle.backgroundColor};
      color: ${normalizedStyle.textColor};
      border-radius: ${normalizedStyle.borderRadius}px;
      padding: 0 1px;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.12);
    }
  `;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeTerms(terms) {
  return [...new Set(
    (Array.isArray(terms) ? terms : [])
      .map((term) => String(term).trim())
      .filter(Boolean)
  )];
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

function buildPatterns(terms) {
  return terms.map((term, index) => {
    const regexLiteral = parseRegexLiteral(term);

    if (!regexLiteral) {
      return new RegExp(escapeRegExp(term), "gi");
    }

    try {
      return new RegExp(regexLiteral.pattern, normalizeFlags(regexLiteral.flags));
    } catch (error) {
      throw new Error(`第 ${index + 1} 行正则无效：${error.message}`);
    }
  });
}

function clearHighlights() {
  const marks = document.querySelectorAll(`span.${HIGHLIGHT_CLASS}`);
  const parents = new Set();

  for (const mark of marks) {
    const parent = mark.parentNode;

    if (!parent) {
      continue;
    }

    parents.add(parent);
    mark.replaceWith(document.createTextNode(mark.textContent || ""));
  }

  for (const parent of parents) {
    parent.normalize();
  }
}

function normalizeConfig(config) {
  const source = config && typeof config === "object" ? config : {};

  return {
    terms: normalizeTerms(source.terms),
    highlightStyle: normalizeHighlightStyle(source.highlightStyle),
    enabled: Boolean(source.enabled)
  };
}

function stopObserving() {
  window.clearTimeout(reapplyTimer);

  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }
}

function applyCurrentConfig() {
  stopObserving();

  if (!currentConfig.enabled) {
    clearHighlights();
    return { count: 0 };
  }

  const result = applyHighlights(currentConfig.terms, currentConfig.highlightStyle);
  startObserving();
  return result;
}

function scheduleReapply() {
  if (!currentConfig.enabled) {
    return;
  }

  window.clearTimeout(reapplyTimer);
  reapplyTimer = window.setTimeout(() => {
    applyCurrentConfig();
  }, REAPPLY_DELAY);
}

function startObserving() {
  if (!currentConfig.enabled || mutationObserver || !document.documentElement) {
    return;
  }

  mutationObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.target instanceof Element && mutation.target.closest(`.${HIGHLIGHT_CLASS}`)) {
        continue;
      }

      if (mutation.type === "characterData") {
        scheduleReapply();
        return;
      }

      if (mutation.addedNodes.length || mutation.removedNodes.length) {
        scheduleReapply();
        return;
      }
    }
  });

  mutationObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

function collectTextNodes() {
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

        if (parent.closest(`.${HIGHLIGHT_CLASS}`)) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const nodes = [];
  let currentNode = walker.nextNode();

  while (currentNode) {
    nodes.push(currentNode);
    currentNode = walker.nextNode();
  }

  return nodes;
}

function collectMatches(text, patterns) {
  const matches = [];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;

    let match = pattern.exec(text);

    while (match) {
      const value = match[0];

      if (!value) {
        pattern.lastIndex += 1;
        match = pattern.exec(text);
        continue;
      }

      matches.push({
        start: match.index,
        end: match.index + value.length,
        text: value
      });

      match = pattern.exec(text);
    }
  }

  matches.sort((left, right) => {
    const startDiff = left.start - right.start;

    if (startDiff !== 0) {
      return startDiff;
    }

    return (right.end - right.start) - (left.end - left.start);
  });

  const filteredMatches = [];
  let lastEnd = -1;

  for (const match of matches) {
    if (match.start < lastEnd) {
      continue;
    }

    filteredMatches.push(match);
    lastEnd = match.end;
  }

  return filteredMatches;
}

function highlightTextNode(node, patterns) {
  const text = node.nodeValue || "";
  const matches = collectMatches(text, patterns);

  if (!matches.length) {
    return 0;
  }

  const fragment = document.createDocumentFragment();
  let lastIndex = 0;

  for (const match of matches) {
    const matchText = match.text;
    const matchIndex = match.start;

    if (matchIndex > lastIndex) {
      fragment.append(text.slice(lastIndex, matchIndex));
    }

    const mark = document.createElement("span");
    mark.className = HIGHLIGHT_CLASS;
    mark.textContent = matchText;
    fragment.append(mark);

    lastIndex = matchIndex + matchText.length;
  }

  if (lastIndex < text.length) {
    fragment.append(text.slice(lastIndex));
  }

  node.replaceWith(fragment);
  return matches.length;
}

function applyHighlights(terms, highlightStyle) {
  const normalizedTerms = normalizeTerms(terms);
  clearHighlights();

  if (!normalizedTerms.length) {
    return { count: 0 };
  }

  ensureHighlightStyle(highlightStyle);
  let patterns;

  try {
    patterns = buildPatterns(normalizedTerms);
  } catch (error) {
    return {
      count: 0,
      error: error.message
    };
  }

  let count = 0;

  for (const node of collectTextNodes()) {
    count += highlightTextNode(node, patterns);
  }

  return { count };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "apply-highlights") {
    currentConfig = normalizeConfig({
      terms: message.terms,
      highlightStyle: message.highlightStyle,
      enabled: true
    });
    sendResponse(applyCurrentConfig());
    return true;
  }

  if (message?.type === "clear-highlights") {
    currentConfig = normalizeConfig({
      terms: [],
      highlightStyle: currentConfig.highlightStyle,
      enabled: false
    });
    applyCurrentConfig();
    sendResponse({ count: 0 });
    return true;
  }

  return false;
});

chrome.storage.sync
  .get({
    terms: [],
    highlightStyle: DEFAULT_HIGHLIGHT_STYLE,
    enabled: false
  })
  .then(({ terms, highlightStyle, enabled }) => {
    currentConfig = normalizeConfig({ terms, highlightStyle, enabled });
    applyCurrentConfig();
  })
  .catch(() => {});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") {
    return;
  }

  currentConfig = normalizeConfig({
    terms: changes.terms ? changes.terms.newValue : currentConfig.terms,
    highlightStyle: changes.highlightStyle ? changes.highlightStyle.newValue : currentConfig.highlightStyle,
    enabled: changes.enabled ? changes.enabled.newValue : currentConfig.enabled
  });

  applyCurrentConfig();
});
