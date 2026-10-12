import json, zipfile

EPUB_PATH = r'C:\Users\krishkal\Downloads\9781637429532_with_error 1.epub'

with open("job_result.json", encoding="utf-8") as f:
    result = json.load(f)

with zipfile.ZipFile(EPUB_PATH) as zf:
    css_text = zf.read('OEBPS/styles/stylesheet.css').decode('utf-8', errors='replace')
lines = css_text.split('\n')

def show_lines(start, end, highlight=None):
    for i in range(start, min(end, len(lines))):
        line = lines[i]
        mark = '  <-- BROKEN' if highlight and any(h in line.lower() for h in highlight) else ''
        print(f"  {i+1:4}: {line}{mark}")

SEP = "=" * 65
DIV = "-" * 65

print(SEP)
print("  NON-COSMETIC CSS ISSUES  (9 CSS-related, 1 skipped)")
print(SEP)

# ── ISSUE 1 ──────────────────────────────────────────────────────────────────
print("""
[1] L_CSS_INVALID_DECLARATION  +  L_CSS_SYNTAX  (FIXED, 99% conf)
    Rule: body { colour: #black; font-colour: darkblue; }

    WHY NON-COSMETIC:
    - 'colour' and 'font-colour' are not CSS properties (British spelling)
    - '#black' is not a valid hex value
    - All e-reader rendering engines (Kindle, Kobo, Apple Books) silently
      DISCARD both lines entirely — body gets no color or font-color at all
    - The color the author intended for ALL body text is simply lost
    - Can cause contrast failures on high-contrast reader modes
""")
show_lines(4, 12, ['colour', '#black', 'font-colour'])

# ── ISSUE 2 ──────────────────────────────────────────────────────────────────
print("""
[2] L_CSS_SYNTAX — .noindent block has no semicolons, no closing brace  (DETECTED, needs fixer)

    WHY NON-COSMETIC (CRITICAL — CASCADE EFFECT):
    - .noindent is used 303 times across the EPUB
    - Without semicolons/closing brace the CSS parser enters "error recovery"
    - Everything between .noindent opening brace and the NEXT valid closing brace
      gets consumed — corrupting .noindentt, aside, and several other rules too
    - Paragraphs using .noindent get NONE of: font-size, margin, text-align,
      text-indent — they fall back to browser defaults (typically indented,
      wrong line spacing, wrong margin)
""")
show_lines(509, 528)

# ── ISSUE 3 ──────────────────────────────────────────────────────────────────
print("""
[3] L_CSS_SYNTAX — h2.boxtitle uses run-together property names  (pre-existing, DETECTED)
    Used in 45 locations across the EPUB

    WHY NON-COSMETIC:
    - 'fontfamily', 'fontsize', 'fontweight', 'textalign', 'textindent',
      'margintop' are NOT valid CSS property names (missing hyphens)
    - The entire h2.boxtitle rule is silently ignored
    - Box title headings render as plain default text: wrong font, wrong size,
      wrong alignment — they become indistinguishable from body paragraphs
    - Also missing closing brace — cascades into next rule
""")
show_lines(1173, 1187)

# ── ISSUE 4 ──────────────────────────────────────────────────────────────────
print("""
[4] L_TABLE_STYLING — table { overflow:hidden; width:auto }  (FIXED, 95% conf)

    WHY NON-COSMETIC:
    - overflow:hidden on a table CLIPS any content wider than the container
    - width:auto without max-width means wide tables on narrow e-readers
      (Kindle Paperwhite: 520px) will overflow and get clipped — DATA IS LOST
    - No border-collapse means cell borders double up (visual gap between cells)
    - This EPUB has 5 table-containing files — financial/ESG tables
      where clipped columns mean wrong data visible to reader

    Fix applied:
    - table { max-width:100%; width:100%; border-collapse:collapse; overflow-x:auto; display:block; }
    - td, th { padding:0.5em; word-wrap:break-word; }
""")
show_lines(322, 328)

# ── ISSUE 5 ──────────────────────────────────────────────────────────────────
print("""
[5] L_CSS_CLASS_SELECTOR_MISSING — .frontmatter used 37 times, NOT defined  (FIXED, 95% conf)

    WHY NON-COSMETIC:
    - .frontmatter wraps the TOC, copyright, title pages, acknowledgements
    - Without a CSS rule, these elements get browser/reader default block layout
    - No margin control, no display type, no padding — front matter looks
      like unstyled paragraphs with no visual separation
    - Fix: .frontmatter { display: block; } added as minimal structural rule
""")

# ── ISSUE 6 ──────────────────────────────────────────────────────────────────
print("""
[6] L_CSS_CLASS_SELECTOR_MISSING — h1.fmtitle (16 uses) + ul.simpleind (54 uses) missing

    WHY NON-COSMETIC:
    - h1.fmtitle: Title-page heading — without the rule it renders as a generic
      <h1>, losing any custom size, font, or centering the designer intended
    - ul.simpleind li.level1: List items in 54 places get browser default
      list-style (bullets) instead of the intended indented no-bullet style
    - NOTE: These were NOT detected by the current rule set — gap in coverage
""")

# ── ISSUE 7 ──────────────────────────────────────────────────────────────────
print("""
[7] L_HEADING_HIERARCHY — <h4> directly after <h2> in chapter01  (SKIPPED — 0% conf)

    WHY NON-COSMETIC:
    - Heading levels h1->h4 skip h3 — screen readers announce "heading level 4"
      immediately after "heading level 2" with no h3 context
    - Breaks ARIA outline tree — assistive tech users lose document structure
    - EPUB accessibility spec (EPUB A11y 1.1) requires sequential heading levels
    - Autofix skipped it because restructuring headings could change meaning —
      needs author to decide: promote h4 to h3, or add an h3 between them
""")

# ── DIFFS: what was actually changed ─────────────────────────────────────────
print()
print(SEP)
print("  WHAT AUTOFIX ACTUALLY CHANGED IN stylesheet.css")
print(SEP)
for d in result.get('diffs', []):
    if 'stylesheet' not in d.get('file', ''):
        continue
    print(f"\nFile: {d['file']}")
    for h in d.get('hunks', []):
        if h.get('tag') == 'equal':
            continue
        bl = h.get('before_lines', [])
        al = h.get('after_lines', [])
        line_range = f"lines {bl[0]}-{bl[-1]}" if bl else "?"
        print(f"\n  [{h['tag']}] at {line_range}")
        bef = h.get('before', '')
        aft = h.get('after', '')
        if isinstance(bef, str):
            for ln in bef.split('\n'):
                print(f"    - {ln}")
        if isinstance(aft, str):
            for ln in aft.split('\n'):
                print(f"    + {ln}")

print()
print(SEP)
print("  SUMMARY: Which issues need author attention")
print(SEP)
print("""
  FULLY AUTO-FIXED (no action needed):
    colour:#black -> color:black           [body rule]
    font-colour -> removed                 [body rule]
    table overflow:hidden -> overflow-x:auto + border-collapse
    .frontmatter { display:block } added
    font-variant:normal added

  AUTO-FIXED BUT VERIFY:
    h2.boxtitle — detected but NOT in fix_trace diffs
      (may have been patched as an appended rule at EOF)

  NEEDS HUMAN REVIEW:
    .noindent broken block (303 usages) — parser cascade, author must
      restore: font-size/margin/text-align/text-indent with semicolons
    h1.fmtitle missing rule — 16 usages, needs authored CSS
    ul.simpleind li.level1 missing rule — 54 usages, needs authored CSS
    L_HEADING_HIERARCHY — h4 after h2 in chapter01, author decides
""")
