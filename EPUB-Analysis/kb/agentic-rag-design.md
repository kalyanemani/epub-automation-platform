# Agentic RAG Design For EPUB/PDF Validation And Fixing

This design is for the current `EPUB-Analysis` backend, where uploaded input may be either `.epub` or `.pdf`, and the system needs to:

- validate structure and text quality
- fetch related authoritative guidance from approved external sources
- use local and external knowledge to propose safe fixes
- only auto-apply fixes that pass deterministic checks and confidence gates

## Design Goal

Use agentic retrieval to improve ambiguous fixes, but keep deterministic validators in control.

The model should not freely browse the internet and directly edit content. Instead:

1. the validator identifies a specific issue
2. the retrieval layer gathers evidence from trusted corpora
3. the fixer proposes a bounded change
4. the verifier reruns deterministic checks
5. the policy layer decides whether to auto-apply or flag for manual review

## Core Principle

`Rule engine first, retrieval second, generation last`

This avoids turning a validation pipeline into an unconstrained chatbot.

## Recommended Agents

These can be implemented as logical roles inside one orchestrator service. They do not need to be separate runtime models on day one.

### 1. Classifier Agent

Input:

- validation issue id
- issue category
- document type
- local evidence from uploaded file

Output:

- `fix_mode`: `deterministic`, `lookup_only`, `rag_assisted`, or `manual_review`
- `evidence_targets`: which corpora to query

Examples:

- `NCX_SPINE_MISMATCH` -> `deterministic`
- `T_SPECIAL_CHAR_ENTITY` -> `lookup_only`
- `T_MISSING_INCORRECT_TEXT` -> `rag_assisted`
- uncertain alt-text or accessibility interpretation -> `rag_assisted` or `manual_review`

### 2. Retrieval Agent

This agent never applies fixes. It only collects evidence.

It should query in this order:

1. local upload index
2. local curated KB
3. external allowlisted sources if local KB is insufficient

Output:

- retrieved chunks
- source metadata
- trust score
- whether the source is authoritative or informative

### 3. Fix Generator Agent

Input:

- issue details
- retrieved evidence
- allowed edit scope

Output:

- structured patch proposal
- confidence score
- evidence citations
- refusal if evidence is insufficient

It must never output a free-form long explanation as the primary artifact. It should return structured data such as:

```json
{
  "issue_id": "T_MISSING_INCORRECT_TEXT",
  "action": "replace_text",
  "target_file": "OEBPS/text/chapter01.xhtml",
  "original": "b1ade",
  "replacement": "blade",
  "confidence": 0.96,
  "evidence": [
    {
      "source_type": "upload_context",
      "location": "chapter01 line 13"
    },
    {
      "source_type": "kb_example",
      "location": "gold-corrections.jsonl#sample-102"
    }
  ]
}
```

### 4. Verifier Agent

This agent reruns deterministic checks after a patch is proposed.

It must answer:

- did the targeted error go away
- did any new errors appear
- did semantic quality degrade
- is the output still structurally valid

If verification fails, reject the patch.

### 5. Policy Agent

This is effectively a rules engine, not necessarily an LLM.

It decides:

- whether a fix can be auto-applied
- whether the evidence meets trust requirements
- whether confidence is high enough
- whether a human review is required

## Retrieval Layers

### A. Upload-Specific Index

Build this per job and delete it after completion unless audit retention is required.

For EPUB:

- OPF metadata
- manifest and spine
- nav and NCX entries
- XHTML documents
- headings
- paragraph blocks
- line-level excerpts where possible

For PDF:

- page text
- blocks
- line text
- coordinates
- OCR confidence if available

This is the highest-priority retrieval source for text correction because it is the closest evidence to the source file.

### B. Curated KB Index

Use the folders defined in `kb/manifest.json`.

Relevant corpora:

- W3C standards
- DAISY guidance
- EPUBCheck references
- Ace references
- internal correction examples

### C. Lookup Stores

These are not vector corpora.

Use direct lookup for:

- dictionaries
- Unicode mappings
- HTML entities
- hyphenation patterns
- OCR confusion tables
- protected words

### D. External Fetch Layer

Use only when the local curated KB does not contain the needed source.

External fetches must:

- be restricted to allowlisted domains
- be content-sanitized before indexing
- be stored as immutable snapshots with hashes
- be tagged with fetch time and source URL

## Security Model

### 1. Strict Domain Allowlist

Use `kb/source-allowlist.json` as the primary policy file.

Allow only trusted domains such as:

- `w3.org`
- `html.spec.whatwg.org`
- `unicode.org`
- `kb.daisy.org`
- `daisy.org`
- `github.com/w3c/epubcheck`
- `github.com/daisy/ace`
- `github.com/en-wl/wordlist`
- `github.com/LibreOffice/dictionaries`
- `github.com/hunspell/hyphen`

### 2. Prompt Injection Defense

Treat every fetched page as untrusted content, even if the domain is trusted.

Rules:

- never execute scripts from fetched content
- strip scripts, forms, inline event handlers, and active content
- do not let retrieved text override system instructions
- tell the fixer model explicitly that retrieved text is reference material, not executable instruction

### 3. Immutable Snapshotting

For each external fetch, store:

- raw content
- normalized text
- content hash
- source URL
- fetch timestamp
- content type

This makes the retrieval auditable and reproducible.

### 4. Read/Write Separation

The retrieval layer should not have write access to the uploaded EPUB/PDF.

Recommended boundary:

- fetcher: network only
- retriever: read-only KB access
- fixer: write to temp copy only
- verifier: read temp output and run validators
- publisher: finalize output only after policy approval

### 5. Confidence Thresholds

Suggested defaults:

- structural deterministic fixes: auto-apply if validation passes
- lookup-based encoding fixes: auto-apply if exact mapping exists
- OCR or typo correction: auto-apply only if confidence >= `0.95`
- grammar and semantic rewrites: manual review unless domain-specific evidence exists
- alt-text generation: manual review unless a tightly scoped rule allows it

## Query Routing

Use issue-type routing instead of one global retrieval query.

### Structural Issues

Examples:

- OPF
- spine
- nav
- NCX
- page list

Route to:

- upload-specific structure index
- W3C EPUB 3.3
- DAISY navigation guidance
- EPUBCheck corpus

### Text Normalization Issues

Examples:

- hyphenation
- merged words
- entities
- encoding artifacts
- OCR-like tokens

Route to:

- upload-specific text index
- dictionaries
- OCR confusion table
- hyphenation patterns
- gold correction examples

### Accessibility Issues

Examples:

- missing metadata
- landmark issues
- heading structure
- image description review

Route to:

- EPUB Accessibility 1.1
- EPUB Accessibility Techniques 1.1
- WCAG 2.2
- DAISY KB
- Ace references

## Recommended Data Stores

### SQL / Relational

Use for:

- rule registry
- source metadata
- audit trails
- correction decisions
- confidence and review status

### Vector Store

Use for:

- spec chunks
- DAISY guidance chunks
- tool-reference chunks
- approved example chunks
- upload-specific paragraph and line chunks

### Plain Lookup Files

Use for:

- HTML entities
- Unicode data
- OCR confusion tables
- do-not-split lists
- do-not-merge lists
- hyphenation exceptions

## Suggested Workflow

```text
Validate file
  -> classify issue
  -> query upload index
  -> query local KB
  -> if missing evidence, fetch from allowlisted external source
  -> build evidence bundle
  -> generate bounded fix
  -> apply in temp copy
  -> rerun validators
  -> pass/fail policy gate
  -> publish fixed file or manual review report
```

## What To Keep Deterministic

Keep these outside the LLM whenever possible:

- OPF parsing
- manifest/spine/nav/NCX comparisons
- HTML entity decode
- Unicode normalization
- exact replacement tables
- known OCR confusion mappings
- media path resolution
- file packaging and repacking

## Where Agentic RAG Helps Most

Use agentic retrieval only for:

- ambiguous missing/incorrect text fixes
- selecting the right standard section for an explanation
- accessibility interpretation where multiple conditions interact
- retrieving similar approved fixes from your internal example set

## Initial Rollout Recommendation

Phase 1:

- local KB only
- no live external fetch during fixing
- offline snapshots of approved sources

Phase 2:

- allowlisted external fetch with snapshot cache
- retrieval audit logs

Phase 3:

- adaptive query routing
- richer review policies
- trend analysis from false-positive logs

## Minimum Production Bar

Before enabling auto-apply for agentic fixes, require:

- source provenance on every fix
- deterministic validation after patching
- audit log of prompt, retrieved evidence, and result
- separate confidence threshold by issue type
- manual review path for low-confidence outcomes
