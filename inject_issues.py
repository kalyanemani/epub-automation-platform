"""
Inject known validation issues into two EPUB files for testing.

pg20203 (Benjamin Franklin) — issues injected:
  CSS-001  Invalid CSS property value (text-decoration: rainbow)
  CSS-002  Invalid shorthand (border: 5px dotted invisible)
  CSS-003  Unclosed rule block (brace mismatch) in 0.css
  CSS-004  XHTML references .chapter-highlight class not defined in any CSS
  JS-001   New script file with syntax error (unclosed if-block)
  JS-002   Unsupported APIs in JS: localStorage, fetch, XMLHttpRequest
  A11Y-001 Images with alt attribute removed (5 img tags)
  META-001 dc:date changed to non-ISO-8601 format (28-12-2006)
  META-002 dcterms:modified removed
  NCX-001  Duplicate playOrder numbers (2 items share same order)

pg76178 (I am a woman) — issues injected:
  CSS-005  Invalid CSS property value (font-weight: extrabold)
  CSS-006  display: fancy (completely invalid value)
  CSS-007  XHTML references .section-drop-cap not defined in any CSS
  JS-003   Inline <script> with eval() usage (unsupported API)
  JS-004   Inline <script> with XMLHttpRequest (unsupported API)
  A11Y-002 lang attribute removed from 3 XHTML files
  A11Y-003 Images without alt text (existing + added)
  A11Y-004 Heading hierarchy skip h1->h3 injected
  META-003 dc:language changed to invalid BCP-47 (en--US double hyphen)
  META-004 dcterms:modified truncated to invalid timestamp
"""

import zipfile
import shutil
import re
import os

# ─── helpers ──────────────────────────────────────────────────────────────────

def read_zip_text(z, name):
    return z.read(name).decode('utf-8', 'replace')

def write_modified_epub(src_path, dst_path, modifications):
    """
    modifications: dict of { filename: new_bytes_or_str }
    Files not in dict are copied as-is.
    Extra files: dict entries whose key is NOT in the original zip are added.
    """
    shutil.copy2(src_path, dst_path)
    import tempfile, os
    tmp = dst_path + '.tmp'
    with zipfile.ZipFile(src_path, 'r') as zin, zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
        # Preserve mimetype uncompressed first (EPUB spec)
        if 'mimetype' in zin.namelist():
            info = zin.getinfo('mimetype')
            info.compress_type = zipfile.ZIP_STORED
            zout.writestr(info, zin.read('mimetype'))

        for item in zin.infolist():
            if item.filename == 'mimetype':
                continue
            if item.filename in modifications:
                data = modifications[item.filename]
                if isinstance(data, str):
                    data = data.encode('utf-8')
                zout.writestr(item, data)
            else:
                zout.writestr(item, zin.read(item.filename))

        # Add brand-new files
        existing = set(zin.namelist())
        for fname, data in modifications.items():
            if fname not in existing:
                if isinstance(data, str):
                    data = data.encode('utf-8')
                zout.writestr(fname, data)

    os.replace(tmp, dst_path)
    print(f'  Written: {dst_path}')


# ══════════════════════════════════════════════════════════════════════════════
# pg20203 — Autobiography of Benjamin Franklin
# ══════════════════════════════════════════════════════════════════════════════

SRC1 = r'C:\Users\krishkal\Downloads\pg20203-images-3.epub'
DST1 = r'C:\Users\krishkal\Downloads\pg20203-images-3-issues.epub'

print('\n[pg20203] Reading source…')
mods1 = {}

with zipfile.ZipFile(SRC1) as z:
    names = z.namelist()
    xhtml_files = sorted([n for n in names if n.endswith(('.xhtml', '.html', '.htm'))])
    css_files   = sorted([n for n in names if n.endswith('.css')])
    ncx_files   = [n for n in names if n.endswith('.ncx')]

    # ── CSS-001 + CSS-002: inject invalid declarations into pgepub.css ────────
    pgepub_css = read_zip_text(z, 'OEBPS/pgepub.css')
    bad_css_block = """
/* === INJECTED ISSUES FOR TESTING === */
.chapter-title {
    text-decoration: rainbow;
    border: 5px dotted invisible;
    font-kerning: 42px;
}
"""
    mods1['OEBPS/pgepub.css'] = pgepub_css + bad_css_block
    print('  CSS-001/002: invalid declarations added to pgepub.css')

    # ── CSS-003: unclosed rule block in 0.css ─────────────────────────────────
    css0 = read_zip_text(z, 'OEBPS/0.css')
    unclosed = """
/* injected: unclosed rule — brace mismatch */
.pg-boilerplate {
    margin-top: 2em;
    font-style: italic;
    color: #555555;
/* missing closing brace intentionally */
"""
    mods1['OEBPS/0.css'] = css0 + unclosed
    print('  CSS-003: unclosed brace added to 0.css')

    # ── CSS-004: add undefined class reference to first XHTML ─────────────────
    xf0 = xhtml_files[0]
    xhtml0 = read_zip_text(z, xf0)
    # inject a <p> with the undefined class right after <body>
    xhtml0 = xhtml0.replace(
        '<body',
        '<body',
        1
    )
    # Find first <p> and wrap it with the undefined class
    xhtml0 = re.sub(
        r'(<p\b(?![^>]*\bclass=))',
        r'<p class="chapter-highlight undefined-style"',
        xhtml0,
        count=3
    )
    mods1[xf0] = xhtml0
    print(f'  CSS-004: .chapter-highlight class referenced (undefined) in {xf0.split("/")[-1]}')

    # ── JS-001 + JS-002: add a new script file with syntax error + bad APIs ───
    bad_js = """\
// Script injected for validation testing
(function init() {
    // JS-002: Unsupported APIs in EPUB
    var stored = localStorage.getItem('readingPosition');
    var ws = new WebSocket('wss://tracker.example.com');

    fetch('https://analytics.example.com/track', {
        method: 'POST',
        body: JSON.stringify({ page: stored })
    });

    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'https://api.example.com/data', true);
    xhr.send();

    // JS-001: Syntax error — unclosed if block
    if (stored {
        console.log('position: ' + stored);
    }
}());
"""
    mods1['OEBPS/scripts/chapter-nav.js'] = bad_js
    print('  JS-001/002: OEBPS/scripts/chapter-nav.js created with syntax error + unsupported APIs')

    # Add script to manifest in OPF
    opf = read_zip_text(z, 'OEBPS/content.opf')
    # Insert manifest item for JS file
    opf = opf.replace(
        '</manifest>',
        '  <item id="chapter-nav-js" href="scripts/chapter-nav.js" media-type="application/javascript"/>\n  </manifest>'
    )
    # Also reference it from first XHTML (so script-checks picks it up via HTML scan)
    mods1['OEBPS/content.opf'] = opf

    # Inject <script src> into first XHTML (already modified above)
    xhtml0_current = mods1[xf0]
    xhtml0_current = xhtml0_current.replace(
        '</head>',
        '  <script type="text/javascript" src="scripts/chapter-nav.js"></script>\n</head>'
    )
    mods1[xf0] = xhtml0_current
    print(f'  JS: <script src> reference added to {xf0.split("/")[-1]}')

    # ── A11Y-001: remove alt from 5 images across first 2 XHTML files ─────────
    for xf in xhtml_files[:2]:
        raw = mods1.get(xf) or read_zip_text(z, xf)
        count = [0]
        def strip_alt(m):
            if count[0] >= 3:
                return m.group(0)
            count[0] += 1
            tag = m.group(0)
            tag = re.sub(r'\s*alt="[^"]*"', '', tag)
            tag = re.sub(r"\s*alt='[^']*'", '', tag)
            return tag
        raw = re.sub(r'<img\b[^>]*>', strip_alt, raw)
        mods1[xf] = raw
    print('  A11Y-001: alt attributes removed from images in first 2 XHTML files')

    # ── META-001: invalid dc:date format ──────────────────────────────────────
    opf_current = mods1.get('OEBPS/content.opf') or opf
    opf_current = re.sub(
        r'<dc:date>[^<]+</dc:date>',
        '<dc:date>28-12-2006</dc:date>',
        opf_current
    )
    print('  META-001: dc:date changed to invalid format 28-12-2006')

    # ── META-002: remove dcterms:modified ─────────────────────────────────────
    opf_current = re.sub(
        r'\s*<meta property="dcterms:modified">[^<]+</meta>',
        '',
        opf_current
    )
    mods1['OEBPS/content.opf'] = opf_current
    print('  META-002: dcterms:modified removed from OPF')

    # ── NCX-001: duplicate playOrder ──────────────────────────────────────────
    if ncx_files:
        ncx_txt = read_zip_text(z, ncx_files[0])
        # Change playOrder="3" to "2" (duplicate with existing "2")
        ncx_txt = re.sub(r'playOrder="3"', 'playOrder="2"', ncx_txt, count=1)
        # Change playOrder="5" to "4" (another duplicate)
        ncx_txt = re.sub(r'playOrder="5"', 'playOrder="4"', ncx_txt, count=1)
        mods1[ncx_files[0]] = ncx_txt
        print(f'  NCX-001: duplicate playOrder values injected in {ncx_files[0]}')

print(f'\n[pg20203] Writing {len(mods1)} modified files…')
write_modified_epub(SRC1, DST1, mods1)


# ══════════════════════════════════════════════════════════════════════════════
# pg76178 — I am a woman
# ══════════════════════════════════════════════════════════════════════════════

SRC2 = r'C:\Users\krishkal\Downloads\pg76178-images-3.epub'
DST2 = r'C:\Users\krishkal\Downloads\pg76178-images-3-issues.epub'

print('\n[pg76178] Reading source…')
mods2 = {}

with zipfile.ZipFile(SRC2) as z:
    names = z.namelist()
    xhtml_files = sorted([n for n in names if n.endswith(('.xhtml', '.html', '.htm'))])
    css_files   = sorted([n for n in names if n.endswith('.css')])
    ncx_files   = [n for n in names if n.endswith('.ncx')]

    # ── CSS-005 + CSS-006: invalid declarations in 1.css ─────────────────────
    css1 = read_zip_text(z, 'OEBPS/1.css')
    bad_css2 = """
/* === INJECTED ISSUES FOR TESTING === */
.chapter-intro {
    font-weight: extrabold;
    display: fancy;
    text-overflow: marquee;
    word-break: break-all-the-things;
}
.drop-cap::first-letter {
    font-size: 500%;
    float: leftside;
}
"""
    mods2['OEBPS/1.css'] = css1 + bad_css2
    print('  CSS-005/006: invalid declarations added to 1.css')

    # ── CSS-007: reference undefined class in XHTML ───────────────────────────
    xf1 = xhtml_files[1] if len(xhtml_files) > 1 else xhtml_files[0]
    xhtml1 = read_zip_text(z, xf1)
    xhtml1 = re.sub(
        r'(<p\b(?![^>]*\bclass=))',
        r'<p class="section-drop-cap undefined-chapter"',
        xhtml1,
        count=2
    )
    mods2[xf1] = xhtml1
    print(f'  CSS-007: .section-drop-cap class referenced (undefined) in {xf1.split("/")[-1]}')

    # ── JS-003 + JS-004: inject inline <script> with unsupported APIs ─────────
    xf2 = xhtml_files[2] if len(xhtml_files) > 2 else xhtml_files[0]
    xhtml2 = mods2.get(xf2) or read_zip_text(z, xf2)
    bad_script = """
<script type="text/javascript">
// JS-003: eval usage (unsupported in EPUB)
var userPref = eval('({theme: "dark", fontSize: 16})');

// JS-004: XMLHttpRequest (unsupported in EPUB)
var xhr = new XMLHttpRequest();
xhr.open('POST', 'https://track.example.com/event', true);
xhr.setRequestHeader('Content-Type', 'application/json');
xhr.send(JSON.stringify({event: 'page_view', book: '76178'}));

// Additional: localStorage
localStorage.setItem('lastPage', window.location.href);
</script>
"""
    xhtml2 = xhtml2.replace('</head>', bad_script + '</head>')
    mods2[xf2] = xhtml2
    print(f'  JS-003/004: inline <script> with eval + XHR + localStorage in {xf2.split("/")[-1]}')

    # ── A11Y-002: remove lang attribute from 3 XHTML files ───────────────────
    for xf in xhtml_files[:3]:
        raw = mods2.get(xf) or read_zip_text(z, xf)
        raw = re.sub(r'\s+lang="[^"]*"', '', raw, count=1)
        raw = re.sub(r"\s+lang='[^']*'", '', raw, count=1)
        mods2[xf] = raw
    print('  A11Y-002: lang attribute removed from first 3 XHTML files')

    # ── A11Y-003: remove alt from images in first 3 XHTML files ──────────────
    for xf in xhtml_files[:3]:
        raw = mods2.get(xf) or read_zip_text(z, xf)
        count = [0]
        def strip_alt2(m):
            if count[0] >= 2:
                return m.group(0)
            count[0] += 1
            tag = m.group(0)
            tag = re.sub(r'\s*alt="[^"]*"', '', tag)
            tag = re.sub(r"\s*alt='[^']*'", '', tag)
            return tag
        raw = re.sub(r'<img\b[^>]*>', strip_alt2, raw)
        mods2[xf] = raw
    print('  A11Y-003: alt attributes removed from images in first 3 XHTML files')

    # ── A11Y-004: inject heading hierarchy skip (h1 -> h3, no h2) ────────────
    # Find an XHTML with h1 and inject an h3 right after without h2
    for xf in xhtml_files[1:4]:
        raw = mods2.get(xf) or read_zip_text(z, xf)
        if '<h1' in raw:
            raw = re.sub(
                r'(</h1>)',
                r'\1\n<h3 class="injected-subheading">Subsection Note</h3>',
                raw,
                count=1
            )
            mods2[xf] = raw
            print(f'  A11Y-004: h1->h3 heading skip injected in {xf.split("/")[-1]}')
            break

    # ── META-003: invalid BCP-47 language tag ─────────────────────────────────
    opf2 = read_zip_text(z, 'OEBPS/content.opf')
    opf2 = re.sub(
        r'<dc:language>[^<]+</dc:language>',
        '<dc:language>en--US</dc:language>',
        opf2
    )
    print('  META-003: dc:language changed to invalid BCP-47 (en--US)')

    # ── META-004: truncated/invalid dcterms:modified timestamp ───────────────
    opf2 = re.sub(
        r'(<meta property="dcterms:modified">)[^<]+(</meta>)',
        r'\g<1>2025-05-29T\g<2>',
        opf2
    )
    mods2['OEBPS/content.opf'] = opf2
    print('  META-004: dcterms:modified truncated to "2025-05-29T" (invalid timestamp)')

print(f'\n[pg76178] Writing {len(mods2)} modified files…')
write_modified_epub(SRC2, DST2, mods2)

print('\n✓ Done.')
print(f'  {DST1}')
print(f'  {DST2}')
