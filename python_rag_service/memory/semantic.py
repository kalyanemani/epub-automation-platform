"""Semantic memory: ChromaDB vector store (in-process, no server required).
Collections: kb_css, kb_js, issue_patterns, epub_chunks.
Data persists to CHROMA_PERSIST_DIR across restarts.
"""
import asyncio
import os
from pathlib import Path
from typing import List, Optional, Dict, Any

CHROMA_PERSIST_DIR = os.getenv(
    "CHROMA_PERSIST_DIR",
    str(Path(__file__).parent.parent / "chroma_db"),
)
COLLECTIONS = ["kb_css", "kb_js", "issue_patterns", "epub_chunks"]


class SemanticMemory:
    def __init__(self):
        self._client = None
        self._cols: Dict[str, Any] = {}
        self._available = False

    async def initialize(self):
        try:
            import chromadb
            self._client = chromadb.PersistentClient(path=CHROMA_PERSIST_DIR)
            for col in COLLECTIONS:
                self._cols[col] = self._client.get_or_create_collection(
                    name=col,
                    metadata={"hnsw:space": "cosine"},
                )
            self._available = True
            print(f"[SemanticMemory] ChromaDB ready at {CHROMA_PERSIST_DIR}")
        except Exception as exc:
            print(f"[SemanticMemory] ChromaDB unavailable: {exc}. Semantic search disabled.")
            self._available = False

    # ── helpers ───────────────────────────────────────────────────────────────

    async def _get_or_create_col(self, collection: str):
        """Return the ChromaDB collection, creating it dynamically if needed."""
        col = self._cols.get(collection)
        if col is not None:
            return col
        loop = asyncio.get_event_loop()
        try:
            col = await loop.run_in_executor(
                None,
                lambda: self._client.get_or_create_collection(
                    name=collection, metadata={"hnsw:space": "cosine"}
                ),
            )
            self._cols[collection] = col
            return col
        except Exception as exc:
            print(f"[SemanticMemory] cannot create collection '{collection}': {exc}")
            return None

    # ── upsert ────────────────────────────────────────────────────────────────

    async def upsert(self, collection: str, points: List[Dict[str, Any]]):
        """points: list of {id, vector, payload}"""
        if not self._available or not points:
            return
        col = await self._get_or_create_col(collection)
        if col is None:
            return
        ids       = [str(p["id"]) for p in points]
        vectors   = [p["vector"] for p in points]
        metadatas = [p.get("payload", {}) for p in points]
        # ChromaDB requires string values in metadata
        metadatas = [
            {k: str(v) for k, v in m.items()} for m in metadatas
        ]
        # documents field is required by ChromaDB (use content from payload)
        documents = [m.get("content", "") for m in metadatas]
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                lambda: col.upsert(ids=ids, embeddings=vectors, metadatas=metadatas, documents=documents)
            )
        except Exception as exc:
            print(f"[SemanticMemory] upsert error ({collection}): {exc}")

    # ── get_all_docs ──────────────────────────────────────────────────────────

    async def get_all_docs(self, collection: str) -> List[Dict]:
        """Return all {id, text} pairs from a collection. Used for BM25 index building."""
        if not self._available:
            return []
        col = self._cols.get(collection)
        if col is None:
            return []
        loop = asyncio.get_event_loop()
        def _get():
            try:
                result = col.get(include=["documents"])
                return [
                    {"id": rid, "text": doc or ""}
                    for rid, doc in zip(result["ids"], result["documents"])
                ]
            except Exception:
                return []
        return await loop.run_in_executor(None, _get)

    # ── search ────────────────────────────────────────────────────────────────

    async def search(self, collection: str, query_vector: List[float],
                     limit: int = 5, filter_payload: Optional[Dict] = None) -> List[Dict]:
        if not self._available:
            return []
        col = self._cols.get(collection)
        if col is None:
            return []
        loop = asyncio.get_event_loop()
        col_count = await loop.run_in_executor(None, col.count)
        if col_count == 0:
            return []
        where = None
        if filter_payload:
            where = {k: {"$eq": str(v)} for k, v in filter_payload.items()}
        try:
            res = await loop.run_in_executor(
                None,
                lambda: col.query(
                    query_embeddings=[query_vector],
                    n_results=min(limit, col_count),
                    where=where,
                    include=["metadatas", "distances"],
                )
            )
            ids       = res["ids"][0]
            distances = res["distances"][0]
            metadatas = res["metadatas"][0]
            # ChromaDB cosine distance → similarity: score = 1 - distance
            return [
                {"id": ids[i], "score": round(1.0 - distances[i], 4), "payload": metadatas[i]}
                for i in range(len(ids))
            ]
        except Exception as exc:
            print(f"[SemanticMemory] search error ({collection}): {exc}")
            return []

    # ── delete ────────────────────────────────────────────────────────────────

    async def delete(self, collection: str, ids: List[str]):
        if not self._available:
            return
        col = self._cols.get(collection)
        if col:
            try:
                col.delete(ids=[str(i) for i in ids])
            except Exception:
                pass

    async def delete_collection(self, collection: str):
        """Drop an entire ChromaDB collection and remove it from the local cache."""
        if not self._available:
            return
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None, lambda: self._client.delete_collection(collection)
            )
            self._cols.pop(collection, None)
            print(f"[SemanticMemory] dropped collection '{collection}'")
        except Exception as exc:
            print(f"[SemanticMemory] delete_collection '{collection}' failed (non-fatal): {exc}")

    # ── status ────────────────────────────────────────────────────────────────

    async def status(self) -> dict:
        if not self._available:
            return {"available": False, "backend": "chromadb", "path": CHROMA_PERSIST_DIR}
        counts = {}
        for name, col in self._cols.items():
            try:
                counts[name] = col.count()
            except Exception:
                counts[name] = "error"
        return {
            "available":   True,
            "backend":     "chromadb",
            "path":        CHROMA_PERSIST_DIR,
            "collections": counts,
        }
