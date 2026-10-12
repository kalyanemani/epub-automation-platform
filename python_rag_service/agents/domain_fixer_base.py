"""
DomainFixerBase: shared infrastructure for all specialized domain fixer agents.

Each domain agent (CSS, JS, HTML/A11y, Metadata) subclasses this and sets:
  - agent_id       — unique agent name
  - system_prompt  — domain-specific LLM instructions
  - kb_collections — ordered list of ChromaDB collections to query
  - default_policies

Subclasses may override _validate_patch() for domain-specific output validation.

The KB lookup uses hybrid search (BM25 + dense) and stores results in short-term
memory (30 min TTL) keyed by collection + issue_id + query hash.
Each retrieved chunk's usage is recorded in long-term memory for adaptive caching.
"""
import asyncio
import re
from typing import Dict, List, Optional

from agents.base_agent import BaseAgent
from ollama_client import ollama_generate
from rag_engine import rag_engine as _rag_engine, RagPipelineEngine
from rag.hybrid_search import hybrid_search

_PARALLEL_BATCH = 16   # kept for reference; run() now fires all issues at once


def _human_location(issue: dict) -> str:
    """
    Build a precise, human-readable pre-fix location string from issue data.
    Uses samples (property/value/excerpt) for richer context than bare file:line.
    """
    loc     = issue.get("location", {})
    details = issue.get("details", {})

    file_path = loc.get("file", "") if isinstance(loc, dict) else ""
    line_num  = loc.get("line", "")  if isinstance(loc, dict) else ""

    filename = file_path.split("/")[-1] if file_path else ""

    # Build a rich detail string from the first sample
    detail_part = ""
    if isinstance(details, dict):
        samples = details.get("samples", [])
        count   = details.get("count", 0)
        if samples:
            s       = samples[0]
            prop    = s.get("property", "")
            val     = s.get("value", "")
            excerpt = (s.get("excerpt") or s.get("text") or "")[:80].strip()
            s_line  = s.get("line", line_num)
            s_file  = s.get("file", "")
            # Prefer sample-level file/line when more specific
            if s_file:
                filename = s_file.split("/")[-1]
            if s_line:
                line_num = s_line

            if prop and val:
                detail_part = f"property `{prop}: {val}`"
            elif prop:
                detail_part = f"property `{prop}`"
            elif excerpt:
                detail_part = f"near `{excerpt}`"

            extra = count - 1
            if extra > 0:
                detail_part += f" (+{extra} more occurrence{'s' if extra > 1 else ''})"

    # Assemble: "`filename` line N — detail"
    loc_parts = []
    if filename:
        loc_parts.append(f"`{filename}`" + (f" line {line_num}" if line_num else ""))
    if detail_part:
        loc_parts.append(detail_part)

    return " — ".join(loc_parts) if loc_parts else "location unknown"



class DomainFixerBase(BaseAgent):
    """
    Base for all domain fixer agents.  Subclasses define their system prompt,
    target KB collections, and optional patch validation.
    """

    # Override in subclasses
    kb_collections: List[str] = ["epub_rules"]
    score_threshold: float    = 0.35

    # ── KB lookup ─────────────────────────────────────────────────────────────

    async def _get_kb_context(
        self, issues: List[dict], epub_collection: str
    ) -> Dict[str, dict]:
        """
        Hybrid KB lookup for a list of issues — fully parallel.
        All issues are looked up concurrently (asyncio.gather), and within
        each issue all KB collections are searched in parallel too.
        Returns {issue_id: {context_text, chunks, kb_hits}} per issue.
        Results are cached 30 min in short-term memory.
        """
        loop = asyncio.get_event_loop()
        # Initialize embedding model once before going parallel (no-op after first call)
        await loop.run_in_executor(None, _rag_engine.initialize_models)

        async def _lookup_one(issue: dict):
            iid   = issue.get("id", "")
            query = f"{issue.get('title', '')} {str(issue.get('details', ''))[:200]}"
            cache_key = f"{self.agent_id}_kb:{epub_collection}:{iid}:{hash(query)}"

            cached = await self.memory.get_short(cache_key)
            if cached:
                print(f"[{self.agent_id}] KB cache hit for {iid}")
                return iid, cached

            instruction = f"Represent this EPUB issue for retrieval: {query}"
            vecs = await loop.run_in_executor(
                None, _rag_engine.generate_embeddings, [instruction]
            )
            query_vec = vecs[0].tolist()

            cols: List[str] = []
            if epub_collection:
                cols.append(epub_collection)
            for c in self.kb_collections:
                if c not in cols:
                    cols.append(c)

            # Search all collections in parallel
            async def _search_col(col: str):
                try:
                    return col, await hybrid_search(
                        self.memory, col, query, query_vec,
                        limit=4, score_threshold=self.score_threshold,
                    )
                except Exception as exc:
                    print(f"[{self.agent_id}] KB search error in '{col}': {exc}")
                    return col, []

            col_results = await asyncio.gather(*[_search_col(c) for c in cols])

            merged: list  = []
            seen_ids: set = set()
            for col, results in col_results:
                for r in results:
                    rid = str(r.get("id", ""))
                    if rid not in seen_ids:
                        seen_ids.add(rid)
                        r["_col"] = col
                        merged.append(r)

            merged.sort(key=lambda x: x["score"], reverse=True)
            merged = merged[:6]

            context_parts = []
            for r in merged:
                p    = r.get("payload", {})
                col  = r.get("_col", "?")
                bm25 = r.get("_bm25_boost", 0.0)
                tag  = f"[{col} | dense+bm25 score:{r['score']:.2f} bm25_boost:{bm25:.2f}]"
                if col.startswith("epub_") and col != "epub_rules":
                    file_loc = f"{p.get('file','')}:{p.get('line_start','')}–{p.get('line_end','')}"
                    context_parts.append(f"{tag}\n[FILE: {file_loc}]\n{p.get('content','')}")
                else:
                    context_parts.append(f"{tag}\n[{p.get('rule_id','?')}] {p.get('title','')}: {p.get('content','')}")

            context_text = "\n\n".join(context_parts)

            if merged:
                hit_summary = ", ".join(f"{r.get('_col','?')}:{r['score']:.2f}" for r in merged)
                print(f"[{self.agent_id}] KB hits for {iid}: [{hit_summary}]")
            else:
                print(f"[{self.agent_id}] KB: no hits for {iid} (threshold={self.score_threshold})")

            entry = {
                "context_text": context_text,
                "chunks":       len(merged),
                "kb_hits":      [{"id": r["id"], "col": r.get("_col"), "score": r["score"]} for r in merged],
            }
            await self.memory.set_short(cache_key, entry, ttl=1800)
            # Fire usage tracking as background task — non-blocking
            async def _track():
                for r in merged:
                    await self.memory.long.increment_kb_usage(str(r.get("id", "")), r.get("_col", ""))
            asyncio.ensure_future(_track())
            return iid, entry

        # All issues looked up concurrently
        pairs = await asyncio.gather(*[_lookup_one(iss) for iss in issues], return_exceptions=True)
        context_map: Dict[str, dict] = {}
        for i, result in enumerate(pairs):
            if isinstance(result, Exception):
                iid = issues[i].get("id", "")
                print(f"[{self.agent_id}] KB lookup failed for {iid}: {result}")
                context_map[iid] = {"context_text": "", "chunks": 0, "kb_hits": []}
            else:
                iid, entry = result
                context_map[iid] = entry
        return context_map

    # ── Patch validation (override in subclasses for domain checks) ───────────

    def _validate_patch(self, patch: str, issue_id: str) -> str:
        """Default: pass-through. Subclasses apply domain-specific checks."""
        return patch

    # ── Single issue fix ──────────────────────────────────────────────────────

    async def _fix_single(
        self, issue: dict, context_text: str, run_id: str
    ) -> dict:
        issue_id  = issue.get("id", "")
        # Use agent's own task_type (controls model tier selection);
        # fall back to issue's _task_type, then "structured" as safe default.
        task_type = (
            self.default_policies.get("task_type")
            or issue.get("_task_type")
            or "structured"
        )

        pre_location = _human_location(issue)

        loc = issue.get("location", {})
        loc_str = pre_location  # use human-readable form in prompt too

        details = issue.get("details", "")
        targeted_fix_section = ""
        if isinstance(details, dict):
            samples = details.get("samples", [])
            if samples:
                details_str = "count={}, samples=[{}]".format(
                    details.get("count", 1),
                    "; ".join(
                        f"line {s.get('line','?')}: {s.get('property','?')}: {s.get('value','?')}"
                        for s in samples[:4]
                    ),
                )
                # For codegen (CSS/JS) issues: surface the first broken declaration
                # prominently so the LLM treats it as the primary thing to fix.
                if task_type == "codegen" and samples:
                    s0 = samples[0]
                    prop = s0.get("property", "")
                    val  = s0.get("value", "")
                    excerpt = s0.get("excerpt", "")
                    class_name = s0.get("className", "") or s0.get("selector", "")
                    if prop and val:
                        targeted_fix_section = (
                            f"\n\n★ BROKEN DECLARATION TO FIX (line {s0.get('line','?')}):\n"
                            f"  {prop}: {val};\n"
                            f"  → Output the corrected declaration inside <fix>...</fix>"
                        )
                    elif class_name:
                        # CSS class selector missing — surface the actual class name
                        dot_class = class_name if class_name.startswith(".") else f".{class_name}"
                        tag = s0.get("tag", "")
                        text_snippet = (s0.get("text", "") or "")[:60].strip()
                        extra_count = s0.get("occurrenceCount", 1) - 1
                        targeted_fix_section = (
                            f"\n\n★ MISSING CSS CLASS TO DEFINE:\n"
                            f"  Class name: {dot_class}\n"
                            + (f"  Used on <{tag}> element" if tag else "")
                            + (f" with text: {text_snippet!r}" if text_snippet else "")
                            + (f" ({extra_count} occurrences)" if extra_count > 0 else "")
                            + f"\n  → Output the CSS rule for {dot_class} inside <fix>...</fix>"
                        )
                    elif excerpt:
                        targeted_fix_section = (
                            f"\n\n★ BROKEN CODE TO FIX:\n"
                            f"  {excerpt}\n"
                            f"  → Output the corrected value inside <fix>...</fix>"
                        )
            else:
                details_str = str(details)[:400]
        else:
            details_str = str(details)[:400]

        file_section = ""
        if issue.get("_file_content"):
            file_section = (
                f"\n\nFILE: {issue.get('_file_name', 'file')}\n"
                f"```\n{issue['_file_content']}\n```"
            )

        prompt = (
            f"{self.system_prompt}\n\n---\n\n"
            f"ISSUE:\n"
            f"ID: {issue_id}\n"
            f"Title: {issue.get('title')}\n"
            f"Location: {loc_str}\n"
            f"Details: {details_str}"
            f"{targeted_fix_section}"
            f"{file_section}\n\n"
            f"KB CONTEXT:\n"
            f"{context_text[:2000] if context_text else '(none)'}\n\n"
            f"Generate the fix now. Output exactly:\n"
            f"<fix>the corrected code or value</fix>\n"
            f"<confidence>0-100</confidence>\n"
            f"<reason>one sentence explaining why this fix is correct</reason>"
        )

        model_used = "unknown"
        from_cache = False
        fix_text   = "<fix>CANNOT_FIX</fix>"

        try:
            cached = await self.memory.get_cached_prompt(prompt)
            if cached:
                fix_text   = cached
                from_cache = True
                model_used = "cache"
            else:
                # ollama_generate handles the full 3-tier fallback internally:
                #   Tier 1: remote Ollama (60s)
                #   Tier 2: Fireworks AI  (45s)
                #   Tier 3: local Ollama  (90s)
                resp = await ollama_generate(
                    prompt, task_type=task_type, temperature=0.1
                )
                fix_text   = resp["response"]
                model_used = resp.get("model", "unknown")
                await self.memory.cache_prompt(prompt, fix_text)
                from_cache = False
        except Exception as exc:
            print(f"[{self.agent_id}] {issue_id} LLM error ({type(exc).__name__}): {exc}")
            model_used = "error"

        # Extract <fix> tag
        match = re.search(r"<fix>(.*?)</fix>", fix_text, re.DOTALL)
        if match:
            patch = match.group(1).strip()
            # Strip any nested <fix>...</fix> tags the LLM accidentally included
            patch = re.sub(r"</?fix>", "", patch).strip()
        else:
            first = next(
                (ln.strip() for ln in fix_text.splitlines() if ln.strip()), "CANNOT_FIX"
            )
            patch = first if len(first) <= 300 else "CANNOT_FIX"
            if patch != "CANNOT_FIX":
                # Strip any stray <fix> tags the LLM put on the same line
                patch = re.sub(r"</?fix>", "", patch).strip() or "CANNOT_FIX"
                print(f"[{self.agent_id}] {issue_id} no <fix> tags — using first line: {patch!r}")

        # Extract <confidence> (0-100) and <reason>
        conf_match   = re.search(r"<confidence>\s*(\d+)\s*</confidence>", fix_text)
        reason_match = re.search(r"<reason>(.*?)</reason>", fix_text, re.DOTALL)
        confidence   = int(conf_match.group(1)) if conf_match else None
        fix_reason   = reason_match.group(1).strip() if reason_match else ""

        # For L_CSS_CLASS_SELECTOR_MISSING: substitute real class name if LLM
        # output the generic placeholder '.missing-class'
        if issue_id.upper() == "L_CSS_CLASS_SELECTOR_MISSING" and ".missing-class" in patch.lower():
            real_class = ""
            if isinstance(details, dict):
                samps = details.get("samples", [])
                if samps:
                    raw = samps[0].get("className", "") or samps[0].get("selector", "")
                    real_class = raw.strip()
            if real_class:
                dot = real_class if real_class.startswith(".") else f".{real_class}"
                patch = re.sub(r"\.missing-class", dot, patch, flags=re.I)
                print(f"[{self.agent_id}] {issue_id} substituted placeholder → {dot}")

        # Domain-specific validation
        patch = self._validate_patch(patch, issue_id)
        # Reject placeholder / nonsense patches the LLM sometimes emits
        _JUNK = {
            "CANNOT_FIX", "NONE", "", "...", "…", "N/A", "n/a", "null", "undefined",
            # LLM prompt-template echoes
            "the corrected code or value", "corrected code or value",
            "the fix", "fix here", "insert fix here", "your fix here",
            "the corrected value", "corrected value",
        }
        _patch_lower = patch.lower().strip()
        # Gap 5 guard: reject CSS template placeholders (class-name, property, value)
        _has_placeholder = bool(re.search(
            r"\bclass-name\b|\bproperty-name\b|\bproperty:\s*value\b|\byour-[a-z]",
            _patch_lower,
        ))
        fixable = (
            patch not in _JUNK
            and _patch_lower not in _JUNK
            and len(patch.strip()) >= 2   # allow short attribute values (e.g. lang='en')
            and not _has_placeholder
            # Reject reasoning / review-instruction text that escaped agent-level validation
            and not re.match(r"^(tags\b|manual|please review|check |verify |ensure |you (should|must|need)|this (requires|needs)|we are |we need|we can |the fix|perhaps we|for broken|asked to fix|since the issue)", _patch_lower)
        )

        # Downgrade confidence if patch failed validation or looks malformed
        if not fixable:
            confidence = 0
        elif patch.startswith("<fix>") or "<fix>" in patch:
            confidence = min(confidence or 30, 30)  # LLM didn't close tags properly
        elif confidence is None:
            confidence = 50  # fixable but LLM omitted the <confidence> tag — use neutral default

        conf_str = f" confidence={confidence}%" if confidence is not None else ""
        print(f"[{self.agent_id}] {issue_id} -> patch={repr(patch)[:80]} fixable={fixable}{conf_str}")

        await self.memory.log_episode(
            agent_id=self.agent_id,
            action="fix",
            context={"issue_id": issue_id},
            outcome={"fixable": fixable, "model": model_used, "confidence": confidence},
            run_id=run_id,
        )
        return {
            "issue_id":    issue_id,
            "patch":       patch,
            "fixable":     fixable,
            "from_cache":  from_cache,
            "model_used":  model_used,
            "task_type":   task_type,
            "pre_location": pre_location,
            "confidence":  confidence,
            "fix_reason":  fix_reason,
        }

    # ── run ───────────────────────────────────────────────────────────────────

    async def run(self, task: dict) -> dict:
        issues          = task.get("issues", [])
        epub_collection = task.get("epub_collection", "")
        run_id          = task.get("run_id", "")

        if not issues:
            return {"status": "ok", "fixes": [], "fixed_count": 0, "unfixable_count": 0}

        # Hybrid KB lookup — non-fatal: if embedding model fails, proceed without KB context
        try:
            context_map = await self._get_kb_context(issues, epub_collection)
        except Exception as kb_exc:
            print(f"[{self.agent_id}] KB context lookup failed (non-fatal): {type(kb_exc).__name__}: {kb_exc}")
            context_map = {}

        # Fire all issues concurrently — no serial batching needed since Fireworks
        # has no semaphore and Ollama semaphores throttle at the LLM layer.
        raw = await asyncio.gather(
            *[
                self._fix_single(
                    iss,
                    context_map.get(iss.get("id", ""), {}).get("context_text", ""),
                    run_id,
                )
                for iss in issues
            ],
            return_exceptions=True,
        )
        results = []
        for r, iss in zip(raw, issues):
            if isinstance(r, Exception):
                result = {"issue_id": "unknown", "patch": "CANNOT_FIX", "fixable": False, "kb_context": ""}
            else:
                result = r
                # Attach the KB context actually used for this issue so _build_trace can log it
                result["kb_context"] = (
                    context_map.get(iss.get("id", ""), {}).get("context_text", "") or ""
                )[:500]
            results.append(result)

        return {
            "status":          "ok",
            "fixes":           results,
            "fixed_count":     sum(1 for r in results if r.get("fixable")),
            "unfixable_count": sum(1 for r in results if not r.get("fixable")),
        }
