"""HTMLAccessibilityAgent — specialized for HTML, accessibility, alt-text, and media issues."""
import re
from agents.domain_fixer_base import DomainFixerBase

DOMAIN_RULES = {
    # Language
    "A_HTML_LANG_MISSING",
    # Link / text
    "A_LINK_TEXT_MISSING",
    # Images / media
    "Media_IMAGE_NO_ALT", "Media_IMAGE_NO_SRC",
    "Media_audio_controls", "Media_missing_control",
    "A_IMAGE_ALT_MISSING", "IMG_ALT_MISSING",
    # Schema.org accessibility metadata
    "A_SCHEMA_ACCESSMODE_MISSING",
    "A_SCHEMA_ACCESSIBILITYFEATURE_MISSING",
    "A_SCHEMA_ACCESSIBILITYHAZARD_MISSING",
    # Text content
    "T_HYPHENATION_WORD_MERGE",
    "T_MISSING_INCORRECT_TEXT",
}

# Valid IANA BCP-47 language subtags (common subset)
_VALID_LANG_TAGS = {
    "en", "en-US", "en-GB", "en-AU", "en-CA",
    "fr", "fr-FR", "fr-CA",
    "de", "de-DE", "de-AT", "de-CH",
    "es", "es-ES", "es-MX", "es-419",
    "it", "it-IT",
    "pt", "pt-BR", "pt-PT",
    "nl", "nl-NL", "nl-BE",
    "ja", "zh", "zh-CN", "zh-TW", "zh-HK",
    "ko", "ar", "ar-SA", "he", "ru", "pl",
    "sv", "da", "fi", "nb", "nn",
    "tr", "cs", "sk", "hu", "ro",
}

# Valid schema:accessMode values
_VALID_ACCESS_MODES = {"textual", "visual", "auditory", "tactile"}
# Valid schema:accessibilityFeature values (common subset)
_VALID_A11Y_FEATURES = {
    "alternativeText", "longDescription", "captions", "audioDescription",
    "braille", "signLanguage", "tableOfContents", "index", "readingOrder",
    "printPageNumbers", "pageBreakMarkers", "highContrastDisplay",
    "displayTransformability", "largePrint",
}

_SYSTEM_PROMPT = """You are an HTML accessibility and media specialist for EPUB files.

OUTPUT RULES:
- Output ONLY the raw fix value inside <fix>...</fix> tags. No explanations.
- ALWAYS output a best-effort fix.

LANGUAGE ATTRIBUTE (A_HTML_LANG_MISSING):
- Output a BCP-47 language tag ONLY. Examples: en, en-US, fr, de, ja, zh-CN
- Default to "en" if language cannot be determined from context.

ALT TEXT (A_IMAGE_ALT_MISSING, IMG_ALT_MISSING, Media_IMAGE_NO_ALT):
- Output a short, descriptive alt text (5–12 words) for the image.
- Do NOT output HTML, quotes, or attribute names. Just the text.
- If you cannot determine what the image shows: "Decorative image"

LINK TEXT (A_LINK_TEXT_MISSING):
- Output descriptive link text (3–8 words) that makes sense out of context.
- Do NOT use "click here", "read more", or "link".
- Example: "View chapter 3: Introduction"

AUDIO CONTROLS (Media_audio_controls, Media_missing_control):
- Output: controls

MEDIA SRC MISSING (Media_IMAGE_NO_SRC):
- Output the corrected relative path to the media file. Example: images/fig1.png

SCHEMA ACCESSIBILITY (A_SCHEMA_*):
- accessMode missing → output: textual
- accessibilityFeature missing → output: alternativeText
- accessibilityHazard missing → output: none

TEXT CONTENT (T_HYPHENATION_WORD_MERGE):
- Output the correctly separated words. Example: "word1 word2"

GROUNDING:
- Use file content and KB context to produce accurate, relevant values."""


class HTMLAccessibilityAgent(DomainFixerBase):
    agent_id        = "html_accessibility_agent"
    system_prompt   = _SYSTEM_PROMPT
    kb_collections  = ["epub_rules", "kb_css"]
    score_threshold = 0.35
    default_policies = {
        "task_type":          "structured",  # Fireworks: qwen2p5-7b-instruct
        "temperature":        0.15,
        "max_context_chunks": 5,
    }

    def _validate_patch(self, patch: str, issue_id: str) -> str:
        if not patch or patch.upper() in ("CANNOT_FIX", "NONE", ""):
            return patch

        rid = issue_id.upper()

        # A_MANUAL issues require human design review — no code patch is possible
        if "MANUAL" in rid:
            return "CANNOT_FIX"

        # Reject patches that are review instructions or reasoning text
        if re.search(r"^(tags\b|manual|please|review|check|verify|ensure|you (should|must|need)|this (requires|needs)|I'?ll |We (need|can|should|are )|The fix|output a |perhaps we|the fix might|For broken|asked to fix|Since the issue)", patch, re.IGNORECASE):
            print(f"[html_a11y] {issue_id} patch looks like reasoning/review text — CANNOT_FIX")
            return "CANNOT_FIX"

        # Language tag: normalize and validate
        if "LANG" in rid:
            tag = patch.strip().lower()
            # Accept any two-letter code or known BCP-47 tag
            if re.match(r"^[a-z]{2}(-[a-zA-Z0-9]{2,8})*$", tag):
                return tag
            print(f"[html_a11y] {issue_id} invalid lang tag '{patch}' — defaulting to 'en'")
            return "en"

        # Schema accessMode: must be a known value
        if "ACCESSMODE" in rid:
            v = patch.strip().lower()
            if v not in _VALID_ACCESS_MODES:
                return "textual"
            return v

        # Schema accessibilityFeature: must be a known value
        if "ACCESSIBILITYFEATURE" in rid:
            v = patch.strip()
            if v not in _VALID_A11Y_FEATURES:
                return "alternativeText"
            return v

        # Reject patches that look like HTML tags (LLM confusing output with HTML)
        if re.match(r"^\s*<", patch):
            print(f"[html_a11y] {issue_id} patch looks like HTML — CANNOT_FIX")
            return "CANNOT_FIX"

        return patch
