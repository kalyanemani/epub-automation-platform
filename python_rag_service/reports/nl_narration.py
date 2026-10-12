"""NLNarration: converts structured validation data into readable English via LLM."""
import asyncio
from ollama_client import ollama_generate
from typing import List, Dict

LLM_TIMEOUT = 20  # seconds per individual LLM call


async def _generate_with_timeout(prompt: str, task_type: str, fallback: str) -> str:
    """Run ollama_generate with a hard per-call timeout; return fallback on timeout/error."""
    try:
        resp = await asyncio.wait_for(
            ollama_generate(prompt, task_type=task_type),
            timeout=LLM_TIMEOUT
        )
        return resp["response"].strip()
    except Exception:
        return fallback


class NLNarration:
    def __init__(self, system_prompt: str = ""):
        self.system_prompt = system_prompt or (
            "Convert technical EPUB validation data into clear, user-friendly English."
        )

    async def summarize_run(self, filename: str, total_issues: int,
                             triage: List[dict], fix_summary: dict) -> str:
        llm_count = sum(1 for t in triage if t.get("routing") == "llm")
        hitl_count = sum(1 for t in triage if t.get("routing") == "hitl")
        fixed_count = fix_summary.get("fixed_count", 0)

        prompt = f"""{self.system_prompt}

Write a 3-4 sentence executive summary for an EPUB quality report. Be professional and clear.
Facts:
- File: {filename}
- Total issues found: {total_issues}
- Issues auto-fixable by AI: {llm_count}
- Issues requiring human review: {hitl_count}
- Issues successfully fixed: {fixed_count}

Write the summary now:"""
        return await _generate_with_timeout(
            prompt, "reasoning",
            f"Analysis of {filename} found {total_issues} issues. "
            f"{llm_count} were automatically addressed. {hitl_count} require human review."
        )

    async def narrate_issue(self, issue: dict) -> str:
        prompt = f"""{self.system_prompt}

Explain this EPUB issue in 1-2 plain English sentences that a non-technical person can understand:
Issue ID: {issue.get("id")}
Title: {issue.get("title")}
Details: {str(issue.get("details", ""))[:300]}
Location: {str(issue.get("location", ""))}

Plain English explanation:"""
        return await _generate_with_timeout(
            prompt, "structured",
            f"{issue.get('title', 'An issue')} was found in the document "
            "that may affect readability or compliance."
        )

    async def generate_recommendations(self, triage_results: List[dict], fix_results: dict) -> str:
        hitl_issues = [t for t in triage_results if t.get("routing") == "hitl"]
        complex_issues = [t for t in triage_results if t.get("complexity") == "complex"]

        prompt = f"""{self.system_prompt}

Write 3-5 actionable recommendations for improving this EPUB document. Be specific.
Context:
- {len(hitl_issues)} issues need expert review
- {len(complex_issues)} structural/complex issues detected
- {fix_results.get('unfixable_count', 0)} issues could not be auto-fixed
- Common issue types: {list(set(t.get('complexity', '') for t in triage_results[:5]))}

Write numbered recommendations:"""
        return await _generate_with_timeout(
            prompt, "reasoning",
            "1. Review all HITL-flagged issues manually.\n"
            "2. Fix structural layout issues before distribution.\n"
            "3. Validate accessibility compliance with assistive technology."
        )

    async def narrate_all(self, filename: str, total_issues: int,
                          triage: List[dict], fix_summary: dict,
                          issues_to_narrate: List[dict]) -> dict:
        """Run all NL generation tasks in parallel — single await instead of N sequential awaits."""
        # Cap per-issue narration to 5 to bound latency
        capped = [i for i in issues_to_narrate if i.get("status") in ("fail", "warn")][:5]

        tasks = [
            self.summarize_run(filename, total_issues, triage, fix_summary),
            self.generate_recommendations(triage, fix_summary),
            *[self.narrate_issue(i) for i in capped],
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        summary = results[0] if not isinstance(results[0], Exception) else ""
        recommendations = results[1] if not isinstance(results[1], Exception) else ""
        narratives = {}
        for idx, issue in enumerate(capped):
            r = results[2 + idx]
            narratives[issue.get("id")] = r if not isinstance(r, Exception) else (
                f"{issue.get('title', 'An issue')} was found in the document."
            )
        return {"summary": summary, "recommendations": recommendations, "narratives": narratives}
