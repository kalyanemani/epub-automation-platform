"""
EPUBPatcher: applies agent-generated fix values directly to EPUB files.

Each patch contains:
  issue_id  — the validation rule ID
  value     — the raw fix value (language code, alt text, font list, etc.)
  issue     — the original issue dict (has location, details)
  fixable   — bool
"""
import os
import re
import shutil
import tempfile
import zipfile
from typing import Dict, List


class EPUBPatcher:
    """
    Applies a list of agent-generated fix patches to an EPUB file.

    Usage:
        patcher = EPUBPatcher()
        result  = patcher.apply_patches(epub_path, patches)
        # result: {output_path, applied_count, failed_count, applied, failed}
    """

    def apply_patches(self, epub_path: str, patches: List[Dict]) -> Dict:
        applied, failed, diffs = [], [], []
        temp_dir = tempfile.mkdtemp(prefix="epub_patch_")
        try:
            with zipfile.ZipFile(epub_path, "r") as zf:
                zf.extractall(temp_dir)

            opf_path = self._find_opf(temp_dir)

            # Snapshot all files before patching
            snapshots: Dict[str, str] = {}

            def _snapshot(path: str):
                if path and os.path.isfile(path) and path not in snapshots:
                    try:
                        snapshots[path] = self._read(path)
                    except Exception:
                        pass

            for patch in patches:
                if not patch.get("fixable"):
                    continue
                issue    = patch.get("issue", {})
                issue_id = patch.get("issue_id", issue.get("id", ""))
                value    = patch.get("value", patch.get("patch", "")).strip()

                if not value or value.upper() in ("CANNOT_FIX", "", "NONE"):
                    continue

                # Snapshot affected files before this patch
                loc = issue.get("location", {})
                ref = loc.get("file", "") if isinstance(loc, dict) else str(loc)
                if ref:
                    p = self._resolve(temp_dir, ref)
                    _snapshot(p)
                if opf_path:
                    _snapshot(opf_path)

                try:
                    changed = self._dispatch(temp_dir, opf_path, issue, issue_id, value)
                    if changed is not False:
                        applied.append(issue_id)
                    else:
                        failed.append({"issue_id": issue_id, "error": "no patcher for this rule"})
                except Exception as exc:
                    failed.append({"issue_id": issue_id, "error": str(exc)})

            # Compute diffs for all files that were snapshotted
            for fpath, before in snapshots.items():
                if not os.path.isfile(fpath):
                    continue
                try:
                    after = self._read(fpath)
                    if after != before:
                        rel = os.path.relpath(fpath, temp_dir).replace(os.sep, "/")
                        diffs.append(self._compute_diff(before, after, rel))
                except Exception:
                    pass

            base = os.path.splitext(epub_path)[0]
            output_path = f"{base}_agent_patched.epub"
            self._repack(temp_dir, output_path)

            return {
                "output_path":   output_path,
                "applied_count": len(applied),
                "failed_count":  len(failed),
                "applied":       applied,
                "failed":        failed,
                "diffs":         diffs,
            }
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    # ── Dispatcher ────────────────────────────────────────────────────────

    def _dispatch(self, epub_dir, opf_path, issue, issue_id, value) -> bool:
        """Return True if a change was made, False if no handler matched."""
        uid = issue_id.upper()

        # ── HTML lang ────────────────────────────────────────────────────
        if "HTML_LANG" in uid or "NAV_LANG" in uid or uid in ("A_LANG_MISSING",):
            self._fix_html_lang(epub_dir, issue, value)
        # ── Image alt-text ───────────────────────────────────────────────
        elif (
            "ALT_MISSING" in uid or "IMG_ALT" in uid
            or "IMAGE_ALT" in uid or "EMPTY_ALT" in uid
            or uid in ("A_ALT_MISSING", "A_EMPTY_ALT",
                       "MEDIA_IMAGE_NO_ALT", "MEDIA_IMAGE_MISSING_ALT")
        ):
            self._fix_img_alt(epub_dir, issue, value)
        # ── Image src missing ────────────────────────────────────────────
        elif "IMAGE_NO_SRC" in uid or "MEDIA_IMAGE_NO_SRC" in uid:
            self._fix_img_src(epub_dir, issue, value)
        # ── Audio / media controls ───────────────────────────────────────
        elif "AUDIO_CONTROLS" in uid or "MISSING_CONTROL" in uid or "MEDIA_CONTROL" in uid:
            self._fix_audio_controls(epub_dir, issue, value)
        # ── Link text ────────────────────────────────────────────────────
        elif "LINK_TEXT" in uid:
            self._fix_link_text(epub_dir, issue, value)
        # ── OPF metadata ─────────────────────────────────────────────────
        elif uid.startswith("M_"):
            self._fix_opf_metadata(opf_path, issue_id, value)
        # ── Schema / accessibility OPF metadata ──────────────────────────
        elif "SCHEMA_ACCESS" in uid or "ACCESSMODE" in uid or "ACCESSIBILITYFEAT" in uid or "ACCESSIBILITYHAZARD" in uid:
            self._fix_opf_accessibility_meta(opf_path, issue_id, value)
        # ── CSS font fallback ────────────────────────────────────────────
        elif "FONT_FALLBACK" in uid:
            self._fix_css_font_fallback(epub_dir, issue, value)
        # ── CSS reference — fix the <link> href in HTML ──────────────────
        elif "CSS_REFERENCE" in uid:
            self._fix_css_reference(epub_dir, issue, value)
        # ── Manifest invalid / duplicate items ───────────────────────────
        elif "MANIFEST_ITEMS_INVALID" in uid or "MANIFEST_DUP" in uid:
            self._fix_manifest_invalid(epub_dir, opf_path, issue)
        # ── CSS syntax / invalid declaration — in-place replace then append
        elif any(k in uid for k in ("CSS_SYNTAX", "CSS_INVALID", "CSS_UNIT")):
            self._fix_css_inplace(epub_dir, issue, value)
        # ── CSS font variants — in-place replace (font-variant: <value>)
        elif "FONT_VARIANTS" in uid or "FONT_VARIANT" in uid:
            self._fix_css_inplace(epub_dir, issue, value)
        # ── CSS class selector missing — append new class rule ────────────
        elif "CSS_CLASS_SELECTOR" in uid:
            self._fix_css_append(epub_dir, issue, value)
        # ── CSS table / list styling — append complete rules ──────────────
        elif any(k in uid for k in ("TABLE_STYLING", "TABLE_STRUCTURE",
                                    "LIST_STYLING")):
            self._fix_css_append(epub_dir, issue, value)
        # ── CSS layout / responsive — append new rule ─────────────────────
        elif any(k in uid for k in ("TABLE_RESPONSIVE", "IMAGE_RENDERING",
                                    "RESPONSIVE_", "LAYOUT_OVERLAP")):
            self._fix_css_append(epub_dir, issue, value)
        # ── Heading hierarchy ────────────────────────────────────────────
        elif "HEADING" in uid:
            self._fix_heading(epub_dir, issue, value)
        # ── Text content replacement ──────────────────────────────────────
        elif uid.startswith("T_"):
            self._fix_text_content(epub_dir, issue, value)
        else:
            return self._generic_patch(epub_dir, issue, value)
        return True

    def _generic_patch(self, epub_dir, issue, value) -> bool:
        """Fallback patcher for issue types without a dedicated handler."""
        if not value or value.upper() in ("CANNOT_FIX", "NONE", ""):
            return False

        location = issue.get("location", {})
        file_ref = location.get("file", "") if isinstance(location, dict) else str(location)
        if not file_ref:
            return False

        path = self._resolve(epub_dir, file_ref)
        if not path or not os.path.isfile(path):
            return False

        try:
            txt = self._read(path)
        except Exception:
            return False

        replacement = value.strip()
        original = ""
        details = issue.get("details", {})
        candidates = []
        if isinstance(details, dict):
            candidates.extend([
                details.get("original", ""),
                details.get("found", ""),
                details.get("value", ""),
                details.get("text", ""),
                details.get("excerpt", ""),
            ])
            for sample in details.get("samples", []):
                if isinstance(sample, dict):
                    candidates.extend([
                        sample.get("value", ""),
                        sample.get("excerpt", ""),
                        sample.get("text", ""),
                    ])
        elif isinstance(details, str):
            candidates.append(details)

        for candidate in candidates:
            if not isinstance(candidate, str):
                continue
            candidate = candidate.strip()
            if candidate and candidate in txt:
                original = candidate
                break

        if original:
            new = txt.replace(original, replacement, 1)
            if new != txt:
                self._write(path, new)
                return True

        line_no = None
        if isinstance(location, dict):
            try:
                line_no = int(location.get("line", ""))
            except Exception:
                line_no = None

        if line_no is not None:
            lines = txt.splitlines(keepends=True)
            idx = max(0, min(line_no - 1, len(lines) - 1))
            if idx < len(lines):
                lines[idx] = replacement + ("\n" if lines[idx].endswith("\n") else "")
                new = "".join(lines)
                if new != txt:
                    self._write(path, new)
                    return True

        if replacement not in txt:
            try:
                with open(path, "a", encoding="utf-8") as fh:
                    fh.write(f"\n/* agent-fix fallback */\n{replacement}\n")
                return True
            except Exception:
                pass

        return False

    # ── Patch implementations ─────────────────────────────────────────────

    def _fix_html_lang(self, epub_dir, issue, value):
        lang = re.sub(r'[^a-zA-Z0-9\-]', '', value.strip())[:10] or "en"
        for path in self._html_files(epub_dir, issue):
            try:
                txt = self._read(path)
                if re.search(r'<html[^>]+\blang=', txt, re.I):
                    continue   # already has lang
                new = re.sub(
                    r'(<html(?:\s[^>]*)?)>',
                    lambda m: f'{m.group(1)} lang="{lang}" xml:lang="{lang}">',
                    txt, count=1, flags=re.I,
                )
                if new != txt:
                    self._write(path, new)
            except Exception:
                pass

    def _fix_img_alt(self, epub_dir, issue, value):
        alt = value.strip().replace('"', "'")[:200]
        for path in self._html_files(epub_dir, issue):
            try:
                txt = self._read(path)
                # Set alt="" → alt="value"
                new = re.sub(r'\balt=""', f'alt="{alt}"', txt, flags=re.I)
                # Add alt to img tags that have none
                new = re.sub(
                    r'(<img)(?![^>]*\balt=)([^>]*?)(/>|>)',
                    lambda m: f'{m.group(1)} alt="{alt}"{m.group(2)}{m.group(3)}',
                    new, flags=re.I,
                )
                if new != txt:
                    self._write(path, new)
            except Exception:
                pass

    def _fix_opf_metadata(self, opf_path, issue_id, value):
        if not opf_path or not os.path.exists(opf_path):
            return

        dc_map = {
            "M_LANGUAGE":    "dc:language",
            "M_PUBLISHER":   "dc:publisher",
            "M_DATE":        "dc:date",
            "M_IDENTIFIER":  "dc:identifier",
            "M_CREATOR":     "dc:creator",
            "M_TITLE":       "dc:title",
            "M_DESCRIPTION": "dc:description",
            "M_SUBJECT":     "dc:subject",
        }
        uid = issue_id.upper()
        dc_el = next((v for k, v in dc_map.items() if k in uid), None)
        if not dc_el:
            return

        try:
            txt = self._read(opf_path)
            tag = dc_el
            pattern = rf'<{re.escape(tag)}[^>]*>.*?</{re.escape(tag)}>'
            replacement = f"<{tag}>{value.strip()}</{tag}>"

            if re.search(pattern, txt, re.DOTALL | re.I):
                new = re.sub(pattern, replacement, txt, count=1,
                             flags=re.DOTALL | re.I)
            else:
                new = re.sub(
                    r'(</metadata>)',
                    f"    {replacement}\n  \\1",
                    txt, count=1, flags=re.I,
                )
            if new != txt:
                self._write(opf_path, new)
        except Exception:
            pass

    # Maps file extension → OPF media-type (must match EPUB-Analysis validator expectations)
    _MEDIA_TYPE_MAP = {
        ".xhtml": "application/xhtml+xml",
        ".html":  "application/xhtml+xml",
        ".htm":   "application/xhtml+xml",
        ".css":   "text/css",
        ".js":    "application/javascript",
        ".jpg":   "image/jpeg",
        ".jpeg":  "image/jpeg",
        ".png":   "image/png",
        ".gif":   "image/gif",
        ".svg":   "image/svg+xml",
        ".ttf":   "font/ttf",
        ".otf":   "font/otf",
        ".woff":  "font/woff",
        ".woff2": "font/woff2",
        ".ncx":   "application/x-dtbncx+xml",
        ".opf":   "application/oebps-package+xml",
        ".mp3":   "audio/mpeg",
        ".mp4":   "video/mp4",
        ".smil":  "application/smil+xml",
    }

    def _fix_manifest_invalid(self, epub_dir, opf_path, issue) -> bool:
        """
        Fix manifest <item> issues:
        - Remove items whose href file doesn't exist
        - Remove items with empty/missing href
        - Fix wrong media-type based on file extension
        - Rename duplicate item IDs
        Handles both self-closing (<item ... />) and non-self-closing (<item ...>).
        """
        if not opf_path or not os.path.exists(opf_path):
            return False
        try:
            txt     = self._read(opf_path)
            opf_dir = os.path.dirname(opf_path)
            # Match both <item ... /> and <item ...></item>
            item_re  = re.compile(r'<item\b([^>]*?)\s*(?:/>|>\s*</item>)', re.I | re.S)
            id_re    = re.compile(r'\bid="([^"]+)"', re.I)
            href_re  = re.compile(r'\bhref="([^"]+)"', re.I)
            mtype_re = re.compile(r'\bmedia-type="([^"]*)"', re.I)

            new_txt    = txt
            removed_ids: List[str] = []
            seen_ids: dict = {}   # id → count (for duplicate detection)

            # First pass — collect all IDs to find duplicates
            for m in item_re.finditer(txt):
                id_m = id_re.search(m.group(1))
                if id_m:
                    iid = id_m.group(1)
                    seen_ids[iid] = seen_ids.get(iid, 0) + 1

            dup_counters: dict = {}

            for m in item_re.finditer(txt):
                attrs  = m.group(1)
                full   = m.group(0)
                id_m   = id_re.search(attrs)
                href_m = href_re.search(attrs)
                iid    = id_m.group(1) if id_m else ""

                # ── 1. Empty / missing href → remove item ────────────────
                if not href_m or not href_m.group(1).strip():
                    if iid:
                        removed_ids.append(iid)
                    new_txt = new_txt.replace(full, "", 1)
                    continue

                href = href_m.group(1).strip()

                # ── 2. File doesn't exist → remove item ──────────────────
                candidate = os.path.normpath(
                    os.path.join(opf_dir, href.replace("/", os.sep))
                )
                file_exists = os.path.exists(candidate) or bool(self._resolve(epub_dir, href))
                if not file_exists:
                    if iid:
                        removed_ids.append(iid)
                    new_txt = new_txt.replace(full, "", 1)
                    continue

                # ── 3. Wrong media-type → fix it ─────────────────────────
                ext      = os.path.splitext(href)[1].lower()
                expected = self._MEDIA_TYPE_MAP.get(ext)
                if expected and mtype_re.search(attrs):
                    current_mt = mtype_re.search(attrs).group(1)
                    if current_mt != expected:
                        fixed_full = full.replace(
                            f'media-type="{current_mt}"',
                            f'media-type="{expected}"',
                            1,
                        )
                        new_txt = new_txt.replace(full, fixed_full, 1)

                # ── 4. Duplicate ID → rename second occurrence ────────────
                if iid and seen_ids.get(iid, 1) > 1:
                    dup_counters[iid] = dup_counters.get(iid, 0) + 1
                    if dup_counters[iid] > 1:
                        new_id   = f"{iid}_dup{dup_counters[iid]}"
                        new_full = full.replace(f'id="{iid}"', f'id="{new_id}"', 1)
                        new_txt  = new_txt.replace(full, new_full, 1)

            # Remove spine itemrefs for deleted item IDs
            for item_id in removed_ids:
                new_txt = re.sub(
                    rf'<itemref\b[^>]*\bidref="{re.escape(item_id)}"[^>]*\s*/?>\s*',
                    "",
                    new_txt,
                    flags=re.I,
                )

            if new_txt != txt:
                self._write(opf_path, new_txt)
                return True
        except Exception:
            pass
        return False

    def _fix_m_date(self, opf_path) -> bool:
        """Reformat a malformed dc:date to ISO-8601 (YYYY-MM-DD) without LLM."""
        if not opf_path or not os.path.exists(opf_path):
            return False
        try:
            txt       = self._read(opf_path)
            date_pat  = re.compile(r'(<dc:date[^>]*>)(.*?)(</dc:date>)', re.I | re.S)
            m         = date_pat.search(txt)
            if not m:
                return False
            raw         = m.group(2).strip()
            raw_original = m.group(2)   # may contain \r, \n, leading/trailing spaces

            iso = None

            # Already valid ISO-8601 (YYYY, YYYY-MM, or YYYY-MM-DD)?
            if re.fullmatch(r'\d{4}(-\d{2}(-\d{2})?)?', raw):
                # Skip only if element content is already clean (no CR/whitespace)
                if raw_original == raw:
                    return False
                iso = raw  # valid value, just needs whitespace stripped

            # YYYYMMDD compact
            compact = re.fullmatch(r'(\d{4})(\d{2})(\d{2})', raw)
            if compact:
                iso = f"{compact.group(1)}-{compact.group(2)}-{compact.group(3)}"

            # YYYY/MM/DD or DD/MM/YYYY or MM/DD/YYYY with any separator
            if not iso:
                parts = re.split(r'[-/.]', raw)
                if len(parts) == 3:
                    p = [p.strip() for p in parts]
                    if len(p[0]) == 4:          # YYYY-first
                        iso = f"{p[0]}-{int(p[1]):02d}-{int(p[2]):02d}"
                    elif len(p[2]) == 4:        # year-last: DD/MM/YYYY or MM/DD/YYYY
                        iso = f"{p[2]}-{int(p[1]):02d}-{int(p[0]):02d}"

            # Pull any 4-digit year as last resort
            if not iso:
                yr = re.search(r'\b(19|20)\d{2}\b', raw)
                if yr:
                    iso = f"{yr.group(0)}-01-01"

            if not iso:
                import datetime
                iso = datetime.date.today().strftime("%Y-%m-%d")

            new_txt = date_pat.sub(
                lambda _m: f"{_m.group(1)}{iso}{_m.group(3)}", txt, count=1
            )
            if new_txt != txt:
                self._write(opf_path, new_txt)
                return True
        except Exception:
            pass
        return False

    def _fix_img_src(self, epub_dir, issue, value):
        """Set src attribute on img tags that have none or an empty src."""
        src = value.strip().replace('"', "'")[:300]
        for path in self._html_files(epub_dir, issue):
            try:
                txt = self._read(path)
                new = re.sub(
                    r'(<img)(?![^>]*\bsrc=)([^>]*?)(/>|>)',
                    lambda m: f'{m.group(1)} src="{src}"{m.group(2)}{m.group(3)}',
                    txt, flags=re.I,
                )
                new = re.sub(r'\bsrc=""', f'src="{src}"', new, flags=re.I)
                if new != txt:
                    self._write(path, new)
            except Exception:
                pass

    def _fix_audio_controls(self, epub_dir, issue, value):
        """Add controls attribute to audio/video elements that lack it."""
        for path in self._html_files(epub_dir, issue):
            try:
                txt = self._read(path)
                new = re.sub(
                    r'(<(?:audio|video))(?![^>]*\bcontrols\b)([^>]*?>)',
                    r'\1 controls\2',
                    txt, flags=re.I,
                )
                if new != txt:
                    self._write(path, new)
            except Exception:
                pass

    def _fix_link_text(self, epub_dir, issue, value):
        """Replace empty or missing anchor text with LLM-generated descriptive text."""
        text = value.strip().replace('<', '&lt;').replace('>', '&gt;')[:200]
        for path in self._html_files(epub_dir, issue):
            try:
                txt = self._read(path)
                # Replace <a ...></a> (empty link) with descriptive text
                new = re.sub(
                    r'(<a\b[^>]*>)\s*(</a>)',
                    lambda m: f'{m.group(1)}{text}{m.group(2)}',
                    txt, flags=re.I,
                )
                if new != txt:
                    self._write(path, new)
            except Exception:
                pass

    def _fix_opf_accessibility_meta(self, opf_path, issue_id, value):
        """Add schema.org accessibility metadata to the OPF file."""
        if not opf_path or not os.path.exists(opf_path):
            return
        uid = issue_id.upper()
        if "ACCESSMODE" in uid:
            prop = "schema:accessMode"
        elif "ACCESSIBILITYFEAT" in uid:
            prop = "schema:accessibilityFeature"
        elif "ACCESSIBILITYHAZARD" in uid:
            prop = "schema:accessibilityHazard"
        else:
            return
        try:
            txt = self._read(opf_path)
            # Only add if not already present
            if prop not in txt:
                meta_tag = f'    <meta property="{prop}">{value.strip()}</meta>'
                new = re.sub(
                    r'(</metadata>)',
                    f'{meta_tag}\n  \\1',
                    txt, count=1, flags=re.I,
                )
                if new != txt:
                    self._write(opf_path, new)
        except Exception:
            pass

    def _fix_css_font_fallback(self, epub_dir, issue, value):
        fallback = value.strip().rstrip(";")
        for path in self._css_files(epub_dir, issue):
            try:
                txt = self._read(path)
                def _add_fallback(m):
                    decl = m.group(1)
                    if re.search(
                        r'\b(serif|sans-serif|monospace|cursive|fantasy|system-ui)\b',
                        decl, re.I,
                    ):
                        return m.group(0)  # already has generic
                    return f"{decl}, {fallback};"

                new = re.sub(
                    r'(font-family\s*:[^;]+)(;)',
                    lambda m: _add_fallback(m),
                    txt, flags=re.I,
                )
                if new != txt:
                    self._write(path, new)
            except Exception:
                pass

    def _fix_css_append(self, epub_dir, issue, value):
        """Append a raw CSS snippet to the relevant CSS file."""
        for path in self._css_files(epub_dir, issue):
            try:
                with open(path, "a", encoding="utf-8") as f:
                    f.write(f"\n/* agent-fix */\n{value.strip()}\n")
            except Exception:
                pass
            break  # only first file

    def _fix_css_inplace(self, epub_dir, issue, value):
        """Replace a broken CSS declaration in-place; fall back to append."""
        fix_value = value.strip()
        details = issue.get("details", {})
        original = ""
        if isinstance(details, dict):
            original = (
                details.get("found") or details.get("original")
                or details.get("context") or details.get("value") or ""
            )
        elif isinstance(details, str):
            original = details[:300]

        for path in self._css_files(epub_dir, issue):
            try:
                txt = self._read(path)
                if original and original in txt:
                    new = txt.replace(original, fix_value, 1)
                else:
                    # Try to match the property name and replace its value
                    prop_match = re.match(r'([\w-]+)\s*:', fix_value)
                    if prop_match:
                        prop = re.escape(prop_match.group(1))
                        new = re.sub(
                            rf'{prop}\s*:[^;{{}}]*;',
                            fix_value if fix_value.endswith(";") else fix_value + ";",
                            txt, count=1, flags=re.I,
                        )
                    else:
                        new = txt
                    if new == txt:
                        # Nothing matched — append
                        new = txt + f"\n/* agent-fix */\n{fix_value}\n"
                if new != txt:
                    self._write(path, new)
            except Exception:
                pass
            break  # only first file

    def _fix_css_reference(self, epub_dir, issue, value):
        """Fix a broken <link href="..."> CSS reference in HTML files."""
        corrected_path = value.strip().replace('"', "'")
        location = issue.get("location", {})
        broken_ref = ""
        if isinstance(location, dict):
            broken_ref = location.get("ref", "") or location.get("href", "") or location.get("file", "")

        for path in self._html_files(epub_dir, issue):
            try:
                txt = self._read(path)
                if broken_ref and broken_ref in txt:
                    new = txt.replace(
                        f'href="{broken_ref}"',
                        f'href="{corrected_path}"',
                        1,
                    )
                    # Also try single-quote variant
                    if new == txt:
                        new = txt.replace(
                            f"href='{broken_ref}'",
                            f"href='{corrected_path}'",
                            1,
                        )
                else:
                    # Patch the first <link> that points to a .css file
                    new = re.sub(
                        r'(<link\b[^>]+\bhref=")[^"]*\.css("[^>]*>)',
                        lambda m: f'{m.group(1)}{corrected_path}{m.group(2)}',
                        txt, count=1, flags=re.I,
                    )
                if new != txt:
                    self._write(path, new)
            except Exception:
                pass

    def _fix_text_content(self, epub_dir, issue, value):
        location = issue.get("location", {})
        file_ref  = location.get("file", "") if isinstance(location, dict) else str(location)
        details   = issue.get("details", {})
        original  = ""
        if isinstance(details, dict):
            original = (details.get("original") or details.get("found")
                        or details.get("text") or "")
        elif isinstance(details, str):
            original = details[:300]

        if not original or not file_ref:
            return

        path = self._resolve(epub_dir, file_ref)
        if not path:
            return

        try:
            txt = self._read(path)
            new = txt.replace(original, value.strip(), 1)
            if new != txt:
                self._write(path, new)
        except Exception:
            pass

    def _fix_heading(self, epub_dir, issue, value):
        """Fix a specific heading tag based on agent-generated corrected text."""
        location = issue.get("location", {})
        file_ref = location.get("file", "") if isinstance(location, dict) else ""
        if not file_ref:
            return
        path = self._resolve(epub_dir, file_ref)
        if not path:
            return
        try:
            txt = self._read(path)
            details = issue.get("details", {})
            old_tag  = details.get("tag", "") if isinstance(details, dict) else ""
            new_tag  = value.strip() if re.match(r'^h[1-6]$', value.strip(), re.I) else ""
            if old_tag and new_tag:
                new = re.sub(
                    rf'<{re.escape(old_tag)}(\s[^>]*)?>',
                    f'<{new_tag}\\1>',
                    txt, flags=re.I,
                )
                new = re.sub(rf'</{re.escape(old_tag)}>', f'</{new_tag}>', new, flags=re.I)
                if new != txt:
                    self._write(path, new)
        except Exception:
            pass

    # Property names that are missing their hyphen (hand-edited EPUB CSS)
    _MISSING_HYPHEN_PROPS = {
        "fontsize":           "font-size",
        "fontweight":         "font-weight",
        "fontstyle":          "font-style",
        "fontfamily":         "font-family",
        "fontvariant":        "font-variant",
        "lineheight":         "line-height",
        "textalign":          "text-align",
        "textindent":         "text-indent",
        "textdecoration":     "text-decoration",
        "texttransform":      "text-transform",
        "textoverflow":       "text-overflow",
        "letterspacing":      "letter-spacing",
        "wordspacing":        "word-spacing",
        "wordwrap":           "word-wrap",
        "wordbreak":          "word-break",
        "backgroundcolor":    "background-color",
        "backgroundimage":    "background-image",
        "backgroundposition": "background-position",
        "backgroundrepeat":   "background-repeat",
        "backgroundsize":     "background-size",
        "bordertop":          "border-top",
        "borderbottom":       "border-bottom",
        "borderleft":         "border-left",
        "borderright":        "border-right",
        "borderradius":       "border-radius",
        "bordercollapse":     "border-collapse",
        "pagebreakbefore":    "page-break-before",
        "pagebreakafter":     "page-break-after",
        "marginleft":         "margin-left",
        "marginright":        "margin-right",
        "margintop":          "margin-top",
        "marginbottom":       "margin-bottom",
        "paddingleft":        "padding-left",
        "paddingright":       "padding-right",
        "paddingtop":         "padding-top",
        "paddingbottom":      "padding-bottom",
        "liststyletype":      "list-style-type",
        "liststyle":          "list-style",
        "whitespace":         "white-space",
        "maxwidth":           "max-width",
        "maxheight":          "max-height",
        "minwidth":           "min-width",
        "minheight":          "min-height",
        "zindex":             "z-index",
    }

    # -epub- vendor properties that have a direct standard CSS equivalent
    _EPUB_VENDOR_STD = {
        "-epub-hyphens":          "hyphens",
        "-epub-word-break":       "word-break",
        "-epub-text-overflow":    "text-overflow",
        "-epub-line-break":       "line-break",
        "-epub-writing-mode":     "writing-mode",
        "-epub-text-combine":     "text-combine-upright",
        "-epub-text-emphasis":    "text-emphasis",
        "-epub-text-align-last":  "text-align-last",
        "-epub-ruby-position":    "ruby-position",
    }

    def _fix_css_syntax_deterministic(self, epub_dir, issue) -> bool:
        """
        Deterministic fixes for CSS syntax errors AND invalid declarations.
        Handles: missing semicolons, British spelling, old flexbox, unitless sizes,
        -epub- vendor prefixes (adds standard property), word-wrap → overflow-wrap.
        """
        fixed = False
        for path in self._css_files(epub_dir, issue):
            try:
                txt = self._read(path)
                new = txt

                # ── Syntax fixes ─────────────────────────────────────────
                # Missing semicolons before a closing brace
                new = re.sub(r'([^;{}\s/])([ \t]*)\n([ \t]*})', r'\1;\2\n\3', new)

                # British spelling: colour → color
                new = re.sub(r'\bcolour\s*:', 'color:', new, flags=re.I)

                # Old flexbox: display: box → display: flex
                new = re.sub(r'(display\s*:\s*)box(\s*;)', r'\1flex\2', new, flags=re.I)
                # Also: display: -webkit-box → flex
                new = re.sub(r'(display\s*:\s*)-webkit-box(\s*;)', r'\1flex\2', new, flags=re.I)

                # Unitless non-zero font-size / letter-spacing (add px)
                def _add_px(m):
                    val = m.group(2)
                    try:
                        return m.group(0) if float(val) == 0 else f"{m.group(1)}{val}px{m.group(3)}"
                    except ValueError:
                        return m.group(0)

                for prop in ("font-size", "letter-spacing", "word-spacing"):
                    new = re.sub(
                        rf"({re.escape(prop)}\s*:\s*)(\d+\.?\d*)(\s*;)",
                        _add_px, new, flags=re.I,
                    )

                # ── Invalid declaration fixes ─────────────────────────────
                # -epub-* vendor prefix → inject standard property after it
                for epub_prop, std_prop in self._EPUB_VENDOR_STD.items():
                    pattern = re.compile(
                        rf'({re.escape(epub_prop)}\s*:\s*([^;{{}}]+);)',
                        re.I,
                    )
                    def _inject_std(m, sp=std_prop):
                        decl    = m.group(0)
                        val     = m.group(2).strip()
                        std_decl = f"{sp}: {val};"
                        # Only add if the standard property isn't already present nearby
                        if std_decl.lower() in new.lower():
                            return decl
                        return f"{decl}\n    {std_decl}"
                    new = pattern.sub(_inject_std, new)

                # word-wrap → also add overflow-wrap (modern standard)
                if re.search(r'\bword-wrap\s*:', new, re.I):
                    if not re.search(r'\boverflow-wrap\s*:', new, re.I):
                        new = re.sub(
                            r'(\bword-wrap\s*:\s*([^;]+);)',
                            lambda m: f"{m.group(0)}\n    overflow-wrap: {m.group(2).strip()};",
                            new, flags=re.I, count=1,
                        )

                # ── Missing-hyphen property names ─────────────────────────
                # e.g. fontsize → font-size, textalign → text-align
                # Note: hardcode ":" in replacement — f-string \\1 produces \x01, not group 1
                for wrong, correct in self._MISSING_HYPHEN_PROPS.items():
                    new = re.sub(
                        rf'(?<![a-zA-Z-]){re.escape(wrong)}\s*:',
                        f'{correct}:',
                        new, flags=re.I,
                    )

                # ── Common property-name typos ────────────────────────────
                # text-innt → text-indent (doubled-n typo)
                new = re.sub(r'\btext-innt\s*:', 'text-indent:', new, flags=re.I)
                # Over-indented (triple+ letters) guesses
                new = re.sub(r'\btext-indnt\s*:', 'text-indent:', new, flags=re.I)

                # ── Unit typos ────────────────────────────────────────────
                # "1p solid" → "1px solid" (missing x in px before border-style keywords)
                new = re.sub(
                    r'\b(\d+)p(\s+(?:solid|dashed|dotted|double|groove|ridge|inset|outset|none))',
                    r'\1px\2', new, flags=re.I,
                )
                # Standalone bare "em" at start of a space-separated value list
                # e.g. "margin: 1em 0em em 0em" → "margin: 1em 0em 1em 0em"
                new = re.sub(
                    r'(margin|padding)(\s*:[^;{]*\s)(?<!\d)em(?=\s)',
                    lambda m: m.group(0).replace(' em ', ' 1em '),
                    new, flags=re.I,
                )

                # ── Sample-based targeted fix (L_CSS_INVALID_DECLARATION) ─
                details = issue.get("details", {})
                if isinstance(details, dict):
                    for sample in details.get("samples", []):
                        bad_prop = (sample.get("property") or "").strip()
                        good_prop = self._MISSING_HYPHEN_PROPS.get(bad_prop.lower())
                        if bad_prop and good_prop:
                            new = re.sub(
                                rf'(?<![a-zA-Z-]){re.escape(bad_prop)}\s*:',
                                f'{good_prop}:',
                                new, flags=re.I,
                            )

                if new != txt:
                    self._write(path, new)
                    fixed = True
            except Exception:
                pass
            break  # only first matching file
        return fixed

    def apply_fallback_patches(self, epub_path: str, issues: List[Dict]) -> Dict:
        """
        Apply Python-only deterministic fixes for issues the LLM couldn't handle
        (CANNOT_FIX) or that Node.js AUTO failed to resolve.

        Handles: S_MANIFEST_ITEMS_INVALID, L_CSS_SYNTAX, L_CSS_INVALID_DECLARATION.
        Returns: {output_path, applied, applied_count}
        """
        applied: List[str] = []
        temp_dir = tempfile.mkdtemp(prefix="epub_fallback_")
        try:
            with zipfile.ZipFile(epub_path, "r") as zf:
                zf.extractall(temp_dir)
            opf_path = self._find_opf(temp_dir)

            # Snapshot all files before any patches
            _all_files = {}
            for root, _, fnames in os.walk(temp_dir):
                for fn in fnames:
                    fp = os.path.join(root, fn)
                    try:
                        _all_files[fp] = self._read(fp)
                    except Exception:
                        pass

            for issue in issues:
                rule_id = issue.get("id", "")
                uid = rule_id.upper()
                try:
                    changed = False
                    if "MANIFEST_ITEMS_INVALID" in uid or "MANIFEST_DUP" in uid:
                        changed = self._fix_manifest_invalid(temp_dir, opf_path, issue)
                    elif uid == "M_DATE" or "M_DATE" in uid:
                        changed = self._fix_m_date(opf_path)
                    elif "CSS_SYNTAX" in uid or "CSS_INVALID" in uid:
                        changed = self._fix_css_syntax_deterministic(temp_dir, issue)
                    if changed:
                        applied.append(rule_id)
                except Exception:
                    pass

            if not applied:
                return {"output_path": epub_path, "applied": [], "applied_count": 0, "diffs": []}

            fallback_diffs = []
            for fp, before in _all_files.items():
                if not os.path.isfile(fp):
                    continue
                try:
                    after = self._read(fp)
                    if after != before:
                        rel = os.path.relpath(fp, temp_dir).replace(os.sep, "/")
                        fallback_diffs.append(self._compute_diff(before, after, rel))
                except Exception:
                    pass

            output_path = epub_path.replace(".epub", "_det_fixed.epub")
            if output_path == epub_path:
                output_path = epub_path + "_det_fixed.epub"
            self._repack(temp_dir, output_path)
            return {
                "output_path":   output_path,
                "applied":       applied,
                "applied_count": len(applied),
                "diffs":         fallback_diffs,
            }
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    # ── File helpers ──────────────────────────────────────────────────────

    def _resolve(self, epub_dir: str, file_ref: str) -> str:
        if not file_ref:
            return ""
        clean = file_ref.lstrip("/").replace("/", os.sep)
        full  = os.path.join(epub_dir, clean)
        if os.path.exists(full):
            return full
        basename = os.path.basename(clean)
        for root, _, files in os.walk(epub_dir):
            if basename in files:
                return os.path.join(root, basename)
        return ""

    def _html_files(self, epub_dir: str, issue: Dict) -> List[str]:
        """Return targeted HTML file list (specific file from location, else all HTML)."""
        loc = issue.get("location", {})
        ref = loc.get("file", "") if isinstance(loc, dict) else str(loc)
        if ref:
            p = self._resolve(epub_dir, ref)
            if p:
                return [p]
        result = []
        for root, _, files in os.walk(epub_dir):
            for f in files:
                if f.lower().endswith((".html", ".xhtml", ".htm")):
                    result.append(os.path.join(root, f))
        return result

    def _css_files(self, epub_dir: str, issue: Dict) -> List[str]:
        loc = issue.get("location", {})
        ref = loc.get("file", "") if isinstance(loc, dict) else str(loc)
        if ref and ref.lower().endswith(".css"):
            p = self._resolve(epub_dir, ref)
            if p:
                return [p]
        result = []
        for root, _, files in os.walk(epub_dir):
            for f in files:
                if f.lower().endswith(".css"):
                    result.append(os.path.join(root, f))
        return result

    def _find_opf(self, epub_dir: str) -> str:
        container = os.path.join(epub_dir, "META-INF", "container.xml")
        if os.path.exists(container):
            txt = self._read(container)
            m = re.search(r'full-path=["\']([^"\']+\.opf)["\']', txt, re.I)
            if m:
                return os.path.join(epub_dir, m.group(1).replace("/", os.sep))
        for root, _, files in os.walk(epub_dir):
            for f in files:
                if f.lower().endswith(".opf"):
                    return os.path.join(root, f)
        return ""

    @staticmethod
    def _compute_diff(before: str, after: str, filename: str) -> dict:
        """Return a compact before/after diff with changed line numbers."""
        import difflib
        before_lines = before.splitlines(keepends=True)
        after_lines  = after.splitlines(keepends=True)
        hunks = []
        for group in difflib.SequenceMatcher(None, before_lines, after_lines).get_grouped_opcodes(3):
            for tag, i1, i2, j1, j2 in group:
                if tag == "equal":
                    continue
                hunks.append({
                    "tag":          tag,
                    "before_lines": [i1 + 1, i2],         # 1-based line numbers
                    "after_lines":  [j1 + 1, j2],
                    "before":       "".join(before_lines[i1:i2]).rstrip(),
                    "after":        "".join(after_lines[j1:j2]).rstrip(),
                })
        return {
            "file":    filename,
            "changed": bool(hunks),
            "hunks":   hunks[:20],           # cap at 20 hunks per file
        }

    def _repack(self, epub_dir: str, output_path: str):
        mimetype = os.path.join(epub_dir, "mimetype")
        with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zf:
            if os.path.exists(mimetype):
                zf.write(mimetype, "mimetype", compress_type=zipfile.ZIP_STORED)
            for root, _, files in os.walk(epub_dir):
                for fname in files:
                    fp  = os.path.join(root, fname)
                    arc = os.path.relpath(fp, epub_dir).replace(os.sep, "/")
                    if arc == "mimetype":
                        continue
                    zf.write(fp, arc)

    @staticmethod
    def _read(path: str) -> str:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()

    @staticmethod
    def _write(path: str, content: str):
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
