"""CSS Knowledge Base for EPUB validation and auto-fix guidance."""

CSS_KB_ENTRIES = [
    {
        "rule_id": "CSS_001",
        "title": "Avoid !important declarations in EPUB CSS",
        "content": (
            "Problem: Using !important in EPUB CSS overrides reading-system (RS) default styles and can cause "
            "unpredictable rendering across different EPUB readers. Many RS styles rely on cascade order and "
            "!important breaks this contract. "
            "Fix: Remove !important from property declarations and restructure selector specificity instead. "
            "Use more-specific selectors to achieve priority without breaking the cascade. "
            "Example: Instead of 'p { color: black !important; }' use '.chapter p { color: black; }' to "
            "increase specificity naturally without disrupting RS overrides."
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_002",
        "title": "Declare @font-face correctly with multiple font formats",
        "content": (
            "Problem: Single-format @font-face declarations fail on EPUB readers that do not support that "
            "specific font format (e.g., only declaring WOFF2 breaks older EPUB2 readers that need TTF). "
            "Fix: Declare multiple src formats in @font-face in order: woff2, woff, ttf/otf, with a "
            "fallback generic font family. "
            "Example: @font-face { font-family: 'MyFont'; "
            "src: url('../fonts/myfont.woff2') format('woff2'), "
            "url('../fonts/myfont.woff') format('woff'), "
            "url('../fonts/myfont.ttf') format('truetype'); "
            "font-weight: normal; font-style: normal; }"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_003",
        "title": "Use epub:type-aware CSS selectors for semantic regions",
        "content": (
            "Problem: Styling structural EPUB regions (footnotes, asides, sidebars) without using "
            "epub:type-aware selectors causes accessibility tools and RS pagination engines to miss "
            "semantic boundaries. "
            "Fix: Use attribute selectors targeting epub:type values to apply structural styles. "
            "Example: [epub|type~='footnote'] { font-size: 0.85em; color: #555; } "
            "[epub|type~='sidebar'] { border-left: 3px solid #ccc; padding-left: 1em; } "
            "Declare the EPUB namespace: @namespace epub url('http://www.idpf.org/2007/ops');"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_004",
        "title": "Avoid fixed pixel widths on body and block elements",
        "content": (
            "Problem: Fixed pixel widths (e.g., body { width: 600px; }) prevent content from reflowing "
            "correctly in EPUB readers on different screen sizes and orientations. Reflowable EPUB content "
            "must adapt to the reading system viewport. "
            "Fix: Use percentage widths, max-width constraints, or remove width declarations entirely on "
            "body-level elements. For images and figures, use max-width: 100%. "
            "Example: body { max-width: 100%; margin: 0 auto; } img { max-width: 100%; height: auto; }"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_005",
        "title": "Specify font-size in em or rem, not px or pt",
        "content": (
            "Problem: Font sizes declared in px or pt ignore user font-size preferences set in the "
            "reading system, breaking accessibility for users who need larger text. EPUB accessibility "
            "guidelines require text to be resizable. "
            "Fix: Use relative units (em or rem) for all font-size declarations. Base sizes on the "
            "RS default via the root element. "
            "Example: body { font-size: 1em; } h1 { font-size: 2em; } h2 { font-size: 1.5em; } "
            "p { font-size: 1em; line-height: 1.6; } "
            "Avoid: h1 { font-size: 24px; } which is inaccessible."
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_006",
        "title": "Avoid CSS flexbox and grid in EPUB2 content",
        "content": (
            "Problem: Flexbox (display: flex) and CSS Grid (display: grid) are not supported in EPUB2 "
            "reading systems and have inconsistent support in EPUB3 RS built on older WebKit/Blink versions. "
            "Content using these will render incorrectly or collapse in unsupported RS. "
            "Fix: Use block layout, float-based layouts, or table-based layouts for EPUB2. For EPUB3, "
            "test flexbox usage and provide float-based fallback. "
            "Example: Instead of display: flex use display: block with float: left on child elements, "
            "clearing floats with a clearfix. .two-col { overflow: hidden; } "
            ".two-col .col { float: left; width: 48%; margin-right: 2%; }"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_007",
        "title": "Handle page-break properties for print-to-EPUB conversion",
        "content": (
            "Problem: Print CSS page-break-before/after/inside properties are partially deprecated and "
            "inconsistently supported across EPUB RS. Using only the legacy properties misses RS that "
            "implement only the newer break-before/after/inside properties. "
            "Fix: Declare both legacy and modern page-break properties for maximum compatibility. "
            "Example: h1, h2 { page-break-before: always; break-before: page; } "
            "table, figure { page-break-inside: avoid; break-inside: avoid; } "
            ".chapter { page-break-after: always; break-after: page; }"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_008",
        "title": "Declare writing-mode for CJK vertical text EPUB content",
        "content": (
            "Problem: EPUB content in Japanese, Chinese, or Korean vertical text modes requires explicit "
            "writing-mode declarations with both standard and vendor-prefixed forms for older RS. "
            "Missing vendor prefixes cause horizontal rendering on older reading systems. "
            "Fix: Declare writing-mode with -webkit- prefix for legacy RS compatibility. "
            "Example: .vertical-text { "
            "-webkit-writing-mode: vertical-rl; "
            "-epub-writing-mode: vertical-rl; "
            "writing-mode: vertical-rl; "
            "text-orientation: mixed; }"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_009",
        "title": "Ensure text color contrast ratio meets WCAG AA (4.5:1)",
        "content": (
            "Problem: Low contrast between foreground text color and background color fails WCAG 2.1 AA "
            "accessibility requirements (minimum 4.5:1 ratio for normal text, 3:1 for large text). "
            "This affects readability for users with low vision. "
            "Fix: Check contrast ratio using a tool like WebAIM Contrast Checker. Replace low-contrast "
            "color pairs with compliant values. "
            "Example: Avoid color: #aaa on background: #fff (1.85:1 ratio). "
            "Use color: #595959 on background: #fff (7.0:1 ratio) which passes AA. "
            "For dark themes: color: #e0e0e0 on background: #1a1a1a (13:1 ratio)."
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_010",
        "title": "Avoid absolute positioning for main content flow",
        "content": (
            "Problem: Absolutely positioned elements (position: absolute) are removed from the normal "
            "document flow and do not reflow with content. In paginated EPUB readers, absolute positioning "
            "causes content to overflow page boundaries or overlap other content. "
            "Fix: Use relative or static positioning for main content. Reserve absolute positioning only "
            "for decorative overlays within a position: relative container. "
            "Example: Instead of .caption { position: absolute; top: 10px; } "
            "use .figure-wrap { position: relative; } .caption { position: relative; margin-top: 0.5em; }"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_011",
        "title": "Use media queries sparingly — prefer fluid layouts",
        "content": (
            "Problem: EPUB3 readers have inconsistent support for @media queries. Breakpoint-heavy CSS "
            "designed for web responsive design often breaks in EPUB RS that do not fire resize/breakpoint "
            "events correctly, especially on e-ink devices. "
            "Fix: Design with fluid, single-column layouts as the default. Use @media queries only for "
            "optional enhancements (e.g., wider columns on tablet). "
            "Example: Default single column layout, with optional wider layout: "
            "@media screen and (min-width: 600px) { .two-column { column-count: 2; } } "
            "The single-column default always works without media query support."
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_012",
        "title": "Avoid CSS animations and transitions in EPUB content",
        "content": (
            "Problem: CSS animations (@keyframes, animation, transition) are not supported in EPUB2 and "
            "are restricted in many EPUB3 RS due to performance concerns on e-ink displays and "
            "accessibility requirements (vestibular disorders). "
            "Fix: Remove animation and transition declarations from EPUB CSS. Use static visual "
            "design instead. If animations are required, wrap in @media (prefers-reduced-motion: no-preference). "
            "Example: Remove: .button { transition: background 0.3s ease; } "
            "Replace with static: .button { background: #1a8a9a; } .button:hover { background: #156b78; }"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_013",
        "title": "Declare line-height as a unitless ratio",
        "content": (
            "Problem: Using px or em units for line-height causes spacing to not scale correctly when "
            "the user changes font size in the reading system. This breaks text legibility. "
            "Fix: Use a unitless number (ratio) for line-height so it inherits proportionally with font-size. "
            "Example: Correct: p { font-size: 1em; line-height: 1.6; } "
            "Incorrect: p { line-height: 24px; } or p { line-height: 1.5em; } "
            "A unitless value of 1.4-1.6 is the recommended range for body text in EPUB."
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_014",
        "title": "Avoid CSS multi-column layout (column-count) in reflowable EPUB",
        "content": (
            "Problem: CSS multi-column layout (column-count, column-width) is poorly supported in "
            "reflowable EPUB RS and causes content to overflow or render in unexpected column orders "
            "on paginated RS. "
            "Fix: Use single-column layout for reflowable EPUB. If multi-column is needed for a "
            "fixed-layout EPUB, test thoroughly and use column-fill: auto. "
            "Example: Remove: .content { column-count: 2; } "
            "Use single column: .content { max-width: 100%; }"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_015",
        "title": "Handle overflow with overflow: hidden or clip, not scroll",
        "content": (
            "Problem: Elements with overflow: scroll or overflow: auto create scroll containers within "
            "the EPUB page. Most EPUB RS do not support inner scroll containers, causing content to be "
            "clipped or inaccessible. "
            "Fix: Use overflow: hidden to clip oversized content, and ensure content does not inherently "
            "overflow by using max-width: 100% on images and tables. "
            "Example: .code-block { overflow: hidden; max-width: 100%; word-wrap: break-word; } "
            "img, table { max-width: 100%; }"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_016",
        "title": "Use CSS classes for structural semantics, not just visual styles",
        "content": (
            "Problem: Using inline styles or non-semantic class names (e.g., class='red-text') makes "
            "the CSS brittle and unmaintainable. EPUB accessibility tools rely on semantic class "
            "names to infer document structure. "
            "Fix: Name classes by structural role: .chapter-title, .footnote, .sidebar, .pull-quote. "
            "Example: <p class='footnote'>Note 1: Source text.</p> "
            "CSS: .footnote { font-size: 0.85em; margin-left: 2em; color: #555; }"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_017",
        "title": "Avoid vendor-prefixed properties without unprefixed fallback",
        "content": (
            "Problem: Using only vendor-prefixed CSS properties (e.g., -webkit-border-radius) without "
            "an unprefixed version means the property will not work on RS using other rendering engines. "
            "Fix: Always include the unprefixed standard property after any vendor-prefixed versions. "
            "Example: .box { "
            "-webkit-border-radius: 4px; "
            "-moz-border-radius: 4px; "
            "border-radius: 4px; }"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_018",
        "title": "Avoid CSS calc() with complex expressions in EPUB",
        "content": (
            "Problem: CSS calc() with mixed units or complex nested expressions has inconsistent support "
            "in EPUB3 RS. Simple calc() may work, but complex expressions (e.g., calc(100% - 2 * 1.5em + 4px)) "
            "may be ignored or incorrectly computed. "
            "Fix: Simplify calc() to two operands with simple mixed units, or use a fixed fallback. "
            "Example: Safe: width: calc(100% - 2em); "
            "Risky: width: calc(100% - 2em - 4px + 0.5rem); "
            "Provide a px fallback: width: 90%; width: calc(100% - 2em);"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_019",
        "title": "Set box-sizing: border-box globally for predictable layouts",
        "content": (
            "Problem: The default CSS box model (content-box) makes width calculations confusing when "
            "combined with padding and borders. This causes elements to overflow their containers in "
            "EPUB layouts when padding is added. "
            "Fix: Set box-sizing: border-box on all elements so that padding and border are included "
            "in the declared width/height. "
            "Example: *, *::before, *::after { box-sizing: border-box; } "
            "This prevents a .col { width: 50%; padding: 1em; } from exceeding 50% of its container."
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_020",
        "title": "Avoid CSS custom properties (variables) in EPUB2",
        "content": (
            "Problem: CSS custom properties (--my-color: #333; color: var(--my-color)) are not supported "
            "in EPUB2 RS or older EPUB3 RS. Relying on them will silently break color and spacing. "
            "Fix: Use direct color/spacing values in EPUB2. For EPUB3, provide fallback values before "
            "var() declarations. "
            "Example: p { color: #333; color: var(--body-color, #333); } "
            "The first declaration is the fallback for RS that do not support CSS variables."
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_021",
        "title": "Correct CSS selector specificity conflicts between RS and author styles",
        "content": (
            "Problem: When author CSS selectors have equal or lower specificity than RS default styles, "
            "author styles silently lose the cascade. This results in font, color, or spacing appearing "
            "differently than intended. "
            "Fix: Increase specificity by adding a parent class or ID to the selector. "
            "Example: If p { color: #333; } loses to RS styles, use: "
            "body p { color: #333; } or .epub-content p { color: #333; } "
            "Specificity values: inline (1000) > ID (100) > class (10) > element (1)."
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_022",
        "title": "Use text-indent for paragraph indentation instead of margin-top",
        "content": (
            "Problem: Using margin-top for paragraph separation without text-indent creates a double-spacing "
            "style that differs from typography conventions expected in book publishing. Many EPUB RS also "
            "add their own default paragraph margin. "
            "Fix: Use text-indent for first-line indent on body paragraphs and zero margin for joined "
            "paragraphs. Use margin for chapter/section breaks. "
            "Example: p { text-indent: 1.5em; margin: 0; } "
            "p.no-indent { text-indent: 0; } "
            ".chapter-start p:first-child { text-indent: 0; }"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_023",
        "title": "Handle CSS table layout for data tables in EPUB",
        "content": (
            "Problem: Complex HTML tables without explicit width and overflow handling overflow their "
            "containers on narrow EPUB RS screens. Tables wider than the viewport cause horizontal "
            "scrolling or clipping. "
            "Fix: Wrap tables in a div with overflow-x: auto (EPUB3) or make tables responsive "
            "with percentage column widths. Set max-width: 100% on the table element. "
            "Example: .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; } "
            "table { width: 100%; border-collapse: collapse; } "
            "td, th { padding: 0.5em; border: 1px solid #ccc; word-break: break-word; }"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_024",
        "title": "Properly style epub:type footnote and endnote elements",
        "content": (
            "Problem: Footnote and endnote elements styled only by position or tag name are inaccessible "
            "and may render inline with body text. EPUB3 defines specific epub:type values that should "
            "be used for semantic and visual differentiation. "
            "Fix: Style by epub:type attribute selector and ensure visual separation from body text. "
            "Example: [epub|type~='footnote'], [epub|type~='endnote'] { "
            "display: block; font-size: 0.8em; line-height: 1.4; "
            "margin-top: 0.5em; padding-left: 1em; "
            "border-left: 2px solid #ccc; color: #555; }"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_025",
        "title": "Avoid CSS filter and backdrop-filter in EPUB",
        "content": (
            "Problem: CSS filter (blur, drop-shadow, grayscale) and backdrop-filter properties are "
            "not supported in EPUB2 RS and have poor EPUB3 RS support. They silently have no effect or "
            "cause performance degradation. "
            "Fix: Replace filter effects with static alternatives: use box-shadow for drop shadows, "
            "use pre-processed grayscale images instead of filter: grayscale(). "
            "Example: Instead of img { filter: drop-shadow(2px 2px 4px #000); } "
            "use: img { box-shadow: 2px 2px 4px rgba(0,0,0,0.5); }"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_026",
        "title": "Set font-display for @font-face to swap or fallback",
        "content": (
            "Problem: Without font-display in @font-face, custom fonts in EPUB cause invisible text "
            "(FOIT - Flash of Invisible Text) while loading, which is particularly problematic on "
            "slower EPUB readers or when fonts fail to load. "
            "Fix: Add font-display: swap to @font-face declarations so fallback fonts render immediately. "
            "Example: @font-face { "
            "font-family: 'BookFont'; "
            "src: url('../fonts/bookfont.woff2') format('woff2'); "
            "font-display: swap; }"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_027",
        "title": "Use margin: 0 auto for horizontal centering of block elements",
        "content": (
            "Problem: Using text-align: center or position-based centering on block elements does not "
            "work as expected in all EPUB RS. text-align centers inline content, not block layout. "
            "Fix: For centering block-level elements (images, figures, tables), set an explicit width "
            "and use margin: 0 auto. "
            "Example: figure { display: block; width: 80%; max-width: 100%; margin: 1em auto; } "
            "For inline content centering: p.center { text-align: center; }"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_028",
        "title": "Avoid orphans and widows with CSS orphans/widows properties",
        "content": (
            "Problem: Single words or lines left at the top or bottom of a page (orphans/widows) degrade "
            "reading quality in paginated EPUB RS. Without orphans/widows CSS properties these cannot "
            "be controlled. "
            "Fix: Set orphans and widows on paragraph elements to a minimum of 2. "
            "Example: p { orphans: 2; widows: 2; } "
            "h1, h2, h3 { page-break-after: avoid; break-after: avoid; } "
            "This ensures at least 2 lines stay together at page breaks."
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_029",
        "title": "Embed only EPUB-allowed font formats (WOFF, WOFF2, TTF, OTF, SVG)",
        "content": (
            "Problem: EPUB3 core media types allow WOFF, WOFF2, TTF, OTF, and SVG fonts. "
            "Using EOT (Embedded OpenType) or other font formats not in the EPUB core media type list "
            "requires a fallback-required declaration in the OPF manifest. "
            "Fix: Use only WOFF2, WOFF, or TTF/OTF fonts in EPUB packages. "
            "Example: In OPF manifest: "
            "<item id='font1' href='fonts/myfont.woff2' media-type='font/woff2'/> "
            "<item id='font2' href='fonts/myfont.ttf' media-type='font/ttf'/>"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_030",
        "title": "Avoid CSS position: fixed in EPUB content",
        "content": (
            "Problem: position: fixed positions an element relative to the viewport and is not supported "
            "in most EPUB RS. Elements with position: fixed may appear at incorrect positions or be "
            "completely invisible. "
            "Fix: Remove position: fixed declarations. Use sticky headers or semantic EPUB structure "
            "instead of fixed navigation. "
            "Example: Avoid: .nav-bar { position: fixed; top: 0; } "
            "Use EPUB navigation landmarks instead via <nav epub:type='toc'>."
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_031",
        "title": "Use word-wrap and overflow-wrap for long strings",
        "content": (
            "Problem: Long URLs, code strings, or words without spaces cause horizontal overflow in "
            "narrow EPUB RS viewports, breaking the page layout. "
            "Fix: Apply word-wrap: break-word (legacy) and overflow-wrap: break-word (modern) on "
            "elements that may contain long strings. "
            "Example: p, li, td, code, pre { "
            "word-wrap: break-word; "
            "overflow-wrap: break-word; } "
            "pre { white-space: pre-wrap; }"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_032",
        "title": "Use CSS list-style-type and list-style-position correctly",
        "content": (
            "Problem: EPUB RS have inconsistent defaults for list indentation, bullet position, and "
            "list-style. Lists without explicit styling may render with bullets outside the content "
            "area or with excessive indentation. "
            "Fix: Explicitly set list-style-position, margin, and padding on ol and ul. "
            "Example: ul, ol { "
            "margin: 0.5em 0; "
            "padding-left: 2em; "
            "list-style-position: outside; } "
            "ul { list-style-type: disc; } "
            "ol { list-style-type: decimal; }"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_033",
        "title": "Avoid display: none for accessibility-critical content",
        "content": (
            "Problem: Content hidden with display: none is completely removed from the accessibility "
            "tree, making it invisible to screen readers. EPUB accessibility requires that all "
            "meaningful content be accessible to AT. "
            "Fix: Use CSS visually-hidden pattern for screen reader-only text, not display: none. "
            "Example: .visually-hidden { "
            "position: absolute; width: 1px; height: 1px; "
            "padding: 0; margin: -1px; overflow: hidden; "
            "clip: rect(0,0,0,0); white-space: nowrap; border: 0; } "
            "Use display: none only for decorative or truly hidden UI elements."
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_034",
        "title": "CSS hyphenation for justified text in EPUB",
        "content": (
            "Problem: Justified text (text-align: justify) in EPUB without hyphenation creates "
            "irregular word spacing gaps (rivers) that reduce readability, especially in narrow "
            "viewports. "
            "Fix: Pair text-align: justify with CSS hyphenation properties and the hyphens attribute "
            "for controlled word breaking. "
            "Example: p { "
            "text-align: justify; "
            "-webkit-hyphens: auto; "
            "-epub-hyphens: auto; "
            "hyphens: auto; "
            "word-spacing: -0.05em; }"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_035",
        "title": "Properly scope CSS rules to avoid bleedover between EPUB chapters",
        "content": (
            "Problem: Each EPUB spine item (XHTML file) loads in the same RS rendering context. "
            "Global CSS rules in one spine item stylesheet can bleed into other spine items if "
            "stylesheets are shared. "
            "Fix: Scope chapter-specific styles to a unique class on the body element. "
            "Example: In chapter1.xhtml: <body class='chapter-1'> "
            "In chapter1.css: .chapter-1 h1 { font-size: 2em; } "
            "This prevents .chapter-1 styles from affecting other chapters."
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_036",
        "title": "Use CSS counters for auto-numbering figures and tables",
        "content": (
            "Problem: Hard-coded figure and table numbers in HTML become incorrect when content is "
            "reordered or chapters are restructured. Using CSS counters auto-numbers figures and tables. "
            "Fix: Define CSS counters on the body and increment per figure/table. "
            "Example: body { counter-reset: figure-counter table-counter; } "
            "figure { counter-increment: figure-counter; } "
            "figure figcaption::before { content: 'Figure ' counter(figure-counter) ': '; "
            "font-weight: bold; }"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_037",
        "title": "CSS reset/normalize for consistent EPUB RS baseline",
        "content": (
            "Problem: Different EPUB RS apply different default stylesheets, causing inconsistent "
            "margins, padding, font sizes, and element display across reading systems. "
            "Fix: Include a minimal EPUB-targeted CSS reset at the top of the main stylesheet. "
            "Example: html, body { margin: 0; padding: 0; } "
            "h1, h2, h3, h4, h5, h6 { margin: 0.5em 0; font-weight: bold; } "
            "p { margin: 0; padding: 0; } "
            "img { max-width: 100%; height: auto; display: block; }"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_038",
        "title": "Avoid CSS SVG content-based clip-path in EPUB",
        "content": (
            "Problem: CSS clip-path with SVG path references (clip-path: url(#clip)) is unsupported "
            "in most EPUB3 RS and will be silently ignored, causing images to appear unclipped. "
            "Fix: Use simple CSS clip-path basic shapes if supported, or crop images at source. "
            "Example: Avoid: .banner { clip-path: url('#myClip'); } "
            "Use: .banner { overflow: hidden; border-radius: 8px; } "
            "Or pre-crop the image in the EPUB assets."
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_039",
        "title": "Declare charset in CSS files for EPUB",
        "content": (
            "Problem: CSS files in EPUB packages without a @charset declaration may be interpreted "
            "with an incorrect encoding by some RS, causing garbled non-ASCII characters in CSS "
            "string values (e.g., in content: properties using Unicode). "
            "Fix: Add @charset 'UTF-8'; as the very first line of each CSS file. "
            "Example: @charset 'UTF-8'; "
            "/* Main EPUB stylesheet */ "
            "body { font-family: serif; } "
            "Note: The @charset declaration must be the first thing in the file with no preceding whitespace."
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_040",
        "title": "Use epub:type-based landmark styling for NCX and nav",
        "content": (
            "Problem: EPUB3 navigation landmarks (TOC, index, bibliography) are defined using epub:type "
            "attributes on <nav> elements. Without CSS scoped to these landmarks, they may inherit "
            "body paragraph styles and appear unstyled. "
            "Fix: Add specific styles for epub:type navigation landmarks. "
            "Example: nav[epub|type~='toc'] { display: block; } "
            "nav[epub|type~='toc'] ol { list-style: none; padding-left: 0; } "
            "nav[epub|type~='toc'] a { text-decoration: none; color: inherit; }"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_041",
        "title": "Handle drop caps with float and :first-letter pseudo-element",
        "content": (
            "Problem: Drop caps implemented with absolute positioning or JavaScript break in reflowable "
            "EPUB. The CSS :first-letter pseudo-element with float is the correct EPUB-compatible approach. "
            "Fix: Use p.drop-cap::first-letter with float: left and appropriate sizing. "
            "Example: p.drop-cap::first-letter { "
            "float: left; "
            "font-size: 3em; "
            "line-height: 0.85; "
            "margin-right: 0.1em; "
            "margin-top: 0.05em; "
            "font-family: serif; }"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_042",
        "title": "Avoid CSS background-attachment: fixed in EPUB",
        "content": (
            "Problem: background-attachment: fixed creates a parallax-like fixed background tied to the "
            "viewport. This is unsupported in EPUB RS and will fall back to scroll behavior, often "
            "creating blank or incorrectly positioned backgrounds. "
            "Fix: Remove background-attachment: fixed and use background-attachment: scroll (the default) "
            "or background-attachment: local for scrollable element backgrounds. "
            "Example: .hero { background-image: url('cover.jpg'); background-attachment: scroll; "
            "background-size: cover; }"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_043",
        "title": "Properly declare CSS for EPUB fixed-layout viewport",
        "content": (
            "Problem: Fixed-layout EPUB spine items require a viewport meta tag and matching CSS "
            "viewport declaration. Without the correct viewport CSS, fixed-layout content does not "
            "scale correctly on different screen sizes. "
            "Fix: Declare the viewport in both the HTML meta tag and via CSS. Match CSS dimensions "
            "to the declared viewport. "
            "Example: HTML: <meta name='viewport' content='width=1024, height=768'/> "
            "CSS: @viewport { width: 1024px; height: 768px; } "
            "body { width: 1024px; height: 768px; overflow: hidden; }"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_044",
        "title": "Use CSS nth-child for alternating table row colors",
        "content": (
            "Problem: Table striping implemented with inline styles or JavaScript class toggles is "
            "fragile and inaccessible. CSS nth-child selectors provide a clean, maintainable solution "
            "that works in all EPUB3 RS. "
            "Fix: Use tr:nth-child(even) and tr:nth-child(odd) for table row color alternation. "
            "Example: table tbody tr:nth-child(even) { background-color: #f5f5f5; } "
            "table tbody tr:nth-child(odd) { background-color: #ffffff; } "
            "table thead tr { background-color: #1a8a9a; color: white; }"
        ),
        "domain": "css",
        "file_type": "css"
    },
    {
        "rule_id": "CSS_045",
        "title": "Ensure minimum touch target size 44x44px for interactive elements",
        "content": (
            "Problem: Links and interactive elements smaller than 44x44 CSS pixels are difficult to "
            "activate on touch screen EPUB readers, violating WCAG 2.5.5 Target Size guidelines. "
            "Fix: Set minimum dimensions on interactive elements using padding and min-height/min-width. "
            "Example: a, button { "
            "min-height: 44px; "
            "min-width: 44px; "
            "padding: 0.5em 1em; "
            "display: inline-block; "
            "line-height: 1; }"
        ),
        "domain": "css",
        "file_type": "css"
    },
]
