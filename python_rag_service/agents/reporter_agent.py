"""ReporterAgent: generates natural-language summaries via LLM and assembles interactive HTML report."""
from agents.base_agent import BaseAgent
from ollama_client import ollama_generate
from reports.html_generator import HTMLReportGenerator
from reports.nl_narration import NLNarration
from typing import List, Dict
import json

class ReporterAgent(BaseAgent):
    agent_id = "reporter_agent"
    system_prompt = """You are an EPUB quality report writer. Convert technical validation data into clear, user-friendly English.
Write in a professional but accessible tone. Avoid jargon. Focus on impact and actionability.
Structure: 1 sentence executive summary, bullet points for key findings, 2-3 recommendation sentences."""
    default_policies = {
        "report_model": "reasoning",
        "max_issues_in_summary": 10,
        "include_kb_citations": True
    }

    async def run(self, task: dict) -> dict:
        validation_report = task.get("validation_report", {})
        triage_results = task.get("triage_results", [])
        fix_results = task.get("fix_results", {})
        fix_trace = task.get("fix_trace", [])
        hitl_suggestions = task.get("hitl_suggestions", {})
        diffs = task.get("diffs", [])
        run_id = task.get("run_id", "unknown")
        filename = task.get("filename", "document")
        report_mode = task.get("report_mode", "full")

        # Get recent episodic context
        recent_episodes = await self.memory.episodic.get_recent(limit=20)

        # Generate NL summaries — all in parallel with per-call timeout
        narration = NLNarration(system_prompt=self.system_prompt)
        all_results = validation_report.get("results", [])

        nl = await narration.narrate_all(
            filename=filename,
            total_issues=len(all_results),
            triage=triage_results,
            fix_summary=fix_results,
            issues_to_narrate=all_results[:10],
        )
        executive_summary = nl["summary"]
        issue_narratives = nl["narratives"]
        recommendations = nl["recommendations"]

        # Build HTML report
        generator = HTMLReportGenerator()
        html_bytes = generator.generate(
            run_id=run_id,
            filename=filename,
            validation_report=validation_report,
            triage_results=triage_results,
            fix_results=fix_results,
            executive_summary=executive_summary,
            issue_narratives=issue_narratives,
            recommendations=recommendations,
            fix_trace=fix_trace,
            hitl_suggestions=hitl_suggestions,
            diffs=diffs,
            report_mode=report_mode,
        )

        # Save to short-term memory
        await self.memory.set_short(f"report:{run_id}", {"html_size": len(html_bytes)}, ttl=86400)

        return {
            "status": "ok",
            "html_report": html_bytes.decode("utf-8") if isinstance(html_bytes, bytes) else html_bytes,
            "executive_summary": executive_summary,
            "recommendations": recommendations
        }
