"""CAGCache: pre-loads top KB chunks into Redis cache to reduce retrieval latency."""
import asyncio
import time
from typing import List, Dict, Optional
from rag_engine import rag_engine

REFRESH_INTERVAL_S = 1800  # 30 min
TOP_K = 100


class CAGCache:
    def __init__(self, memory_manager=None):
        self.memory = memory_manager
        self._cache: Dict[str, str] = {}
        self._last_refresh: float = 0
        self._refresh_task: Optional[asyncio.Task] = None

    async def initialize(self):
        await self._load_top_chunks()
        self._refresh_task = asyncio.create_task(self._background_refresh())

    async def _load_top_chunks(self):
        if not self.memory:
            return
        try:
            top = await self.memory.long.get_top_kb_chunks(TOP_K)
            for entry in top:
                cached = await self.memory.get_short(f"cag:{entry['chunk_id']}")
                if cached:
                    self._cache[entry["chunk_id"]] = cached.get("content", "")
        except Exception:
            pass  # ChromaDB/Redis may not be ready yet
        self._last_refresh = time.time()

    async def _background_refresh(self):
        while True:
            await asyncio.sleep(REFRESH_INTERVAL_S)
            await self._load_top_chunks()

    def get_context(self, limit: int = 20) -> str:
        """Return pre-loaded context as a string for prompt injection."""
        items = list(self._cache.values())[:limit]
        return "\n\n".join(items)

    async def get_context_for_query(self, query: str, collection: str = "kb_css",
                                     limit: int = 5) -> str:
        """Get relevant context: try cache first, fall back to ChromaDB search."""
        if not self.memory:
            return self.get_context(limit)

        cache_key = f"cag_query:{hash(query)}"
        cached = await self.memory.get_short(cache_key)
        if cached:
            return cached.get("context", "")

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, rag_engine.initialize_models)
        vectors = await loop.run_in_executor(
            None, rag_engine.generate_embeddings,
            [f"Represent this EPUB issue for retrieval: {query}"]
        )
        results = await self.memory.search_semantic(
            collection, vectors[0].tolist(), limit=limit
        )
        context = "\n\n".join([r["payload"].get("content", "") for r in results])
        await self.memory.set_short(cache_key, {"context": context}, ttl=1800)
        return context


cag_cache = CAGCache()
