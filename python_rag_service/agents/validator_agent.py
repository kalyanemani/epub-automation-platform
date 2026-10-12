"""ValidatorAgent: scores LLM output accuracy, computes confidence, validates fix patches."""
import json
import re
import xml.etree.ElementTree as ET

from agents.base_agent import BaseAgent
from ollama_client import ollama_generate


def _syntax_check(proposed_fix: str, issue_id: str) -> dict:
    """
    Fast structural pre-check before calling the LLM.
    Returns {"ok": bool, "score": 0.0-1.0, "note": str}.
    """
    fix = (proposed_fix or "").strip()
    if not fix or fix.upper() in ("CANNOT_FIX", "NONE"):
        return {"ok": False, "score": 0.0, "note": "empty or CANNOT_FIX"}

    rid = str(issue_id or "").upper()

    # CSS rules
    if any(k in rid for k in ("CSS", "FONT", "TABLE", "LIST", "LAYOUT", "RESPONSIVE", "HEADING", "IMAGE_RENDERING")):
        # Must contain at least one { ... } block or a property: value pair
        has_block   = bool(re.search(r'\{[^}]+\}', fix))
        has_prop    = bool(re.search(r'[\w-]+\s*:\s*[^;{]+', fix))
        # Reject if it still looks like an error message or prose
        is_prose    = len(fix) > 200 and not has_block
        if not (has_block or has_prop) or is_prose:
            return {"ok": False, "score": 0.3, "note": "CSS fix missing property:value or block syntax"}
        # Check balanced braces
        if fix.count("{") != fix.count("}"):
            return {"ok": False, "score": 0.4, "note": "CSS fix has unbalanced braces"}
        return {"ok": True, "score": 0.85, "note": "CSS syntax pre-check passed"}

    # XML/HTML attribute fixes (lang, alt, etc.)
    if any(k in rid for k in ("LANG", "ALT", "LINK_TEXT", "AUDIO", "CONTROL", "SRC")):
        # Should be a short attribute value or short HTML snippet, not a full document
        if len(fix) > 500:
            return {"ok": False, "score": 0.3, "note": "HTML attribute fix unexpectedly long"}
        return {"ok": True, "score": 0.85, "note": "attribute fix length check passed"}

    # OPF / metadata XML fragments
    if rid.startswith("M_") or "SCHEMA" in rid or "ACCESSIBILITY" in rid:
        if "<" in fix and ">" in fix:
            try:
                ET.fromstring(f"<root>{fix}</root>")
                return {"ok": True, "score": 0.90, "note": "XML metadata fragment is well-formed"}
            except ET.ParseError as exc:
                return {"ok": False, "score": 0.35, "note": f"XML parse error: {exc}"}
        # Plain-text value (e.g. ISO date) — check non-empty
        if fix:
            return {"ok": True, "score": 0.80, "note": "plain metadata value non-empty"}

    # Default: non-empty is a weak positive signal
    return {"ok": True, "score": 0.70, "note": "no domain-specific check; non-empty fix"}


class ValidatorAgent(BaseAgent):
    agent_id = "validator_agent"
    system_prompt = (
        "You are an EPUB fix validation specialist. Given an original issue and a proposed fix, evaluate:\n"
        "1. Does the fix actually address the issue? (0-1 score)\n"
        "2. Is the fix syntactically valid (CSS/HTML/XML)? (0-1 score)\n"
        "3. Does the fix introduce new problems? (0-1 score, 1=no new problems)\n"
        "4. Overall confidence in the fix (0-1).\n"
        'Return ONLY JSON: {"addresses_issue":0.0-1.0,"syntactically_valid":0.0-1.0,'
        '"no_regressions":0.0-1.0,"overall_confidence":0.0-1.0,"validation_notes":"..."}'
    )
    default_policies = {
        "min_overall_confidence": 0.70,
        "min_syntax_score":       0.80,
        "flag_below_threshold":   True,
    }

    async def validate_fix(self, issue: dict, proposed_fix: str) -> dict:
        issue_id = str(issue.get("id") or "")

        # ── Layer 1: fast structural pre-check (no LLM) ──────────────────────
        pre = _syntax_check(proposed_fix, issue_id)
        if not pre["ok"]:
            return {
                "addresses_issue":   0.0,
                "syntactically_valid": pre["score"],
                "no_regressions":    0.5,
                "overall_confidence": pre["score"] * 0.4,   # low but non-zero
                "validation_notes":  f"Pre-check failed: {pre['note']}",
                "passed":            False,
                "model_used":        "pre_check",
            }

        # ── Layer 2: LLM scoring ──────────────────────────────────────────────
        prompt = (
            f"{self.system_prompt}\n\n"
            f"ORIGINAL ISSUE:\nID: {issue_id}\nTitle: {issue.get('title')}\n"
            f"Details: {str(issue.get('details', ''))[:400]}\n\n"
            f"PROPOSED FIX:\n{proposed_fix[:800]}\n\nReturn ONLY valid JSON."
        )

        model_used = "unknown"
        resp       = {}
        try:
            resp       = await ollama_generate(prompt, task_type="reasoning")
            model_used = resp.get("model", "unknown")
            text       = resp.get("response", "").strip()
            start, end = text.find("{"), text.rfind("}") + 1
            scores     = json.loads(text[start:end])
        except Exception as exc:
            # LLM failed — fall back to pre-check score rather than 0.5
            fallback = round(pre["score"] * 0.6, 3)
            scores = {
                "addresses_issue":    fallback,
                "syntactically_valid": pre["score"],
                "no_regressions":     0.5,
                "overall_confidence": fallback,
                "validation_notes":   f"LLM validation error: {exc}; using pre-check score",
            }

        policies = self._policies or self.default_policies
        scores["passed"]     = scores.get("overall_confidence", 0) >= policies.get("min_overall_confidence", 0.70)
        scores["model_used"] = model_used
        return scores

    async def run(self, task: dict) -> dict:
        """Validate a batch of fix proposals."""
        proposals        = task.get("proposals", [])
        validated        = []
        total_confidence = 0.0

        for p in proposals:
            scores = await self.validate_fix(p.get("issue", {}), p.get("fix", ""))
            validated.append({**p, "validation": scores})
            total_confidence += scores.get("overall_confidence", 0)

        avg_confidence = total_confidence / len(proposals) if proposals else 0.0
        return {
            "status":              "ok",
            "validated_proposals": validated,
            "average_confidence":  round(avg_confidence, 3),
            "passed_count":        sum(1 for v in validated if v["validation"].get("passed")),
            "failed_count":        sum(1 for v in validated if not v["validation"].get("passed")),
        }
