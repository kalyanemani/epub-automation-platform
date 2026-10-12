"""BatchProcessor: parallel agent task execution using asyncio + ThreadPoolExecutor."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from typing import List, Callable, Any, Coroutine
import time

MAX_WORKERS = 4
SEMAPHORE_LIMIT = 4


class BatchProcessor:
    def __init__(self, max_workers: int = MAX_WORKERS, semaphore_limit: int = SEMAPHORE_LIMIT):
        self._executor = ThreadPoolExecutor(max_workers=max_workers)
        self._semaphore = asyncio.Semaphore(semaphore_limit)

    async def run_parallel(self, coros: List[Coroutine]) -> List[Any]:
        """Run coroutines in parallel with semaphore limiting concurrency."""
        async def bounded(coro):
            async with self._semaphore:
                return await coro
        return await asyncio.gather(*[bounded(c) for c in coros], return_exceptions=True)

    async def run_batch(self, fn: Callable, items: List[Any], batch_size: int = 8) -> List[Any]:
        """Process items in batches, each batch runs in parallel."""
        results = []
        for i in range(0, len(items), batch_size):
            batch = items[i:i + batch_size]
            batch_results = await self.run_parallel([fn(item) for item in batch])
            results.extend(batch_results)
        return results

    async def run_cpu_bound(self, fn: Callable, *args) -> Any:
        """Run CPU-bound function in thread pool."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self._executor, fn, *args)

    async def run_with_timeout(self, coro: Coroutine, timeout: float = 30.0) -> Any:
        """Run coroutine with timeout, return error dict on timeout."""
        try:
            return await asyncio.wait_for(coro, timeout=timeout)
        except asyncio.TimeoutError:
            return {"status": "timeout", "error": f"Timed out after {timeout}s"}
