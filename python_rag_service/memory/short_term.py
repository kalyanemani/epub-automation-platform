"""Short-term memory: Redis primary, in-memory dict fallback. TTL 6h by default."""
import json, time, asyncio
from typing import Optional, Any
import os

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
DEFAULT_TTL = int(os.getenv("SHORT_TERM_TTL", "21600"))  # 6 hours

class ShortTermMemory:
    def __init__(self):
        self._store: dict = {}  # fallback
        self._ttls: dict = {}
        self._redis = None
        self._use_redis = False

    async def initialize(self):
        """Try to connect to Redis; fall back to in-memory silently."""
        try:
            import redis.asyncio as aioredis
            self._redis = aioredis.from_url(REDIS_URL, decode_responses=True)
            await self._redis.ping()
            self._use_redis = True
        except Exception:
            self._use_redis = False

    async def get(self, key: str) -> Optional[Any]:
        if self._use_redis:
            try:
                val = await self._redis.get(f"st:{key}")
                return json.loads(val) if val else None
            except Exception:
                pass
        # fallback
        entry = self._store.get(key)
        if entry:
            if time.time() < self._ttls.get(key, 0):
                return entry
            else:
                self._store.pop(key, None)
        return None

    async def set(self, key: str, value: Any, ttl: int = DEFAULT_TTL):
        if self._use_redis:
            try:
                await self._redis.setex(f"st:{key}", ttl, json.dumps(value))
                return
            except Exception:
                pass
        self._store[key] = value
        self._ttls[key] = time.time() + ttl

    async def delete(self, key: str):
        if self._use_redis:
            try:
                await self._redis.delete(f"st:{key}")
                return
            except Exception:
                pass
        self._store.pop(key, None)
        self._ttls.pop(key, None)

    async def set_prompt_cache(self, prompt_hash: str, response: str, ttl: int = 86400):
        await self.set(f"prompt:{prompt_hash}", {"response": response, "ts": time.time()}, ttl)

    async def get_prompt_cache(self, prompt_hash: str) -> Optional[str]:
        entry = await self.get(f"prompt:{prompt_hash}")
        return entry["response"] if entry else None

    async def set_run_context(self, run_id: str, context: dict):
        await self.set(f"run:{run_id}", context)

    async def get_run_context(self, run_id: str) -> Optional[dict]:
        return await self.get(f"run:{run_id}")

    async def status(self) -> dict:
        return {
            "backend": "redis" if self._use_redis else "in-memory",
            "keys_in_memory": len(self._store),
        }
