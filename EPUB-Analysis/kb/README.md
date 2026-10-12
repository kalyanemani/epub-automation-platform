# Knowledge Base Layout

This folder defines the recommended knowledge-base inventory for the current EPUB/PDF validation and autofix solution.

The layout is split by how the data should be used:

- `standards/`: authoritative specs and recommendations
- `tools/`: validator and accessibility tool references
- `guidance/`: practical publishing guidance and examples
- `lookups/`: dictionaries, entities, Unicode data, hyphenation patterns
- `internal/`: your approved examples, rule registry, false-positive logs
- `uploads_index/`: per-upload ephemeral retrieval indexes built from source EPUB/PDF files

## Recommended Tree

```text
kb/
  README.md
  manifest.json
  standards/
    w3c/
      epub-33.html
      epub-rs-33.html
      epub-a11y-11.html
      epub-a11y-tech-11.html
      epub-ssv-11.html
      wcag-22.html
      html-syntax.html
      xml-10.html
      css-snapshot-2025.html
  tools/
    epubcheck/
      repo/
      releases/
    ace/
      ace-home.html
      ace-guide.html
      repo/
  guidance/
    daisy/
      toc.html
      pagelist.html
      landmarks.html
      pagenav.html
      metadata-schema-org/
  lookups/
    dictionaries/
      scowl/
      libreoffice/
      wordfreq/
    hyphenation/
      hunspell-hyphen/
      valid-hyphenated-words.json
    entities/
      html-entities.json
    unicode/
      tr15.html
      UnicodeData.txt
      NormalizationTest.txt
  internal/
    examples/
      gold-corrections.jsonl
      manual-review-cases.jsonl
      false-positive-log.jsonl
    rules/
      rule-registry.json
      ocr-confusions.json
      do-not-split-words.json
      do-not-merge-words.json
  uploads_index/
```

## What To Download First

Start with these `P0` sources:

- EPUB 3.3
- EPUB Reading Systems 3.3
- EPUB Accessibility 1.1
- EPUB Accessibility Techniques 1.1
- EPUB Structural Semantics Vocabulary 1.1
- WCAG 2.2
- EPUBCheck repo and release docs
- Ace by DAISY docs
- DAISY TOC, page-list, landmarks, and page-navigation guidance
- SCOWL
- LibreOffice dictionaries for target languages
- Unicode normalization data
- HTML entity table

## Storage Rules

- Put specs, validator docs, and DAISY guidance into a vector-searchable corpus.
- Put dictionaries, Unicode files, entity maps, hyphenation patterns, and rule tables into JSON, TXT, SQLite, or native source format.
- Do not embed large dictionary tables into a vector database.
- Build `uploads_index/` dynamically per uploaded EPUB/PDF and clear it when the job is done.

## Retrieval Rules

- Use deterministic rule checks first.
- Retrieve standards and examples only when a correction is ambiguous.
- Auto-apply only high-confidence fixes.
- Send low-confidence corrections to manual review.

## Internal Data You Must Maintain

These are required to improve correction quality over time:

- `gold-corrections.jsonl`: approved before/after examples
- `manual-review-cases.jsonl`: corrections the model should not auto-apply
- `false-positive-log.jsonl`: words or patterns the current pipeline misclassifies
- `ocr-confusions.json`: common OCR substitutions such as `1 -> l`, `0 -> o`
- `do-not-split-words.json`: brand names, domain terms, protected compounds
- `do-not-merge-words.json`: valid open compounds that should stay separated
- `rule-registry.json`: for each rule, record source spec/tool and whether it is safe to autofix

## Draft Specs

Do not treat draft specs as production ground truth. Store them only in a separate future-compatibility bucket if needed:

- EPUB 3.4
- EPUB Reading Systems 3.4
- EPUB Accessibility 1.2

## Next Step

Use `manifest.json` as the source of truth for filenames, URLs, usage, and storage type.
