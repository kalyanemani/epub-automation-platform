"""BaseAgent: abstract base with system prompt, policies, memory, episodic logging, message bus."""
import time, asyncio
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional
from memory.memory_manager import memory_manager

class BaseAgent(ABC):
    agent_id: str = "base"
    system_prompt: str = "You are an EPUB automation agent."
    default_policies: dict = {}

    def __init__(self):
        self.memory = memory_manager
        self._policies: dict = {}
        self._message_bus: Optional[asyncio.Queue] = None

    async def load_policies(self):
        """Load policies from long-term memory, fallback to defaults."""
        stored = await self.memory.get_policy(self.agent_id)
        self._policies = stored if stored else self.default_policies

    def attach_bus(self, bus: asyncio.Queue):
        self._message_bus = bus

    async def post_message(self, to: str, msg_type: str, payload: dict):
        if self._message_bus:
            await self._message_bus.put({
                "from": self.agent_id, "to": to,
                "type": msg_type, "payload": payload,
                "ts": time.time()
            })

    @abstractmethod
    async def run(self, task: dict) -> dict:
        pass

    async def execute(self, task: dict) -> dict:
        """Wrapper: load policies, run, log episode."""
        await self.load_policies()
        start = time.time()
        try:
            result = await self.run(task)
            success = result.get("status") != "error"
            await self.memory.log_episode(
                agent_id=self.agent_id,
                action=task.get("action", "run"),
                context={"task_keys": list(task.keys())},
                outcome={"status": result.get("status"), "keys": list(result.keys())},
                run_id=task.get("run_id"),
                success=success,
                confidence=result.get("confidence"),
                duration_ms=(time.time() - start) * 1000
            )
            return result
        except Exception as e:
            import traceback
            print(f"[{self.agent_id}] execute() caught exception: {type(e).__name__}: {e}")
            print(traceback.format_exc())
            await self.memory.log_episode(
                agent_id=self.agent_id, action=task.get("action", "run"),
                context={"task_keys": list(task.keys())},
                outcome={"error": str(e)},
                run_id=task.get("run_id"), success=False,
                duration_ms=(time.time() - start) * 1000
            )
            return {"status": "error", "agent": self.agent_id, "error": str(e)}
