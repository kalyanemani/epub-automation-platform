const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const pdfParse = require("pdf-parse");

const PAGE_MARKER_START = "__PDF_PAGE__";
const PAGE_MARKER_END = "__END_PDF_PAGE__";
const OCR_SCRIPT_PATH = path.join(__dirname, "pdf-ocr.py");
const OCR_RUNTIME_CANDIDATES = [
  { command: "py", args: ["-3.12"] },
  { command: "python3.12", args: [] },
  { command: "python", args: [] },
];
const OCR_MAX_PAGES = parseInt(process.env.PDF_OCR_MAX_PAGES || "25", 10);
const OCR_SERVICE_TIMEOUT_MS = parseInt(
  process.env.PDF_OCR_SERVICE_TIMEOUT_MS || "300000",
  10
);
let OCR_RUNTIME_CACHE = null;

function readBooleanEnv(name, fallback = false) {
  const value = process.env[name];
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function uniqueNonEmpty(values = []) {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean))
  );
}

function getPdfOcrLanguages() {
  const configured = String(process.env.PDF_OCR_LANGS || "en")
    .replace(/,/g, " ")
    .split(/\s+/);
  const languages = uniqueNonEmpty(configured);
  return languages.length ? languages : ["en"];
}

function getPdfOcrServiceUrl() {
  const directUrl = normalizeUrl(process.env.PDF_OCR_SERVICE_URL);
  if (directUrl) {
    return directUrl;
  }

  const serviceBaseUrl = normalizeUrl(
    process.env.PYTHON_RAG_SERVICE_URL || process.env.PDF_OCR_SERVICE_BASE_URL || ""
  );
  return serviceBaseUrl ? `${serviceBaseUrl}/extract-pdf-ocr` : "";
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function getViewportSize(pageData) {
  try {
    const viewport = pageData.getViewport(1.0);
    return {
      width: Number(viewport?.width) || 0,
      height: Number(viewport?.height) || 0,
    };
  } catch (error) {
    return { width: 0, height: 0 };
  }
}

async function renderPdfPageItems(pageData) {
  const renderOptions = {
    normalizeWhitespace: false,
    disableCombineTextItems: false,
  };
  const viewport = getViewportSize(pageData);
  const textContent = await pageData.getTextContent(renderOptions);
  const items = (textContent?.items || []).map((item) => {
    const transform = Array.isArray(item?.transform) ? item.transform : [];
    return {
      str: String(item?.str || ""),
      x: Number(transform[4]) || 0,
      y: Number(transform[5]) || 0,
      width: Number(item?.width) || 0,
      height:
        Number(item?.height) ||
        Math.abs(Number(transform[0]) || 0) ||
        Math.abs(Number(transform[3]) || 0) ||
        10,
    };
  });

  const payload = Buffer.from(
    JSON.stringify({
      width: viewport.width,
      height: viewport.height,
      items,
    }),
    "utf8"
  ).toString("base64");

  return `${PAGE_MARKER_START}${payload}${PAGE_MARKER_END}`;
}

function parseEmbeddedPages(text) {
  const matches = String(text || "").match(
    new RegExp(`${PAGE_MARKER_START}(.*?)${PAGE_MARKER_END}`, "g")
  ) || [];

  return matches
    .map((match) =>
      match
        .replace(PAGE_MARKER_START, "")
        .replace(PAGE_MARKER_END, "")
        .trim()
    )
    .filter(Boolean)
    .map((encoded) => {
      try {
        return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean);
}

function joinLineItems(items = []) {
  const sortedItems = [...items].sort((left, right) => left.x - right.x);
  let content = "";
  let previousItem = null;

  sortedItems.forEach((item) => {
    const rawText = String(item?.str || "");
    if (!rawText.trim()) {
      return;
    }

    if (previousItem) {
      const previousRight = previousItem.x + previousItem.width;
      const gap = item.x - previousRight;
      const shouldInsertSpace =
        gap > Math.max(2, previousItem.height * 0.18) &&
        !content.endsWith(" ") &&
        !rawText.startsWith(" ");

      if (shouldInsertSpace) {
        content += " ";
      }
    }

    content += rawText;
    previousItem = item;
  });

  return content.replace(/\s+/g, " ").trim();
}

function groupItemsIntoLines(items = []) {
  const lines = [];

  items.forEach((item) => {
    if (!item || !String(item.str || "").trim()) {
      return;
    }

    const tolerance = Math.max(2, Number(item.height || 0) * 0.35);
    let line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance);

    if (!line) {
      line = { y: item.y, items: [] };
      lines.push(line);
    }

    line.items.push(item);
  });

  return lines
    .sort((left, right) => right.y - left.y)
    .map((line, index) => {
      const orderedItems = [...line.items].sort((left, right) => left.x - right.x);
      const lineText = joinLineItems(orderedItems);
      const x = Math.min(...orderedItems.map((item) => item.x));
      const maxWidth = Math.max(...orderedItems.map((item) => item.x + item.width));
      const height = Math.max(...orderedItems.map((item) => Number(item.height) || 0), 10);

      return {
        lineNumber: index + 1,
        text: lineText,
        x,
        y: line.y,
        width: Math.max(1, maxWidth - x),
        height,
        items: orderedItems,
      };
    })
    .filter((line) => line.text);
}

function buildPdfTextMetrics(page = {}) {
  const text = normalizeWhitespace(page.text);
  const tokens = text ? text.split(/\s+/).filter(Boolean) : [];
  const lineTexts = Array.isArray(page.lines)
    ? page.lines.map((line) => normalizeWhitespace(line.text)).filter(Boolean)
    : [];
  const letterCount = (text.match(/[A-Za-z]/g) || []).length;
  const digitCount = (text.match(/\d/g) || []).length;
  const alnumCount = letterCount + digitCount;
  const symbolCount = Math.max(0, text.length - alnumCount);
  const suspiciousTokenCount = tokens.filter(
    (token) =>
      /[A-Za-z]/.test(token) &&
      /[0158]/.test(token) &&
      token.length >= 3
  ).length;
  const mixedAlphaDigitTokenCount = tokens.filter(
    (token) =>
      /[A-Za-z]/.test(token) &&
      /\d/.test(token) &&
      token.length >= 3
  ).length;
  const likelyOcrCorruptionTokenCount = tokens.filter(
    (token) =>
      /[A-Za-z]/.test(token) &&
      /[0134568]/.test(token) &&
      token.length >= 3
  ).length;

  return {
    text,
    textLength: text.length,
    wordCount: tokens.length,
    lineCount: lineTexts.length,
    denseLineCount: lineTexts.filter((lineText) => lineText.length >= 8).length,
    averageLineLength: lineTexts.length
      ? lineTexts.reduce((sum, lineText) => sum + lineText.length, 0) / lineTexts.length
      : 0,
    letterCount,
    digitCount,
    alnumCount,
    symbolCount,
    suspiciousTokenCount,
    suspiciousTokenRatio: tokens.length ? suspiciousTokenCount / tokens.length : 0,
    mixedAlphaDigitTokenCount,
    mixedAlphaDigitTokenRatio: tokens.length ? mixedAlphaDigitTokenCount / tokens.length : 0,
    likelyOcrCorruptionTokenCount,
    likelyOcrCorruptionTokenRatio: tokens.length
      ? likelyOcrCorruptionTokenCount / tokens.length
      : 0,
  };
}

function shouldUseOcrForPage(page = {}) {
  const metrics = buildPdfTextMetrics(page);

  if (!metrics.textLength) {
    return true;
  }

  if (metrics.alnumCount < 8 && metrics.wordCount < 3) {
    return true;
  }

  if (
    metrics.textLength < 18 &&
    metrics.letterCount < 10 &&
    metrics.denseLineCount === 0
  ) {
    return true;
  }

  if (
    metrics.wordCount < 5 &&
    metrics.letterCount < 14 &&
    metrics.symbolCount > metrics.alnumCount
  ) {
    return true;
  }

  if (
    metrics.suspiciousTokenRatio >= 0.6 &&
    metrics.wordCount >= 3 &&
    metrics.wordCount <= 24 &&
    metrics.averageLineLength < 12
  ) {
    return true;
  }

  if (
    metrics.mixedAlphaDigitTokenRatio >= 0.5 &&
    metrics.wordCount >= 2 &&
    metrics.wordCount <= 32 &&
    metrics.averageLineLength < 48
  ) {
    return true;
  }

  if (
    metrics.likelyOcrCorruptionTokenRatio >= 0.34 &&
    metrics.wordCount >= 2 &&
    metrics.wordCount <= 24
  ) {
    return true;
  }

  return false;
}

function detectPdfOcrRuntime() {
  if (OCR_RUNTIME_CACHE) {
    return OCR_RUNTIME_CACHE;
  }

  if (!readBooleanEnv("ENABLE_PDF_OCR", true)) {
    OCR_RUNTIME_CACHE = {
      available: false,
      command: "",
      args: [],
      reason: "disabled",
    };
    return OCR_RUNTIME_CACHE;
  }

  const languages = getPdfOcrLanguages();
  let lastFailureReason = "missing_dependencies_or_models";

  for (const candidate of OCR_RUNTIME_CANDIDATES) {
    try {
      const output = execFileSync(
        candidate.command,
        [
          ...candidate.args,
          "-c",
          [
            "import importlib.util as u",
            "import json",
            "import os",
            "mods=['fitz','easyocr','PIL']",
            "status={m: bool(u.find_spec(m)) for m in mods}",
            "langs=[lang.strip() for lang in os.getenv('PDF_OCR_LANGS', 'en').replace(',', ' ').split() if lang.strip()] or ['en']",
            "status['languages']=langs",
            "if all(status[m] for m in mods):",
            "    import easyocr",
            "    easyocr.Reader(langs, gpu=False, verbose=False, download_enabled=False)",
            "    status['reader_ready']=True",
            "else:",
            "    status['reader_ready']=False",
            "print(json.dumps(status))",
          ].join("\n"),
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PDF_OCR_LANGS: languages.join(","),
          },
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          timeout: 60000,
        }
      );
      const parsed = JSON.parse(String(output || "").trim() || "{}");
      if (parsed.fitz && parsed.easyocr && parsed.PIL && parsed.reader_ready) {
        OCR_RUNTIME_CACHE = {
          available: true,
          command: candidate.command,
          args: candidate.args,
          reason: "ready",
          languages,
        };
        return OCR_RUNTIME_CACHE;
      }
    } catch (error) {
      lastFailureReason =
        String(error?.stderr || error?.stdout || error?.message || "")
          .replace(/\s+/g, " ")
          .trim() || lastFailureReason;
      continue;
    }
  }

  OCR_RUNTIME_CACHE = {
    available: false,
    command: "",
    args: [],
    reason: lastFailureReason,
    languages,
  };
  return OCR_RUNTIME_CACHE;
}

async function runPdfOcrViaService(pdfPath, pageNumbers = []) {
  const serviceUrl = getPdfOcrServiceUrl();
  const languages = getPdfOcrLanguages();
  if (!serviceUrl || !pageNumbers.length) {
    return {
      available: false,
      attempted: false,
      reason: serviceUrl ? "no_pages_requested" : "ocr_service_not_configured",
      pages: [],
      runtime: {
        available: false,
        command: "service",
        args: [],
        reason: serviceUrl ? "no_pages_requested" : "ocr_service_not_configured",
        serviceUrl,
        languages,
      },
    };
  }

  const formData = new FormData();
  formData.append(
    "file",
    new Blob([fs.readFileSync(pdfPath)], { type: "application/pdf" }),
    path.basename(pdfPath)
  );
  formData.append("page_numbers", JSON.stringify(pageNumbers));
  formData.append("languages", languages.join(","));

  const response = await fetch(serviceUrl, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(OCR_SERVICE_TIMEOUT_MS),
  });

  if (!response.ok) {
    let errorText = "";
    try {
      errorText = await response.text();
    } catch (error) {
      errorText = "";
    }

    throw new Error(
      `OCR service at ${serviceUrl} returned ${response.status}${
        errorText ? `: ${normalizeWhitespace(errorText)}` : ""
      }`
    );
  }

  const parsed = await response.json();
  return {
    available: true,
    attempted: true,
    reason: "ok",
    pages: Array.isArray(parsed.pages) ? parsed.pages : [],
    runtime: {
      available: true,
      command: "service",
      args: [],
      reason: "service",
      serviceUrl,
      languages,
    },
  };
}

async function runPdfOcr(pdfPath, pageNumbers = []) {
  const runtime = detectPdfOcrRuntime();
  const serviceUrl = getPdfOcrServiceUrl();
  const baseRuntime = {
    ...runtime,
    ...(serviceUrl ? { serviceUrl } : {}),
  };

  if (!pageNumbers.length) {
    return {
      available: runtime.available || Boolean(serviceUrl),
      attempted: false,
      reason: "no_pages_requested",
      pages: [],
      runtime: baseRuntime,
    };
  }

  if (!runtime.available && !serviceUrl) {
    return {
      available: false,
      attempted: false,
      reason: runtime.reason,
      pages: [],
      runtime: baseRuntime,
    };
  }

  if (runtime.available) {
    try {
      const output = execFileSync(
        runtime.command,
        [
          ...runtime.args,
          OCR_SCRIPT_PATH,
          pdfPath,
          JSON.stringify(pageNumbers),
        ],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          timeout: 300000,
          maxBuffer: 50 * 1024 * 1024,
        }
      );
      const parsed = JSON.parse(String(output || "").trim() || "{}");
      return {
        available: true,
        attempted: true,
        reason: "ok",
        pages: Array.isArray(parsed.pages) ? parsed.pages : [],
        runtime,
      };
    } catch (error) {
      const directReason =
        String(error?.stderr || error?.stdout || error?.message || "")
          .replace(/\s+/g, " ")
          .trim() || "ocr_execution_failed";

      if (!serviceUrl) {
        return {
          available: false,
          attempted: true,
          reason: directReason,
          pages: [],
          runtime: {
            ...baseRuntime,
            reason: directReason,
          },
        };
      }
    }
  }

  try {
    return await runPdfOcrViaService(pdfPath, pageNumbers);
  } catch (error) {
    return {
      available: false,
      attempted: Boolean(serviceUrl),
      reason:
        String(error?.stderr || error?.stdout || error?.message || "")
          .replace(/\s+/g, " ")
          .trim() || "ocr_execution_failed",
      pages: [],
      runtime: {
        ...baseRuntime,
        reason:
          String(error?.stderr || error?.stdout || error?.message || "")
            .replace(/\s+/g, " ")
            .trim() || "ocr_execution_failed",
      },
    };
  }
}

function mergeOcrIntoPages(textPages = [], ocrResult = {}) {
  const pageMap = new Map(textPages.map((page) => [page.pageNumber, page]));
  const usedPageNumbers = [];

  (ocrResult.pages || []).forEach((ocrPage) => {
    const existing = pageMap.get(ocrPage.pageNumber);
    if (!existing) {
      return;
    }

    const existingText = normalizeWhitespace(existing.text);
    const ocrText = normalizeWhitespace(ocrPage.text);
    const shouldReplace =
      Boolean(ocrText) &&
      (!existingText || ocrText.length >= Math.max(12, existingText.length * 0.5));

    if (!shouldReplace) {
      return;
    }

    usedPageNumbers.push(existing.pageNumber);
    pageMap.set(existing.pageNumber, {
      ...existing,
      width: Number(ocrPage.width) || existing.width,
      height: Number(ocrPage.height) || existing.height,
      lines: Array.isArray(ocrPage.lines) ? ocrPage.lines : existing.lines,
      text: ocrText,
      extractionMethod: "ocr",
      ocrApplied: true,
      ocrConfidence:
        Number.isFinite(Number(ocrPage.averageConfidence))
          ? Number(ocrPage.averageConfidence)
          : undefined,
    });
  });

  return {
    pages: Array.from(pageMap.values()).sort((left, right) => left.pageNumber - right.pageNumber),
    usedPageNumbers,
  };
}

async function extractPdfTextPages(pdfPath) {
  const dataBuffer = fs.readFileSync(pdfPath);
  const parsed = await pdfParse(dataBuffer, {
    pagerender: renderPdfPageItems,
  });
  const embeddedPages = parseEmbeddedPages(parsed.text);

  let pages = embeddedPages.map((page, index) => {
    const lines = groupItemsIntoLines(page.items || []);
    return {
      pageNumber: index + 1,
      width: Number(page.width) || 0,
      height: Number(page.height) || 0,
      lines,
      text: lines.map((line) => line.text).join("\n"),
      extractionMethod: "text-layer",
      ocrApplied: false,
    };
  });

  const candidatePages = pages
    .filter((page) => shouldUseOcrForPage(page))
    .map((page) => page.pageNumber)
    .slice(0, Math.max(0, OCR_MAX_PAGES));

  const ocrSummary = {
    enabled: readBooleanEnv("ENABLE_PDF_OCR", true),
    attempted: false,
    available: false,
    candidatePageNumbers: candidatePages,
    usedPageNumbers: [],
    reason: candidatePages.length ? "pending" : "not_needed",
    runtime: {
      ...detectPdfOcrRuntime(),
      ...(getPdfOcrServiceUrl() ? { serviceUrl: getPdfOcrServiceUrl() } : {}),
    },
  };

  if (ocrSummary.enabled && candidatePages.length) {
    const ocrResult = await runPdfOcr(pdfPath, candidatePages);
    ocrSummary.attempted = ocrResult.attempted === true;
    ocrSummary.available = ocrResult.available;
    ocrSummary.reason = ocrResult.reason;
    ocrSummary.runtime = ocrResult.runtime || ocrSummary.runtime;

    if (ocrResult.available && ocrResult.pages.length) {
      const merged = mergeOcrIntoPages(pages, ocrResult);
      pages = merged.pages;
      ocrSummary.usedPageNumbers = merged.usedPageNumbers;
      if (!ocrSummary.usedPageNumbers.length) {
        ocrSummary.reason = "ocr_not_better_than_text_layer";
      }
    }
  } else {
    ocrSummary.available =
      ocrSummary.runtime.available || Boolean(ocrSummary.runtime.serviceUrl);
    if (!ocrSummary.available && candidatePages.length) {
      ocrSummary.reason = ocrSummary.runtime.reason;
    }
  }

  return {
    info: parsed.info || {},
    numpages: parsed.numpages || pages.length,
    pages,
    ocr: ocrSummary,
  };
}

module.exports = {
  detectPdfOcrRuntime,
  extractPdfTextPages,
  shouldUseOcrForPage,
};
