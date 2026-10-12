"""CSSFixerAgent — specialized for CSS/layout/font/responsive EPUB issues."""
import re
from agents.domain_fixer_base import DomainFixerBase

# All CSS/layout rules this agent handles
DOMAIN_RULES = {
    # Core CSS fixes
    "L_CSS_SYNTAX", "L_CSS_REFERENCE_MISSING", "L_CSS_REFERENCE_BROKEN",
    "L_CSS_INVALID_DECLARATION", "L_CSS_CLASS_SELECTOR_MISSING",
    # Font fixes
    "L_FONT_FALLBACK", "L_FONT_VARIANTS", "L_FONT_CONSISTENCY", "L_FONT_EMBED_REFERENCE",
    # Layout / structure
    "L_HEADING_HIERARCHY", "L_HEADING_CONSISTENCY",
    "L_TABLE_RESPONSIVE", "L_TABLE_STYLING", "L_TABLE_STRUCTURE",
    "L_LIST_STYLING",
    "L_IMAGE_RENDERING",
    "L_RESPONSIVE_HORIZONTAL_SCROLL", "L_RESPONSIVE_TEXT_CLIPPING", "L_LAYOUT_OVERLAP",
    # Content spacing / styling
    "L_PARAGRAPH_SPACING", "L_BLOCKQUOTE_STYLING", "L_CODE_BLOCK_STYLING",
    "L_INLINE_STYLE_CONFLICT",
    # No-CSS
    "L_NO_CSS",
}

# Standard CSS property names — used to reject hallucinated properties
_VALID_CSS_PROPS = {
    "font-size","font-weight","font-style","font-family","font-variant",
    "line-height","letter-spacing","word-spacing","text-align","text-indent",
    "text-decoration","text-transform","text-overflow","color","background",
    "background-color","background-image","background-position","background-repeat",
    "background-size","margin","margin-top","margin-bottom","margin-left","margin-right",
    "padding","padding-top","padding-bottom","padding-left","padding-right",
    "border","border-top","border-bottom","border-left","border-right",
    "border-radius","border-collapse","border-spacing","width","height",
    "max-width","max-height","min-width","min-height","display","position",
    "top","bottom","left","right","float","clear","overflow","overflow-x","overflow-y",
    "visibility","opacity","z-index","flex","flex-direction","justify-content",
    "align-items","align-self","flex-wrap","grid","column-count","column-gap",
    "list-style","list-style-type","white-space","word-wrap","overflow-wrap",
    "word-break","page-break-before","page-break-after","page-break-inside",
    "content","counter-reset","counter-increment","cursor","outline",
    "vertical-align","table-layout","caption-side","empty-cells",
    "hyphens","writing-mode","direction","unicode-bidi",
    "-epub-hyphens","-epub-word-break","-epub-text-overflow","-epub-writing-mode",
}

# Missing-hyphen aliases — corrected deterministically without LLM
_CSS_ALIAS_MAP = {
    "fontsize":       "font-size",
    "textalign":      "text-align",
    "fontfamily":     "font-family",
    "lineheight":     "line-height",
    "textindent":     "text-indent",
    "fontweight":     "font-weight",
    "textdecoration": "text-decoration",
    "backgroundcolor":"background-color",
    "margintop":      "margin-top",
    "marginbottom":   "margin-bottom",
    "marginleft":     "margin-left",
    "marginright":    "margin-right",
    "paddingtop":     "padding-top",
    "paddingbottom":  "padding-bottom",
    "paddingleft":    "padding-left",
    "paddingright":   "padding-right",
    "bordertop":      "border-top",
    "borderbottom":   "border-bottom",
    "borderleft":     "border-left",
    "borderright":    "border-right",
}

_SYSTEM_PROMPT = """You are a CSS/EPUB layout specialist. Your ONLY job is to output the corrected CSS value.

═══ CRITICAL RULES ═══
1. Output ONLY the raw fix inside <fix>...</fix>. Nothing else. No explanations.
2. ALWAYS produce a fix. CANNOT_FIX is FORBIDDEN.
3. Fix the BROKEN DECLARATION shown — do not comment, just fix it.

═══ CSS SYNTAX / INVALID DECLARATION — fix the broken property:value pair ═══
Missing hyphens (MOST COMMON):
  fontsize: 90%          → <fix>font-size: 90%</fix>
  fontweight: bold       → <fix>font-weight: bold</fix>
  textalign: center      → <fix>text-align: center</fix>
  lineheight: 1.5        → <fix>line-height: 1.5</fix>
  fontfamily: Arial      → <fix>font-family: Arial</fix>
  textdecoration: none   → <fix>text-decoration: none</fix>
  marginleft: 1em        → <fix>margin-left: 1em</fix>
  backgroundcolor: red   → <fix>background-color: red</fix>

Unit typos:
  font-size: 12p         → <fix>font-size: 12px</fix>
  font-size: 90percen    → <fix>font-size: 90%</fix>
  border: 1p solid black → <fix>border: 1px solid black</fix>

British/alternate spellings:
  colour: red            → <fix>color: red</fix>
  grey                   → <fix>gray</fix>

Unknown vendor/epub property: output the standard CSS equivalent.

═══ CSS FONT FALLBACK MISSING (L_FONT_FALLBACK) ═══
  font-family: "Optima"  → <fix>"Optima", Times, serif</fix>
  font-family: CustomFont → <fix>CustomFont, Georgia, serif</fix>

═══ CSS FONT VARIANTS (L_FONT_VARIANTS) ═══
  Any invalid or unsupported font-variant value → safe default:
  font-variant: small-caps-extended → <fix>font-variant: normal</fix>
  font-variant: [any unknown value] → <fix>font-variant: normal</fix>
  font-variant: small-caps          → <fix>font-variant: small-caps</fix>  (keep if valid)

═══ CSS CLASS SELECTOR MISSING (L_CSS_CLASS_SELECTOR_MISSING) ═══
  Use the EXACT class name from the ★ BROKEN DECLARATION section below.
  .chapter-heading → <fix>.chapter-heading { display: block; }</fix>
  .pullquote       → <fix>.pullquote { margin: 1em 2em; font-style: italic; }</fix>
  .sidebar         → <fix>.sidebar { border-left: 3px solid #ccc; padding-left: 1em; }</fix>
  If no class name is shown, output: <fix>.missing-class { display: block; }</fix>

═══ CSS TABLE STYLING (L_TABLE_STYLING, L_TABLE_STRUCTURE) ═══
  → <fix>table { max-width: 100%; width: 100%; border-collapse: collapse; overflow-x: auto; }
td, th { padding: 0.5em; border: 1px solid #ccc; text-align: left; vertical-align: top; }</fix>

═══ CSS LIST STYLING (L_LIST_STYLING) ═══
  → <fix>ul, ol { margin: 0.5em 0; padding-left: 2em; list-style-position: outside; }
ul { list-style-type: disc; }
ol { list-style-type: decimal; }</fix>

═══ CSS RESPONSIVE (L_TABLE_RESPONSIVE, L_RESPONSIVE_HORIZONTAL_SCROLL) ═══
  → <fix>table { max-width: 100%; overflow-x: auto; display: block; }</fix>

═══ CSS PARAGRAPH SPACING (L_PARAGRAPH_SPACING) ═══
  → <fix>p { margin-top: 0.5em; margin-bottom: 0.5em; text-indent: 0; }
p + p { margin-top: 0; text-indent: 1.5em; }</fix>

═══ CSS BLOCKQUOTE STYLING (L_BLOCKQUOTE_STYLING) ═══
  → <fix>blockquote { margin: 1em 2em; padding: 0.5em 1em; border-left: 4px solid #ccc; font-style: italic; color: #555; }</fix>

═══ CSS CODE BLOCK STYLING (L_CODE_BLOCK_STYLING) ═══
  → <fix>pre, code { font-family: "Courier New", Courier, monospace; font-size: 0.9em; background-color: #f4f4f4; padding: 0.2em 0.4em; border-radius: 3px; }
pre { overflow-x: auto; padding: 1em; white-space: pre-wrap; word-wrap: break-word; }</fix>

═══ CSS INLINE STYLE CONFLICT (L_INLINE_STYLE_CONFLICT) ═══
Output ONLY the CSS rule to add/correct in the stylesheet that resolves the conflict:
  If inline style overrides class: <fix>.class-name { property: value !important; }</fix>
  Generic: <fix>/* Move inline style to class — remove style="" attribute and use: .element-class { property: value; } */</fix>

═══ CSS HEADING CONSISTENCY (L_HEADING_CONSISTENCY) ═══
  → <fix>h1, h2, h3, h4, h5, h6 { font-family: inherit; font-weight: bold; line-height: 1.3; margin-top: 1.2em; margin-bottom: 0.4em; }
h1 { font-size: 1.8em; }
h2 { font-size: 1.5em; }
h3 { font-size: 1.2em; }
h4 { font-size: 1.0em; }</fix>

═══ CSS FONT CONSISTENCY (L_FONT_CONSISTENCY) ═══
Output a unified font-family stack used consistently across the file:
  → <fix>body, p, div { font-family: "Georgia", "Times New Roman", Times, serif; }
h1, h2, h3 { font-family: "Arial", "Helvetica Neue", Helvetica, sans-serif; }</fix>

═══ CSS FONT EMBED REFERENCE (L_FONT_EMBED_REFERENCE) ═══
Fix or remove the broken @font-face src reference:
  → <fix>@font-face { font-family: 'BookFont'; src: url('../fonts/BookFont.ttf') format('truetype'); font-weight: normal; font-style: normal; }</fix>
If font file is missing: <fix>/* Remove @font-face for missing font — use system font stack instead */</fix>

═══ NO CSS (L_NO_CSS) ═══
Provide a minimal EPUB-safe base stylesheet:
  → <fix>body { font-family: serif; font-size: 1em; line-height: 1.5; margin: 1em; }
p { margin: 0.5em 0; }
h1, h2, h3 { font-weight: bold; margin: 1em 0 0.5em; }
a { color: inherit; text-decoration: underline; }</fix>

═══ GROUNDING ═══
If file content is shown, use the actual selector/property from that file.
If multiple broken declarations are shown, fix the FIRST one only."""


class CSSFixerAgent(DomainFixerBase):
    agent_id       = "css_fixer_agent"
    system_prompt  = _SYSTEM_PROMPT
    kb_collections = ["kb_css", "epub_rules"]
    score_threshold = 0.38
    default_policies = {
        "task_type":          "codegen",   # Fireworks: qwen2p5-coder-7b-instruct
        "temperature":        0.1,
        "max_context_chunks": 6,
    }

    def _validate_patch(self, patch: str, issue_id: str) -> str:
        if not patch or patch.upper() in ("CANNOT_FIX", "NONE", ""):
            return patch

        # Auto-correct alias properties deterministically (no LLM needed)
        prop_m = re.match(r"^([\w]+)\s*:", patch)
        if prop_m:
            prop_lower = prop_m.group(1).lower()
            if prop_lower in _CSS_ALIAS_MAP:
                corrected = _CSS_ALIAS_MAP[prop_lower]
                val_part  = patch[prop_m.end():]
                print(f"[css_fixer] {issue_id} alias corrected: {prop_lower} -> {corrected}")
                return f"{corrected}:{val_part}"

        # Reject hallucinated property names in single-declaration patches
        prop_m2 = re.match(r"^([\w-]+)\s*:", patch)
        if prop_m2:
            prop = prop_m2.group(1).lower()
            is_valid = (
                prop in _VALID_CSS_PROPS
                or prop.startswith(("-epub-", "-webkit-", "-moz-", "-ms-"))
                or prop.startswith("/*")
            )
            if not is_valid:
                print(f"[css_fixer] {issue_id} hallucinated CSS prop '{prop}' — CANNOT_FIX")
                return "CANNOT_FIX"

        # Reject bare property name without value (e.g. "vertical-align" with no ": value")
        if re.match(r"^[\w-]+$", patch.strip()) and patch.strip().lower() in _VALID_CSS_PROPS:
            print(f"[css_fixer] {issue_id} bare property name without value '{patch}' — CANNOT_FIX")
            return "CANNOT_FIX"

        # Reject reasoning text that leaked into the <fix> tag
        if re.search(r"(^tags\b|I'?ll |We (need|can|should|are )|The fix|output a |a generic |asked to fix|Perhaps we|the fix might|Since the issue|The issue (mentions|is about))", patch, re.IGNORECASE):
            print(f"[css_fixer] {issue_id} reasoning text in patch — CANNOT_FIX")
            return "CANNOT_FIX"

        return patch
