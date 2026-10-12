"""KBAgent: queries ChromaDB KB collections (kb_css, kb_js, epub_rules) plus per-upload epub_{run_id}."""
from agents.base_agent import BaseAgent
from rag_engine import rag_engine
from typing import List


class KBAgent(BaseAgent):
    agent_id = "kb_agent"
    system_prompt = "You are an EPUB knowledge base specialist for CSS and JavaScript issues."
    default_policies = {
        "top_k":            5,
        "css_collection":   "kb_css",
        "js_collection":    "kb_js",
        "epub_collection":  "epub_rules",
        "issue_collection": "issue_patterns",
        "score_threshold":  0.55,
    }

    def _select_collections(self, issue: dict, epub_collection: str = "") -> List[str]:
        """Return ordered list of collections to query — most specific first."""
        rule_id = issue.get("id", "").lower()
        title   = issue.get("title", "").lower()
        cols: List[str] = []
        # Per-upload epub content collection (grounded in actual file content)
        if epub_collection:
            cols.append(epub_collection)
        # Global rule-specific KB
        if "css" in rule_id or "style" in title or "font" in title or "layout" in title:
            cols.append("kb_css")
        elif "js" in rule_id or "script" in title or "javascript" in title:
            cols.append("kb_js")
        # Always include fix-example KB and issue patterns
        cols.append("epub_rules")
        cols.append("issue_patterns")
        return list(dict.fromkeys(cols))  # deduplicate, preserve order

    async def run(self, task: dict) -> dict:
        issues: List[dict]   = task.get("issues", [])
        epub_collection: str = task.get("epub_collection", "")   # per-upload collection name

        if not getattr(self.memory.semantic, "_available", False):
            return {"status": "ok", "kb_context": {}}

        import asyncio as _asyncio
        loop = _asyncio.get_event_loop()
        await loop.run_in_executor(None, rag_engine.initialize_models)

        all_context = {}
        thresh = (self._policies or self.default_policies).get("score_threshold", 0.55)

        for issue in issues:
            iid       = issue.get("id", "")
            query     = f"{issue.get('title', '')} {str(issue.get('details', ''))[:200]}"
            cache_key = f"kb:{epub_collection}:{iid}:{hash(query)}"

            cached = await self.memory.get_short(cache_key)
            if cached:
                all_context[iid] = cached
                continue

            vectors = await loop.run_in_executor(
                None,
                rag_engine.generate_embeddings,
                [f"Represent this EPUB issue for retrieval: {query}"],
            )
            vec = vectors[0].tolist()

            # Query all relevant collections and merge by score
            collections = self._select_collections(issue, epub_collection)
            seen_ids: set = set()
            merged: list = []
            for col in collections:
                try:
                    results = await self.memory.search_semantic(col, vec, limit=4)
                    for r in results:
                        rid = str(r.get("id", ""))
                        if r["score"] >= thresh and rid not in seen_ids:
                            seen_ids.add(rid)
                            r["_collection"] = col
                            merged.append(r)
                except Exception:
                    pass

            merged.sort(key=lambda r: r["score"], reverse=True)
            merged = merged[:6]

            def _fmt(r: dict) -> str:
                p   = r.get("payload", {})
                col = r.get("_collection", "")
                if col.startswith("epub_") and col != "epub_rules":
                    # Per-upload content chunk — show file + line location
                    file_info = p.get("file", "")
                    sel  = p.get("selector", "")
                    l1   = p.get("line_start", "")
                    l2   = p.get("line_end", "")
                    loc  = f"{file_info}:{l1}-{l2}" if l1 else file_info
                    hdr  = f"[EPUB-FILE: {loc}]" + (f" selector: {sel}" if sel else "")
                    return f"{hdr}\n{p.get('content', '')}"
                return f"[{p.get('rule_id','?')}] {p.get('title','')}: {p.get('content','')}"

            context_text = "\n\n".join(_fmt(r) for r in merged)

            entry = {
                "collections":    collections,
                "chunks":         merged,
                "context_text":   context_text,
                "epub_grounding": any(
                    r.get("_collection", "").startswith("epub_")
                    and r.get("_collection") != "epub_rules"
                    for r in merged
                ),
            }
            all_context[iid] = entry
            await self.memory.set_short(cache_key, entry, ttl=1800)

        return {"status": "ok", "kb_context": all_context}
