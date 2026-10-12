const fs = require("fs");
const path = require("path");
const glob = require("glob");

const DIGIT_OPTIONS = {
  "0": ["o"],
  "1": ["i", "l"],
  "5": ["s"],
  "8": ["b"],
};

const MAX_SEGMENT_PARTS = 3;
const LETTER_REGEX = /\p{L}/u;
const WORD_REGEX = /\p{L}+/gu;
const TOKEN_REGEX = /\b[\p{L}][\p{L}0-9]{2,}\b/gu;
const CONSERVATIVE_OCR_TOKEN_REGEX = /^[A-Z]?[a-z]{1,8}[0158][a-z]{1,8}$/;
const BROKEN_HYPHEN_REGEX = /\b(\p{L}{2,})-(\s+)(\p{L}{2,})\b/gu;
const INLINE_HYPHEN_REGEX = /\b(\p{L}{2,})-(\p{L}{2,})\b/gu;
const CAMELCASE_SPACING_REGEX = /\b(\p{Ll}{2,})(\p{Lu}\p{Ll}{0,})\b/gu;
const REPEATED_LETTER_TOKEN_REGEX = /\b[A-Za-z]*([A-Za-z])\1{2,}[A-Za-z]*\b/g;
const REPEATED_SUBSEGMENT_TOKEN_REGEX = /\b[A-Za-z]*([A-Za-z]{2,3})\1{2,}[A-Za-z]*\b/g;
const TITLE_SPACING_REGEX = /\b(Mr|Mrs|Ms|Dr|Prof|St)([A-Z]\p{L}{0,})\b/gu;
const PUNCTUATION_SPACE_REGEX = /(\p{L})([?!;:,])(\p{L})/gu;
const PERIOD_SPACE_REGEX = /(\p{Ll})\.((?:\p{Lu}|\d)\p{L}{1,})/gu;
const DOUBLE_SPACE_REGEX = /(\p{L}) {2,}(\p{L})/gu;
const SYMBOL_CORRUPTION_REGEX = /\b[\p{L}]+[@$+|€¢£][\p{L}@$+|€¢£]+\b/gu;
const CONTROL_CHAR_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const INVALID_ENTITY_REGEX = /&(?!(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);)/g;
const NBSP_ENTITY_REGEX = /&(nbsp|#160|#xA0);/gi;
const REPLACEMENT_CHAR_REGEX = /\uFFFD+/g;
const MOJIBAKE_MARKER_REGEX = /[\u00C2\u00C3\u00E2]/g;
const SINGLE_LETTER_SEGMENTS = new Set(["a", "i"]);
const COORDINATED_HYPHEN_RIGHT_WORDS = new Set(["and", "or", "to"]);
const PROTECTED_NAME_PARTICLES = new Set([
  "al",
  "bin",
  "da",
  "de",
  "del",
  "della",
  "der",
  "di",
  "du",
  "el",
  "fitz",
  "la",
  "le",
  "mac",
  "mc",
  "o",
  "st",
  "van",
  "von",
]);
const DERIVATIONAL_STRIP_SUFFIXES = [
  "ations",
  "ation",
  "ments",
  "ment",
  "orial",
  "ories",
  "ology",
  "ories",
  "fully",
  "fully",
  "fulness",
  "ness",
  "less",
  "able",
  "ably",
  "ials",
  "ial",
  "ings",
  "ing",
  "iers",
  "ier",
  "ers",
  "er",
  "ors",
  "or",
  "age",
  "ages",
  "ions",
  "ion",
  "ists",
  "ist",
  "isms",
  "ism",
  "ships",
  "ship",
  "ees",
  "ee",
  "ied",
  "ies",
  "ed",
  "es",
  "s",
  "ly",
  "al",
  "ful",
];

const PLACEHOLDER_PATTERNS = [
  /\b(?:todo|fixme|tbd|placeholder|dummy text|insert text|lorem ipsum)\b/gi,
  /(\?{2,}|\[\?+\]|_{3,}|\bX{3,}\b)/g,
];

const KNOWN_HYPHENATED_WORDS = new Set([
  "anti-war",
  "black-beard",
  "co-operate",
  "long-term",
  "part-time",
  "re-emerge",
  "re-enter",
  "re-entry",
  "self-aware",
  "short-term",
  "state-of-the-art",
  "trans-shipment",
  "well-being",
]);

const HYPHEN_PREFERRED_LEFT = new Set([
  "co",
  "full",
  "half",
  "non",
  "part",
  "post",
  "pre",
  "re",
  "self",
  "state",
  "well",
]);

const HYPHEN_PREFERRED_RIGHT = new Set([
  "aware",
  "being",
  "born",
  "driven",
  "emerge",
  "enter",
  "entry",
  "facing",
  "free",
  "known",
  "like",
  "made",
  "off",
  "on",
  "operate",
  "out",
  "proof",
  "sized",
  "up",
]);

const JOIN_SUFFIXES = [
  "able",
  "ably",
  "ance",
  "ances",
  "ation",
  "ations",
  "ed",
  "ence",
  "ences",
  "ency",
  "encies",
  "er",
  "ers",
  "hood",
  "ing",
  "ion",
  "ions",
  "ism",
  "ist",
  "ists",
  "ity",
  "ive",
  "less",
  "ly",
  "ment",
  "ments",
  "ness",
  "ology",
  "ship",
  "sion",
  "tion",
  "tions",
];

const NAMED_ENTITY_MAP = {
  amp: "&",
  apos: "'",
  copy: "\u00A9",
  euro: "\u20AC",
  gt: ">",
  hellip: "\u2026",
  ldquo: "\u201C",
  lsquo: "\u2018",
  lt: "<",
  mdash: "\u2014",
  nbsp: " ",
  ndash: "\u2013",
  pound: "\u00A3",
  quot: "\"",
  rdquo: "\u201D",
  reg: "\u00AE",
  rsquo: "\u2019",
  trade: "\u2122",
  yen: "\u00A5",
};

const SEED_WORD_SCORES = {
  artificial: 8,
  book: 8,
  bodyguard: 4,
  cafe: 3,
  complete: 8,
  confluence: 8,
  cooperate: 5,
  database: 8,
  dark: 4,
  deep: 6,
  goes: 8,
  hello: 4,
  information: 8,
  intelligence: 8,
  learning: 8,
  like: 3,
  machine: 8,
  network: 8,
  neural: 8,
  price: 4,
  refuse: 4,
  report: 4,
  resume: 3,
  saved: 8,
  sample: 8,
  said: 3,
  school: 6,
  text: 6,
  think: 4,
  facto: 2,
  vision: 4,
  world: 4,
};

const SEED_BIGRAM_SCORES = {
  "artificial intelligence": 8,
  "deep neural": 4,
  "machine learning": 8,
  "neural network": 8,
  "sample text": 4,
};

const MOJIBAKE_REPLACEMENTS = [
  [/\u00E2\u20AC\u2122/g, "\u2019"],
  [/\u00E2\u20AC\u02DC/g, "\u2018"],
  [/\u00E2\u20AC\u0153/g, "\u201C"],
  [/\u00E2\u20AC\u009D/g, "\u201D"],
  [/\u00E2\u20AC\u201C/g, "\u2013"],
  [/\u00E2\u20AC\u201D/g, "\u2014"],
  [/\u00E2\u20AC\u00A6/g, "\u2026"],
  [/\u00E2\u201A\u00B9/g, "\u20B9"],
  [/\u00C2\u00A0/g, " "],
  [/\u00C2(?=\s)/g, ""],
];

let englishDictionaryCache = null;
let englishDictionaryDataCache = null;
let protectedTextRulesCache = null;

function normalizeProtectionKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z]+/g, "");
}

function loadProtectedTextRules() {
  if (protectedTextRulesCache) {
    return protectedTextRulesCache;
  }

  const rulesDir = path.join(__dirname, "..", "..", "kb", "internal", "rules");
  const loadWords = (filename, fallback = []) => {
    try {
      const payload = JSON.parse(
        fs.readFileSync(path.join(rulesDir, filename), "utf8")
      );
      const words = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.words)
          ? payload.words
          : [];

      return new Set(
        words.map((entry) => normalizeProtectionKey(entry)).filter(Boolean)
      );
    } catch (error) {
      return new Set(fallback.map((entry) => normalizeProtectionKey(entry)));
    }
  };

  protectedTextRulesCache = {
    doNotSplit: loadWords("do-not-split-words.json", ["McCain", "deMark"]),
    doNotMerge: loadWords("do-not-merge-words.json", []),
  };
  return protectedTextRulesCache;
}

function loadEnglishDictionaryData() {
  if (englishDictionaryDataCache) {
    return englishDictionaryDataCache;
  }

  const dictionaryDir = path.join(
    __dirname,
    "..",
    "..",
    "kb",
    "lookups",
    "dictionaries",
    "libreoffice",
    "en"
  );
  const dictionaryPath = path.join(dictionaryDir, "en_US.dic");
  const affixPath = path.join(dictionaryDir, "en_US.aff");

  const entries = new Set();
  const flagsByWord = new Map();
  const prefixes = new Map();
  const suffixes = new Map();
  const derivedWordCache = new Map();

  try {
    const lines = fs.readFileSync(dictionaryPath, "utf8").split(/\r\n|\n/);
    lines.slice(1).forEach((line) => {
      const raw = String(line || "").trim();
      if (!raw || raw.startsWith("#")) {
        return;
      }

      const [wordPart, flagsPart = ""] = raw.split("/");
      const word = wordPart.trim().toLowerCase();
      if (!/^[a-z][a-z'-]*$/i.test(word)) {
        return;
      }

      entries.add(word);
      flagsByWord.set(word, new Set(flagsPart.trim().split("").filter(Boolean)));
    });
  } catch (error) {
    englishDictionaryDataCache = {
      entries,
      flagsByWord,
      prefixes,
      suffixes,
      derivedWordCache,
    };
    return englishDictionaryDataCache;
  }

  try {
    const affLines = fs.readFileSync(affixPath, "utf8").split(/\r\n|\n/);
    for (let index = 0; index < affLines.length; index += 1) {
      const line = String(affLines[index] || "").trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      const header = line.match(/^(PFX|SFX)\s+(\S+)\s+([YN])\s+(\d+)$/);
      if (!header) {
        continue;
      }

      const [, kind, flag, crossProduct, countRaw] = header;
      const count = Number.parseInt(countRaw, 10);
      const targetMap = kind === "PFX" ? prefixes : suffixes;
      const rules = [];

      for (let ruleIndex = 0; ruleIndex < count && index + 1 < affLines.length; ruleIndex += 1) {
        index += 1;
        const parts = String(affLines[index] || "").trim().split(/\s+/);
        if (parts.length < 5) {
          continue;
        }

        const [, ruleFlag, stripRaw, addRaw, conditionRaw] = parts;
        if (ruleFlag !== flag) {
          continue;
        }

        rules.push({
          strip: stripRaw === "0" ? "" : stripRaw,
          add: addRaw === "0" ? "" : addRaw,
          condition: conditionRaw || ".",
        });
      }

      targetMap.set(flag, {
        crossProduct: crossProduct === "Y",
        rules,
      });
    }
  } catch (error) {
    // The dictionary still works without affix rules; we fall back to direct entries.
  }

  englishDictionaryDataCache = {
    entries,
    flagsByWord,
    prefixes,
    suffixes,
    derivedWordCache,
  };
  return englishDictionaryDataCache;
}

function loadEnglishDictionary() {
  if (!englishDictionaryCache) {
    englishDictionaryCache = loadEnglishDictionaryData().entries;
  }

  return englishDictionaryCache;
}

const GRAMMAR_REPLACEMENTS = [
  {
    regex: /\b(he|she|it)\s+go\b/gi,
    replacement: (subject) => `${subject} goes`,
    blockedPreviousWords: new Set(["let"]),
  },
  {
    regex: /\b(he|she|it)\s+do\b/gi,
    replacement: (subject) => `${subject} does`,
  },
  {
    regex: /\b(he|she|it)\s+have\b/gi,
    replacement: (subject) => `${subject} has`,
  },
];

const SYMBOL_OPTIONS = {
  "@": ["", "a"],
  $: ["", "s"],
  "+": ["", "t"],
  "|": ["", "i", "l"],
  "€": ["", "e"],
  "£": ["", "l"],
  "¢": ["", "c"],
};

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function excerptForText(text, index, length) {
  const safeText = String(text || "");
  const start = Math.max(0, index - 40);
  const end = Math.min(safeText.length, index + length + 40);
  return safeText
    .slice(start, end)
    .replace(/\s+/g, " ")
    .trim();
}

function getAdjacentWords(text, index, length) {
  const safeText = String(text || "");
  const beforeWords = safeText.slice(0, Math.max(0, index)).match(/\p{L}+/gu) || [];
  const nextMatch = safeText
    .slice(Math.max(0, index) + Math.max(0, length))
    .match(/\p{L}+/u);

  return {
    previous: beforeWords.length ? beforeWords[beforeWords.length - 1].toLowerCase() : "",
    next: nextMatch ? nextMatch[0].toLowerCase() : "",
  };
}

function pushUnique(list, item) {
  if (!item || !item.original || list.some((entry) =>
    entry.type === item.type &&
    entry.original === item.original &&
    entry.replacement === item.replacement
  )) {
    return;
  }

  list.push(item);
}

function decodeHtmlEntities(text) {
  return String(text || "").replace(
    /&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g,
    (match, entity) => {
      if (!entity) return match;

      if (entity[0] === "#") {
        const isHex = entity[1] && entity[1].toLowerCase() === "x";
        const value = parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
        if (!Number.isFinite(value)) return match;
        return String.fromCodePoint(value);
      }

      return Object.prototype.hasOwnProperty.call(NAMED_ENTITY_MAP, entity)
        ? NAMED_ENTITY_MAP[entity]
        : match;
    }
  );
}

function encodeXmlText(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stripTags(html) {
  return decodeHtmlEntities(String(html || "").replace(/<[^>]+>/g, " "));
}

function normalizePlainText(text) {
  return String(text || "")
    .replace(CONTROL_CHAR_REGEX, "")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveContentDocuments({ tempDir, opfAbsolute, opfXml } = {}) {
  const seen = new Set();
  const docs = [];
  const opfDir = opfAbsolute ? path.dirname(opfAbsolute) : tempDir;
  const manifestItems = asArray(opfXml?.package?.manifest?.item ?? opfXml?.manifest?.item);

  manifestItems.forEach((item) => {
    const href = item?.["@_href"] || item?.href;
    const mediaType = item?.["@_media-type"] || item?.["media-type"] || item?.mediaType;
    if (!href) return;

    const isContentDoc =
      mediaType === "application/xhtml+xml" || /\.(xhtml|html)$/i.test(href);
    if (!isContentDoc) return;

    const absolutePath = path.resolve(opfDir, href);
    if (!fs.existsSync(absolutePath)) return;

    const relPath = path.relative(tempDir, absolutePath).replace(/\\/g, "/");
    if (seen.has(relPath)) return;

    seen.add(relPath);
    docs.push({ absolutePath, relPath });
  });

  if (docs.length) {
    return docs;
  }

  return glob
    .sync("**/*.{xhtml,html}", { cwd: tempDir, nodir: true })
    .map((relPath) => ({
      absolutePath: path.join(tempDir, relPath),
      relPath: relPath.replace(/\\/g, "/"),
    }));
}

function extractWords(text) {
  return normalizePlainText(text).match(WORD_REGEX) || [];
}

function buildCorpusData(texts = []) {
  const wordCounts = new Map();
  const bigramCounts = new Map();
  const hyphenCounts = new Map();
  const surfaceForms = new Map();

  texts.forEach((text) => {
    const normalized = normalizePlainText(text);
    const words = extractWords(normalized).map((word) => word.toLowerCase());
    const surfaceTokens =
      String(text || "").match(/\b[\p{L}]+(?:[-'][\p{L}]+)*\b/gu) || [];

    words.forEach((word, index) => {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);

      if (index < words.length - 1) {
        const key = `${word} ${words[index + 1]}`;
        bigramCounts.set(key, (bigramCounts.get(key) || 0) + 1);
      }
    });

    const hyphenMatches = normalized.match(/\b[\p{L}]+-[\p{L}]+\b/gu) || [];
    hyphenMatches.forEach((match) => {
      const key = match.toLowerCase();
      hyphenCounts.set(key, (hyphenCounts.get(key) || 0) + 1);
    });

    surfaceTokens.forEach((token) => {
      const key = normalizeProtectionKey(token);
      if (!key) {
        return;
      }

      if (!surfaceForms.has(key)) {
        surfaceForms.set(key, new Set());
      }

      surfaceForms.get(key).add(token);
    });
  });

  return { wordCounts, bigramCounts, hyphenCounts, surfaceForms };
}

function buildTextNormalizationContextFromTexts(texts = []) {
  const corpus = buildCorpusData(texts);
  const lexiconIndex = new Map();
  const lexicon = new Set();
  const attestedWords = new Set(corpus.wordCounts.keys());
  const dictionaryData = loadEnglishDictionaryData();
  const dictionaryWords = dictionaryData.entries;
  const protectedTextRules = loadProtectedTextRules();

  Object.keys(SEED_WORD_SCORES).forEach((word) => {
    lexicon.add(word);
  });

  dictionaryWords.forEach((word) => {
    lexicon.add(word);
  });

  corpus.wordCounts.forEach((count, word) => {
    if (count >= 2 || SEED_WORD_SCORES[word]) {
      lexicon.add(word);
    }
  });

  lexicon.forEach((word) => {
    const key = `${word[0]}:${word.length}`;
    if (!lexiconIndex.has(key)) {
      lexiconIndex.set(key, []);
    }
    lexiconIndex.get(key).push(word);
  });

  return {
    ...corpus,
    attestedWords,
    dictionaryData,
    dictionaryWords,
    lexicon,
    lexiconIndex,
    protectedSplitWords: protectedTextRules.doNotSplit,
    protectedMergeWords: protectedTextRules.doNotMerge,
    wordFamilyCache: new Map(),
  };
}

function buildTextNormalizationContext({ tempDir, opfAbsolute, opfXml, docs } = {}) {
  const contentDocs = docs || resolveContentDocuments({ tempDir, opfAbsolute, opfXml });
  const texts = contentDocs.map((doc) =>
    stripTags(fs.readFileSync(doc.absolutePath, "utf8"))
  );

  return buildTextNormalizationContextFromTexts(texts);
}

function applyAffixRuleToBase(base, rule, kind) {
  const root = String(base || "").toLowerCase();
  if (!root) {
    return "";
  }

  if (kind === "PFX") {
    if (
      rule.condition !== "." &&
      !(new RegExp(`^${rule.condition}`)).test(root)
    ) {
      return "";
    }

    const withoutStrip =
      rule.strip && root.startsWith(rule.strip)
        ? root.slice(rule.strip.length)
        : root;
    return `${rule.add}${withoutStrip}`;
  }

  if (
    rule.condition !== "." &&
    !(new RegExp(`${rule.condition}$`)).test(root)
  ) {
    return "";
  }

  const withoutStrip =
    rule.strip && root.endsWith(rule.strip)
      ? root.slice(0, -rule.strip.length)
      : root;
  return `${withoutStrip}${rule.add}`;
}

function deriveAffixBaseCandidates(word, affixMap, kind) {
  const normalized = String(word || "").toLowerCase();
  const data = loadEnglishDictionaryData();
  const candidates = [];

  affixMap.forEach((definition, flag) => {
    (definition.rules || []).forEach((rule) => {
      if (kind === "PFX") {
        if (!normalized.startsWith(rule.add)) {
          return;
        }

        const stem = `${rule.strip}${normalized.slice(rule.add.length)}`;
        if (!stem) {
          return;
        }

        const flags = data.flagsByWord.get(stem);
        if (!flags || !flags.has(flag)) {
          return;
        }

        if (
          rule.condition !== "." &&
          !(new RegExp(`^${rule.condition}`)).test(stem)
        ) {
          return;
        }

        candidates.push({
          base: stem,
          flag,
          crossProduct: definition.crossProduct === true,
        });
        return;
      }

      if (!normalized.endsWith(rule.add)) {
        return;
      }

      const stem = `${normalized.slice(0, normalized.length - rule.add.length)}${rule.strip}`;
      if (!stem) {
        return;
      }

      const flags = data.flagsByWord.get(stem);
      if (!flags || !flags.has(flag)) {
        return;
      }

      if (
        rule.condition !== "." &&
        !(new RegExp(`${rule.condition}$`)).test(stem)
      ) {
        return;
      }

      candidates.push({
        base: stem,
        flag,
        crossProduct: definition.crossProduct === true,
      });
    });
  });

  return candidates;
}

function buildWordFamilyVariants(base) {
  const normalized = String(base || "").toLowerCase();
  const variants = new Set([normalized]);
  if (!/^[a-z]{3,}$/.test(normalized)) {
    return variants;
  }

  const add = (value) => {
    if (value && /^[a-z]{3,}$/.test(value)) {
      variants.add(value);
    }
  };

  add(`${normalized}s`);
  add(`${normalized}es`);
  add(`${normalized}ly`);
  add(`${normalized}ness`);
  add(`${normalized}ment`);
  add(`${normalized}ments`);
  add(`${normalized}ful`);
  add(`${normalized}less`);
  add(`${normalized}able`);
  add(`${normalized}age`);
  add(`${normalized}ory`);
  add(`${normalized}orial`);
  add(`${normalized}al`);
  add(`${normalized}ial`);
  add(`${normalized}ion`);
  add(`${normalized}ions`);
  add(`${normalized}ist`);
  add(`${normalized}ists`);
  add(`${normalized}ism`);
  add(`${normalized}ee`);

  if (normalized.endsWith("e")) {
    add(`${normalized.slice(0, -1)}ing`);
    add(`${normalized}d`);
    add(`${normalized}r`);
  } else {
    add(`${normalized}ing`);
    add(`${normalized}ed`);
    add(`${normalized}er`);
  }

  if (normalized.endsWith("y") && !/[aeiou]y$/.test(normalized)) {
    const stem = normalized.slice(0, -1);
    add(`${stem}ies`);
    add(`${stem}ied`);
    add(`${stem}ier`);
    add(`${stem}iest`);
  }

  return variants;
}

function deriveWordFamilyBases(word) {
  const normalized = String(word || "").toLowerCase();
  const candidates = new Set([normalized]);
  if (!/^[a-z]{4,}$/.test(normalized)) {
    return candidates;
  }

  DERIVATIONAL_STRIP_SUFFIXES.forEach((suffix) => {
    if (!normalized.endsWith(suffix) || normalized.length <= suffix.length + 2) {
      return;
    }

    const stem = normalized.slice(0, -suffix.length);
    if (stem.length >= 3) {
      candidates.add(stem);
    }

    if (stem.length >= 3 && !stem.endsWith("e")) {
      candidates.add(`${stem}e`);
    }

    if (
      suffix.startsWith("i") &&
      stem.length >= 3 &&
      !stem.endsWith("y")
    ) {
      candidates.add(`${stem}y`);
    }
  });

  return candidates;
}

function countKnownFamilyMembers(base, context) {
  const normalized = String(base || "").toLowerCase();
  if (!normalized) {
    return 0;
  }

  let matches = 0;
  buildWordFamilyVariants(normalized).forEach((candidate) => {
    if (
      context.dictionaryWords?.has(candidate) ||
      context.attestedWords?.has(candidate) ||
      context.lexicon?.has(candidate)
    ) {
      matches += 1;
    }
  });

  return matches;
}

function hasWordFamilyEvidence(word, context) {
  const normalized = String(word || "").toLowerCase();
  if (!normalized || !context) {
    return false;
  }

  const cache = context.wordFamilyCache;
  if (cache?.has(normalized)) {
    return cache.get(normalized);
  }

  let known = false;
  deriveWordFamilyBases(normalized).forEach((base) => {
    if (known || base.length < 4) {
      return;
    }

    const familyMatches = countKnownFamilyMembers(base, context);
    if (familyMatches >= 2) {
      known = true;
      return;
    }

    if (
      base === normalized &&
      familyMatches >= 1 &&
      normalized.length >= 7
    ) {
      known = true;
    }
  });

  if (cache) {
    cache.set(normalized, known);
  }

  return known;
}

function hasProtectedSurfaceForm(word, context) {
  const key = normalizeProtectionKey(word);
  if (!key) {
    return false;
  }

  const surfaceVariants = Array.from(context.surfaceForms?.get(key) || []);
  const hasNameLikeSurface = surfaceVariants.some((variant) =>
    /[A-Z]/.test(String(variant || "").slice(1)) || /[-']/.test(String(variant || ""))
  );

  return (
    context.protectedSplitWords?.has(key) ||
    context.protectedMergeWords?.has(key) ||
    hasNameLikeSurface
  );
}

function getLexicalSupportScore(word, context) {
  const normalized = String(word || "").toLowerCase();
  if (!normalized) {
    return 0;
  }

  let score = getWordScore(normalized, context);
  if (context.dictionaryWords?.has(normalized) || isKnownDictionaryInflection(normalized, context)) {
    score += 1;
  }

  if (hasWordFamilyEvidence(normalized, context)) {
    score += 1;
  }

  if (context.protectedSplitWords?.has(normalizeProtectionKey(normalized))) {
    score += 2;
  }

  return score;
}

function getWordScore(word, context) {
  const normalized = String(word || "").toLowerCase();
  if (!normalized) return 0;
  return (context.wordCounts.get(normalized) || 0) + (SEED_WORD_SCORES[normalized] || 0);
}

function getBigramScore(left, right, context) {
  const key = `${String(left || "").toLowerCase()} ${String(right || "").toLowerCase()}`;
  return (context.bigramCounts.get(key) || 0) + (SEED_BIGRAM_SCORES[key] || 0);
}

function getContextualTokenScore(token, previousWord, nextWord, context) {
  const normalized = String(token || "").toLowerCase();
  let score = getLexicalSupportScore(normalized, context);

  if (previousWord) {
    score += getBigramScore(previousWord, normalized, context);
  }

  if (nextWord) {
    score += getBigramScore(normalized, nextWord, context);
  }

  return score;
}

function getContextualPhraseScore(phrase, previousWord, nextWord, context) {
  const parts = String(phrase || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) {
    return 0;
  }

  let score = parts.reduce((total, part) => total + getLexicalSupportScore(part, context), 0);

  for (let index = 1; index < parts.length; index += 1) {
    score += getBigramScore(parts[index - 1], parts[index], context);
  }

  if (previousWord) {
    score += getBigramScore(previousWord, parts[0], context);
  }

  if (nextWord) {
    score += getBigramScore(parts[parts.length - 1], nextWord, context);
  }

  return score;
}

function getHyphenScore(word, context) {
  const normalized = String(word || "").toLowerCase();
  return (context.hyphenCounts.get(normalized) || 0) + (KNOWN_HYPHENATED_WORDS.has(normalized) ? 4 : 0);
}

function isKnownDictionaryInflection(word, context) {
  const normalized = String(word || "").toLowerCase();
  const dictionary = context.dictionaryWords;
  const dictionaryData = context.dictionaryData || loadEnglishDictionaryData();
  if (!dictionary || !normalized) {
    return false;
  }

  if (dictionary.has(normalized)) {
    return true;
  }

  if (dictionaryData.derivedWordCache.has(normalized)) {
    return dictionaryData.derivedWordCache.get(normalized);
  }

  const hasDerivedAffixMatch = (() => {
    const suffixCandidates = deriveAffixBaseCandidates(
      normalized,
      dictionaryData.suffixes,
      "SFX"
    );
    if (suffixCandidates.length) {
      const directMatch = suffixCandidates.some(({ base, flag }) => {
        const definition = dictionaryData.suffixes.get(flag);
        return (definition?.rules || []).some((rule) => {
          return applyAffixRuleToBase(base, rule, "SFX") === normalized;
        });
      });

      if (directMatch) {
        return true;
      }

      const crossMatch = suffixCandidates.some(({ base, crossProduct }) => {
        if (!crossProduct) {
          return false;
        }

        const prefixes = dictionaryData.flagsByWord.get(base);
        if (!prefixes) {
          return false;
        }

        for (const prefixFlag of prefixes) {
          const definition = dictionaryData.prefixes.get(prefixFlag);
          if (!definition || definition.crossProduct !== true) {
            continue;
          }

          const matches = (definition.rules || []).some((rule) => {
            return applyAffixRuleToBase(base, rule, "PFX") === normalized;
          });
          if (matches) {
            return true;
          }
        }

        return false;
      });

      if (crossMatch) {
        return true;
      }
    }

    const prefixCandidates = deriveAffixBaseCandidates(
      normalized,
      dictionaryData.prefixes,
      "PFX"
    );
    return prefixCandidates.some(({ base, flag }) => {
      const definition = dictionaryData.prefixes.get(flag);
      return (definition?.rules || []).some((rule) => {
        return applyAffixRuleToBase(base, rule, "PFX") === normalized;
      });
    });
  })();

  if (hasDerivedAffixMatch) {
    dictionaryData.derivedWordCache.set(normalized, true);
    return true;
  }

  if (normalized.endsWith("ies")) {
    const pluralBases = [
      `${normalized.slice(0, -3)}y`,
      normalized.slice(0, -1),
    ];
    if (pluralBases.some((candidate) => dictionary.has(candidate))) {
      return true;
    }
  }

  if (normalized.endsWith("es")) {
    const pluralBases = [
      normalized.slice(0, -2),
      normalized.slice(0, -1),
    ];
    if (pluralBases.some((candidate) => dictionary.has(candidate))) {
      return true;
    }
  }

  if (normalized.endsWith("s") && dictionary.has(normalized.slice(0, -1))) {
    return true;
  }

  if (normalized.endsWith("ied")) {
    const pastBases = [
      `${normalized.slice(0, -3)}y`,
      normalized.slice(0, -1),
    ];
    if (pastBases.some((candidate) => dictionary.has(candidate))) {
      return true;
    }
  }

  if (normalized.endsWith("ed")) {
    const pastBases = [
      normalized.slice(0, -2),
      normalized.slice(0, -1),
      `${normalized.slice(0, -2)}e`,
    ];
    if (pastBases.some((candidate) => dictionary.has(candidate))) {
      return true;
    }
  }

  if (normalized.endsWith("d") && dictionary.has(normalized.slice(0, -1))) {
    return true;
  }

  if (normalized.endsWith("ing")) {
    const gerundBases = [
      normalized.slice(0, -3),
      `${normalized.slice(0, -3)}e`,
    ];
    if (gerundBases.some((candidate) => dictionary.has(candidate))) {
      dictionaryData.derivedWordCache.set(normalized, true);
      return true;
    }
  }

  dictionaryData.derivedWordCache.set(normalized, false);
  return false;
}

function isKnownWord(word, context) {
  const normalized = String(word || "").toLowerCase();
  return (
    isKnownDictionaryInflection(normalized, context) ||
    hasWordFamilyEvidence(normalized, context) ||
    hasProtectedSurfaceForm(normalized, context) ||
    context.lexicon.has(normalized) ||
    KNOWN_HYPHENATED_WORDS.has(normalized) ||
    getWordScore(normalized, context) >= 2
  );
}

function isSegmentWord(word, context) {
  const normalized = String(word || "").toLowerCase();
  return SINGLE_LETTER_SEGMENTS.has(normalized) || isKnownWord(normalized, context);
}

function preserveCase(source, replacement) {
  const original = String(source || "");
  const target = String(replacement || "");

  if (!original || !target) return replacement;
  if (original === original.toUpperCase()) return target.toUpperCase();
  if (original[0] === original[0].toUpperCase()) {
    return target[0].toUpperCase() + target.slice(1);
  }

  return target;
}

function countArtifacts(text) {
  return (String(text || "").match(MOJIBAKE_MARKER_REGEX) || []).length;
}

function repairLatin1MojibakeToken(token) {
  const value = String(token || "");
  if (!value.includes("\u00C3")) {
    return "";
  }

  try {
    const repaired = Buffer.from(value, "latin1").toString("utf8");
    if (!repaired || repaired.includes("\uFFFD")) {
      return "";
    }

    return countArtifacts(repaired) < countArtifacts(value) ? repaired.normalize("NFC") : "";
  } catch (error) {
    return "";
  }
}

function generateCandidates(token, index = 0, prefix = "", candidates = new Set()) {
  const value = String(token || "");
  if (index >= value.length) {
    candidates.add(prefix);
    return candidates;
  }

  const character = value[index];
  const options = DIGIT_OPTIONS[character];
  if (!options) {
    generateCandidates(value, index + 1, prefix + character, candidates);
    return candidates;
  }

  options.forEach((option) => {
    generateCandidates(value, index + 1, prefix + option, candidates);
  });

  return candidates;
}

function correctOcrToken(token, context) {
  const value = String(token || "");
  if (!/\d/.test(value)) {
    return null;
  }

  const candidates = Array.from(generateCandidates(value)).filter((candidate) => {
    const normalized = candidate.toLowerCase();
    return normalized !== value.toLowerCase() && isKnownWord(normalized, context);
  });

  if (!candidates.length) {
    return null;
  }

  candidates.sort((left, right) => {
    return getLexicalSupportScore(right, context) - getLexicalSupportScore(left, context);
  });

  const bestCandidate = candidates[0];
  const secondCandidate = candidates[1];
  const bestScore = getLexicalSupportScore(bestCandidate, context);
  const secondScore = secondCandidate ? getLexicalSupportScore(secondCandidate, context) : 0;

  if (bestScore === 0 || bestScore < secondScore) {
    return null;
  }

  return {
    replacement: preserveCase(value, bestCandidate),
    confidence: secondScore === 0 ? "high" : "medium",
  };
}

function generateSymbolCandidates(token, index = 0, prefix = "", candidates = new Set()) {
  const value = String(token || "");
  if (index >= value.length) {
    if (prefix) {
      candidates.add(prefix);
    }
    return candidates;
  }

  const character = value[index];
  const options = SYMBOL_OPTIONS[character];
  if (!options) {
    generateSymbolCandidates(value, index + 1, prefix + character, candidates);
    return candidates;
  }

  options.forEach((option) => {
    generateSymbolCandidates(value, index + 1, prefix + option, candidates);
  });

  return candidates;
}

function correctSymbolCorruptionToken(token, context) {
  const value = String(token || "");
  if (!/[@$+|€¢£]/.test(value)) {
    return null;
  }

  const candidates = Array.from(generateSymbolCandidates(value)).filter((candidate) => {
    const normalized = candidate.toLowerCase();
    return (
      /^[a-z]+$/i.test(candidate) &&
      normalized !== value.toLowerCase() &&
      isKnownWord(normalized, context)
    );
  });

  if (!candidates.length) {
    return null;
  }

  candidates.sort((left, right) => {
    const scoreDelta =
      getLexicalSupportScore(right, context) - getLexicalSupportScore(left, context);
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return left.length - right.length;
  });

  const bestCandidate = candidates[0];
  const secondCandidate = candidates[1];
  const bestScore = getLexicalSupportScore(bestCandidate, context);
  const secondScore = secondCandidate ? getLexicalSupportScore(secondCandidate, context) : 0;

  return {
    replacement: preserveCase(value, bestCandidate),
    confidence: secondScore === 0 || bestScore > secondScore ? "high" : "medium",
  };
}

function collapseRepeatedSequenceToken(token, options = {}) {
  let collapsed = String(token || "");
  if (!/[A-Za-z]/.test(collapsed)) {
    return null;
  }

  const removeEntireSequence = options.removeEntireSequence === true;
  const patterns = [
    /([A-Za-z]{2,3})\1{2,}/g,
    /([A-Za-z])\1{2,}/g,
  ];

  let previous;
  do {
    previous = collapsed;
    patterns.forEach((pattern) => {
      collapsed = collapsed.replace(pattern, (match, group) =>
        removeEntireSequence ? "" : group
      );
    });
  } while (collapsed !== previous);

  if (collapsed === String(token || "") || !/[A-Za-z]/.test(collapsed)) {
    return null;
  }

  return collapsed;
}

function isSingleDeletion(source, target) {
  const left = String(source || "");
  const right = String(target || "");
  if (left.length !== right.length + 1) {
    return false;
  }

  let leftIndex = 0;
  let rightIndex = 0;
  let deletionUsed = false;

  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    if (deletionUsed) {
      return false;
    }

    deletionUsed = true;
    leftIndex += 1;
  }

  return true;
}

function correctRepeatedSequenceToken(token, context) {
  const collapsed = collapseRepeatedSequenceToken(token);
  if (!collapsed) {
    return null;
  }

  const normalized = collapsed.toLowerCase();
  if (isKnownWord(normalized, context)) {
    return { replacement: collapsed, confidence: "high" };
  }

  const spelling = spellCorrectWord(collapsed, context, true);
  if (spelling) {
    return spelling;
  }

  const zeroCollapsed = collapseRepeatedSequenceToken(token, {
    removeEntireSequence: true,
  });
  if (zeroCollapsed && zeroCollapsed !== collapsed) {
    const zeroNormalized = zeroCollapsed.toLowerCase();
    if (isKnownWord(zeroNormalized, context)) {
      return { replacement: zeroCollapsed, confidence: "high" };
    }

    const zeroSpelling = spellCorrectWord(zeroCollapsed, context, true);
    if (zeroSpelling) {
      return zeroSpelling;
    }
  }

  return null;
}

function damerauLevenshtein(a, b, maxDistance = 2) {
  const left = String(a || "");
  const right = String(b || "");
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    let rowMin = matrix[i][0];

    for (let j = 1; j < cols; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );

      if (
        i > 1 &&
        j > 1 &&
        left[i - 1] === right[j - 2] &&
        left[i - 2] === right[j - 1]
      ) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + cost);
      }

      rowMin = Math.min(rowMin, matrix[i][j]);
    }

    if (rowMin > maxDistance) {
      return maxDistance + 1;
    }
  }

  return matrix[left.length][right.length];
}

function isSingleInsertion(source, target) {
  const left = String(source || "");
  const right = String(target || "");

  if (right.length !== left.length + 1) {
    return false;
  }

  let leftIndex = 0;
  let rightIndex = 0;
  let insertionUsed = false;

  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    if (insertionUsed) {
      return false;
    }

    insertionUsed = true;
    rightIndex += 1;
  }

  return true;
}

function looksLikeProtectedHyphenatedName(left, right, context) {
  const leftValue = String(left || "");
  const rightValue = String(right || "");
  const combinedKey = normalizeProtectionKey(`${leftValue}${rightValue}`);
  const hyphenatedKey = normalizeProtectionKey(`${leftValue}-${rightValue}`);

  const isSurnamePattern =
    PROTECTED_NAME_PARTICLES.has(leftValue.toLowerCase()) ||
    /^Mc$/i.test(leftValue) ||
    /^Mac$/i.test(leftValue) ||
    /^[A-Z][a-z]+$/.test(leftValue) && /^[A-Z][a-z]+$/.test(rightValue);

  return (
    isSurnamePattern &&
    (
      context.protectedSplitWords?.has(combinedKey) ||
      context.surfaceForms?.has(combinedKey) ||
      context.surfaceForms?.has(hyphenatedKey) ||
      context.dictionaryWords?.has(combinedKey)
    )
  );
}

function violatesInflectionContext(original, replacement, previousWord) {
  const originalValue = String(original || "").toLowerCase();
  const replacementValue = String(replacement || "").toLowerCase();
  const previous = String(previousWord || "").toLowerCase();

  if (!previous) {
    return false;
  }

  const singularDeterminers = new Set([
    "a",
    "an",
    "another",
    "each",
    "every",
    "one",
    "single",
    "this",
    "that",
  ]);
  const modalTriggers = new Set([
    "can",
    "could",
    "did",
    "do",
    "does",
    "let",
    "may",
    "might",
    "must",
    "shall",
    "should",
    "to",
    "will",
    "would",
  ]);

  if (
    singularDeterminers.has(previous) &&
    (replacementValue === `${originalValue}s` || replacementValue === `${originalValue}es`)
  ) {
    return true;
  }

  if (
    modalTriggers.has(previous) &&
    (replacementValue === `${originalValue}d` || replacementValue === `${originalValue}ed`)
  ) {
    return true;
  }

  return false;
}

function spellCorrectWord(token, context) {
  const value = String(token || "");
  const normalized = value.toLowerCase();
  if (!/^[a-z][a-z]+$/i.test(value) || value !== value.toLowerCase()) {
    return null;
  }

  // Treat tokens that are only flagged as "known" by word-family evidence as
  // still eligible for correction, since truncated forms like "sampl" should
  // be corrected to "sample" rather than preserved.
  if (
    (isKnownWord(normalized, context) && !hasWordFamilyEvidence(normalized, context)) ||
    normalized.length < 4
  ) {
    return null;
  }

  const candidatePool = [];
  const firstCharacter = normalized[0];

  for (let length = normalized.length - 1; length <= normalized.length + 1; length += 1) {
    const key = `${firstCharacter}:${length}`;
    const words = context.lexiconIndex.get(key) || [];
    words.forEach((word) => candidatePool.push(word));
  }

  const candidates = candidatePool
    .map((candidate) => ({
      candidate,
      distance: damerauLevenshtein(normalized, candidate, 1),
      score: getLexicalSupportScore(candidate, context),
    }))
    .filter((candidate) =>
      candidate.distance <= 1 &&
      candidate.score > 0 &&
      isSingleInsertion(normalized, candidate.candidate)
    )
    .sort((left, right) => {
      if (left.distance !== right.distance) return left.distance - right.distance;
      return right.score - left.score;
    });

  if (!candidates.length) {
    return null;
  }

  const best = candidates[0];
  const second = candidates[1];

  if (second && best.distance === second.distance && best.score <= second.score) {
    return null;
  }

  return {
    replacement: best.candidate,
    confidence: second ? "medium" : "high",
  };
}

function restoreSegmentCase(source, parts) {
  if (!parts.length) return "";

  if (source === source.toUpperCase()) {
    return parts.map((part) => part.toUpperCase()).join(" ");
  }

  if (source[0] === source[0].toUpperCase()) {
    return [parts[0][0].toUpperCase() + parts[0].slice(1), ...parts.slice(1)].join(" ");
  }

  return parts.join(" ");
}

function segmentMergedWord(token, context) {
  const value = String(token || "");
  const normalized = value.toLowerCase();
  const isLowerCaseWord = value === value.toLowerCase();
  const isCapitalizedWord = /^[A-Z][a-z]+$/.test(value);
  if (
    !/^[a-z]{5,}$/i.test(value) ||
    (!isLowerCaseWord && !isCapitalizedWord) ||
    isKnownWord(normalized, context)
  ) {
    return null;
  }

  if (isCapitalizedWord && normalized.length > 7) {
    return null;
  }

  const memo = new Map();

  function search(index, previousPart, depth) {
    const key = `${index}:${previousPart || ""}:${depth}`;
    if (memo.has(key)) {
      return memo.get(key);
    }

    if (index === normalized.length) {
      return { score: 0, parts: [] };
    }

    if (depth >= MAX_SEGMENT_PARTS) {
      return null;
    }

    let best = null;

    for (let end = index + 1; end <= Math.min(normalized.length, index + 20); end += 1) {
      const part = normalized.slice(index, end);
      if (part.length < 2 && !SINGLE_LETTER_SEGMENTS.has(part)) continue;
      if (!isSegmentWord(part, context)) continue;

      const next = search(end, part, depth + 1);
      if (!next) continue;

      const score =
        Math.log(getWordScore(part, context) + 1) +
        (previousPart ? getBigramScore(previousPart, part, context) : 0) +
        next.score;

      if (!best || score > best.score) {
        best = {
          score,
          parts: [part, ...next.parts],
        };
      }
    }

    memo.set(key, best);
    return best;
  }

  const best = search(0, "", 0);
  if (!best || best.parts.length < 2) {
    return null;
  }

  const hasSingleLetterPart = best.parts.some((part) => SINGLE_LETTER_SEGMENTS.has(part));
  if (hasSingleLetterPart) {
    if (value === value.toLowerCase()) {
      return null;
    }

    if (
      best.parts.length !== 2 ||
      (!SINGLE_LETTER_SEGMENTS.has(best.parts[0]) &&
        !SINGLE_LETTER_SEGMENTS.has(best.parts[best.parts.length - 1]))
    ) {
      return null;
    }
  }

  if (!hasSingleLetterPart && best.parts.length !== 2) {
    return null;
  }

  if (normalized.length < 12 && !hasSingleLetterPart) {
    return null;
  }

  const hasStrongBigram = best.parts.some((part, index) => {
    if (index === 0) return false;
    return getBigramScore(best.parts[index - 1], part, context) > 0;
  });

  if (!hasStrongBigram) {
    return null;
  }

  return {
    replacement: restoreSegmentCase(value, best.parts),
    confidence: "high",
  };
}

function resolveSplitWord(left, right, context) {
  const leftNormalized = String(left || "").toLowerCase();
  const rightNormalized = String(right || "").toLowerCase();
  const combined = `${leftNormalized}${rightNormalized}`;
  const combinedScore = getLexicalSupportScore(combined, context);
  const bigramScore = getBigramScore(leftNormalized, rightNormalized, context);
  const leftKnown = isKnownWord(leftNormalized, context);
  const rightKnown = isKnownWord(rightNormalized, context);
  const protectedOpenCompound = context.protectedMergeWords?.has(
    normalizeProtectionKey(`${leftNormalized} ${rightNormalized}`)
  );

  if (!combinedScore || protectedOpenCompound || bigramScore > combinedScore) {
    return null;
  }

  if (!leftKnown || !rightKnown) {
    return {
      replacement: preserveCase(left, combined),
      confidence: "high",
    };
  }

  return null;
}

function mergeSplitWords(text, context, changes, reviews, options = {}) {
  const tokens = [];
  const wordRegex = /\b\p{L}{2,}\b/gu;
  let match;

  while ((match = wordRegex.exec(text)) !== null) {
    tokens.push({
      value: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  if (tokens.length < 2) {
    return text;
  }

  const replacements = [];

  for (let index = 0; index < tokens.length - 1; index += 1) {
    const left = tokens[index];
    const right = tokens[index + 1];
    const separator = text.slice(left.end, right.start);
    if (!/^ +$/.test(separator)) {
      continue;
    }

    const resolution = resolveSplitWord(left.value, right.value, context);
    if (!resolution) {
      continue;
    }

    replacements.push({
      start: left.start,
      end: right.end,
      original: text.slice(left.start, right.end),
      replacement: resolution.replacement,
      confidence: resolution.confidence,
    });
    index += 1;
  }

  if (!replacements.length) {
    return text;
  }

  let updated = text;

  replacements
    .slice()
    .reverse()
    .forEach((replacement) => {
      const excerpt = excerptForText(updated, replacement.start, replacement.original.length);
      const decision = resolveChangeDecision({
        category: "hyphenation",
        type: "split-word-merge",
        original: replacement.original,
        replacement: replacement.replacement,
        confidence: replacement.confidence,
        excerpt,
      }, reviews, options);

      if (!decision.apply) {
        return;
      }

      recordReplacement({
        list: changes,
        category: "hyphenation",
        type: "split-word-merge",
        original: replacement.original,
        replacement: replacement.replacement,
        confidence: decision.confidence || replacement.confidence,
        excerpt,
        evidence: decision.evidence,
        decisionReason: decision.reason,
      });

      updated =
        updated.slice(0, replacement.start) +
        (decision.replacement || replacement.replacement) +
        updated.slice(replacement.end);
    });

  return updated;
}

function resolveBrokenHyphenation(left, whitespace, right, context) {
  const leftNormalized = String(left || "").toLowerCase();
  const rightNormalized = String(right || "").toLowerCase();
  const combined = `${leftNormalized}${rightNormalized}`;
  const hyphenated = `${leftNormalized}-${rightNormalized}`;
  const combinedScore = getLexicalSupportScore(combined, context);
  const hyphenScore = getHyphenScore(hyphenated, context);
  const leftKnown = isKnownWord(leftNormalized, context);
  const rightKnown = isKnownWord(rightNormalized, context);
  const hadLineBreak = /[\r\n]/.test(whitespace);

  if (COORDINATED_HYPHEN_RIGHT_WORDS.has(rightNormalized)) {
    return { ignore: true };
  }

  if (looksLikeProtectedHyphenatedName(left, right, context)) {
    return { ignore: true };
  }

  if (KNOWN_HYPHENATED_WORDS.has(hyphenated) || hyphenScore > combinedScore) {
    return {
      replacement: `${left}-${right}`,
      confidence: "high",
    };
  }

  if (combinedScore && (!leftKnown || !rightKnown || combinedScore >= hyphenScore)) {
    return {
      replacement: preserveCase(left, combined),
      confidence: leftKnown && rightKnown ? "medium" : "high",
    };
  }

  if (
    HYPHEN_PREFERRED_LEFT.has(leftNormalized) ||
    HYPHEN_PREFERRED_RIGHT.has(rightNormalized)
  ) {
    return {
      replacement: `${left}-${right}`,
      confidence: "medium",
    };
  }

  if (!leftKnown || !rightKnown || JOIN_SUFFIXES.some((suffix) => rightNormalized.startsWith(suffix))) {
    return {
      replacement: preserveCase(left, combined),
      confidence: hadLineBreak ? "medium" : "low",
    };
  }

  return null;
}

function shouldSplitCamelCase(left, right, context) {
  const leftNormalized = String(left || "").toLowerCase();
  const rightNormalized = String(right || "").toLowerCase();
  const combinedKey = normalizeProtectionKey(`${leftNormalized}${rightNormalized}`);

  if (!leftNormalized || !rightNormalized) {
    return false;
  }

  if (
    PROTECTED_NAME_PARTICLES.has(leftNormalized) ||
    context.protectedSplitWords?.has(combinedKey) ||
    hasProtectedSurfaceForm(combinedKey, context)
  ) {
    return false;
  }

  return (
    (isKnownWord(leftNormalized, context) || getLexicalSupportScore(leftNormalized, context) > 0) &&
    (isKnownWord(rightNormalized, context) || getLexicalSupportScore(rightNormalized, context) > 0)
  );
}

function stripDiacritics(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "");
}

function suggestAccentVariant(token, context) {
  const value = String(token || "");
  if (!/[\u00C0-\u024F]/u.test(value)) {
    return null;
  }

  const stripped = stripDiacritics(value);
  const normalized = stripped.toLowerCase();
  if (!normalized || normalized === value.toLowerCase()) {
    return null;
  }

  if (getWordScore(normalized, context) === 0) {
    return null;
  }

  return {
    replacement: preserveCase(value, stripped),
    confidence: "low",
  };
}

function recordReplacement({
  list,
  category,
  type,
  original,
  replacement,
  confidence,
  excerpt,
  evidence,
  decisionReason,
}) {
  if (!original || original === replacement) {
    return;
  }

  pushUnique(list, {
    category,
    type,
    original,
    replacement,
    confidence,
    excerpt,
    ...(evidence?.length ? { evidence } : {}),
    ...(decisionReason ? { decisionReason } : {}),
  });
}

function recordReview(list, review) {
  if (!review || !review.snippet) return;
  if (
    list.some((entry) => entry.type === review.type && entry.snippet === review.snippet)
  ) {
    return;
  }

  list.push(review);
}

function resolveChangeDecision(change, reviews, options = {}) {
  if (typeof options.changeDecider !== "function") {
    return { apply: true, ...change };
  }

  let decision;
  try {
    decision = options.changeDecider(change) || {};
  } catch (error) {
    decision = {};
  }

  if (decision.apply === false && decision.suppress !== true) {
    recordReview(reviews, {
      category: change.category,
      type: `${change.type}-manual-review`,
      confidence: "low",
      snippet: change.original,
      excerpt: change.excerpt,
      ...(decision.reason ? { reason: decision.reason } : {}),
      ...(decision.evidence?.length ? { evidence: decision.evidence } : {}),
    });
  }

  return {
    apply: decision.apply !== false,
    confidence: decision.confidence || change.confidence,
    replacement: decision.replacement || change.replacement,
    reason: decision.reason || "",
    evidence: decision.evidence || [],
    suppress: decision.suppress === true,
  };
}

function applyGlobalHtmlCleanup(html) {
  let content = String(html || "");
  const changes = [];

  content = content.replace(NBSP_ENTITY_REGEX, (match, entity, offset) => {
    recordReplacement({
      list: changes,
      category: "special-character",
      type: "html-entity",
      original: match,
      replacement: " ",
      confidence: "high",
      excerpt: excerptForText(content, offset, match.length),
    });
    return " ";
  });

  MOJIBAKE_REPLACEMENTS.forEach(([pattern, replacement]) => {
    content = content.replace(pattern, (match, offset) => {
      recordReplacement({
        list: changes,
        category: "special-character",
        type: "encoding-artifact",
        original: match,
        replacement,
        confidence: "high",
        excerpt: excerptForText(content, offset, match.length),
      });
      return replacement;
    });
  });

  content = content.replace(REPLACEMENT_CHAR_REGEX, (match, offset) => {
    recordReplacement({
      list: changes,
      category: "special-character",
      type: "replacement-character",
      original: match,
      replacement: "",
      confidence: "high",
      excerpt: excerptForText(content, offset, match.length),
    });
    return "";
  });

  content = content.replace(CONTROL_CHAR_REGEX, (match, offset) => {
    recordReplacement({
      list: changes,
      category: "special-character",
      type: "control-character",
      original: match,
      replacement: "",
      confidence: "high",
      excerpt: excerptForText(content, offset, 1),
    });
    return "";
  });

  content = content.replace(INVALID_ENTITY_REGEX, (match, offset) => {
    recordReplacement({
      list: changes,
      category: "special-character",
      type: "invalid-entity",
      original: match,
      replacement: "&amp;",
      confidence: "high",
      excerpt: excerptForText(content, offset, match.length),
    });
    return "&amp;";
  });

  return { content, changes };
}

function applyExplicitReplacements(text, replacements, changes) {
  let content = String(text || "");
  if (!replacements || !replacements.size) {
    return content;
  }

  Array.from(replacements.entries())
    .sort((left, right) => right[0].length - left[0].length)
    .forEach(([from, to]) => {
      const pattern = new RegExp(escapeRegex(from), "g");
      content = content.replace(pattern, (match, offset) => {
        recordReplacement({
          list: changes,
          category: "missing-incorrect",
          type: "explicit-replacement",
          original: match,
          replacement: to,
          confidence: "high",
          excerpt: excerptForText(content, offset, match.length),
        });
        return to;
      });
    });

  return content;
}

function applyPlaceholderCleanup(text, changes) {
  let content = String(text || "");
  const cleanupRules = [
    /\b(?:todo|fixme|tbd|placeholder)\b[:\-]?\s*/gi,
    /\b(?:dummy text|insert text|lorem ipsum)\b[:\-]?\s*/gi,
    /(\?{2,}|\[\?+\]|_{3,}|\bX{3,}\b)/g,
  ];

  cleanupRules.forEach((regex) => {
    content = content.replace(regex, (match, offset) => {
      recordReplacement({
        list: changes,
        category: "missing-incorrect",
        type: "placeholder-cleanup",
        original: match,
        replacement: "",
        confidence: "high",
        excerpt: excerptForText(content, offset, match.length),
      });
      return "";
    });
  });

  return content;
}

function normalizeTextSegment(segment, context, options = {}) {
  const originalSegment = String(segment || "");
  if (!originalSegment) {
    return { text: originalSegment, changes: [], reviews: [] };
  }

  let text = decodeHtmlEntities(originalSegment);
  const changes = [];
  const reviews = [];

  text = applyExplicitReplacements(text, options.explicitReplacements, changes);

  MOJIBAKE_REPLACEMENTS.forEach(([pattern, replacement]) => {
    text = text.replace(pattern, (match, offset) => {
      recordReplacement({
        list: changes,
        category: "special-character",
        type: "encoding-artifact",
        original: match,
        replacement,
        confidence: "high",
        excerpt: excerptForText(text, offset, match.length),
      });
      return replacement;
    });
  });

  text = text.replace(REPLACEMENT_CHAR_REGEX, (match, offset) => {
    recordReplacement({
      list: changes,
      category: "special-character",
      type: "replacement-character",
      original: match,
      replacement: "",
      confidence: "high",
      excerpt: excerptForText(text, offset, match.length),
    });
    return "";
  });

  if (options.applyPlaceholderFixes) {
    text = applyPlaceholderCleanup(text, changes);
  }

  PLACEHOLDER_PATTERNS.forEach((pattern) => {
    const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    let match;
    while ((match = regex.exec(text)) !== null) {
      recordReview(reviews, {
        category: "missing-incorrect",
        type: "placeholder-or-uncertain-copy",
        confidence: "low",
        snippet: match[0],
        excerpt: excerptForText(text, match.index, match[0].length),
      });
    }
  });

  text = text.replace(/\S*\u00C3\S*/g, (match, offset) => {
    const repaired = repairLatin1MojibakeToken(match);
    if (!repaired || repaired === match) {
      return match;
    }

    recordReplacement({
      list: changes,
      category: "special-character",
      type: "encoding-artifact",
      original: match,
      replacement: repaired,
      confidence: "high",
      excerpt: excerptForText(text, offset, match.length),
    });
    return repaired;
  });

  text = text.replace(/[\u00A0\u2007\u202F]/g, (match, offset) => {
    recordReplacement({
      list: changes,
      category: "special-character",
      type: "unicode-normalization",
      original: match,
      replacement: " ",
      confidence: "high",
      excerpt: excerptForText(text, offset, match.length),
    });
    return " ";
  });

  text = text.replace(BROKEN_HYPHEN_REGEX, (match, left, whitespace, right, offset) => {
    const resolution = resolveBrokenHyphenation(left, whitespace, right, context);
    if (resolution?.ignore) {
      return match;
    }

    if (!resolution) {
      recordReview(reviews, {
        category: "hyphenation",
        type: "line-break-hyphenation",
        confidence: "low",
        snippet: match,
        excerpt: excerptForText(text, offset, match.length),
      });
      return match;
    }

    recordReplacement({
      list: changes,
      category: "hyphenation",
      type: "line-break-hyphenation",
      original: match,
      replacement: resolution.replacement,
      confidence: resolution.confidence,
      excerpt: excerptForText(text, offset, match.length),
    });
    return resolution.replacement;
  });

  text = text.replace(INLINE_HYPHEN_REGEX, (match, left, right, offset) => {
    const resolution = resolveBrokenHyphenation(left, "", right, context);
    if (!resolution || resolution.ignore || resolution.replacement === match) {
      return match;
    }

    const candidateChange = {
      category: "hyphenation",
      type: "inline-hyphenation",
      original: match,
      replacement: resolution.replacement,
      confidence: resolution.confidence,
      excerpt: excerptForText(text, offset, match.length),
    };
    const decision = resolveChangeDecision(candidateChange, reviews, options);
    if (!decision.apply) {
      return match;
    }

    recordReplacement({
      list: changes,
      category: "hyphenation",
      type: "inline-hyphenation",
      original: match,
      replacement: decision.replacement || resolution.replacement,
      confidence: decision.confidence || resolution.confidence,
      excerpt: candidateChange.excerpt,
      evidence: decision.evidence,
      decisionReason: decision.reason,
    });
    return decision.replacement || resolution.replacement;
  });

  text = mergeSplitWords(text, context, changes, reviews, options);

  text = text.replace(PUNCTUATION_SPACE_REGEX, (match, left, punctuation, right, offset) => {
    const replacement = `${left}${punctuation} ${right}`;
    recordReplacement({
      list: changes,
      category: "hyphenation",
      type: "missing-space-after-punctuation",
      original: match,
      replacement,
      confidence: "high",
      excerpt: excerptForText(text, offset, match.length),
    });
    return replacement;
  });

  text = text.replace(PERIOD_SPACE_REGEX, (match, left, right, offset) => {
    const replacement = `${left}. ${right}`;
    recordReplacement({
      list: changes,
      category: "hyphenation",
      type: "missing-space-after-period",
      original: match,
      replacement,
      confidence: "high",
      excerpt: excerptForText(text, offset, match.length),
    });
    return replacement;
  });

  text = text.replace(TITLE_SPACING_REGEX, (match, title, name, offset) => {
    const replacement = `${title} ${name}`;
    const candidateChange = {
      category: "hyphenation",
      type: "title-spacing",
      original: match,
      replacement,
      confidence: "high",
      excerpt: excerptForText(text, offset, match.length),
    };
    const decision = resolveChangeDecision(candidateChange, reviews, options);
    if (!decision.apply) {
      return match;
    }

    recordReplacement({
      list: changes,
      category: "hyphenation",
      type: "title-spacing",
      original: match,
      replacement: decision.replacement || replacement,
      confidence: decision.confidence || "high",
      excerpt: candidateChange.excerpt,
      evidence: decision.evidence,
      decisionReason: decision.reason,
    });
    return decision.replacement || replacement;
  });

  text = text.replace(CAMELCASE_SPACING_REGEX, (match, left, right, offset) => {
    if (!shouldSplitCamelCase(left, right, context)) {
      return match;
    }

    const replacement = `${left} ${right}`;
    const candidateChange = {
      category: "hyphenation",
      type: "camelcase-spacing",
      original: match,
      replacement,
      confidence: "medium",
      excerpt: excerptForText(text, offset, match.length),
    };
    const decision = resolveChangeDecision(candidateChange, reviews, options);
    if (!decision.apply) {
      return match;
    }

    recordReplacement({
      list: changes,
      category: "hyphenation",
      type: "camelcase-spacing",
      original: match,
      replacement: decision.replacement || replacement,
      confidence: decision.confidence || "medium",
      excerpt: candidateChange.excerpt,
      evidence: decision.evidence,
      decisionReason: decision.reason,
    });
    return decision.replacement || replacement;
  });

  text = text.replace(TOKEN_REGEX, (match, offset) => {
    const collapsed = collapseRepeatedSequenceToken(match);
    if (collapsed) {
      const resolution = correctRepeatedSequenceToken(match, context);
      const excerpt = excerptForText(text, offset, match.length);
      if (resolution) {
        const replacement = preserveCase(match, resolution.replacement);
        const candidateChange = {
          category: "missing-incorrect",
          type: "repeated-sequence-correction",
          original: match,
          replacement,
          confidence: resolution.confidence,
          excerpt,
        };
        const decision = resolveChangeDecision(candidateChange, reviews, options);
        if (decision.apply) {
          recordReplacement({
            list: changes,
            category: "missing-incorrect",
            type: "repeated-sequence-correction",
            original: match,
            replacement: decision.replacement || replacement,
            confidence: decision.confidence || resolution.confidence,
            excerpt,
            evidence: decision.evidence,
            decisionReason: decision.reason,
          });
          return decision.replacement || replacement;
        }
      }

      recordReview(reviews, {
        category: "missing-incorrect",
        type: "repeated-sequence-corruption",
        confidence: "low",
        snippet: match,
        excerpt,
      });
      return match;
    }

    if (/\d/.test(match)) {
      if (!CONSERVATIVE_OCR_TOKEN_REGEX.test(match)) {
        return match;
      }

      const resolution = correctOcrToken(match, context);
      if (!resolution) {
        recordReview(reviews, {
          category: "missing-incorrect",
          type: "ocr-like-token",
          confidence: "low",
          snippet: match,
          excerpt: excerptForText(text, offset, match.length),
        });
        return match;
      }

      const candidateChange = {
        category: "missing-incorrect",
        type: "ocr-like-token",
        original: match,
        replacement: resolution.replacement,
        confidence: resolution.confidence,
        excerpt: excerptForText(text, offset, match.length),
      };
      const decision = resolveChangeDecision(candidateChange, reviews, options);
      if (!decision.apply) {
        return match;
      }

      recordReplacement({
        list: changes,
        category: "missing-incorrect",
        type: "ocr-like-token",
        original: match,
        replacement: decision.replacement || resolution.replacement,
        confidence: decision.confidence || resolution.confidence,
        excerpt: candidateChange.excerpt,
        evidence: decision.evidence,
        decisionReason: decision.reason,
      });
      return decision.replacement || resolution.replacement;
    }

    const segmentation = segmentMergedWord(match, context);
    if (segmentation) {
      const adjacentWords = getAdjacentWords(text, offset, match.length);
      const originalScore = getContextualPhraseScore(
        match,
        adjacentWords.previous,
        adjacentWords.next,
        context
      );
      const replacementScore = getContextualPhraseScore(
        segmentation.replacement,
        adjacentWords.previous,
        adjacentWords.next,
        context
      );
      if (replacementScore <= originalScore) {
        return match;
      }

      const candidateChange = {
        category: "hyphenation",
        type: "merged-word-split",
        original: match,
        replacement: segmentation.replacement,
        confidence: segmentation.confidence,
        excerpt: excerptForText(text, offset, match.length),
      };
      const decision = resolveChangeDecision(candidateChange, reviews, options);
      if (!decision.apply) {
        return match;
      }

      recordReplacement({
        list: changes,
        category: "hyphenation",
        type: "merged-word-split",
        original: match,
        replacement: decision.replacement || segmentation.replacement,
        confidence: decision.confidence || segmentation.confidence,
        excerpt: candidateChange.excerpt,
        evidence: decision.evidence,
        decisionReason: decision.reason,
      });
      return decision.replacement || segmentation.replacement;
    }

    const spelling = spellCorrectWord(match, context);
    if (!spelling) {
      return match;
    }

    const candidateChange = {
      category: "missing-incorrect",
      type: "spelling-correction",
      original: match,
      replacement: spelling.replacement,
      confidence: spelling.confidence,
      excerpt: excerptForText(text, offset, match.length),
    };
    const adjacentWords = getAdjacentWords(text, offset, match.length);
    if (
      violatesInflectionContext(
        match,
        spelling.replacement,
        adjacentWords.previous
      )
    ) {
      return match;
    }
    const originalScore = getContextualTokenScore(
      match,
      adjacentWords.previous,
      adjacentWords.next,
      context
    );
    const replacementScore = getContextualTokenScore(
      spelling.replacement,
      adjacentWords.previous,
      adjacentWords.next,
      context
    );
    if (replacementScore <= originalScore) {
      return match;
    }

    const decision = resolveChangeDecision(candidateChange, reviews, options);
    if (!decision.apply) {
      return match;
    }

    recordReplacement({
      list: changes,
      category: "missing-incorrect",
      type: "spelling-correction",
      original: match,
      replacement: decision.replacement || spelling.replacement,
      confidence: decision.confidence || spelling.confidence,
      excerpt: candidateChange.excerpt,
      evidence: decision.evidence,
      decisionReason: decision.reason,
    });
    return decision.replacement || spelling.replacement;
  });

  text = text.replace(SYMBOL_CORRUPTION_REGEX, (match, offset) => {
    const resolution = correctSymbolCorruptionToken(match, context);
    if (!resolution) {
      recordReview(reviews, {
        category: "special-character",
        type: "symbol-corruption",
        confidence: "low",
        snippet: match,
        excerpt: excerptForText(text, offset, match.length),
      });
      return match;
    }

    const candidateChange = {
      category: "special-character",
      type: "symbol-corruption",
      original: match,
      replacement: resolution.replacement,
      confidence: resolution.confidence,
      excerpt: excerptForText(text, offset, match.length),
    };
    const decision = resolveChangeDecision(candidateChange, reviews, options);
    if (!decision.apply) {
      return match;
    }

    recordReplacement({
      list: changes,
      category: "special-character",
      type: "symbol-corruption",
      original: match,
      replacement: decision.replacement || resolution.replacement,
      confidence: decision.confidence || resolution.confidence,
      excerpt: candidateChange.excerpt,
      evidence: decision.evidence,
      decisionReason: decision.reason,
    });
    return decision.replacement || resolution.replacement;
  });

  GRAMMAR_REPLACEMENTS.forEach(({ regex, replacement, blockedPreviousWords }) => {
    text = text.replace(regex, (match, subject, offset) => {
      const previousWord = (
        String(text || "")
          .slice(0, Math.max(0, offset))
          .match(/\b[\p{L}']+\b/gu) || []
      )
        .slice(-1)[0]
        ?.toLowerCase() || "";
      if (blockedPreviousWords?.has(previousWord)) {
        return match;
      }

      const fixed = replacement(subject);
      const candidateChange = {
        category: "missing-incorrect",
        type: "grammar-correction",
        original: match,
        replacement: fixed,
        confidence: "medium",
        excerpt: excerptForText(text, offset, match.length),
      };
      const decision = resolveChangeDecision(candidateChange, reviews, options);
      if (!decision.apply) {
        return match;
      }

      recordReplacement({
        list: changes,
        category: "missing-incorrect",
        type: "grammar-correction",
        original: match,
        replacement: decision.replacement || fixed,
        confidence: decision.confidence || "medium",
        excerpt: candidateChange.excerpt,
        evidence: decision.evidence,
        decisionReason: decision.reason,
      });
      return preserveCase(match, decision.replacement || fixed);
    });
  });

  text = text.replace(/(\d+)\s*\u20B9/g, (match, amount, offset) => {
    const replacement = `\u20B9${amount}`;
    recordReplacement({
      list: changes,
      category: "special-character",
      type: "currency-order",
      original: match,
      replacement,
      confidence: "high",
      excerpt: excerptForText(text, offset, match.length),
    });
    return replacement;
  });

  text = text.replace(DOUBLE_SPACE_REGEX, (match, left, right, offset) => {
    const replacement = `${left} ${right}`;
    recordReplacement({
      list: changes,
      category: "hyphenation",
      type: "collapsed-whitespace",
      original: match,
      replacement,
      confidence: "high",
      excerpt: excerptForText(text, offset, match.length),
    });
    return replacement;
  });

  let accentMatch;
  const accentRegex = new RegExp(WORD_REGEX.source, WORD_REGEX.flags);
  while ((accentMatch = accentRegex.exec(text)) !== null) {
    const token = accentMatch[0];
    if (!/[\u00C0-\u024F]/u.test(token)) {
      continue;
    }

    const resolution = suggestAccentVariant(token, context);
    if (!resolution) {
      continue;
    }

    recordReview(reviews, {
      category: "missing-incorrect",
      type: "accent-variant",
      confidence: resolution.confidence,
      snippet: token,
      replacement: resolution.replacement,
      excerpt: excerptForText(text, accentMatch.index, token.length),
    });
  }

  const normalizedText = text.normalize("NFC");
  if (normalizedText !== text) {
    recordReplacement({
      list: changes,
      category: "special-character",
      type: "unicode-normalization",
      original: text,
      replacement: normalizedText,
      confidence: "high",
      excerpt: excerptForText(text, 0, Math.min(text.length, 80)),
    });
  }

  return {
    text: normalizedText,
    changes,
    reviews,
  };
}

function updateSkipState(token, state) {
  const openMatch = token.match(/^<\s*([a-zA-Z][\w:-]*)\b[^>]*?>$/);
  const closeMatch = token.match(/^<\s*\/\s*([a-zA-Z][\w:-]*)\b[^>]*>$/);
  const selfClosing = /\/\s*>$/.test(token);
  const skipTags = new Set(["code", "pre", "script", "style", "textarea"]);

  if (closeMatch) {
    const tag = closeMatch[1].toLowerCase();
    if (state[state.length - 1] === tag) {
      state.pop();
    }
    return;
  }

  if (openMatch && !selfClosing) {
    const tag = openMatch[1].toLowerCase();
    if (skipTags.has(tag)) {
      state.push(tag);
    }
  }
}

function normalizeHtmlDocument(html, context, options = {}) {
  const { content: cleanedHtml, changes: globalChanges } = applyGlobalHtmlCleanup(html);
  const parts = cleanedHtml.split(/(<[^>]+>)/g);
  const skipState = [];
  const changes = [...globalChanges];
  const reviews = [];

  const normalizedParts = parts.map((part) => {
    if (!part) {
      return part;
    }

    if (part.startsWith("<")) {
      updateSkipState(part, skipState);
      return part;
    }

    if (skipState.length) {
      return part;
    }

    const result = normalizeTextSegment(part, context, options);
    result.changes.forEach((change) => pushUnique(changes, change));
    result.reviews.forEach((review) => recordReview(reviews, review));
    return encodeXmlText(result.text);
  });

  return {
    content: normalizedParts.join(""),
    changes,
    reviews,
  };
}

module.exports = {
  buildTextNormalizationContext,
  buildTextNormalizationContextFromTexts,
  isKnownWord,
  normalizeHtmlDocument,
  normalizePlainText,
  normalizeTextSegment,
  resolveBrokenHyphenation,
  resolveContentDocuments,
  resolveSplitWord,
  segmentMergedWord,
  spellCorrectWord,
};
