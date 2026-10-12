"""
EPUB JavaScript Research — Comprehensive Issue Catalog

Research sources:
  - EPUB3 Specification (IDPF / W3C)
  - EPUB3 Scripting Guide
  - Reading System Compatibility Matrix (epubtest.org)
  - Accessibility in EPUB (DAISY Consortium)
  - EPUB Content Conformance Guidelines

This module is the authoritative reference for JS issues in EPUB files.
Used by the JSFixerAgent KB and the evaluation framework.
"""

EPUB_JS_RESEARCH = {

    # ──────────────────────────────────────────────────────────────────────────
    # Category 1: Script References & Packaging
    # ──────────────────────────────────────────────────────────────────────────

    "JS_SCRIPT_REFERENCE_BROKEN": {
        "title": "Broken script reference",
        "severity": "critical",
        "description": (
            "A <script src='...'> tag references a file that does not exist "
            "inside the EPUB ZIP container. The reading system will silently "
            "ignore the script or throw a console error, causing interactive "
            "features to fail entirely."
        ),
        "epub_spec_ref": "EPUB3 §3.4.7 — Scripted Content Documents",
        "reading_system_behavior": {
            "apple_books": "Silent fail — script not loaded",
            "adobe_digital_editions": "Silent fail",
            "kobo": "Console error, script ignored",
            "kindle": "Not applicable (JS disabled by default)",
        },
        "fix_strategy": "deterministic",
        "fix_description": "Compute the correct relative path from the HTML file to the JS file within the EPUB structure.",
        "fix_example": {
            "broken": "<script src='../../missing/script.js'></script>",
            "fixed": "<script src='../js/script.js'></script>",
        },
        "autofix_feasibility": "high",
        "manual_review_required": False,
    },

    "JS_EXTERNAL_SCRIPT_MISSING": {
        "title": "External script file not found in EPUB",
        "severity": "critical",
        "description": (
            "A script file is referenced in HTML but the actual .js file is "
            "missing from the EPUB ZIP container. This is distinct from a "
            "broken relative path — the file simply does not exist."
        ),
        "epub_spec_ref": "EPUB3 §3.4.7",
        "fix_strategy": "deterministic",
        "fix_description": "Search for the file with a different path or flag for manual addition.",
        "autofix_feasibility": "medium",
        "manual_review_required": True,
    },

    "JS_SCRIPT_REFERENCE_MISSING_MANIFEST": {
        "title": "Script not declared in OPF manifest",
        "severity": "high",
        "description": (
            "A JavaScript file is referenced in HTML content but is not declared "
            "as an item in the EPUB OPF manifest. Per the EPUB3 spec, all resources "
            "used by a Publication must be listed in the manifest. Reading systems "
            "may block or refuse to load unlisted resources."
        ),
        "epub_spec_ref": "EPUB3 Package Document §3.4 — Manifest",
        "reading_system_behavior": {
            "apple_books": "Script may be blocked",
            "adobe_digital_editions": "Script not loaded",
            "kobo": "Behavior undefined — may work or not",
        },
        "fix_strategy": "llm",
        "fix_description": "Generate the correct OPF manifest <item> XML for the script file.",
        "fix_example": {
            "add_to_manifest": '<item id="script-interactions" href="js/interactions.js" media-type="application/javascript"/>',
        },
        "autofix_feasibility": "high",
        "manual_review_required": False,
    },

    "JS_SCRIPT_MANIFEST_MISSING_FILE": {
        "title": "Manifest lists script that doesn't exist",
        "severity": "high",
        "description": (
            "The OPF manifest declares a <item media-type='application/javascript'> "
            "entry pointing to a file that does not exist in the EPUB ZIP container. "
            "This causes validation failures and may confuse reading systems."
        ),
        "fix_strategy": "deterministic",
        "fix_description": "Remove the orphaned manifest entry.",
        "autofix_feasibility": "high",
        "manual_review_required": False,
    },

    # ──────────────────────────────────────────────────────────────────────────
    # Category 2: Script Syntax & Code Quality
    # ──────────────────────────────────────────────────────────────────────────

    "JS_SCRIPT_SYNTAX": {
        "title": "JavaScript syntax error",
        "severity": "critical",
        "description": (
            "The JavaScript file or inline script block contains a syntax error "
            "that prevents the script from being parsed and executed. Common "
            "causes: missing semicolons, unclosed braces/parentheses, invalid "
            "template literals, or use of reserved keywords as identifiers."
        ),
        "detection_method": "Node.js vm.Script() parser",
        "reading_system_behavior": {
            "all": "Script execution halted at parse error — all features fail",
        },
        "fix_strategy": "llm",
        "fix_description": "LLM identifies and corrects the syntax error in the code snippet.",
        "common_errors": [
            "Missing closing brace }",
            "Unclosed string literal",
            "Unexpected token (e.g., comma in wrong position)",
            "Use of reserved words as variable names",
            "Missing semicolons in strict contexts",
        ],
        "autofix_feasibility": "medium",
        "manual_review_required": True,
        "note": "LLM should fix only the reported error location, not rewrite the script.",
    },

    # ──────────────────────────────────────────────────────────────────────────
    # Category 3: Unsupported Browser APIs
    # ──────────────────────────────────────────────────────────────────────────

    "JS_UNSUPPORTED_API": {
        "title": "JavaScript uses unsupported reading system APIs",
        "severity": "high",
        "description": (
            "The script uses browser APIs that are not available or are blocked "
            "in EPUB reading system sandboxes. EPUB3 scripting operates in a "
            "highly restricted environment — reading systems sandbox content "
            "documents and block APIs that could access the network, filesystem, "
            "or cross-origin resources."
        ),
        "epub_spec_ref": "EPUB3 §3.4.7.3 — Scripted Content Documents, Security",
        "unsupported_apis": {
            "fetch() / XMLHttpRequest": {
                "reason": "Network access is sandboxed — no outbound HTTP from EPUB",
                "epubtest_result": "Blocked on all major reading systems",
                "safe_alternative": "Use EPUB spine data or local JSON files packaged in the EPUB",
            },
            "localStorage / sessionStorage": {
                "reason": "Storage may not persist across EPUB reading sessions or may be isolated per-book",
                "epubtest_result": "Inconsistent — works on some, fails on others",
                "safe_alternative": "Use in-memory variables; accept data loss between sessions",
            },
            "indexedDB": {
                "reason": "Full database access not guaranteed in EPUB sandboxes",
                "epubtest_result": "Rarely available",
                "safe_alternative": "Avoid persistent storage; use in-memory state",
            },
            "WebSocket": {
                "reason": "Real-time network connections not available in EPUB environment",
                "epubtest_result": "Blocked universally",
                "safe_alternative": "Remove — cannot be replicated in EPUB context",
            },
            "ServiceWorker": {
                "reason": "Service Workers require a browsing context origin — not available in EPUB",
                "epubtest_result": "Not supported",
                "safe_alternative": "Remove — no equivalent in EPUB",
            },
            "SharedWorker / Worker": {
                "reason": "Background worker threads not available in EPUB reading systems",
                "epubtest_result": "Not supported on most readers",
                "safe_alternative": "Run computation synchronously or pre-compute data",
            },
            "eval() / new Function()": {
                "reason": "Blocked by Content Security Policy in hardened reading systems",
                "security_risk": "Critical — eval() allows arbitrary code execution",
                "safe_alternative": "Replace with direct function calls or JSON.parse() for data",
            },
            "document.write()": {
                "reason": "Dangerous — overwrites the entire document in modern browsers/readers",
                "epubtest_result": "Deprecated; behavior varies",
                "safe_alternative": "Use document.getElementById().innerHTML = content instead",
            },
            "window.open()": {
                "reason": "External browser navigation not supported from EPUB content",
                "epubtest_result": "Blocked by reading system",
                "safe_alternative": "Use internal EPUB navigation (spine links) instead",
            },
            "import() (dynamic)": {
                "reason": "Dynamic module imports may not work; EPUB3 spec pre-dates ES modules",
                "epubtest_result": "Poor support",
                "safe_alternative": "Bundle all scripts statically at EPUB build time",
            },
        },
        "fix_strategy": "llm",
        "autofix_feasibility": "medium",
        "manual_review_required": True,
    },

    # ──────────────────────────────────────────────────────────────────────────
    # Category 4: Script Organization
    # ──────────────────────────────────────────────────────────────────────────

    "JS_INLINE_SCRIPT": {
        "title": "Inline JavaScript requires portability review",
        "severity": "medium",
        "description": (
            "A <script> block with inline JavaScript code is present directly "
            "in the HTML. While not prohibited by EPUB3, inline scripts are "
            "harder to maintain, may conflict with Content Security Policy settings "
            "in reading systems, and reduce reusability across spine documents. "
            "Best practice is to move scripts to external packaged .js files."
        ),
        "epub_spec_ref": "EPUB3 Content Document §4.3.2",
        "reading_system_behavior": {
            "apple_books": "Works but may conflict with CSP",
            "adobe_digital_editions": "Limited — complex scripts may fail",
            "general": "Portability risk across reading systems",
        },
        "fix_strategy": "llm",
        "fix_description": "Suggest filename for external JS file; inline code should be moved there.",
        "autofix_feasibility": "medium",
        "manual_review_required": True,
        "note": "Automated fix can suggest filename; developer must perform the actual refactoring.",
    },

    "JS_EVENT_HANDLER_ATTRIBUTE": {
        "title": "Inline event handler attributes",
        "severity": "medium",
        "description": (
            "HTML elements use inline event handler attributes (onclick, onload, "
            "onkeydown, etc.). These are blocked by strict Content Security Policies "
            "that some reading systems enforce. They also mix behavior with structure, "
            "making content harder to maintain."
        ),
        "examples": [
            '<button onclick="doSomething()">Click me</button>',
            '<img src="fig.jpg" onload="adjustLayout()">',
            '<a href="#" onmouseenter="showTooltip()">...</a>',
        ],
        "fix_strategy": "llm",
        "fix_description": "Convert to addEventListener pattern in external JS file.",
        "fix_example": {
            "broken": 'onclick="doSomething()"',
            "fixed": "element.addEventListener('click', function() { doSomething(); });",
        },
        "autofix_feasibility": "medium",
        "manual_review_required": True,
    },

    "JS_MODULE_SCRIPT": {
        "title": "ES module scripts not portable across reading systems",
        "severity": "medium",
        "description": (
            "A <script type='module'> tag is used. ES modules are a modern "
            "JavaScript feature that depends on import/export syntax and browser "
            "module loading. EPUB reading systems were standardized before ES "
            "modules and many do not support them. Using type='module' will cause "
            "the script to be silently ignored on older or conservative reading systems."
        ),
        "reading_system_support": {
            "apple_books": "Partial — recent versions only",
            "adobe_digital_editions": "No",
            "kobo": "No",
            "kindle": "No (JS disabled)",
            "google_play_books": "Inconsistent",
        },
        "fix_strategy": "llm",
        "fix_description": "Wrap module contents in an IIFE and remove type='module'.",
        "fix_example": {
            "before": "<script type='module'>import { fn } from './lib.js'; fn();</script>",
            "after": "<script>(function() { /* bundled module contents */ })();</script>",
        },
        "autofix_feasibility": "low",
        "manual_review_required": True,
        "note": "True fix requires bundling the module and its dependencies.",
    },

    # ──────────────────────────────────────────────────────────────────────────
    # Category 5: Reading System Compatibility Matrix
    # ──────────────────────────────────────────────────────────────────────────

    "_READING_SYSTEM_MATRIX": {
        "apple_books": {
            "js_support": "good",
            "csp_enforced": True,
            "eval_blocked": True,
            "network_blocked": True,
            "local_storage": "partial",
            "es_modules": "partial",
            "inline_scripts": "allowed",
            "inline_handlers": "blocked_by_csp",
        },
        "adobe_digital_editions": {
            "js_support": "limited",
            "csp_enforced": False,
            "eval_blocked": False,
            "network_blocked": True,
            "local_storage": "no",
            "es_modules": "no",
            "inline_scripts": "limited",
            "inline_handlers": "sometimes",
        },
        "kobo": {
            "js_support": "moderate",
            "csp_enforced": False,
            "eval_blocked": False,
            "network_blocked": True,
            "local_storage": "yes",
            "es_modules": "no",
            "inline_scripts": "allowed",
            "inline_handlers": "allowed",
        },
        "kindle_kfx": {
            "js_support": "disabled_by_default",
            "note": "JS is entirely disabled for most content types; only specific Enhanced content types allow it",
        },
        "google_play_books": {
            "js_support": "limited",
            "csp_enforced": True,
            "eval_blocked": True,
            "network_blocked": True,
            "local_storage": "sandboxed",
            "es_modules": "no",
        },
        "readium": {
            "js_support": "good",
            "csp_enforced": True,
            "eval_blocked": True,
            "network_blocked": True,
            "local_storage": "yes",
            "es_modules": "yes",
            "note": "Reference EPUB3 reading system — most permissive and spec-compliant",
        },
        "thorium": {
            "js_support": "good",
            "csp_enforced": True,
            "eval_blocked": True,
            "network_blocked": True,
            "local_storage": "yes",
            "es_modules": "partial",
        },
    },

    # ──────────────────────────────────────────────────────────────────────────
    # Category 6: Best Practices for EPUB3 Scripting
    # ──────────────────────────────────────────────────────────────────────────

    "_EPUB3_JS_BEST_PRACTICES": {
        "use_progressive_enhancement": (
            "All interactive features must have a non-scripted fallback. "
            "Content must be readable without JavaScript — it enhances, never enables."
        ),
        "package_all_scripts": (
            "All script files must be inside the EPUB ZIP container and listed in "
            "the OPF manifest. Do not load from CDNs or external URLs."
        ),
        "use_external_scripts": (
            "Prefer external .js files over inline <script> blocks. "
            "External scripts are easier to maintain and less likely to "
            "conflict with reading system CSP."
        ),
        "avoid_dom_polling": (
            "Avoid setInterval() and setTimeout() for DOM polling. "
            "Use event listeners instead (DOMContentLoaded, pageshow)."
        ),
        "use_epub_events": (
            "Use EPUB spine navigation events rather than browser history API. "
            "Listen for 'epub:readingSystemInfo' and epub-specific events."
        ),
        "test_on_target_readers": (
            "Test on the specific reading systems your users will use. "
            "JS support varies wildly — epubtest.org provides compatibility data."
        ),
        "scripted_content_document_property": (
            "Add 'scripted' to the epub:type or properties attribute of any "
            "<spine> itemref whose content document contains scripting. "
            "This allows reading systems to make informed decisions."
        ),
        "iife_pattern": (
            "Wrap all script code in an IIFE (Immediately Invoked Function Expression) "
            "to avoid polluting the global scope shared across spine documents. "
            "Example: (function() { /* your code */ })();"
        ),
    },
}


def get_issue_details(rule_id: str) -> dict:
    """Return research details for a given JS rule ID."""
    return EPUB_JS_RESEARCH.get(rule_id, {})


def get_reading_system_support(api_name: str, reading_system: str) -> str:
    """Check if an API is supported in a given reading system."""
    matrix = EPUB_JS_RESEARCH.get("_READING_SYSTEM_MATRIX", {})
    rs = matrix.get(reading_system.lower().replace(" ", "_"), {})
    return rs.get("js_support", "unknown")


def get_safe_alternative(api_name: str) -> str:
    """Get the EPUB-safe alternative for an unsupported API."""
    unsupported = EPUB_JS_RESEARCH.get("JS_UNSUPPORTED_API", {}).get("unsupported_apis", {})
    for key, info in unsupported.items():
        if api_name.lower() in key.lower():
            return info.get("safe_alternative", "No safe alternative — remove this API usage.")
    return "Unknown API — check EPUB3 scripting specification."


def get_all_rule_ids() -> list:
    """Return all JS rule IDs (excludes internal _ keys)."""
    return [k for k in EPUB_JS_RESEARCH.keys() if not k.startswith("_")]


if __name__ == "__main__":
    print("EPUB JS Issue Catalog")
    print("=" * 50)
    for rule_id in get_all_rule_ids():
        issue = EPUB_JS_RESEARCH[rule_id]
        print(f"\n{rule_id}")
        print(f"  Title:    {issue.get('title')}")
        print(f"  Severity: {issue.get('severity')}")
        print(f"  Fix:      {issue.get('fix_strategy')} (feasibility: {issue.get('autofix_feasibility')})")
