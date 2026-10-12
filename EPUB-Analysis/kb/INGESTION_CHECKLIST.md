# KB Ingestion Checklist

This checklist is for populating the current RAG layer used by `EPUB-Analysis`.

The code is already wired to use:

- upload-specific retrieval from `kb/uploads_index`
- curated KB retrieval from the folders listed in `manifest.json`
- lookup-only tables for entities, Unicode, dictionaries, and hyphenation
- internal examples and protected-word lists from `kb/internal`

## Populate First

These are the highest-value sources for the current application.

### P0 Standards And Guidance

- [ ] `kb/standards/w3c/epub-33.html`
  Source: `https://www.w3.org/TR/epub-33/`
  Use for: package structure, OPF, manifest, spine, nav, conformance
- [ ] `kb/standards/w3c/epub-rs-33.html`
  Source: `https://www.w3.org/TR/epub-rs-33/`
  Use for: reading-system assumptions and support limits
- [ ] `kb/standards/w3c/epub-a11y-11.html`
  Source: `https://www.w3.org/TR/epub-a11y-11/`
  Use for: accessibility conformance and metadata
- [ ] `kb/standards/w3c/epub-a11y-tech-11.html`
  Source: `https://www.w3.org/TR/epub-a11y-tech-11/`
  Use for: accessibility fix guidance and examples
- [ ] `kb/standards/w3c/epub-ssv-11.html`
  Source: `https://www.w3.org/TR/epub-ssv-11/`
  Use for: `epub:type` and landmark semantics
- [ ] `kb/standards/w3c/wcag-22.html`
  Source: `https://www.w3.org/TR/wcag/`
  Use for: accessibility baseline and severity guidance
- [ ] `kb/tools/epubcheck/repo/`
  Source: `https://github.com/w3c/epubcheck`
  Use for: rule alignment and validator parity
- [ ] `kb/tools/epubcheck/releases/releases.html`
  Source: `https://github.com/w3c/epubcheck/releases`
  Use for: supported-version tracking
- [ ] `kb/tools/ace/ace-home.html`
  Source: `https://daisy.org/activities/software/ace/`
  Use for: accessibility tool scope and reporting
- [ ] `kb/tools/ace/ace-guide.html`
  Source: `https://kb.daisy.org/publishing/docs/epub/validation/ace.html`
  Use for: interpreting Ace reports and limits
- [ ] `kb/guidance/daisy/toc.html`
  Source: `https://kb.daisy.org/publishing/docs/navigation/toc.html`
  Use for: TOC and nav fixes
- [ ] `kb/guidance/daisy/pagelist.html`
  Source: `https://kb.daisy.org/publishing/docs/navigation/pagelist.html`
  Use for: page-list validation
- [ ] `kb/guidance/daisy/landmarks.html`
  Source: `https://kb.daisy.org/publishing/docs/navigation/landmarks.html`
  Use for: landmarks and navigation semantics
- [ ] `kb/guidance/daisy/pagenav.html`
  Source: `https://kb.daisy.org/publishing/docs/navigation/pagenav.html`
  Use for: page navigation semantics

### P0 Lookup Sources

- [ ] `kb/lookups/entities/html-entities.json`
  Source: WHATWG named-character references or a vetted export
  Use for: exact entity decoding
- [ ] `kb/lookups/unicode/tr15.html`
  Source: `https://unicode.org/reports/tr15/`
  Use for: normalization policy reference
- [ ] `kb/lookups/unicode/UnicodeData.txt`
  Source: Unicode public data
  Use for: character classification and normalization support
- [ ] `kb/lookups/unicode/NormalizationTest.txt`
  Source: Unicode public data
  Use for: normalization verification
- [ ] `kb/lookups/dictionaries/scowl/`
  Source: `https://github.com/en-wl/wordlist`
  Use for: spelling validation
- [ ] `kb/lookups/dictionaries/libreoffice/`
  Source: `https://github.com/LibreOffice/dictionaries`
  Use for: language-specific dictionary support
- [ ] `kb/lookups/dictionaries/wordfreq/`
  Source: `https://github.com/rspeer/wordfreq`
  Use for: candidate ranking and false-positive reduction
- [ ] `kb/lookups/hyphenation/hunspell-hyphen/`
  Source: `https://github.com/hunspell/hyphen`
  Use for: word-split and hyphenation decisions

## Internal Data To Maintain

- [ ] `kb/internal/examples/gold-corrections.jsonl`
  Purpose: approved before/after corrections used as high-trust examples
- [ ] `kb/internal/examples/manual-review-cases.jsonl`
  Purpose: examples that must not be auto-applied
- [ ] `kb/internal/examples/false-positive-log.jsonl`
  Purpose: words or patterns frequently misclassified
- [ ] `kb/internal/rules/rule-registry.json`
  Purpose: rule-level source of truth and safe-autofix policy
- [ ] `kb/internal/rules/ocr-confusions.json`
  Purpose: OCR confusion tables and confidence hints
- [ ] `kb/internal/rules/do-not-split-words.json`
  Purpose: protected compounds and brand or domain terms
- [ ] `kb/internal/rules/do-not-merge-words.json`
  Purpose: valid open compounds that must remain split

## Storage Rules

- Store standards, validator docs, DAISY guidance, and other prose references as vector-searchable text or HTML files.
- Store dictionaries, Unicode data, entity tables, hyphenation patterns, and rule tables as native lookup files, not vector corpora.
- Keep upload indexes ephemeral and per-run.
- Treat fetched external content as untrusted until it is sanitized and saved as a snapshot.

## Retrieval Rules

- Use deterministic rules first.
- Query upload context first for ambiguous text issues.
- Query curated KB second.
- Use external fetch only for approved domains and only when local KB is insufficient.
- Auto-apply only high-confidence, bounded fixes.
- Send low-confidence or semantic rewrites to manual review.

## Suggested Model Roles

Use separate models by task instead of a single model for all LLM work.

- `OLLAMA_MODEL_SUGGEST`
  Role: short fix suggestions only
  Requirements: small, fast instruct model
- `OLLAMA_MODEL_TEXT`
  Role: ambiguous snippet correction and bounded text autofix
  Requirements: strongest text model available to you
- `OLLAMA_MODEL_ALT`
  Role: alt-text generation from surrounding document context
  Requirements: small or medium instruct model
- `EPUB_LLM_ENDPOINT`
  Role: remote primary provider for bounded outputs
  Requirements: deterministic prompting support and stable JSON or short-text responses

Recommended starting policy:

```env
ENABLE_AI_SUGGESTIONS=false
ENABLE_TEXT_LLM_SUGGESTIONS=true
ENABLE_TEXT_LLM_AUTOFIX=false
ENABLE_LLM_AUTOFIX=false
RAG_DEBUG=true
LLM_DEBUG=true
```

Enable text autofix only after the internal examples and protected-word lists are populated and benchmarked.

## Done Means

The KB is ready for production-style RAG when:

- all P0 standards and guidance files exist locally
- lookup tables are present and readable
- internal example corpora contain approved real cases
- upload indexing is exercised in test runs
- retrieval logs show evidence from upload context plus curated KB, not just control files
