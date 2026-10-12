function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  return value == null ? [] : [value];
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function pluralize(count, singular, plural = `${singular}s`) {
  return Number(count) === 1 ? singular : plural;
}

function basenameSafe(filePath) {
  const value = String(filePath || "").trim();
  if (!value) {
    return "";
  }

  return value.split(/[\\/]/).pop() || value;
}

function softenTechnicalTerms(value) {
  return cleanText(value)
    .replace(/\bEPUB\b/g, "book file")
    .replace(/\bOPF\b/g, "book metadata file")
    .replace(/\bXHTML\b/g, "book content file")
    .replace(/\bHTML\b/g, "content file")
    .replace(/\bCSS\b/g, "style sheet")
    .replace(/\bNCX\b/g, "navigation file")
    .replace(/\bSMIL\b/g, "read-aloud timing file")
    .replace(/\bChromium\b/g, "the browser tool used for screenshots");
}

function resolveSamples(result = {}) {
  return asArray(result?.details?.samples);
}

function resolveLocation(result = {}) {
  if (result?.location?.file) {
    return {
      file: result.location.file,
      line: result.location.line || "",
      page: result.location.page || "",
    };
  }

  const sample = resolveSamples(result).find((entry) => entry?.file || entry?.page);
  if (!sample) {
    return null;
  }

  return {
    file: sample.file || "",
    line: sample.line || "",
    page: sample.page || "",
  };
}

function formatLocationText(location = null) {
  if (!location) {
    return "";
  }

  const fileName = basenameSafe(location.file);
  if (fileName && location.line) {
    return `${fileName}, line ${location.line}`;
  }

  if (fileName && location.page) {
    return `${fileName}, page ${location.page}`;
  }

  if (fileName) {
    return fileName;
  }

  if (location.page) {
    return `Page ${location.page}`;
  }

  return "";
}

function humanizeTitle(result = {}) {
  const id = String(result.id || "");
  const title = cleanText(result.title || "");

  const explicitTitles = {
    S_MANIFEST_ITEMS_INVALID: "Some book package entries need review",
    S_OPF_PATH: "The main book metadata file was found",
    S_MIMETYPE: "The book package type looks correct",
    S_VERSION: "The book version looks correct",
    S_UNIQUE_ID: "The book has a valid unique identifier",
    SMIL_: "Read-aloud timing support may be missing",
    A_MANUAL: "A manual accessibility review is still needed",
    A_SCHEMA_ACCESSMODE_MISSING: "Accessibility metadata is incomplete",
    A_SCHEMA_ACCESSIBILITYFEATURE_MISSING: "Accessibility feature details are incomplete",
    A_SCHEMA_ACCESSIBILITYHAZARD_MISSING: "Accessibility hazard details are incomplete",
    T_MISSING_INCORRECT_TEXT: "Some text may need to be checked",
    T_HYPHENATION_WORD_MERGE: "Some word breaks or spacing may need review",
    T_SPECIAL_CHAR_ENTITY: "Some characters or symbols may not display correctly",
    L_CSS_SYNTAX: "Some stylesheet rules could not be read",
    L_CSS_INVALID_DECLARATION: "Some styling instructions may not work",
    L_CSS_CLASS_SELECTOR_MISSING: "Some page styling is missing",
    L_INLINE_STYLE_CONFLICT: "Some page styling may conflict",
    L_FONT_EMBED_REFERENCE: "A font reference may be missing or broken",
    L_TABLE_STYLING: "Some table styling may need attention",
    JS_SCRIPT_REFERENCE_BROKEN: "A script reference is broken",
    JS_SCRIPT_MANIFEST_MISSING_FILE: "A packaged script file is missing",
    JS_SCRIPT_REFERENCE_MISSING_MANIFEST: "A script may be missing from the book manifest",
    JS_SCRIPT_SYNTAX: "Some JavaScript could not be read",
    JS_INLINE_SCRIPT: "Inline script should be reviewed",
    JS_EVENT_HANDLER_ATTRIBUTE: "Inline script handlers should be reviewed",
    JS_UNSUPPORTED_API: "A script may use unsupported browser features",
    JS_REMOTE_SCRIPT_REFERENCE: "A script depends on a remote URL",
    JS_MODULE_SCRIPT: "A module script may not be portable",
    L_VISUAL_RENDER_UNAVAILABLE: "Visual preview could not be created",
    M_DUPLICATES: "Some metadata entries appear more than once",
    M_EPUB2_GUIDE: "An older navigation format is still present",
    M_PUBLISHER: "Publisher information should be reviewed",
    M_IDENTIFIER_FORMAT: "Book identification details should be reviewed",
    Media_IMAGE_LOW_RES: "Some images may look too small or blurry",
  };

  if (explicitTitles[id]) {
    return explicitTitles[id];
  }

  if (id.startsWith("A_")) {
    return "Some accessibility details should be reviewed";
  }

  if (id.startsWith("M_")) {
    return "Some book metadata should be reviewed";
  }

  if (id.startsWith("NAV_") || id.startsWith("NCX_")) {
    return "Book navigation should be reviewed";
  }

  if (id.startsWith("S_")) {
    return "Book structure should be reviewed";
  }

  if (id.startsWith("L_")) {
    return "Page appearance should be reviewed";
  }

  if (id.startsWith("JS_")) {
    return "Book scripting should be reviewed";
  }

  if (id.startsWith("T_")) {
    return "Text should be reviewed";
  }

  if (title) {
    return softenTechnicalTerms(title)
      .replace(/\bdetected\b/gi, "")
      .replace(/\bok\b/gi, "looks correct")
      .replace(/\s+/g, " ")
      .trim() || "Review needed";
  }

  return "Review needed";
}

function summarizeDetails(result = {}) {
  const details = result?.details;
  const status = String(result?.status || "").toLowerCase();
  const samples = resolveSamples(result);
  const count = Number(result?.details?.count) || samples.length;
  const files = asArray(result?.details?.files)
    .map((entry) => basenameSafe(entry))
    .filter(Boolean);
  const pages = asArray(result?.details?.pages).filter(Boolean);

  if (status === "pass") {
    if (typeof details === "string" && cleanText(details)) {
      return softenTechnicalTerms(details)
        .replace(/\bok\b/gi, "looks correct")
        .replace(/\s+/g, " ")
        .trim();
    }

    return "This check completed without any issues.";
  }

  if (samples.length) {
    const parts = [];
    if (count > 0) {
      parts.push(
        `We found ${count} ${pluralize(count, "place", "places")} that may need attention.`
      );
    }
    if (files.length) {
      parts.push(
        `The issue appears in ${files.length} ${pluralize(files.length, "file")}.`
      );
    } else if (pages.length) {
      parts.push(
        `The issue appears on ${pages.length} ${pluralize(pages.length, "page")}.`
      );
    }
    return parts.join(" ");
  }

  if (typeof details === "string" && cleanText(details)) {
    return softenTechnicalTerms(details)
      .replace(/\s+/g, " ")
      .trim();
  }

  if (count > 0) {
    return `We found ${count} ${pluralize(count, "item", "items")} that may need attention.`;
  }

  return "This item should be reviewed.";
}

function resolveSuggestion(result = {}) {
  return cleanText(result?.ai_suggestion || result?.suggestion || result?.fix_proposal || "");
}

function buildDeterministicSuggestion(rule = {}) {
  if (!rule || rule.status === "pass") {
    return "";
  }

  const suggestionsByRuleId = {
    M_IDENTIFIER_FORMAT:
      "Update the identifier to a valid format such as urn:isbn:9780451524935 or urn:uuid:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.",
    M_DUPLICATES:
      "Remove duplicate metadata entries so the same information is not repeated unnecessarily.",
    M_EPUB2_GUIDE:
      "Review whether the older guide markup is still needed, or keep only the modern navigation markup.",
    M_PUBLISHER: "Add a publisher entry in the book metadata file.",
    Media_IMAGE_LOW_RES: "Replace the image with a higher-resolution source file.",
    SMIL_: "Add the required read-aloud timing files, or remove the unsupported media-overlay requirement.",
    A_HTML_LANG_MISSING:
      'Add a language attribute to each content file, for example lang="en".',
    L_CSS_SYNTAX:
      "Fix the stylesheet syntax so the reading system can understand the affected styling rules.",
    L_CSS_INVALID_DECLARATION:
      "Correct the invalid style-sheet property or value so the styling can be read correctly.",
    L_CSS_CLASS_SELECTOR_MISSING:
      "Define the missing style-sheet class or update the content file to use an existing class.",
    L_INLINE_STYLE_CONFLICT:
      "Remove the conflicting inline styling or align it with the shared style sheet.",
    L_FONT_EMBED_REFERENCE:
      "Fix the font file path or embed the missing font file so the declared font can load.",
    L_TABLE_STYLING:
      "Normalize the table styling so borders, spacing, and alignment are clearly defined.",
    JS_SCRIPT_REFERENCE_BROKEN:
      "Fix the script src path so the content file points to a packaged JavaScript asset.",
    JS_SCRIPT_MANIFEST_MISSING_FILE:
      "Restore the missing JavaScript file or remove the stale manifest entry.",
    JS_SCRIPT_REFERENCE_MISSING_MANIFEST:
      "Declare the packaged JavaScript file in the OPF manifest so readers can discover it consistently.",
    JS_SCRIPT_SYNTAX:
      "Fix the JavaScript syntax so the packaged script can be parsed reliably.",
    JS_INLINE_SCRIPT:
      "Move inline JavaScript into a packaged script file when possible and validate it in target reading systems.",
    JS_EVENT_HANDLER_ATTRIBUTE:
      "Replace inline event handler attributes with packaged script listeners when possible.",
    JS_UNSUPPORTED_API:
      "Replace browser-specific APIs with EPUB-safe scripting patterns or keep the change in manual review.",
    JS_REMOTE_SCRIPT_REFERENCE:
      "Package the script inside the EPUB instead of loading it from a remote URL.",
    JS_MODULE_SCRIPT:
      "Prefer classic packaged scripts unless module support is confirmed for target reading systems.",
  };

  if (suggestionsByRuleId[rule.id]) {
    return suggestionsByRuleId[rule.id];
  }

  const title = String(rule.title || "").toLowerCase();
  const details =
    typeof rule.details === "string"
      ? rule.details.toLowerCase()
      : JSON.stringify(rule.details || {}).toLowerCase();

  if (title.includes("publisher")) {
    return "Add a publisher entry in the book metadata file.";
  }

  if (title.includes("identifier")) {
    return "Update the book identifier to a valid ISBN or UUID-based format.";
  }

  if (title.includes("lang attribute") || title.includes("language")) {
    return 'Add the correct language code, for example lang="en", in the affected file or metadata.';
  }

  if (title.includes("resolution") || details.includes('"width"') || details.includes('"height"')) {
    return "Replace the flagged media file with a version that meets the required dimensions or quality.";
  }

  if (String(rule.id || "").startsWith("NAV_")) {
    return "Update the table of contents so its links and reading order match the actual book content.";
  }

  if (String(rule.id || "").startsWith("NCX_")) {
    return "Update the navigation file so its entries and reading order match the book spine.";
  }

  if (String(rule.id || "").startsWith("S_SPINE")) {
    return "Update the book spine so the reading order is complete, unique, and correctly ordered.";
  }

  if (String(rule.id || "").startsWith("T_")) {
    return "Review the flagged text in the affected file and apply the needed wording corrections.";
  }

  if (title) {
    return `Fix ${softenTechnicalTerms(title).toLowerCase()} in the affected file.`;
  }

  return "Fix the flagged book issue in the affected file.";
}

function buildImpactMessage(rule = {}) {
  const status = String(rule.status || "").toLowerCase();
  const id = String(rule.id || "");

  if (status === "pass") {
    return "No reader-facing risk was found for this check.";
  }

  if (id.startsWith("T_")) {
    return "If this stays as-is, readers may see broken wording, missing text, or confusing copy.";
  }

  if (id.startsWith("L_")) {
    return "If this stays as-is, the book may look inconsistent or render badly in some reading apps.";
  }

  if (id.startsWith("JS_")) {
    return "If this stays as-is, scripted features may fail or behave inconsistently across reading apps.";
  }

  if (id.startsWith("A_") || id.startsWith("IMG_")) {
    return "If this stays as-is, some readers may have a harder time using the book with assistive technology.";
  }

  if (id.startsWith("M_")) {
    return "If this stays as-is, the book may be harder to catalog, search, or distribute correctly.";
  }

  if (id.startsWith("Media_") || id.startsWith("SMIL_")) {
    return "If this stays as-is, some media or read-aloud features may not work as expected.";
  }

  if (id.startsWith("NAV_") || id.startsWith("NCX_") || id.startsWith("S_")) {
    return "If this stays as-is, navigation, packaging, or reading order may break in some reading systems.";
  }

  if (status === "warn") {
    return "This may still be acceptable, but it should be reviewed before delivery.";
  }

  return "If this stays as-is, it may affect reading quality or release quality.";
}

function buildDeterministicIssueNarrative(rule = {}) {
  const suggestion = resolveSuggestion(rule) || buildDeterministicSuggestion(rule);

  return {
    headline: humanizeTitle(rule),
    summary: summarizeDetails(rule),
    impact: buildImpactMessage(rule),
    nextStep:
      suggestion ||
      (String(rule.status || "").toLowerCase() === "pass"
        ? "No action is needed for this check."
        : "Review the affected file and correct the flagged issue."),
    location: formatLocationText(resolveLocation(rule)),
    generatedBy: "deterministic",
  };
}

module.exports = {
  asArray,
  basenameSafe,
  buildDeterministicIssueNarrative,
  buildDeterministicSuggestion,
  cleanText,
  formatLocationText,
  humanizeTitle,
  pluralize,
  resolveLocation,
  resolveSamples,
  resolveSuggestion,
  softenTechnicalTerms,
  summarizeDetails,
};
