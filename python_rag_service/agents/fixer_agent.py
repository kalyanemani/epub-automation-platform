"""FixerAgent: generates fix patches using RAG context from KBAgent — parallel batch mode."""
import asyncio
import re
from agents.base_agent import BaseAgent
from ollama_client import ollama_generate

_FIX_TIMEOUT = 90    # seconds per LLM call
_PARALLEL_BATCH = 4  # 4 concurrent LLM calls — safe on 32 GB with local Ollama


# Valid CSS property names (subset) used to validate LLM output and avoid hallucinated properties
_VALID_CSS_PROPS = {
    "font-size","font-weight","font-style","font-family","font-variant",
    "line-height","letter-spacing","word-spacing","text-align","text-indent",
    "text-decoration","text-transform","text-overflow","color","background",
    "background-color","background-image","background-position","background-repeat",
    "background-size","margin","margin-top","margin-bottom","margin-left","margin-right",
    "padding","padding-top","padding-bottom","padding-left","padding-right",
    "border","border-top","border-bottom","border-left","border-right",
    "border-radius","border-collapse","border-spacing","width","height",
    "max-width","max-height","min-width","min-height","display","position",
    "top","bottom","left","right","float","clear","overflow","overflow-x","overflow-y",
    "visibility","opacity","z-index","flex","flex-direction","justify-content",
    "align-items","align-self","flex-wrap","grid","column-count","column-gap",
    "list-style","list-style-type","white-space","word-wrap","overflow-wrap",
    "word-break","page-break-before","page-break-after","page-break-inside",
    "content","counter-reset","counter-increment","cursor","outline",
    "vertical-align","table-layout","caption-side","empty-cells",
    "hyphens","writing-mode","direction","unicode-bidi",
    "-epub-hyphens","-epub-word-break","-epub-text-overflow","-epub-writing-mode",
}


_CSS_INSTRUCTIONS = """
CSS / HTML fix rules — GROUND EVERY FIX IN THE FILE CONTENT SHOWN ABOVE.

ANTI-HALLUCINATION RULES:
- If the file content is shown, your fix MUST reference actual lines/selectors from that file.
- Only output CSS property names from the standard CSS specification.
- For missing-hyphen typos (fontsize, textalign, lineheight, fontfamily): output the corrected property:value pair.
  Example: fontsize: 90% → font-size: 90%
- For unit typos (1p solid → 1px solid, bare 'em' → '1em'): output the corrected value.
- For -epub- vendor prefixes: also output the standard equivalent.
  Example: -epub-hyphens: auto → add: hyphens: auto

ISSUE-SPECIFIC RULES:
- CSS syntax error / invalid declaration → output ONLY the corrected declaration (property: value;)
  Valid properties: font-size, text-align, font-family, line-height, text-indent, font-weight, etc.
  Never invent property names. If property is truly unknown → output: /* removed */
- CSS font fallback missing → append generic family. Example: "Optima", Times, serif
- CSS responsive/layout → output a complete rule block. Example: table { max-width:100%; overflow-x:auto; }
- CSS broken reference → output ONLY the corrected relative path. Example: ../css/styles.css
- Date suspicious (M_DATE) → output ISO-8601 ONLY. Example: 2022-04-26
- HTML lang missing → output BCP-47 tag ONLY. Example: en
- Link text missing → output descriptive text ONLY. Example: View chapter 3
- Media src missing → output relative path ONLY. Example: images/fig1.png
- Audio controls missing → output: controls
- JS reference broken → output corrected path. Example: ../js/script.js

CRITICAL: You MUST output a fix. CANNOT_FIX is only for broken internal links or missing external files."""


class FixerAgent(BaseAgent):
    agent_id = "fixer_agent"
    system_prompt = """You are an EPUB repair specialist. For each issue, output ONLY the raw value that directly fixes the problem.

General rules:
- Language missing/wrong → output a BCP-47 language tag ONLY. Example: en
- Alt text missing/empty → output a short meaningful description of the image
- Publisher missing → output the publisher name ONLY
- Date missing or suspicious → output ISO-8601 date ONLY. Example: 2024-01-01
- Heading wrong level → output ONLY the correct tag name. Example: h2
- Text content error → output ONLY the corrected text string

Do NOT output HTML, XML, property names, explanations, or markdown.
Output the raw fix value ONLY, wrapped in <fix> tags.
ALWAYS output a best-effort fix. Use CANNOT_FIX ONLY when the issue is purely structural
(broken internal links, missing font files) and no text value can help."""
    default_policies = {
        "max_context_chunks": 5,
        "temperature": 0.1,
        "codegen_for_css_js": True,
    }

    async def _fix_single(
        self, issue: dict, kb_context: str, run_id: str, fast_mode: bool = False
    ) -> dict:
        issue_id = issue.get("id", "")
        if fast_mode:
            task_type = "structured"
        elif issue.get("_task_type"):
            task_type = issue["_task_type"]  # from TriageAgent decision
        elif any(k in issue_id.lower() for k in ("css", "js", "script", "font", "layout", "responsive")):
            task_type = "codegen"
        elif any(k in issue_id.lower() for k in ("alt", "img", "image", "media")):
            task_type = "vision"
        else:
            task_type = "reasoning"
        # Include file content if available (injected by main.py before this call)
        file_section = ""
        if issue.get("_file_content"):
            file_section = (
                f"\n\nFILE: {issue.get('_file_name', 'file')}\n"
                f"```\n{issue['_file_content']}\n```"
            )

        extra_instructions = _CSS_INSTRUCTIONS if task_type in ("codegen", "structured") else ""

        # Location summary for grounding
        loc = issue.get("location", {})
        if isinstance(loc, dict):
            loc_str = f"file={loc.get('file','?')} line={loc.get('line','?')}"
        else:
            loc_str = str(loc)

        # Details — prefer structured sample info over raw string
        details = issue.get("details", "")
        if isinstance(details, dict):
            samples = details.get("samples", [])
            if samples:
                sample_lines = "; ".join(
                    f"line {s.get('line','?')}: {s.get('property','?')}: {s.get('value','?')}"
                    for s in samples[:4]
                )
                details_str = f"count={details.get('count',1)}, samples=[{sample_lines}]"
            else:
                details_str = str(details)[:600]
        else:
            details_str = str(details)[:600]

        prompt = f"""{self.system_prompt}
{extra_instructions}
ISSUE:
ID: {issue_id}
Title: {issue.get("title")}
Location: {loc_str}
Details: {details_str}
{file_section}
KNOWLEDGE BASE CONTEXT (grounded in this epub's actual content):
{kb_context[:2400] if kb_context else "(none)"}

INSTRUCTION: Base your fix on the FILE CONTENT and KB CONTEXT above.
Generate the fix now. Output ONLY <fix>...</fix>."""

        model_used = "unknown"
        task_type_used = task_type
        try:
            cached = await self.memory.get_cached_prompt(prompt)
            if cached:
                fix_text = cached
                from_cache = True
                model_used = "cache"
            else:
                for attempt in range(2):  # retry once on transient connection failures
                    try:
                        resp = await asyncio.wait_for(
                            ollama_generate(prompt, task_type=task_type, temperature=0.1),
                            timeout=_FIX_TIMEOUT,
                        )
                        fix_text = resp["response"]
                        model_used = resp.get("model", "unknown")
                        await self.memory.cache_prompt(prompt, fix_text)
                        from_cache = False
                        break
                    except Exception as exc:
                        if attempt == 0:
                            print(f"[fixer] {issue_id} attempt 1 failed ({type(exc).__name__}), retrying in 3s...")
                            await asyncio.sleep(3)
                        else:
                            raise
        except Exception as exc:
            print(f"[fixer] {issue_id} LLM error ({type(exc).__name__}): {exc}")
            fix_text = "<fix>CANNOT_FIX</fix>"
            from_cache = False
            model_used = "error"

        match = re.search(r"<fix>(.*?)</fix>", fix_text, re.DOTALL)
        if match:
            patch = match.group(1).strip()
        else:
            first_line = next(
                (ln.strip() for ln in fix_text.splitlines() if ln.strip()),
                "CANNOT_FIX",
            )
            patch = first_line if len(first_line) <= 300 else "CANNOT_FIX"
            if patch != "CANNOT_FIX":
                print(f"[fixer] {issue_id} no <fix> tags — using first line: {patch!r}")

        # ── CSS property grounding check ──────────────────────────────────
        # If the LLM proposed a CSS declaration, validate the property name
        # against the known-valid set to catch hallucinated property names.
        if patch and patch not in ("CANNOT_FIX", "NONE") and task_type in ("codegen", "structured"):
            prop_m = re.match(r'^([\w-]+)\s*:', patch)
            if prop_m:
                proposed_prop = prop_m.group(1).lower()
                # Allow vendor prefixes and known properties
                is_valid = (
                    proposed_prop in _VALID_CSS_PROPS
                    or proposed_prop.startswith(("-epub-", "-webkit-", "-moz-", "-ms-"))
                    or proposed_prop.startswith("/*")
                )
                if not is_valid:
                    print(f"[fixer] {issue_id} hallucinated CSS property {proposed_prop!r} — clearing patch")
                    patch = "CANNOT_FIX"

        print(f"[fixer] {issue_id} patch={patch!r} fixable={patch not in ('CANNOT_FIX','NONE','')}")

        await self.memory.log_episode(
            agent_id=self.agent_id,
            action="fix",
            context={"issue_id": issue_id},
            outcome={"fixable": patch != "CANNOT_FIX"},
            run_id=run_id,
        )
        return {
            "issue_id":   issue_id,
            "patch":      patch,
            "fixable":    patch not in ("CANNOT_FIX", "NONE", ""),
            "from_cache": from_cache,
            "model_used": model_used,
            "task_type":  task_type_used,
        }

    async def run(self, task: dict) -> dict:
        issues = task.get("issues", [])
        kb_context = task.get("kb_context", "")
        run_id = task.get("run_id", "")
        fast_mode = task.get("fast_mode", False)

        results: list = []
        # Process in parallel batches to avoid overwhelming Ollama
        for i in range(0, len(issues), _PARALLEL_BATCH):
            batch = issues[i : i + _PARALLEL_BATCH]
            batch_results = await asyncio.gather(
                *[self._fix_single(iss, kb_context, run_id, fast_mode) for iss in batch],
                return_exceptions=True,
            )
            for r in batch_results:
                if isinstance(r, Exception):
                    results.append(
                        {"issue_id": "unknown", "patch": "CANNOT_FIX", "fixable": False}
                    )
                else:
                    results.append(r)

        return {
            "status": "ok",
            "fixes": results,
            "fixed_count": sum(1 for r in results if r.get("fixable")),
            "unfixable_count": sum(1 for r in results if not r.get("fixable")),
        }
