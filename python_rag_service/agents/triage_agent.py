"""TriageAgent: routes EPUB issues to deterministic autofix or LLM-assisted autofix.

Routing logic:
  AUTO  — structural/metadata rules with a proven Node.js deterministic fixer.
  LLM   — all other rules are handled by the LLM pipeline.
"""

from typing import Dict, List

from agents.base_agent import BaseAgent


# Structural and metadata rules handled by Node.js deterministic pipeline.
AUTO_FIX_RULES = {
    # Structure
    "S_MIMETYPE_MISSING",
    "S_MIMETYPE_CONTENT",
    "S_NO_NAVIGATION",
    "S_SPINE_NO_TOC",
    "S_SPINE_DUP_IDREFS",
    "S_SPINE_OUT_OF_ORDER",
    "S_MANIFEST_ITEMS_INVALID",
    "S_MANIFEST_DUP_IDS",
    "MULTIPLE_COVERS",
    "UNREFERENCED_MEDIA",
    # NCX / Nav
    "NCX_SPINE_MISMATCH",
    "NCX_PLAYORDER_INVALID",
    "NCX_PAGELIST_PLAYORDER",
    "NCX_DUPLICATE_IDS",
    "NCX_IDS_UNIQUE",
    "NCX_PAGELIST_VALUE_TEXT_MISMATCH",
    "NCX_NAV_PAGELIST_MISMATCH",
    "NCX_PHANTOM_ENTRIES",
    "NAV_SPINE_MISMATCH",
    "NAV_TOC_PHANTOM_ENTRIES",
    # Metadata (OPF fields — value is deterministic or synthesisable)
    "M_DUPLICATES",
    "M_LANGUAGE",
    "M_PUBLISHER",
    "M_IDENTIFIER",
    "M_RENDITION_LAYOUT",
    "M_RENDITION_ORIENTATION",
    "M_RENDITION_SPREAD",
    # Text normalisation (exact lookup, no AI needed)
    "T_SPECIAL_CHAR_ENTITY",
}


# CSS, HTML, accessibility, media, and text rules — LLM generates the fix value,
# EPUBPatcher writes it into the file.
LLM_FIX_RULES = {
    # Metadata — LLM generates correctly formatted values (e.g. ISO-8601 date)
    "M_DATE",
    "M_IDENTIFIER_FORMAT",
    # CSS / Layout — LLM writes corrected declarations or rules
    "L_CSS_SYNTAX",
    "L_CSS_REFERENCE_MISSING",
    "L_CSS_REFERENCE_BROKEN",
    "L_FONT_FALLBACK",
    "L_FONT_VARIANTS",
    "L_CSS_INVALID_DECLARATION",
    "L_CSS_CLASS_SELECTOR_MISSING",
    "L_HEADING_HIERARCHY",
    "L_TABLE_RESPONSIVE",
    "L_TABLE_STYLING",
    "L_TABLE_STRUCTURE",
    "L_LIST_STYLING",
    "L_IMAGE_RENDERING",
    "L_RESPONSIVE_HORIZONTAL_SCROLL",
    "L_RESPONSIVE_TEXT_CLIPPING",
    "L_LAYOUT_OVERLAP",
    # CSS / Layout — additional rules now handled by CSSFixerAgent
    "L_PARAGRAPH_SPACING",
    "L_BLOCKQUOTE_STYLING",
    "L_CODE_BLOCK_STYLING",
    "L_INLINE_STYLE_CONFLICT",
    "L_HEADING_CONSISTENCY",
    "L_FONT_CONSISTENCY",
    "L_FONT_EMBED_REFERENCE",
    "L_NO_CSS",
    # JavaScript — all JS rules now handled by JSFixerAgent
    "JS_SCRIPT_REFERENCE_BROKEN",
    "JS_EXTERNAL_SCRIPT_MISSING",
    "JS_SCRIPT_REFERENCE_MISSING_MANIFEST",
    "JS_INLINE_SCRIPT",
    "JS_EVENT_HANDLER_ATTRIBUTE",
    "JS_MODULE_SCRIPT",
    "JS_SCRIPT_SYNTAX",
    "JS_UNSUPPORTED_API",
    "JS_SCRIPT_MANIFEST_MISSING_FILE",
    # HTML accessibility attributes
    "A_HTML_LANG_MISSING",
    "A_LINK_TEXT_MISSING",
    # Schema / OPF accessibility metadata
    "A_SCHEMA_ACCESSMODE_MISSING",
    "A_SCHEMA_ACCESSIBILITYFEATURE_MISSING",
    "A_SCHEMA_ACCESSIBILITYHAZARD_MISSING",
    # Media attributes
    "Media_IMAGE_NO_SRC",
    "Media_audio_controls",
    "Media_missing_control",
    # Image alt-text generation
    "Media_IMAGE_NO_ALT",
    "A_IMAGE_ALT_MISSING",
    "IMG_ALT_MISSING",
    # Text content correction
    "T_HYPHENATION_WORD_MERGE",
    "T_MISSING_INCORRECT_TEXT",
}


def _status(issue: dict) -> str:
    return str(issue.get("status", "warn")).lower()


def _route_issue(issue: dict) -> Dict[str, object]:
    rule_id = str(issue.get("id", "") or "")
    status = _status(issue)

    if rule_id in AUTO_FIX_RULES:
        return {
            "routing": "auto",
            "fix_mode": "deterministic",
            "engine": "node_autofix",
            "confidence": 0.97,
            "complexity": "small",
            "reason": "structural/metadata rule with a deterministic Node.js fixer",
        }

    # Route everything else to LLM instead of HITL.
    task_type = "reasoning"
    confidence = 0.75
    complexity = "complex"
    reason = "fall back to LLM for rules not covered by deterministic autofix"

    if "ALT" in rule_id.upper() or "IMG" in rule_id.upper() or "IMAGE" in rule_id.upper():
        task_type = "vision"
        confidence = 0.78
        complexity = "complex"
        reason = "image content rule — LLM generates descriptive fix"
    elif rule_id.startswith(("L_", "JS_")):
        task_type = "codegen"
        confidence = 0.80
        complexity = "medium"
        reason = "CSS/HTML/JS rule — LLM generates corrected code"
    elif rule_id.startswith("A_") or rule_id.startswith("Media_"):
        task_type = "structured"
        confidence = 0.82
        complexity = "medium"
        reason = "accessibility/media attribute — LLM generates correct value"
    elif rule_id.startswith("M_"):
        task_type = "structured"
        confidence = 0.88
        complexity = "small"
        reason = "OPF metadata field — LLM generates correctly formatted value"

    return {
        "routing": "llm",
        "fix_mode": "llm_assisted",
        "engine": "python_llm",
        "task_type": task_type,
        "confidence": confidence,
        "complexity": complexity,
        "reason": reason,
    }


class TriageAgent(BaseAgent):
    agent_id = "triage_agent"
    system_prompt = (
        "Route structural and metadata issues to deterministic autofix. "
        "Route all other issues to LLM-assisted autofix."
    )
    default_policies = {
        "auto_rules": sorted(AUTO_FIX_RULES),
        "llm_rules": sorted(LLM_FIX_RULES),
        "manual_rules": [],
    }

    async def run(self, task: dict) -> dict:
        issues: List[dict] = task.get("issues", [])
        results = []

        for issue in issues:
            rule_id = str(issue.get("id", "") or "")
            route_meta = _route_issue(issue)
            routing = str(route_meta["routing"])

            results.append({
                "issue_id": rule_id,
                "title": issue.get("title"),
                "routing": routing,
                "confidence": round(float(route_meta["confidence"]), 3),
                "complexity": str(route_meta.get("complexity", "medium")),
                "reason": str(route_meta["reason"]),
                "fix_mode": str(route_meta["fix_mode"]),
                "engine": str(route_meta["engine"]),
                "task_type": str(route_meta.get("task_type", "reasoning")),
            })

        await self.memory.set_short(f"triage:{task.get('run_id', 'latest')}", results)

        return {
            "status": "ok",
            "triage_results": results,
            "total": len(results),
            "auto_count": sum(1 for r in results if r["routing"] == "auto"),
            "llm_count": sum(1 for r in results if r["routing"] == "llm"),
            "hitl_count": 0,
        }
