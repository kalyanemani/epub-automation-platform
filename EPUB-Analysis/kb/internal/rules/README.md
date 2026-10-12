# Internal Rule Tables

These files support evidence-gated autofix and review policy.

## Files

- `rule-registry.json`
  Rule ownership, source of truth, and safe-autofix policy
- `ocr-confusions.json`
  OCR substitution tables and confidence hints
- `do-not-split-words.json`
  Protected compounds and domain terms
- `do-not-merge-words.json`
  Valid open compounds that must stay separated

## Maintenance Rules

- Treat `rule-registry.json` as the editorial control plane for autofix safety.
- Add domain-specific terms only after review.
- Keep OCR confusions small and explainable.
- If a protected term causes repeated failures, add it here rather than broadening LLM behavior.
