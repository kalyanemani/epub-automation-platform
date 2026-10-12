const { JSDOM } = require("jsdom");

const BLOCK_TAGS = new Set([
  "p",
  "li",
  "blockquote",
  "pre",
  "code",
  "td",
  "th",
  "caption",
  "figcaption",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/\t+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9_-]{1,}/g) || [];
}

function textToParagraphs(text) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];

  return normalized
    .split(/\n\s*\n/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);
}

function splitLongText(text, maxChars = 900) {
  const value = normalizeWhitespace(text);
  if (!value) return [];
  if (value.length <= maxChars) return [value];

  const pieces = [];
  let buffer = "";

  value.split(/(?<=[.?!])\s+/).forEach((sentence) => {
    if (!sentence) {
      return;
    }

    const candidate = buffer ? `${buffer} ${sentence}` : sentence;
    if (candidate.length <= maxChars) {
      buffer = candidate;
      return;
    }

    if (buffer) {
      pieces.push(buffer);
    }

    if (sentence.length <= maxChars) {
      buffer = sentence;
      return;
    }

    for (let index = 0; index < sentence.length; index += maxChars) {
      pieces.push(sentence.slice(index, index + maxChars).trim());
    }
    buffer = "";
  });

  if (buffer) {
    pieces.push(buffer);
  }

  return pieces.filter(Boolean);
}

function tailWithBudget(text, maxChars = 160) {
  const normalized = normalizeWhitespace(text);
  if (!normalized || normalized.length <= maxChars) {
    return normalized;
  }

  return normalized.slice(normalized.length - maxChars).trim();
}

function sectionKeyForMetadata(metadata = {}) {
  return Array.isArray(metadata.headingTrail)
    ? metadata.headingTrail.filter(Boolean).join(" > ")
    : "";
}

function attachSearchContext(chunks = [], options = {}) {
  const overlapChars = options.overlapChars || 160;

  return chunks.map((chunk, index) => {
    const previous = index > 0 ? chunks[index - 1] : null;
    const sectionKey = sectionKeyForMetadata(chunk.metadata);
    const previousSectionKey = previous
      ? sectionKeyForMetadata(previous.metadata)
      : "";
    const prefix =
      previous && sectionKey && sectionKey === previousSectionKey
        ? tailWithBudget(previous.text, overlapChars)
        : "";
    const headingContext = sectionKey;
    const searchText = normalizeWhitespace(
      [headingContext, prefix, chunk.text].filter(Boolean).join("\n")
    );

    return {
      ...chunk,
      metadata: {
        ...(chunk.metadata || {}),
        searchText,
        sectionKey,
        tokenCount: tokenize(chunk.text).length,
      },
    };
  });
}

function chunkPlainText(text, options = {}) {
  const maxChars = options.maxChars || 900;
  const paragraphs = textToParagraphs(text);
  if (!paragraphs.length) {
    return splitLongText(text, maxChars);
  }

  return paragraphs.flatMap((paragraph) => splitLongText(paragraph, maxChars));
}

function chunkHtml(html, options = {}) {
  return chunkPlainText(stripHtml(html), options);
}

function getHeadingLevel(tagName) {
  if (!/^h[1-6]$/i.test(String(tagName || ""))) {
    return null;
  }

  return parseInt(String(tagName).slice(1), 10);
}

function cleanClassList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8);
}

function buildElementPath(element) {
  const parts = [];
  let current = element;

  while (current && current.tagName) {
    const tagName = current.tagName.toLowerCase();
    const id = current.getAttribute("id");
    parts.unshift(id ? `${tagName}#${id}` : tagName);
    current = current.parentElement;

    if (parts.length >= 6) {
      break;
    }
  }

  return parts.join(" > ");
}

function flushStructuredBuffer(chunks, state, reason = "") {
  const text = normalizeWhitespace(state.buffer.join(" "));
  if (!text) {
    state.buffer = [];
    state.bufferMeta = null;
    return;
  }

  chunks.push({
    text,
    metadata: {
      type: state.bufferMeta?.type || "text",
      tagName: state.bufferMeta?.tagName || "p",
      headingTrail: Array.isArray(state.headingTrail) ? state.headingTrail.slice(0, 6) : [],
      classes: cleanClassList(state.bufferMeta?.classes),
      elementPath: state.bufferMeta?.elementPath || "",
      anchor: state.bufferMeta?.anchor || "",
      flushReason: reason || "buffer_limit",
    },
  });

  state.buffer = [];
  state.bufferMeta = null;
}

function buildStructuredHtmlChunks(html, options = {}) {
  const maxChars = options.maxChars || 900;
  const dom = new JSDOM(String(html || ""));
  const document = dom.window.document;
  const root = document.body || document.documentElement;
  const chunks = [];
  const headingTrail = [];
  const state = {
    buffer: [],
    bufferMeta: null,
    headingTrail,
  };

  const addBufferText = (element, text, type = "text") => {
    const normalized = normalizeWhitespace(text);
    if (!normalized) {
      return;
    }

    const tagName = element.tagName.toLowerCase();
    const meta = {
      type,
      tagName,
      classes: cleanClassList(element.classList ? Array.from(element.classList) : []),
      elementPath: buildElementPath(element),
      anchor: element.getAttribute("id") || "",
    };

    if (
      state.bufferMeta &&
      (state.bufferMeta.tagName !== meta.tagName || state.bufferMeta.anchor !== meta.anchor)
    ) {
      flushStructuredBuffer(chunks, state, "element_change");
    }

    if (!state.bufferMeta) {
      state.bufferMeta = meta;
    }

    const candidate = normalizeWhitespace([...state.buffer, normalized].join(" "));
    if (candidate.length > maxChars && state.buffer.length) {
      flushStructuredBuffer(chunks, state, "max_chars");
      state.bufferMeta = meta;
    }

    state.buffer.push(normalized);
  };

  const walk = (element) => {
    if (!element || !element.tagName) {
      return;
    }

    const tagName = element.tagName.toLowerCase();
    const headingLevel = getHeadingLevel(tagName);

    if (headingLevel) {
      flushStructuredBuffer(chunks, state, "heading_boundary");
      const headingText = normalizeWhitespace(element.textContent || "");
      headingTrail.length = headingLevel - 1;
      headingTrail[headingLevel - 1] = headingText;

      if (headingText) {
        chunks.push({
          text: headingText,
          metadata: {
            type: "heading",
            tagName,
            headingLevel,
            headingTrail: headingTrail.slice(0, 6),
            classes: cleanClassList(element.classList ? Array.from(element.classList) : []),
            elementPath: buildElementPath(element),
            anchor: element.getAttribute("id") || "",
          },
        });
      }
      return;
    }

    if (tagName === "img") {
      flushStructuredBuffer(chunks, state, "image_boundary");
      const alt = normalizeWhitespace(element.getAttribute("alt") || "");
      const src = normalizeWhitespace(element.getAttribute("src") || "");
      const imageText = normalizeWhitespace([alt, src].filter(Boolean).join(" | "));

      if (imageText) {
        chunks.push({
          text: imageText,
          metadata: {
            type: "image",
            tagName,
            headingTrail: headingTrail.slice(0, 6),
            classes: cleanClassList(element.classList ? Array.from(element.classList) : []),
            elementPath: buildElementPath(element),
            anchor: element.getAttribute("id") || "",
            src,
            alt,
          },
        });
      }
      return;
    }

    if (tagName === "table") {
      flushStructuredBuffer(chunks, state, "table_boundary");
      const caption = normalizeWhitespace(
        element.querySelector("caption")?.textContent || ""
      );
      const rows = Array.from(element.querySelectorAll("tr"))
        .map((row) =>
          normalizeWhitespace(
            Array.from(row.querySelectorAll("th,td"))
              .map((cell) => cell.textContent || "")
              .join(" | ")
          )
        )
        .filter(Boolean);
      const tableText = [caption, ...rows].filter(Boolean).join("\n");

      chunkPlainText(tableText, { maxChars }).forEach((text, index) => {
        chunks.push({
          text,
          metadata: {
            type: "table",
            tagName,
            headingTrail: headingTrail.slice(0, 6),
            classes: cleanClassList(element.classList ? Array.from(element.classList) : []),
            elementPath: buildElementPath(element),
            anchor: element.getAttribute("id") || "",
            tableIndex: index,
          },
        });
      });
      return;
    }

    if (BLOCK_TAGS.has(tagName)) {
      addBufferText(
        element,
        tagName === "pre" || tagName === "code"
          ? element.textContent || ""
          : element.textContent || "",
        tagName === "blockquote"
          ? "blockquote"
          : tagName === "pre" || tagName === "code"
            ? "code"
            : tagName === "li"
              ? "list-item"
              : "text"
      );
      return;
    }

    Array.from(element.children || []).forEach((child) => walk(child));
  };

  Array.from(root.children || []).forEach((child) => walk(child));
  flushStructuredBuffer(chunks, state, "document_end");

  if (chunks.length) {
    return attachSearchContext(chunks, options);
  }

  return attachSearchContext(
    chunkHtml(html, options).map((text) => ({
      text,
      metadata: {
        type: "text",
        tagName: "body",
        headingTrail: [],
        classes: [],
        elementPath: "body",
        anchor: "",
      },
    })),
    options
  );
}

function buildStructuredTextChunks(text, options = {}) {
  return attachSearchContext(
    chunkPlainText(text, options).map((chunkText, index) => ({
      text: chunkText,
      metadata: {
        type: "text",
        tagName: "text",
        headingTrail: [],
        classes: [],
        elementPath: `text:${index + 1}`,
        anchor: "",
      },
    })),
    options
  );
}

function buildStructuredCssChunks(cssText, options = {}) {
  const maxChars = options.maxChars || 900;
  const normalized = String(cssText || "").replace(/\r/g, "\n");
  const chunks = [];
  const blockRegex = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  let blockIndex = 0;

  while ((match = blockRegex.exec(normalized)) !== null) {
    const selector = normalizeWhitespace(match[1] || "");
    const body = normalizeWhitespace(match[2] || "");
    if (!selector || !body) {
      continue;
    }

    const fullRule = `${selector} { ${body} }`;
    chunkPlainText(fullRule, { maxChars }).forEach((text, index) => {
      chunks.push({
        text,
        metadata: {
          type: "css-rule",
          tagName: "style",
          headingTrail: [selector].slice(0, 6),
          classes: [],
          elementPath: `css:${blockIndex + 1}:${index + 1}`,
          anchor: "",
          selector,
        },
      });
    });
    blockIndex += 1;
  }

  if (chunks.length) {
    return attachSearchContext(chunks, options);
  }

  return buildStructuredTextChunks(cssText, options).map((chunk) => ({
    ...chunk,
    metadata: {
      ...chunk.metadata,
      type: "css-text",
      tagName: "style",
    },
  }));
}

function buildStructuredJsChunks(jsText, options = {}) {
  const maxChars = options.maxChars || 900;
  const normalized = String(jsText || "").replace(/\r/g, "\n");
  const boundaries = normalized
    .split(/\n(?=(?:export\s+)?(?:async\s+)?function\s+|class\s+|const\s+\w+\s*=\s*(?:async\s*)?\(|let\s+\w+\s*=\s*(?:async\s*)?\(|var\s+\w+\s*=\s*(?:async\s*)?\()/)
    .map((part) => part.trim())
    .filter(Boolean);

  const chunks = [];
  (boundaries.length ? boundaries : [normalized]).forEach((section, sectionIndex) => {
    const header = normalizeWhitespace(section.split("\n")[0] || `script:${sectionIndex + 1}`);
    chunkPlainText(section, { maxChars }).forEach((text, index) => {
      chunks.push({
        text,
        metadata: {
          type: "script",
          tagName: "script",
          headingTrail: [header].slice(0, 6),
          classes: [],
          elementPath: `script:${sectionIndex + 1}:${index + 1}`,
          anchor: "",
          symbol: header,
        },
      });
    });
  });

  return attachSearchContext(chunks, options);
}

module.exports = {
  buildStructuredCssChunks,
  buildStructuredHtmlChunks,
  buildStructuredJsChunks,
  buildStructuredTextChunks,
  chunkHtml,
  chunkPlainText,
  normalizeWhitespace,
  stripHtml,
  textToParagraphs,
  tokenize,
};
