"""JSFixerAgent — specialized for JavaScript issues in EPUB files."""
import re
from agents.domain_fixer_base import DomainFixerBase

# All JS validation rules this agent handles
DOMAIN_RULES = {
    # Reference / path issues (deterministic fixes)
    "JS_SCRIPT_REFERENCE_BROKEN",
    "JS_EXTERNAL_SCRIPT_MISSING",
    "JS_SCRIPT_REFERENCE_MISSING_MANIFEST",
    # Inline / structural issues (LLM fixes)
    "JS_INLINE_SCRIPT",
    "JS_EVENT_HANDLER_ATTRIBUTE",
    "JS_MODULE_SCRIPT",
    # Code quality issues (LLM fixes)
    "JS_SCRIPT_SYNTAX",
    "JS_UNSUPPORTED_API",
    "JS_SCRIPT_MANIFEST_MISSING_FILE",
}

_SYSTEM_PROMPT = """You are a JavaScript/EPUB compatibility specialist. Fix JS issues so EPUBs work across all reading systems.

═══ OUTPUT RULES ═══
- Output ONLY the raw fix value inside <fix>...</fix> tags. No explanations.
- ALWAYS output a best-effort fix. CANNOT_FIX is a last resort only.

═══ JS_SCRIPT_REFERENCE_BROKEN — Broken script src path ═══
Output ONLY the corrected relative path from the HTML file to the JS file.
Example: ../js/script.js or js/main.js
Use forward slashes. Derive from EPUB structure shown in context.

═══ JS_SCRIPT_REFERENCE_MISSING_MANIFEST — Script missing from OPF manifest ═══
Output the correct manifest item XML to add:
<fix><item id="script-main" href="js/main.js" media-type="application/javascript"/></fix>

═══ JS_INLINE_SCRIPT — Inline <script> block ═══
Output the suggested external filename to move the script to:
<fix>js/interactions.js</fix>

═══ JS_EVENT_HANDLER_ATTRIBUTE — Inline onclick/onload etc. ═══
Convert inline handler to addEventListener pattern:
Input:  onclick="doSomething()"
Output: <fix>element.addEventListener('click', function() { doSomething(); });</fix>
Generic safe default: <fix>// Move handler to external JS: element.addEventListener('click', handler);</fix>

═══ JS_MODULE_SCRIPT — type="module" not portable ═══
Convert to IIFE/classic script pattern:
<fix>(function() { /* module contents wrapped in IIFE */ })();</fix>
Or suggest removing type="module": <fix>/* Remove type="module" — wrap code in IIFE instead */</fix>

═══ JS_SCRIPT_SYNTAX — JavaScript syntax error ═══
Fix the syntax error shown. Common patterns:
- Missing semicolon: add ;
- Unclosed brace: add }
- Unclosed string: close with matching quote
Output only the corrected code snippet, not the full file.

═══ JS_UNSUPPORTED_API — Unsafe API for EPUB reading systems ═══
Replace with EPUB-safe equivalent:
fetch() / XMLHttpRequest  → <fix>/* Network access not available in EPUB — remove or use EPUB spine data */</fix>
localStorage              → <fix>/* localStorage may not persist in EPUB — use in-memory variable or omit */</fix>
sessionStorage            → <fix>/* Use in-memory variable instead: var sessionData = {}; */</fix>
eval() / new Function()   → <fix>/* Remove eval() — execute logic directly */</fix>
WebSocket                 → <fix>/* WebSocket not available in EPUB reading systems — remove */</fix>
document.write()          → <fix>document.getElementById('target').innerHTML = content;</fix>
window.open()             → <fix>/* External links not supported — use internal anchor links */</fix>
import()                  → <fix>/* Dynamic import() not supported — bundle scripts statically */</fix>

═══ JS_SCRIPT_MANIFEST_MISSING_FILE — Manifest references missing file ═══
Output the OPF manifest item to remove (just the id):
<fix>REMOVE_MANIFEST_ITEM:script-broken-id</fix>

═══ GROUNDING ═══
If EPUB file content is shown, derive paths from actual file locations shown.
If inline code is shown, fix the exact issue in that code."""


class JSFixerAgent(DomainFixerBase):
    agent_id        = "js_fixer_agent"
    system_prompt   = _SYSTEM_PROMPT
    kb_collections  = ["kb_js", "epub_rules"]
    score_threshold = 0.30
    default_policies = {
        "task_type":          "codegen",
        "temperature":        0.1,
        "max_context_chunks": 6,
    }

    def _validate_patch(self, patch: str, issue_id: str) -> str:
        if not patch or patch.upper() in ("CANNOT_FIX", "NONE", ""):
            return patch

        # Path-only rules: reject HTML/prose
        if issue_id in ("JS_SCRIPT_REFERENCE_BROKEN", "JS_EXTERNAL_SCRIPT_MISSING"):
            if "<" in patch or "\n" in patch or len(patch.split()) > 8:
                print(f"[js_fixer] {issue_id} path patch looks like HTML — CANNOT_FIX")
                return "CANNOT_FIX"
            return patch.replace("\\", "/").strip()

        # Manifest item: must be XML <item .../> or REMOVE_MANIFEST_ITEM
        if issue_id == "JS_SCRIPT_REFERENCE_MISSING_MANIFEST":
            if not ("<item" in patch or "REMOVE_MANIFEST_ITEM" in patch):
                return "CANNOT_FIX"
            return patch.strip()

        # Filename rule: reject anything with spaces or HTML
        if issue_id == "JS_INLINE_SCRIPT":
            if "<" in patch or " " in patch.strip():
                return "CANNOT_FIX"
            return patch.replace("\\", "/").strip()

        return patch.strip()
