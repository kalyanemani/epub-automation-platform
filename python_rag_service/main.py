# -*- coding: utf-8 -*-
"""EPUB Automation Python RAG & Agent Service v2.0"""
import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from this directory (non-fatal if absent)
load_dotenv(Path(__file__).parent / ".env", override=True)

import base64
import glob
import logging
import re
import sqlite3
import threading
import time as _time
import httpx
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks, Request
from fastapi.responses import Response, JSONResponse, StreamingResponse
import uvicorn
import shutil
import uuid
import asyncio
import json
import tempfile
from pydantic import BaseModel
from typing import List, Optional, Dict, Any

# â”€â”€ Structured logging â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
logging.basicConfig(
    level=logging.INFO,
    format='{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":%(message)s}',
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("epub_service")

# â”€â”€ Upload limits â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
_MAX_UPLOAD_MB    = int(os.getenv("MAX_UPLOAD_MB", "200"))
_MAX_UPLOAD_BYTES = _MAX_UPLOAD_MB * 1024 * 1024

# â”€â”€ API key auth (optional â€” set SERVICE_API_KEY env var to enable) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
_API_KEY = os.getenv("SERVICE_API_KEY", "")

# â”€â”€ Persistent job store (SQLite) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
_JOBS_DB = os.path.join(os.path.dirname(__file__), "jobs.db")
_db_lock  = threading.Lock()   # serialise DDL / writes from multiple threads


def _init_jobs_db():
    with _db_lock, sqlite3.connect(_JOBS_DB, timeout=15) as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS autofix_jobs (
                run_id     TEXT PRIMARY KEY,
                status     TEXT NOT NULL DEFAULT 'running',
                stage      TEXT NOT NULL DEFAULT 'queued',
                result     TEXT,
                error      TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS audit_log (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id     TEXT,
                event      TEXT NOT NULL,
                detail     TEXT,
                ts         REAL NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_created ON autofix_jobs(created_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_ts    ON audit_log(ts)")
        conn.commit()


def _job_create(run_id: str):
    now = _time.time()
    with _db_lock, sqlite3.connect(_JOBS_DB, timeout=15) as conn:
        conn.execute(
            "INSERT OR IGNORE INTO autofix_jobs(run_id,status,stage,created_at,updated_at) "
            "VALUES(?,?,?,?,?)",
            [run_id, "running", "queued", now, now],
        )
        conn.commit()


def _job_set(run_id: str, **kw):
    if not kw:
        return
    now = _time.time()
    kw2 = dict(kw)
    if "result" in kw2 and isinstance(kw2["result"], (dict, list)):
        kw2["result"] = json.dumps(kw2["result"])
    set_clause = ", ".join(f"{k}=?" for k in kw2)
    values     = list(kw2.values()) + [now, run_id]
    with _db_lock, sqlite3.connect(_JOBS_DB, timeout=15) as conn:
        conn.execute(f"UPDATE autofix_jobs SET {set_clause}, updated_at=? WHERE run_id=?", values)
        conn.commit()


def _job_get(run_id: str) -> Optional[Dict]:
    with sqlite3.connect(_JOBS_DB, timeout=15) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM autofix_jobs WHERE run_id=?", [run_id]
        ).fetchone()
    if not row:
        return None
    d = dict(row)
    if d.get("result") and isinstance(d["result"], str):
        try:
            d["result"] = json.loads(d["result"])
        except Exception:
            pass
    return d


def _job_expire():
    """Prune jobs older than 24 hours."""
    cutoff = _time.time() - 86400
    with _db_lock, sqlite3.connect(_JOBS_DB, timeout=15) as conn:
        conn.execute("DELETE FROM autofix_jobs WHERE created_at < ?", [cutoff])
        conn.commit()


def _audit(run_id: str, event: str, detail: str = ""):
    try:
        with _db_lock, sqlite3.connect(_JOBS_DB, timeout=5) as conn:
            conn.execute(
                "INSERT INTO audit_log(run_id,event,detail,ts) VALUES(?,?,?,?)",
                [run_id, event, detail[:500], _time.time()],
            )
            conn.commit()
    except Exception:
        pass

# â”€â”€ Background task registry â€” strong refs prevent GC â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
_background_tasks: set = set()

def _fire_task(coro):
    """Schedule a coroutine as a background task with a strong reference."""
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task

NODE_URL = os.getenv("NODE_API_URL", "")
PYTHON_PORT = int(os.getenv("PYTHON_API_PORT", "8001"))

from ollama_client import ollama_health, TASK_MODEL_MAP
from evaluation.scorer import BleuRougeScorer
from evaluation.ragas_eval import EpubFixEvaluator
from extractor import DocumentExtractor
from rag_engine import rag_engine, RagPipelineEngine
from epub_patcher import EPUBPatcher
from memory.memory_manager import memory_manager
from agents.orchestrator_agent import OrchestratorAgent
from agents.triage_agent import TriageAgent
from agents.kb_agent import KBAgent
from agents.fixer_agent import FixerAgent
from agents.reporter_agent import ReporterAgent
from agents.css_fixer_agent import CSSFixerAgent
from agents.js_fixer_agent import JSFixerAgent
from agents.html_accessibility_agent import HTMLAccessibilityAgent
from agents.metadata_text_agent import MetadataTextAgent
from rag.chunker import SmartChunker, ChunkStrategy
from rag.indexer import ChromaIndexer
from rag.epub_content_indexer import EPUBContentIndexer
from kb.css_kb import CSS_KB_ENTRIES
from kb.js_kb import JS_KB_ENTRIES
from kb.epub_rules_kb import EPUB_RULES_KB_ENTRIES
from kb.issue_patterns_kb import ISSUE_PATTERNS_KB_ENTRIES
from processing.batch_processor import BatchProcessor

app = FastAPI(
    title="EPUB Automation Agent Service",
    version="2.0.0",
    description="Production EPUB validation, autofix, and RAG evaluation service.",
)

@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    start_time = _time.perf_counter()
    response = await call_next(request)
    process_time = _time.perf_counter() - start_time
    process_time_ms = round(process_time * 1000, 2)
    response.headers["X-Process-Time"] = f"{process_time_ms}ms"
    response.headers["Server-Timing"] = f"app;dur={process_time_ms}"
    if process_time > 1.5:
        logger.warning(f"[SLOW_REQUEST] {request.method} {request.url.path} took {process_time_ms}ms")
    return response

# ——————————————————————————————————————————————————————————————————————————————————————————————————————
try:
    from prometheus_fastapi_instrumentator import Instrumentator as _PFI
    _PFI().instrument(app).expose(app, endpoint="/metrics")
    logger.info = logger.info  # keep reference; avoid unused-import lint
except ImportError:
    pass  # prometheus_fastapi_instrumentator not installed â€” metrics endpoint absent

# â”€â”€ API key authentication middleware â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
_OPEN_PATHS = {"/health", "/docs", "/openapi.json", "/redoc"}

@app.middleware("http")
async def api_key_middleware(request: Request, call_next):
    if _API_KEY and request.url.path not in _OPEN_PATHS:
        key = request.headers.get("X-API-Key", "")
        if key != _API_KEY:
            return JSONResponse({"error": "Unauthorized â€” provide X-API-Key header"}, status_code=401)
    return await call_next(request)


# â”€â”€ Node.js call with retry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async def _node_post(client: httpx.AsyncClient, url: str, **kwargs) -> httpx.Response:
    """POST to Node.js with up to 3 retries on transient connection errors."""
    last_exc: Exception = RuntimeError("no attempt")
    for attempt in range(3):
        try:
            return await client.post(url, **kwargs)
        except (httpx.ConnectError, httpx.TimeoutException) as exc:
            last_exc = exc
            if attempt < 2:
                logger.warning(f'"Node.js POST {url} failed (attempt {attempt+1}/3): {exc} â€” retrying"')
                await asyncio.sleep(2 ** attempt)
    raise last_exc


# â”€â”€ Temp dir cleanup helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async def _cleanup_old_temp_dirs():
    """Remove epub_agentfix_* and hitl_apply_* dirs older than 6 hours."""
    cutoff   = _time.time() - 21600
    tmp_base = tempfile.gettempdir()
    removed  = 0
    for pattern in ("epub_agentfix_*", "hitl_apply_*"):
        for d in glob.glob(os.path.join(tmp_base, pattern)):
            try:
                if os.path.isdir(d) and os.path.getmtime(d) < cutoff:
                    shutil.rmtree(d, ignore_errors=True)
                    removed += 1
            except Exception:
                pass
    if removed:
        logger.info(f'"Cleaned {removed} stale temp directories"')

extractor = DocumentExtractor()
# rag_engine imported as singleton from rag_engine module
orchestrator = OrchestratorAgent()
chunker = SmartChunker()
batch_processor = BatchProcessor()
triage_agent    = TriageAgent()
fixer_agent     = FixerAgent()         # kept for /fix-proposals legacy endpoint
kb_agent        = KBAgent()            # kept for /orchestrate legacy endpoint
reporter_agent  = ReporterAgent()
# Specialized domain fixer agents (used in _run_autofix_job)
css_fixer_agent           = CSSFixerAgent()
js_fixer_agent            = JSFixerAgent()
html_accessibility_agent  = HTMLAccessibilityAgent()
metadata_text_agent       = MetadataTextAgent()

# â”€â”€ Evaluation instances â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
_bleu_rouge_scorer = BleuRougeScorer()
_fix_evaluator     = EpubFixEvaluator()

# Domain routing map â€” used by _group_by_domain()
_DOMAIN_AGENT_MAP = {
    "css":  css_fixer_agent,
    "js":   js_fixer_agent,
    "html": html_accessibility_agent,
    "meta": metadata_text_agent,
}


class CompareRequest(BaseModel):
    text1: str
    text2: str


class TriageRequest(BaseModel):
    issues: List[Dict[str, Any]]
    run_id: Optional[str] = None
    use_llm_triage: bool = False


class OrchestrateRequest(BaseModel):
    run_id: Optional[str] = None
    issues: List[Dict[str, Any]]
    validation_report: Dict[str, Any] = {}
    filename: str = "document.epub"
    image_paths: List[str] = []
    use_llm_triage: bool = False


class ReportRequest(BaseModel):
    run_id: Optional[str] = None
    filename: str = "document.epub"
    validation_report: Dict[str, Any] = {}
    triage_results: List[Dict] = []
    fix_results: Dict[str, Any] = {}
    fix_trace: List[Dict] = []
    hitl_suggestions: Dict[str, Any] = {}
    diffs: List[Dict] = []
    report_mode: str = "full"  # "validation" = issues + LLM suggestions only; "full" = pre/post + fix details


class FixProposalsRequest(BaseModel):
    run_id: Optional[str] = None
    issues: List[Dict[str, Any]]
    filename: str = "document.epub"


class EvaluateRequest(BaseModel):
    question: str
    context: str
    answer: str


class EvalFixRequest(BaseModel):
    issue_id:      str
    issue_title:   str = ""
    issue_suggestion: str = ""
    fix_value:     str
    kb_context:    str = ""
    file_content:  str = ""
    reference_fix: Optional[str] = None
    run_id:        str = ""


class EvalJobRequest(BaseModel):
    job_id: str


class BleuRougeRequest(BaseModel):
    hypothesis: str
    reference:  Optional[str] = None
    context:    Optional[str] = None


class ApplyHITLRequest(BaseModel):
    job_id: str
    issue_id: str

class HitlSuggestRequest(BaseModel):
    issues: List[Dict[str, Any]]
    epub_collection: str = ""


@app.on_event("startup")
async def startup_event():
    _init_jobs_db()
    loop = asyncio.get_event_loop()
    loop.set_default_executor(ThreadPoolExecutor(max_workers=16))
    # Schedule initial temp-dir cleanup
    _fire_task(_cleanup_old_temp_dirs())

    # Memory init (fast â€” SQLite + in-memory fallback)
    try:
        await memory_manager.initialize()
    except Exception as exc:
        logger.info(f"[STARTUP] memory_manager.initialize failed (non-fatal): {exc}")
    # Everything else deferred to a background task so startup returns immediately
    _fire_task(_background_startup())


@app.on_event("shutdown")
async def shutdown_event():
    logger.info('"Service shutting down â€” draining background tasks"')
    if _background_tasks:
        await asyncio.gather(*list(_background_tasks), return_exceptions=True)
    logger.info('"Shutdown complete"')


async def _background_startup():
    """Non-blocking startup: model loading + KB indexing run after server is ready."""
    try:
        loaded = await asyncio.get_event_loop().run_in_executor(None, rag_engine.initialize_models)
        if loaded:
            logger.info(f"[STARTUP] Embedding model loaded and warm: {rag_engine.model_name}")
        else:
            logger.error(f"[STARTUP] Embedding model unavailable: {rag_engine.model_name}")
    except Exception as exc:
        logger.info(f"[STARTUP] rag_engine.initialize_models failed (non-fatal): {exc}")
    try:
        indexer = ChromaIndexer(memory_manager)
        _fire_task(_index_kb_background(indexer))
    except Exception as exc:
        logger.info(f"[STARTUP] ChromaDB KB indexer setup failed (non-fatal): {exc}")


async def _index_kb_background(indexer: ChromaIndexer):
    """Index CSS, JS, and EPUB rules KB entries into ChromaDB after startup."""
    for entry in CSS_KB_ENTRIES:
        await indexer.index_kb_entry(
            rule_id=entry["rule_id"], title=entry["title"], content=entry["content"],
            collection="kb_css", domain=entry["domain"], file_type=entry["file_type"],
        )
    for entry in JS_KB_ENTRIES:
        await indexer.index_kb_entry(
            rule_id=entry["rule_id"], title=entry["title"], content=entry["content"],
            collection="kb_js", domain=entry["domain"], file_type=entry["file_type"],
        )
    for entry in EPUB_RULES_KB_ENTRIES:
        await indexer.index_kb_entry(
            rule_id=entry["rule_id"], title=entry["title"], content=entry["content"],
            collection="epub_rules", domain=entry["domain"], file_type=entry["file_type"],
        )
    for entry in ISSUE_PATTERNS_KB_ENTRIES:
        await indexer.index_kb_entry(
            rule_id=entry["rule_id"], title=entry["title"], content=entry["content"],
            collection="issue_patterns", domain=entry["domain"], file_type=entry["file_type"],
        )
    logger.info(
        f"[KB] indexed {len(CSS_KB_ENTRIES)} CSS + {len(JS_KB_ENTRIES)} JS + "
        f"{len(EPUB_RULES_KB_ENTRIES)} EPUB rules + {len(ISSUE_PATTERNS_KB_ENTRIES)} issue patterns"
    )


# ------------------------------------------------------------------
# Health / status
# ------------------------------------------------------------------

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "epub-automation-agent-service",
        "version": "2.0.0",
    }


@app.get("/llm-status")
async def llm_status():
    """Check Ollama endpoint reachability and return task-model routing map."""
    return await ollama_health()


@app.get("/memory/status")
async def memory_status():
    """Return current memory layer status (Redis, ChromaDB, episodic store)."""
    return await memory_manager.status()


# ------------------------------------------------------------------
# Evaluation endpoints â€” RAGAS-style + BLEU/ROUGE
# ------------------------------------------------------------------

@app.post("/evaluate/fix")
async def evaluate_fix(req: EvalFixRequest):
    """
    Evaluate a single LLM-generated fix using RAGAS-style LLM-as-judge
    (faithfulness, answer_relevancy, context_precision, fix_applicability)
    plus BLEU-4 and ROUGE-{1,2,L} text-overlap scores.
    """
    issue = {
        "id":         req.issue_id,
        "title":      req.issue_title,
        "suggestion": req.issue_suggestion,
    }
    result = await _fix_evaluator.evaluate_fix(
        issue=issue,
        fix_value=req.fix_value,
        kb_context=req.kb_context,
        file_content=req.file_content,
        reference_fix=req.reference_fix,
        run_id=req.run_id,
    )
    return result


@app.post("/evaluate/job")
async def evaluate_job(req: EvalJobRequest, background_tasks: BackgroundTasks):
    """
    Evaluate all LLM fixes from a completed autofix job.
    Triggers evaluation in the background and returns immediately.
    Poll GET /evaluate/results/{job_id} for results.
    """
    loop = asyncio.get_running_loop()
    job  = await loop.run_in_executor(None, _job_get, req.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found or expired")
    if job.get("status") != "done":
        raise HTTPException(status_code=400, detail="Job must be in 'done' state to evaluate")

    job_result = job.get("result", {})

    async def _eval_task():
        try:
            result = await _fix_evaluator.evaluate_job(job_result, req.job_id)
            logger.info(f'"event":"eval_job_done","job_id":"{req.job_id}","ragas_score":{result.get("ragas_score")}')
        except Exception as exc:
            logger.error(f'"event":"eval_job_error","job_id":"{req.job_id}","error":"{exc}"')

    _fire_task(_eval_task())
    return {"status": "evaluation_started", "job_id": req.job_id, "poll": f"/evaluate/results/{req.job_id}"}


@app.get("/evaluate/results/{run_id}")
async def get_eval_results(run_id: str, limit: int = 50):
    """Return stored RAGAS + BLEU/ROUGE evaluation results for a job."""
    loop = asyncio.get_running_loop()
    results = await loop.run_in_executor(None, _fix_evaluator.get_results, run_id, limit)
    if not results:
        return {"run_id": run_id, "message": "No evaluation results yet â€” run POST /evaluate/job first", "results": []}

    def _avg(key):
        vals = [r[key] for r in results if r.get(key) is not None and r[key] >= 0]
        return round(sum(vals) / len(vals), 4) if vals else -1.0

    return {
        "run_id":   run_id,
        "count":    len(results),
        "summary": {
            "ragas_score":        _avg("ragas_score"),
            "faithfulness":       _avg("faithfulness"),
            "answer_relevancy":   _avg("answer_relevancy"),
            "context_precision":  _avg("context_precision"),
            "fix_applicability":  _avg("fix_applicability"),
            "bleu4":              _avg("bleu4"),
            "rouge1":             _avg("rouge1"),
            "rouge2":             _avg("rouge2"),
            "rougeL":             _avg("rougeL"),
        },
        "results": results,
    }


@app.get("/evaluate/results")
async def get_all_eval_results(limit: int = 100):
    """Return the most recent evaluation results across all jobs."""
    loop = asyncio.get_running_loop()
    results = await loop.run_in_executor(None, _fix_evaluator.get_results, None, limit)
    return {"count": len(results), "results": results}


@app.post("/evaluate/bleu-rouge")
async def compute_bleu_rouge(req: BleuRougeRequest):
    """
    Compute BLEU-4 and ROUGE-{1,2,L} scores between a hypothesis and reference.
    Use for quick offline scoring without LLM judge overhead.
    """
    scores = _bleu_rouge_scorer.score(
        hypothesis=req.hypothesis,
        reference=req.reference,
        context=req.context,
    )
    return {
        "hypothesis": req.hypothesis,
        "reference":  req.reference,
        "scores":     scores,
    }


# ------------------------------------------------------------------
# Agent endpoints
# ------------------------------------------------------------------

@app.post("/triage")
async def triage_issues(req: TriageRequest):
    """Run the TriageAgent on a list of EPUB validation issues."""
    run_id = req.run_id or str(uuid.uuid4())[:8]
    result = await triage_agent.execute({
        "run_id": run_id,
        "action": "triage",
        "issues": req.issues,
        "use_llm_triage": req.use_llm_triage,
    })
    return result


@app.post("/fix-proposals")
async def get_fix_proposals(req: FixProposalsRequest):
    """
    Lightweight pipeline: triage â†’ parallel fixer only.
    No KBAgent (Qdrant), no VisionAgent, no ReporterAgent.
    Returns fix patches for LLM-routed issues within seconds.
    """
    run_id = req.run_id or str(uuid.uuid4())[:8]

    # Step 1: heuristic triage (no LLM calls â€” pure rules)
    triage_result = await triage_agent.execute({
        "run_id": run_id,
        "action": "triage",
        "issues": req.issues,
        "use_llm_triage": False,
    })
    triage_list = triage_result.get("triage_results", [])

    llm_issues = [
        req.issues[i]
        for i, t in enumerate(triage_list)
        if t.get("routing") == "llm" and i < len(req.issues)
    ][:20]  # Cap at 20; deduplication below keeps LLM calls to unique rules only

    # Step 2: KB context lookup (graceful â€” empty string if ChromaDB unavailable)
    kb_context = ""
    if llm_issues:
        try:
            kb_result = await kb_agent.execute({
                "run_id": run_id,
                "action": "kb_lookup",
                "issues": llm_issues,
            })
            kb_context = "\n\n".join([
                v.get("context_text", "")
                for v in kb_result.get("kb_context", {}).values()
                if v.get("context_text")
            ])
        except Exception as exc:
            logger.info(f"[fix-proposals] KB lookup failed (non-fatal): {exc}")

    # Step 3: parallel fixer â€” deduplicate by rule_id first
    fix_result: dict = {"fixes": [], "fixed_count": 0, "unfixable_count": 0}
    if llm_issues:
        # One LLM call per unique rule_id, then expand
        rule_groups: dict = {}
        for iss in llm_issues:
            rule_groups.setdefault(iss.get("id", "unknown"), []).append(iss)
        representative = [group[0] for group in rule_groups.values()]

        fix_result = await fixer_agent.execute({
            "run_id":    run_id,
            "action":    "fix",
            "issues":    representative,
            "kb_context": kb_context,
            "fast_mode": True,   # qwen2.5:7b / best structured model
        })

        # Expand fixes back to all instances of each rule
        rule_fix_map = {
            f["issue_id"]: f["patch"]
            for f in fix_result.get("fixes", [])
            if f.get("fixable") and f.get("patch", "").upper() not in ("CANNOT_FIX", "NONE", "")
        }
        expanded_fixes = []
        for rule_id, issues_in_group in rule_groups.items():
            patch = rule_fix_map.get(rule_id)
            for iss in issues_in_group:
                expanded_fixes.append({
                    "issue_id": iss.get("id", rule_id),
                    "patch":    patch or "CANNOT_FIX",
                    "fixable":  bool(patch),
                    "from_cache": False,
                })
        fix_result = {
            **fix_result,
            "fixes":          expanded_fixes,
            "fixed_count":    sum(1 for f in expanded_fixes if f["fixable"]),
            "unfixable_count": sum(1 for f in expanded_fixes if not f["fixable"]),
        }

    return {
        "status": "ok",
        "run_id": run_id,
        "triage": triage_result,
        "fix_result": fix_result,
        "summary": {
            "total": len(req.issues),
            "llm_routed": len(llm_issues),
            "hitl_routed": len(req.issues) - len(llm_issues),
            "agent_fixable": fix_result.get("fixed_count", 0),
        },
    }


@app.post("/orchestrate")
async def orchestrate(req: OrchestrateRequest):
    """
    Full orchestration pipeline: triage â†’ fix â†’ report.
    Returns structured result with triage_results, fix_results, and report URL.
    """
    run_id = req.run_id or str(uuid.uuid4())[:8]
    result = await orchestrator.execute({
        "run_id": run_id,
        "issues": req.issues,
        "validation_report": req.validation_report,
        "filename": req.filename,
        "image_paths": req.image_paths,
        "use_llm_triage": req.use_llm_triage,
    })
    return result


def _resolve_epub_path(epub_dir: str, file_ref: str) -> str:
    """Resolve a relative file reference from an EPUB issue to an absolute path."""
    if not file_ref:
        return ""
    clean = file_ref.lstrip("/").replace("/", os.sep)
    full  = os.path.join(epub_dir, clean)
    if os.path.exists(full):
        return full
    basename = os.path.basename(clean)
    for root, _, files in os.walk(epub_dir):
        if basename in files:
            return os.path.join(root, basename)
    return ""


def _attach_file_content(issues: List[Dict], epub_dir: str, max_chars: int = 4000):
    """
    Read the CSS/HTML file referenced in each issue and attach its content
    so the LLM can see the actual broken code â€” not just the issue description.
    Modifies issues in-place (adds _file_content, _file_name).
    """
    css_html_rules = {
        "L_CSS_SYNTAX", "L_CSS_INVALID_DECLARATION", "L_CSS_REFERENCE_MISSING",
        "L_CSS_REFERENCE_BROKEN", "L_FONT_FALLBACK", "L_HEADING_HIERARCHY",
        "L_TABLE_RESPONSIVE", "L_IMAGE_RENDERING", "L_RESPONSIVE_HORIZONTAL_SCROLL",
        "L_RESPONSIVE_TEXT_CLIPPING", "L_LAYOUT_OVERLAP",
        "A_HTML_LANG_MISSING", "A_LINK_TEXT_MISSING",
        "Media_IMAGE_NO_SRC", "Media_audio_controls", "Media_missing_control",
        "JS_SCRIPT_REFERENCE_BROKEN", "JS_SCRIPT_SYNTAX", "JS_UNSUPPORTED_API",
        "JS_INLINE_SCRIPT", "JS_EVENT_HANDLER_ATTRIBUTE", "JS_MODULE_SCRIPT",
        "JS_SCRIPT_MANIFEST_MISSING_FILE", "JS_SCRIPT_REFERENCE_MISSING_MANIFEST",
        "L_PARAGRAPH_SPACING", "L_BLOCKQUOTE_STYLING", "L_CODE_BLOCK_STYLING",
        "L_INLINE_STYLE_CONFLICT", "L_HEADING_CONSISTENCY", "L_FONT_CONSISTENCY",
        "L_FONT_EMBED_REFERENCE", "L_NO_CSS",
    }
    for iss in issues:
        rule_id  = iss.get("id", "")
        location = iss.get("location", {})
        file_ref = location.get("file", "") if isinstance(location, dict) else str(location)

        if rule_id not in css_html_rules or not file_ref:
            continue

        path = _resolve_epub_path(epub_dir, file_ref)
        if not path or not os.path.exists(path):
            # For CSS reference issues, look for the HTML file that has the <link>
            if "REFERENCE" in rule_id:
                for root, _, files in os.walk(epub_dir):
                    for f in files:
                        if f.lower().endswith((".html", ".xhtml", ".htm")):
                            path = os.path.join(root, f)
                            break
                    if path:
                        break
        if not path:
            continue

        try:
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                content = fh.read()

            # For large files, try to extract just the relevant section around the issue line
            line_no = location.get("line") if isinstance(location, dict) else None
            if line_no and len(content) > max_chars:
                lines = content.splitlines()
                try:
                    ln = int(line_no)
                    start = max(0, ln - 15)
                    end   = min(len(lines), ln + 15)
                    content = "\n".join(lines[start:end])
                except (ValueError, TypeError):
                    content = content[:max_chars]
            else:
                content = content[:max_chars]

            iss["_file_content"] = content
            iss["_file_name"]    = os.path.basename(path)
        except Exception:
            pass


def _build_trace(
    fixes: List[Dict],
    rule_groups: Dict[str, List[Dict]],
    patch_applied_ids: set,
    triage_list: List[Dict],
    llm_ids: set,
    auto_fixed_ids: set,
    auto_count: int,
    det_auto_applied: List[str] = None,
) -> List[Dict]:
    """Build a unified fix trace covering AUTO, LLM, and HITL issues."""
    det_auto_set = set(det_auto_applied or [])
    trace: List[Dict] = []

    # LLM entries â€” one per unique rule
    for fix in fixes:
        rid   = fix.get("issue_id", "")
        group = rule_groups.get(rid, [])
        trace.append({
            "issue_id":    rid,
            "title":       group[0].get("title", "") if group else "",
            "routing":     "llm",
            "engine":      "python_llm",
            "model_used":  fix.get("model_used", "unknown"),
            "task_type":   fix.get("task_type", "reasoning"),
            "fix_value":   fix.get("patch", "CANNOT_FIX"),
            "fixable":     fix.get("fixable", False),
            "from_cache":  fix.get("from_cache", False),
            "applied":     rid in patch_applied_ids,
            "instances":   len(group),
            "pre_location": fix.get("pre_location", ""),
            "confidence":  fix.get("confidence"),
            "fix_reason":  fix.get("fix_reason", ""),
            "kb_context":  fix.get("kb_context", ""),
        })

    # AUTO and HITL entries
    for t in triage_list:
        iid     = t.get("issue_id", "")
        routing = t.get("routing", "hitl")
        if iid in llm_ids:
            continue  # already covered above
        if routing == "auto":
            # Applied if Node.js fixed it, Python fallback fixed it,
            # or Node.js auto_count > 0 and fixedRules list is absent
            py_fixed   = iid in det_auto_set
            node_fixed = (iid in auto_fixed_ids) if auto_fixed_ids else (auto_count > 0 and not det_auto_set)
            is_fixed   = node_fixed or py_fixed
            engine     = "python_det" if py_fixed and not node_fixed else "node_autofix"
            trace.append({
                "issue_id":   iid,
                "title":      t.get("title", ""),
                "routing":    "auto",
                "engine":     engine,
                "model_used": "deterministic",
                "task_type":  "deterministic",
                "fix_value":  "applied" if is_fixed else "attempted",
                "fixable":    True,
                "from_cache": False,
                "applied":    is_fixed,
                "instances":  1,
            })
        else:
            trace.append({
                "issue_id":   iid,
                "title":      t.get("title", ""),
                "routing":    "hitl",
                "engine":     "manual",
                "model_used": "â€”",
                "task_type":  "â€”",
                "fix_value":  "â€”",
                "fixable":    False,
                "from_cache": False,
                "applied":    False,
                "instances":  1,
            })

    return trace


@app.post("/agent-autofix")
async def agent_autofix(
    file: UploadFile = File(...),
    issues: str = Form(...),
):
    """
    Async agent autofix: reads the EPUB immediately, spawns a background pipeline task,
    and returns a jobId. Poll GET /agent-autofix-status/{jobId} for progress and result.
    """
    run_id = str(uuid.uuid4())[:8]

    try:
        issues_list: List[Dict] = json.loads(issues)
    except Exception:
        raise HTTPException(status_code=400, detail="issues must be a valid JSON array string")
    if not isinstance(issues_list, list):
        raise HTTPException(status_code=400, detail="issues must decode to a JSON array")

    file_bytes = await file.read()

    # â”€â”€ Input validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if len(file_bytes) > _MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large â€” maximum is {_MAX_UPLOAD_MB} MB"
        )
    if not file_bytes[:2] == b"PK":
        raise HTTPException(
            status_code=400,
            detail="Invalid file â€” EPUB files must be ZIP-based (magic bytes PK)"
        )
    # Sanitise filename: strip path separators, allow only safe chars
    raw_name  = os.path.basename(file.filename or "input.epub")
    safe_name = re.sub(r"[^\w\-.]", "_", raw_name)
    if not safe_name.lower().endswith(".epub"):
        safe_name = safe_name + ".epub"

    _job_expire()
    _job_create(run_id)
    _audit(run_id, "job_submitted", safe_name)
    logger.info(f'"run_id":"{run_id}","event":"job_submitted","file":"{safe_name}","size_kb":{len(file_bytes)//1024}')

    _fire_task(_run_autofix_job(run_id, file_bytes, safe_name, issues_list))
    return JSONResponse({"jobId": run_id, "status": "running", "stage": "queued"})


@app.get("/agent-autofix-status/{job_id}")
async def agent_autofix_status(job_id: str):
    """Poll the status of a background autofix job.

    epub_b64 is stripped from the response to keep polling fast â€” fetch
    the fixed EPUB separately via GET /agent-autofix-download/{job_id}.
    """
    loop = asyncio.get_running_loop()
    job  = await loop.run_in_executor(None, _job_get, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Autofix job not found or expired")
    out = {k: v for k, v in job.items() if not k.startswith("_")}
    # Strip the large base64 EPUB from every poll response
    result = out.get("result")
    if isinstance(result, dict) and "epub_b64" in result:
        slim = {k: v for k, v in result.items() if k != "epub_b64"}
        slim["has_epub"] = True
        out["result"] = slim
    return out


@app.get("/agent-autofix-download/{job_id}")
async def agent_autofix_download(job_id: str):
    """Return the fixed EPUB as an application/epub+zip download.

    Called once after the job reaches status=done, avoiding repeated
    serialisation of the large base64 blob on every status poll.
    """
    loop = asyncio.get_running_loop()
    job  = await loop.run_in_executor(None, _job_get, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found or expired")
    if job.get("status") != "done":
        raise HTTPException(status_code=400, detail="Job not complete yet")
    result   = job.get("result") or {}
    epub_b64 = result.get("epub_b64", "")
    if not epub_b64:
        raise HTTPException(status_code=404, detail="No fixed EPUB available for this job")
    import base64
    epub_bytes = base64.b64decode(epub_b64)
    filename   = result.get("filename", f"{job_id}_fixed.epub")
    from fastapi.responses import Response
    return Response(
        content=epub_bytes,
        media_type="application/epub+zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/stream/autofix/{job_id}")
async def stream_autofix_status(job_id: str):
    """Server-Sent Events endpoint â€” real-time autofix job progress."""
    async def _event_gen():
        last_state = None
        for _ in range(7200):  # 2h max
            loop = asyncio.get_running_loop()
            job  = await loop.run_in_executor(None, _job_get, job_id)
            if not job:
                yield f"event: error\ndata: {json.dumps({'error': 'job not found'})}\n\n"
                return
            state = (job.get("status"), job.get("stage"))
            if state != last_state:
                last_state = state
                payload = {
                    "status":     job.get("status"),
                    "stage":      job.get("stage"),
                    "updated_at": job.get("updated_at"),
                    "run_id":     job_id,
                }
                yield f"data: {json.dumps(payload)}\n\n"
            if job.get("status") in ("done", "failed"):
                final = {**payload}
                if job.get("status") == "done":
                    r = job.get("result") or {}
                    final["stats"]    = r.get("stats", {})
                    final["timing"]   = r.get("timing", {})
                elif job.get("status") == "failed":
                    final["error"] = job.get("error", "")
                yield f"event: complete\ndata: {json.dumps(final)}\n\n"
                return
            await asyncio.sleep(1)
    return StreamingResponse(
        _event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@app.get("/stream/validate/{job_id}")
async def stream_validate_status(job_id: str):
    """Server-Sent Events for Node.js validation jobs â€” polls Node status and re-emits."""
    async def _event_gen():
        last_stage = None
        for _ in range(7200):
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    r = await client.get(f"{NODE_URL}/validate-status/{job_id}")
                if r.is_success:
                    payload = r.json()
                    stage   = payload.get("stage", "")
                    status  = payload.get("status", "running")
                    if stage != last_stage:
                        last_stage = stage
                        yield f"data: {json.dumps({'status': status, 'stage': stage, 'job_id': job_id})}\n\n"
                    if status in ("done", "failed"):
                        final = {"status": status, "stage": stage, "job_id": job_id}
                        if status == "done":
                            final["result"] = payload.get("result", {})
                        elif status == "failed":
                            final["error"] = payload.get("error", "")
                        yield f"event: complete\ndata: {json.dumps(final)}\n\n"
                        return
            except Exception:
                pass
            await asyncio.sleep(1)
    return StreamingResponse(
        _event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@app.post("/bulk-agent-autofix")
async def bulk_agent_autofix(
    files: List[UploadFile] = File(...),
    issues_map: str = Form(...),
):
    """
    Bulk EPUB autofix: accepts multiple EPUB files and processes them in parallel.
    issues_map: JSON object {filename: [issues_array]}
    Returns list of {jobId, filename} for polling via /agent-autofix-status/{jobId}
    """
    try:
        per_file_issues: Dict[str, List] = json.loads(issues_map)
    except Exception:
        raise HTTPException(status_code=400, detail="issues_map must be a valid JSON object {filename: [issues]}")

    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")
    if len(files) > 20:
        raise HTTPException(status_code=400, detail="Maximum 20 files per bulk request")

    _job_expire()
    jobs = []
    for upload in files:
        file_bytes = await upload.read()
        if len(file_bytes) > _MAX_UPLOAD_BYTES:
            jobs.append({"filename": upload.filename, "error": f"File too large (>{_MAX_UPLOAD_MB}MB)"})
            continue
        if not file_bytes[:2] == b"PK":
            jobs.append({"filename": upload.filename, "error": "Not a valid EPUB (missing PK magic bytes)"})
            continue

        raw_name  = os.path.basename(upload.filename or "input.epub")
        safe_name = re.sub(r"[^\w\-.]", "_", raw_name)
        if not safe_name.lower().endswith(".epub"):
            safe_name += ".epub"

        # Resolve per-file issues: try exact name, basename, or empty list
        issues_list = (
            per_file_issues.get(upload.filename)
            or per_file_issues.get(os.path.basename(upload.filename or ""))
            or per_file_issues.get(safe_name)
            or []
        )

        run_id = str(uuid.uuid4())[:8]
        _job_create(run_id)
        _audit(run_id, "bulk_job_submitted", safe_name)
        _fire_task(_run_autofix_job(run_id, file_bytes, safe_name, issues_list))
        jobs.append({"jobId": run_id, "filename": safe_name, "status": "running", "issues_count": len(issues_list)})
        logger.info(f'"run_id":"{run_id}","event":"bulk_job_started","file":"{safe_name}"')

    return JSONResponse({"batch_size": len(files), "jobs": jobs})


@app.post("/bulk-validate-async")
async def bulk_validate_async(files: List[UploadFile] = File(...)):
    """
    Submit multiple EPUBs for validation in parallel via Node.js.
    Returns list of {jobId, filename} for polling via GET /stream/validate/{jobId}.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")
    if len(files) > 20:
        raise HTTPException(status_code=400, detail="Maximum 20 files per bulk request")

    async def _submit_one(upload: UploadFile) -> Dict:
        file_bytes = await upload.read()
        raw_name   = os.path.basename(upload.filename or "input.epub")
        safe_name  = re.sub(r"[^\w\-.]", "_", raw_name)
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(
                    f"{NODE_URL}/validate-async",
                    files={"file": (safe_name, file_bytes, "application/epub+zip")},
                )
            if resp.is_success:
                job_id = resp.json().get("jobId", "")
                return {"jobId": job_id, "filename": safe_name, "status": "running",
                        "stream": f"/stream/validate/{job_id}"}
            return {"filename": safe_name, "error": f"HTTP {resp.status_code}"}
        except Exception as exc:
            return {"filename": safe_name, "error": str(exc)}

    results = await asyncio.gather(*[_submit_one(f) for f in files], return_exceptions=True)
    jobs = [r if isinstance(r, dict) else {"error": str(r)} for r in results]
    return JSONResponse({"batch_size": len(files), "jobs": jobs})


@app.post("/agent-autofix-apply-hitl")
async def agent_autofix_apply_hitl(req: ApplyHITLRequest):
    """
    Apply an AI-generated HITL suggestion to the fixed EPUB from a completed job.
    Returns the updated epub as base64.
    """
    loop = asyncio.get_running_loop()
    job  = await loop.run_in_executor(None, _job_get, req.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found or expired")
    if job.get("status") != "done":
        raise HTTPException(status_code=400, detail="Job not complete yet")

    result = job.get("result", {})
    hitl_suggestions = result.get("hitl_suggestions", {})
    suggestion = hitl_suggestions.get(req.issue_id)
    if not suggestion:
        raise HTTPException(status_code=404, detail=f"No suggestion found for issue '{req.issue_id}'")
    if not suggestion.get("fixable") or not suggestion.get("patch"):
        raise HTTPException(status_code=400, detail="Suggestion is not fixable (CANNOT_FIX)")

    epub_b64 = result.get("epub_b64", "")
    if not epub_b64:
        raise HTTPException(status_code=500, detail="No EPUB available in job result")

    # Decode stored EPUB, apply the suggestion patch, return updated base64
    try:
        loop = asyncio.get_running_loop()
        epub_bytes = base64.b64decode(epub_b64)

        # Write to temp file, apply patch
        tmp_dir = tempfile.mkdtemp(prefix="hitl_apply_")
        try:
            orig_name = result.get("filename", "fixed.epub")
            tmp_epub = os.path.join(tmp_dir, orig_name)
            with open(tmp_epub, "wb") as fh:
                fh.write(epub_bytes)

            patch = {
                "issue_id": req.issue_id,
                "value":    suggestion["patch"],
                "fixable":  True,
                "issue":    suggestion.get("issue", {}),
            }
            patcher = EPUBPatcher()
            patch_result = await loop.run_in_executor(
                None, patcher.apply_patches, tmp_epub, [patch]
            )

            applied = patch_result.get("applied", [])
            if req.issue_id not in applied:
                raise ValueError(f"Patcher could not apply fix for '{req.issue_id}'")

            output_epub = patch_result.get("output_path", tmp_epub)
            with open(output_epub, "rb") as fh:
                new_b64 = base64.b64encode(fh.read()).decode("ascii")

            # Update the stored job result so re-downloads get the latest EPUB
            updated_result = dict(result)
            updated_result["epub_b64"] = new_b64
            updated_result.setdefault("hitl_suggestions", {})
            updated_result["hitl_suggestions"].pop(req.issue_id, None)
            _job_set(req.job_id, result=updated_result)

            # Record fix outcome in long-term memory
            _fire_task(memory_manager.record_fix_outcome(req.issue_id, True, "hitl_approved"))

            return {
                "ok":       True,
                "epub_b64": new_b64,
                "filename": orig_name,
                "applied":  req.issue_id,
                "diffs":    patch_result.get("diffs", []),
            }
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to apply HITL suggestion: {exc}")


@app.post("/hitl-suggest")
async def hitl_suggest(req: HitlSuggestRequest):
    """
    Generate AI suggestions on-demand for any list of HITL issues.
    Used by the HITL Queue tab to get suggestions for issues not covered
    by a previous autofix run.
    """
    issues = req.issues
    epub_collection = req.epub_collection or ""

    if not issues:
        return {}

    domain_groups = _group_by_domain(issues)
    tasks = [
        _DOMAIN_AGENT_MAP[domain].execute({
            "run_id":          f"hitl_suggest_{uuid.uuid4().hex[:8]}",
            "action":          "fix",
            "issues":          domain_issues,
            "epub_collection": epub_collection,
        })
        for domain, domain_issues in domain_groups.items()
    ]

    results = await asyncio.gather(*tasks, return_exceptions=True)
    suggestions: Dict[str, Dict] = {}
    for result in results:
        if isinstance(result, Exception):
            logger.info(f"[hitl-suggest] domain agent error: {result}")
            continue
        for fix in result.get("fixes", []):
            iid = fix.get("issue_id", "")
            if iid:
                suggestions[iid] = {
                    "patch":        fix.get("patch", ""),
                    "fixable":      fix.get("fixable", False),
                    "model_used":   fix.get("model_used", ""),
                    "task_type":    fix.get("task_type", ""),
                    "pre_location": fix.get("pre_location", ""),
                    "confidence":   fix.get("confidence"),
                    "fix_reason":   fix.get("fix_reason", ""),
                }
    return suggestions


def _group_by_domain(issues: List[Dict]) -> Dict[str, List[Dict]]:
    """
    Route LLM issues to specialist domain agents by rule ID prefix.
    Returns only non-empty domain buckets.

    css  â†’ CSSFixerAgent   (L_CSS_*, L_FONT_*, L_TABLE_*, L_LIST_*, L_RESPONSIVE_*, L_LAYOUT_*, L_HEADING_*, L_IMAGE_RENDERING)
    js   â†’ JSFixerAgent    (JS_*)
    meta â†’ MetadataAgent   (M_*, T_*)
    html â†’ HTMLAccessibilityAgent (everything else: A_*, Media_*, IMG_*)
    """
    groups: Dict[str, List] = {"css": [], "js": [], "html": [], "meta": []}
    for iss in issues:
        rid = str(iss.get("id", "") or "")
        if not rid or rid.lower() in ("unknown", "none"):
            continue  # skip issues with no meaningful ID â€” can't apply fixes
        if rid.startswith(("L_CSS", "L_FONT", "L_TABLE", "L_LIST",
                           "L_RESPONSIVE", "L_LAYOUT", "L_HEADING", "L_IMAGE_RENDERING",
                           "L_PARAGRAPH", "L_BLOCKQUOTE", "L_CODE_BLOCK",
                           "L_INLINE_STYLE", "L_NO_CSS")):
            groups["css"].append(iss)
        elif rid.startswith("JS_"):
            groups["js"].append(iss)
        elif rid.startswith(("M_", "T_")):
            groups["meta"].append(iss)
        else:
            groups["html"].append(iss)
    return {k: v for k, v in groups.items() if v}


async def _run_autofix_job(run_id: str, file_bytes: bytes, safe_name: str, issues_list: List[Dict]):
    """Full autofix pipeline running as a background asyncio task."""
    import time as _time
    _t_job = _time.monotonic()
    _timing: Dict[str, float] = {}

    def _tick(label: str, since: float) -> float:
        elapsed = _time.monotonic() - since
        _timing[label] = round(elapsed, 2)
        logger.info(f'"run_id":"{run_id}","timing":"{label}","s":{elapsed:.2f}')
        return _time.monotonic()

    temp_dir = tempfile.mkdtemp(prefix="epub_agentfix_")
    try:
        temp_epub = os.path.join(temp_dir, safe_name)
        with open(temp_epub, "wb") as fh:
            fh.write(file_bytes)

        # Update stage immediately so UI doesn't show "queued" while we work
        _job_set(run_id, stage="triaging")

        # â”€â”€ Step 0: Index EPUB content in the background â€” do not await â”€â”€â”€â”€â”€
        # Fired as a background task so it never blocks the fix pipeline.
        # Agents receive epub_collection so they can query per-epub chunks for
        # richer context; the collection is cleaned up in the finally block.
        epub_collection = f"epub_{run_id}"
        try:
            _epub_indexer = EPUBContentIndexer(ChromaIndexer(memory_manager))
            _fire_task(_epub_indexer.index_epub(temp_epub, run_id))
            logger.info(f"[autofix {run_id}] EPUB content indexing started in background")
        except Exception as _idx_exc:
            epub_collection = ""  # indexer failed â€” nothing to clean up or query
            logger.info(f"[autofix {run_id}] EPUB content indexer setup failed (non-fatal): {_idx_exc}")

        # â”€â”€ Step 1: Triage ALL issues â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        _job_set(run_id, stage="triaging")
        _t_step = _time.monotonic()
        triage_result = await triage_agent.execute({
            "run_id":         run_id,
            "action":         "triage",
            "issues":         issues_list,
            "use_llm_triage": False,
        })
        triage_list = triage_result.get("triage_results", [])
        _t_step = _tick("triage", _t_step)

        auto_count = sum(1 for t in triage_list if t.get("routing") == "auto")
        llm_count  = sum(1 for t in triage_list if t.get("routing") == "llm")
        hitl_count = sum(1 for t in triage_list if t.get("routing") == "hitl")
        logger.info(f'"run_id":"{run_id}","event":"triage_complete","total":{len(issues_list)},"auto":{auto_count},"llm":{llm_count},"hitl":{hitl_count}')
        for t in triage_list[:15]:
            logger.info(f'"run_id":"{run_id}","issue":"{t.get(chr(105)+"ssue_id","?")}","routing":"{t.get("routing")}"')

        # Build triage lookup so we can attach task_type to each issue
        # Key triage by rule_id â€” all instances of the same rule get the same routing
        triage_by_rule = {t.get("issue_id", ""): t for t in triage_list}

        llm_issues = []
        hitl_issues = []
        for iss in issues_list:
            iid = str(iss.get("id", "") or "")
            t   = triage_by_rule.get(iid, {})
            routing = t.get("routing", "llm")
            iss_copy = dict(iss)
            iss_copy["_task_type"] = t.get("task_type", "reasoning")
            if routing != "auto":
                llm_issues.append(iss_copy)

        # Ensure no manual-review issues are carried in the pipeline.
        hitl_issues = []

        # â”€â”€ Step 2: Node.js AUTO fixes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        _t_step = _time.monotonic()
        # Call Node.js /autofix for ALL deterministic (AUTO) rules.
        # The result EPUB becomes the base for LLM fixes in Step 4.
        auto_applied   = 0
        auto_fixed_ids: set = set()
        node_fix_error = ""

        if auto_count > 0:
            _job_set(run_id, stage="node_fixing")
            logger.info(f'"run_id":"{run_id}","event":"node_fix_start","auto_count":{auto_count}')
            try:
                _node_fix_timeout = int(os.getenv("AUTOFIX_NODE_TIMEOUT_S", "50"))
                async with httpx.AsyncClient(timeout=_node_fix_timeout) as client:
                    with open(temp_epub, "rb") as fh:
                        epub_raw = fh.read()
                    node_resp = await _node_post(
                        client,
                        f"{NODE_URL}/autofix",
                        files={"file": ("input.epub", epub_raw, "application/epub+zip")},
                        data={"report": json.dumps({"results": issues_list}), "verifyAutofix": "false"},
                    )
                    if node_resp.is_success:
                        node_data = node_resp.json()
                        auto_applied    = int(node_data.get("fixesApplied", 0) or 0)
                        auto_fixed_ids  = set(node_data.get("fixedRules", []) or [])
                        logger.info(f'"autofix":"{run_id}","node_fixed_rules":{sorted(list(auto_fixed_ids))}')
                        download_url    = node_data.get("downloadUrl", "")
                        if download_url:
                            dl_url = f"{NODE_URL}{download_url}" if not download_url.startswith("http") else download_url
                            dl_resp = await client.get(dl_url, timeout=120)
                            if dl_resp.is_success:
                                node_fixed_path = os.path.join(temp_dir, "node_fixed.epub")
                                with open(node_fixed_path, "wb") as fw:
                                    fw.write(dl_resp.content)
                                temp_epub = node_fixed_path
                                logger.info(f"[autofix {run_id}] Node.js applied {auto_applied} AUTO fix(es)")
                            else:
                                node_fix_error = f"EPUB download failed: HTTP {dl_resp.status_code}"
                        else:
                            node_fix_error = "Node.js returned no downloadUrl"
                    else:
                        node_fix_error = f"Node.js /autofix HTTP {node_resp.status_code}"
            except Exception as exc:
                node_fix_error = str(exc)

            if node_fix_error:
                logger.info(f"[autofix {run_id}] Node.js autofix non-fatal error: {node_fix_error}")
        _t_step = _tick("node_auto_fix", _t_step)

        # â”€â”€ Step 2b: Python fallback for AUTO issues Node.js couldn't fix â”€â”€
        det_auto_applied: List[str] = []
        auto_unfixed_issues = [
            issues_list[i]
            for i, t in enumerate(triage_list)
            if t.get("routing") == "auto"
            and t.get("issue_id", "") not in auto_fixed_ids
            and i < len(issues_list)
        ]
        if auto_unfixed_issues:
            logger.info(f"[autofix {run_id}] Python fallback for {len(auto_unfixed_issues)} AUTO-unresolved issue(s)")
            _det_patcher = EPUBPatcher()
            _det_loop    = asyncio.get_running_loop()
            _fb_result   = await _det_loop.run_in_executor(
                None, _det_patcher.apply_fallback_patches, temp_epub, auto_unfixed_issues
            )
            det_auto_applied = _fb_result.get("applied", [])
            if det_auto_applied:
                temp_epub = _fb_result["output_path"]
                logger.info(f"[autofix {run_id}] Python fallback fixed AUTO: {det_auto_applied}")

        # â”€â”€ Step 3: Early return when no LLM issues â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        if not llm_issues:
            # Still generate HITL suggestions even without LLM issues
            early_hitl_suggestions: Dict[str, Dict] = {}
            if hitl_issues:
                _attach_file_content(hitl_issues, temp_dir)
                _job_set(run_id, stage=f"hitl_suggestions ({len(hitl_issues)} issues)")
                try:
                    hitl_domain_groups = _group_by_domain(hitl_issues)
                    hitl_tasks = [
                        _DOMAIN_AGENT_MAP[domain].execute({
                            "run_id": run_id, "action": "fix",
                            "issues": domain_issues,
                            "epub_collection": epub_collection,
                        })
                        for domain, domain_issues in hitl_domain_groups.items()
                    ]
                    hitl_results = await asyncio.gather(*hitl_tasks, return_exceptions=True)
                    for domain, result in zip(hitl_domain_groups.keys(), hitl_results):
                        if isinstance(result, Exception):
                            logger.info(f"[autofix {run_id}] early HITL domain '{domain}' error: {result}")
                            continue
                        for hf in result.get("fixes", []):
                            iid = hf.get("issue_id", "")
                            if iid:
                                orig = next((x for x in hitl_issues if x.get("id") == iid), {})
                                early_hitl_suggestions[iid] = {
                                    "patch":      hf.get("patch", ""),
                                    "fixable":    hf.get("fixable", False),
                                    "model_used": hf.get("model_used", ""),
                                    "task_type":  hf.get("task_type", ""),
                                    "issue":      orig,
                                }
                except Exception as exc:
                    logger.info(f"[autofix {run_id}] early HITL suggestions failed (non-fatal): {exc}")

            with open(temp_epub, "rb") as fh:
                epub_b64 = base64.b64encode(fh.read()).decode("ascii")
            base = os.path.splitext(safe_name)[0]
            fix_trace = _build_trace(
                fixes=[], rule_groups={}, patch_applied_ids=set(),
                triage_list=triage_list, llm_ids=set(),
                auto_fixed_ids=auto_fixed_ids, auto_count=auto_count,
                det_auto_applied=det_auto_applied,
            )
            _det_early = len(det_auto_applied)
            _early_diffs = _fb_result.get("diffs", []) if det_auto_applied else []
            _job_set(run_id, status="done", stage="done", result={
                "epub_b64":  epub_b64,
                "filename":  f"{base}_agent_fixed.epub",
                "run_id":    run_id,
                "stats": {
                    "total_issues": len(issues_list),
                    "auto_issues":  auto_count,  "auto_applied":  auto_applied,
                    "det_applied":  _det_early,
                    "llm_issues":   0,            "llm_applied":   0,
                    "hitl_issues":  hitl_count,
                    "applied":      auto_applied + _det_early,
                    "failed":       0,            "attempted":     0,
                    "unique_rules": 0,            "cache_hits":    0,
                },
                "triage":           triage_list,
                "fix_trace":        fix_trace,
                "diffs":            _early_diffs,
                "hitl_suggestions": early_hitl_suggestions,
            })
            _audit(run_id, "job_done", f"applied={auto_applied + _det_early} (auto only path)")
            logger.info(f'"run_id":"{run_id}","event":"job_done_auto_only","applied":{auto_applied + _det_early}')
            return

        # â”€â”€ Step 4: Deduplicate LLM issues by rule_id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        rule_groups: Dict[str, List[Dict]] = {}
        for iss in llm_issues:
            rid = iss.get("id", "unknown")
            rule_groups.setdefault(rid, []).append(iss)

        representative_issues = [group[0] for group in rule_groups.values()]
        total_unique_rules    = len(representative_issues)
        cache_hits            = len(llm_issues) - total_unique_rules
        logger.info(f"[autofix {run_id}] {len(llm_issues)} LLM issues -> {total_unique_rules} unique rules")

        # Extract EPUB so _attach_file_content can read CSS/HTML files inside it
        epub_extract_dir = os.path.join(temp_dir, "epub_extracted")
        try:
            import zipfile
            with zipfile.ZipFile(temp_epub, "r") as zf:
                zf.extractall(epub_extract_dir)
            logger.info(f"[autofix {run_id}] EPUB extracted to {epub_extract_dir}")
        except Exception as _ex:
            epub_extract_dir = temp_dir
            logger.info(f"[autofix {run_id}] EPUB extraction failed (non-fatal): {_ex}")

        # Attach file content for grounded LLM prompts
        _attach_file_content(representative_issues, epub_extract_dir)

        # â”€â”€ Step 5+6: Domain agents (each does own hybrid KB lookup + fix) â”€
        # Issues are split by domain and processed in parallel.
        # Each agent queries its specialized KB collections with hybrid BM25+dense search.
        domain_groups = _group_by_domain(representative_issues)
        domain_summary = ", ".join(f"{k}:{len(v)}" for k, v in domain_groups.items())
        _job_set(run_id, stage=f"domain_fixing ({total_unique_rules} rules: {domain_summary})")
        logger.info(f"[autofix {run_id}] domain split: {domain_summary}")

        # â”€â”€ Steps 5 + 6b: LLM fixes and HITL suggestions run in parallel â”€â”€â”€â”€
        # Both use domain agents on disjoint issue sets â€” no conflict.
        if hitl_issues:
            _attach_file_content(hitl_issues, epub_extract_dir)
        hitl_domain_groups = _group_by_domain(hitl_issues) if hitl_issues else {}

        domain_tasks = [
            _DOMAIN_AGENT_MAP[domain].execute({
                "run_id":          run_id,
                "action":          "fix",
                "issues":          domain_issues,
                "epub_collection": epub_collection,
            })
            for domain, domain_issues in domain_groups.items()
        ]
        hitl_tasks = [
            _DOMAIN_AGENT_MAP[domain].execute({
                "run_id":          run_id,
                "action":          "fix",
                "issues":          domain_issues,
                "epub_collection": epub_collection,
            })
            for domain, domain_issues in hitl_domain_groups.items()
        ]

        _job_set(run_id, stage=f"domain_fixing+hitl ({total_unique_rules} llm, {len(hitl_issues)} hitl)")
        _t_llm = _time.monotonic()
        all_agent_results = await asyncio.gather(
            *(domain_tasks + hitl_tasks), return_exceptions=True
        )
        _tick("llm_domain_agents", _t_llm)
        domain_results = all_agent_results[:len(domain_tasks)]
        hitl_agent_results = all_agent_results[len(domain_tasks):]

        fixes: List[Dict] = []
        for domain, result in zip(domain_groups.keys(), domain_results):
            if isinstance(result, Exception):
                logger.info(f"[autofix {run_id}] domain '{domain}' agent error: {result}")
            else:
                domain_fixes = result.get("fixes", [])
                logger.info(f"[autofix {run_id}] domain '{domain}': {result.get('fixed_count',0)}/{len(domain_fixes)} fixed")
                fixes.extend(domain_fixes)

        hitl_suggestions: Dict[str, Dict] = {}
        if hitl_issues:
            logger.info(f"[autofix {run_id}] HITL suggestions for {len(hitl_issues)} issue(s) (ran in parallel)")
            for result in hitl_agent_results:
                if isinstance(result, Exception):
                    continue
                for hf in result.get("fixes", []):
                    iid = hf.get("issue_id", "")
                    if iid:
                        orig = next((x for x in hitl_issues if x.get("id") == iid), {})
                        hitl_suggestions[iid] = {
                            "patch":        hf.get("patch", ""),
                            "fixable":      hf.get("fixable", False),
                            "model_used":   hf.get("model_used", ""),
                            "task_type":    hf.get("task_type", ""),
                            "pre_location": hf.get("pre_location", ""),
                            "confidence":   hf.get("confidence"),
                            "fix_reason":   hf.get("fix_reason", ""),
                            "issue":        orig,
                        }

        # â”€â”€ Step 7: Build patches from LLM results â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        rule_fix_map: Dict[str, Dict] = {}
        for fix in fixes:
            issue_id  = fix.get("issue_id", "")
            patch_val = (fix.get("patch") or "").strip()
            if fix.get("fixable") and patch_val and patch_val.upper() not in ("CANNOT_FIX", "NONE", ""):
                rule_fix_map[issue_id] = fix

        patches: List[Dict] = []
        for rule_id, issues_in_group in rule_groups.items():
            fix_meta = rule_fix_map.get(rule_id)
            if not fix_meta:
                continue
            for iss in issues_in_group:
                patches.append({
                    "issue_id": iss.get("id", rule_id),
                    "value":    fix_meta["patch"],
                    "fixable":  True,
                    "issue":    iss,
                })

        # â”€â”€ Step 8: EPUBPatcher â€” applies LLM patches on Node.js EPUB â”€â”€â”€â”€â”€
        _job_set(run_id, stage="patching")
        llm_applied = 0
        failed      = 0
        patch_applied_ids: set = set()
        all_diffs: List[Dict]  = []
        loop = asyncio.get_running_loop()
        if patches:
            patcher      = EPUBPatcher()
            patch_result = await loop.run_in_executor(
                None, patcher.apply_patches, temp_epub, patches
            )
            llm_applied       = patch_result.get("applied_count", 0)
            failed            = patch_result.get("failed_count",  0)
            patch_applied_ids = set(patch_result.get("applied", []))
            output_epub       = patch_result.get("output_path", temp_epub)
            all_diffs.extend(patch_result.get("diffs", []))
        else:
            output_epub = temp_epub

        # â”€â”€ Step 8b: Deterministic fallback for LLM CANNOT_FIX issues â”€â”€â”€â”€â”€
        det_llm_applied: List[str] = []
        llm_cannot_fix_issues = [
            iss for iss in representative_issues
            if iss.get("id", "") not in rule_fix_map
        ]
        if llm_cannot_fix_issues:
            logger.info(f"[autofix {run_id}] Deterministic fallback for {len(llm_cannot_fix_issues)} CANNOT_FIX issue(s)")
            _css_patcher = EPUBPatcher()
            _css_fb      = await loop.run_in_executor(
                None, _css_patcher.apply_fallback_patches, output_epub, llm_cannot_fix_issues
            )
            det_llm_applied = _css_fb.get("applied", [])
            if det_llm_applied:
                output_epub = _css_fb["output_path"]
                patch_applied_ids.update(det_llm_applied)
                all_diffs.extend(_css_fb.get("diffs", []))
                logger.info(f"[autofix {run_id}] Deterministic fallback fixed LLM: {det_llm_applied}")

        with open(output_epub, "rb") as fh:
            epub_b64 = base64.b64encode(fh.read()).decode("ascii")

        # â”€â”€ Step 9: Build unified trace â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        llm_ids = {iss.get("id") for iss in llm_issues}
        fix_trace = _build_trace(
            fixes=fixes, rule_groups=rule_groups, patch_applied_ids=patch_applied_ids,
            triage_list=triage_list, llm_ids=llm_ids,
            auto_fixed_ids=auto_fixed_ids, auto_count=auto_count,
            det_auto_applied=det_auto_applied,
        )

        det_total = len(det_auto_applied) + len(det_llm_applied)
        base = os.path.splitext(safe_name)[0]
        _timing["total"] = round(_time.monotonic() - _t_job, 2)
        logger.info(f'"run_id":"{run_id}","timing_summary":{_timing}')
        _job_set(run_id, status="done", stage="done", result={
            "epub_b64":  epub_b64,
            "filename":  f"{base}_agent_fixed.epub",
            "run_id":    run_id,
            "stats": {
                "total_issues":  len(issues_list),
                "auto_issues":   auto_count,      "auto_applied":  auto_applied,
                "llm_issues":    len(llm_issues), "llm_applied":   llm_applied,
                "det_applied":   det_total,
                "hitl_issues":   hitl_count,
                "applied":       auto_applied + llm_applied + det_total,
                "failed":        failed,
                "attempted":     len(patches),
                "unique_rules":  total_unique_rules,
                "cache_hits":    cache_hits,
            },
            "triage":            triage_list,
            "fix_trace":         fix_trace,
            "diffs":             all_diffs,
            "hitl_suggestions":  hitl_suggestions,
            "timing":            _timing,
        })

        applied_total = auto_applied + llm_applied + det_total
        logger.info(f'"run_id":"{run_id}","event":"job_done","applied":{applied_total},"failed":{failed},"total_s":{_timing["total"]}')
        _audit(run_id, "job_done", f"applied={applied_total} failed={failed}")

        # Record per-rule fix outcomes in long-term memory for adaptive triage
        for t in triage_list:
            rule  = t.get("issue_id") or t.get("id", "")
            route = t.get("routing", "auto")
            if not rule:
                continue
            success = rule in patch_applied_ids or rule in auto_fixed_ids
            _fire_task(memory_manager.record_fix_outcome(rule, success, route))

        # Periodic temp-dir cleanup (every job)
        _fire_task(_cleanup_old_temp_dirs())

    except Exception as exc:
        logger.error(f'"run_id":"{run_id}","event":"job_failed","error":"{type(exc).__name__}: {exc}"')
        _audit(run_id, "job_failed", f"{type(exc).__name__}: {exc}")
        _job_set(run_id, status="failed", stage="error", error=f"Agent autofix pipeline failed: {exc}")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
        # Drop the per-run epub ChromaDB collection so it doesn't accumulate on disk
        if epub_collection:
            _fire_task(memory_manager.semantic.delete_collection(epub_collection))


@app.post("/report/generate")
async def generate_report(req: ReportRequest):
    """
    Generate and return a self-contained interactive HTML report.
    The response is a downloadable HTML file.
    """
    run_id = req.run_id or str(uuid.uuid4())[:8]
    result = await reporter_agent.execute({
        "run_id": run_id,
        "action": "generate_report",
        "filename": req.filename,
        "validation_report": req.validation_report,
        "triage_results": req.triage_results,
        "fix_results": req.fix_results,
        "fix_trace": req.fix_trace,
        "hitl_suggestions": req.hitl_suggestions,
        "diffs": req.diffs,
        "report_mode": req.report_mode,
    })
    html_content = result.get(
        "html_report",
        "<html><body>Report generation failed</body></html>",
    )
    return Response(
        content=(
            html_content.encode("utf-8")
            if isinstance(html_content, str)
            else html_content
        ),
        media_type="text/html",
        headers={
            "Content-Disposition": f"attachment; filename=EPUB_Report_{run_id}.html"
        },
    )


# ------------------------------------------------------------------
# RAG evaluation endpoints
# ------------------------------------------------------------------

@app.post("/rag/evaluate")
async def rag_evaluate(req: EvaluateRequest):
    """
    RAGAS-style evaluation: faithfulness, context_recall, answer_relevancy.
    Returns scores and a boolean 'passed' flag.
    """
    evaluator = RAGEvaluator(memory_manager)
    result = await evaluator.evaluate(req.question, req.context, req.answer)
    return result


@app.post("/rag/evaluate-selffix")
async def rag_evaluate_selffix(req: EvaluateRequest):
    """
    Evaluate with self-fix loop: retries up to 3 times using fix strategies
    (faithfulness re-grounding, context expansion, answer rewrite).
    """
    evaluator = RAGEvaluator(memory_manager)
    result = await evaluator.evaluate_with_selffix(
        req.question, req.context, req.answer
    )
    return result


# ------------------------------------------------------------------
# Document processing endpoints
# ------------------------------------------------------------------

@app.post("/compare")
async def compare_texts(payload: CompareRequest):
    """Compute dense semantic similarity (BGE-M3) and fuzzy string similarity."""
    try:
        result = rag_engine.compute_similarity(payload.text1, payload.text2)
        return {"status": "success", "comparison": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/extract-pdf")
async def extract_pdf(file: UploadFile = File(...)):
    """Receive a PDF file and return physical bounding-box text blocks."""
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    temp_path = f"temp_{file.filename}"
    try:
        with open(temp_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        blocks = extractor.extract_pdf_blocks(temp_path)
        return {"status": "success", "filename": file.filename, "pages": blocks}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


@app.post("/extract-epub")
async def extract_epub(file: UploadFile = File(...)):
    """EPUB extraction is handled by the Node.js parser service."""
    return {
        "status": "not_implemented",
        "message": "EPUB chunking handled by Node.js parser.",
    }


# ------------------------------------------------------------------
# Memory / episodic endpoints
# ------------------------------------------------------------------

@app.get("/episodic/recent")
async def episodic_recent(agent_id: Optional[str] = None, limit: int = 50):
    """Return recent episodic memory entries, optionally filtered by agent_id."""
    return await memory_manager.episodic.get_recent(agent_id=agent_id, limit=limit)


@app.get("/episodic/stats/{agent_id}")
async def episodic_stats(agent_id: str):
    """Return episodic memory statistics for a specific agent."""
    return await memory_manager.episodic.get_agent_stats(agent_id)


if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    uvicorn.run("main:app", host="0.0.0.0", port=PYTHON_PORT, reload=False)



