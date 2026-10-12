"""JavaScript Knowledge Base for EPUB scripting validation and guidance."""

JS_KB_ENTRIES = [
    {
        "rule_id": "JS_001",
        "title": "No eval() in EPUB scripted content",
        "content": (
            "Problem: Using eval() in EPUB scripted content is prohibited by most EPUB RS security "
            "policies. EPUB3 scripted content runs in a sandboxed iframe and eval() is typically "
            "blocked by the Content Security Policy. "
            "Fix: Replace eval() with safe alternatives. Use JSON.parse() for JSON data, Function "
            "constructor only when absolutely necessary, or restructure logic. "
            "Example: Avoid: eval('var x = ' + userInput); "
            "Use: var x = JSON.parse(userInput); "
            "Or for dynamic function calls: var fns = {doA: doA, doB: doB}; fns[fnName]();"
        ),
        "domain": "javascript",
        "file_type": "js"
    },
    {
        "rule_id": "JS_002",
        "title": "No XMLHttpRequest (XHR) or fetch in EPUB2 scripted content",
        "content": (
            "Problem: EPUB2 does not support scripted network requests (XHR, fetch). EPUB3 allows "
            "scripted content but most RS sandbox scripts and block cross-origin network requests. "
            "Any XHR or fetch to external URLs will fail silently or throw a security error. "
            "Fix: For EPUB2, remove all XHR/fetch calls. For EPUB3, only access data bundled within "
            "the EPUB package using relative paths. "
            "Example: Instead of fetch('https://api.example.com/data'), "
            "bundle the JSON data file in the EPUB: fetch('../data/quiz-data.json')."
        ),
        "domain": "javascript",
        "file_type": "js"
    },
    {
        "rule_id": "JS_003",
        "title": "Use DOMContentLoaded event instead of window.onload for EPUB scripts",
        "content": (
            "Problem: window.onload waits for all resources including images to load before firing. "
            "In EPUB readers, onload may never fire or fire unpredictably because of how RS loads "
            "spine items. DOMContentLoaded is more reliable. "
            "Fix: Wrap EPUB script initialization in a DOMContentLoaded listener. "
            "Example: document.addEventListener('DOMContentLoaded', function() { "
            "  initQuiz(); "
            "  setupInteractions(); "
            "}); "
            "Avoid: window.onload = function() { initQuiz(); };"
        ),
        "domain": "javascript",
        "file_type": "js"
    },
    {
        "rule_id": "JS_004",
        "title": "Declare scripted content in OPF with scripted property",
        "content": (
            "Problem: EPUB3 spine items that contain JavaScript must declare the 'scripted' property "
            "in the OPF manifest item element. Without this declaration, some RS will not execute scripts. "
            "Fix: Add properties='scripted' to the manifest item for each XHTML file that contains or "
            "links JavaScript. "
            "Example: <item id='ch01' href='chapter01.xhtml' "
            "media-type='application/xhtml+xml' properties='scripted'/> "
            "Also declare: <item id='myscript' href='scripts/quiz.js' "
            "media-type='application/javascript'/>"
        ),
        "domain": "javascript",
        "file_type": "js"
    },
    {
        "rule_id": "JS_005",
        "title": "Provide non-scripted fallback for all interactive EPUB content",
        "content": (
            "Problem: EPUB RS may disable scripts by default or users may disable scripting. "
            "All interactive scripted content must have a meaningful non-scripted fallback so the "
            "content remains accessible and usable. "
            "Fix: Use <noscript> elements or epub:type='aside' with a fallback description. "
            "Example: <div class='interactive-quiz'> "
            "  <noscript><p>This quiz requires scripting. Answers: 1. B, 2. C.</p></noscript> "
            "  <div id='quiz-container'></div> "
            "</div>"
        ),
        "domain": "javascript",
        "file_type": "js"
    },
    {
        "rule_id": "JS_006",
        "title": "Use ReadiumJS epubReadingSystem API for RS feature detection",
        "content": (
            "Problem: EPUB3 scripts that rely on specific RS features (e.g., media overlays, "
            "spine navigation) without checking for support will fail silently on RS that do not "
            "implement those features. "
            "Fix: Use the navigator.epubReadingSystem API to detect capabilities before using them. "
            "Example: if (navigator.epubReadingSystem) { "
            "  var rs = navigator.epubReadingSystem; "
            "  if (rs.hasFeature('mouse-events')) { "
            "    setupMouseInteractions(); "
            "  } "
            "  if (rs.hasFeature('touch-events')) { "
            "    setupTouchInteractions(); "
            "  } "
            "}"
        ),
        "domain": "javascript",
        "file_type": "js"
    },
    {
        "rule_id": "JS_007",
        "title": "Avoid localStorage and sessionStorage in EPUB scripts",
        "content": (
            "Problem: localStorage and sessionStorage are often blocked in EPUB RS sandboxed iframes "
            "due to origin isolation policies. Using them may throw SecurityError exceptions or "
            "silently fail, causing state loss. "
            "Fix: Use in-memory JavaScript objects for state within a session. For persistent state, "
            "check RS support before using storage APIs. "
            "Example: var quizState = { currentQuestion: 0, answers: [] }; "
            "Try-catch pattern: "
            "try { localStorage.setItem('progress', JSON.stringify(quizState)); } "
            "catch(e) { /* storage blocked, use in-memory only */ }"
        ),
        "domain": "javascript",
        "file_type": "js"
    },
    {
        "rule_id": "JS_008",
        "title": "Register epub:type-aware event handlers for footnote popups",
        "content": (
            "Problem: Footnote links in EPUB3 that are handled with generic click handlers miss the "
            "semantic context of epub:type='noteref'. Reading systems that natively handle noteref "
            "links may conflict with custom JS handlers, causing double popups or broken navigation. "
            "Fix: Check if the RS handles noteref natively before attaching custom handlers. "
            "Example: document.querySelectorAll('a[epub|type~=\"noteref\"]').forEach(function(link) { "
            "  link.addEventListener('click', function(e) { "
            "    if (!navigator.epubReadingSystem || "
            "        !navigator.epubReadingSystem.hasFeature('dom-manipulation')) { "
            "      e.preventDefault(); showFootnotePopup(this.getAttribute('href')); "
            "    } "
            "  }); "
            "});"
        ),
        "domain": "javascript",
        "file_type": "js"
    },
    {
        "rule_id": "JS_009",
        "title": "Polyfill MathML rendering with MathJax for RS without native MathML",
        "content": (
            "Problem: Not all EPUB3 RS support native MathML rendering. EPUB3 with MathML "
            "content will show raw XML tags or blank spaces in RS without MathML support. "
            "Fix: Bundle a lightweight MathJax or MathML polyfill within the EPUB package "
            "and load it only when native MathML is unavailable. "
            "Example: var hasMathML = typeof MathMLElement !== 'undefined'; "
            "if (!hasMathML) { "
            "  var script = document.createElement('script'); "
            "  script.src = '../scripts/mathjax-epub-min.js'; "
            "  document.head.appendChild(script); "
            "}"
        ),
        "domain": "javascript",
        "file_type": "js"
    },
    {
        "rule_id": "JS_010",
        "title": "Avoid document.write() in EPUB scripts",
        "content": (
            "Problem: document.write() is prohibited in EPUB3 and blocked in all modern RS. "
            "Calling document.write() in EPUB will either throw an error or silently fail, "
            "and in some RS it will completely erase the page content. "
            "Fix: Use DOM manipulation methods instead: createElement, appendChild, innerHTML. "
            "Example: Avoid: document.write('<p>Hello</p>'); "
            "Use: var p = document.createElement('p'); "
            "p.textContent = 'Hello'; "
            "document.body.appendChild(p);"
        ),
        "domain": "javascript",
        "file_type": "js"
    },
    {
        "rule_id": "JS_011",
        "title": "Handle touch and pointer events for EPUB tablet navigation",
        "content": (
            "Problem: EPUB interactive scripts that only handle mouse events (click, mouseover, "
            "mousedown) are unusable on touch-screen EPUB readers (tablets, phones) which use "
            "touch events. "
            "Fix: Add touch event listeners alongside mouse events, or use the unified Pointer Events API. "
            "Example: element.addEventListener('click', handleActivate); // handles both "
            "element.addEventListener('touchstart', function(e) { "
            "  e.preventDefault(); handleActivate(e); "
            "}, { passive: false });"
        ),
        "domain": "javascript",
        "file_type": "js"
    },
    {
        "rule_id": "JS_012",
        "title": "Use aria-live regions for dynamic content updates in EPUB",
        "content": (
            "Problem: Dynamic content injected by JavaScript (quiz feedback, progress updates) is "
            "not announced to screen readers unless wrapped in an ARIA live region. This makes "
            "interactive EPUB content inaccessible to users of assistive technology. "
            "Fix: Wrap dynamic feedback regions with aria-live='polite' and aria-atomic='true'. "
            "Example: HTML: <div id='feedback' aria-live='polite' aria-atomic='true'></div> "
            "JS: document.getElementById('feedback').textContent = 'Correct! Well done.'; "
            "The screen reader will announce the text content update."
        ),
        "domain": "javascript",
        "file_type": "js"
    },
    {
        "rule_id": "JS_013",
        "title": "Manage keyboard focus correctly in JS-driven EPUB interactions",
        "content": (
            "Problem: JavaScript interactions that show/hide content (modals, tabs, accordions) "
            "must manage keyboard focus correctly. Without focus management, keyboard users lose "
            "their position in the document after an interaction. "
            "Fix: Move focus to the newly revealed content using element.focus() after state changes. "
            "Return focus to the trigger element when content is closed. "
            "Example: function openModal(modalId, triggerEl) { "
            "  var modal = document.getElementById(modalId); "
            "  modal.removeAttribute('hidden'); "
            "  modal.querySelector('[tabindex=\"-1\"]').focus(); "
            "}"
        ),
        "domain": "javascript",
        "file_type": "js"
    },
    {
        "rule_id": "JS_014",
        "title": "Avoid setInterval for EPUB animations — use requestAnimationFrame",
        "content": (
            "Problem: setInterval-based animations in EPUB consume CPU continuously even when the "
            "spine item is not visible. This drains battery on mobile EPUB readers and causes "
            "jank in transitions. "
            "Fix: Use requestAnimationFrame for smooth animations and cancel the loop when the "
            "document loses focus or visibility. "
            "Example: var animFrame; "
            "function animate() { "
            "  updateAnimation(); "
            "  animFrame = requestAnimationFrame(animate); "
            "} "
            "document.addEventListener('visibilitychange', function() { "
            "  if (document.hidden) cancelAnimationFrame(animFrame); "
            "  else animate(); "
            "});"
        ),
        "domain": "javascript",
        "file_type": "js"
    },
    {
        "rule_id": "JS_015",
        "title": "Validate spine navigation with EPUB CFI for cross-document linking",
        "content": (
            "Problem: JavaScript that programmatically navigates between EPUB spine items using "
            "direct URL manipulation or window.location will fail in RS. Cross-document navigation "
            "must use EPUB Canonical Fragment Identifiers (CFI). "
            "Fix: Use the epubcfi() scheme for programmatic cross-document navigation in EPUB3. "
            "Example: var targetCFI = 'epubcfi(/6/4!/4/2/1:0)'; "
            "if (navigator.epubReadingSystem && navigator.epubReadingSystem.hasFeature('spine-scripting-api')) {"
            "  readium.reader.openContentUrl(targetCFI); "
            "} else { "
            "  window.location.href = '../chapter02.xhtml#section1'; "
            "}"
        ),
        "domain": "javascript",
        "file_type": "js"
    },
    {
        "rule_id": "JS_016",
        "title": "Avoid inline event handlers — use addEventListener",
        "content": (
            "Problem: Inline event handlers (onclick='doSomething()') in EPUB XHTML violate "
            "CSP rules enforced by EPUB3 RS and may be blocked. They also reduce maintainability. "
            "Fix: Remove all inline event handlers from HTML and use addEventListener in external "
            "JavaScript files. "
            "Example: Avoid: <button onclick='submitAnswer()'>Submit</button> "
            "Use: <button id='submit-btn'>Submit</button> "
            "JS: document.getElementById('submit-btn') "
            ".addEventListener('click', submitAnswer);"
        ),
        "domain": "javascript",
        "file_type": "js"
    },
    {
        "rule_id": "JS_017",
        "title": "Use strict mode in EPUB scripts to catch silent errors",
        "content": (
            "Problem: JavaScript in EPUB that runs without strict mode may silently swallow "
            "errors (undeclared variables, improper this binding) that cause hard-to-debug "
            "rendering failures across different RS JavaScript engines. "
            "Fix: Add 'use strict'; at the top of each JavaScript file or function. "
            "Example: (function() { "
            "  'use strict'; "
            "  var quizData = loadQuizData(); "
            "  initializeQuiz(quizData); "
            "})(); "
            "Strict mode prevents implicit global variables and other silent failures."
        ),
        "domain": "javascript",
        "file_type": "js"
    },
    {
        "rule_id": "JS_018",
        "title": "Debounce resize and scroll events in EPUB scripts",
        "content": (
            "Problem: Attaching heavy computation to resize or scroll events without debouncing "
            "causes performance issues on EPUB readers, especially e-ink devices with slow refresh "
            "rates. "
            "Fix: Wrap resize/scroll handlers with a debounce function that delays execution. "
            "Example: function debounce(fn, wait) { "
            "  var timeout; "
            "  return function() { "
            "    clearTimeout(timeout); "
            "    timeout = setTimeout(fn, wait); "
            "  }; "
            "} "
            "window.addEventListener('resize', debounce(recalculateLayout, 250));"
        ),
        "domain": "javascript",
        "file_type": "js"
    },
    {
        "rule_id": "JS_019",
        "title": "Use data attributes for configuration — avoid global variables",
        "content": (
            "Problem: EPUB scripts that store configuration in global JavaScript variables risk "
            "conflicts when multiple spine items share the same script file. Global state "
            "persists across spine items in some RS. "
            "Fix: Store configuration in HTML data attributes on the document or container element. "
            "Read configuration from the DOM in JavaScript. "
            "Example: HTML: <div id='quiz' data-questions='5' data-shuffle='true'> "
            "JS: var container = document.getElementById('quiz'); "
            "var numQuestions = parseInt(container.dataset.questions, 10); "
            "var shuffle = container.dataset.shuffle === 'true';"
        ),
        "domain": "javascript",
        "file_type": "js"
    },
    {
        "rule_id": "JS_020",
        "title": "Provide accessible SVG interactivity with role and tabindex",
        "content": (
            "Problem: Interactive SVG elements in EPUB (clickable diagram regions, interactive "
            "charts) are not keyboard-accessible by default. SVG elements lack implicit ARIA "
            "roles and are not in the tab order. "
            "Fix: Add role='button', tabindex='0', and keyboard event handlers to interactive SVG "
            "elements. "
            "Example: svgElement.setAttribute('role', 'button'); "
            "svgElement.setAttribute('tabindex', '0'); "
            "svgElement.setAttribute('aria-label', 'Click to reveal answer'); "
            "svgElement.addEventListener('keydown', function(e) { "
            "  if (e.key === 'Enter' || e.key === ' ') { handleClick(); } "
            "});"
        ),
        "domain": "javascript",
        "file_type": "js"
    },
    {
        "rule_id": "JS_021",
        "title": "Avoid external CDN scripts in EPUB — bundle all JS within the package",
        "content": (
            "Problem: EPUB scripts that load external libraries from CDNs "
            "(e.g., <script src='https://cdn.jsdelivr.net/...'>) will fail in offline EPUB RS "
            "or RS that block external network access. EPUB is designed to be a self-contained format. "
            "Fix: Bundle all JavaScript dependencies within the EPUB package and reference them "
            "with relative paths. "
            "Example: Avoid: <script src='https://cdn.jsdelivr.net/npm/chart.js'></script> "
            "Use: <script src='../scripts/vendor/chart.min.js'></script> "
            "Declare in OPF manifest: <item id='chartjs' href='scripts/vendor/chart.min.js' "
            "media-type='application/javascript'/>"
        ),
        "domain": "javascript",
        "file_type": "js"
    },
    {
        "rule_id": "JS_022",
        "title": "Handle EPUB media overlay sync with JavaScript",
        "content": (
            "Problem: EPUB3 Media Overlays (text-audio synchronization) require that JavaScript "
            "in the same spine item does not manipulate the DOM in ways that break media overlay "
            "element targeting. DOM structure changes by scripts invalidate overlay EPUB CFI references. "
            "Fix: Avoid dynamically restructuring the DOM after page load in media overlay spine items. "
            "If JS adds content, append it outside the overlay-synced region. "
            "Example: var overlayRegion = document.querySelector('[epub|type~=\"bodymatter\"]'); "
            "var dynamicContent = document.getElementById('dynamic-sidebar'); "
            "// Append outside overlay region to avoid CFI invalidation "
            "document.body.appendChild(dynamicContent);"
        ),
        "domain": "javascript",
        "file_type": "js"
    },
    {
        "rule_id": "JS_SYNTAX_FIX",
        "title": "Fixing JavaScript syntax errors in EPUB scripts",
        "content": (
            "Problem (JS_SCRIPT_SYNTAX): JavaScript syntax errors prevent the script from parsing. "
            "The Node.js vm.Script() parser catches these at validation time. "
            "Common errors: missing closing brace }, unclosed string literal, unexpected token, "
            "use of reserved keywords as variable names, trailing comma in object literal. "
            "Fix strategy: Identify the exact error from the parser message. "
            "Common fixes: Add missing } at end of function/block. "
            "Close unclosed strings with matching quote (' or \"). "
            "Remove trailing comma: {a:1, b:2,} → {a:1, b:2}. "
            "Rename reserved-word identifiers: var class → var className. "
            "Output only the corrected code snippet, not the entire file."
        ),
        "domain": "javascript",
        "file_type": "js",
    },
    {
        "rule_id": "JS_UNSUPPORTED_API_FIX",
        "title": "Replacing unsupported APIs in EPUB scripted content",
        "content": (
            "Problem (JS_UNSUPPORTED_API): APIs blocked in EPUB reading system sandboxes. "
            "fetch() → Use JSON data bundled in EPUB: load('../data/content.json') via XMLHttpRequest to local path. "
            "localStorage → Use in-memory variable: var store = {}; (data lost between sessions). "
            "sessionStorage → Use var sessionData = {}; "
            "eval() → Replace with direct logic or JSON.parse() for data parsing. "
            "WebSocket → Remove; no real-time connections in EPUB. "
            "document.write() → Use element.innerHTML = content; "
            "window.open() → Use internal EPUB anchor <a href='../chapter.html'>link</a>. "
            "ServiceWorker → Remove; not available in EPUB context. "
            "import() dynamic → Bundle dependencies statically at EPUB build time. "
            "Worker/SharedWorker → Run synchronously or pre-compute data. "
            "Key principle: EPUB is offline, sandboxed, no network. All data must be packaged."
        ),
        "domain": "javascript",
        "file_type": "js",
    },
    {
        "rule_id": "JS_EVENT_HANDLER_FIX",
        "title": "Converting inline event handlers to addEventListener",
        "content": (
            "Problem (JS_EVENT_HANDLER_ATTRIBUTE): Inline onclick/onload/etc. attributes blocked by CSP. "
            "Fix: Move all event handling to external JS using addEventListener. "
            "Pattern: "
            "HTML: <button id='btn-quiz'>Start Quiz</button> "
            "JS: document.getElementById('btn-quiz').addEventListener('click', function() { startQuiz(); }); "
            "For onload: document.addEventListener('DOMContentLoaded', function() { initPage(); }); "
            "For multiple elements: document.querySelectorAll('.interactive').forEach(function(el) { "
            "  el.addEventListener('click', handleClick); }); "
            "The fix value should be an addEventListener statement targeting the element by id or class."
        ),
        "domain": "javascript",
        "file_type": "js",
    },
    {
        "rule_id": "JS_MODULE_SCRIPT_FIX",
        "title": "Converting ES module scripts to EPUB-compatible IIFE pattern",
        "content": (
            "Problem (JS_MODULE_SCRIPT): type='module' not supported on most EPUB reading systems. "
            "Fix: Convert module to Immediately Invoked Function Expression (IIFE). "
            "Before: <script type='module'> import { quiz } from './quiz.js'; quiz.init(); </script> "
            "After: <script> (function() { /* paste bundled module code here */ quiz.init(); })(); </script> "
            "Or use a build tool (webpack, rollup, esbuild) to bundle the module into a single file. "
            "The bundle file is then referenced as a classic script without type='module'. "
            "Remove the type='module' attribute and ensure all imports are resolved before EPUB packaging."
        ),
        "domain": "javascript",
        "file_type": "js",
    },
    {
        "rule_id": "JS_MANIFEST_FIX",
        "title": "Adding missing JavaScript files to EPUB OPF manifest",
        "content": (
            "Problem (JS_SCRIPT_REFERENCE_MISSING_MANIFEST): Script file present but not in OPF manifest. "
            "Fix: Add item element to the manifest section of the .opf file. "
            "The media-type for JavaScript is 'application/javascript'. "
            "Example manifest item to add: "
            "<item id='script-interactions' href='js/interactions.js' media-type='application/javascript'/> "
            "The href must be relative to the OPF file location. "
            "The id must be unique within the manifest. "
            "Naming convention: use 'script-' prefix + filename without extension as id."
        ),
        "domain": "javascript",
        "file_type": "js",
    },
]
