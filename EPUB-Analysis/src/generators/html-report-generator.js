const fs = require("fs");
const path = require("path");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  return value == null ? [] : [value];
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

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
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

function humanizeStatus(status) {
  switch (String(status || "").toLowerCase()) {
    case "fail":
      return "Needs attention";
    case "warn":
      return "Please review";
    case "pass":
      return "Looks good";
    case "resolved":
      return "Resolved";
    default:
      return "Review";
  }
}

function humanizeTitle(result = {}) {
  const id = String(result.id || "");
  const title = cleanText(result.title || "");

  const explicitTitles = {
    T_MISSING_INCORRECT_TEXT: "Some text may need to be checked",
    T_HYPHENATION_WORD_MERGE: "Some word breaks or spacing may need review",
    T_SPECIAL_CHAR_ENTITY: "Some characters or symbols may not display correctly",
    L_CSS_INVALID_DECLARATION: "Some styling instructions may not work",
    L_CSS_CLASS_SELECTOR_MISSING: "Some page styling is missing",
    L_INLINE_STYLE_CONFLICT: "Some page styling may conflict",
    L_FONT_EMBED_REFERENCE: "A font reference may be missing or broken",
    L_TABLE_STYLING: "Some table styling may need attention",
    L_VISUAL_RENDER_UNAVAILABLE: "Visual preview could not be created",
    M_PUBLISHER: "Publisher information should be reviewed",
    M_IDENTIFIER_FORMAT: "Book identification details should be reviewed",
  };

  if (explicitTitles[id]) {
    return explicitTitles[id];
  }

  if (id.startsWith("A_")) {
    return softenTechnicalTerms(title || "Accessibility review needed");
  }

  if (id.startsWith("M_")) {
    return softenTechnicalTerms(title || "Metadata review needed");
  }

  if (id.startsWith("NAV_") || id.startsWith("NCX_")) {
    return softenTechnicalTerms(title || "Navigation should be reviewed");
  }

  if (id.startsWith("S_")) {
    return softenTechnicalTerms(title || "Book structure should be reviewed");
  }

  if (id.startsWith("L_")) {
    return softenTechnicalTerms(title || "Page appearance should be reviewed");
  }

  return softenTechnicalTerms(title || "Review needed");
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
      return softenTechnicalTerms(details);
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
    return softenTechnicalTerms(details);
  }

  if (count > 0) {
    return `We found ${count} ${pluralize(count, "item", "items")} that may need attention.`;
  }

  return "This item should be reviewed.";
}

function describeSample(sample = {}) {
  const location = formatLocationText({
    file: sample.file,
    line: sample.line,
    page: sample.page,
  });
  const snippet = cleanText(sample.excerpt || sample.snippet || "");
  const suggested = cleanText(sample.suggested || sample.replacement || "");

  const parts = [];
  if (location) {
    parts.push(`In ${location}`);
  }

  if (snippet) {
    parts.push(`we saw: "${softenTechnicalTerms(snippet)}"`);
  } else {
    parts.push("we found an example that may need attention");
  }

  if (suggested) {
    parts.push(`Suggested wording or fix: "${softenTechnicalTerms(suggested)}"`);
  }

  return `${parts.join(". ")}.`;
}

function serializeSampleMeta(sample = {}) {
  return Object.entries(sample)
    .filter(([, value]) =>
      value !== undefined &&
      value !== null &&
      (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    )
    .map(([key, value]) => {
      const safeValue = cleanText(String(value).replace(/\s*\|\s*/g, " / "));
      return `${key}: ${safeValue}`;
    })
    .filter(Boolean)
    .join(" | ");
}

const DETAIL_FIELD_LABELS = {
  chapter: "File", file: "File", src: "Source", href: "Link",
  error: "Error", message: "Message", issue: "Issue", analysis: "Analysis",
  count: "Count", total: "Total",
  codec: "Codec", duration: "Duration (s)", channels: "Channels",
  bitrate: "Bitrate", resolution: "Resolution", audioTrack: "Audio Track",
  width: "Width (px)", height: "Height (px)",
  tag: "Element", selector: "CSS Selector", property: "CSS Property", value: "Value",
  viewport: "Viewport", scrollWidth: "Scroll Width", viewportWidth: "Viewport Width",
  compatibility: "Compatibility",
  replacement: "Suggested Fix", suggested: "Suggested Fix",
  context: "Context", snippet: "Snippet", excerpt: "Text",
};

const DETAIL_SKIP_KEYS = new Set(["samples", "files", "pages", "issues", "items"]);

function renderFlatDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return "";
  }

  const rows = Object.entries(details)
    .filter(([k, v]) =>
      !DETAIL_SKIP_KEYS.has(k) &&
      v !== null && v !== undefined && v !== "" && v !== false
    )
    .map(([k, v]) => {
      const label = DETAIL_FIELD_LABELS[k] ||
        k.replace(/([a-z])([A-Z])/g, "$1 $2")
         .replace(/_/g, " ")
         .replace(/^\w/, (c) => c.toUpperCase());

      let displayVal;
      if (Array.isArray(v)) {
        displayVal = v.slice(0, 5).map(String).join(", ") +
          (v.length > 5 ? ` (+${v.length - 5} more)` : "");
      } else if (typeof v === "object") {
        displayVal = JSON.stringify(v).slice(0, 300);
      } else {
        displayVal = softenTechnicalTerms(String(v)).slice(0, 300);
      }

      return displayVal.trim() ? { label, displayVal } : null;
    })
    .filter(Boolean);

  if (!rows.length) return "";

  return `<ul class="sample-list">${rows.map((r) =>
    `<li><strong>${escapeHtml(r.label)}:</strong> ${escapeHtml(r.displayVal)}</li>`
  ).join("")}</ul>`;
}

function renderExamples(result = {}) {
  const samples = resolveSamples(result);

  if (!samples.length) {
    // Fall back to flat details fields before showing "no details"
    const flatHtml = renderFlatDetails(result?.details);
    if (flatHtml) return flatHtml;
    return '<p class="muted">No details available for this item.</p>';
  }

  const totalCount = Number(result?.details?.count) || samples.length;
  const intro =
    totalCount > samples.length
      ? `<p class="muted">Showing ${samples.length} saved example ${pluralize(samples.length, "item")} out of ${totalCount} total.</p>`
      : "";

  return `
    ${intro}
    <ul class="sample-list">
      ${samples.map((sample) => {
        const meta = serializeSampleMeta(sample);
        return `<li>${escapeHtml(describeSample(sample))}${meta ? `<span class="sample-meta" hidden>${escapeHtml(meta)}</span>` : ""}</li>`;
      }).join("")}
    </ul>
  `;
}

function renderDetailBlock(label, content) {
  if (!content) {
    return "";
  }

  return `
    <div class="detail-block">
      <div class="detail-label">${escapeHtml(label)}</div>
      <div class="detail-value">${content}</div>
    </div>
  `;
}

function renderPlainTextBlock(label, value) {
  const text = cleanText(value);
  if (!text) {
    return "";
  }

  return renderDetailBlock(label, escapeHtml(softenTechnicalTerms(text)));
}

function resolveSuggestion(result = {}) {
  return cleanText(result?.ai_suggestion || result?.suggestion || result?.fix_proposal || "");
}

function resolveUserFriendly(result = {}) {
  return result?.user_friendly && typeof result.user_friendly === "object"
    ? result.user_friendly
    : {};
}

function resolveHeadline(result = {}) {
  const friendly = resolveUserFriendly(result);
  return cleanText(friendly.headline) || humanizeTitle(result);
}

function resolveSummary(result = {}) {
  const friendly = resolveUserFriendly(result);
  return (
    cleanText(result?.humanReadableDetails) ||
    cleanText(result?.humanReadableError) ||
    cleanText(friendly.summary) ||
    summarizeDetails(result)
  );
}

function resolveImpact(result = {}) {
  const friendly = resolveUserFriendly(result);
  return cleanText(friendly.impact || "");
}

function resolveNextStep(result = {}) {
  const friendly = resolveUserFriendly(result);
  return cleanText(friendly.nextStep) || resolveSuggestion(result);
}

function resolveReportMeta(result = {}) {
  return result?.report_meta && typeof result.report_meta === "object"
    ? result.report_meta
    : {};
}

function resolveLocationText(result = {}) {
  return (
    cleanText(result?.locationText) ||
    cleanText(resolveReportMeta(result).locationText) ||
    cleanText(resolveUserFriendly(result).location) ||
    formatLocationText(resolveLocation(result))
  );
}

function resolveIssueSize(result = {}) {
  return cleanText(result?.issueSize || resolveReportMeta(result).issueSize || "Small");
}

function resolveBreakageRisk(result = {}) {
  return cleanText(
    result?.breakageRisk || resolveReportMeta(result).breakageRisk || "Release quality risk"
  );
}

function resolveDomain(result = {}) {
  return cleanText(result?.domain || resolveReportMeta(result).domain || "General");
}

function resolveConfidenceText(result = {}) {
  const meta = resolveReportMeta(result);
  const score = Number(result?.confidenceScore ?? meta.confidenceScore);
  const label = cleanText(result?.confidenceLabel || meta.confidenceLabel || "");

  if (Number.isFinite(score) && label) {
    return `${label} (${score.toFixed(2)})`;
  }

  if (Number.isFinite(score)) {
    return score.toFixed(2);
  }

  return label;
}

function resolveHitlText(result = {}) {
  const meta = resolveReportMeta(result);
  return cleanText(
    result?.hitlAction || meta?.hitl?.action || "Human review required"
  );
}

function formatSummaryKey(key) {
  return String(key || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function renderValidatorSummary(summary = {}) {
  const entries = Object.entries(summary).filter(([, value]) => {
    if (value == null) {
      return false;
    }
    if (typeof value === "object") {
      return Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0;
    }
    return true;
  });

  if (!entries.length) {
    return "";
  }

  return `
    <ul class="sample-list">
      ${entries
        .map(([key, value]) => {
          const printable =
            typeof value === "object" ? JSON.stringify(value) : String(value);
          return `<li><strong>${escapeHtml(formatSummaryKey(key))}:</strong> ${escapeHtml(printable)}</li>`;
        })
        .join("")}
    </ul>
  `;
}

function resolveAgenticGrounding(result = {}) {
  const coverage = result?.agentic?.coverage;
  if (!coverage || typeof coverage !== "object") {
    return "";
  }

  const status = cleanText(coverage.status || "insufficient").toLowerCase();
  const kbCount = Number(coverage.kbResultCount || 0);
  const uploadCount = Number(coverage.uploadResultCount || 0);
  const missingCount = Array.isArray(coverage.missingSources)
    ? coverage.missingSources.length
    : 0;

  if (status === "grounded") {
    return `This issue was grounded with ${kbCount} knowledge-base match(es) and ${uploadCount} match(es) from the uploaded file.`;
  }

  if (status === "partial") {
    return `This issue found some supporting evidence, but ${missingCount} expected reference source(s) were still missing.`;
  }

  return "This issue did not find strong supporting evidence in the current retrieval set, so it should stay in human review.";
}

function renderAgenticSourceList(result = {}) {
  const sources = Array.isArray(result?.agentic?.sources) ? result.agentic.sources : [];
  if (!sources.length) {
    return "";
  }

  const titles = sources
    .slice(0, 4)
    .map((source) => cleanText(source.title || source.id || "reference source"))
    .filter(Boolean);

  if (!titles.length) {
    return "";
  }

  return `Reference sources checked: ${titles.join(", ")}.`;
}

function renderMetaPills(result = {}) {
  const parts = [
    `Domain: ${resolveDomain(result)}`,
    `Issue size: ${resolveIssueSize(result)}`,
    `Breakage risk: ${resolveBreakageRisk(result)}`,
  ];
  const confidenceText = resolveConfidenceText(result);
  const hitlText = resolveHitlText(result);
  if (confidenceText) {
    parts.push(`Confidence: ${confidenceText}`);
  }
  if (hitlText) {
    parts.push(`Decision: ${hitlText}`);
  }

  return `
    <div class="meta-pills">
      ${parts.map((part) => `<span class="meta-pill">${escapeHtml(part)}</span>`).join("")}
    </div>
  `;
}

function renderIssueCard(result = {}, options = {}) {
  const title = resolveHeadline(result);
  const summary = resolveSummary(result);
  const impact = resolveImpact(result);
  const suggestion = resolveNextStep(result);
  const locationText = resolveLocationText(result);
  const groundingText = cleanText(
    [resolveAgenticGrounding(result), renderAgenticSourceList(result)].filter(Boolean).join(" ")
  );
  const issueId =
    options.issueId ||
    `${slugify(result.id || title)}-${Number(options.index || 0) + 1}`;
  const shouldOpen = options.open === true;

  return `
    <details class="issue-card" id="${escapeHtml(issueId)}" ${shouldOpen ? "open" : ""}>
      <summary class="issue-header">
        <div class="headline-group">
          <h3>${escapeHtml(title)}</h3>
          ${result?.id ? `<div class="reference">Reference: ${escapeHtml(result.id)}</div>` : ""}
        </div>
        <span class="badge ${escapeHtml(result.status || "warn")}">${escapeHtml(humanizeStatus(result.status))}</span>
      </summary>

      <div class="issue-body">
        ${renderMetaPills(result)}
        <div class="detail-grid">
          ${renderPlainTextBlock("Summary", summary)}
          ${impact ? renderPlainTextBlock("Why this matters", impact) : ""}
          ${locationText ? renderPlainTextBlock("Where to look", locationText) : ""}
          ${groundingText ? renderPlainTextBlock("Evidence support", groundingText) : ""}
          ${renderDetailBlock("Examples", renderExamples(result))}
          ${suggestion ? renderPlainTextBlock("What to do next", suggestion) : ""}
        </div>
      </div>
    </details>
  `;
}

function renderSection(section = {}) {
  const title = section.title;
  const caption = section.caption;
  const results = asArray(section.results);
  const sectionId = section.id || slugify(title);
  if (!results.length) {
    return "";
  }

  return `
    <details class="report-section" id="${escapeHtml(sectionId)}" ${section.open === false ? "" : "open"}>
      <summary class="section-header">
        <div>
          <h2>${escapeHtml(title)}</h2>
          ${caption ? `<p>${escapeHtml(caption)}</p>` : ""}
        </div>
        <span class="section-count">${results.length}</span>
      </summary>
      <div class="issue-list">
        ${results
          .map((result, index) =>
            renderIssueCard(result, {
              index,
              issueId: `${sectionId}-${slugify(result.id || result.title || `issue-${index + 1}`)}`,
              open: false,
            })
          )
          .join("")}
      </div>
    </details>
  `;
}

function renderStatusDelta(pre = {}, post = null) {
  const postStatus = post?.status || "resolved";

  return `
    <div class="status-delta">
      <span class="badge ${escapeHtml(pre.status || "warn")}">${escapeHtml(humanizeStatus(pre.status))}</span>
      <span class="delta-arrow">to</span>
      <span class="badge ${escapeHtml(postStatus)}">${escapeHtml(humanizeStatus(postStatus))}</span>
    </div>
  `;
}

function renderComparisonCard(pre = {}, post = null, options = {}) {
  const preTitle = resolveHeadline(pre);
  const locationText =
    resolveLocationText(pre) || resolveLocationText(post || {});
  const preSummary = resolveSummary(pre);
  const preImpact = resolveImpact(pre);
  const postSummary =
    post?.status
      ? resolveSummary(post)
      : "This item did not appear again after the fix, so it is treated as resolved.";
  const postImpact = post?.status ? resolveImpact(post) : "";
  const preSuggestion = resolveNextStep(pre);
  const postSuggestion = resolveNextStep(post || {});
  const issueId =
    options.issueId ||
    `${slugify(pre.id || preTitle)}-${Number(options.index || 0) + 1}`;

  return `
    <details class="issue-card" id="${escapeHtml(issueId)}">
      <summary class="issue-header">
        <div class="headline-group">
          <h3>${escapeHtml(preTitle)}</h3>
          ${pre?.id ? `<div class="reference">Reference: ${escapeHtml(pre.id)}</div>` : ""}
        </div>
        ${renderStatusDelta(pre, post)}
      </summary>

      <div class="issue-body">
        ${renderMetaPills(pre)}
        ${locationText ? renderPlainTextBlock("Where to look", locationText) : ""}

        <div class="compare-grid">
          <div class="compare-panel pre">
            <h4>Before the fix</h4>
            <p class="panel-body">${escapeHtml(softenTechnicalTerms(preSummary))}</p>
            ${preImpact ? renderPlainTextBlock("Why it mattered", preImpact) : ""}
            ${renderDetailBlock("Saved examples", renderExamples(pre))}
            ${preSuggestion ? renderPlainTextBlock("Planned action", preSuggestion) : ""}
          </div>
          <div class="compare-panel post">
            <h4>After the fix</h4>
            <p class="panel-body">${escapeHtml(softenTechnicalTerms(postSummary))}</p>
            ${postImpact ? renderPlainTextBlock("Current impact", postImpact) : ""}
            ${post && resolveSamples(post).length ? renderDetailBlock("Saved examples", renderExamples(post)) : ""}
            ${postSuggestion ? renderPlainTextBlock("Follow-up action", postSuggestion) : ""}
          </div>
        </div>
      </div>
    </details>
  `;
}

function renderOverviewPanel(options = {}) {
  const validatorAgent = options.validatorAgent || null;
  const thresholds = options.thresholds || {};
  const thresholdText = [
    `Fail severity >= ${(Number(thresholds.failSeverityMin || 0) || 0).toFixed(2)}`,
    `Warning severity >= ${(Number(thresholds.warningSeverityMin || 0) || 0).toFixed(2)}`,
    `High confidence >= ${(Number(thresholds.highConfidenceMin || 0) || 0).toFixed(2)}`,
    `Auto-fix >= ${(Number(thresholds.autoFixConfidenceMin || 0) || 0).toFixed(2)}`,
  ].join(" | ");

  const recommendations = Array.isArray(validatorAgent?.recommendations)
    ? validatorAgent.recommendations
    : [];
  const nextActions = Array.isArray(validatorAgent?.nextActions)
    ? validatorAgent.nextActions
    : [];
  const summary = validatorAgent?.summary || {};
  const releaseReadiness = validatorAgent?.releaseReadiness || null;

  return `
    <section class="insight-grid">
      <div class="insight-card">
        <div class="insight-label">Release Readiness</div>
        <div class="insight-body">
          <strong>${escapeHtml(cleanText(releaseReadiness?.label || "Needs review"))}</strong>
          ${
            releaseReadiness?.summary
              ? `<p>${escapeHtml(cleanText(releaseReadiness.summary))}</p>`
              : ""
          }
        </div>
      </div>
      <div class="insight-card">
        <div class="insight-label">Threshold Policy</div>
        <div class="insight-body">${escapeHtml(thresholdText)}</div>
      </div>
      <div class="insight-card">
        <div class="insight-label">Validator Agent</div>
        <div class="insight-body">
          <strong>${escapeHtml(cleanText(validatorAgent?.status || "unknown").toUpperCase())}</strong>
          ${validatorAgent?.narrative ? `<p>${escapeHtml(validatorAgent.narrative)}</p>` : ""}
          ${renderValidatorSummary(summary)}
          ${
            nextActions.length
              ? `<div class="detail-label" style="margin-top:12px;">Recommended next actions</div>
                 <ul class="sample-list">${nextActions
                   .map((action) => `<li>${escapeHtml(action)}</li>`)
                   .join("")}</ul>`
              : ""
          }
          ${
            recommendations.length
              ? `<ul class="sample-list">${recommendations
                  .map((recommendation) => `<li>${escapeHtml(recommendation)}</li>`)
                  .join("")}</ul>`
              : ""
          }
        </div>
      </div>
    </section>
  `;
}

function buildNavigationOptions(sections = []) {
  const sectionOptions = sections
    .filter((section) => asArray(section.results).length)
    .map(
      (section) =>
        `<option value="${escapeHtml(section.id)}">${escapeHtml(section.title)}</option>`
    )
    .join("");

  const issueOptions = sections
    .filter((section) => asArray(section.results).length)
    .map((section) => {
      const options = asArray(section.results)
        .map((result, index) => {
          const issueId = `${section.id}-${slugify(result.id || result.title || `issue-${index + 1}`)}`;
          return `<option value="${escapeHtml(issueId)}">${escapeHtml(
            `${resolveHeadline(result)} (${humanizeStatus(result.status)})`
          )}</option>`;
        })
        .join("");

      return `<optgroup label="${escapeHtml(section.title)}">${options}</optgroup>`;
    })
    .join("");

  return `
    <section class="report-toolbar">
      <div class="toolbar-card">
        <label for="section-jump">Jump to section</label>
        <select id="section-jump" class="jump-select">
          <option value="">Choose a section</option>
          ${sectionOptions}
        </select>
      </div>
      <div class="toolbar-card">
        <label for="issue-jump">Jump to issue</label>
        <select id="issue-jump" class="jump-select">
          <option value="">Choose an issue</option>
          ${issueOptions}
        </select>
      </div>
    </section>
  `;
}

function renderShell({ title, subtitle, summaryCards, overviewHtml = "", sectionsHtml, sections = [] }) {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        --bg: #f5fbfb;
        --panel: #ffffff;
        --panel-alt: #f4fbfb;
        --text: #0d3f46;
        --muted: #5a7c80;
        --border: #c6dde0;
        --primary: #0f5c63;
        --accent: #197782;
        --danger-bg: #e8f5f6;
        --warn-bg: #eef9fa;
        --success-bg: #f3fbfb;
        --shadow: 0 18px 40px rgba(15, 92, 99, 0.10);
      }

      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 32px 24px 48px;
        background: linear-gradient(180deg, #ffffff 0%, #f3fbfb 100%);
        color: var(--text);
        font-family: "Segoe UI", Arial, sans-serif;
      }
      .page {
        max-width: 1180px;
        margin: 0 auto;
      }
      .hero {
        background: linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%);
        color: #ffffff;
        border-radius: 24px;
        padding: 30px 32px;
        box-shadow: var(--shadow);
        margin-bottom: 22px;
      }
      .hero h1 {
        margin: 0 0 8px;
        font-size: 34px;
        line-height: 1.15;
      }
      .hero p {
        margin: 0;
        font-size: 15px;
        line-height: 1.6;
        color: rgba(255, 255, 255, 0.92);
      }
      .summary {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 16px;
        margin: 24px 0 28px;
      }
      .report-toolbar {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 16px;
        margin: 0 0 28px;
      }
      .insight-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 16px;
        margin: 0 0 28px;
      }
      .insight-card {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 16px 18px;
        box-shadow: var(--shadow);
      }
      .insight-label {
        display: block;
        color: var(--muted);
        font-size: 12px;
        margin-bottom: 8px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .insight-body {
        font-size: 14px;
        line-height: 1.7;
      }
      .insight-body p {
        margin: 10px 0 0;
      }
      .toolbar-card {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 16px 18px;
        box-shadow: var(--shadow);
      }
      .toolbar-card label {
        display: block;
        color: var(--muted);
        font-size: 12px;
        margin-bottom: 8px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .jump-select {
        width: 100%;
        border-radius: 12px;
        border: 1px solid var(--border);
        padding: 10px 12px;
        color: var(--text);
        background: #ffffff;
        font-size: 14px;
      }
      .summary-card {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 20px 22px;
        box-shadow: var(--shadow);
      }
      .summary-card .label {
        display: block;
        color: var(--muted);
        font-size: 12px;
        margin-bottom: 8px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .summary-card .value {
        font-size: 30px;
        font-weight: 700;
        color: var(--primary);
      }
      .report-section {
        margin-bottom: 30px;
        background: transparent;
        border: none;
      }
      .section-header {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 14px;
        list-style: none;
        cursor: pointer;
      }
      .section-header::-webkit-details-marker,
      .issue-header::-webkit-details-marker {
        display: none;
      }
      .section-header h2 {
        margin: 0 0 4px;
        font-size: 24px;
        color: var(--primary);
      }
      .section-header p {
        margin: 0;
        color: var(--muted);
        font-size: 14px;
      }
      .section-count {
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 7px 14px;
        background: var(--panel);
        color: var(--primary);
        font-size: 13px;
        font-weight: 700;
      }
      .issue-list {
        display: grid;
        gap: 16px;
      }
      .issue-card {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 20px;
        box-shadow: var(--shadow);
        overflow: hidden;
      }
      .issue-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 18px;
        margin-bottom: 0;
        list-style: none;
        cursor: pointer;
        padding: 20px 22px;
      }
      .headline-group h3 {
        margin: 0;
        font-size: 22px;
        line-height: 1.3;
      }
      .reference {
        margin-top: 6px;
        color: var(--muted);
        font-size: 12px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 124px;
        padding: 9px 14px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 700;
        white-space: nowrap;
        color: var(--primary);
        background: var(--success-bg);
        border: 1px solid var(--border);
      }
      .badge.fail,
      .badge.warn,
      .badge.pass,
      .badge.resolved {
        color: var(--primary);
      }
      .badge.fail { background: var(--danger-bg); }
      .badge.warn { background: var(--warn-bg); }
      .badge.pass,
      .badge.resolved { background: var(--success-bg); }
      .issue-body {
        padding: 0 22px 20px;
      }
      .meta-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin: 0 0 16px;
      }
      .meta-pill {
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 7px 12px;
        background: var(--panel-alt);
        color: var(--primary);
        font-size: 12px;
        line-height: 1.3;
      }
      .detail-grid {
        display: grid;
        gap: 14px;
      }
      .detail-block {
        background: var(--panel-alt);
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 14px 16px;
      }
      .detail-label {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
        margin-bottom: 8px;
      }
      .detail-value {
        font-size: 14px;
        line-height: 1.65;
      }
      .sample-list {
        margin: 0;
        padding-left: 20px;
      }
      .sample-list li {
        margin-bottom: 8px;
      }
      .compare-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 16px;
        margin-top: 14px;
      }
      .compare-panel {
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 16px;
        background: var(--panel-alt);
      }
      .compare-panel h4 {
        margin: 0 0 10px;
        font-size: 16px;
        color: var(--primary);
      }
      .panel-body {
        margin: 0 0 12px;
        font-size: 14px;
        line-height: 1.65;
      }
      .status-delta {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }
      .delta-arrow {
        color: var(--muted);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .muted {
        color: var(--muted);
      }
      @media (max-width: 800px) {
        body { padding: 18px 14px 28px; }
        .hero { padding: 24px 20px; }
        .hero h1 { font-size: 28px; }
        .issue-header,
        .section-header {
          flex-direction: column;
          align-items: flex-start;
        }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <header class="hero">
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(subtitle)}</p>
      </header>
      <section class="summary">${summaryCards}</section>
      ${overviewHtml}
      ${buildNavigationOptions(sections)}
      ${sectionsHtml}
    </div>
    <script>
      (function () {
        function openParents(node) {
          let current = node;
          while (current) {
            if (current.tagName === "DETAILS") {
              current.open = true;
            }
            current = current.parentElement;
          }
        }

        function jumpTo(targetId) {
          if (!targetId) {
            return;
          }

          const target = document.getElementById(targetId);
          if (!target) {
            return;
          }

          openParents(target);
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }

        const sectionJump = document.getElementById("section-jump");
        const issueJump = document.getElementById("issue-jump");

        if (sectionJump) {
          sectionJump.addEventListener("change", function (event) {
            jumpTo(event.target.value);
          });
        }

        if (issueJump) {
          issueJump.addEventListener("change", function (event) {
            jumpTo(event.target.value);
          });
        }
      })();
    </script>
  </body>
  </html>
  `;
}

function buildSummaryCards(results = []) {
  const failures = results.filter((result) => result.status === "fail").length;
  const warnings = results.filter((result) => result.status === "warn").length;
  const passes = results.filter((result) => result.status === "pass").length;

  return [
    ["Checks reviewed", results.length],
    ["Need attention", failures],
    ["Please review", warnings],
    ["Looks good", passes],
  ]
    .map(
      ([label, value]) => `
        <div class="summary-card">
          <span class="label">${escapeHtml(label)}</span>
          <span class="value">${escapeHtml(value)}</span>
        </div>
      `
    )
    .join("");
}

function statusWeight(status) {
  switch (String(status || "").toLowerCase()) {
    case "fail":
      return 0;
    case "warn":
      return 1;
    case "pass":
      return 2;
    default:
      return 3;
  }
}

function sortResultsForReport(results = []) {
  return asArray(results).slice().sort((left, right) => {
    const leftStatus = statusWeight(left?.status);
    const rightStatus = statusWeight(right?.status);
    if (leftStatus !== rightStatus) {
      return leftStatus - rightStatus;
    }

    const rightSeverity = Number(resolveReportMeta(right).severityScore || 0);
    const leftSeverity = Number(resolveReportMeta(left).severityScore || 0);
    if (rightSeverity !== leftSeverity) {
      return rightSeverity - leftSeverity;
    }

    return String(resolveHeadline(left)).localeCompare(String(resolveHeadline(right)));
  });
}

function buildValidationSections(results = []) {
  const actionable = asArray(results).filter(
    (result) => result?.status === "fail" || result?.status === "warn"
  );
  const passes = asArray(results).filter((result) => result?.status === "pass");

  return [
    {
      id: "section-complex",
      title: "Complex issues",
      caption: "Highest-risk items that can break packaging, navigation, or major reading behavior.",
      results: sortResultsForReport(
        actionable.filter((result) => resolveIssueSize(result) === "Complex")
      ),
      open: false,
    },
    {
      id: "section-medium",
      title: "Medium issues",
      caption: "Issues that can break chapters, rendering, or content quality without taking down the entire publication.",
      results: sortResultsForReport(
        actionable.filter((result) => resolveIssueSize(result) === "Medium")
      ),
      open: false,
    },
    {
      id: "section-small",
      title: "Small issues",
      caption: "Lower-risk items that still need review before release.",
      results: sortResultsForReport(
        actionable.filter((result) => resolveIssueSize(result) === "Small")
      ),
      open: false,
    },
    {
      id: "section-passed",
      title: "Passed checks",
      caption: "Checks that completed without an active issue.",
      results: sortResultsForReport(passes),
      open: false,
    },
  ];
}

function renderComparisonSection(section = {}, postMap = new Map()) {
  const title = section.title;
  const caption = section.caption;
  const results = asArray(section.results);
  const sectionId = section.id || slugify(title);
  if (!results.length) {
    return "";
  }

  return `
    <details class="report-section" id="${escapeHtml(sectionId)}" ${section.open === false ? "" : "open"}>
      <summary class="section-header">
        <div>
          <h2>${escapeHtml(title)}</h2>
          ${caption ? `<p>${escapeHtml(caption)}</p>` : ""}
        </div>
        <span class="section-count">${results.length}</span>
      </summary>
      <div class="issue-list">
        ${results
          .map((pre, index) =>
            renderComparisonCard(pre, postMap.get(pre.id) || null, {
              index,
              issueId: `${sectionId}-${slugify(pre.id || pre.title || `issue-${index + 1}`)}`,
            })
          )
          .join("")}
      </div>
    </details>
  `;
}

function buildAutofixSections(preResults = []) {
  const actionable = asArray(preResults).filter(
    (result) => result?.status === "fail" || result?.status === "warn"
  );

  return [
    {
      id: "section-complex",
      title: "Complex issues",
      caption: "Highest-risk items, shown with their before-versus-after autofix outcome.",
      results: sortResultsForReport(
        actionable.filter((result) => resolveIssueSize(result) === "Complex")
      ),
      open: false,
    },
    {
      id: "section-medium",
      title: "Medium issues",
      caption: "Chapter, rendering, or content issues with their follow-up verification result.",
      results: sortResultsForReport(
        actionable.filter((result) => resolveIssueSize(result) === "Medium")
      ),
      open: false,
    },
    {
      id: "section-small",
      title: "Small issues",
      caption: "Lower-risk items with their autofix comparison.",
      results: sortResultsForReport(
        actionable.filter((result) => resolveIssueSize(result) === "Small")
      ),
      open: false,
    },
  ];
}

function generateHtmlReport(results, outputDir, options = {}) {
  const reportPath = path.join(outputDir, "EPUB_QA_Report.html");
  const sections = buildValidationSections(results);

  const html = renderShell({
    title: "Book Quality Report",
    subtitle:
      "This report explains what was checked, what may need attention, and where to look in the uploaded book files.",
    summaryCards: buildSummaryCards(results),
    overviewHtml: renderOverviewPanel(options),
    sections,
    sectionsHtml: sections.map((section) => renderSection(section)).join(""),
  });

  fs.writeFileSync(reportPath, html, "utf8");
  return reportPath;
}

function generateFixHtmlReport(preResults, postResults, outputDir, options = {}) {
  const reportPath = path.join(outputDir, "EPUB_QA_Fix_Report.html");
  const postMap = new Map(
    asArray(postResults)
      .filter((result) => result?.id)
      .map((result) => [result.id, result])
  );

  const actionable = asArray(preResults).filter(
    (result) => result?.status === "fail" || result?.status === "warn"
  );
  const sections = buildAutofixSections(preResults);
  const summaryResults = postResults?.length ? postResults : actionable;
  const sectionsHtml = sections
    .map((section) => renderComparisonSection(section, postMap))
    .join("");

  const html = renderShell({
    title: "Book Fix Review",
    subtitle:
      "This report shows what was flagged before the fix and what was seen after the follow-up check.",
    summaryCards: buildSummaryCards(summaryResults),
    overviewHtml: renderOverviewPanel(options),
    sections,
    sectionsHtml,
  });

  fs.writeFileSync(reportPath, html, "utf8");
  return reportPath;
}

module.exports = { generateHtmlReport, generateFixHtmlReport };
