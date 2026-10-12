"""MetadataTextAgent — specialized for OPF metadata and text content issues."""
import re
from agents.domain_fixer_base import DomainFixerBase

DOMAIN_RULES = {
    # OPF metadata
    "M_DATE",
    "M_PUBLISHER",
    "M_LANGUAGE",
    "M_IDENTIFIER",
    "M_IDENTIFIER_FORMAT",
    "M_RENDITION_LAYOUT",
    "M_RENDITION_ORIENTATION",
    "M_RENDITION_SPREAD",
    # Text content
    "T_HYPHENATION_WORD_MERGE",
    "T_MISSING_INCORRECT_TEXT",
    "T_SPECIAL_CHAR_ENTITY",
}

# Valid dc:language values (ISO 639-1)
_VALID_LANG_CODES = {
    "en", "fr", "de", "es", "it", "pt", "nl", "ja", "zh", "ko",
    "ar", "he", "ru", "pl", "sv", "da", "fi", "nb", "tr", "cs",
}

# Valid rendition metadata values
_VALID_RENDITION = {
    "layout":      {"pre-paginated", "reflowable"},
    "orientation": {"landscape", "portrait", "auto"},
    "spread":      {"landscape", "portrait", "both", "none", "auto"},
}

_SYSTEM_PROMPT = """You are an EPUB metadata and text content specialist.

OUTPUT RULES:
- Output ONLY the raw fix value inside <fix>...</fix> tags. No explanations.
- ALWAYS output a best-effort fix.

DATE (M_DATE):
- Output ISO-8601 date ONLY: YYYY-MM-DD (e.g., 2024-01-15) or YYYY (e.g., 2024).
- Common wrong formats to correct:
    26/04/2022  -> 2022-04-26
    Apr 2022    -> 2022-04
    20220426    -> 2022-04-26
    2022.04.26  -> 2022-04-26
- If only a year is visible, output: YYYY

PUBLISHER (M_PUBLISHER):
- Output the publisher name as a plain string. No quotes, no XML.
- If not determinable from context, output: Unknown Publisher

LANGUAGE (M_LANGUAGE):
- Output an ISO 639-1 code: en, fr, de, es, ja, zh, etc.
- Default to "en" if not determinable.

IDENTIFIER (M_IDENTIFIER):
- Output the corrected identifier string (ISBN, UUID, DOI).
- ISBN format: 978-X-XXXXX-XXX-X
- UUID format: urn:uuid:XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX

RENDITION (M_RENDITION_*):
- layout     -> reflowable or pre-paginated
- orientation -> landscape, portrait, or auto
- spread     -> landscape, portrait, both, none, or auto

TEXT CONTENT (T_HYPHENATION_WORD_MERGE):
- Output the correctly separated/hyphenated word(s). Example: "some-word"

GROUNDING:
- Use file content to derive the correct value where possible."""


class MetadataTextAgent(DomainFixerBase):
    agent_id        = "metadata_text_agent"
    system_prompt   = _SYSTEM_PROMPT
    kb_collections  = ["epub_rules"]
    score_threshold = 0.30
    default_policies = {
        "task_type":          "structured",  # Fireworks: qwen2p5-7b-instruct
        "temperature":        0.05,
        "max_context_chunks": 4,
    }

    def _validate_patch(self, patch: str, issue_id: str) -> str:
        if not patch or patch.upper() in ("CANNOT_FIX", "NONE", ""):
            return patch

        rid = issue_id.upper()

        # Date: must be ISO-8601 format
        if rid == "M_DATE":
            patch = patch.strip()
            # Accept YYYY, YYYY-MM, YYYY-MM-DD
            if re.match(r"^\d{4}(-\d{2}(-\d{2})?)?$", patch):
                return patch
            print(f"[meta_agent] M_DATE invalid format '{patch}' — CANNOT_FIX")
            return "CANNOT_FIX"

        # Language: must be a simple code
        if rid == "M_LANGUAGE":
            code = patch.strip().lower()
            if re.match(r"^[a-z]{2}(-[a-zA-Z]{2,4})?$", code):
                return code
            return "en"

        # Rendition metadata
        if rid == "M_RENDITION_LAYOUT":
            v = patch.strip().lower()
            return v if v in _VALID_RENDITION["layout"] else "reflowable"
        if rid == "M_RENDITION_ORIENTATION":
            v = patch.strip().lower()
            return v if v in _VALID_RENDITION["orientation"] else "auto"
        if rid == "M_RENDITION_SPREAD":
            v = patch.strip().lower()
            return v if v in _VALID_RENDITION["spread"] else "auto"

        # Reject HTML tags in metadata patches
        if re.match(r"^\s*<", patch):
            print(f"[meta_agent] {issue_id} patch looks like HTML — CANNOT_FIX")
            return "CANNOT_FIX"

        # Reject reasoning text that leaked into the <fix> tag
        if re.search(r"(^tags\b|I'?ll |We (need|can|should)|The fix|Since the issue|the issue is about|output a )", patch, re.IGNORECASE):
            print(f"[meta_agent] {issue_id} reasoning text in patch — CANNOT_FIX")
            return "CANNOT_FIX"

        return patch
