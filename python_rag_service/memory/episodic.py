"""Episodic memory: SQLite event log. Records every agent action and its outcome."""
import sqlite3, json, time, os
from typing import List, Optional
from pathlib import Path
from contextlib import contextmanager

DB_PATH = os.getenv("EPISODIC_DB_PATH", "storage_data/epub_episodic.db")
RETENTION_DAYS = int(os.getenv("EPISODIC_RETENTION_DAYS", "90"))

class EpisodicMemory:
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
            conn.execute("""
                CREATE TABLE IF NOT EXISTS episodes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id TEXT,
                    agent_id TEXT NOT NULL,
                    action TEXT NOT NULL,
                    context_json TEXT,
                    outcome_json TEXT,
                    success INTEGER DEFAULT 1,
                    confidence REAL,
                    duration_ms REAL,
                    ts REAL NOT NULL
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_ep_agent ON episodes(agent_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_ep_run ON episodes(run_id)")

    async def log(self, agent_id: str, action: str, context: dict, outcome: dict,
                  run_id: str = None, success: bool = True, confidence: float = None,
                  duration_ms: float = None):
        with self._conn() as conn:
            conn.execute("""
                INSERT INTO episodes(run_id, agent_id, action, context_json, outcome_json, success, confidence, duration_ms, ts)
                VALUES(?,?,?,?,?,?,?,?,?)
            """, (run_id, agent_id, action, json.dumps(context), json.dumps(outcome),
                  int(success), confidence, duration_ms, time.time()))

    async def get_recent(self, agent_id: str = None, limit: int = 50) -> List[dict]:
        with self._conn() as conn:
            if agent_id:
                rows = conn.execute(
                    "SELECT * FROM episodes WHERE agent_id=? ORDER BY ts DESC LIMIT ?",
                    (agent_id, limit)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM episodes ORDER BY ts DESC LIMIT ?", (limit,)
                ).fetchall()
            return [dict(r) for r in rows]

    async def get_agent_stats(self, agent_id: str) -> dict:
        with self._conn() as conn:
            row = conn.execute("""
                SELECT COUNT(*) as total, AVG(success) as success_rate, AVG(confidence) as avg_confidence,
                       AVG(duration_ms) as avg_duration
                FROM episodes WHERE agent_id=?
            """, (agent_id,)).fetchone()
            return dict(row) if row else {}

    async def purge_old(self):
        cutoff = time.time() - RETENTION_DAYS * 86400
        with self._conn() as conn:
            conn.execute("DELETE FROM episodes WHERE ts < ?", (cutoff,))

    async def status(self) -> dict:
        with self._conn() as conn:
            count = conn.execute("SELECT COUNT(*) FROM episodes").fetchone()[0]
        return {"db": DB_PATH, "episodes": count, "retention_days": RETENTION_DAYS}
