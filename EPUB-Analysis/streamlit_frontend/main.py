import streamlit as st
import pandas as pd
import requests
import os
import json
import base64
from api_client import APIClient, NODE_BASE_URL, PYTHON_BASE_URL

# ---------------------------------------------------------------------------
# Page configuration - must be the very first Streamlit call
# ---------------------------------------------------------------------------
st.set_page_config(
    page_title="EPUB Automation Platform - AI-Powered QA & Auto-Fix",
    page_icon=":books:",
    layout="wide",
)

# ---------------------------------------------------------------------------
# CSS - comprehensive text visibility + dark-teal branding
# ---------------------------------------------------------------------------
st.markdown("""
<style>
/* -- Layout --------------------------------------------------------------- */
.stApp { background-color: #F0F4F7; }
.main .block-container {
    background-color: #FFFFFF;
    border-radius: 12px;
    padding: 1.5rem 2rem 2rem;
    margin-top: 0.5rem;
    box-shadow: 0 2px 12px rgba(10,42,53,0.08);
}

/* -- App header banner ----------------------------------------------------- */
.app-header {
    background: linear-gradient(135deg, #0A2A35 0%, #0D3D4F 60%, #1A8A9A 100%);
    border-radius: 12px;
    padding: 20px 28px;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    box-shadow: 0 4px 16px rgba(10,42,53,0.25);
}
.app-header-title {
    font-size: 1.7rem;
    font-weight: 800;
    color: #FFFFFF !important;
    letter-spacing: -0.3px;
    margin: 0;
    line-height: 1.2;
}
.app-header-sub {
    font-size: 0.85rem;
    color: #A8DDE5 !important;
    margin: 4px 0 0;
    font-weight: 400;
}
.app-header-badge {
    background: rgba(38,197,217,0.2);
    border: 1px solid #26C5D9;
    color: #26C5D9 !important;
    padding: 4px 14px;
    border-radius: 20px;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.5px;
    white-space: nowrap;
}

/* -- Tabs ----------------------------------------------------------------- */
.stTabs [data-baseweb="tab-list"] {
    background-color: #0A2A35;
    border-radius: 8px;
    padding: 4px 8px;
    gap: 12px;
}
.stTabs [data-baseweb="tab"] {
    padding-left: 14px !important;
    padding-right: 14px !important;
}
.stTabs [data-baseweb="tab"],
.stTabs [data-baseweb="tab"] p,
.stTabs [data-baseweb="tab"] span,
.stTabs [data-baseweb="tab"] div,
.stTabs [data-baseweb="tab"] * { color: #FFFFFF !important; font-weight: 500; }
.stTabs [aria-selected="true"],
.stTabs [aria-selected="true"] p,
.stTabs [aria-selected="true"] span,
.stTabs [aria-selected="true"] div,
.stTabs [aria-selected="true"] * {
    background-color: #26C5D9 !important;
    border-radius: 6px;
    color: #FFFFFF !important;
    font-weight: 700 !important;
}
.stTabs [data-baseweb="tab"]:hover,
.stTabs [data-baseweb="tab"]:hover * { color: #26C5D9 !important; }

/* -- Headings ------------------------------------------------------------- */
h1 { color: #0A2A35 !important; font-weight: 800 !important; margin-top: 0.4rem !important; margin-bottom: 0.3rem !important; }
h2 { color: #0D3D4F !important; font-weight: 700 !important; margin-top: 0.3rem !important; margin-bottom: 0.2rem !important; }
h3 { color: #1A8A9A !important; font-weight: 600 !important; margin-top: 0.25rem !important; margin-bottom: 0.15rem !important; }
h4, h5, h6 { color: #0A2A35 !important; font-weight: 600 !important; margin-top: 0.2rem !important; margin-bottom: 0.1rem !important; }
[data-testid="stHeading"] { padding-top: 0.2rem !important; padding-bottom: 0.1rem !important; }
div[data-testid="stVerticalBlock"] > div[data-testid="stVerticalBlockBorderWrapper"] { gap: 0.4rem !important; }

/* -- Body text - all visible on white ----------------------------------- */
p, li, span, div { color: #1A2835; }
.stMarkdown p, .stMarkdown li, .stMarkdown span { color: #1A2835 !important; }
.stText { color: #1A2835 !important; }

/* -- Widget labels -------------------------------------------------------- */
label { color: #0A2A35 !important; font-weight: 600 !important; }
[data-testid="stWidgetLabel"] p,
[data-testid="stWidgetLabel"] span,
.stWidgetLabel { color: #0A2A35 !important; font-weight: 600 !important; }

/* -- Metrics -------------------------------------------------------------- */
[data-testid="stMetricLabel"] p  { color: #0A2A35 !important; font-weight: 600 !important; font-size: 0.82rem !important; }
[data-testid="stMetricValue"]    { color: #1A8A9A !important; font-weight: 800 !important; }
[data-testid="stMetricDelta"]    { font-weight: 600 !important; }
[data-testid="metric-container"] { background: #F4F6F8; border-radius: 10px; padding: 12px; border: 1px solid #D0E8EC; }

/* -- Custom metric cards -------------------------------------------------- */
.metric-card {
    background-color: #F4F6F8;
    border: 1.5px solid #26C5D9;
    border-radius: 10px;
    padding: 16px;
    text-align: center;
    margin-bottom: 8px;
    box-shadow: 0 2px 8px rgba(26,197,217,0.10);
}
.metric-card .metric-value { font-size: 2rem; font-weight: 700; color: #1A8A9A; }
.metric-card .metric-label { font-size: 0.85rem; color: #0A2A35; margin-top: 4px; font-weight: 600; }

/* -- Buttons -------------------------------------------------------------- */
.stButton > button {
    background-color: #0D3D4F;
    color: #FFFFFF !important;
    border: 2px solid #26C5D9;
    border-radius: 8px;
    font-weight: 600;
    padding: 0.5rem 1.2rem;
}
.stButton > button:hover {
    background-color: #26C5D9 !important;
    color: #FFFFFF !important;
    border-color: #26C5D9 !important;
}
.stButton > button p { color: #FFFFFF !important; }

/* -- Alerts / info boxes -------------------------------------------------- */
.stAlert { border-radius: 8px; }
[data-testid="stAlert"] p,
[data-testid="stAlert"] div,
.stAlert p { color: #1A2835 !important; }

/* -- Captions ------------------------------------------------------------- */
[data-testid="stCaptionContainer"] p,
.stCaption, caption { color: #4A6070 !important; font-style: italic; }

/* -- Expanders ------------------------------------------------------------ */
details {
    background-color: #F4F6F8 !important;
    border: 1px solid #C8DDE5 !important;
    border-radius: 8px !important;
    padding: 4px !important;
}
details summary,
.streamlit-expanderHeader,
[data-testid="stExpander"] summary { color: #0A2A35 !important; font-weight: 600 !important; }
details > div p,
details > div li,
details > div span { color: #1A2835 !important; }

/* -- File uploader -------------------------------------------------------- */
[data-testid="stFileUploader"] label,
[data-testid="stFileUploader"] p,
[data-testid="stFileUploader"] span,
[data-testid="stFileUploaderDropzone"] p { color: #0A2A35 !important; }
[data-testid="stFileUploaderDropzone"] {
    border: 2px dashed #26C5D9 !important;
    border-radius: 8px !important;
    background: #F4FBFC !important;
}

/* -- Select / dropdown ---------------------------------------------------- */
[data-baseweb="select"] > div { background-color: #0A2A35 !important; border: 1px solid #26C5D9 !important; border-radius: 6px !important; }
[data-baseweb="select"] span,
[data-baseweb="select"] div { color: #FFFFFF !important; }
[data-baseweb="select"] svg { fill: #FFFFFF !important; }
[data-baseweb="menu"] { background-color: #0A2A35 !important; border: 1px solid #26C5D9 !important; border-radius: 6px !important; }
[data-baseweb="menu"] li,
[data-baseweb="option"] { color: #FFFFFF !important; background-color: #0A2A35 !important; }
[data-baseweb="option"]:hover,
[data-baseweb="option"][aria-selected="true"] { background-color: #1A8A9A !important; color: #FFFFFF !important; }

/* -- Dataframe / tables --------------------------------------------------- */
.stDataFrame { background-color: #F4F6F8; border-radius: 8px; }
.stDataFrame td, .stDataFrame th,
[data-testid="stDataFrame"] td,
[data-testid="stDataFrame"] th { color: #0A2A35 !important; }
[data-testid="stDataFrame"] thead th { background-color: #0A2A35 !important; color: #FFFFFF !important; }

/* -- Spinner -------------------------------------------------------------- */
[data-testid="stSpinner"] p { color: #0A2A35 !important; font-weight: 600 !important; }

/* -- Progress bar --------------------------------------------------------- */
[data-testid="stProgressBar"] { border-radius: 8px; }
[data-testid="stProgressBar"] > div { background-color: #26C5D9 !important; }

/* -- Sidebar -------------------------------------------------------------- */
div[data-testid="stSidebarContent"] { background-color: #0A2A35; }
div[data-testid="stSidebarContent"] * { color: #FFFFFF !important; }

/* -- Badges --------------------------------------------------------------- */
.badge-auto { background:#0D6E6E;color:#FFFFFF !important;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:700; }
.badge-llm  { background:#1A8A9A;color:#FFFFFF !important;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:700; }
.badge-agentic { background:#1A8A9A;color:#FFFFFF !important;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:700; }
.badge-hitl { background:#E8954A;color:#FFFFFF !important;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:700; }
.badge-small   { background:#E6F9F0;color:#0A7A45 !important;padding:2px 8px;border-radius:10px;font-size:11px;border:1px solid #0A7A45; }
.badge-medium  { background:#FFF8E6;color:#7A4800 !important;padding:2px 8px;border-radius:10px;font-size:11px;border:1px solid #C8880A; }
.badge-complex { background:#FEECEC;color:#8A0000 !important;padding:2px 8px;border-radius:10px;font-size:11px;border:1px solid #DC3545; }

/* -- Pipeline log steps --------------------------------------------------- */
.pipeline-step { background:#F4F6F8;border-left:4px solid #26C5D9;padding:8px 12px;margin:4px 0;border-radius:0 6px 6px 0; }
.pipeline-step b { color:#0A2A35 !important; }
.pipeline-step.done  { border-color:#28a745; }
.pipeline-step.error { border-color:#dc3545; }

/* -- Dividers ------------------------------------------------------------- */
hr { border-color: #C8DDE5 !important; }
</style>
""", unsafe_allow_html=True)

# ---------------------------------------------------------------------------
# Logo loader - reads assets/logo.png as base64 if present
# ---------------------------------------------------------------------------
def _load_logo_b64() -> str:
    logo_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "logo.png")
    if os.path.exists(logo_path):
        with open(logo_path, "rb") as f:
            return base64.b64encode(f.read()).decode()
    return ""

_LOGO_B64 = _load_logo_b64()

_logo_img = (
    f'<img src="data:image/png;base64,{_LOGO_B64}" '
    f'style="height:52px;object-fit:contain;" alt="Creative Synergies Group" />'
    if _LOGO_B64 else
    '<span style="color:#A8DDE5;font-size:0.9rem;font-weight:600;letter-spacing:1px;">CREATIVE SYNERGIES GROUP</span>'
)

st.markdown(f"""
<div class="app-header">
  <div>
    <div class="app-header-title">EPUB Automation Platform</div>
    <div class="app-header-sub">AI-Powered Quality Assurance &amp; Auto-Fix Pipeline &nbsp;|&nbsp; EPUB 3.3 &amp; WCAG 2.1</div>
  </div>
  <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;">
    {_logo_img}
    <span class="app-header-badge">v2.0 &nbsp; BETA</span>
  </div>
</div>
""", unsafe_allow_html=True)

# ---------------------------------------------------------------------------
# Session state defaults
# ---------------------------------------------------------------------------
SESSION_CACHE_FILE = os.path.join(os.path.dirname(__file__), ".session_cache.json")

def save_persistent_state():
    """Saves active metrics and reports to local disk so page reloads don't reset to 0."""
    try:
        data = {
            "uploaded_file_path": st.session_state.get("uploaded_file_path", ""),
            "uploaded_file_name": st.session_state.get("uploaded_file_name", ""),
            "uploaded_file_size": st.session_state.get("uploaded_file_size", 0),
            "last_report": st.session_state.get("last_report"),
            "triage_results": st.session_state.get("triage_results", {}),
            "agent_proposals": st.session_state.get("agent_proposals", {}),
            "hitl_suggestions": st.session_state.get("hitl_suggestions", {}),
            "hitl_run_id": st.session_state.get("hitl_run_id", ""),
            "pipeline_log": st.session_state.get("pipeline_log", []),
        }
        with open(SESSION_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

def load_persistent_state():
    """Loads previous session metrics from local disk if present."""
    if os.path.exists(SESSION_CACHE_FILE):
        try:
            with open(SESSION_CACHE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            for k, v in data.items():
                if v and (st.session_state.get(k) is None or st.session_state.get(k) in ("", {}, [])):
                    st.session_state[k] = v
        except Exception:
            pass

_defaults = {
    "last_report": None,          # None = never run; {} = ran but error
    "last_fix_res": {},
    "last_fix_meta": {},
    "last_fix_trace": [],         # fix_trace from last agent autofix run
    "last_fix_diffs": [],         # diffs from last agent autofix run
    "last_fixed_epub_bytes": None,
    "_fix_report_bytes": None,
    "_diff_cache_key": "",
    "_all_diffs": [],
    "_diff_decisions": {},
    "diff_manual_review_files": [],
    "agent_proposals": {},        # fix proposals from Python orchestrator
    "uploaded_file_path": "",
    "uploaded_file_name": "",
    "uploaded_file_size": 0,
    "hitl_queue": [],
    "hitl_suggestions": {},       # {issue_id: {patch, fixable, model_used, ...}} from agent autofix
    "hitl_run_id": "",            # job_id of the run that produced hitl_suggestions
    "validation_running": False,
    "triage_results": {},
    "pipeline_log": [],           # [{step, status, detail}]
}
for k, v in _defaults.items():
    if k not in st.session_state:
        st.session_state[k] = v

load_persistent_state()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
# Must stay in sync with python_rag_service/agents/triage_agent.py
AUTO_ROUTE_RULES = {
    # Structural
    "S_MIMETYPE_MISSING", "S_MIMETYPE_CONTENT", "S_SPINE_DUP_IDREFS",
    "S_SPINE_OUT_OF_ORDER", "S_MANIFEST_ITEMS_INVALID", "S_MANIFEST_DUP_IDS",
    "MULTIPLE_COVERS", "UNREFERENCED_MEDIA",
    # NCX / Nav
    "NCX_SPINE_MISMATCH", "NCX_PLAYORDER_INVALID", "NCX_PAGELIST_PLAYORDER",
    "NCX_DUPLICATE_IDS", "NCX_IDS_UNIQUE", "NCX_PAGELIST_VALUE_TEXT_MISMATCH",
    "NCX_NAV_PAGELIST_MISMATCH", "NCX_PHANTOM_ENTRIES",
    "NAV_SPINE_MISMATCH", "NAV_TOC_PHANTOM_ENTRIES",
    # Metadata
    "M_DUPLICATES", "M_LANGUAGE", "M_PUBLISHER", "M_DATE", "M_IDENTIFIER",
    "M_RENDITION_LAYOUT", "M_RENDITION_ORIENTATION", "M_RENDITION_SPREAD",
    # Text normalisation
    "T_SPECIAL_CHAR_ENTITY",
}

LLM_ROUTE_RULES = {
    # CSS / Layout
    "L_CSS_SYNTAX", "L_CSS_REFERENCE_MISSING", "L_CSS_REFERENCE_BROKEN",
    "L_FONT_FALLBACK", "L_CSS_INVALID_DECLARATION", "L_HEADING_HIERARCHY",
    "L_TABLE_RESPONSIVE", "L_IMAGE_RENDERING", "L_RESPONSIVE_HORIZONTAL_SCROLL",
    "L_RESPONSIVE_TEXT_CLIPPING", "L_LAYOUT_OVERLAP",
    # JS
    "JS_SCRIPT_REFERENCE_BROKEN",
    # HTML accessibility
    "A_HTML_LANG_MISSING", "A_LINK_TEXT_MISSING",
    "A_SCHEMA_ACCESSMODE_MISSING", "A_SCHEMA_ACCESSIBILITYFEATURE_MISSING",
    "A_SCHEMA_ACCESSIBILITYHAZARD_MISSING",
    # Media
    "Media_IMAGE_NO_SRC", "Media_audio_controls", "Media_missing_control",
    "Media_IMAGE_NO_ALT", "A_IMAGE_ALT_MISSING", "IMG_ALT_MISSING",
    # Text
    "T_HYPHENATION_WORD_MERGE", "T_MISSING_INCORRECT_TEXT",
}

HITL_ROUTE_RULES = {
    "A_MANUAL",
    "A11Y_MANUAL_REVIEW",
    "SMIL_",
    "S_BROKEN_INTERNAL_LINKS",
    "M_IDENTIFIER_FORMAT",
    "M_EPUB2_GUIDE",
    "L_CSS_CLASS_SELECTOR_MISSING",
    "L_FONT_VARIANTS",
    "L_TABLE_STYLING",
    "L_LIST_STYLING",
    "L_TABLE_STRUCTURE",
}


def get_complexity(issue, triage_item=None) -> str:
    if isinstance(triage_item, dict) and triage_item.get("complexity"):
        return str(triage_item.get("complexity", "medium")).lower()
    severity = issue.get("status", "warn")
    rule_id = issue.get("id", "")
    if severity == "fail" and ("S_" in rule_id or "layout" in rule_id.lower()):
        return "complex"
    if severity == "fail" or rule_id.startswith("T_"):
        return "medium"
    return "small"


def get_issue_domain(issue) -> str:
    rule_id = issue.get("id", "")
    if rule_id.startswith("S_"):
        return "Structural"
    if rule_id.startswith(("T_", "M_", "A_")):
        return "Content/Technical"
    return "Remediation"


def route_issue(issue) -> str:
    rule_id = str(issue.get("id", "") or "")
    if rule_id in AUTO_ROUTE_RULES:
        return "auto"
    if rule_id in LLM_ROUTE_RULES:
        return "llm"
    if rule_id in HITL_ROUTE_RULES:
        return "hitl"
    return "hitl"


def get_routing(issue, triage=None) -> str:
    triage_item = (triage or {}).get(issue.get("id", ""), {})
    if isinstance(triage_item, dict) and triage_item.get("routing"):
        return str(triage_item.get("routing", "hitl")).lower()
    return route_issue(issue)


def _metric_card(label: str, value) -> str:
    return (
        f'<div class="metric-card">'
        f'<div class="metric-value">{value}</div>'
        f'<div class="metric-label">{label}</div>'
        f"</div>"
    )


def _routing_badge(routing: str) -> str:
    if routing == "auto":
        return '<span class="badge-auto">AUTO</span>'
    if routing == "llm":
        return '<span class="badge-agentic">Agentic Fix</span>'
    return '<span class="badge-hitl">Manual Review</span>'


def _build_issues_df(results: list, triage: dict) -> pd.DataFrame:
    rows = []
    for r in results:
        issue_id = r.get("id", "")
        triage_item = triage.get(issue_id, {}) if isinstance(triage, dict) else {}
        loc = r.get("location", {})
        loc_str = (
            f"{loc.get('file','')}:{loc.get('line','')}"
            if isinstance(loc, dict) else str(loc)
        )
        routing_decision = get_routing(r, triage)
        confidence_val = triage_item.get("confidence", r.get("confidence", 0.0))
        complexity_val = get_complexity(r, triage_item).capitalize()
        fix_mode = str(triage_item.get("fix_mode", "") or "").replace("_", " ").title()
        rows.append({
            "Rule ID":    issue_id,
            "Title":      r.get("title", r.get("message", "")),
            "Domain":     get_issue_domain(r),
            "Complexity": complexity_val,
            "Routing":    "Manual Review" if routing_decision == "hitl" else ("Agentic Fix" if routing_decision == "llm" else routing_decision.upper()),
            "Fix Mode":   fix_mode,
            "Confidence": round(float(confidence_val or 0), 2),
            "Status":     r.get("status", "").upper(),
            "Location":   loc_str,
        })
    return pd.DataFrame(rows) if rows else pd.DataFrame()


def _log_step(step: str, status: str, detail: str = ""):
    st.session_state.pipeline_log.append(
        {"step": step, "status": status, "detail": detail}
    )


def _triage_list_for_report(triage: dict) -> list:
    if not isinstance(triage, dict):
        return []
    return [
        {**meta, "issue_id": issue_id, "id": issue_id}
        for issue_id, meta in triage.items()
        if isinstance(meta, dict)
    ]


def _extract_post_results(fix_payload: dict) -> list:
    verification = fix_payload.get("verification") or {}
    if not isinstance(verification, dict):
        return []
    return (
        verification.get("results")
        or verification.get("report", {}).get("results", [])
        or []
    )


def _build_fix_results_for_report(actionable: list, triage: dict, fix_payload: dict) -> dict:
    post_results = _extract_post_results(fix_payload)
    post_map = {result.get("id", ""): result for result in post_results if result.get("id")}

    fixes = []
    for issue in actionable:
        issue_id = issue.get("id", "")
        routing = get_routing(issue, triage)
        if routing == "hitl":
            status = "hitl"
            patch = "Manual Review"
        else:
            after_status = str(post_map.get(issue_id, {}).get("status", issue.get("status", ""))).lower()
            status = "fixed" if after_status not in ("fail", "warn") else "unfixed"
            patch = "Applied" if status == "fixed" else "CANNOT_FIX"

        fixes.append(
            {
                "issue_id": issue_id,
                "patch": patch,
                "fixable": status == "fixed",
                "status": status,
            }
        )

    fixed_count = sum(1 for item in fixes if item.get("status") == "fixed")
    unfixed_count = sum(1 for item in fixes if item.get("status") == "unfixed")

    return {
        **fix_payload,
        "fixed_count": fixed_count,
        "unfixable_count": unfixed_count,
        "fixes": fixes,
        "run_id": fix_payload.get("autofixTaskId", ""),
    }


# ---------------------------------------------------------------------------
# Tabs
# ---------------------------------------------------------------------------
tabs = st.tabs([
    "Dashboard",
    "Upload & Validate",
    "Bulk Upload",
    "Results & Report",
    "Fix & Automate",
    "Manual Review",
    "Diff Viewer",
    "History",
])
tab_dashboard, tab_upload, tab_bulk, tab_results, tab_fix, tab_hitl, tab_diff, tab_history = tabs

# ===========================================================================
# TAB 1 - Dashboard
# ===========================================================================
with tab_dashboard:
    st.title("EPUB Automation - Dashboard")

    report  = st.session_state.last_report or {}
    results = report.get("results", [])
    triage  = st.session_state.triage_results or {}

    total_issues = len(results)
    critical = sum(1 for r in results if r.get("status") == "fail")
    auto_fix = sum(1 for r in results if get_routing(r, triage) == "auto")
    llm_fix = sum(1 for r in results if get_routing(r, triage) == "llm")
    hitl_required = sum(1 for r in results if get_routing(r, triage) == "hitl")
    files_processed = 1 if st.session_state.uploaded_file_path else 0
    proposals = st.session_state.agent_proposals or {}
    agent_fixes = sum(1 for v in proposals.values() if v.get("fixable"))

    c1, c2, c3, c4, c5, c6, c7 = st.columns(7)
    for col, (label, val) in zip(
        [c1, c2, c3, c4, c5, c6, c7],
        [
            ("Total Issues", total_issues),
            ("Critical (Fail)", critical),
            ("Auto-Fix (Rules)", auto_fix),
            ("Agentic Fix", llm_fix),
            ("Manual Review", hitl_required),
            ("Agent Patches", agent_fixes),
            ("Files Processed", files_processed),
        ],
    ):
        col.markdown(_metric_card(label, val), unsafe_allow_html=True)

    if st.session_state.last_report is None:
        st.info("No validation run yet. Go to **Upload & Validate** to start.")
    elif not results and st.session_state.last_report:
        st.success("Last validation found **0 issues** - EPUB is clean!")
    else:
        st.markdown("---")

    with st.expander("Pipeline Log", expanded=bool(st.session_state.pipeline_log)):
        for entry in st.session_state.pipeline_log:
            icon = "[OK]" if entry["status"] == "ok" else ("[ERR]" if entry["status"] == "error" else "[...]")
            st.markdown(
                f'<div class="pipeline-step {"done" if entry["status"]=="ok" else "error" if entry["status"]=="error" else ""}">'
                f'{icon} <b>{entry["step"]}</b> - {entry["detail"]}</div>',
                unsafe_allow_html=True,
            )

    with st.expander("What is EPUB Automation?", expanded=False):
        st.write(
            "EPUB Automation is an AI-powered pipeline that validates EPUB/PDF publications "
            "against EPUB 3.3 and WCAG 2.1 standards, automatically triages detected issues by "
            "complexity and confidence, applies LLM-driven fixes to eligible issues, and routes "
            "complex cases to a human reviewer queue."
        )

# ===========================================================================
# TAB 2 - Upload & Validate
# ===========================================================================
with tab_upload:
    st.title("Upload & Validate")

    uploaded_file = st.file_uploader(
        "Choose an EPUB or PDF file",
        type=["epub", "pdf"],
        help="Maximum recommended size: 200 MB",
    )

    if uploaded_file:
        temp_dir = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "temp_uploads"
        )
        os.makedirs(temp_dir, exist_ok=True)
        file_path = os.path.join(temp_dir, uploaded_file.name)
        upload_changed = (
            uploaded_file.name != st.session_state.uploaded_file_name
            or uploaded_file.size != st.session_state.uploaded_file_size
            or file_path != st.session_state.uploaded_file_path
        )

        if upload_changed:
            # Streamlit reruns after validation; only clear downstream state for a new upload.
            with open(file_path, "wb") as fh:
                fh.write(uploaded_file.getbuffer())
            st.session_state.uploaded_file_path = file_path
            st.session_state.uploaded_file_name = uploaded_file.name
            st.session_state.uploaded_file_size = uploaded_file.size
            st.session_state.last_report = None
            st.session_state.last_fix_res = {}
            st.session_state.last_fix_meta = {}
            st.session_state.last_fix_trace = []
            st.session_state.last_fix_diffs = []
            st.session_state.last_fixed_epub_bytes = None
            st.session_state._fix_report_bytes = None
            st.session_state._diff_cache_key = ""
            st.session_state._all_diffs = []
            st.session_state.diff_manual_review_files = []
            st.session_state.hitl_queue = []
            st.session_state.hitl_suggestions = {}
            st.session_state.hitl_run_id = ""
            st.success(f"File ready: `{uploaded_file.name}` ({uploaded_file.size/1024:.1f} KB)")
            save_persistent_state()

    if st.session_state.uploaded_file_path:
        st.info(f"Active file: `{os.path.basename(st.session_state.uploaded_file_path)}`")
        fname = os.path.basename(st.session_state.uploaded_file_path)

        if st.button("Run Validation Pipeline", disabled=st.session_state.validation_running):
            st.session_state.validation_running = True
            st.session_state.pipeline_log = []
            st.session_state.agent_proposals = {}
            st.session_state.hitl_suggestions = {}
            st.session_state.hitl_run_id = ""
            st.session_state.last_fix_res = {}
            st.session_state.last_fix_meta = {}
            st.session_state.last_fix_trace = []
            st.session_state.last_fix_diffs = []
            st.session_state.last_fixed_epub_bytes = None
            st.session_state._fix_report_bytes = None
            st.session_state._diff_cache_key = ""
            st.session_state._all_diffs = []
            st.session_state.diff_manual_review_files = []

            # -- Step 1: Validate (async - no timeout for any file size) ---------
            _status_placeholder = st.empty()
            _status_placeholder.info("Step 1/3 - Uploading file and starting validation...")

            def _on_validation_status(stage, elapsed_s):
                stage_labels = {
                    "queued":         "queued, waiting to start",
                    "checking_cache": "checking result cache...",
                    "validating":     "running parallel checks (metadata, media, accessibility, text, layout, visual)...",
                    "complete":       "finalising results...",
                }
                label = stage_labels.get(stage, stage)
                _status_placeholder.info(
                    f"Step 1/3 - Validation in progress ({elapsed_s}s elapsed): {label}"
                )

            with st.spinner("Step 1/3 - Validating... (real-time updates every second)"):
                report = APIClient.validate_file_async(
                    st.session_state.uploaded_file_path,
                    on_status=_on_validation_status,
                    poll_interval=1,
                )
            _status_placeholder.empty()

            st.session_state.validation_running = False

            if report.get("ok") is False:
                st.error(f"Validation failed: {report.get('error', 'Unknown error')}")
                _log_step("Validation", "error", report.get("error", ""))
                st.stop()

            results = report.get("results", [])
            st.session_state.last_report = report
            _log_step("Validation", "ok", f"{len(results)} issues found in {fname}")
            st.success(f"Step 1 done - **{len(results)}** issues found")

            # -- Step 2: Triage ------------------------------------------------
            if results:
                with st.spinner(f"Step 2/3 - Triaging {len(results)} issues via agents..."):
                    try:
                        triage_resp = requests.post(
                            f"{PYTHON_BASE_URL}/triage",
                            json={"issues": results},
                            timeout=60,
                        )
                        triage_data = triage_resp.json()
                        triage_list_raw = triage_data.get("triage_results", [])
                        local_triage = {
                            item["issue_id"]: {
                                "routing":    item.get("routing", "hitl"),
                                "confidence": item.get("confidence", 0.0),
                                "complexity": item.get("complexity", "medium"),
                                "reason":     item.get("reason", ""),
                                "fix_mode":   item.get("fix_mode", ""),
                                "engine":     item.get("engine", ""),
                            }
                            for item in triage_list_raw
                            if isinstance(item, dict) and "issue_id" in item
                        }
                        st.session_state.triage_results = local_triage
                        hitl_issues = [
                            {**iss, "reason": local_triage.get(iss.get("id"), {}).get("reason", "")}
                            for iss in results
                            if local_triage.get(iss.get("id"), {}).get("routing", "hitl") == "hitl"
                        ]
                        st.session_state.hitl_queue = hitl_issues
                        auto_count = sum(
                            1 for meta in local_triage.values()
                            if meta.get("routing") == "auto"
                        )
                        llm_count = sum(
                            1 for meta in local_triage.values()
                            if meta.get("routing") == "llm"
                        )
                        hitl_count = len(hitl_issues)
                        _log_step(
                            "Triage",
                            "ok",
                            f"{auto_count} -> AUTO, {llm_count} -> Agentic Fix, {hitl_count} -> Manual Review",
                        )
                        st.success(
                            f"Step 2 done - **{auto_count}** AUTO, "
                            f"**{llm_count}** Agentic Fix, **{hitl_count}** Manual Review"
                        )
                    except Exception as exc:
                        # Fallback: local routing
                        local_triage = {
                            iss.get("id", ""): {
                                "routing":    route_issue(iss),
                                "confidence": iss.get("confidence", 0.0),
                                "complexity": get_complexity(iss),
                            }
                            for iss in results
                        }
                        st.session_state.triage_results = local_triage
                        st.session_state.hitl_queue = [
                            {**iss, "reason": "Local fallback routing"}
                            for iss in results
                            if route_issue(iss) == "hitl"
                        ]
                        auto_count = sum(
                            1 for meta in local_triage.values()
                            if meta.get("routing") == "auto"
                        )
                        llm_count = sum(
                            1 for meta in local_triage.values()
                            if meta.get("routing") == "llm"
                        )
                        hitl_count = sum(
                            1 for meta in local_triage.values()
                            if meta.get("routing") == "hitl"
                        )
                        _log_step("Triage", "error", f"Fallback: {exc}")
                        st.warning(
                            f"Triage service unavailable - using local routing "
                            f"({auto_count} AUTO, {llm_count} Agentic Fix, {hitl_count} Manual Review)."
                        )
            else:
                st.session_state.triage_results = {}
                st.session_state.hitl_queue = []

            st.markdown(
                "---\n"
                "### Pipeline complete!\n"
                f"Found **{len(results)}** issues. Switch to **Results & Report** to see them, "
                "or **Fix & Automate** to apply fixes (includes on-demand agent analysis)."
            )
            _log_step("Pipeline", "ok", "Validation + triage complete - agent scan available on demand in Fix tab")
            save_persistent_state()
            st.rerun()
    else:
        st.info("Upload a file above to begin.")

# ===========================================================================
# TAB 2b - Bulk Upload
# ===========================================================================
with tab_bulk:
    st.title("Bulk EPUB Upload & Auto-Fix")
    st.caption("Upload up to 20 EPUB files at once - all processed in parallel.")

    bulk_files = st.file_uploader(
        "Select EPUB files",
        type=["epub"],
        accept_multiple_files=True,
        key="bulk_epub_uploader",
    )

    if bulk_files:
        st.info(f"{len(bulk_files)} file(s) selected. Each will be validated and auto-fixed in parallel.")

        col_b1, col_b2 = st.columns(2)
        with col_b1:
            run_bulk_validate = st.button("Validate All", type="secondary", key="bulk_validate_btn")
        with col_b2:
            run_bulk_fix = st.button("Validate + Auto-Fix All", type="primary", key="bulk_fix_btn")

        if run_bulk_validate or run_bulk_fix:
            import tempfile, os as _os

            # Save all uploaded files to temp paths
            tmp_dir = tempfile.mkdtemp(prefix="epub_bulk_")
            saved_paths = []
            for uf in bulk_files:
                tmp_path = _os.path.join(tmp_dir, uf.name)
                with open(tmp_path, "wb") as fh:
                    fh.write(uf.read())
                saved_paths.append(tmp_path)

            # -- Step 1: Validate all EPUBs ----------------------------------
            st.subheader("Validation Progress")
            val_results = {}
            val_progress = st.progress(0)
            val_status   = st.empty()

            for idx, fpath in enumerate(saved_paths):
                fname = _os.path.basename(fpath)
                val_status.markdown(f"Validating **{fname}** ({idx+1}/{len(saved_paths)})...")
                result = APIClient.validate_file_async(
                    fpath,
                    on_status=lambda stage, elapsed: val_status.markdown(
                        f"**{fname}** - `{stage}` ({elapsed}s)"
                    ),
                    poll_interval=1,
                )
                val_results[fname] = result
                val_progress.progress((idx + 1) / len(saved_paths))

            val_status.markdown("All validations complete.")

            # Show per-file summary table
            summary_rows = []
            for fname, r in val_results.items():
                issues = r.get("results", [])
                fails  = sum(1 for x in issues if x.get("status") == "fail")
                warns  = sum(1 for x in issues if x.get("status") == "warn")
                summary_rows.append({"File": fname, "Total": len(issues), "Fails": fails, "Warns": warns})
            if summary_rows:
                st.dataframe(summary_rows, use_container_width=True)

            if run_bulk_fix:
                # -- Step 2: Submit all for autofix ---------------------------
                st.subheader("Auto-Fix Progress")
                issues_map = {
                    _os.path.basename(fp): val_results.get(_os.path.basename(fp), {}).get("results", [])
                    for fp in saved_paths
                }

                submit_result = APIClient.submit_bulk_autofix(saved_paths, issues_map)
                if "error" in submit_result:
                    st.error(f"Bulk submit failed: {submit_result['error']}")
                else:
                    jobs = submit_result.get("jobs", [])
                    valid_jobs = [j for j in jobs if "jobId" in j]
                    errored    = [j for j in jobs if "error" in j]

                    if errored:
                        for ej in errored:
                            st.warning(f"{ej.get('filename', '?')}: {ej.get('error')}")

                    if valid_jobs:
                        st.caption(f"Processing {len(valid_jobs)} jobs in parallel...")
                        fix_progress  = st.progress(0)
                        fix_status    = st.empty()
                        completed     = {}
                        done_count    = [0]

                        def _on_update(job_id, stage, status):
                            fix_status.markdown(
                                f"`{job_id}` - **{stage}** ({status})"
                            )
                            if status in ("done", "failed"):
                                done_count[0] += 1
                                fix_progress.progress(done_count[0] / len(valid_jobs))

                        fix_results = APIClient.poll_bulk_jobs(
                            valid_jobs, on_update=_on_update, poll_interval=2
                        )

                        fix_status.markdown("All jobs complete.")

                        # Show results and download buttons
                        for job_id, res in fix_results.items():
                            fname = res.get("filename", job_id)
                            if res.get("ok") and res.get("epub_bytes"):
                                col_r1, col_r2 = st.columns([3, 1])
                                with col_r1:
                                    st.success(
                                        f"**{fname}** - {res.get('applied', 0)} fixes applied "
                                        f"(LLM: {res.get('llm_applied', 0)}, AUTO: {res.get('auto_applied', 0)})"
                                    )
                                with col_r2:
                                    st.download_button(
                                        "Download",
                                        data=res["epub_bytes"],
                                        file_name=fname.replace(".epub", "_fixed.epub"),
                                        mime="application/epub+zip",
                                        key=f"dl_bulk_{job_id}",
                                    )
                            else:
                                st.error(f"**{fname}** - {res.get('error', 'Failed')}")
    else:
        st.info("Select one or more EPUB files above to begin bulk processing.")

# ===========================================================================
# TAB 3 - Results & Report
# ===========================================================================
with tab_results:
    st.title("Results & Report")

    report  = st.session_state.last_report
    triage  = st.session_state.triage_results or {}

    if report is None:
        st.warning("No validation results yet - run validation in the **Upload & Validate** tab.")
        st.stop()

    results = report.get("results", [])
    fix_res = st.session_state.last_fix_res or {}

    if not results:
        st.success("Validation complete - **0 issues** found. This EPUB is clean!")
        st.json({"run_id": report.get("run_id", ""), "summary": report.get("summary", {})})
        st.stop()

    # 
    # SECTION 1 - PRE-FIX: Issues found in Validation Phase
    # 
    st.markdown(
        '<div style="background:#0E3545;border-left:4px solid #1A8A9A;padding:10px 16px;'
        'border-radius:6px;margin-bottom:1rem;">'
        '<span style="color:#1A8A9A;font-weight:700;font-size:1.05rem;">'
        'Pre-Fix - Issues Found in Validation Phase</span></div>',
        unsafe_allow_html=True,
    )

    # -- Issue Summary chips ------------------------------------------------
    fails     = [r for r in results if r.get("status") == "fail"]
    warns     = [r for r in results if r.get("status") == "warn"]
    smalls    = [r for r in results if get_complexity(r, triage.get(r.get("id", ""), {})) == "small"]
    mediums   = [r for r in results if get_complexity(r, triage.get(r.get("id", ""), {})) == "medium"]
    complexes = [r for r in results if get_complexity(r, triage.get(r.get("id", ""), {})) == "complex"]

    chip_cols = st.columns(6)
    chips = [
        ("Total",   len(results),   "#1A8A9A"),
        ("Fail",    len(fails),     "#dc3545"),
        ("Warn",    len(warns),     "#ffc107"),
        ("Small",   len(smalls),    "#28a745"),
        ("Medium",  len(mediums),   "#ffc107"),
        ("Complex", len(complexes), "#dc3545"),
    ]
    for col, (label, count, color) in zip(chip_cols, chips):
        col.markdown(
            f'<div style="background:{color};color:{"#0A2A35" if color=="#ffc107" else "white"};'
            f'border-radius:20px;padding:6px 14px;text-align:center;font-weight:600;">'
            f'{label}: {count}</div>',
            unsafe_allow_html=True,
        )
    st.markdown("")

    # -- Filter + Issues Table ----------------------------------------------
    domains      = ["All"] + sorted(set(get_issue_domain(r) for r in results))
    complexities = ["All", "Small", "Medium", "Complex"]
    routings     = ["All", "AUTO", "Agentic Fix", "Manual Review"]
    statuses     = ["Fail + Warn", "Fail only", "All"]

    f1, f2, f3, f4 = st.columns(4)
    with f1:
        status_filter    = st.selectbox("Status", statuses, key="res_status", index=0)
    with f2:
        domain_filter    = st.selectbox("Domain", domains, key="res_domain")
    with f3:
        complexity_filter = st.selectbox("Complexity", complexities, key="res_complex")
    with f4:
        routing_filter   = st.selectbox("Routing", routings, key="res_routing")

    df_full = _build_issues_df(results, triage)
    df_view = df_full.copy()

    if status_filter == "Fail + Warn":
        df_view = df_view[df_view["Status"].isin(["FAIL", "WARN"])]
    elif status_filter == "Fail only":
        df_view = df_view[df_view["Status"] == "FAIL"]

    if domain_filter     != "All": df_view = df_view[df_view["Domain"]     == domain_filter]
    if complexity_filter != "All": df_view = df_view[df_view["Complexity"] == complexity_filter]
    if routing_filter    != "All": df_view = df_view[df_view["Routing"]    == routing_filter]

    if df_view.empty:
        st.info("No issues match the selected filters.")
    else:
        st.dataframe(df_view, use_container_width=True, hide_index=True)

    # -- LLM Suggestions per Issue ------------------------------------------
    proposals = st.session_state.agent_proposals or {}
    if triage or proposals:
        with st.expander("LLM Suggestions per Issue", expanded=False):
            suggestion_rows = []
            for r in results:
                iid = r.get("id", "")
                t   = triage.get(iid, {}) if isinstance(triage, dict) else {}
                routing    = t.get("routing", "")
                complexity = t.get("complexity", "-")
                prop = proposals.get(iid, {})
                suggestion = (
                    prop.get("patch", "")
                    or t.get("suggested_fix", "")
                    or t.get("reason", "")
                    or t.get("explanation", "")
                )
                suggestion_rows.append({
                    "Issue ID":       iid,
                    "Title":          r.get("title", r.get("message", ""))[:60],
                    "Routing":        "Manual Review" if routing == "hitl" else ("Agentic Fix" if routing == "llm" else routing.upper() if routing else "-"),
                    "Complexity":     complexity,
                    "LLM Suggestion": suggestion[:140] if suggestion else "-",
                })
            if suggestion_rows:
                st.dataframe(pd.DataFrame(suggestion_rows), use_container_width=True, hide_index=True)

    # -- Validation-Phase Report Download -----------------------------------
    st.markdown("---")
    st.markdown("##### Download Validation Report")
    st.caption("Contains issues, per-issue details, and LLM suggestions - no fix data.")
    _vcol1, _vcol2 = st.columns([1, 2])
    with _vcol1:
        if st.button("Generate HTML Report", key="gen_validation_report"):
            with st.spinner("Generating validation report..."):
                try:
                    _triage_list = [
                        {**v, "id": k}
                        for k, v in triage.items()
                        if isinstance(v, dict)
                    ]
                    _fname = os.path.basename(
                        st.session_state.uploaded_file_path or "document.epub"
                    )
                    _resp = requests.post(
                        f"{PYTHON_BASE_URL}/report/generate",
                        json={
                            "filename": _fname,
                            "validation_report": report,
                            "fix_results": {},
                            "triage_results": _triage_list,
                            "fix_trace": [],
                            "hitl_suggestions": st.session_state.get("hitl_suggestions", {}),
                            "diffs": [],
                            "report_mode": "validation",
                        },
                        timeout=180,
                    )
                    st.session_state["_val_report_bytes"] = _resp.content
                    st.success("Report ready - click Save below.")
                except Exception as exc:
                    st.error(f"Report generation failed: {exc}")
        if st.session_state.get("_val_report_bytes"):
            st.download_button(
                "Save Validation Report",
                data=st.session_state["_val_report_bytes"],
                file_name="EPUB_Validation_Report.html",
                mime="text/html",
                key="save_validation_report",
            )
    with _vcol2:
        st.download_button(
            "Download Raw JSON",
            data=json.dumps(report, indent=2),
            file_name="EPUB_Validation.json",
            mime="application/json",
        )

    # 
    # SECTION 2 - POST-FIX: Results after Autofix Phase
    # 
    st.markdown("")
    if fix_res:
        st.markdown(
            '<div style="background:#0A3020;border-left:4px solid #28a745;padding:10px 16px;'
            'border-radius:6px;margin-bottom:1rem;">'
            '<span style="color:#28a745;font-weight:700;font-size:1.05rem;">'
            'Post-Fix - Results After Autofix</span></div>',
            unsafe_allow_html=True,
        )

        verif = fix_res.get("verification") or {}
        post_results = (
            verif.get("results")
            or verif.get("report", {}).get("results", [])
            if isinstance(verif, dict) else []
        )
        pre_map    = {r.get("id", ""): r for r in results     if r.get("id")}
        post_map   = {r.get("id", ""): r for r in post_results if r.get("id")}
        fixed      = sum(1 for k in pre_map if pre_map[k].get("status") in ("fail", "warn") and post_map.get(k, {}).get("status") not in ("fail", "warn"))
        remaining  = sum(1 for k in pre_map if post_map.get(k, {}).get("status") in ("fail", "warn"))
        new_issues = sum(1 for k in post_map if k not in pre_map)

        m1, m2, m3 = st.columns(3)
        m1.metric("Issues Fixed",  fixed)
        m2.metric("Remaining",     remaining)
        m3.metric("New Issues",    new_issues)

        c_pre, c_post = st.columns(2)
        with c_pre:
            st.subheader("Pre-Fix")
            st.dataframe(
                _build_issues_df([r for r in results if r.get("status") in ("fail", "warn")], triage),
                use_container_width=True, hide_index=True,
            )
        with c_post:
            st.subheader("Post-Fix")
            df_post = _build_issues_df([r for r in post_results if r.get("status") in ("fail", "warn")], triage)
            if df_post.empty:
                st.success("No remaining issues after fix.")
            else:
                st.dataframe(df_post, use_container_width=True, hide_index=True)

        # -- Full Post-Fix Report Download ----------------------------------
        st.markdown("---")
        st.markdown("##### Download Full Post-Fix Report")
        st.caption("Contains pre/post comparison, fix details, summary, and recommendations.")
        _fcol1, _fcol2 = st.columns([1, 2])
        with _fcol1:
            if st.button("Generate Full Report", key="gen_full_report"):
                with st.spinner("Generating full report..."):
                    try:
                        _triage_list = [
                            {**v, "id": k}
                            for k, v in triage.items()
                            if isinstance(v, dict)
                        ]
                        _fname = os.path.basename(
                            st.session_state.uploaded_file_path or "document.epub"
                        )
                        _resp = requests.post(
                            f"{PYTHON_BASE_URL}/report/generate",
                            json={
                                "filename": _fname,
                                "validation_report": report,
                                "fix_results": fix_res,
                                "triage_results": _triage_list,
                                "fix_trace": st.session_state.get("last_fix_trace", []),
                                "hitl_suggestions": st.session_state.get("hitl_suggestions", {}),
                                "diffs": st.session_state.get("last_fix_diffs", []),
                                "report_mode": "full",
                            },
                            timeout=180,
                        )
                        st.session_state["_full_report_bytes"] = _resp.content
                        st.success("Report ready - click Save below.")
                    except Exception as exc:
                        st.error(f"Report generation failed: {exc}")
            if st.session_state.get("_full_report_bytes"):
                st.download_button(
                    "Save Full Report",
                    data=st.session_state["_full_report_bytes"],
                    file_name="EPUB_Full_Report.html",
                    mime="text/html",
                    key="save_full_report",
                )
        with _fcol2:
            st.download_button(
                "Download Fix JSON",
                data=json.dumps(fix_res, indent=2, default=str),
                file_name="EPUB_Fix_Results.json",
                mime="application/json",
            )
    else:
        st.info(
            "Run **Agent Autofix** in the Fix & Automate tab to see post-fix comparison, "
            "fix details, and full report download here."
        )

# ===========================================================================
# TAB 4 - Fix & Automate
# ===========================================================================
with tab_fix:
    st.title("Fix & Automate")

    report  = st.session_state.last_report
    fix_res = st.session_state.last_fix_res or {}
    proposals = st.session_state.agent_proposals or {}

    if report is None:
        st.warning("Run validation first.")
        st.stop()

    results    = report.get("results", [])
    actionable = [r for r in results if r.get("status") in ("fail", "warn")]
    triage     = st.session_state.triage_results or {}

    # Summary
    auto_routed = [r for r in actionable if get_routing(r, triage) == "auto"]
    llm_routed = [r for r in actionable if get_routing(r, triage) == "llm"]
    hitl_routed = [r for r in actionable if get_routing(r, triage) == "hitl"]
    agent_fixable = sum(1 for v in proposals.values() if v.get("fixable"))

    col_s1, col_s2, col_s3, col_s4, col_s5 = st.columns(5)
    col_s1.metric("Total Actionable", len(actionable))
    col_s2.metric("AUTO-Routed", len(auto_routed))
    col_s3.metric("Agentic Fix", len(llm_routed))
    col_s4.metric("Manual Review", len(hitl_routed))
    col_s5.metric("Agent Patches Ready", agent_fixable)

    st.markdown("---")

    # -- LLM / Model Status panel ------------------------------------------
    with st.expander("AI Model Status", expanded=False):
        if st.button("Check AI Model Status", key="check_llm_status"):
            with st.spinner("Probing Ollama endpoints..."):
                try:
                    _llm_status = requests.get(
                        f"{PYTHON_BASE_URL}/llm-status", timeout=60
                    ).json()
                    _primary  = _llm_status.get("primary", {})
                    _fallback = _llm_status.get("fallback", {})
                    _reachable = (
                        _primary.get("status") == "reachable"
                        or _fallback.get("status") == "reachable"
                    )
                    if _reachable:
                        _ep_label = (
                            _primary.get("url", "")
                            if _primary.get("status") == "reachable"
                            else _fallback.get("url", "")
                        )
                        st.success(f"Ollama reachable @ `{_ep_label}`")
                    else:
                        st.error("Ollama unreachable on both endpoints.")
                    _ep_cols = st.columns(2)
                    with _ep_cols[0]:
                        _p_stat = _primary.get("status", "unknown")
                        _p_icon = "green" if _p_stat == "reachable" else "red"
                        st.markdown(f"**Primary** `{_primary.get('url','')}` - :{_p_icon}[{_p_stat}]")
                        if _primary.get("models"):
                            st.caption(", ".join(_primary["models"]))
                    with _ep_cols[1]:
                        _f_stat = _fallback.get("status", "unknown")
                        _f_icon = "green" if _f_stat == "reachable" else "red"
                        st.markdown(f"**Fallback** `{_fallback.get('url','')}` - :{_f_icon}[{_f_stat}]")
                        if _fallback.get("models"):
                            st.caption(", ".join(_fallback["models"]))
                    _resolved = _llm_status.get("resolved_models", {})
                    if _resolved:
                        st.markdown("**Resolved model per task type:**")
                        _task_rows = [
                            {"Task Type": t, "Model": i.get("model", "-"), "Endpoint": i.get("endpoint", "-")}
                            for t, i in _resolved.items()
                        ]
                        st.dataframe(pd.DataFrame(_task_rows), use_container_width=True, hide_index=True)
                except Exception as _exc:
                    st.warning(f"Could not reach Python service: {_exc}")
        else:
            st.caption("Click the button above to probe Ollama endpoints and resolve models per task type.")

    st.markdown("---")

    if st.button("Auto Fix EPUB", key="apply_autofix", use_container_width=True, type="primary"):
        n_actionable = len(actionable)
        progress = st.progress(0, text="Submitting autofix job...")

        _STAGE_LABELS = {
            "queued":      (5,  "Queued - waiting for pipeline slot..."),
            "triaging":    (15, "Step 1/5 - Triaging issues..."),
            "node_fixing": (30, "Step 2/5 - Applying deterministic fixes (Node.js)..."),
            "python_fallback": (40, "Step 3/5 - Python deterministic fallback..."),
            "llm_fixing":  (55, "Step 4/5 - LLM fixer running (may take a while)..."),
            "patching":    (85, "Step 5/5 - Patching EPUB..."),
            "done":        (100, "Complete!"),
        }

        def _on_status(stage: str, elapsed_s: int):
            pct, label = _STAGE_LABELS.get(
                stage.split(" ")[0],
                (50, f"Running - {stage} ({elapsed_s}s)..."),
            )
            progress.progress(pct, text=f"{label}  [{elapsed_s}s elapsed]")

        progress.progress(10, text=f"Uploading EPUB + {n_actionable} issue(s)...")
        epub_bytes, meta = APIClient.run_agent_autofix(
            st.session_state.uploaded_file_path,
            actionable,
            on_status=_on_status,
        )
        progress.progress(100, text="Done.")

        if not meta.get("ok"):
            st.error(f"Agent autofix failed: {meta.get('error', 'Unknown error')}")
        else:
            st.session_state.last_fixed_epub_bytes = epub_bytes
            st.session_state.last_fix_meta = meta
            applied_a    = meta.get("applied", 0)
            failed_a     = meta.get("failed", 0)
            total_issues = meta.get("total_issues", len(actionable))
            auto_issues_n = meta.get("auto_issues", 0)
            llm_issues_n = meta.get("llm_issues", 0)
            hitl_issues_n = meta.get("hitl_issues", 0)
            unique_rules = meta.get("unique_rules", 0)
            cache_hits   = meta.get("cache_hits", 0)
            run_id_fix   = meta.get("run_id", "")
            triage_data  = meta.get("triage", [])
            fix_trace    = meta.get("fix_trace", [])

            # Store Manual Review suggestions for the Manual Review tab
            st.session_state.hitl_suggestions = meta.get("hitl_suggestions", {})
            st.session_state.hitl_run_id      = run_id_fix

            st.success(
                f"Agent fix complete - **{applied_a}** fix(es) applied"
                + (f", {failed_a} failed" if failed_a else "")
            )

            c1, c2, c3, c4 = st.columns(4)
            c1.metric("Total Issues",    total_issues)
            c2.metric("Fixed",           applied_a)
            c3.metric("Manual Review",   hitl_issues_n)
            c4.metric("Cache Hits",      cache_hits)

            if cache_hits > 0:
                st.caption(f"{cache_hits} rule(s) reused cached fix - saved {cache_hits} LLM calls.")

            base_name = os.path.splitext(
                os.path.basename(st.session_state.uploaded_file_path or "document.epub")
            )[0]

            # -- Agent Monitor ---------------------------------------------
            st.divider()
            st.subheader("Agent Monitor")

            # Triage Decisions table
            with st.expander("Fix Decisions", expanded=True):
                if triage_data:
                    triage_rows = []
                    for t in triage_data:
                        routing = str(t.get("routing", "hitl")).lower()
                        action = "Manual Review" if routing == "hitl" else "Agent Fix"
                        triage_rows.append({
                            "Issue ID":    t.get("issue_id", ""),
                            "Title":       str(t.get("title", ""))[:55],
                            "Action":      action,
                            "Confidence":  round(float(t.get("confidence", 0)), 2),
                            "Reason":      str(t.get("reason", ""))[:80],
                        })
                    _td = pd.DataFrame(triage_rows)
                    def _color_action(val):
                        if val == "Agent Fix": return "color:#38C878;font-weight:700"
                        return "color:#E8A838;font-weight:700"
                    st.dataframe(
                        _td.style.applymap(_color_action, subset=["Action"]),
                        use_container_width=True, hide_index=True,
                    )
                else:
                    st.info("No triage data returned.")

            # -- Build fix_list for session state & report -----------------
            diffs         = meta.get("diffs", []) if meta else []
            trace_map     = {t.get("issue_id", ""): t for t in fix_trace}
            triage_map_be = {t.get("issue_id", ""): t for t in triage_data}

            fix_list = []
            for iss in actionable:
                iid          = iss.get("id", "")
                fx           = trace_map.get(iid, {})
                tr           = triage_map_be.get(iid, {})
                routing      = str(fx.get("routing") or tr.get("routing") or "hitl").lower()
                applied_flag = fx.get("applied", False)
                status       = "hitl" if routing == "hitl" else ("fixed" if applied_flag else "unfixed")
                if routing == "auto" and applied_flag:
                    status = "auto"
                fix_list.append({
                    "issue_id": iid,
                    "patch":    "Applied" if status in ("fixed", "auto") else ("Manual Review" if status == "hitl" else "CANNOT_FIX"),
                    "fixable":  status in ("fixed", "auto"),
                    "status":   status,
                })

            # -- Session state & report data -------------------------------
            fixed_count   = sum(1 for f in fix_list if f["status"] in ("fixed", "auto"))
            unfixed_count = sum(1 for f in fix_list if f["status"] == "unfixed")
            triage_list_for_report = triage_data
            fix_results_for_report = {
                "fixed_count":    fixed_count,
                "unfixable_count": unfixed_count,
                "fixes":          fix_list,
                "run_id":         run_id_fix,
                "applied":        applied_a,
                "failed":         failed_a,
            }
            st.session_state.last_fix_res = fix_results_for_report
            st.session_state.last_fix_trace = fix_trace
            st.session_state.last_fix_diffs = diffs
            save_persistent_state()

            # -- EPUB Readiness Report -------------------------------------
            st.divider()
            st.subheader("EPUB Readiness Report")

            total_checked  = total_issues
            fixed_total    = applied_a
            manual_pending = hitl_issues_n
            failed_total   = failed_a
            pct_fixed      = round((fixed_total / total_checked * 100) if total_checked else 0)

            if manual_pending == 0 and failed_total == 0 and fixed_total >= total_checked:
                readiness_status = "READY TO PUBLISH"
                readiness_color  = "#1e7e34"
                readiness_bg     = "#d4edda"
                readiness_icon   = "OK"
                readiness_desc   = "All detected issues have been resolved. The EPUB is structurally valid and ready for distribution."
            elif manual_pending == 0 and failed_total == 0:
                readiness_status = "READY TO PUBLISH"
                readiness_color  = "#1e7e34"
                readiness_bg     = "#d4edda"
                readiness_icon   = "OK"
                readiness_desc   = "All actionable issues have been fixed. The EPUB passed post-fix validation."
            elif manual_pending > 0 and fixed_total > 0:
                readiness_status = "PARTIALLY FIXED - REVIEW REQUIRED"
                readiness_color  = "#856404"
                readiness_bg     = "#fff3cd"
                readiness_icon   = "WARN"
                readiness_desc   = f"{fixed_total} issue(s) were fixed automatically. {manual_pending} issue(s) need your manual attention before this EPUB is ready to publish."
            elif fixed_total == 0:
                readiness_status = "NOT READY - ALL ISSUES PENDING"
                readiness_color  = "#721c24"
                readiness_bg     = "#f8d7da"
                readiness_icon   = "ERROR"
                readiness_desc   = "No issues were fixed automatically. All issues require manual resolution."
            else:
                readiness_status = "NEEDS REVIEW"
                readiness_color  = "#721c24"
                readiness_bg     = "#f8d7da"
                readiness_icon   = "ERROR"
                readiness_desc   = f"{failed_total} fix attempt(s) failed. Review the Agent Monitor above for details."

            st.markdown(
                f"""
                <div style="background:{readiness_bg};border-left:6px solid {readiness_color};
                            padding:16px 20px;border-radius:6px;margin-bottom:12px;">
                    <div style="font-size:18px;font-weight:700;color:{readiness_color};">
                        {readiness_icon} {readiness_status}
                    </div>
                    <div style="margin-top:6px;color:#333;font-size:14px;">{readiness_desc}</div>
                </div>
                """,
                unsafe_allow_html=True,
            )

            r1, r2, r3, r4 = st.columns(4)
            r1.metric("Total Issues Checked", total_checked)
            r2.metric("Auto Fixed",           fixed_total,    delta=f"{pct_fixed}% resolved" if pct_fixed else None)
            r3.metric("Manual Review Needed", manual_pending, delta="action needed" if manual_pending else None, delta_color="inverse")
            r4.metric("Fix Failures",         failed_total,   delta="check log" if failed_total else None, delta_color="inverse")

            if manual_pending > 0:
                st.info(
                    f"**{manual_pending} issue(s) need manual resolution.** "
                    f"Go to the **Manual Review** tab to see AI-generated suggestions for each issue, "
                    f"or resolve them directly in the source files."
                )
            if failed_total > 0:
                st.warning(
                    f"**{failed_total} fix attempt(s) failed.** "
                    f"Check the Agent Monitor -> Fix Decisions table above for details on which issues failed and why."
                )

            # -- Post-fix Re-validation ------------------------------------
            st.markdown("#### Verify Fixed EPUB")
            st.caption("Re-runs the full validator on the fixed EPUB so you know exactly what remains before downloading.")

            epub_bytes = st.session_state.get("last_fixed_epub_bytes")
            if epub_bytes:
                if st.button("Re-validate Fixed EPUB", type="primary", key="revalidate_fixed"):
                    with st.spinner("Re-validating fixed EPUB against EPUB 3.3 + WCAG 2.1 rules..."):
                        rv = APIClient.validate_bytes(epub_bytes, filename=meta.get("filename", "fixed.epub"))

                    if not rv.get("ok", False) and "error" in rv:
                        st.error(f"Re-validation failed: {rv['error']}")
                    else:
                        rv_results  = rv.get("results", [])
                        rv_fails    = [r for r in rv_results if r.get("status") == "fail"]
                        rv_warnings = [r for r in rv_results if r.get("status") == "warn"]
                        rv_total    = len(rv_results)

                        if rv_total == 0:
                            st.success(
                                "**EPUB PASSES - 0 issues found.**  "
                                "The fixed EPUB is structurally valid and safe to open in Thorium Reader or any EPUB reader."
                            )
                        elif len(rv_fails) == 0:
                            st.warning(
                                f"**{len(rv_warnings)} warning(s) only - no critical failures.**  "
                                f"The EPUB will open correctly in Thorium Reader. Warnings are advisory and do not break reading."
                            )
                        else:
                            st.error(
                                f"**{len(rv_fails)} critical issue(s) still present** ({len(rv_warnings)} warnings).  "
                                f"These may cause errors when opening in Thorium Reader."
                            )

                        if rv_total > 0:
                            rv_rows = []
                            for r in rv_results:
                                loc = r.get("location", {})
                                loc_str = f"{loc.get('file','')}:{loc.get('line','')}" if isinstance(loc, dict) else str(loc)
                                rv_rows.append({
                                    "Severity": "FAIL" if r.get("status") == "fail" else "WARN",
                                    "Rule":     r.get("id", ""),
                                    "Issue":    r.get("title", r.get("message", ""))[:80],
                                    "Location": loc_str,
                                })
                            rv_df = pd.DataFrame(rv_rows)

                            def _color_sev(val):
                                return "color:#c0392b;font-weight:700" if val == "FAIL" else "color:#856404;font-weight:600"

                            st.dataframe(
                                rv_df.style.applymap(_color_sev, subset=["Severity"]),
                                use_container_width=True,
                                hide_index=True,
                            )
            else:
                st.info("Run the agent autofix above to enable re-validation.")

            # -- Downloads ------------------------------------------------
            st.divider()
            dl_col1, dl_col2 = st.columns(2)

            with dl_col1:
                fixed_bytes = st.session_state.get("last_fixed_epub_bytes")
                if fixed_bytes:
                    st.download_button(
                        "Download Fixed EPUB",
                        data=fixed_bytes,
                        file_name=st.session_state.get("last_fix_meta", {}).get("filename", f"{base_name}_agent_fixed.epub"),
                        mime="application/epub+zip",
                        key="download_fixed_epub",
                        use_container_width=True,
                    )
                else:
                    st.warning("No fixed EPUB returned by the agent.")

            with dl_col2:
                if st.session_state.get("_fix_report_bytes"):
                    st.download_button(
                        "Download HTML Report",
                        data=st.session_state["_fix_report_bytes"],
                        file_name=f"{base_name}_fix_report.html",
                        mime="text/html",
                        key="download_fix_report",
                        use_container_width=True,
                    )
                else:
                    with st.spinner("Generating HTML report..."):
                        try:
                            _fname = os.path.basename(
                                st.session_state.uploaded_file_path or "document.epub"
                            )
                            html_resp = requests.post(
                                f"{PYTHON_BASE_URL}/report/generate",
                                json={
                                    "run_id":            run_id_fix,
                                    "filename":          _fname,
                                    "validation_report": report,
                                    "fix_results":       fix_results_for_report,
                                    "triage_results":    triage_list_for_report,
                                    "fix_trace":         fix_trace,
                                    "hitl_suggestions":  meta.get("hitl_suggestions", {}),
                                    "diffs":             diffs,
                                },
                                timeout=180,
                            )
                            if html_resp.ok:
                                html_data = html_resp.text
                                if html_data and html_data.strip().startswith("<"):
                                    st.session_state["_fix_report_bytes"] = html_data.encode("utf-8") if isinstance(html_data, str) else html_data
                                    st.download_button(
                                        "Download HTML Report",
                                        data=st.session_state["_fix_report_bytes"],
                                        file_name=f"{base_name}_fix_report.html",
                                        mime="text/html",
                                        key="download_fix_report",
                                        use_container_width=True,
                                    )
                            else:
                                st.warning("HTML report generation failed - download fixed EPUB above.")
                        except Exception as exc:
                            st.warning(f"HTML report unavailable: {exc}")

# ===========================================================================
# TAB 5 - Manual Review
# ===========================================================================
with tab_hitl:
    st.title("Manual Review Queue")

    hitl_q = st.session_state.hitl_queue
    triage = st.session_state.triage_results or {}

    if not hitl_q:
        if st.session_state.last_report is None:
            st.info("Run validation first to populate the Manual Review queue.")
        else:
            st.success("Manual Review queue is empty - all issues are eligible for automated fixing.")
        st.stop()

    diff_files = st.session_state.get("diff_manual_review_files", [])
    previous_diff_files = set(st.session_state.get("_previous_diff_manual_review_files", []))
    if diff_files:
        st.markdown("#### Files flagged from Diff Viewer")
        st.info(
            "The following EPUB files were marked for manual review in the Diff Viewer: "
            + ", ".join(diff_files)
        )
        existing_ids = {i.get("id") for i in hitl_q if i.get("id")}
        extra_issues = []
        for issue in (st.session_state.last_report or {}).get("results", []):
            issue_id = issue.get("id")
            if not issue_id or issue_id in existing_ids:
                continue
            loc = issue.get("location", {})
            if isinstance(loc, dict):
                loc_path = str(loc.get("file", "") or "")
            else:
                loc_path = str(loc or "")
            if any(df == os.path.basename(loc_path) or loc_path.endswith(df) for df in diff_files):
                extra_issues.append({**issue, "reason": "Marked for manual review from Diff Viewer"})
                existing_ids.add(issue_id)
        if extra_issues:
            hitl_q.extend(extra_issues)
            st.session_state.hitl_queue = hitl_q
            st.success(f"{len(extra_issues)} related issue(s) added to Manual Review from Diff Viewer.")

    removed_diff_files = previous_diff_files - set(diff_files)
    if removed_diff_files:
        original_len = len(hitl_q)
        updated_queue = []
        for issue in hitl_q:
            reason = issue.get("reason", "") or ""
            loc = issue.get("location", {})
            if isinstance(loc, dict):
                loc_path = str(loc.get("file", "") or "")
            else:
                loc_path = str(loc or "")
            removed_match = any(
                reason == "Marked for manual review from Diff Viewer" and
                (df == os.path.basename(loc_path) or loc_path.endswith(df))
                for df in removed_diff_files
            )
            if not removed_match:
                updated_queue.append(issue)
        if len(updated_queue) != original_len:
            removed_count = original_len - len(updated_queue)
            st.session_state.hitl_queue = updated_queue
            hitl_q = updated_queue
            st.info(
                f"Removed {removed_count} diff-review issue(s) from the manual queue after clearing review."
            )

    st.session_state["_previous_diff_manual_review_files"] = list(diff_files)

    _tab_hitl_suggestions = st.session_state.get("hitl_suggestions") or {}
    suggestions_count = sum(
        1 for i in hitl_q
        if _tab_hitl_suggestions.get(i.get("id", ""), {}).get("fixable")
    )

    badge_html = (
        f'<span style="background:#E8954A;color:white;padding:4px 16px;'
        f'border-radius:14px;font-weight:700;font-size:14px;">'
        f'Queue: {len(hitl_q)} pending</span>'
    )
    if suggestions_count:
        badge_html += (
            f'&nbsp;&nbsp;<span style="background:#2a4a7f;color:#5B9BD5;padding:4px 16px;'
            f'border-radius:14px;font-weight:700;font-size:14px;">'
            f' {suggestions_count} AI suggestion(s) ready</span>'
        )
    st.markdown(badge_html, unsafe_allow_html=True)
    st.markdown("")

    all_domains   = ["All"] + sorted(set(get_issue_domain(i) for i in hitl_q))
    filter_domain = st.selectbox("Filter Queue by Domain", all_domains, key="hitl_domain")
    filtered_q    = hitl_q if filter_domain == "All" else [
        i for i in hitl_q if get_issue_domain(i) == filter_domain
    ]

    q_rows = []
    for iss in filtered_q:
        issue_id   = iss.get("id", "")
        confidence = triage.get(issue_id, {}).get("confidence", iss.get("confidence", 0.0))
        sg = _tab_hitl_suggestions.get(issue_id, {})
        q_rows.append({
            "Issue ID":     issue_id,
            "Title":        iss.get("title", iss.get("message", "")),
            "Complexity":   get_complexity(iss, triage.get(issue_id, {})).capitalize(),
            "Confidence":   round(float(confidence or 0), 2),
            "Domain":       get_issue_domain(iss),
            "AI Suggestion": "Ready" if sg.get("patch") else "Generating...",
            "Confidence":   f"{sg['confidence']}%" if sg.get("confidence") is not None else "-",
            "Reason":       iss.get("reason", ""),
        })
    st.dataframe(pd.DataFrame(q_rows), use_container_width=True, hide_index=True)

    st.markdown("---")
    st.subheader("Review Individual Issues")
    st.caption("Every issue has an AI-generated suggestion. Choose to apply it or keep for manual resolution.")

    _hitl_suggestions = st.session_state.get("hitl_suggestions") or {}
    _hitl_run_id      = st.session_state.get("hitl_run_id", "")

    # Issues without suggestions yet - offer to generate on-demand
    missing_sg = [i for i in filtered_q if not _hitl_suggestions.get(i.get("id", ""))]
    if missing_sg:
        st.info(f"{len(missing_sg)} issue(s) don't have AI suggestions yet.")
        if st.button("Generate AI Suggestions for All", type="primary", key="gen_hitl_sg"):
            with st.spinner(f"Generating AI suggestions for {len(missing_sg)} issue(s)..."):
                new_sgs = APIClient.generate_hitl_suggestions(missing_sg)
            if new_sgs and "_error" not in new_sgs:
                if st.session_state.hitl_suggestions is None:
                    st.session_state.hitl_suggestions = {}
                st.session_state.hitl_suggestions.update(new_sgs)
                _hitl_suggestions = st.session_state.hitl_suggestions
                st.success(f"Generated suggestions for {len(new_sgs)} issue(s).")
                st.rerun()
            else:
                err_detail = new_sgs.get("_error", "unknown error") if isinstance(new_sgs, dict) else "no response"
                st.error(f"Could not generate suggestions: {err_detail}")

    for idx, iss in enumerate(filtered_q):
        issue_id   = iss.get("id", f"issue_{idx}")
        sg         = _hitl_suggestions.get(issue_id) or {}
        sg_patch   = sg.get("patch", "")
        sg_fixable = sg.get("fixable", False)
        sg_conf    = sg.get("confidence")
        sg_reason  = sg.get("fix_reason", "")
        sg_model   = sg.get("model_used", "")
        sg_loc     = sg.get("pre_location", "")
        has_patch  = bool(sg_patch and sg_patch.upper() not in ("CANNOT_FIX", "NONE", ""))

        sev_icon = "" if iss.get("status") == "fail" else "yellow"
        conf_tag = f"   |   {sg_conf}% confidence" if sg_conf is not None else ""
        expander_label = f"{sev_icon}  [{issue_id}]  {iss.get('title', iss.get('message', 'Issue'))}{conf_tag}"

        with st.expander(expander_label, expanded=True):

            left_col, right_col = st.columns([1, 1])

            # -- LEFT: Issue details --------------------------------------
            with left_col:
                st.markdown("**What is the issue?**")
                st.markdown(f"**Rule:** `{issue_id}`")
                st.markdown(f"**Severity:** {'Failure' if iss.get('status') == 'fail' else 'Warning'}")

                if sg_loc:
                    st.markdown(f"**Location:** `{sg_loc}`")
                else:
                    loc = iss.get("location", {})
                    if isinstance(loc, dict):
                        loc_file = loc.get("file", "")
                        loc_line = loc.get("line", "")
                        if loc_file:
                            st.markdown(f"**File:** `{loc_file}`" + (f"  line {loc_line}" if loc_line else ""))

                details = iss.get("details", {})
                samples = details.get("samples", []) if isinstance(details, dict) else []
                count   = details.get("count", 0)   if isinstance(details, dict) else 0
                if count:
                    st.markdown(f"**Occurrences:** {count}")
                if samples:
                    rows = []
                    for s in samples[:5]:
                        sf   = s.get("file", "").split("/")[-1]
                        sl   = s.get("line", "")
                        sp   = s.get("property", "")
                        sv   = s.get("value", "")
                        sxt  = (s.get("excerpt") or s.get("text") or "")[:70]
                        if sp and sv:
                            rows.append(f"- `{sf}` line {sl} - `{sp}: {sv}`")
                        elif sxt:
                            rows.append(f"- `{sf}` line {sl} - `{sxt}`")
                        else:
                            rows.append(f"- `{sf}` line {sl}")
                    st.markdown("\n".join(rows))

                suggestion_note = iss.get("suggestion", "")
                if suggestion_note:
                    st.markdown(f"**Validator note:** {suggestion_note}")

            # -- RIGHT: AI suggestion -------------------------------------
            with right_col:
                st.markdown("**AI Suggestion**")

                # Confidence badge
                if sg_conf is not None:
                    if sg_conf >= 80:
                        c_col, c_lbl = "#38C878", f"{sg_conf}%  HIGH"
                    elif sg_conf >= 50:
                        c_col, c_lbl = "#E8A838", f"{sg_conf}%  MEDIUM"
                    else:
                        c_col, c_lbl = "#E85858", f"{sg_conf}%  LOW - review carefully"
                    st.markdown(
                        f"**Confidence:** <span style='color:{c_col};font-weight:700'>{c_lbl}</span>",
                        unsafe_allow_html=True,
                    )

                if sg_model:
                    st.caption(f"Model: {sg_model}   |   Task: {sg.get('task_type', '')}")

                if has_patch:
                    lang = "css" if "css" in issue_id.lower() else ("xml" if "opf" in issue_id.lower() else "text")
                    st.code(sg_patch[:600], language=lang)
                else:
                    st.warning(
                        "The AI could not generate a confident fix automatically. "
                        "Manual review is required."
                    )

                if sg_reason:
                    st.markdown(f"**AI reasoning:** {sg_reason}")

            # -- Action buttons (full width) ------------------------------
            st.markdown("---")
            col_apply, col_manual = st.columns(2)

            with col_apply:
                apply_disabled = not (has_patch and _hitl_run_id)
                apply_help     = "No patch available" if not has_patch else ("No run ID - re-run Agent Autofix" if not _hitl_run_id else None)
                if st.button(
                    "Apply AI Fix" if has_patch else "Cannot Auto-Apply",
                    key=f"approve_{idx}_{issue_id}",
                    type="primary",
                    disabled=apply_disabled,
                    help=apply_help,
                ):
                    with st.spinner(f"Applying AI fix for {issue_id}..."):
                        apply_res = APIClient.apply_hitl_suggestion(_hitl_run_id, issue_id)
                    if not apply_res.get("ok"):
                        st.error(f"Apply failed: {apply_res.get('error')}")
                    else:
                        new_epub = apply_res.get("epub_bytes")
                        if new_epub:
                            st.session_state.last_fixed_epub_bytes = new_epub
                        st.session_state.hitl_suggestions.pop(issue_id, None)
                        st.session_state.hitl_queue = [
                            i for i in st.session_state.hitl_queue if i.get("id") != issue_id
                        ]
                        st.success(f"Fix applied for **{issue_id}**. Download updated EPUB from the Autofix tab.")
                        st.rerun()

            with col_manual:
                if st.button(
                    "Keep for Manual Review",
                    key=f"reject_{idx}_{issue_id}",
                ):
                    st.session_state.hitl_suggestions.pop(issue_id, None)
                    iss["manual_review"] = True
                    st.session_state.hitl_queue = [
                        i for i in st.session_state.hitl_queue if i.get("id") != issue_id
                    ]
                    st.info(f"**{issue_id}** moved to manual resolution list.")
                    st.rerun()

# ===========================================================================
# TAB 6 - Diff Viewer
# ===========================================================================

def _build_diff_html(file_diff: dict, existing_decisions: dict = None) -> str:
    """Build a self-contained side-by-side diff viewer HTML for a SINGLE file."""
    import json as _json
    diff_json = _json.dumps(file_diff, ensure_ascii=False)
    decisions_json = _json.dumps(existing_decisions or {})
    return f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: 'Consolas','Courier New',monospace; font-size:12.5px;
         background:#F0F4F7; color:#1A2835; height:100vh; display:flex; flex-direction:column; }}

  /* -- Split panels --------------------------------------- */
  #splitView {{ display:flex; flex:1; overflow:hidden; gap:0; }}
  .panel {{ flex:1; display:flex; flex-direction:column; overflow:hidden; }}
  .panel-header {{ background:#0D3D4F; color:#fff; padding:7px 14px;
                  font-size:11.5px; font-weight:700; letter-spacing:.4px;
                  position:sticky; top:0; z-index:5; border-bottom:1px solid #26C5D9; }}
  .panel-body {{ flex:1; overflow-y:auto; overflow-x:auto; }}
  #leftPanel  {{ border-right:2px solid #26C5D9; }}

  /* -- Diff lines ----------------------------------------- */
  .dl {{ display:flex; min-height:19px; line-height:19px; }}
  .ln {{ min-width:38px; padding:0 8px; text-align:right; color:#7A9AAA;
         border-right:1px solid #D4E4EC; user-select:none; flex-shrink:0; }}
  .lc {{ flex:1; padding:0 10px; white-space:pre; overflow:hidden;
         text-overflow:ellipsis; }}
  .dl.eq   {{ background:#FAFCFD; }}
  .dl.chg  {{ background:#FFF3C4 !important; cursor:context-menu; }}
  .dl.chg:hover {{ background:#FFE082 !important; }}
  .dl.ins  {{ background:#E8F5E9; }}
  .dl.del  {{ background:#FFEBEE; }}
  /* accepted / review states set by JS */
  .dl.decided-accept {{ background:#C8E6C9 !important; }}
  .dl.decided-review {{ background:#FFE0B2 !important; }}

  /* -- Legend --------------------------------------------- */
  #legend {{ display:flex; gap:14px; padding:6px 14px; background:#F0F4F7;
            border-top:1px solid #D4E4EC; font-size:11px; align-items:center; }}
  .leg {{ display:flex; align-items:center; gap:5px; }}
  .leg-dot {{ width:14px; height:14px; border-radius:3px; }}

  /* -- Context menu --------------------------------------- */
  #ctxMenu {{ display:none; position:fixed; background:#fff; border:1px solid #D4E4EC;
             border-radius:8px; box-shadow:0 4px 20px rgba(0,0,0,.15);
             z-index:9999; min-width:210px; overflow:hidden; }}
  #ctxMenu.vis {{ display:block; }}
  .cm-title {{ padding:8px 14px 4px; font-size:10px; font-weight:700;
              color:#7A9AAA; text-transform:uppercase; letter-spacing:.5px;
              border-bottom:1px solid #eee; background:#F8FAFB; }}
  .cm-item {{ padding:10px 16px; cursor:pointer; font-size:12.5px;
             display:flex; align-items:center; gap:10px; transition:background .1s; }}
  .cm-item:hover {{ background:#F0F4F7; }}
  .cm-accept {{ color:#28a745; font-weight:600; }}
  .cm-review {{ color:#E8954A; font-weight:600; }}
  .cm-sep {{ border-top:1px solid #eee; margin:3px 0; }}
  .cm-close {{ color:#7A9AAA; font-size:12px; }}

  /* -- Decision summary bar ------------------------------- */
  #decisionBar {{ display:none; padding:8px 14px; background:#E8F5E9;
                border-top:2px solid #28a745; font-size:12px; font-weight:600;
                color:#1A5C2A; }}
</style>
</head>
<body>
<div id="splitView">
  <div class="panel" id="leftPanel">
    <div class="panel-header"> &nbsp;ORIGINAL</div>
    <div class="panel-body" id="leftBody"></div>
  </div>
  <div class="panel" id="rightPanel">
    <div class="panel-header">FIXED</div>
    <div class="panel-body" id="rightBody"></div>
  </div>
</div>

<div id="legend">
  <strong style="color:#0A2A35">Legend:</strong>
  <div class="leg"><div class="leg-dot" style="background:#FFF3C4;border:1px solid #F5A623"></div> Changed - right-click to decide</div>
  <div class="leg"><div class="leg-dot" style="background:#C8E6C9;border:1px solid #28a745"></div> Accepted</div>
  <div class="leg"><div class="leg-dot" style="background:#FFE0B2;border:1px solid #E8954A"></div> For review</div>
  <div class="leg"><div class="leg-dot" style="background:#E8F5E9;border:1px solid #81C784"></div> Added</div>
  <div class="leg"><div class="leg-dot" style="background:#FFEBEE;border:1px solid #E57373"></div> Removed</div>
  <div id="decisionBar" style="display:none;margin-left:auto;font-weight:600;color:#1A5C2A;"></div>
</div>

<div id="ctxMenu">
  <div class="cm-title">Line <span id="ctxLine">-</span></div>
  <div class="cm-item cm-accept" onclick="acceptFix()">Accept AI Fix</div>
  <div class="cm-item cm-review" onclick="reviewManually()">Review Manually</div>
  <div class="cm-item cm-clear" onclick="clearDecision()">Clear Decision</div>
  <div class="cm-sep"></div>
  <div class="cm-item cm-close" onclick="closeMenu()">x &nbsp;Cancel</div>
</div>

<script>
const DIFF = {diff_json};
const FILE = DIFF.file || '';
let currentHunkIdx = null;
const allDecisions = {decisions_json};
const decisions = allDecisions[FILE] || {{}};   // hunkIdx -> 'accept'|'review'

function init() {{
  const lb = document.getElementById('leftBody');
  const rb = document.getElementById('rightBody');
  lb.innerHTML = '';
  rb.innerHTML = '';
  let ll = 1, rl = 1;

  (DIFF.hunks || []).forEach((hunk, hi) => {{
    const tag = hunk.tag || 'equal';
    const bText = hunk.before || '';
    const aText = hunk.after  || '';
    const bRows = bText === '' ? [''] : bText.split('\\n');
    const aRows = aText === '' ? [''] : aText.split('\\n');

    if (tag === 'equal') {{
      // Collapse long equal sections - show first 3, collapse, show last 3
      if (bRows.length > 8) {{
        for (let r = 0; r < 3; r++) {{
          lb.appendChild(mkLine(ll++, bRows[r] || '', 'eq'));
          rb.appendChild(mkLine(rl++, aRows[r] || '', 'eq'));
        }}
        const skip = bRows.length - 6;
        lb.appendChild(mkCollapse(skip, hi, 'left',  bRows, aRows, ll, rl));
        rb.appendChild(mkCollapse(skip, hi, 'right', bRows, aRows, ll, rl));
        ll += skip; rl += skip;
        for (let r = bRows.length - 3; r < bRows.length; r++) {{
          lb.appendChild(mkLine(ll++, bRows[r] || '', 'eq'));
          rb.appendChild(mkLine(rl++, aRows[r] || '', 'eq'));
        }}
      }} else {{
        bRows.forEach((t, r) => {{ lb.appendChild(mkLine(ll++, t, 'eq')); rb.appendChild(mkLine(rl++, aRows[r]||'', 'eq')); }});
      }}
    }} else if (tag === 'replace') {{
      // Align rows: pad shorter side with empty lines
      const maxR = Math.max(bRows.length, aRows.length);
      for (let r = 0; r < maxR; r++) {{
        lb.appendChild(mkChgLine(ll++, bRows[r] !== undefined ? bRows[r] : '', hi, 'chg'));
        rb.appendChild(mkChgLine(rl++, aRows[r] !== undefined ? aRows[r] : '', hi, 'chg'));
      }}
    }} else if (tag === 'delete') {{
      // Lines removed from original - right panel shows blank placeholders with no line number
      bRows.forEach(t => {{ lb.appendChild(mkChgLine(ll++, t, hi, 'del')); rb.appendChild(mkLine('', '', 'eq')); }});
    }} else if (tag === 'insert') {{
      // Lines added in fixed - left panel shows blank placeholders with no line number
      aRows.forEach(t => {{ lb.appendChild(mkLine('', '', 'eq')); rb.appendChild(mkChgLine(rl++, t, hi, 'ins')); }});
    }}
  }});

  // Sync scroll - use a timer to break potential feedback loops
  const lp = document.querySelector('#leftPanel .panel-body');
  const rp = document.querySelector('#rightPanel .panel-body');
  let _syncLock = null;
  lp.addEventListener('scroll', () => {{
    if (_syncLock) return;
    _syncLock = setTimeout(() => {{ _syncLock = null; }}, 50);
    rp.scrollTop = lp.scrollTop;
  }});
  rp.addEventListener('scroll', () => {{
    if (_syncLock) return;
    _syncLock = setTimeout(() => {{ _syncLock = null; }}, 50);
    lp.scrollTop = rp.scrollTop;
  }});

  // Scroll to first change
  const first = lb.querySelector('.chg,.ins,.del');
  if (first) first.scrollIntoView({{block:'center'}});
}}

function mkLine(num, text, cls) {{
  const d = document.createElement('div');
  d.className = 'dl ' + cls;
  const n = document.createElement('span'); n.className='ln'; n.textContent=num||'';
  const c = document.createElement('span'); c.className='lc'; c.textContent=text;
  d.appendChild(n); d.appendChild(c);
  return d;
}}

function mkChgLine(num, text, hi, cls) {{
  const d = mkLine(num, text, cls);
  d.dataset.hunk = hi;
  if (cls === 'chg') {{
    d.addEventListener('contextmenu', e => showMenu(e, hi, num));
  }}
  return d;
}}

function mkCollapse(count, hi, side, bRows, aRows, startL, startR) {{
  const d = document.createElement('div');
  d.className = 'dl collapse-row';
  d.style.cssText = 'background:#E8F4F8;color:#1A8A9A;cursor:pointer;justify-content:center;font-style:italic;font-size:11px;padding:3px 0;';
  d.textContent = '... ' + count + ' unchanged lines - click to expand ...';
  d.onclick = function() {{
    const parent = this.parentNode;
    const rows = side==='left' ? bRows : aRows;
    const insertBefore = this.nextSibling;
    let ln = side==='left' ? startL : startR;
    rows.slice(3, rows.length-3).forEach(t => {{
      const el = mkLine(ln++, t, 'eq');
      parent.insertBefore(el, insertBefore);
    }});
    parent.removeChild(this);
  }};
  return d;
}}

// -- Context menu -----------------------------------------------
function showMenu(e, hi, lineNum) {{
  e.preventDefault();
  currentHunkIdx = hi;
  document.getElementById('ctxLine').textContent = lineNum;
  const menu = document.getElementById('ctxMenu');
  menu.style.left = Math.min(e.clientX, window.innerWidth-220) + 'px';
  menu.style.top  = Math.min(e.clientY, window.innerHeight-130) + 'px';
  menu.classList.add('vis');
}}
function closeMenu() {{ document.getElementById('ctxMenu').classList.remove('vis'); }}

function acceptFix() {{
  if (currentHunkIdx === null) return;
  decisions[currentHunkIdx] = 'accept';
  applyStyles(); closeMenu(); updateBar(); sendUp();
}}
function reviewManually() {{
  if (currentHunkIdx === null) return;
  decisions[currentHunkIdx] = 'review';
  applyStyles(); closeMenu(); updateBar(); sendUp();
}}

function clearDecision() {{
  if (currentHunkIdx === null) return;
  delete decisions[currentHunkIdx];
  applyStyles(); closeMenu(); updateBar(); sendUp();
}}

function applyStyles() {{
  document.querySelectorAll('[data-hunk]').forEach(el => {{
    const hi = parseInt(el.dataset.hunk);
    el.classList.remove('decided-accept','decided-review');
    if (decisions[hi]==='accept') el.classList.add('decided-accept');
    if (decisions[hi]==='review') el.classList.add('decided-review');
  }});
}}

function updateBar() {{
  const a = Object.values(decisions).filter(v=>v==='accept').length;
  const r = Object.values(decisions).filter(v=>v==='review').length;
  const bar = document.getElementById('decisionBar');
  if (!a && !r) {{ bar.style.display='none'; return; }}
  bar.style.display='block';
  bar.textContent = (a ? 'OK '+a+' accepted' : '') + (a&&r ? '  |  ' : '') + (r ? ' '+r+' for review' : '');
}}

function sendUp() {{
  try {{ window.parent.postMessage({{type:'streamlit:setComponentValue', value:{{[FILE]: decisions}}}}, '*'); }} catch(e) {{}}
}}

document.addEventListener('click', e => {{ if (!document.getElementById('ctxMenu').contains(e.target)) closeMenu(); }});
init();
</script>
</body>
</html>"""


def _build_all_epub_diffs(orig_path: str, fixed_bytes: bytes) -> list:
    """Extract ALL text files from both EPUBs and compute full line-level diffs."""
    import zipfile, difflib as _dl, io as _io

    TEXT_EXTS = {'.xhtml', '.html', '.htm', '.css', '.opf', '.ncx', '.xml', '.js', '.txt'}
    orig_contents, fixed_contents, all_files = {}, {}, []

    try:
        with zipfile.ZipFile(orig_path, "r") as z:
            for name in sorted(z.namelist()):
                if name.endswith('/'):
                    continue
                if os.path.splitext(name.lower())[1] in TEXT_EXTS:
                    all_files.append(name)
                    try:
                        orig_contents[name] = z.read(name).decode("utf-8", errors="replace")
                    except Exception:
                        orig_contents[name] = ""
    except Exception:
        pass

    try:
        with zipfile.ZipFile(_io.BytesIO(fixed_bytes), "r") as z:
            for name in z.namelist():
                if name.endswith('/'):
                    continue
                if os.path.splitext(name.lower())[1] in TEXT_EXTS:
                    if name not in orig_contents:
                        all_files.append(name)
                    try:
                        fixed_contents[name] = z.read(name).decode("utf-8", errors="replace")
                    except Exception:
                        fixed_contents[name] = orig_contents.get(name, "")
    except Exception:
        pass

    result = []
    for fname in all_files:
        before_text = orig_contents.get(fname, "")
        after_text  = fixed_contents.get(fname, before_text)
        b_lines     = before_text.splitlines()
        a_lines     = after_text.splitlines()
        changed     = b_lines != a_lines

        if not changed:
            result.append({
                "file": fname, "changed": False,
                "hunks": [{"tag": "equal",
                           "before": before_text, "after": after_text,
                           "before_lines": [1, len(b_lines)],
                           "after_lines":  [1, len(a_lines)]}]
            })
        else:
            sm = _dl.SequenceMatcher(None, b_lines, a_lines, autojunk=False)
            hunks = []
            for tag, i1, i2, j1, j2 in sm.get_opcodes():
                hunks.append({
                    "tag": tag,
                    "before_lines": [i1 + 1, i2],
                    "after_lines":  [j1 + 1, j2],
                    "before": "\n".join(b_lines[i1:i2]),
                    "after":  "\n".join(a_lines[j1:j2]),
                })
            result.append({"file": fname, "changed": True, "hunks": hunks})

    return result


with tab_diff:
    import streamlit.components.v1 as _stcomponents

    st.title("Diff Viewer - Original vs Fixed")

    orig_path   = st.session_state.get("uploaded_file_path", "")
    fixed_bytes = st.session_state.get("last_fixed_epub_bytes")

    if not orig_path:
        st.info("Upload an EPUB first (**Upload & Validate** tab), then run **Auto Fix EPUB**.")
    elif not fixed_bytes:
        st.info("Run **Fix & Automate -> Auto Fix EPUB** first, then return here.")
        if orig_path:
            st.caption(f"Uploaded file: `{os.path.basename(orig_path)}`  - waiting for fixed EPUB.")
    elif not os.path.exists(orig_path):
        st.error(
            f"Original EPUB no longer on disk: `{os.path.basename(orig_path)}`.  "
            "Re-upload the file in the **Upload & Validate** tab."
        )
    else:
        # -- Cache diffs so switching files doesn't re-extract the EPUBs --
        _cache_key = f"{os.path.basename(orig_path)}:{len(fixed_bytes)}"
        if st.session_state.get("_diff_cache_key") != _cache_key:
            with st.spinner("Extracting all EPUB files and computing diffs..."):
                _all_diffs = _build_all_epub_diffs(orig_path, fixed_bytes)
            st.session_state["_all_diffs"]       = _all_diffs
            st.session_state["_diff_cache_key"]  = _cache_key
        else:
            _all_diffs = st.session_state.get("_all_diffs", [])

        _changed = [d for d in _all_diffs if d["changed"]]
        _total   = len(_all_diffs)

        # -- Layout: narrow file navigator | wide diff viewer -------------
        nav_col, view_col = st.columns([1, 4], gap="medium")

        with nav_col:
            st.markdown(
                f"**EPUB Files** &nbsp; "
                f'<span style="background:#FFF3C4;border:1px solid #F5A623;'
                f'border-radius:10px;padding:1px 8px;font-size:12px;font-weight:600;">'
                f'🟡 {len(_changed)} changed</span> &nbsp; '
                f'<span style="background:#F4F6F8;border:1px solid #aaa;'
                f'border-radius:10px;padding:1px 8px;font-size:12px;">'
                f' {_total - len(_changed)} unchanged</span>',
                unsafe_allow_html=True,
            )
            st.markdown("")

            # Default to first changed file, or first file if none changed
            _default_idx = next(
                (i for i, d in enumerate(_all_diffs) if d["changed"]), 0
            )
            _file_options = [d["file"] for d in _all_diffs]
            _file_labels  = {
                d["file"]: ("🟡 " if d["changed"] else "") + d["file"].split("/")[-1]
                for d in _all_diffs
            }
            _selected_file = st.radio(
                "select_file",
                options=_file_options,
                format_func=lambda f: _file_labels.get(f, f.split("/")[-1]),
                index=_default_idx,
                key="diff_nav_radio",
                label_visibility="collapsed",
            )

        with view_col:
            _sel_diff = next((d for d in _all_diffs if d["file"] == _selected_file), None)
            if _sel_diff:
                _status_badge = (
                    '<span style="background:#FFF3C4;border:1px solid #F5A623;'
                    'border-radius:8px;padding:2px 10px;font-size:12px;font-weight:700;">🟡 CHANGED</span>'
                    if _sel_diff["changed"] else
                    '<span style="background:#F4F6F8;border:1px solid #aaa;'
                    'border-radius:8px;padding:2px 10px;font-size:12px;">UNCHANGED</span>'
                )
                st.markdown(
                    f'<b>{_selected_file}</b> &nbsp; {_status_badge}',
                    unsafe_allow_html=True,
                )
                if not _sel_diff["changed"]:
                    st.caption("This file was not modified by the AI fixer.")

                st.markdown(
                    '<span style="font-size:12px;color:#666;">'
                    "Right-click any changed line -> Accept AI Fix &nbsp;|&nbsp; Review Manually"
                    "</span>",
                    unsafe_allow_html=True,
                )

                _diff_html = _build_diff_html(_sel_diff, st.session_state.get("_diff_decisions", {}))
                _decisions = _stcomponents.html(_diff_html, height=680, scrolling=False)

                if isinstance(_decisions, dict):
                    existing_decisions = st.session_state.get("_diff_decisions", {}) or {}
                    if _decisions and all(isinstance(v, dict) for v in _decisions.values()):
                        _all_dec = {**existing_decisions, **_decisions}
                    else:
                        _all_dec = {**existing_decisions, _selected_file: _decisions}

                    current_decisions = _all_dec.get(_selected_file, {})
                    _n_accept = sum(1 for v in current_decisions.values() if v == "accept")
                    _n_review = sum(1 for v in current_decisions.values() if v == "review")

                    if not current_decisions:
                        _all_dec.pop(_selected_file, None)

                    st.session_state["_diff_decisions"] = _all_dec
                    review_files = set(st.session_state.get("diff_manual_review_files", []))
                    if _n_review:
                        review_files.add(_selected_file)
                    else:
                        review_files.discard(_selected_file)
                    st.session_state.diff_manual_review_files = list(review_files)

                    if _n_accept or _n_review:
                        _ca, _cr = st.columns(2)
                        _ca.success(f"OK {_n_accept} hunk(s) accepted")
                        _cr.warning(f"review {_n_review} hunk(s) marked for review")

# ===========================================================================
# TAB 7 - History
# ===========================================================================
with tab_history:
    st.title("Run History")

    try:
        textbooks = APIClient.get_textbooks()
    except Exception:
        textbooks = []

    if not textbooks:
        st.info("No history yet. Run a validation to generate history.")
    else:
        tb_names    = [t.get("name", str(t.get("id"))) for t in textbooks]
        selected_tb = st.selectbox("Select Textbook", tb_names, key="history_tb")
        tb_obj      = next(t for t in textbooks if t.get("name", str(t.get("id"))) == selected_tb)
        tb_id       = tb_obj.get("id")

        try:
            history = APIClient.get_history(tb_id)
        except Exception:
            history = []

        if not history:
            st.info("No history found for this textbook.")
        else:
            st.dataframe(pd.DataFrame(history), use_container_width=True, hide_index=True)

            if len(history) >= 2:
                st.markdown("### Trend - Last Run vs Previous")
                last = history[-1]
                prev = history[-2]
                for col, metric in zip(st.columns(3), ["totalIssues", "criticalIssues", "fixesApplied"]):
                    lv = last.get(metric, 0)
                    pv = prev.get(metric, 0)
                    delta = lv - pv if isinstance(lv, (int, float)) else None
                    col.metric(metric, lv, delta,
                               delta_color="inverse" if metric in ("totalIssues","criticalIssues") else "normal")
            else:
                st.info("Need at least two runs to show trend.")

