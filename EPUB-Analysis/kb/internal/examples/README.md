# Internal Example Corpora

These files are intentionally scaffolded empty so placeholder content does not pollute retrieval.

Add only approved, real examples from reviewed validation and autofix runs.

## Files

- `gold-corrections.jsonl`
  Use for safe, approved before and after corrections
- `manual-review-cases.jsonl`
  Use for cases that should stay manual review
- `false-positive-log.jsonl`
  Use for patterns the system should learn to ignore or downgrade

## JSONL Schema

Each line should be a single JSON object.

### `gold-corrections.jsonl`

```json
{"issue_id":"T_MISSING_INCORRECT_TEXT","document_type":"epub","file":"OEBPS/text/chapter01.xhtml","original":"b0ok","replacement":"book","change_type":"ocr-like-token","approved":true,"source":"manual_review","notes":"Confirmed against source copy"}
```

### `manual-review-cases.jsonl`

```json
{"issue_id":"T_MISSING_INCORRECT_TEXT","document_type":"epub","file":"OEBPS/text/chapter02.xhtml","snippet":"lead","candidate":"led","decision":"manual_review","reason":"ambiguous context"}
```

### `false-positive-log.jsonl`

```json
{"issue_id":"T_HYPHENATION_WORD_MERGE","document_type":"epub","file":"OEBPS/text/chapter03.xhtml","snippet":"well being","decision":"valid_open_compound","notes":"Do not auto-merge"}
```

## Rules

- Do not add synthetic placeholders here.
- Do not add bulk exports without review.
- Prefer short, bounded examples tied to one issue and one decision.
- Keep examples representative of real customer content.
