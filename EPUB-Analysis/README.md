# EPUB Backend API

Node.js and Express REST API for validating, auto-fixing, and converting EPUB files. The service checks EPUB structure, metadata, media, accessibility, and text-content quality, and can attach AI-generated correction guidance to failed findings.

## Features

- Validate EPUB files against metadata, structure, media, accessibility, navigation, and text-content rules
- Detect text-content issues such as broken hyphenation, merged text, OCR-like corruption, placeholder copy, and invalid entities
- Generate snippet-aware LLM suggestions for missing or incorrect text findings
- Auto-fix common EPUB issues such as spine, NCX, nav, and accessibility problems
- Convert PDF files to EPUB3 format with Calibre

## Tech Stack

- Runtime: Node.js + Express
- File handling: `adm-zip`, `multer`, `archiver`
- XML parsing: `fast-xml-parser`
- Media validation: `sharp`, `ffprobe`
- EPUB content parsing: `jsdom`
- PDF conversion: Calibre (`ebook-convert`)
- AI suggestions: HTTP LLM service via `undici`

## Prerequisites

- Node.js 14+
- Calibre installed for the `/convert` endpoint
- On Windows, the backend expects `C:\Program Files\Calibre2\ebook-convert.exe`

## Installation

```bash
npm install
```

## Running the Server

```bash
# Development
npm run dev

# Production
npm start
```

The server listens on `http://localhost:9000`.

## API Endpoints

### `POST /validate`

Upload an EPUB file and receive a validation report.

Request:

- Content type: `multipart/form-data`
- Field: `file`

Response shape:

```json
{
  "summary": {
    "totalRules": 53,
    "passing": 45,
    "failing": 5,
    "warnings": 3
  },
  "results": [
    {
      "id": "T_MISSING_INCORRECT_TEXT",
      "title": "Possible missing or incorrect text detected",
      "status": "fail",
      "details": {
        "count": 2,
        "files": ["OEBPS/chapter01.xhtml"],
        "samples": [
          {
            "file": "OEBPS/chapter01.xhtml",
            "type": "ocr-like-token",
            "snippet": "b0ok",
            "excerpt": "This b0ok should be reviewed before release."
          }
        ]
      },
      "suggestion": "\"b0ok\" -> \"book\"; review the remaining flagged snippets against the source PDF."
    }
  ]
}
```

### `POST /autofix`

Upload an EPUB plus the validation report and receive a downloadable fixed EPUB id.

Request:

- Content type: `multipart/form-data`
- Fields:
  - `file`
  - `report`

Response:

```json
{
  "success": true,
  "fixedEpubId": "uuid-string"
}
```

### `GET /download/:id`

Download a fixed EPUB by id.

### `POST /convert`

Convert a PDF file to EPUB3.

Request:

- Content type: `multipart/form-data`
- Field: `pdf`

## Project Structure

```text
server.js
src/
  validateEpub.js
  checks/
    metadata-checks.js
    media-checks.js
    accessibility-checks.js
    text-content-checks.js
    structure-checks.js
  autofix/
  fixes/
  generators/
  utils/
    ai-enricher.js
    ai-suggest.js
    epub-context.js
    text-suggest.js
    spine-utils.js
uploads/
outputs/
```

## Validation Rule Categories

| Category | Example Rule IDs | Description |
| --- | --- | --- |
| Metadata | `M_LANGUAGE`, `M_IDENTIFIER` | OPF metadata presence and format |
| Structure | `S_MIMETYPE`, `S_OPF_PATH`, `S_NO_NAVIGATION` | EPUB package integrity and navigation structure |
| Media | `Media_IMAGE_*`, `Media_AUDIO_*` | Media type, format, and asset validation |
| Accessibility | `A_HTML_LANG_MISSING`, `A_LINK_TEXT_MISSING` | Accessibility metadata and HTML accessibility heuristics |
| Text & Content | `T_HYPHENATION_WORD_MERGE`, `T_MISSING_INCORRECT_TEXT`, `T_SPECIAL_CHAR_ENTITY` | Text corruption, placeholders, merged words, and encoding issues |
| Navigation | `NCX_SPINE_MISMATCH`, `NAV_SPINE_MATCH` | NCX and nav.xhtml consistency |

## Text & Content Feature

The Text & Content validator currently covers:

- Hyphenation and merged-word detection
- Missing or incorrect text detection using placeholder and OCR-like heuristics
- Special character, mojibake, invalid entity, and control-character detection
- LLM-backed correction suggestions for missing or incorrect text findings

The missing/incorrect text suggestion helper uses `EPUB_LLM_ENDPOINT` when set. If it is not set, it falls back to the existing internal validation endpoint.

For autofix, you can enable an additional LLM pass on unresolved text reviews:

- `ENABLE_TEXT_LLM_AUTOFIX=true`

This second pass is applied only after the deterministic + RAG-gated normalization step and only when manual-review snippets remain.

By default, quoted replacements coming from validation-report suggestion text are not auto-applied to content. To opt in:

- `ENABLE_REPORT_SUGGESTION_REPLACEMENTS=true`

## Debug Logging

Use these environment flags to get structured pipeline logs:

- `PIPELINE_DEBUG=true` enables all debug channels
- `RAG_DEBUG=true` enables RAG retrieval/decision logs
- `LLM_DEBUG=true` enables LLM request/fallback logs

Example output labels:

- `[PIPELINE DEBUG]` autofix orchestration and pass summaries
- `[RAG DEBUG]` text change evidence and apply/reject decisions
- `[LLM DEBUG]` request lifecycle (remote, fallback, latency)

## Notes

- The backend stores fixed EPUB files in `outputs/` until they are cleaned up manually.
- The `/convert` endpoint requires Calibre; the rest of the validator can run without it.
- The service is stateless and does not require a database.
