"""Long-term memory: SQLite. Stores run history, agent policies, KB usage frequency,
and per-rule fix outcome rates for adaptive triage routing."""
import asyncio
import sqlite3, json, time, os
from typing import Optional, Any, List
from pathlib import Path
from contextlib import contextmanager

DB_PATH = os.getenv("LONGTERM_DB_PATH", "storage_data/epub_longterm.db")

class LongTermMemory:
    def __init__(self):
        Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _init_schema(self):
        with self._conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS kv_store (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    created_at REAL,
                    updated_at REAL,
                    expires_at REAL
                );
                CREATE TABLE IF NOT EXISTS policies (
                    agent_id TEXT PRIMARY KEY,
                    policy_json TEXT NOT NULL,
                    updated_at REAL
                );
                CREATE TABLE IF NOT EXISTS kb_usage (
                    chunk_id TEXT PRIMARY KEY,
                    collection TEXT,
                    usage_count INTEGER DEFAULT 1,
                    last_used REAL
                );
                CREATE TABLE IF NOT EXISTS run_index (
                    run_id TEXT PRIMARY KEY,
                    filename TEXT,
                    issue_count INTEGER,
                    fixed_count INTEGER,
                    hitl_count INTEGER,
                    created_at REAL
                );
                CREATE TABLE IF NOT EXISTS fix_outcomes (
                    rule_id TEXT PRIMARY KEY,
                    attempts INTEGER DEFAULT 0,
                    successes INTEGER DEFAULT 0,
                    route TEXT DEFAULT 'auto',
                    last_updated REAL
                );
            """)

    async def get(self, key: str) -> Optional[Any]:
        with self._conn() as conn:
            row = conn.execute("SELECT value, expires_at FROM kv_store WHERE key=?", (key,)).fetchone()
            if row:
                if row["expires_at"] and time.time() > row["expires_at"]:
                    conn.execute("DELETE FROM kv_store WHERE key=?", (key,))
                    return None
                return json.loads(row["value"])
        return None

    async def set(self, key: str, value: Any, ttl_days: Optional[int] = None):
        expires = time.time() + ttl_days * 86400 if ttl_days else None
        now = time.time()
        with self._conn() as conn:
            conn.execute("""
                INSERT INTO kv_store(key, value, created_at, updated_at, expires_at)
                VALUES(?,?,?,?,?)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, expires_at=excluded.expires_at
            """, (key, json.dumps(value), now, now, expires))

    async def get_policy(self, agent_id: str) -> Optional[dict]:
        with self._conn() as conn:
            row = conn.execute("SELECT policy_json FROM policies WHERE agent_id=?", (agent_id,)).fetchone()
            return json.loads(row["policy_json"]) if row else None

    async def set_policy(self, agent_id: str, policy: dict):
        with self._conn() as conn:
            conn.execute("""
                INSERT INTO policies(agent_id, policy_json, updated_at) VALUES(?,?,?)
                ON CONFLICT(agent_id) DO UPDATE SET policy_json=excluded.policy_json, updated_at=excluded.updated_at
            """, (agent_id, json.dumps(policy), time.time()))

    async def increment_kb_usage(self, chunk_id: str, collection: str):
        with self._conn() as conn:
            conn.execute("""
                INSERT INTO kb_usage(chunk_id, collection, usage_count, last_used) VALUES(?,?,1,?)
                ON CONFLICT(chunk_id) DO UPDATE SET usage_count=usage_count+1, last_used=excluded.last_used
            """, (chunk_id, collection, time.time()))

    async def get_top_kb_chunks(self, limit: int = 100) -> List[dict]:
        with self._conn() as conn:
            rows = conn.execute("SELECT chunk_id, collection, usage_count FROM kb_usage ORDER BY usage_count DESC LIMIT ?", (limit,)).fetchall()
            return [dict(r) for r in rows]

    async def log_run(self, run_id: str, filename: str, issue_count: int, fixed_count: int, hitl_count: int):
        with self._conn() as conn:
            conn.execute("""
                INSERT OR REPLACE INTO run_index(run_id, filename, issue_count, fixed_count, hitl_count, created_at)
                VALUES(?,?,?,?,?,?)
            """, (run_id, filename, issue_count, fixed_count, hitl_count, time.time()))

    async def record_fix_outcome(self, rule_id: str, success: bool, route: str = "auto"):
        """Record whether a fix attempt for a rule succeeded. Used to adapt triage routing."""
        loop = asyncio.get_event_loop()
        def _write():
            with self._conn() as conn:
                conn.execute("""
                    INSERT INTO fix_outcomes(rule_id, attempts, successes, route, last_updated)
                    VALUES(?, 1, ?, ?, ?)
                    ON CONFLICT(rule_id) DO UPDATE SET
                        attempts = attempts + 1,
                        successes = successes + excluded.successes,
                        route = excluded.route,
                        last_updated = excluded.last_updated
                """, (rule_id, 1 if success else 0, route, time.time()))
        await loop.run_in_executor(None, _write)

    async def get_fix_success_rate(self, rule_id: str) -> Optional[float]:
        """Return historical fix success rate (0.0–1.0) for a rule, or None if no data."""
        loop = asyncio.get_event_loop()
        def _read():
            with self._conn() as conn:
                row = conn.execute(
                    "SELECT attempts, successes FROM fix_outcomes WHERE rule_id=?", (rule_id,)
                ).fetchone()
                if row and row["attempts"] > 0:
                    return round(row["successes"] / row["attempts"], 3)
                return None
        return await loop.run_in_executor(None, _read)

    async def get_all_fix_rates(self) -> List[dict]:
        """Return fix success rates for all rules — used by triage agent for routing."""
        loop = asyncio.get_event_loop()
        def _read():
            with self._conn() as conn:
                rows = conn.execute(
                    "SELECT rule_id, attempts, successes, route FROM fix_outcomes ORDER BY attempts DESC"
                ).fetchall()
                return [
                    {
                        "rule_id": r["rule_id"],
                        "attempts": r["attempts"],
                        "success_rate": round(r["successes"] / r["attempts"], 3) if r["attempts"] > 0 else 0.0,
                        "route": r["route"],
                    }
                    for r in rows
                ]
        return await loop.run_in_executor(None, _read)

    async def status(self) -> dict:
        with self._conn() as conn:
            kv_count = conn.execute("SELECT COUNT(*) FROM kv_store").fetchone()[0]
            run_count = conn.execute("SELECT COUNT(*) FROM run_index").fetchone()[0]
            outcome_count = conn.execute("SELECT COUNT(*) FROM fix_outcomes").fetchone()[0]
        return {"db": DB_PATH, "kv_entries": kv_count, "runs": run_count, "fix_outcomes_tracked": outcome_count}
