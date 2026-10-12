"""EPUB rules knowledge base — OPF metadata, accessibility, NCX, spine, and fix examples."""

EPUB_RULES_KB_ENTRIES = [
    {
        "rule_id": "EPUB_FIX_001",
        "title": "S_MANIFEST_ITEMS_INVALID — correct font media-types",
        "content": (
            "Problem: EPUB font files listed in the OPF manifest with wrong media-type attributes. "
            "EPUB3 requires specific IANA font types: TTF → font/ttf, OTF → font/otf, "
            "WOFF → font/woff, WOFF2 → font/woff2. "
            "Wrong values: application/vnd.ms-opentype, application/x-font-ttf, application/font-sfnt. "
            "Fix example — OPF before: <item href='font/body.ttf' media-type='application/vnd.ms-opentype'/> "
            "OPF after: <item href='font/body.ttf' media-type='font/ttf'/>"
        ),
        "domain": "structure",
        "file_type": "opf",
    },
    {
        "rule_id": "EPUB_FIX_002",
        "title": "L_CSS_INVALID_DECLARATION — missing-hyphen property names",
        "content": (
            "Problem: CSS property names typed without hyphens are invalid. "
            "These cause L_CSS_INVALID_DECLARATION validation failures. "
            "Complete alias map: fontsize → font-size, textalign → text-align, "
            "fontfamily → font-family, lineheight → line-height, "
            "textindent → text-indent, fontweight → font-weight, "
            "textdecoration → text-decoration, backgroundcolor → background-color, "
            "margintop → margin-top, marginbottom → margin-bottom, "
            "marginleft → margin-left, marginright → margin-right, "
            "paddingtop → padding-top, paddingbottom → padding-bottom, "
            "paddingleft → padding-left, paddingright → padding-right, "
            "bordertop → border-top, borderbottom → border-bottom. "
            "Fix example — CSS before:\n"
            "h2.boxtitle { fontfamily: serif; fontsize: 1.1em; fontweight: bold; "
            "textalign: center; textindent: 0em; margintop: 1em; marginbottom: 0.5em; }\n"
            "CSS after:\n"
            "h2.boxtitle { font-family: serif; font-size: 1.1em; font-weight: bold; "
            "text-align: center; text-indent: 0em; margin-top: 1em; margin-bottom: 0.5em; }"
        ),
        "domain": "css",
        "file_type": "css",
    },
    {
        "rule_id": "EPUB_FIX_003",
        "title": "L_CSS_INVALID_DECLARATION — unit typos and invalid shorthand values",
        "content": (
            "Problem: CSS unit typos cause L_CSS_INVALID_DECLARATION. "
            "Common: '1p solid' should be '1px solid' (missing x), "
            "'text-innt' should be 'text-indent' (doubled n), "
            "'margin: 1em 0em em 0em' has bare 'em' which should be '0em'. "
            "'numaric' list-style-type should be 'decimal'. "
            "Fix: always use valid CSS length units (px, em, rem, %, vw, vh). "
            "Fix example — before: border: 1p solid black; list-style-type: numaric; "
            "after: border: 1px solid black; list-style-type: decimal;"
        ),
        "domain": "css",
        "file_type": "css",
    },
    {
        "rule_id": "EPUB_FIX_004",
        "title": "M_DATE — ISO-8601 date format for dc:date",
        "content": (
            "Problem: OPF dc:date element contains a date that is not ISO-8601 format. "
            "Required format: YYYY-MM-DD (e.g., 2024-01-15) or YYYY (e.g., 2024). "
            "Common wrong formats: 26/04/2022, Apr 2022, 20220426, 2022.04.26. "
            "Fix: rewrite the dc:date element content to ISO-8601 format. "
            "OPF before: <dc:date>26/04/2022</dc:date> "
            "OPF after: <dc:date>2022-04-26</dc:date>"
        ),
        "domain": "metadata",
        "file_type": "opf",
    },
    {
        "rule_id": "EPUB_FIX_005",
        "title": "A_HTML_LANG_MISSING — add lang attribute to html element",
        "content": (
            "Problem: HTML files in EPUB must declare language using lang and xml:lang attributes. "
            "Required on <html> element for screen readers and accessibility. "
            "Fix: add lang='en' xml:lang='en' (or appropriate BCP-47 code) to <html> tag. "
            "HTML before: <html xmlns='http://www.w3.org/1999/xhtml'> "
            "HTML after: <html xmlns='http://www.w3.org/1999/xhtml' lang='en' xml:lang='en'>"
        ),
        "domain": "accessibility",
        "file_type": "html",
    },
    {
        "rule_id": "EPUB_FIX_006",
        "title": "NCX_PLAYORDER_INVALID — fix navPoint playOrder sequence",
        "content": (
            "Problem: NCX navMap navPoint elements must have sequential integer playOrder values "
            "starting from 1. Gaps or duplicates cause reading-system navigation failures. "
            "Fix: renumber all playOrder attributes sequentially (1, 2, 3 ...). "
            "NCX before: <navPoint playOrder='1'> ... <navPoint playOrder='5'> (gap at 2,3,4) "
            "NCX after: <navPoint playOrder='1'> ... <navPoint playOrder='2'>"
        ),
        "domain": "ncx",
        "file_type": "ncx",
    },
    {
        "rule_id": "EPUB_FIX_007",
        "title": "L_CSS_SYNTAX — missing semicolons and CSS syntax errors",
        "content": (
            "Problem: CSS declarations missing semicolons at end, or using British spelling. "
            "Common: 'colour' instead of 'color', missing ';' before '}', "
            "display: box should be display: flex (old flexbox syntax), "
            "unclosed CSS rule block (missing final closing brace). "
            "Fix example — CSS before: p { color: red\\n} (missing semicolon) "
            "CSS after: p { color: red;\\n} "
            "Unclosed block fix — CSS before: h2 { font-size: 1.1em (no closing brace) "
            "CSS after: h2 { font-size: 1.1em; }"
        ),
        "domain": "css",
        "file_type": "css",
    },
    {
        "rule_id": "EPUB_FIX_008",
        "title": "L_FONT_FALLBACK — CSS font-family must include generic fallback",
        "content": (
            "Problem: CSS font-family declarations without a generic font family fallback "
            "will fail on reading systems that don't have the named font installed. "
            "Required: always end font-family with serif, sans-serif, or monospace. "
            "CSS before: font-family: 'Optima', Times; "
            "CSS after: font-family: 'Optima', Times, serif;"
        ),
        "domain": "css",
        "file_type": "css",
    },
    {
        "rule_id": "EPUB_FIX_009",
        "title": "S_BROKEN_INTERNAL_LINKS — internal href references",
        "content": (
            "Problem: Anchor links in HTML files point to fragments (#id) or files that "
            "don't exist in the EPUB package. "
            "Fix requires manual review: verify the target file and ID exist in the EPUB, "
            "or remove the broken link. This is typically a HITL (human-in-the-loop) fix. "
            "Cannot be automatically fixed without knowing the correct target."
        ),
        "domain": "structure",
        "file_type": "html",
    },
    {
        "rule_id": "EPUB_FIX_010",
        "title": "UNREFERENCED_MEDIA — remove or add to manifest",
        "content": (
            "Problem: Media files (images, fonts, CSS) exist in the EPUB package but are "
            "not referenced in the OPF manifest, or are in the manifest but not used anywhere. "
            "Fix option 1: add the file to the OPF manifest with correct media-type. "
            "Fix option 2: remove unused files from the package. "
            "OPF manifest entry to add: <item id='img1' href='images/fig1.png' media-type='image/png'/>"
        ),
        "domain": "structure",
        "file_type": "opf",
    },
    {
        "rule_id": "EPUB_FIX_011",
        "title": "L_CSS_CLASS_SELECTOR_MISSING — CSS class used in HTML but not defined",
        "content": (
            "Problem: HTML elements reference CSS classes (class='boxtitle') that are not defined "
            "in any linked stylesheet. This causes unstyled content. "
            "Fix: Add the missing CSS rule to the appropriate stylesheet. "
            "Example — HTML: <h2 class='boxtitle'>Chapter 1</h2> "
            "Add to CSS: h2.boxtitle { font-size: 1.1em; font-weight: bold; text-align: center; } "
            "If the class was a typo, fix the HTML class attribute to match an existing rule."
        ),
        "domain": "css",
        "file_type": "css",
    },
    {
        "rule_id": "EPUB_FIX_012",
        "title": "S_MANIFEST_ITEMS_INVALID — file not found or wrong media-type for images/HTML",
        "content": (
            "Problem: Manifest items reference files that don't exist, or declare wrong media-type "
            "for non-font files. Correct media-types: "
            "XHTML → application/xhtml+xml, CSS → text/css, "
            "JPEG → image/jpeg, PNG → image/png, GIF → image/gif, SVG → image/svg+xml, "
            "MP3 → audio/mpeg, MP4 → video/mp4, NCX → application/x-dtbncx+xml. "
            "Fix for missing file: remove the <item> entry from manifest and its <itemref> from spine. "
            "Fix for wrong media-type: correct the media-type attribute. "
            "OPF before: <item href='img/cover.jpg' media-type='image/png'/> "
            "OPF after: <item href='img/cover.jpg' media-type='image/jpeg'/>"
        ),
        "domain": "structure",
        "file_type": "opf",
    },
    {
        "rule_id": "EPUB_FIX_013",
        "title": "L_TABLE_STYLING — table too wide or no responsive constraints",
        "content": (
            "Problem: Tables without max-width or overflow constraints overflow the viewport "
            "on small screens and e-readers. "
            "Fix: Add responsive CSS for tables. "
            "CSS fix:\n"
            "table { max-width: 100%; width: 100%; border-collapse: collapse; "
            "overflow-x: auto; display: block; }\n"
            "td, th { padding: 0.3em 0.5em; word-wrap: break-word; }"
        ),
        "domain": "css",
        "file_type": "css",
    },
    {
        "rule_id": "EPUB_FIX_014",
        "title": "L_LIST_STYLING — list bullets or numbers not rendering correctly",
        "content": (
            "Problem: Lists use vendor-specific or invalid list-style-type values, "
            "or list-style is being overridden to none without a custom counter. "
            "Common invalid values: 'numaric' (should be 'decimal'), 'alpha' (should be 'lower-alpha'). "
            "Fix: Use standard CSS list-style values. "
            "CSS fix:\n"
            "ol { list-style-type: decimal; padding-left: 2em; }\n"
            "ul { list-style-type: disc; padding-left: 2em; }\n"
            "ol.alpha { list-style-type: lower-alpha; }\n"
            "ol.roman { list-style-type: lower-roman; }"
        ),
        "domain": "css",
        "file_type": "css",
    },
    {
        "rule_id": "EPUB_FIX_015",
        "title": "JS_SCRIPT_REFERENCE_BROKEN — fix broken JavaScript file references",
        "content": (
            "Problem: HTML files reference JavaScript files via <script src='...'> but the "
            "path is wrong (broken relative path or file not in manifest). "
            "Fix: Correct the relative path from the HTML file to the JS file. "
            "HTML before: <script src='script.js'></script> (but JS is at js/script.js) "
            "HTML after: <script src='../js/script.js'></script> "
            "Also ensure the JS file is in the OPF manifest: "
            "<item id='script1' href='js/script.js' media-type='application/javascript'/>"
        ),
        "domain": "javascript",
        "file_type": "html",
    },
]
