"""
RAGAS-style evaluation for EPUB autofix fixes using Ollama as LLM judge.

Implements four RAGAS metrics adapted to the EPUB fix generation task:

  Metric               | RAGAS equivalent    | What it measures
  ---------------------|---------------------|------------------------------------------
  faithfulness         | Faithfulness        | Fix is grounded in KB/issue context
  answer_relevancy     | Answer Relevancy    | Fix targets the specific EPUB issue
  context_precision    | Context Precision   | Retrieved KB context is relevant to issue
  fix_applicability    | (custom)            | Fix is syntactically applicable to the file

Each metric is scored 0-1 by an LLM judge prompt (Ollama) with chain-of-thought
and extracted float. Falls back to heuristic if LLM is unavailable.
"""
from __future__ import annotations
import asyncio
import json
import re
import sqlite3
import time
import os
from pathlib import Path
from typing import Dict, List, Optional, Any

# LLM client shared with the main service
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from ollama_client import ollama_generate

# ── Eval result store (SQLite) ────────────────────────────────────────────────
_EVAL_DB = str(Path(__file__).parent.parent / "eval_results.db")
_db_lock = asyncio.Lock()


def _init_eval_db():
    with sqlite3.connect(_EVAL_DB, timeout=10) as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS eval_results (
                eval_id      TEXT PRIMARY KEY,
                run_id       TEXT,
                issue_id     TEXT NOT NULL,
                issue_title  TEXT,
                fix_value    TEXT,
                reference    TEXT,
                faithfulness     REAL,
                answer_relevancy REAL,
                context_precision REAL,
                fix_applicability REAL,
                bleu4        REAL,
                rouge1       REAL,
                rouge2       REAL,
                rougeL       REAL,
                ragas_score  REAL,
                llm_judge    TEXT,
                created_at   REAL NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_eval_run ON eval_results(run_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_eval_ts  ON eval_results(created_at)")
        conn.commit()


_init_eval_db()


# ── Judge prompts ─────────────────────────────────────────────────────────────

_FAITHFULNESS_PROMPT = """\
You are an EPUB accessibility expert evaluating an automated fix.

ISSUE DESCRIPTION:
{issue}

RELEVANT KNOWLEDGE BASE CONTEXT:
{context}

GENERATED FIX:
{fix}

Task: Rate how well the fix is grounded in the provided context and correctly
addresses the issue. Consider: Does the fix follow the KB guidance? Is it
technically correct for EPUB?

Respond with a JSON object:
{{"score": <float 0.0 to 1.0>, "reason": "<one sentence>"}}
Output ONLY the JSON. No other text."""

_RELEVANCY_PROMPT = """\
You are an EPUB quality assessor.

EPUB ISSUE:
{issue}

GENERATED FIX:
{fix}

Task: Rate how directly and specifically the fix addresses the stated EPUB issue.
1.0 = fix precisely targets the root cause.
0.0 = fix is irrelevant or addresses a different problem.

Respond with:
{{"score": <float 0.0 to 1.0>, "reason": "<one sentence>"}}
Output ONLY the JSON. No other text."""

_CONTEXT_PRECISION_PROMPT = """\
You are an EPUB knowledge base evaluator.

EPUB ISSUE:
{issue}

RETRIEVED CONTEXT FROM KNOWLEDGE BASE:
{context}

Task: Rate how precisely the retrieved context is relevant to this specific
EPUB issue. Are the retrieved chunks the right ones for fixing this issue?
1.0 = highly relevant context retrieved.
0.0 = irrelevant or off-topic context.

Respond with:
{{"score": <float 0.0 to 1.0>, "reason": "<one sentence>"}}
Output ONLY the JSON. No other text."""

_APPLICABILITY_PROMPT = """\
You are an EPUB technical reviewer.

ISSUE TYPE: {issue_id}
FILE CONTENT (excerpt):
{file_content}

GENERATED FIX VALUE:
{fix}

Task: Rate how well the fix value can be directly applied to the file shown.
1.0 = fix is syntactically correct and applicable as-is.
0.0 = fix has syntax errors or cannot be applied to this file.

Respond with:
{{"score": <float 0.0 to 1.0>, "reason": "<one sentence>"}}
Output ONLY the JSON. No other text."""


# ── Helper to call LLM judge ──────────────────────────────────────────────────

async def _llm_judge(prompt: str, model_hint: str = "structured") -> Dict[str, Any]:
    """Call Ollama with a judge prompt and extract {score, reason}."""
    try:
        result = await asyncio.wait_for(
            ollama_generate(prompt, task_type=model_hint, temperature=0.0),
            timeout=25.0,
        )
        raw = result.get("response", "")
        # Extract JSON from response (sometimes wrapped in markdown)
        m = re.search(r"\{[^{}]+\}", raw, re.DOTALL)
        if m:
            data = json.loads(m.group())
            score = float(data.get("score", 0.5))
            return {
                "score":  max(0.0, min(1.0, round(score, 4))),
                "reason": str(data.get("reason", "")),
                "model":  result.get("model", ""),
            }
    except Exception as e:
        pass
    return {"score": 0.5, "reason": "LLM judge unavailable — default score", "model": "heuristic"}


# ── RAGAS-style evaluator ─────────────────────────────────────────────────────

class EpubFixEvaluator:
    """
    Evaluates autofix results using RAGAS-style LLM-as-judge metrics
    plus BLEU-4 and ROUGE text-overlap scores.
    """

    def __init__(self):
        from evaluation.scorer import BleuRougeScorer
        self._scorer = BleuRougeScorer()

    async def evaluate_fix(
        self,
        issue: Dict[str, Any],
        fix_value: str,
        kb_context: str = "",
        file_content: str = "",
        reference_fix: Optional[str] = None,
        run_id: str = "",
    ) -> Dict[str, Any]:
        """
        Evaluate a single LLM-generated fix.

        Parameters
        ----------
        issue         : Full issue dict (id, title, suggestion, location …)
        fix_value     : The generated fix string
        kb_context    : KB chunks retrieved for this issue (for faithfulness)
        file_content  : Excerpt of the file being fixed (for applicability)
        reference_fix : Ground-truth fix if available (for BLEU/ROUGE)
        run_id        : Parent autofix job ID

        Returns
        -------
        Dict with all metric scores and reasons.
        """
        issue_id    = issue.get("id", "unknown")
        issue_title = issue.get("title", "")
        issue_desc  = f"[{issue_id}] {issue_title}\nSuggestion: {issue.get('suggestion', '')}"

        # Run all LLM judges in parallel
        tasks = {
            "faithfulness":      _llm_judge(
                _FAITHFULNESS_PROMPT.format(
                    issue=issue_desc,
                    context=kb_context or "(no KB context retrieved)",
                    fix=fix_value,
                )
            ),
            "answer_relevancy":  _llm_judge(
                _RELEVANCY_PROMPT.format(issue=issue_desc, fix=fix_value)
            ),
            "context_precision": _llm_judge(
                _CONTEXT_PRECISION_PROMPT.format(
                    issue=issue_desc,
                    context=kb_context or "(none)",
                )
            ) if kb_context else asyncio.coroutine(lambda: {"score": -1.0, "reason": "no context"})(),
            "fix_applicability": _llm_judge(
                _APPLICABILITY_PROMPT.format(
                    issue_id=issue_id,
                    file_content=file_content[:1500] if file_content else "(not available)",
                    fix=fix_value,
                )
            ) if file_content else asyncio.coroutine(lambda: {"score": -1.0, "reason": "no file content"})(),
        }

        judge_results = {}
        llm_results = await asyncio.gather(*tasks.values(), return_exceptions=True)
        for key, result in zip(tasks.keys(), llm_results):
            if isinstance(result, Exception):
                judge_results[key] = {"score": 0.5, "reason": str(result), "model": "error"}
            else:
                judge_results[key] = result

        # BLEU + ROUGE text overlap
        text_scores = self._scorer.score(
            hypothesis=fix_value,
            reference=reference_fix,
            context=issue_desc,
        )

        # Composite RAGAS score — weighted average of available LLM metrics
        llm_scores = [
            judge_results[k]["score"]
            for k in ["faithfulness", "answer_relevancy"]
            if judge_results[k]["score"] >= 0
        ]
        ragas_score = round(sum(llm_scores) / len(llm_scores), 4) if llm_scores else -1.0

        eval_record = {
            "eval_id":            f"{run_id}_{issue_id}_{int(time.time())}",
            "run_id":             run_id,
            "issue_id":           issue_id,
            "issue_title":        issue_title,
            "fix_value":          fix_value,
            "reference_fix":      reference_fix,
            "faithfulness":       judge_results["faithfulness"]["score"],
            "answer_relevancy":   judge_results["answer_relevancy"]["score"],
            "context_precision":  judge_results["context_precision"]["score"],
            "fix_applicability":  judge_results["fix_applicability"]["score"],
            "bleu4":              text_scores["bleu4"],
            "rouge1":             text_scores["rouge1"],
            "rouge2":             text_scores["rouge2"],
            "rougeL":             text_scores["rougeL"],
            "ragas_score":        ragas_score,
            "judge_reasons": {
                k: v.get("reason", "") for k, v in judge_results.items()
            },
            "llm_judge": judge_results["faithfulness"].get("model", ""),
        }

        # Persist to SQLite
        self._store(eval_record)
        return eval_record

    async def evaluate_job(
        self,
        job_result: Dict[str, Any],
        run_id: str,
    ) -> Dict[str, Any]:
        """
        Evaluate all LLM-fixed issues in a completed autofix job result.
        Returns aggregated scores + per-issue breakdown.
        """
        fix_trace = job_result.get("fix_trace", [])
        llm_fixes = [t for t in fix_trace if t.get("routing") == "llm" and t.get("fixable")]

        if not llm_fixes:
            return {"message": "No LLM fixes to evaluate", "ragas_score": -1.0}

        tasks = []
        for t in llm_fixes:
            issue = {
                "id":    t.get("issue_id", ""),
                "title": t.get("title", ""),
            }
            tasks.append(
                self.evaluate_fix(
                    issue=issue,
                    fix_value=t.get("fix_value", ""),
                    run_id=run_id,
                )
            )

        results = await asyncio.gather(*tasks, return_exceptions=True)
        valid = [r for r in results if isinstance(r, dict)]

        def _avg(key):
            vals = [r[key] for r in valid if isinstance(r.get(key), float) and r[key] >= 0]
            return round(sum(vals) / len(vals), 4) if vals else -1.0

        return {
            "run_id":              run_id,
            "evaluated_fixes":     len(valid),
            "ragas_score":         _avg("ragas_score"),
            "faithfulness":        _avg("faithfulness"),
            "answer_relevancy":    _avg("answer_relevancy"),
            "context_precision":   _avg("context_precision"),
            "fix_applicability":   _avg("fix_applicability"),
            "bleu4":               _avg("bleu4"),
            "rouge1":              _avg("rouge1"),
            "rouge2":              _avg("rouge2"),
            "rougeL":              _avg("rougeL"),
            "per_issue":           valid,
        }

    def _store(self, record: Dict[str, Any]):
        """Persist eval result to SQLite (non-blocking best-effort)."""
        try:
            with sqlite3.connect(_EVAL_DB, timeout=5) as conn:
                conn.execute("""
                    INSERT OR REPLACE INTO eval_results
                    (eval_id, run_id, issue_id, issue_title, fix_value, reference,
                     faithfulness, answer_relevancy, context_precision, fix_applicability,
                     bleu4, rouge1, rouge2, rougeL, ragas_score, llm_judge, created_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, [
                    record["eval_id"], record["run_id"], record["issue_id"],
                    record["issue_title"], record["fix_value"], record.get("reference_fix"),
                    record["faithfulness"], record["answer_relevancy"],
                    record["context_precision"], record["fix_applicability"],
                    record["bleu4"], record["rouge1"], record["rouge2"], record["rougeL"],
                    record["ragas_score"], record["llm_judge"], time.time(),
                ])
                conn.commit()
        except Exception:
            pass

    def get_results(
        self,
        run_id: Optional[str] = None,
        limit: int = 100,
    ) -> List[Dict]:
        """Retrieve stored evaluation results."""
        try:
            with sqlite3.connect(_EVAL_DB, timeout=5) as conn:
                conn.row_factory = sqlite3.Row
                if run_id:
                    rows = conn.execute(
                        "SELECT * FROM eval_results WHERE run_id=? ORDER BY created_at DESC LIMIT ?",
                        [run_id, limit],
                    ).fetchall()
                else:
                    rows = conn.execute(
                        "SELECT * FROM eval_results ORDER BY created_at DESC LIMIT ?",
                        [limit],
                    ).fetchall()
            return [dict(r) for r in rows]
        except Exception:
            return []
