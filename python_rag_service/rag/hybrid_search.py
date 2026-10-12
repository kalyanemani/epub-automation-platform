"""
Hybrid search: BM25 (sparse keyword) + dense (ChromaDB cosine) combined via weighted fusion.

For each query:
  1. Dense search: BAAI/bge-m3 → ChromaDB HNSW (2x candidates for re-ranking headroom)
  2. BM25 search: rank_bm25 in-memory index built from collection documents
  3. Weighted combination: 0.65 * dense_score + 0.35 * bm25_score
  4. Re-rank and apply score threshold

BM25 indexes are lazy-built per collection and cached for BM25_TTL seconds.
Only static KB collections are BM25-indexed (epub_{run_id} collections are skipped
since they're ephemeral and small — dense search suffices there).
"""
import re
import time
from typing import Dict, List, Optional

try:
    from rank_bm25 import BM25Okapi
    _BM25_AVAILABLE = True
except ImportError:
    _BM25_AVAILABLE = False
    print("[hybrid_search] rank_bm25 not installed — pip install rank-bm25. Falling back to dense-only.")

# Module-level index cache shared across all agent instances
_bm25_cache: Dict[str, dict] = {}  # collection → {index, doc_ids, built_at}
_BM25_STATIC_TTL    = 1800  # 30 min for stable KB collections
_BM25_EPHEMERAL_TTL = 300   # 5 min for per-run epub_* collections


def _tokenize(text: str) -> List[str]:
    """Lowercase + split on non-alphanumeric (keeps hyphens for CSS property names)."""
    return re.sub(r"[^\w-]", " ", (text or "").lower()).split()


def _is_bm25_eligible(collection: str) -> bool:
    """BM25-index static KB collections AND per-run epub_* collections."""
    return (
        collection in ("kb_css", "kb_js", "epub_rules", "issue_patterns")
        or collection.startswith("epub_")
    )


def _bm25_ttl(collection: str) -> int:
    return _BM25_EPHEMERAL_TTL if collection.startswith("epub_") else _BM25_STATIC_TTL


async def _ensure_bm25(memory, collection: str) -> Optional[dict]:
    """Build or refresh BM25 index for a collection. Returns None if unavailable."""
    if not _BM25_AVAILABLE or not _is_bm25_eligible(collection):
        return None

    cached = _bm25_cache.get(collection)
    if cached and (time.time() - cached["built_at"]) < _bm25_ttl(collection):
        return cached

    docs = await memory.semantic.get_all_docs(collection)
    if not docs:
        return None

    tokenized = [_tokenize(d["text"]) for d in docs]
    doc_ids   = [d["id"] for d in docs]

    # Filter out empty token lists (BM25Okapi requires at least one token per doc)
    valid = [(tok, did) for tok, did in zip(tokenized, doc_ids) if tok]
    if not valid:
        return None

    valid_tokens, valid_ids = zip(*valid)
    try:
        index = BM25Okapi(list(valid_tokens))
        entry = {"index": index, "doc_ids": list(valid_ids), "built_at": time.time()}
        _bm25_cache[collection] = entry
        print(f"[hybrid_search] BM25 index built for '{collection}': {len(valid_ids)} docs")
        return entry
    except Exception as exc:
        print(f"[hybrid_search] BM25 build failed for '{collection}': {exc}")
        return None


async def hybrid_search(
    memory,
    collection: str,
    query_text: str,
    query_vector: List[float],
    limit: int = 5,
    score_threshold: float = 0.35,
) -> List[dict]:
    """
    Hybrid dense + BM25 search with weighted score fusion.

    memory         — MemoryManager singleton (has .search_semantic + .semantic.get_all_docs)
    collection     — ChromaDB collection name
    query_text     — raw query string (for BM25 tokenization)
    query_vector   — pre-computed dense embedding (for ChromaDB search)
    limit          — number of results to return
    score_threshold — minimum combined score (0-1) to include

    Returns list of {id, score, payload, _bm25_boost} sorted by combined score desc.
    """
    # ── 1. Dense search (2x limit for re-ranking headroom) ─────────────────
    dense_results = await memory.search_semantic(collection, query_vector, limit=limit * 2)
    if not dense_results:
        return []

    # ── 2. BM25 scores for dense candidates ────────────────────────────────
    bm25_scores: Dict[str, float] = {}
    bm25_entry = await _ensure_bm25(memory, collection)

    if bm25_entry:
        tokens = _tokenize(query_text)
        if tokens:
            raw_scores = bm25_entry["index"].get_scores(tokens)
            max_score  = max(raw_scores) if max(raw_scores) > 0 else 1.0
            for doc_id, raw in zip(bm25_entry["doc_ids"], raw_scores):
                if raw > 0:
                    bm25_scores[str(doc_id)] = raw / max_score

    # ── 3. Weighted combination: 0.65 dense + 0.35 BM25 ──────────────────
    for r in dense_results:
        bm25_boost        = bm25_scores.get(str(r["id"]), 0.0)
        r["score"]        = round(0.65 * r["score"] + 0.35 * bm25_boost, 4)
        r["_bm25_boost"]  = round(bm25_boost, 4)

    # ── 4. Re-sort and apply threshold ─────────────────────────────────────
    dense_results.sort(key=lambda x: x["score"], reverse=True)
    return [r for r in dense_results[:limit] if r["score"] >= score_threshold]
