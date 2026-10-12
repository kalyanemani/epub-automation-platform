"""ChromaIndexer: indexes chunked content into ChromaDB via MemoryManager with deduplication."""
import asyncio
import hashlib
from typing import List, Dict, Any
from rag_engine import rag_engine

INSTRUCTION_PREFIX = "Represent this EPUB issue for retrieval: "


class ChromaIndexer:
    def __init__(self, memory_manager=None):
        self.memory = memory_manager

    def _chunk_id(self, content: str, collection: str) -> str:
        return hashlib.md5(f"{collection}:{content[:200]}".encode()).hexdigest()

    async def index_chunks(self, chunks: List[Dict[str, Any]], collection: str) -> dict:
        """Embed and upsert chunks into ChromaDB. Deduplicates by content hash."""
        if not chunks:
            return {"indexed": 0, "skipped": 0}

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, rag_engine.initialize_models)
        texts = [f"{INSTRUCTION_PREFIX}{c['content']}" for c in chunks]
        vectors = await loop.run_in_executor(None, rag_engine.generate_embeddings, texts)

        points = []
        seen_ids = set()
        for i, chunk in enumerate(chunks):
            cid = self._chunk_id(chunk["content"], collection)
            if cid in seen_ids:
                continue  # deduplicate
            seen_ids.add(cid)

            meta = chunk.get("metadata", {})
            payload = {
                "content":   chunk["content"],
                "strategy":  chunk.get("strategy", "unknown"),
                "source":    meta.get("source", "kb"),
                "rule_id":   meta.get("rule_id", ""),
                "title":     meta.get("title", ""),
                "domain":    meta.get("domain", ""),
                "file_type": meta.get("file_type", ""),
                "h1":        chunk.get("h1", ""),
                "h2":        chunk.get("h2", ""),
            }
            points.append({"id": cid, "vector": vectors[i].tolist(), "payload": payload})

        if self.memory and points:
            await self.memory.upsert_semantic(collection, points)

        return {
            "indexed": len(points),
            "skipped": len(chunks) - len(points),
            "collection": collection
        }

    async def index_kb_entry(self, rule_id: str, title: str, content: str, collection: str,
                              domain: str = "", file_type: str = "") -> str:
        """Index a single KB entry. Returns chunk_id."""
        chunks = [{
            "content": content,
            "strategy": "semantic",
            "metadata": {
                "source": "kb",
                "rule_id": rule_id,
                "domain": domain,
                "file_type": file_type,
                "title": title
            }
        }]
        await self.index_chunks(chunks, collection)
        return self._chunk_id(content, collection)
