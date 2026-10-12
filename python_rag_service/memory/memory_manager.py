"""MemoryManager: unified interface for all 4 memory types."""
from memory.short_term import ShortTermMemory
from memory.long_term import LongTermMemory
from memory.episodic import EpisodicMemory
from memory.semantic import SemanticMemory
from typing import Any, Optional, List, Dict
import hashlib, json

class MemoryManager:
    def __init__(self):
        self.short = ShortTermMemory()
        self.long = LongTermMemory()
        self.episodic = EpisodicMemory()
        self.semantic = SemanticMemory()

    async def initialize(self):
        await self.short.initialize()
        await self.semantic.initialize()

    # Short-term convenience
    async def get_short(self, key: str) -> Optional[Any]:
        return await self.short.get(key)

    async def set_short(self, key: str, value: Any, ttl: int = 21600):
        await self.short.set(key, value, ttl)

    async def cache_prompt(self, prompt: str, response: str):
        h = hashlib.md5(prompt.encode()).hexdigest()
        await self.short.set_prompt_cache(h, response)

    async def get_cached_prompt(self, prompt: str) -> Optional[str]:
        h = hashlib.md5(prompt.encode()).hexdigest()
        return await self.short.get_prompt_cache(h)

    # Long-term convenience
    async def get_long(self, key: str) -> Optional[Any]:
        return await self.long.get(key)

    async def set_long(self, key: str, value: Any, ttl_days: int = None):
        await self.long.set(key, value, ttl_days)

    async def get_policy(self, agent_id: str) -> Optional[dict]:
        return await self.long.get_policy(agent_id)

    async def set_policy(self, agent_id: str, policy: dict):
        await self.long.set_policy(agent_id, policy)

    # Episodic convenience
    async def log_episode(self, agent_id: str, action: str, context: dict, outcome: dict, **kwargs):
        await self.episodic.log(agent_id, action, context, outcome, **kwargs)

    async def record_fix_outcome(self, rule_id: str, success: bool, route: str = "auto"):
        """Track per-rule fix success/failure for adaptive triage routing."""
        await self.long.record_fix_outcome(rule_id, success, route)

    async def get_fix_success_rate(self, rule_id: str):
        return await self.long.get_fix_success_rate(rule_id)

    async def get_all_fix_rates(self):
        return await self.long.get_all_fix_rates()

    # Semantic convenience
    async def search_semantic(self, collection: str, query_vector: List[float],
                               limit: int = 5, filter_payload: Dict = None) -> List[dict]:
        results = await self.semantic.search(collection, query_vector, limit, filter_payload)
        # Track usage in long-term memory
        for r in results:
            await self.long.increment_kb_usage(str(r["id"]), collection)
        return results

    async def upsert_semantic(self, collection: str, points: List[dict]):
        await self.semantic.upsert(collection, points)

    async def status(self) -> dict:
        return {
            "short_term": await self.short.status(),
            "long_term": await self.long.status(),
            "episodic": await self.episodic.status(),
            "semantic": await self.semantic.status(),
        }

# Global singleton — initialized at FastAPI startup
memory_manager = MemoryManager()
