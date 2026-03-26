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

function ensureHighlightStyle() {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      background: #ffe066;
      color: inherit;
      border-radius: 2px;
      padding: 0 1px;
      box-shadow: 0 0 0 1px rgba(217, 119, 6, 0.28);
    }
  `;

  document.documentElement.append(style);
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

function applyHighlights(terms) {
  const normalizedTerms = normalizeTerms(terms);
  clearHighlights();

  if (!normalizedTerms.length) {
    return { count: 0 };
  }

  ensureHighlightStyle();
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
    sendResponse(applyHighlights(message.terms));
    return true;
  }

  if (message?.type === "clear-highlights") {
    clearHighlights();
    sendResponse({ count: 0 });
    return true;
  }

  return false;
});

chrome.storage.sync
  .get({ terms: [] })
  .then(({ terms }) => {
    applyHighlights(terms);
  })
  .catch(() => {});
