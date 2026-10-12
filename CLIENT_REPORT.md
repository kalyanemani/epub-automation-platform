# EPUB Automation Platform — Client Technical Report

**Project:** EPUB Quality Automation & AI-Assisted Fixing  
**Prepared by:** Engineering Team  
**Date:** May 2026

---

## 1. Executive Summary

We have built a fully automated EPUB quality validation and fixing platform that detects, categorises, and resolves structural, metadata, accessibility, CSS/layout, and content issues in EPUB files — without manual effort for the vast majority of cases.

The platform combines:
- **Rule-based deterministic fixing** (Node.js engine) for structural and metadata issues — fast, reliable, zero hallucination risk
- **LLM-assisted AI fixing** (Python multi-agent pipeline) for CSS, HTML, accessibility, and content issues — where the correct value must be generated, not just looked up
- **Human-in-the-Loop (HITL) review** for edge cases with no safe automated fix
- **Re-validation after every fix** to confirm the issue is actually resolved before delivery

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────┐
│              Streamlit Web UI  (:8501)               │
│  Upload → Validate → Triage → Fix → Report → HITL  │
└───────────────────┬─────────────────────────────────┘
                    │ REST API
        ┌───────────▼──────────────┐
        │   Python FastAPI (:8000)  │
        │   Multi-Agent Orchestrator│
        │   12 Specialised Agents   │
        │   RAG Engine (BGE-M3)     │
        │   ChromaDB Knowledge Base │
        └───────────┬──────────────┘
                    │ /validate  /autofix
        ┌───────────▼──────────────┐
        │  Node.js Validator (:9000)│
        │  70+ Validation Rules     │
        │  Deterministic Autofix    │
        └──────────────────────────┘
                    │
        ┌───────────▼──────────────┐
        │   Ollama LLM (Local)      │
        │   Primary + Fallback      │
        │   Vision / Codegen /      │
        │   Reasoning / Structured  │
        └──────────────────────────┘
```

**Three services run together:**
| Service | Port | Technology | Role |
|---------|------|------------|------|
| Node.js Validator | 9000 | Express + custom parsers | EPUB unpacking, 70+ rule checks, deterministic fixes |
| Python Agent Service | 8000 | FastAPI + asyncio | Orchestration, LLM calls, RAG, patching, reporting |
| Streamlit UI | 8501 | Streamlit | User-facing interface: upload, review, download |

---

## 3. Validation Coverage — 70+ Rules Across 7 Categories

### 3.1 Structure Rules (S_* / NCX_* / NAV_*)
| Rule ID | What It Checks |
|---------|----------------|
| S_MIMETYPE_MISSING | Root-level mimetype file is present |
| S_MIMETYPE_CONTENT | mimetype content is exactly "application/epub+zip" |
| S_CONTAINER_MISSING | META-INF/container.xml exists |
| S_OPF_MISSING / S_OPF_INVALID | OPF package document found and valid XML |
| S_UNIQUE_ID_INVALID | unique-identifier attribute references a real dc:identifier |
| S_METADATA_ISSUES | Required DC elements (title, language, identifier) all present |
| S_MANIFEST_EMPTY | Manifest has at least one item |
| S_MANIFEST_DUP_IDS | No two manifest items share the same @id |
| S_MANIFEST_ITEMS_INVALID | Each manifest item has id, href, media-type; file actually exists on disk |
| S_SPINE_EMPTY | Spine has at least one itemref |
| S_SPINE_DUP_IDREFS | No duplicate idrefs in spine |
| S_SPINE_ITEMREFS_INVALID | All spine idrefs resolve to real manifest items |
| S_SPINE_OUT_OF_ORDER | Reading order matches manifest declaration order |
| S_BROKEN_INTERNAL_LINKS | All href/src links inside HTML resolve |
| S_ORPHAN_FILES | No content files exist in the ZIP that are not in the manifest |
| NCX_PLAYORDER_INVALID | NCX navMap playOrder is sequential without gaps |
| NCX_DUPLICATE_IDS | No duplicate @id values in NCX |
| NCX_SPINE_MISMATCH | NCX reading order matches spine order |
| NCX_PHANTOM_ENTRIES | NCX navMap only references files that are in the spine |
| NCX_PAGELIST_PLAYORDER | NCX pageList playOrder is sequential and continues from navMap |
| NCX_PAGELIST_VALUE_TEXT_MISMATCH | Page value attribute matches text content in each pageTarget |
| NCX_NAV_PAGELIST_MISMATCH | pageList is synchronised between NCX and nav.xhtml |
| NAV_SPINE_MISMATCH | nav.xhtml TOC order matches spine order |
| NAV_TOC_PHANTOM_ENTRIES | nav TOC only references files in the spine |
| MULTIPLE_COVERS | Only one manifest item has properties="cover-image" |
| UNREFERENCED_MEDIA | No images/fonts/media in ZIP that are unused by any HTML or CSS |

### 3.2 Metadata Rules (M_*)
| Rule ID | What It Checks |
|---------|----------------|
| M_IDENTIFIER | dc:identifier present; UUID or ISBN format preferred |
| M_LANGUAGE | dc:language present and valid BCP-47 tag |
| M_PUBLISHER | dc:publisher declared |
| M_DATE | dc:date present and ISO-8601 formatted |
| M_DUPLICATES | No duplicate dc:identifier, dc:language, or dc:title |
| M_EPUB2_GUIDE | Deprecated EPUB2 `<guide>` element should be removed |
| M_RENDITION_LAYOUT / ORIENTATION / SPREAD | Rendition meta properties valid |

### 3.3 Accessibility Rules (A_*)
| Rule ID | What It Checks |
|---------|----------------|
| A_SCHEMA_ACCESSMODE_MISSING | schema:accessMode declared in OPF |
| A_SCHEMA_ACCESSIBILITYFEATURE_MISSING | schema:accessibilityFeature declared |
| A_SCHEMA_ACCESSIBILITYHAZARD_MISSING | schema:accessibilityHazard declared |
| A_HTML_LANG_MISSING | Every XHTML file has lang= on the `<html>` tag |
| A_LINK_TEXT_MISSING | Every `<a>` has visible text or aria-label |
| A_MANUAL | Manual reviewer required (colour contrast, screen reader) |

### 3.4 CSS & Layout Rules (L_*)
| Rule ID | What It Checks |
|---------|----------------|
| L_CSS_REFERENCE_MISSING | HTML links to a CSS file that is not in the manifest |
| L_CSS_REFERENCE_BROKEN | CSS file declared in manifest but not found on disk |
| L_CSS_SYNTAX | CSS file contains malformed syntax |
| L_CSS_INVALID_DECLARATION | CSS property/value pair fails spec validation |
| L_FONT_FALLBACK | @font-face missing a fallback font stack |
| L_FONT_VARIANTS | Font-variant declarations need normalisation |
| L_CSS_CLASS_SELECTOR_MISSING | CSS class used in HTML but not defined in any stylesheet |
| L_HEADING_HIERARCHY | `<h1>`→`<h3>` skip or non-sequential headings |
| L_TABLE_STYLING | Tables lack responsive/accessible styling |
| L_TABLE_RESPONSIVE | Table may overflow small screens |
| L_LIST_STYLING | List elements lack consistent styling |
| L_IMAGE_RENDERING | Image quality or scaling issue |
| L_RESPONSIVE_HORIZONTAL_SCROLL | Content may overflow viewport width |
| L_RESPONSIVE_TEXT_CLIPPING | Text may be cut off on narrow screens |
| L_LAYOUT_OVERLAP | Elements may overlap on smaller screens |

### 3.5 Media Rules (Media_*)
| Rule ID | What It Checks |
|---------|----------------|
| Media_IMAGE_NO_ALT | `<img>` missing alt attribute |
| Media_IMAGE_NO_SRC | `<img>` has empty or missing src |
| Media_audio_controls | `<audio>` missing controls attribute |
| Media_missing_control | `<video>`/`<audio>` missing controls for user interaction |

### 3.6 Text Content Rules (T_*)
| Rule ID | What It Checks |
|---------|----------------|
| T_HYPHENATION_WORD_MERGE | Words split by hyphens at line breaks that should be merged |
| T_SPECIAL_CHAR_ENTITY | Smart quotes/em-dashes not using correct Unicode entities |
| T_MISSING_INCORRECT_TEXT | OCR errors or missing words detected via semantic similarity |

### 3.7 JavaScript Rules (JS_*)
| Rule ID | What It Checks |
|---------|----------------|
| JS_SCRIPT_REFERENCE_BROKEN | HTML references a JS file not in the manifest |

---

## 4. How Fixes Are Applied — Rule-Based vs. LLM

Every failing issue is routed by the **TriageAgent** into one of three tracks:

```
Issue Detected
      │
      ▼
 ┌─────────────────────────────────────────────┐
 │               TriageAgent                   │
 └──────┬──────────────────┬──────────────────-┘
        │                  │                   │
        ▼                  ▼                   ▼
  AUTO (Deterministic)  LLM-Assisted       HITL (Human)
  26 rules              33 rules           6 rules
  Node.js engine        Python agents      Human review
  Confidence: 0.97      Confidence: 0.78–0.88   Confidence: 0.15–0.30
```

### 4.1 AUTO Track — 26 Rules (Deterministic, Node.js)

These rules have known, unambiguous fixes. No AI is needed. The Node.js engine applies the fix directly and reliably.

**Structure (8 rules):**
S_MIMETYPE_MISSING, S_MIMETYPE_CONTENT, S_SPINE_DUP_IDREFS, S_SPINE_OUT_OF_ORDER, S_MANIFEST_ITEMS_INVALID, S_MANIFEST_DUP_IDS, MULTIPLE_COVERS, UNREFERENCED_MEDIA

**NCX / Navigation (10 rules):**
NCX_SPINE_MISMATCH, NCX_PLAYORDER_INVALID, NCX_PAGELIST_PLAYORDER, NCX_DUPLICATE_IDS, NCX_IDS_UNIQUE, NCX_PAGELIST_VALUE_TEXT_MISMATCH, NCX_NAV_PAGELIST_MISMATCH, NCX_PHANTOM_ENTRIES, NAV_SPINE_MISMATCH, NAV_TOC_PHANTOM_ENTRIES

**Metadata OPF (7 rules):**
M_DUPLICATES, M_LANGUAGE, M_PUBLISHER, M_IDENTIFIER, M_RENDITION_LAYOUT, M_RENDITION_ORIENTATION, M_RENDITION_SPREAD

**Text Normalisation (1 rule):**
T_SPECIAL_CHAR_ENTITY

> **Why deterministic?** The fix for "wrong NCX playOrder" or "duplicate spine IDREFs" is mathematically derivable from the file itself — re-number sequentially, remove the duplicate. No semantic understanding is needed.

### 4.2 LLM-ASSISTED Track — 33 Rules (AI-Generated, Python Agents)

These rules require generating a correct value that depends on context — a CSS rule that must match the design, alt text that describes an image, or a properly formatted date.

**Metadata (2 rules):** M_DATE, M_IDENTIFIER_FORMAT  
*Task type: structured | Confidence: 0.88*

**CSS & Layout (17 rules):** L_CSS_SYNTAX, L_CSS_REFERENCE_MISSING, L_CSS_REFERENCE_BROKEN, L_FONT_FALLBACK, L_FONT_VARIANTS, L_CSS_INVALID_DECLARATION, L_CSS_CLASS_SELECTOR_MISSING, L_HEADING_HIERARCHY, L_TABLE_RESPONSIVE, L_TABLE_STYLING, L_TABLE_STRUCTURE, L_LIST_STYLING, L_IMAGE_RENDERING, L_RESPONSIVE_HORIZONTAL_SCROLL, L_RESPONSIVE_TEXT_CLIPPING, L_LAYOUT_OVERLAP  
*Task type: codegen | Confidence: 0.80*

**JavaScript (1 rule):** JS_SCRIPT_REFERENCE_BROKEN  
*Task type: codegen | Confidence: 0.80*

**HTML Accessibility (5 rules):** A_HTML_LANG_MISSING, A_LINK_TEXT_MISSING, A_SCHEMA_ACCESSMODE_MISSING, A_SCHEMA_ACCESSIBILITYFEATURE_MISSING, A_SCHEMA_ACCESSIBILITYHAZARD_MISSING  
*Task type: structured | Confidence: 0.82*

**Media (6 rules):** Media_IMAGE_NO_SRC, Media_audio_controls, Media_missing_control, Media_IMAGE_NO_ALT, A_IMAGE_ALT_MISSING, IMG_ALT_MISSING  
*Task type: vision (alt text) or structured | Confidence: 0.78–0.82*

**Text Content (2 rules):** T_HYPHENATION_WORD_MERGE, T_MISSING_INCORRECT_TEXT  
*Task type: reasoning | Confidence: 0.82*

### 4.3 HITL Track — 6 Rules (Human Review Required)

| Rule | Reason No Automation |
|------|----------------------|
| A_MANUAL | Colour contrast and screen-reader experience require rendering |
| A11Y_MANUAL_REVIEW | Complex accessibility scenarios with no safe automated fix |
| S_BROKEN_INTERNAL_LINKS | Broken links may require restructuring the EPUB |
| M_EPUB2_GUIDE | Removal may affect reader navigation in ways only a human can judge |
| L_VISUAL_READER_COVERAGE | Visual completeness is subjective |
| SMIL_* | EPUB Media Overlays (audio sync) require editorial decisions |

---

## 5. The AI Pipeline — How LLM Fixes Work

When an issue is routed to the LLM track, a chain of six agents runs:

```
TriageAgent → KBAgent → Domain Fixer Agent → ValidatorAgent → EPUBPatcher → Re-Validation
```

**Step 1 — KBAgent**  
Queries a ChromaDB vector knowledge base (3 collections: kb_css, kb_js, epub_rules) using BGE-M3 dense embeddings to retrieve the most relevant fix patterns and EPUB spec guidance for this specific rule.

**Step 2 — Domain Fixer Agent (4 specialists)**
| Agent | Handles |
|-------|---------|
| CSSFixerAgent | CSS syntax, declarations, font variants, class selectors, layout rules |
| JSFixerAgent | JavaScript reference and script issues |
| HTMLAccessibilityAgent | alt text (vision model), lang attributes, link text, ARIA |
| MetadataTextAgent | OPF metadata fields, date formatting, text content corrections |

Each agent receives: the failing rule, affected file content, KB context, and a system prompt that constrains it to produce only valid EPUB-safe output.

**Step 3 — ValidatorAgent**  
Scores the LLM output before it is written to the file:
- Structural validity (is the proposed value well-formed?)
- Rule compliance (does it actually resolve the issue?)
- Confidence score (0.0–1.0)

Only proposals above the confidence threshold proceed to patching.

**Step 4 — EPUBPatcher**  
A deterministic Python class that:
- Snapshots the file before modification
- Applies the patch via targeted DOM or text manipulation (not whole-file replacement)
- Computes a before/after diff for audit
- Handles 16 dispatch cases covering every LLM-assisted rule category

**Step 5 — Re-Validation**  
The fixed EPUB is re-run through the full Node.js validator. Any rule that is still failing is flagged as "Unfixed" and can enter HITL.

---

## 6. LLM Infrastructure

The platform uses a **two-tier local LLM setup** with automatic fallback:

| Tier | URL | Role |
|------|-----|------|
| Primary | Remote Ollama (172.16.x.x:11434) | Shared team GPU server |
| Fallback | Local Ollama (127.0.0.1:11434) | Developer machine |

**Model selection by task type:**

| Task Type | Model Used | Used For |
|-----------|-----------|----------|
| vision | qwen2.5vl:7b | Image alt-text generation; visual layout analysis |
| codegen | qwen2.5-coder:14b | CSS, HTML, JavaScript fixes |
| reasoning | llama3.2 | Text content, hyphenation merge, complex fixes |
| structured | qwen2.5-coder:14b / llama3.2 | Metadata formatting, accessibility attributes |
| default | llama3.2 | Fallback for any unclassified task |

The system runs a **live diagnostic at startup** — it probes every model, records latency, and falls back gracefully if a model is unavailable or times out.

---

## 7. Evaluation & Validation — How We Know Fixes Are Correct

The platform uses a **four-layer quality gate**:

### Layer 1 — Pre-Fix Structural Validation (Node.js)
Before any fix is attempted, the EPUB is fully validated against all 70+ rules. Every detected issue is recorded with: rule ID, severity (fail/warn), affected file, position, and human-readable message.

### Layer 2 — Confidence Scoring (ValidatorAgent)
Every LLM-generated fix is evaluated by the ValidatorAgent before application:
- Structural correctness (parseable EPUB/CSS/HTML output)
- Semantic compliance with the rule specification
- Numeric confidence score assigned per task type

Fixes below threshold are rejected and escalated to HITL.

### Layer 3 — RAG-Based Semantic Evaluation
For text content fixes (T_MISSING_INCORRECT_TEXT, T_HYPHENATION_WORD_MERGE), the RAG Engine uses:
- **BGE-M3 dense embeddings** — cosine similarity between original and proposed text
- **Fuzzy string similarity** — character-level edit distance
- **Four-tier classification:** identical → formatting_mismatch → low_risk_divergence → high_risk_divergence

Only "identical" and "formatting_mismatch" categories are auto-applied. Higher divergence goes to HITL.

### Layer 4 — Post-Fix Re-Validation (Node.js)
After the fixed EPUB is repacked, the **full 70+ rule validation runs again** on the output file. The fix_trace records for each rule:
- `applied: true/false` — was the fix actually applied?
- `still_failing: true/false` — does the rule still fail after fix?
- `diff` — exact before/after change

A fix is only reported as **"Fixed"** when both conditions hold: applied=true AND still_failing=false.

### Audit Trail
Every run produces:
- A structured JSON fix_trace with per-rule outcomes
- Before/after file diffs for every patched file
- Episodic memory logs per agent (stored in SQLite)
- An interactive HTML report for client review

---

## 8. Features Developed — Challenges and Resolutions

### Feature 1: Multi-Agent EPUB Pipeline (Core Architecture)
**Challenge:** EPUB fixing spans 7 distinct domains (structure, NCX, metadata, CSS, HTML, media, text) — no single model or rule set can handle all of them. Early prototypes with a single LLM call produced inconsistent outputs and hallucinated CSS values.

**Resolution:** Split into 12 specialised agents, each with its own system prompt, domain knowledge, and confidence threshold. The OrchestratorAgent fans tasks out in parallel and collects results. This reduced hallucination and improved throughput.

---

### Feature 2: Deterministic Node.js Autofix for 26 Rules
**Challenge:** Structural issues (NCX play order, spine duplicates, manifest item validation) were initially sent to the LLM, which sometimes produced semantically correct but structurally invalid OPF/NCX XML.

**Resolution:** Implemented 26 deterministic fixers in Node.js (epub-opf-fixer.js, epub-structure-fixer.js, epub-ncx-fixer.js, etc.) that directly manipulate the parsed XML/JSON AST. These run first, before any LLM call, with 0.97 confidence and zero hallucination risk.

---

### Feature 3: S_MANIFEST_ITEMS_INVALID Fix Ordering Bug
**Challenge:** The manifest item fixer ran _after_ the unreferenced-media removal pass. The unreferenced-media pass deleted the same items the manifest fixer was supposed to report and fix — so by the time the manifest fixer ran, it found nothing to do and returned false. The rule was never added to fixedRules, so Python saw it as Unfixed even though the EPUB was corrected.

**Resolution:** Swapped execution order — manifest item fixer now runs _before_ unreferenced-media removal. It sees the original manifest, catches items with missing files or wrong media-types, fixes them, and correctly adds S_MANIFEST_ITEMS_INVALID to fixedRules. The unreferenced-media pass then handles any remaining orphan items.

---

### Feature 4: CSS LLM Fixes (L_CSS_CLASS_SELECTOR_MISSING, L_FONT_VARIANTS, L_TABLE_STYLING, L_LIST_STYLING)
**Challenge:** The Python EPUBPatcher had no dispatch cases for these four CSS rules. The LLM generated correct fix content, but the patcher silently dropped it because no handler matched the rule ID.

**Resolution:** Added four dispatch cases to `epub_patcher.py` — CSS_CLASS_SELECTOR routes to `_fix_css_append()`, FONT_VARIANTS to `_fix_css_inplace()`, TABLE_STYLING and LIST_STYLING both to `_fix_css_append()`. All four rules now show applied=true in the fix trace.

---

### Feature 5: RAG Knowledge Base for CSS/EPUB Spec Guidance
**Challenge:** LLM models (especially smaller local models) do not reliably know EPUB 3.x spec details or which CSS properties are safe in EPUB readers versus full browsers.

**Resolution:** Built a ChromaDB vector knowledge base with three collections (kb_css, kb_js, epub_rules). Before each LLM fix call, the KBAgent retrieves the top-k most relevant spec guidance using BGE-M3 embeddings. This grounds the LLM output in verified EPUB specification knowledge.

---

### Feature 6: Vision Model for Image Alt Text
**Challenge:** Generating meaningful alt text for images requires actually seeing the image — text-only models produce generic or wrong descriptions.

**Resolution:** Routed all alt-text rules (Media_IMAGE_NO_ALT, A_IMAGE_ALT_MISSING) to the qwen2.5vl:7b vision model with the image encoded as base64 in the prompt. The VisionAgent also handles visual layout analysis (L_LAYOUT_OVERLAP, L_IMAGE_RENDERING).

---

### Feature 7: HITL (Human-in-the-Loop) Queue
**Challenge:** Some fixes (broken internal links, visual accessibility, SMIL) cannot be safely automated. Silently skipping them or applying a wrong auto-fix would be worse than flagging them.

**Resolution:** Built a dedicated HITL queue in the Streamlit UI. Issues routed to HITL appear as review cards with AI-generated suggestions. The human approves, edits, or rejects each suggestion. Approved fixes are applied via `/agent-autofix-apply-hitl` and re-validated.

---

### Feature 8: Two-Tier LLM Fallback with Live Diagnostics
**Challenge:** The team's remote GPU server is not always reachable. When it goes down, the pipeline should not stall.

**Resolution:** Implemented a two-tier fallback (remote Ollama → local Ollama) with a startup diagnostic that probes every model, measures latency, and pre-selects the best available model per task type. If the primary is unreachable, all calls transparently route to the fallback without any code changes or manual intervention.

---

## 9. Summary Statistics

| Metric | Value |
|--------|-------|
| Total validation rules | 70+ |
| Rules with deterministic auto-fix | 26 (AUTO track) |
| Rules with LLM-assisted fix | 33 (LLM track) |
| Rules requiring human review | 6 (HITL track) |
| Specialised AI agents | 12 |
| API endpoints | 21 |
| Fix dispatch handlers (EPUBPatcher) | 16 |
| LLM task types | 4 (vision, codegen, reasoning, structured) |
| Post-fix re-validation | Yes — every run |
| Audit trail | JSON fix_trace + file diffs + HTML report |
| Automation rate (deterministic) | ~45% of fixable rules |
| Automation rate (LLM) | ~55% of fixable rules |

---

## 10. Limitations & Next Steps

| Limitation | Status |
|------------|--------|
| L_CSS_INVALID_DECLARATION — Node.js fix not applied on some EPUBs | Under investigation |
| L_CSS_CLASS_SELECTOR_MISSING — Skipped when no LLM output available | LLM model gap; mitigated with deterministic fallback |
| S_BROKEN_INTERNAL_LINKS — No automated fix | Requires editorial decision; currently HITL |
| TextContentChecks timeout (120s) — partial results on large EPUBs | Known; T_* rules may be incomplete on very large books |
| qwen2.5-coder:14b — times out on local machine | Fallback to llama3.2 for structured/codegen tasks |
| M_DATE — generates year-only (2026) instead of YYYY-MM-DD | Enhancement: extract full date from dc:source or copyright page |

---

*Report generated from live codebase. All rule IDs, agent names, and fix counts reflect the current deployed version.*
