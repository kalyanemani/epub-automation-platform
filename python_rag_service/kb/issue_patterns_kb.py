"""
Issue-pattern knowledge base — one entry per validation rule ID the Node.js
EPUB-Analysis service can emit. Used by hybrid search to deliver targeted fix
context when an issue is detected.

Pattern per entry: what causes the issue, how to fix it, concrete before/after.
"""

ISSUE_PATTERNS_KB_ENTRIES = [

    # ─────────────────────────────────────────────────────────────────────────
    # STRUCTURE — mimetype & container
    # ─────────────────────────────────────────────────────────────────────────
    {
        "rule_id": "S_MIMETYPE",
        "title": "Invalid or missing mimetype file",
        "content": (
            "Problem: The EPUB container must contain a file named 'mimetype' as the very first entry "
            "in the ZIP archive with no compression (stored), containing exactly the string "
            "'application/epub+zip' (no trailing newline, no BOM). "
            "Fix: Ensure the mimetype file is stored uncompressed as the first ZIP entry. "
            "The file must contain only: application/epub+zip "
            "When repacking: use 'zip -X0' for the mimetype entry before adding all other files."
        ),
        "domain": "structure",
        "file_type": "opf",
    },
    {
        "rule_id": "S_MIMETYPE_CONTENT",
        "title": "mimetype file has incorrect content",
        "content": (
            "Problem: The mimetype file exists but does not contain 'application/epub+zip'. "
            "Common errors: trailing newline, extra whitespace, BOM characters, wrong MIME string. "
            "Fix: Overwrite the mimetype file with exactly: application/epub+zip (no newline, no BOM). "
            "In Python: open('mimetype', 'wb').write(b'application/epub+zip')"
        ),
        "domain": "structure",
        "file_type": "opf",
    },
    {
        "rule_id": "S_MIMETYPE_MISSING",
        "title": "mimetype file is absent from the EPUB archive",
        "content": (
            "Problem: The EPUB ZIP archive does not contain a mimetype file at all. "
            "EPUB readers check for this file first to confirm the container type. "
            "Fix: Create the mimetype file as the first uncompressed entry in the archive: "
            "content = 'application/epub+zip', no compression (store mode), first entry in ZIP. "
            "Rebuild the archive placing mimetype first: zip -X0 book.epub mimetype && "
            "zip -rg book.epub META-INF/ OEBPS/"
        ),
        "domain": "structure",
        "file_type": "opf",
    },
    {
        "rule_id": "S_CONTAINER_MISSING",
        "title": "META-INF/container.xml is absent",
        "content": (
            "Problem: The EPUB ZIP archive does not contain META-INF/container.xml. "
            "This file tells reading systems where to find the OPF package document. "
            "Fix: Create META-INF/container.xml with the correct rootfile path: "
            "<?xml version='1.0'?><container version='1.0' "
            "xmlns='urn:oasis:names:tc:opendocument:xmlns:container'>"
            "<rootfiles><rootfile full-path='OEBPS/content.opf' "
            "media-type='application/oebps-package+xml'/></rootfiles></container> "
            "Adjust full-path to match your actual OPF file location."
        ),
        "domain": "structure",
        "file_type": "opf",
    },
    {
        "rule_id": "S_OPF_MISSING",
        "title": "OPF package document not found at declared path",
        "content": (
            "Problem: container.xml declares a rootfile path but the OPF file does not exist "
            "at that path inside the archive. "
            "Fix: Either create the OPF file at the declared path, or update container.xml "
            "to point to the correct existing OPF file. "
            "Verify paths are case-sensitive and match exactly (EPUB paths are case-sensitive). "
            "Example fix in container.xml: change full-path='OEBPS/Content.opf' to "
            "full-path='OEBPS/content.opf' if the file is lowercase."
        ),
        "domain": "structure",
        "file_type": "opf",
    },
    {
        "rule_id": "S_OPF_INVALID",
        "title": "OPF package document is not well-formed XML",
        "content": (
            "Problem: The OPF file cannot be parsed as XML — syntax errors such as unclosed tags, "
            "invalid attribute values, or mismatched namespace prefixes. "
            "Fix: Validate the OPF file as XML. Common errors: "
            "1) Unescaped & in href attributes — use &amp; "
            "2) Unclosed empty elements — use <item ... /> not <item ...> "
            "3) Mismatched closing tags "
            "4) Invalid characters in attribute values. "
            "Use xmllint --noout content.opf to find the exact line number."
        ),
        "domain": "structure",
        "file_type": "opf",
    },
    {
        "rule_id": "S_VERSION",
        "title": "EPUB version attribute missing or invalid",
        "content": (
            "Problem: The OPF <package> element is missing the version attribute or has an "
            "unrecognized value. Valid values: '2.0' (EPUB 2), '3.0' or '3.1' (EPUB 3). "
            "Fix: Add or correct the version attribute on the root <package> element: "
            "<package version='3.0' xmlns='http://www.idpf.org/2007/opf' "
            "unique-identifier='uid'> "
            "For EPUB3 also ensure the xmlns declaration is correct."
        ),
        "domain": "structure",
        "file_type": "opf",
    },
    {
        "rule_id": "S_UNIQUE_ID",
        "title": "OPF package unique-identifier attribute missing",
        "content": (
            "Problem: The <package> element's unique-identifier attribute does not reference any "
            "<dc:identifier> id in the metadata, or the attribute is absent. "
            "Fix: 1) Add unique-identifier='uid' to the <package> element. "
            "2) Ensure a <dc:identifier id='uid'> element exists in <metadata>. "
            "Example: <package unique-identifier='uid'> ... "
            "<metadata><dc:identifier id='uid'>urn:uuid:12345678-abcd</dc:identifier></metadata>"
        ),
        "domain": "structure",
        "file_type": "opf",
    },
    {
        "rule_id": "S_UNIQUE_ID_INVALID",
        "title": "Unique identifier value is blank or malformed",
        "content": (
            "Problem: The dc:identifier element referenced by unique-identifier is empty "
            "or contains only whitespace. "
            "Fix: Provide a valid globally-unique identifier. Preferred format: "
            "URN UUID: urn:uuid:<valid-uuid-v4> "
            "Or ISBN: urn:isbn:978XXXXXXXXXX "
            "Example: <dc:identifier id='uid'>urn:uuid:550e8400-e29b-41d4-a716-446655440000</dc:identifier>"
        ),
        "domain": "structure",
        "file_type": "opf",
    },
    {
        "rule_id": "S_MANIFEST_EMPTY",
        "title": "OPF manifest contains no items",
        "content": (
            "Problem: The <manifest> element in the OPF file has no <item> children, making "
            "the EPUB unreadable. "
            "Fix: Add an <item> element for every file in the EPUB: content documents, stylesheets, "
            "images, fonts, the NCX, and the nav document. Each item needs: id, href (relative to OPF), "
            "and media-type. "
            "Example: <item id='c1' href='Text/chapter1.xhtml' media-type='application/xhtml+xml'/>"
        ),
        "domain": "structure",
        "file_type": "opf",
    },
    {
        "rule_id": "S_MANIFEST_DUP_IDS",
        "title": "Duplicate id attributes in OPF manifest",
        "content": (
            "Problem: Two or more <item> elements in the manifest share the same id attribute value. "
            "EPUB readers may fail to load the book or load the wrong item. "
            "Fix: Make all manifest item ids unique. Use a consistent scheme: "
            "text-chapter01, img-cover, css-main, font-body. "
            "Example fix: <item id='chapter01' .../> and <item id='chapter02' .../> instead of two 'chapter01'."
        ),
        "domain": "structure",
        "file_type": "opf",
    },
    {
        "rule_id": "S_MANIFEST_ITEMS_INVALID",
        "title": "Manifest item href does not exist in the archive",
        "content": (
            "Problem: One or more manifest <item> elements reference files (via href) that do not "
            "exist in the EPUB ZIP archive. "
            "Fix: Either add the missing file to the archive or remove the orphaned manifest entry. "
            "Check case sensitivity — 'Chapter1.xhtml' != 'chapter1.xhtml'. "
            "Check that paths are relative to the OPF file's directory. "
            "Also verify correct media-type: XHTML must be application/xhtml+xml, "
            "not text/html."
        ),
        "domain": "structure",
        "file_type": "opf",
    },
    {
        "rule_id": "S_SPINE_EMPTY",
        "title": "OPF spine has no itemrefs",
        "content": (
            "Problem: The <spine> element contains no <itemref> children — no reading order defined. "
            "EPUB readers cannot determine what content to display. "
            "Fix: Add an <itemref idref='...'/> for each chapter/content document in reading order. "
            "Every idref must match a manifest item id. "
            "Example: <spine toc='ncx'><itemref idref='chapter01'/><itemref idref='chapter02'/></spine>"
        ),
        "domain": "structure",
        "file_type": "opf",
    },
    {
        "rule_id": "S_SPINE_DUP_IDREFS",
        "title": "Duplicate idref values in OPF spine",
        "content": (
            "Problem: Two or more <itemref> elements in the spine have the same idref, causing "
            "the same content document to appear twice in the reading order. "
            "Fix: Remove duplicate <itemref> entries. Each content document should appear exactly once "
            "in the spine unless intentional (rare). "
            "Audit the spine for repeated idrefs: <itemref idref='chapter01'/> appearing twice."
        ),
        "domain": "structure",
        "file_type": "opf",
    },
    {
        "rule_id": "S_SPINE_ITEMREFS_INVALID",
        "title": "Spine itemref references non-existent manifest id",
        "content": (
            "Problem: A spine <itemref idref='X'/> references an id that does not exist in the manifest. "
            "Fix: Ensure every spine idref matches a manifest item id exactly (case-sensitive). "
            "Add missing manifest items or correct the idref typo. "
            "Example: spine has idref='ch01' but manifest has id='chapter01' — fix by matching both."
        ),
        "domain": "structure",
        "file_type": "opf",
    },
    {
        "rule_id": "S_SPINE_NO_TOC",
        "title": "Spine missing toc attribute (EPUB2) or nav document (EPUB3)",
        "content": (
            "Problem: EPUB2 spine must have toc='ncx-id' pointing to the NCX manifest item. "
            "EPUB3 must have a manifest item with properties='nav' (the nav document). "
            "Fix for EPUB2: <spine toc='ncx'> where 'ncx' is the manifest id of the NCX file. "
            "Fix for EPUB3: Add to manifest: <item id='nav' href='nav.xhtml' "
            "media-type='application/xhtml+xml' properties='nav'/> and include it in spine."
        ),
        "domain": "structure",
        "file_type": "opf",
    },
    {
        "rule_id": "S_BROKEN_INTERNAL_LINKS",
        "title": "Broken internal anchor links in content documents",
        "content": (
            "Problem: Hyperlinks within the EPUB (href='chapter2.xhtml#section3') point to anchors "
            "or files that do not exist, causing 'page not found' in reading systems. "
            "Fix: 1) Verify all href targets exist as files in the manifest. "
            "2) Verify all fragment identifiers (#section3) match an id='section3' in the target file. "
            "3) Use relative paths from the source file's directory. "
            "Example fix: <a href='../Text/chapter2.xhtml#sec-intro'> requires id='sec-intro' "
            "in chapter2.xhtml."
        ),
        "domain": "structure",
        "file_type": "xhtml",
    },
    {
        "rule_id": "S_NO_NAVIGATION",
        "title": "EPUB has no navigation document (no NCX or nav.xhtml)",
        "content": (
            "Problem: The EPUB has neither an NCX file (EPUB2) nor a nav.xhtml with properties='nav' "
            "(EPUB3). Reading systems need a navigation document to provide a table of contents. "
            "Fix for EPUB3: Create nav.xhtml with epub:type='toc' ol structure and add to manifest "
            "with properties='nav'. "
            "Fix for EPUB2: Create toc.ncx with navMap entries and declare in spine toc attribute. "
            "Minimum nav.xhtml: <nav epub:type='toc'><ol><li><a href='chapter1.xhtml'>Chapter 1</a></li></ol></nav>"
        ),
        "domain": "structure",
        "file_type": "xhtml",
    },
    {
        "rule_id": "S_ORPHAN_FILES",
        "title": "Files in archive not referenced by any manifest item",
        "content": (
            "Problem: The EPUB archive contains files that are not listed in the OPF manifest. "
            "These orphan files waste space and may confuse reading systems. "
            "Fix: Either add manifest <item> entries for the orphan files (if they should be included) "
            "or remove the files from the archive. "
            "Common orphans: leftover images, old CSS files, editor temp files (.DS_Store, Thumbs.db). "
            "Delete editor artifacts; add content files to manifest with correct media-type."
        ),
        "domain": "structure",
        "file_type": "opf",
    },
    {
        "rule_id": "UNREFERENCED_MEDIA",
        "title": "Image or media files in manifest but not used in any content document",
        "content": (
            "Problem: Images, audio, or video files are listed in the manifest but never referenced "
            "in any content document (src, href, data attributes). "
            "Fix: Remove unreferenced media files from both the manifest and the archive to reduce "
            "EPUB size, or verify they should be referenced and add the missing img/audio/video tags. "
            "Exception: the cover image may be declared in metadata without appearing in content."
        ),
        "domain": "structure",
        "file_type": "opf",
    },
    {
        "rule_id": "MULTIPLE_COVERS",
        "title": "Multiple conflicting cover image declarations",
        "content": (
            "Problem: The EPUB declares more than one cover image via guide elements, OPF metadata "
            "meta name='cover', or manifest properties='cover-image'. "
            "Fix: Use exactly one cover declaration. For EPUB3, add properties='cover-image' to the "
            "correct manifest item and remove all guide cover references. "
            "For EPUB2, use <meta name='cover' content='cover-image-manifest-id'/> once. "
            "Remove any <guide><reference type='cover' .../></guide> entries if using EPUB3 cover."
        ),
        "domain": "structure",
        "file_type": "opf",
    },

    # ─────────────────────────────────────────────────────────────────────────
    # NCX — table of contents (EPUB2 / EPUB3 compatibility)
    # ─────────────────────────────────────────────────────────────────────────
    {
        "rule_id": "NCX_DUPLICATE_IDS",
        "title": "Duplicate id attributes in NCX file",
        "content": (
            "Problem: Two or more navPoint or navTarget elements share the same id attribute in "
            "the NCX file, which violates EPUB2 spec and causes unpredictable navigation. "
            "Fix: Assign unique ids to every navPoint and navTarget. Use a systematic scheme like "
            "navPoint-1, navPoint-2, or chapter-1-navpoint. "
            "Example fix: <navPoint id='navPoint-1'> ... <navPoint id='navPoint-2'> "
            "instead of two elements with id='navPoint-1'."
        ),
        "domain": "structure",
        "file_type": "ncx",
    },
    {
        "rule_id": "NCX_PLAYORDER_INVALID",
        "title": "NCX navPoint playOrder values not sequential integers",
        "content": (
            "Problem: navPoint playOrder attributes are missing, duplicated, or not sequential "
            "integers starting from 1. Reading systems use playOrder for linear navigation. "
            "Fix: Re-number all navPoint playOrder attributes as consecutive integers starting at 1 "
            "in document order (depth-first traversal). "
            "Example: top-level chapters get 1, 2, 3; sub-sections get 4, 5 (depth-first, not nested). "
            "<navPoint playOrder='1'><navPoint playOrder='2'>"
        ),
        "domain": "structure",
        "file_type": "ncx",
    },
    {
        "rule_id": "NCX_SPINE_CONTENT_MISMATCH",
        "title": "NCX navMap entries do not match OPF spine reading order",
        "content": (
            "Problem: The NCX navMap references documents in a different order than the OPF spine, "
            "or references documents not in the spine. Users see mismatched table of contents. "
            "Fix: Rebuild the NCX navMap to match the spine reading order exactly. Every spine item "
            "that represents a chapter should have a corresponding navPoint. "
            "Check: extract all src hrefs from navMap and compare to OPF itemref idrefs resolved to hrefs."
        ),
        "domain": "structure",
        "file_type": "ncx",
    },
    {
        "rule_id": "NCX_PHANTOM_ENTRIES",
        "title": "NCX navPoint points to a file that does not exist",
        "content": (
            "Problem: One or more NCX navPoint <content src='...'> values reference files or "
            "fragment IDs that do not exist in the EPUB archive. "
            "Fix: Either remove the phantom navPoint entries or create the missing files. "
            "For dead fragment references (#anchor): add the corresponding id attribute to the target file. "
            "Audit: extract all navPoint src values and verify each file+fragment exists in the archive."
        ),
        "domain": "structure",
        "file_type": "ncx",
    },
    {
        "rule_id": "NCX_PAGELIST_PLAYORDER",
        "title": "NCX pageList navTarget playOrder not sequential",
        "content": (
            "Problem: The NCX pageList section contains navTarget elements whose playOrder values "
            "are not sequential or conflict with navMap playOrder values. "
            "Fix: Assign pageList navTarget playOrder values that continue after the last navMap "
            "playOrder value. Or renumber all playOrder globally in document order. "
            "NCX spec requires playOrder to be unique across ALL navPoint and navTarget elements."
        ),
        "domain": "structure",
        "file_type": "ncx",
    },
    {
        "rule_id": "NCX_PAGELIST_VALUE_TEXT_MISMATCH",
        "title": "NCX pageList navLabel text does not match page value",
        "content": (
            "Problem: The navLabel text inside a pageList navTarget does not match the value attribute, "
            "causing reading systems to display incorrect page labels. "
            "Fix: Make navLabel/text match the value attribute. "
            "Example: <navTarget value='10'><navLabel><text>10</text></navLabel> — the text must "
            "match the numeric value. For Roman numerals: value='xii' text='xii'."
        ),
        "domain": "structure",
        "file_type": "ncx",
    },
    {
        "rule_id": "NCX_PAGELIST_NOT_MONOTONIC",
        "title": "NCX pageList values are not monotonically increasing",
        "content": (
            "Problem: The value attributes in NCX pageList navTargets do not increase monotonically "
            "(e.g., page 10 appears before page 8). Reading systems rely on this order for page nav. "
            "Fix: Sort navTarget elements by their numeric value attributes in ascending order. "
            "Handle mixed Roman/Arabic numbering by sorting within each section separately."
        ),
        "domain": "structure",
        "file_type": "ncx",
    },
    {
        "rule_id": "NCX_BROKEN_FRAGMENTS",
        "title": "NCX navPoint content src fragment IDs do not resolve",
        "content": (
            "Problem: NCX navPoint content src attributes contain fragment identifiers (#id) that "
            "do not exist as id attributes in the target HTML file. "
            "Fix: Add the missing id attributes to the target content documents, or update the NCX "
            "src to point to the correct existing fragment id. "
            "Example: src='chapter1.xhtml#section-2' requires <h2 id='section-2'> in chapter1.xhtml."
        ),
        "domain": "structure",
        "file_type": "ncx",
    },
    {
        "rule_id": "NCX_NAV_PAGELIST_MISMATCH",
        "title": "NCX pageList and EPUB3 nav page-list do not agree",
        "content": (
            "Problem: The EPUB contains both an NCX pageList and an EPUB3 nav page-list, but they "
            "reference different pages or files. Reading systems may show inconsistent page numbers. "
            "Fix: Synchronize both page lists to reference the same page break locations. "
            "Prefer the EPUB3 nav page-list as canonical; regenerate the NCX from it. "
            "Or remove the NCX pageList if targeting EPUB3-only reading systems."
        ),
        "domain": "structure",
        "file_type": "ncx",
    },

    # ─────────────────────────────────────────────────────────────────────────
    # NAV — EPUB3 navigation document
    # ─────────────────────────────────────────────────────────────────────────
    {
        "rule_id": "NAV_TOC_PHANTOM_ENTRIES",
        "title": "EPUB3 nav TOC links point to non-existent targets",
        "content": (
            "Problem: One or more <a href> links in the nav.xhtml toc nav element point to files "
            "or fragment IDs that do not exist in the archive. "
            "Fix: Remove phantom nav entries or create the missing files/fragments. "
            "Example: <a href='chapter5.xhtml'> in nav but chapter5.xhtml not in archive — "
            "add the file or remove the nav entry."
        ),
        "domain": "structure",
        "file_type": "xhtml",
    },
    {
        "rule_id": "NAV_SPINE_MISMATCH",
        "title": "EPUB3 nav TOC entries do not match spine reading order",
        "content": (
            "Problem: The nav.xhtml table of contents references documents in different order than "
            "the OPF spine, confusing users navigating by TOC vs. reading linearly. "
            "Fix: Rebuild nav TOC entries to match spine order. Every spine document (except "
            "properties='nav' itself) should have a nav entry. "
            "Nav may include non-spine items (covers, copyright pages) but spine order takes precedence."
        ),
        "domain": "structure",
        "file_type": "xhtml",
    },
    {
        "rule_id": "NAV_PAGE_LIST",
        "title": "EPUB3 nav page-list structure is invalid",
        "content": (
            "Problem: The nav.xhtml page-list nav (epub:type='page-list') is malformed — "
            "missing required epub:type, non-sequential page values, or broken href targets. "
            "Fix: Ensure the page-list nav has epub:type='page-list', contains an <ol> with <li><a> "
            "entries, and every href points to a valid epub:type='pagebreak' element in the content. "
            "Example: <nav epub:type='page-list'><ol><li><a href='ch1.xhtml#page1'>1</a></li></ol></nav>"
        ),
        "domain": "structure",
        "file_type": "xhtml",
    },
    {
        "rule_id": "NAV_TOC_BROKEN_FRAGMENTS",
        "title": "EPUB3 nav TOC fragment IDs do not resolve in target files",
        "content": (
            "Problem: nav.xhtml TOC <a href='chapter.xhtml#heading-id'> references a fragment that "
            "has no matching id attribute in the target content document. "
            "Fix: Add the missing id attribute to the heading or section element in the target file. "
            "Example: nav links to #chapter-3-intro — add id='chapter-3-intro' to the relevant <h2> "
            "or <section> element in the content document."
        ),
        "domain": "structure",
        "file_type": "xhtml",
    },

    # ─────────────────────────────────────────────────────────────────────────
    # METADATA — OPF package metadata
    # ─────────────────────────────────────────────────────────────────────────
    {
        "rule_id": "M_IDENTIFIER",
        "title": "Missing required dc:identifier in OPF metadata",
        "content": (
            "Problem: The OPF metadata block does not contain a <dc:identifier> element, which is "
            "required in both EPUB2 and EPUB3. Without it, the EPUB cannot be uniquely identified. "
            "Fix: Add a dc:identifier with a unique id that matches the package unique-identifier. "
            "Example: <dc:identifier id='uid'>urn:uuid:550e8400-e29b-41d4-a716-446655440000</dc:identifier> "
            "then set <package unique-identifier='uid'> on the root element."
        ),
        "domain": "metadata",
        "file_type": "opf",
    },
    {
        "rule_id": "M_IDENTIFIER_UUID",
        "title": "dc:identifier should use URN UUID format",
        "content": (
            "Problem: The dc:identifier value is not a properly formatted URN UUID. "
            "EPUB3 best practice requires urn:uuid: prefix with a valid version 4 UUID. "
            "Fix: Format the identifier as: urn:uuid:<8>-<4>-<4>-<4>-<12> hex digits. "
            "Example: urn:uuid:550e8400-e29b-41d4-a716-446655440000 "
            "Generate with Python: import uuid; f'urn:uuid:{uuid.uuid4()}'"
        ),
        "domain": "metadata",
        "file_type": "opf",
    },
    {
        "rule_id": "M_IDENTIFIER_ISBN",
        "title": "ISBN identifier must use urn:isbn: prefix",
        "content": (
            "Problem: An ISBN is used as the book identifier but is not formatted with the "
            "urn:isbn: prefix required for EPUB metadata. "
            "Fix: Format as: urn:isbn:9780000000000 (13-digit ISBN-13, no hyphens). "
            "Example: <dc:identifier id='uid'>urn:isbn:9780198526636</dc:identifier>"
        ),
        "domain": "metadata",
        "file_type": "opf",
    },
    {
        "rule_id": "M_LANGUAGE",
        "title": "Missing or invalid dc:language in OPF metadata",
        "content": (
            "Problem: The OPF metadata is missing <dc:language> or the language tag is not a "
            "valid BCP 47 language tag. Reading systems use this for text direction and hyphenation. "
            "Fix: Add a valid BCP 47 language tag. "
            "Common values: en (English), en-US, en-GB, fr (French), de (German), "
            "zh (Chinese), zh-Hans (Simplified), ja (Japanese), ar (Arabic), es (Spanish). "
            "Example: <dc:language>en</dc:language>"
        ),
        "domain": "metadata",
        "file_type": "opf",
    },
    {
        "rule_id": "M_DATE",
        "title": "dc:date must use ISO 8601 format",
        "content": (
            "Problem: The <dc:date> value is not in ISO 8601 format. "
            "Common invalid values: '2023', 'January 2023', '01/15/2023'. "
            "Fix: Use ISO 8601 date: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ. "
            "Example: <dc:date>2023-09-15</dc:date> "
            "For publication year only: <dc:date>2023-01-01</dc:date> (use first of year)."
        ),
        "domain": "metadata",
        "file_type": "opf",
    },
    {
        "rule_id": "M_DCTERMS_MODIFIED",
        "title": "Missing dcterms:modified timestamp (EPUB3 required)",
        "content": (
            "Problem: EPUB3 requires a <meta property='dcterms:modified'> element with an ISO 8601 "
            "UTC datetime. Without it, EPUB3 validators report a metadata error. "
            "Fix: Add to OPF metadata: "
            "<meta property='dcterms:modified'>2023-09-15T14:30:00Z</meta> "
            "Use UTC time (Z suffix). Update this whenever the EPUB is modified."
        ),
        "domain": "metadata",
        "file_type": "opf",
    },
    {
        "rule_id": "M_COVER",
        "title": "Cover image not properly declared in OPF",
        "content": (
            "Problem: The EPUB has no cover image declaration, or it is declared incorrectly. "
            "Fix for EPUB3: Add properties='cover-image' to the cover image manifest item: "
            "<item id='cover-img' href='images/cover.jpg' media-type='image/jpeg' "
            "properties='cover-image'/> "
            "Fix for EPUB2: Add to OPF metadata: <meta name='cover' content='cover-img'/> "
            "where 'cover-img' is the manifest id of the cover image."
        ),
        "domain": "metadata",
        "file_type": "opf",
    },
    {
        "rule_id": "M_RENDITION_LAYOUT",
        "title": "Rendition layout metadata missing or invalid for fixed-layout EPUB",
        "content": (
            "Problem: A fixed-layout EPUB is missing the rendition:layout property or has an "
            "invalid value. Without it, reading systems treat the book as reflowable. "
            "Fix: Add to OPF metadata: <meta property='rendition:layout'>pre-paginated</meta> "
            "For reflowable (default): <meta property='rendition:layout'>reflowable</meta> "
            "Also typically add: <meta property='rendition:orientation'>auto</meta> "
            "and <meta property='rendition:spread'>auto</meta>"
        ),
        "domain": "metadata",
        "file_type": "opf",
    },
    {
        "rule_id": "M_NAMESPACE",
        "title": "Missing or incorrect namespace declarations in OPF",
        "content": (
            "Problem: The OPF <package> element is missing required namespace declarations, "
            "causing XML parsing failures or invalid metadata recognition. "
            "Fix: Ensure the <package> element has: "
            "xmlns='http://www.idpf.org/2007/opf' "
            "xmlns:dc='http://purl.org/dc/elements/1.1/' "
            "xmlns:dcterms='http://purl.org/dc/terms/' "
            "xmlns:opf='http://www.idpf.org/2007/opf' "
            "Full example: <package version='3.0' xmlns='http://www.idpf.org/2007/opf' "
            "xmlns:dc='http://purl.org/dc/elements/1.1/' unique-identifier='uid'>"
        ),
        "domain": "metadata",
        "file_type": "opf",
    },
    {
        "rule_id": "M_DUPLICATES",
        "title": "Duplicate metadata elements in OPF",
        "content": (
            "Problem: The OPF metadata block contains duplicate dc:title, dc:identifier, or other "
            "elements that should appear only once. "
            "Fix: Keep only one instance of dc:identifier (the primary one matching unique-identifier). "
            "Multiple dc:creator, dc:contributor, dc:subject, dc:language are allowed. "
            "Multiple dc:title is allowed if differentiated with title-type meta refinements. "
            "Remove exact duplicate elements that add no value."
        ),
        "domain": "metadata",
        "file_type": "opf",
    },
    {
        "rule_id": "M_CREATOR",
        "title": "Missing dc:creator (author) in OPF metadata",
        "content": (
            "Problem: The OPF metadata does not include a <dc:creator> element for the author. "
            "Fix: Add at least one dc:creator element: <dc:creator id='author'>Author Name</dc:creator> "
            "For EPUB3, optionally add role refinement: "
            "<meta refines='#author' property='role' scheme='marc:relators'>aut</meta> "
            "For multiple authors use multiple dc:creator elements with unique ids."
        ),
        "domain": "metadata",
        "file_type": "opf",
    },
    {
        "rule_id": "M_PUBLISHER",
        "title": "Missing dc:publisher in OPF metadata",
        "content": (
            "Problem: The OPF metadata does not include a <dc:publisher> element. "
            "While not required, most distribution platforms require it. "
            "Fix: Add <dc:publisher>Publisher Name</dc:publisher> to the metadata block."
        ),
        "domain": "metadata",
        "file_type": "opf",
    },
    {
        "rule_id": "M_RIGHTS",
        "title": "Missing dc:rights / copyright statement in OPF metadata",
        "content": (
            "Problem: The OPF metadata has no <dc:rights> copyright statement. "
            "Many validators and distributors flag this as missing. "
            "Fix: Add <dc:rights>Copyright © 2023 Author Name. All rights reserved.</dc:rights> "
            "Or for Creative Commons: <dc:rights>CC BY 4.0 International</dc:rights>"
        ),
        "domain": "metadata",
        "file_type": "opf",
    },
    {
        "rule_id": "M_STORE_HINTS",
        "title": "Missing distributor/store metadata hints",
        "content": (
            "Problem: The EPUB is missing metadata properties expected by major distributors "
            "such as Amazon KDP, Apple Books, or Google Play Books: series info, reading direction, "
            "or subject category codes. "
            "Fix: Add relevant meta properties for target stores. "
            "Series: <meta property='belongs-to-collection' id='series'>Series Name</meta> "
            "Reading direction: <spine page-progression-direction='ltr'> "
            "BISAC subject: <dc:subject>FICTION / Science Fiction / General</dc:subject>"
        ),
        "domain": "metadata",
        "file_type": "opf",
    },

    # ─────────────────────────────────────────────────────────────────────────
    # ACCESSIBILITY — A_* checks
    # ─────────────────────────────────────────────────────────────────────────
    {
        "rule_id": "A_SCHEMA_ACCESSMODESUFFICIENT_MISSING",
        "title": "Missing schema:accessModeSufficient accessibility metadata",
        "content": (
            "Problem: EPUB Accessibility 1.1 requires schema:accessModeSufficient to declare what "
            "access modes (textual, visual, auditory) are sufficient to consume the content. "
            "Fix: Add to OPF metadata: "
            "<meta property='schema:accessModeSufficient'>textual</meta> "
            "For text-only: 'textual' "
            "For image-heavy: 'textual,visual' or 'visual' "
            "For audiobooks: 'auditory' "
            "Also add: <meta property='schema:accessMode'>textual</meta>"
        ),
        "domain": "accessibility",
        "file_type": "opf",
    },
    {
        "rule_id": "A_SCHEMA_ACCESSIBILITYSUMMARY_MISSING",
        "title": "Missing schema:accessibilitySummary in OPF metadata",
        "content": (
            "Problem: EPUB Accessibility 1.1 requires a schema:accessibilitySummary that "
            "describes the accessibility features and any known limitations. "
            "Fix: Add to OPF metadata: "
            "<meta property='schema:accessibilitySummary'>"
            "This publication conforms to EPUB Accessibility 1.1 at WCAG 2.1 Level AA. "
            "All images have alternative text. The reading order matches the visual order."
            "</meta>"
        ),
        "domain": "accessibility",
        "file_type": "opf",
    },
    {
        "rule_id": "A_HTML_LANG_MISSING",
        "title": "HTML content document missing lang attribute on root element",
        "content": (
            "Problem: The <html> root element in an XHTML content document is missing the lang "
            "attribute (and/or xml:lang), which is required for accessibility (screen readers use "
            "language to select the correct voice/pronunciation rules). "
            "Fix: Add both lang and xml:lang to the root html element: "
            "<html xmlns='http://www.w3.org/1999/xhtml' "
            "xmlns:epub='http://www.idpf.org/2007/ops' "
            "lang='en' xml:lang='en'> "
            "Use the same BCP 47 language tag as dc:language in the OPF."
        ),
        "domain": "accessibility",
        "file_type": "xhtml",
    },
    {
        "rule_id": "A_IMAGE_ALT_MISSING",
        "title": "Images missing alt attribute for screen reader accessibility",
        "content": (
            "Problem: One or more <img> elements are missing the alt attribute. "
            "Screen readers cannot describe the image to visually impaired readers. "
            "This also fails WCAG 2.1 Success Criterion 1.1.1 Non-text Content. "
            "Fix: Add alt to every img element: "
            "- Informative image: alt='Description of what the image shows' "
            "- Decorative image: alt='' (empty string, not missing) "
            "- Complex chart: alt='Chart showing...' plus a longer description nearby. "
            "Example: <img src='chart.png' alt='Bar chart showing sales growth from 2020–2023'/>"
        ),
        "domain": "accessibility",
        "file_type": "xhtml",
    },
    {
        "rule_id": "A_LINK_TEXT_MISSING",
        "title": "Anchor links with no accessible text content",
        "content": (
            "Problem: One or more <a> elements contain no text, only an image without alt, or "
            "uninformative text like 'click here', 'read more', 'here'. "
            "Screen readers cannot describe the link destination. "
            "Fix: Provide descriptive link text or an aria-label: "
            "Bad: <a href='ch2.xhtml'>Click here</a> "
            "Good: <a href='ch2.xhtml'>Chapter 2: The Discovery</a> "
            "Image link: <a href='...'><img src='icon.png' alt='Next chapter'/></a>"
        ),
        "domain": "accessibility",
        "file_type": "xhtml",
    },
    {
        "rule_id": "A_HEADING_SEQUENCE",
        "title": "Heading hierarchy skips levels (h1→h3 without h2)",
        "content": (
            "Problem: Heading elements in content documents skip levels (e.g., h1 followed by h3 "
            "with no h2 in between). This breaks the document outline and confuses screen reader users. "
            "Fix: Use heading levels sequentially without skipping. Each section nesting level increases "
            "the heading number by one. "
            "Allowed: h1→h2→h3 (nested sections) or h2→h2 (sibling sections). "
            "Not allowed: h1→h3, h2→h4. "
            "Per chapter: each chapter XHTML can restart at h1 if it is a separate document."
        ),
        "domain": "accessibility",
        "file_type": "xhtml",
    },
    {
        "rule_id": "A_TABLE_HEADERS_MISSING",
        "title": "Data tables missing <th> header cells",
        "content": (
            "Problem: HTML data tables use only <td> cells with no <th> header cells and no "
            "scope or headers attributes. Screen readers cannot associate data cells with headers. "
            "Fix: Mark column and row headers with <th> elements and scope attributes: "
            "<thead><tr><th scope='col'>Name</th><th scope='col'>Value</th></tr></thead> "
            "<tbody><tr><th scope='row'>Item 1</th><td>42</td></tr></tbody> "
            "For complex tables add id/headers associations."
        ),
        "domain": "accessibility",
        "file_type": "xhtml",
    },
    {
        "rule_id": "A_LIST_STRUCTURE",
        "title": "Content using manual list formatting instead of semantic list elements",
        "content": (
            "Problem: Lists are represented using <p> elements with manual bullets/numbers "
            "(e.g., '• Item 1', '1. Item 2') instead of semantic <ul>/<ol>/<li> elements. "
            "Screen readers cannot identify these as lists. "
            "Fix: Replace manual list formatting with HTML list elements: "
            "Unordered: <ul><li>Item 1</li><li>Item 2</li></ul> "
            "Ordered: <ol><li>Step 1</li><li>Step 2</li></ol> "
            "CSS handles visual bullet style — remove manual bullet characters from text."
        ),
        "domain": "accessibility",
        "file_type": "xhtml",
    },
    {
        "rule_id": "A_LANDMARKS_MISSING",
        "title": "EPUB3 nav landmarks section absent or empty",
        "content": (
            "Problem: The nav.xhtml file is missing the landmarks nav element "
            "(epub:type='landmarks'). Reading systems and AT tools use landmarks for quick navigation "
            "to key sections (cover, TOC, bodymatter, copyright page). "
            "Fix: Add a landmarks nav to nav.xhtml: "
            "<nav epub:type='landmarks'><ol>"
            "<li><a epub:type='cover' href='cover.xhtml'>Cover</a></li>"
            "<li><a epub:type='toc' href='toc.xhtml'>Table of Contents</a></li>"
            "<li><a epub:type='bodymatter' href='chapter01.xhtml'>Begin Reading</a></li>"
            "</ol></nav>"
        ),
        "domain": "accessibility",
        "file_type": "xhtml",
    },
    {
        "rule_id": "A_ARIA_ROLES_INVALID",
        "title": "Invalid ARIA role or epub:type value on content element",
        "content": (
            "Problem: An element uses an unknown or misapplied ARIA role (role='article' on a <span>) "
            "or an invalid epub:type value not in the EPUB Structural Semantics Vocabulary. "
            "Fix: Use only valid ARIA roles appropriate for the element type. "
            "For EPUB semantic overlays, use valid epub:type values: "
            "chapter, section, foreword, preface, introduction, acknowledgments, bibliography, "
            "footnote, endnote, glossary, index, appendix, cover, titlepage. "
            "Example: <section epub:type='chapter' role='doc-chapter'>"
        ),
        "domain": "accessibility",
        "file_type": "xhtml",
    },
    {
        "rule_id": "A_EPUB_TYPE_INVALID",
        "title": "epub:type attribute uses invalid or deprecated vocabulary term",
        "content": (
            "Problem: An epub:type attribute value is not recognized in the EPUB 3 Structural "
            "Semantics Vocabulary, or uses a deprecated EPUB 2 term. "
            "Fix: Use only valid EPUB 3 SSV terms. Common valid values: "
            "bodymatter, frontmatter, backmatter, part, chapter, subchapter, division, "
            "abstract, foreword, preface, prologue, introduction, preamble, conclusion, epilogue, "
            "afterword, acknowledgments, imprint, colophon, cover, titlepage, halftitlepage, "
            "seriespage, dedication, epigraph, toc, landmarks, lot, loi, loa, lov, "
            "footnote, endnote, footnotes, endnotes, note, annotation, "
            "glossary, glossterm, glossdef, bibliography, biblioentry, "
            "index, index-headnotes, index-entry, index-term, index-locator, "
            "appendix, figure, table, sidebar, pullquote, keyword, topic-sentence. "
            "Namespace: add xmlns:epub='http://www.idpf.org/2007/ops' to html element."
        ),
        "domain": "accessibility",
        "file_type": "xhtml",
    },
    {
        "rule_id": "A_PAGEBREAK_LABELS",
        "title": "Page break markers missing accessible labels",
        "content": (
            "Problem: Print page break markers (epub:type='pagebreak') have no accessible "
            "label — no aria-label, title, or text content — making them invisible to screen readers. "
            "Fix: Provide an aria-label or title on every pagebreak element: "
            "<span epub:type='pagebreak' role='doc-pagebreak' "
            "aria-label='Page 42' id='page42'/> "
            "Or with visible page number: "
            "<span epub:type='pagebreak' role='doc-pagebreak' id='page42'>42</span>"
        ),
        "domain": "accessibility",
        "file_type": "xhtml",
    },
    {
        "rule_id": "A_MANUAL",
        "title": "Accessibility issue requiring manual review",
        "content": (
            "Problem: The validator found an accessibility concern that cannot be automatically "
            "verified — typically: complex images needing extended description, audio/video without "
            "transcript, cognitive accessibility concerns, or colour contrast checks. "
            "Fix: Review each flagged item manually: "
            "1) Complex charts/maps: add <details> or aria-describedby to a full text description. "
            "2) Video: provide synchronized captions (<track kind='captions'>) and a transcript. "
            "3) Audio: provide a transcript linked near the audio element. "
            "4) Color contrast: verify all text meets WCAG 2.1 AA (4.5:1 ratio for normal text)."
        ),
        "domain": "accessibility",
        "file_type": "xhtml",
    },

    # ─────────────────────────────────────────────────────────────────────────
    # TEXT / CONTENT — T_* checks
    # ─────────────────────────────────────────────────────────────────────────
    {
        "rule_id": "T_CONTENT_DOCS",
        "title": "Content documents are not valid XHTML5",
        "content": (
            "Problem: One or more content documents are not well-formed XHTML5. Common issues: "
            "unclosed tags, missing DOCTYPE, invalid nesting (block inside inline), "
            "unescaped < or & in content, missing xmlns declaration. "
            "Fix: Ensure all content documents begin with: "
            "<?xml version='1.0' encoding='utf-8'?>"
            "<!DOCTYPE html>"
            "<html xmlns='http://www.w3.org/1999/xhtml' "
            "xmlns:epub='http://www.idpf.org/2007/ops'> "
            "All tags must be properly closed: <br/> not <br>. "
            "Escape: & → &amp;  < → &lt;  > → &gt;"
        ),
        "domain": "structure",
        "file_type": "xhtml",
    },
    {
        "rule_id": "T_HYPHENATION_WORD_MERGE",
        "title": "Words incorrectly merged after removing soft hyphens",
        "content": (
            "Problem: The content contains soft hyphen characters (U+00AD) used for line-break hints. "
            "When reading systems or accessibility tools strip hyphens, words merge ('photo-synthesis' "
            "becomes 'photosynthesis') — this is correct. But when words merge incorrectly ("
            "'com-puter' → 'computer' correct, 'can-not' → 'cannot' vs 'can not' — must verify). "
            "Fix: Use soft hyphens only for compound words or long technical terms that break naturally. "
            "Do not use soft hyphens in words that should remain whole when hyphens are removed. "
            "CSS alternative: use hyphens: auto; on the body element instead of manual soft hyphens."
        ),
        "domain": "structure",
        "file_type": "xhtml",
    },
    {
        "rule_id": "T_SPECIAL_CHAR_ENTITY",
        "title": "Special characters not properly encoded as XML entities or UTF-8",
        "content": (
            "Problem: Content documents contain bare special characters that should be XML entities "
            "or are encoded incorrectly (Latin-1 characters in a UTF-8 declared document). "
            "Fix: Ensure all content files declare UTF-8: <?xml version='1.0' encoding='utf-8'?> "
            "and are actually saved as UTF-8. Use XML entities for XML-special characters only: "
            "& → &amp;   < → &lt;   > → &gt;   \" → &quot;   ' → &apos; "
            "Other characters (em-dash, curly quotes, accented letters) can be stored as UTF-8 "
            "directly — do NOT use HTML named entities like &mdash; in XHTML EPUB content."
        ),
        "domain": "structure",
        "file_type": "xhtml",
    },
    {
        "rule_id": "T_MISSING_INCORRECT_TEXT",
        "title": "Required text content missing or corrupted in content document",
        "content": (
            "Problem: A content document has empty body, missing chapter text, or garbled content "
            "that does not match the expected book content. May indicate extraction or conversion error. "
            "Fix: Verify the source content was correctly converted/extracted. "
            "Check for encoding issues — wrong charset during conversion garbles text. "
            "Check for truncation — file may have been corrupted during packaging. "
            "Re-export from the source (Word, InDesign, HTML) and repackage."
        ),
        "domain": "structure",
        "file_type": "xhtml",
    },

    # ─────────────────────────────────────────────────────────────────────────
    # LAYOUT / CSS VALIDATION — L_* checks
    # ─────────────────────────────────────────────────────────────────────────
    {
        "rule_id": "L_CSS_INVALID_DECLARATION",
        "title": "CSS declaration is syntactically invalid",
        "content": (
            "Problem: One or more CSS rules contain syntactically invalid property names or values. "
            "Common causes: missing hyphens in property names (fontsize→font-size), "
            "unit typos (1p→1px), invalid shorthand values, unquoted font family names with spaces. "
            "Fix: Validate the CSS file with a CSS validator. "
            "Property name fixes: fontsize→font-size, fontweight→font-weight, textalign→text-align, "
            "lineheight→line-height, textindent→text-indent, fontfamily→font-family. "
            "Unit fixes: always include unit (px, em, rem, %, pt) — bare numbers only valid for "
            "line-height, z-index, and flex values."
        ),
        "domain": "css",
        "file_type": "css",
    },
    {
        "rule_id": "L_CSS_UNKNOWN_PROPERTY",
        "title": "CSS property not recognized by EPUB reading systems",
        "content": (
            "Problem: A CSS property used in the stylesheet is non-standard, deprecated, or vendor-specific "
            "without a standard fallback. Reading systems may ignore it, causing layout issues. "
            "Fix: Remove non-standard properties or add standard equivalents before vendor-prefixed ones. "
            "Add fallbacks: -webkit-transform → standard transform (still valid in most RS). "
            "Avoid: word-spacing values like 'normal' (should be a length or 0). "
            "EPUB3 supports CSS 2.1 plus selected CSS3 modules — avoid CSS4/Grid (limited RS support). "
            "Use @supports to gate modern CSS with fallbacks."
        ),
        "domain": "css",
        "file_type": "css",
    },

    # ─────────────────────────────────────────────────────────────────────────
    # EPUB CSS EXTENSIONS — epub: prefixed properties (W3C css-epub-* tests)
    # ─────────────────────────────────────────────────────────────────────────
    {
        "rule_id": "CSS_EPUB_HYPHENS",
        "title": "epub:hyphens property for automatic hyphenation",
        "content": (
            "Problem: EPUB content uses -epub-hyphens without the unprefixed fallback, or uses "
            "browser-prefixed hyphens without the epub: variant. "
            "Fix: Declare both prefixed and unprefixed hyphens for broad RS support: "
            "-epub-hyphens: auto; "
            "-webkit-hyphens: auto; "
            "-moz-hyphens: auto; "
            "hyphens: auto; "
            "Also set: lang attribute on <html> (required for auto hyphenation to activate). "
            "Disable on headings: h1, h2, h3 { hyphens: none; -epub-hyphens: none; }"
        ),
        "domain": "css",
        "file_type": "css",
    },
    {
        "rule_id": "CSS_EPUB_WRITING_MODE",
        "title": "epub:writing-mode / writing-mode for vertical text",
        "content": (
            "Problem: Vertical text layout (CJK) is set using only -epub-writing-mode without "
            "modern writing-mode, or uses incorrect values. "
            "Fix: Declare all variants for maximum RS compatibility: "
            "-epub-writing-mode: vertical-rl; "
            "-webkit-writing-mode: vertical-rl; "
            "writing-mode: vertical-rl; "
            "Valid values: horizontal-tb (default), vertical-rl (CJK vertical right-to-left), "
            "vertical-lr (rare). "
            "For EPUB2 RS compatibility: -epub-writing-mode: tb-rl; (deprecated but still needed)."
        ),
        "domain": "css",
        "file_type": "css",
    },
    {
        "rule_id": "CSS_EPUB_TEXT_EMPHASIS",
        "title": "epub:text-emphasis for CJK emphasis marks (bouten/dots)",
        "content": (
            "Problem: CJK emphasis marks (圏点/bouten) are not rendering because only "
            "-epub-text-emphasis is declared without the standard text-emphasis property. "
            "Fix: Declare both forms: "
            "-epub-text-emphasis: sesame; "
            "-epub-text-emphasis-color: #000; "
            "-epub-text-emphasis-position: over right; "
            "text-emphasis: sesame; "
            "text-emphasis-position: over right; "
            "Valid emphasis styles: none, filled, open, dot, circle, double-circle, triangle, sesame. "
            "Apply to ruby-bearing text: ruby { -epub-text-emphasis: none; }"
        ),
        "domain": "css",
        "file_type": "css",
    },
    {
        "rule_id": "CSS_EPUB_TEXT_ORIENTATION",
        "title": "epub:text-orientation for mixed/upright characters in vertical text",
        "content": (
            "Problem: In vertical writing mode, Latin characters or digits are not rotating correctly "
            "because text-orientation is not set. "
            "Fix: Use text-orientation to control character rotation in vertical text: "
            "text-orientation: mixed; (default: rotate Latin, keep CJK upright) "
            "text-orientation: upright; (force all chars upright — for numbers in vertical) "
            "text-orientation: sideways; (rotate all 90°) "
            "Legacy epub prefix: -epub-text-orientation: mixed; "
            "For inline Latin in vertical: span.tcy { text-orientation: upright; }"
        ),
        "domain": "css",
        "file_type": "css",
    },
    {
        "rule_id": "CSS_EPUB_WORD_BREAK",
        "title": "epub:word-break for CJK word wrapping behavior",
        "content": (
            "Problem: CJK text is breaking mid-word or not breaking at expected points because "
            "word-break is set to normal (designed for Latin) or is unset. "
            "Fix: Set word-break appropriately for CJK content: "
            "word-break: auto-phrase; (modern, allows smart CJK phrase-aware breaking) "
            "word-break: break-all; (break anywhere — use for narrow columns) "
            "word-break: keep-all; (no CJK breaks — for Korean) "
            "Legacy: -epub-word-break: break-all; "
            "For English-only content: word-break: normal; overflow-wrap: break-word;"
        ),
        "domain": "css",
        "file_type": "css",
    },
    {
        "rule_id": "CSS_EPUB_TEXT_COMBINE",
        "title": "text-combine-upright for tate-chu-yoko (horizontal-in-vertical)",
        "content": (
            "Problem: Numbers or abbreviations in vertical CJK text are not rendering horizontally "
            "(tate-chu-yoko effect). "
            "Fix: Apply text-combine-upright to spans wrapping 1-4 character sequences: "
            "-webkit-text-combine: horizontal; (legacy WebKit) "
            "-epub-text-combine: horizontal; "
            "text-combine-upright: all; (standard, for 1-4 digits/letters) "
            "HTML: <span class='tcy'>42</span> where .tcy { text-combine-upright: all; } "
            "Use only for 1–4 characters — longer sequences do not work well with this property."
        ),
        "domain": "css",
        "file_type": "css",
    },

    # ─────────────────────────────────────────────────────────────────────────
    # FIXED LAYOUT — FXL-specific rules
    # ─────────────────────────────────────────────────────────────────────────
    {
        "rule_id": "FXL_VIEWPORT_MISSING",
        "title": "Fixed layout content document missing viewport meta declaration",
        "content": (
            "Problem: A fixed-layout (pre-paginated) EPUB spine item is missing the viewport "
            "meta property in the OPF manifest or the viewport meta tag in the content document. "
            "Without it, reading systems cannot determine page dimensions and scaling behavior. "
            "Fix in OPF manifest item: add properties='rendition:viewport' or declare in metadata: "
            "<meta property='rendition:viewport'>width=1024, height=768</meta> "
            "Fix in HTML: <meta name='viewport' content='width=1024, height=768'/> "
            "Use consistent dimensions across all FXL content documents."
        ),
        "domain": "structure",
        "file_type": "xhtml",
    },
    {
        "rule_id": "FXL_PAGE_SPREAD",
        "title": "Fixed layout page spread properties incorrect",
        "content": (
            "Problem: Fixed layout EPUB pages are not spreading correctly because the "
            "rendition:page-spread-* properties are missing, conflicting, or applied to wrong pages. "
            "Fix: Apply page spread via OPF spine itemref properties: "
            "<itemref idref='left-page' properties='page-spread-left'/> "
            "<itemref idref='right-page' properties='page-spread-right'/> "
            "Or at item level: <item ... properties='rendition:page-spread-center'/> for single pages. "
            "Left page should always precede right page in spine order."
        ),
        "domain": "structure",
        "file_type": "opf",
    },
    {
        "rule_id": "FXL_LAYOUT_DUPLICATION",
        "title": "Fixed layout rendition:layout declared multiple times or inconsistently",
        "content": (
            "Problem: rendition:layout is declared in OPF metadata AND overridden at the spine "
            "itemref level with conflicting values, causing undefined behavior in reading systems. "
            "Fix: Choose one of two patterns: "
            "1) Global FXL: declare pre-paginated in OPF metadata, no spine-level overrides. "
            "2) Mixed: declare reflowable globally, override specific spine items with "
            "<itemref properties='rendition:layout-pre-paginated'/>. "
            "Remove duplicate or conflicting declarations."
        ),
        "domain": "structure",
        "file_type": "opf",
    },

    # ─────────────────────────────────────────────────────────────────────────
    # MEDIA OVERLAYS — SMIL synchronization
    # ─────────────────────────────────────────────────────────────────────────
    {
        "rule_id": "MOL_SMIL_INVALID",
        "title": "Media overlay SMIL file is malformed or has invalid structure",
        "content": (
            "Problem: A SMIL media overlay file has invalid XML, missing required elements, "
            "or incorrect namespace declarations. "
            "Fix: Ensure SMIL files have the EPUB3 media overlay structure: "
            "<?xml version='1.0' encoding='utf-8'?>"
            "<smil xmlns='http://www.w3.org/ns/SMIL' version='3.0' "
            "xmlns:epub='http://www.idpf.org/2007/ops'>"
            "<body><seq epub:textref='chapter.xhtml' epub:type='bodymatter chapter'>"
            "<par><text src='chapter.xhtml#p1'/>"
            "<audio src='audio.mp3' clipBegin='0s' clipEnd='4.5s'/></par>"
            "</seq></body></smil>"
        ),
        "domain": "structure",
        "file_type": "smil",
    },
    {
        "rule_id": "MOL_AUDIO_MISSING",
        "title": "Media overlay audio file not found or wrong media-type",
        "content": (
            "Problem: A SMIL overlay references an audio file that does not exist in the archive "
            "or is not listed in the OPF manifest with the correct media-type. "
            "Fix: "
            "1) Add the audio file to the EPUB archive. "
            "2) Add to OPF manifest: <item id='audio1' href='audio/ch1.mp3' "
            "media-type='audio/mpeg' media-overlay='overlay1'/> "
            "3) Declare the overlay: <item id='overlay1' href='ch1.smil' "
            "media-type='application/smil+xml'/> "
            "Supported audio formats: audio/mpeg (MP3), audio/ogg, audio/mp4."
        ),
        "domain": "structure",
        "file_type": "smil",
    },
    {
        "rule_id": "MOL_TIMING_INVALID",
        "title": "SMIL clipBegin/clipEnd timing values are invalid or overlapping",
        "content": (
            "Problem: A SMIL par element has clipBegin >= clipEnd, negative values, or "
            "timing values that extend beyond the actual audio file duration. "
            "Fix: Ensure: clipBegin < clipEnd, clipBegin >= 0s, clipEnd <= audio duration. "
            "Format: use seconds with 's' suffix (e.g., clipBegin='10.5s' clipEnd='14.2s'). "
            "Or use clock-value: clipBegin='00:00:10.500' clipEnd='00:00:14.200'. "
            "Regenerate timing from the TTS or audio production tool."
        ),
        "domain": "structure",
        "file_type": "smil",
    },
    {
        "rule_id": "MOL_TEXT_FRAGMENT_MISSING",
        "title": "SMIL text src fragment does not exist in target content document",
        "content": (
            "Problem: A SMIL <text src='chapter.xhtml#para-id'/> references a fragment id "
            "that does not exist in the target content document. "
            "Fix: Add the missing id attribute to the corresponding element in the content document. "
            "Every SMIL text sync point needs an exactly matching id in the HTML. "
            "Example: <text src='ch1.xhtml#s001'/> requires <span id='s001'> or <p id='s001'> in ch1.xhtml. "
            "Ensure ids are unique within each content document."
        ),
        "domain": "structure",
        "file_type": "smil",
    },

    # ─────────────────────────────────────────────────────────────────────────
    # CONTENT SUPPORT — SVG and MathML
    # ─────────────────────────────────────────────────────────────────────────
    {
        "rule_id": "CNT_SVG_MISSING_FALLBACK",
        "title": "SVG content document missing required EPUB fallback",
        "content": (
            "Problem: An SVG file is used as a spine item (not inline) without a fallback for "
            "reading systems that do not support SVG spine items. "
            "Fix: Add a fallback manifest item and link it: "
            "<item id='svg-ch1' href='ch1.svg' media-type='image/svg+xml' fallback='xhtml-ch1'/> "
            "<item id='xhtml-ch1' href='ch1.xhtml' media-type='application/xhtml+xml'/> "
            "Or embed the SVG inline in XHTML instead of using it as a standalone spine item."
        ),
        "domain": "structure",
        "file_type": "opf",
    },
    {
        "rule_id": "CNT_MATHML_NO_FALLBACK",
        "title": "MathML content without fallback for non-supporting reading systems",
        "content": (
            "Problem: Native MathML elements in content documents have no fallback for reading "
            "systems that do not render MathML natively (most EPUB readers). "
            "Fix: Wrap MathML with an alttext or img fallback using the altimg attribute: "
            "<math alttext='x squared plus y squared equals z squared' "
            "altimg='math/eq1.png' altimg-width='200px' altimg-height='50px'>"
            "<msup><mi>x</mi><mn>2</mn></msup>...</math> "
            "Generate PNG fallbacks with MathJax or KaTeX at build time. "
            "Add epub:type='z3998:math' for semantic identification."
        ),
        "domain": "structure",
        "file_type": "xhtml",
    },
]
