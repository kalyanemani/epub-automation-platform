# KB Population Status

Generated: 2026-07-20T06:26:05.724Z

## Summary

- Total sources: 38
- Populated: 34
- Missing: 4
- Empty: 0
- Fetchable missing or empty: 2
- Local import required: 2
- Internal sources pending content: 0

## By Category

- guidance: 6/6 populated
- internal: 7/7 populated
- lookups: 6/8 populated
- reading-systems: 1/1 populated
- standards: 11/11 populated
- tools: 3/5 populated

## Sources

| ID | Category | Ingest | Status | Files | Target | Next Action |
| --- | --- | --- | --- | ---: | --- | --- |
| ace-guide | tools | html | populated_file | 1 | kb/tools/ace/ace-guide.html | No action required. |
| ace-home | tools | html | populated_file | 1 | kb/tools/ace/ace-home.html | No action required. |
| daisy-landmarks | guidance | html | populated_file | 1 | kb/guidance/daisy/landmarks.html | No action required. |
| daisy-pagelist | guidance | html | populated_file | 1 | kb/guidance/daisy/pagelist.html | No action required. |
| daisy-pagenav | guidance | html | populated_file | 1 | kb/guidance/daisy/pagenav.html | No action required. |
| daisy-toc | guidance | html | populated_file | 1 | kb/guidance/daisy/toc.html | No action required. |
| epubcheck-releases | tools | html | populated_file | 1 | kb/tools/epubcheck/releases/releases.html | No action required. |
| epubcheck-repo | tools | git-repo | missing | 0 | kb/tools/epubcheck/repo | Run: node scripts/manage-kb.js import-local epubcheck-repo <local-path> |
| internal-do-not-merge | internal | json | populated_file | 1 | kb/internal/rules/do-not-merge-words.json | No action required. |
| internal-do-not-split | internal | json | populated_file | 1 | kb/internal/rules/do-not-split-words.json | No action required. |
| internal-false-positives | internal | jsonl | populated_file | 1 | kb/internal/examples/false-positive-log.jsonl | No action required. |
| internal-gold-corrections | internal | jsonl | populated_file | 1 | kb/internal/examples/gold-corrections.jsonl | No action required. |
| internal-manual-review | internal | jsonl | populated_file | 1 | kb/internal/examples/manual-review-cases.jsonl | No action required. |
| internal-ocr-confusions | internal | json | populated_file | 1 | kb/internal/rules/ocr-confusions.json | No action required. |
| internal-rule-registry | internal | json | populated_file | 1 | kb/internal/rules/rule-registry.json | No action required. |
| lookup-html-entities-json | lookups | json | populated_file | 1 | kb/lookups/entities/html-entities.json | No action required. |
| lookup-libreoffice-dictionaries | lookups | git-repo | populated_directory | 889 | kb/lookups/dictionaries/libreoffice | No action required. |
| lookup-scowl | lookups | git-repo-or-exported-sqlite | populated_directory | 127 | kb/lookups/dictionaries/scowl | No action required. |
| lookup-unicode-tr15 | lookups | html | populated_file | 1 | kb/lookups/unicode/tr15.html | No action required. |
| sprint2-layout-rules | standards | json | populated_file | 1 | kb/standards/layout-rules.json | No action required. |
| sprint2-script-rules | standards | json | populated_file | 1 | kb/standards/script-rules.json | No action required. |
| w3c-epub-33 | standards | html | populated_file | 1 | kb/standards/w3c/epub-33.html | No action required. |
| w3c-epub-a11y-11 | standards | html | populated_file | 1 | kb/standards/w3c/epub-a11y-11.html | No action required. |
| w3c-epub-a11y-tech-11 | standards | html | populated_file | 1 | kb/standards/w3c/epub-a11y-tech-11.html | No action required. |
| w3c-epub-rs-33 | standards | html | populated_file | 1 | kb/standards/w3c/epub-rs-33.html | No action required. |
| w3c-epub-ssv-11 | standards | html | populated_file | 1 | kb/standards/w3c/epub-ssv-11.html | No action required. |
| w3c-wcag-22 | standards | html | populated_file | 1 | kb/standards/w3c/wcag-22.html | No action required. |
| ace-repo | tools | git-repo | missing | 0 | kb/tools/ace/repo | Run: node scripts/manage-kb.js import-local ace-repo <local-path> |
| daisy-schema-accessmode | guidance | html | populated_file | 1 | kb/guidance/daisy/metadata-schema-org/accessMode.html | No action required. |
| daisy-schema-accessmodesufficient | guidance | html | populated_file | 1 | kb/guidance/daisy/metadata-schema-org/accessModeSufficient.html | No action required. |
| lookup-hunspell-hyphen | lookups | git-repo | populated_directory | 181 | kb/lookups/hyphenation/hunspell-hyphen | No action required. |
| lookup-unicode-data | lookups | text | missing | 0 | kb/lookups/unicode/UnicodeData.txt | Run: node scripts/manage-kb.js fetch lookup-unicode-data |
| lookup-unicode-normalization-test | lookups | text | missing | 0 | kb/lookups/unicode/NormalizationTest.txt | Run: node scripts/manage-kb.js fetch lookup-unicode-normalization-test |
| lookup-wordfreq | lookups | git-repo-or-pip-package-export | populated_directory | 130 | kb/lookups/dictionaries/wordfreq | No action required. |
| w3c-xml-10 | standards | html | populated_file | 1 | kb/standards/w3c/xml-10.html | No action required. |
| whatwg-html-syntax | standards | html | populated_file | 1 | kb/standards/w3c/html-syntax.html | No action required. |
| w3c-css-snapshot-2025 | standards | html | populated_file | 1 | kb/standards/w3c/css-snapshot-2025.html | No action required. |
| epubreader-net | reading-systems | html | populated_file | 1 | kb/references/epubreader/epubreader.net.html | No action required. |

## Notes

- `fetchable` sources can be ingested directly by `scripts/manage-kb.js fetch`.
- `local_import_required` sources are directories or exported assets that should be copied in from a local checkout or archive.
- Empty internal example corpora are intentional until real reviewed examples are added.