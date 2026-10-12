# Current Architecture and Living Textbook HLD

## Purpose

This document explains:

- the current high-level architecture of the EPUB validation and autofix backend
- where deterministic validation, RAG, and LLMs fit today
- how to extend the current system into a "Living Textbook" platform

The intent is to stay close to the current implementation instead of describing a generic future-state system.

## 1. Current System Goal

The current application is a backend service for:

- validating EPUB and PDF inputs
- identifying structural, metadata, media, accessibility, text-content, layout, and rendering issues
- applying deterministic or bounded AI-assisted fixes
- verifying the result after autofix
- exporting the corrected file

At the moment, the system behaves like a production-oriented validation and correction engine. It is not yet a full lifecycle platform for textbook versioning, review, publishing, and continuous improvement.

## 2. Current High-Level Architecture

```text
+-------------------+
| Client / UI       |
| Upload / Review   |
+---------+---------+
          |
          v
+-------------------+
| Express API       |
| server.js         |
+---------+---------+
          |
          +------------------------------+
          |                              |
          v                              v
+-------------------+         +-------------------+
| Validation Flow   |         | RAG Services      |
| validateEpub/Pdf  |         | route/query/index |
+---------+---------+         +---------+---------+
          |                              |
          v                              v
+-------------------+         +-------------------+
| Rule Engines      |         | KB + Upload Index |
| checks/*          |         | kb/, upload index |
+---------+---------+         +---------+---------+
          |                              |
          +---------------+--------------+
                          |
                          v
                +-------------------+
                | Autofix Runner    |
                | deterministic +   |
                | bounded AI fixes  |
                +---------+---------+
                          |
                          v
                +-------------------+
                | Post-fix Verify   |
                | revalidate + diff |
                +---------+---------+
                          |
                          v
                +-------------------+
                | Outputs / Download |
                | local file store   |
                +-------------------+
```

## 3. Current Runtime Components

### 3.1 API Layer

The entrypoint is [server.js](/c:/Users/krishkal/Desktop/epub_backend/EPUB-Analysis/server.js).

Primary responsibilities:

- accept EPUB/PDF uploads
- expose `/validate`, `/autofix`, `/convert`, and `/download`
- expose RAG support endpoints such as `/rag/status`, `/rag/route-issue`, `/rag/evidence-plan`, `/rag/query`, and `/rag/index-upload`
- expose LLM configuration visibility through `/llm-status`

This layer is acting as the orchestration boundary. It is not only routing traffic; it is also coordinating validation, autofix, and verification.

### 3.2 Validation Layer

The validation entrypoints are:

- [validateEpub.js](/c:/Users/krishkal/Desktop/epub_backend/EPUB-Analysis/src/validateEpub.js)
- [validatePdf.js](/c:/Users/krishkal/Desktop/epub_backend/EPUB-Analysis/src/validatePdf.js)

For PDF, extraction is no longer text-layer only. The pipeline now:

- extracts structured page text when a searchable text layer exists
- detects weak, empty, or OCR-corrupted page text
- runs page-level OCR only for the suspicious pages
- returns OCR usage metadata so downstream validation and indexing know whether a page came from the text layer or OCR

For EPUB, the flow is:

1. unzip the EPUB
2. run structure checks first to locate the OPF
3. run metadata checks
4. run media checks
5. run accessibility checks
6. run text-content checks
7. run deterministic layout and CSS checks
8. run visual responsive checks through Chromium screenshots when the renderer is available
9. optionally enrich some results with AI suggestions
10. optionally run agentic workflow enrichment when enabled
11. generate an HTML report and return the JSON summary, detailed findings, and report path

The rule modules live in `src/checks/`.

Key observation:

- the validator is primarily deterministic
- rule execution determines pass/fail/warn
- AI is additive, not authoritative
- layout validation is now part of the main validation path, not a sidecar utility

### 3.3 Text and Content Validation

Text-content validation is handled in [text-content-checks.js](/c:/Users/krishkal/Desktop/epub_backend/EPUB-Analysis/src/checks/text-content-checks.js).

This module:

- resolves content documents from the EPUB
- normalizes and inspects XHTML text
- detects:
  - hyphenation and word-merge problems
  - special-character and entity corruption
  - missing or incorrect text candidates
- requests a bounded suggestion for ambiguous text findings

The main text normalization engine sits in `src/utils/text-normalizer.js`.

### 3.4 Layout, CSS, and Visual Validation

Layout and styling validation is now split across:

- [layout-checks.js](/c:/Users/krishkal/Desktop/epub_backend/EPUB-Analysis/src/checks/layout-checks.js)
- [visual-layout-checks.js](/c:/Users/krishkal/Desktop/epub_backend/EPUB-Analysis/src/checks/visual-layout-checks.js)

The deterministic layout/CSS pass currently checks:

- stylesheet presence and broken stylesheet references
- malformed or unsupported CSS declarations
- inline styles overriding global CSS for layout-critical properties
- heading hierarchy and cross-chapter heading consistency
- paragraph line spacing
- embedded font references, missing font assets, fallback body fonts, and bold/italic variants
- table structure and table cell spacing
- list bullets/numbering
- blockquote and code-block styling

The visual pass currently:

- renders XHTML content in a Chromium profile
- captures screenshots at mobile, tablet, and desktop widths
- detects horizontal scrolling, clipping, overlap, problematic tables, and image distortion/overflow
- emits a warning rather than failing hard when the browser renderer is unavailable

This means the current validator is no longer limited to package, metadata, accessibility, and text checks. It also performs a real layout QA pass, but that pass is still browser-profile based rather than reader-engine comprehensive.

### 3.5 Autofix Layer

Autofix orchestration is in [autofix-runner.js](/c:/Users/krishkal/Desktop/epub_backend/EPUB-Analysis/src/autofix/autofix-runner.js).

This layer combines:

- deterministic package fixes
  - spine
  - nav
  - NCX
- text-content correction flow
- optional alt-text or bounded LLM fixes

It builds a fix plan first, then executes safe fixers based on the detected issue set.

### 3.6 Text Fix Pipeline

The text autofix flow is implemented in [text-content-updater.js](/c:/Users/krishkal/Desktop/epub_backend/EPUB-Analysis/src/autofix/text-content-updater.js).

The effective pipeline is:

1. build normalization context
2. use rule logic plus RAG evidence gates
3. apply safe changes
4. keep low-confidence items in manual review
5. optionally run a second bounded LLM pass only on unresolved review samples

This is already close to the right design for a production text-repair subsystem.

### 3.7 RAG Layer

The RAG facade is [src/rag/index.js](/c:/Users/krishkal/Desktop/epub_backend/EPUB-Analysis/src/rag/index.js).

Important modules:

- [issue-router.js](/c:/Users/krishkal/Desktop/epub_backend/EPUB-Analysis/src/rag/issue-router.js)
- [evidence-planner.js](/c:/Users/krishkal/Desktop/epub_backend/EPUB-Analysis/src/rag/evidence-planner.js)
- [upload-index.js](/c:/Users/krishkal/Desktop/epub_backend/EPUB-Analysis/src/rag/upload-index.js)
- [text-fix-policy.js](/c:/Users/krishkal/Desktop/epub_backend/EPUB-Analysis/src/rag/text-fix-policy.js)
- [post-fix-verifier.js](/c:/Users/krishkal/Desktop/epub_backend/EPUB-Analysis/src/rag/post-fix-verifier.js)

Current behavior:

- route issues into `deterministic`, `lookup_only`, `rag_assisted`, or `manual_review`
- build evidence plans from the KB manifest
- index uploaded EPUB/PDF content into a local searchable store
- preserve page metadata such as section context, extraction method, and OCR usage in the upload index
- retrieve local KB chunks and upload-context chunks
- approve or reject text changes based on evidence
- revalidate after autofix and summarize improvement

This means the current RAG implementation is not a chatbot layer. It is an evidence and policy layer for ambiguous fixes.

### 3.8 LLM Layer

The LLM integration is centralized in [llm-client.js](/c:/Users/krishkal/Desktop/epub_backend/EPUB-Analysis/src/utils/llm-client.js).

Current behavior:

- prefer local Ollama by default and keep remote use opt-in
- discover available Ollama models dynamically per endpoint instead of assuming one fixed model exists
- fall back across configured endpoints and compatible local models when the preferred model is unavailable
- keep temperature low
- log provider usage and latency

The LLM is used mainly for:

- suggestion generation
- bounded text correction support
- limited alt-text generation support

It is not the primary conformance engine.

### 3.9 Storage Model

The current system is file-based:

- uploads stored in `uploads/` or `upload/`
- generated outputs stored in `outputs/`
- RAG KB stored in `kb/`
- upload-specific chunk indices stored under the KB area

There is currently no database for:

- run history
- edition history
- change review
- publishing state
- learner feedback

That is the main reason the system is not yet a true "Living Textbook" platform.

## 4. Current Architecture Strengths

The current backend already has strong foundations:

- clear separation between validation, autofix, RAG, and download/export
- deterministic first design for structural issues
- bounded LLM usage rather than open-ended generation
- post-fix verification already exists
- KB-driven RAG structure already exists
- upload indexing gives document-specific grounding

In practice, this means the system already supports the core "improvement loop" technically:

`input -> validate -> propose fix -> apply fix -> verify -> export`

### 4.1 Current Sprint 2 Layout And Styling Coverage

Against the current Sprint 2 QA checklist, the implementation status is:

| Checklist area | Coverage today | Notes |
| --- | --- | --- |
| CSS validation | partial | detects packaged CSS, missing or broken stylesheet references, malformed syntax, invalid declarations, and inline-style conflicts |
| Font validation | partial | checks `@font-face` references, missing font assets, body-font fallback, and bold/italic rendering; no explicit underline rule today |
| Layout consistency | partial | checks heading hierarchy, paragraph spacing, some table spacing, and rendered overlap/overflow; no general alignment or margin/padding policy engine yet |
| Responsive rendering | partial to strong | Chromium screenshots at mobile/tablet/desktop detect horizontal scroll, clipping, overlap, table breakage, and image overflow/distortion |
| Heading and structure styling | partial | checks H1/H2/H3 distinctness and cross-chapter consistency |
| Table layout validation | partial | checks inconsistent cell counts, tight spacing, small table text, and responsive overflow |
| Image layout validation | partial | checks distortion, low-resolution upscaling, overflow, and some overlap cases |
| Special styling cases | supported | checks lists, blockquotes, and code blocks |
| Visual consistency across chapters | partial | checks body font-family consistency and same-level heading consistency |
| Automation validation | partial | screenshot capture is integrated; pixel diff utility exists but before/after diffing is not yet wired into the main pipeline |

Important current limits:

- the visual renderer is Chromium only, not multiple EPUB readers
- if Chromium cannot be launched, the visual pass degrades to a warning
- generic left/right/center alignment consistency is not yet enforced as a rule family
- generic margin/padding consistency across chapters is not yet enforced as a rule family
- before-vs-after screenshot diffing is not yet integrated into the normal validation/autofix report flow

## 5. Current Architecture Gaps

The current design is still missing platform-level capabilities:

- no persistent textbook identity across runs
- no edition model
- no run history timeline
- no review and approval workflow
- no diff and provenance store
- no publishing lifecycle
- no learner feedback loop
- no scheduled revalidation
- no analytics over textbook evolution

These are exactly the pieces needed for the Living Textbook concept.

## 6. What "Living Textbook" Means in This Context

In this architecture, a Living Textbook should mean:

- a textbook is not treated as a one-time uploaded file
- each textbook has versions or editions
- every validation run becomes part of history
- issues and changes are traceable over time
- approved corrections become institutional memory
- the book can be revalidated and republished continuously
- human review remains part of the governance loop

So the concept is not just "AI fixes the EPUB".

It is:

`persistent textbook + continuous quality loop + governed updates + publishable editions`

## 7. Proposed Living Textbook Architecture

```text
+------------------------+
| Author / Editor UI     |
| Reviewer / Ops UI      |
+-----------+------------+
            |
            v
+------------------------+
| API and Workflow Layer |
| validate / review /    |
| publish / history      |
+-----------+------------+
            |
            +-------------------------------+
            |                               |
            v                               v
+------------------------+        +------------------------+
| Validation + Autofix   |        | Review + Decision      |
| current engine         |        | approval workflow      |
+-----------+------------+        +-----------+------------+
            |                                 |
            v                                 v
+------------------------+        +------------------------+
| RAG + LLM Assist       |        | Version / Diff Engine  |
| KB, upload context,    |        | chapter/snippet/rule   |
| evidence policies      |        | provenance tracking    |
+-----------+------------+        +-----------+------------+
            |                                 |
            +------------------+--------------+
                               |
                               v
                    +------------------------+
                    | Textbook Registry      |
                    | editions, runs,        |
                    | artifacts, feedback    |
                    +-----------+------------+
                                |
                                v
                    +------------------------+
                    | Publish + Analytics    |
                    | release, rollback,     |
                    | revalidation schedule  |
                    +------------------------+
```

## 8. New Logical Components to Add

### 8.1 Textbook Registry

Add a persistent data model for:

- textbook
- source artifact
- edition
- validation run
- autofix run
- review decision
- publication event

Recommended storage:

- relational database such as PostgreSQL for metadata
- object or file storage for EPUB/PDF artifacts and generated snapshots

### 8.2 Run History and Traceability Service

Add a service that stores:

- input file hash
- output file hash
- validation report snapshot
- fix plan snapshot
- targeted issue IDs
- before/after issue state
- change provenance

This converts the current one-off pipeline into an auditable improvement system.

### 8.3 Diff and Provenance Engine

Track changes at:

- file level
- chapter level
- snippet level
- rule level

For each applied change, store provenance like:

- source: `deterministic_rule`, `lookup`, `rag`, `llm`, `manual_editor`
- evidence source IDs
- confidence
- reviewer decision

### 8.4 Review Workflow

Add a human-in-the-loop stage between proposal and publish:

- `proposed`
- `approved`
- `rejected`
- `applied`
- `published`

This is especially important for:

- ambiguous text corrections
- alt text
- accessibility interpretation
- content-sensitive changes

### 8.5 Continuous KB Learning

The current KB should evolve from static reference content to operational memory.

Approved outcomes should feed back into:

- `gold-corrections`
- `manual-review-cases`
- `false-positive-log`

That makes future RAG decisions stronger and reduces repeated manual effort.

### 8.6 Publish and Rollback Service

Publishing should become a first-class step:

- mark one edition as active
- keep prior editions immutable
- allow rollback to a prior published edition
- generate a release note and diff summary

### 8.7 Scheduler and Revalidation

Add background jobs for:

- scheduled revalidation
- KB refresh
- standards refresh
- regression checks on synthetic mutation packs

This is the operational heartbeat of the Living Textbook concept.

## 9. Recommended Target Data Model

At minimum, add these entities:

- `textbooks`
- `artifacts`
- `editions`
- `runs`
- `issues`
- `proposals`
- `review_decisions`
- `publications`
- `feedback_events`

High-level relationships:

- one textbook has many editions
- one edition has many runs
- one run has many issues
- one issue may have many proposals
- one proposal may have one or more review decisions
- one edition may be published or rolled back

## 10. How the Current Code Fits the Future Model

### Keep as Core Engines

These should remain the core domain engines:

- [validateEpub.js](/c:/Users/krishkal/Desktop/epub_backend/EPUB-Analysis/src/validateEpub.js)
- [validatePdf.js](/c:/Users/krishkal/Desktop/epub_backend/EPUB-Analysis/src/validatePdf.js)
- `src/checks/*`
- [autofix-runner.js](/c:/Users/krishkal/Desktop/epub_backend/EPUB-Analysis/src/autofix/autofix-runner.js)
- [text-content-updater.js](/c:/Users/krishkal/Desktop/epub_backend/EPUB-Analysis/src/autofix/text-content-updater.js)
- [post-fix-verifier.js](/c:/Users/krishkal/Desktop/epub_backend/EPUB-Analysis/src/rag/post-fix-verifier.js)

### Wrap with Platform Services

Build new services around them:

- `src/textbooks/`
- `src/runs/`
- `src/review/`
- `src/publish/`
- `src/history/`
- `src/analytics/`

The current implementation should become the execution engine inside a larger lifecycle system.

## 11. Proposed Request Lifecycle for a Living Textbook

### Current Lifecycle

```text
Upload file
-> Validate
-> Autofix
-> Verify
-> Download output
```

### Target Lifecycle

```text
Register textbook
-> Upload new source artifact
-> Create edition candidate
-> Validate
-> Generate proposals
-> Review / approve
-> Apply fixes
-> Verify
-> Publish edition
-> Capture feedback
-> Revalidate over time
```

## 12. Minimal Incremental Implementation Plan

### Phase 1: Persistence

Add:

- textbook registry
- run history
- artifact snapshots
- verification history

Outcome:

- the existing engine becomes traceable

### Phase 2: Review and Diff

Add:

- proposal persistence
- change provenance
- before/after diff summaries
- approval workflow

Outcome:

- the engine becomes governable

### Phase 3: Publishing

Add:

- edition model
- publish endpoint
- rollback endpoint
- release note generation

Outcome:

- the engine becomes a managed textbook lifecycle platform

### Phase 4: Continuous Learning

Add:

- feedback ingestion
- KB updates from approved decisions
- scheduled revalidation
- regression scoring

Outcome:

- the platform becomes a true Living Textbook system

## 13. Recommended New Endpoints

To support the new model, add APIs like:

- `POST /textbooks`
- `GET /textbooks/:id`
- `POST /textbooks/:id/artifacts`
- `POST /textbooks/:id/editions`
- `GET /editions/:id/runs`
- `GET /runs/:id`
- `GET /runs/:id/diff`
- `POST /proposals/:id/approve`
- `POST /proposals/:id/reject`
- `POST /editions/:id/publish`
- `POST /editions/:id/rollback`
- `POST /feedback`

These should sit alongside the current validation/autofix APIs, not replace them immediately.

## 14. Design Principles

To keep the architecture sound:

- deterministic rules remain the source of truth for validation
- RAG remains an evidence layer, not a freeform answer engine
- LLMs remain bounded to suggestion and ambiguous correction tasks
- all non-trivial content changes require traceability
- publication requires explicit verification and review
- every edition must be reproducible from stored inputs and decisions

## 15. Final Architecture Positioning

The most accurate way to describe the current product is:

"A validation and autofix engine with RAG-assisted text correction and post-fix verification."

The most accurate way to describe the target product is:

"A Living Textbook platform built on top of the current engine, with versioned editions, governed corrections, traceable diffs, continuous revalidation, and publishable textbook releases."

## 16. Short Executive Summary

You do not need to replace the current backend.

You should treat the current backend as the core execution engine and add:

- persistence
- review workflow
- diff/provenance
- edition publishing
- feedback and revalidation loops

That is the cleanest path from the current architecture to the Living Textbook concept.
