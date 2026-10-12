const path = require('path');
const fs = require('fs');
const { parseXml } = require('../utils/xml');

function extractNavLinksFromHtml(html) {
    const links = [];
    const regex = /<a[^>]+href="([^"]+)"/gi;
    let m;
    while ((m = regex.exec(html))) {
        links.push(m[1].split("#")[0]);
    }
    return links;
}


async function runStructureChecks({ tempDir, zipEntries, epubPath }) {
    const results = [];

    // Check mimetype at root and stored (we can't check compression mode from adm-zip easily; but we check presence and content)
    const mimetypePath = path.join(tempDir, 'mimetype');
    if (!fs.existsSync(mimetypePath)) {

        results.push({
            id: 'S_MIMETYPE',
            title: 'Missing mimetype file',
            status: 'fail',
            details: 'mimetype not found at archive root',
            suggestion: 'Add a root file named "mimetype" with content: application/epub+zip and do not compress it'
        });
    } else {
        const content = fs.readFileSync(mimetypePath, 'utf8').trim();
        if (content !== 'application/epub+zip') {
            results.push({
                id: 'S_MIMETYPE', title: 'Incorrect mimetype content', status: 'fail', details: `mimetype content = "${content}"`,
                suggestion: 'Set content exactly to: application/epub+zip'
            });
        } else {
            results.push({ id: 'S_MIMETYPE', title: 'Mimetype present', status: 'pass', details: 'mimetype exists and content looks correct', suggestion: '' });
        }
    }

    // Check container.xml and find OPF
    const containerPath = path.join(tempDir, 'META-INF', 'container.xml');
    if (!fs.existsSync(containerPath)) {
        results.push({ id: 'S_CONTAINER', title: 'Missing container.xml', status: 'fail', details: 'META-INF/container.xml missing', suggestion: 'Add a valid container.xml with rootfile pointing to OPF' });

        return results;
    }

    const containerXml = fs.readFileSync(containerPath, 'utf8');
    const parsed = parseXml(containerXml);
    const rootfiles = parsed?.container?.rootfiles?.rootfile;
    let opfPath = null;
    if (Array.isArray(rootfiles)) opfPath = rootfiles[0]['@_full-path'];
    else if (rootfiles) opfPath = rootfiles['@_full-path'];
    if (!opfPath) {

        results.push({ id: 'S_CONTAINER_ROUTE', title: 'Container routing error', status: 'fail', details: 'container.xml does not contain rootfile full-path', suggestion: 'Fix container.xml' });
        return results;
    }
    const opfFull = path.join(tempDir, opfPath);
    if (!fs.existsSync(opfFull)) {
        results.push({ id: 'S_OPF_MISSING', title: 'OPF file missing', status: 'fail', details: `OPF not found at path indicated by container.xml: ${opfPath}`, suggestion: 'Ensure rootfile path is correct and case-sensitive' });
        return results;
    }
    // record opf path so upstream can use
    results.push({ id: 'S_OPF_PATH', title: 'OPF located', status: 'pass', details: { opfPath }, suggestion: '' });

    // Check spine present
    const opfText = fs.readFileSync(opfFull, 'utf8');
    const opfXml = parseXml(opfText);
    // Extract manifest BEFORE spine checks
    const manifest = opfXml?.package?.manifest?.item;
    const spine = opfXml?.package?.spine?.itemref;
    if (!spine) {
        results.push({ id: 'S_SPINE', title: 'Spine missing or empty', status: 'fail', details: 'OPF spine has no itemrefs', suggestion: '' });
    } else {
        const spLength = Array.isArray(spine) ? spine.length : 1;
        results.push({ id: 'S_SPINE', title: 'Spine present', status: 'pass', details: `spine length = ${spLength}`, suggestion: '' });
    }

    // ========= NEW CHECK: DUPLICATE SPINE + ORDER =========
    if (spine) {
        const spineArray = Array.isArray(spine) ? spine : [spine];
        const idrefs = spineArray.map(s => s['@_idref']).filter(Boolean);

        // 1. Duplicate Check
        const seen = new Set();
        const duplicates = [];

        for (const id of idrefs) {
            if (seen.has(id)) duplicates.push(id);
            else seen.add(id);
        }

        if (duplicates.length > 0) {
            results.push({
                id: 'S_SPINE_DUPLICATES',
                title: 'Duplicate spine entries',
                status: 'fail',
                details: `Duplicate spine idrefs detected: ${duplicates.join(', ')}`,
                suggestion: ''
            });
        } else {
            results.push({
                id: 'S_SPINE_DUPLICATES',
                title: 'No duplicate spine entries',
                status: 'pass',
                details: 'All spine itemrefs are unique.',
                suggestion: ''
            });
        }

        // 2. Order Check
        // const manifestItems = Array.isArray(manifest) ? manifest : [manifest];
        /* ==
   NCX PLAYORDER + FRAGMENT CHECK (EPUB2)== */
        const manifestItems = Array.isArray(manifest) ? manifest : [manifest];
        const ncxItem = manifestItems.find(
            i => (i['@_media-type'] || '').includes('ncx')
        );

        if (ncxItem) {
            const ncxPath = path.join(path.dirname(opfFull), ncxItem['@_href']);
            if (fs.existsSync(ncxPath)) {
                const ncxXml = parseXml(fs.readFileSync(ncxPath, 'utf8'));
                const navPoints = ncxXml?.ncx?.navMap?.navPoint || [];
                const points = Array.isArray(navPoints) ? navPoints : [navPoints];

                const seenPlayOrder = new Set();

                points.forEach(p => {
                    const po = p['@_playOrder'];

                    // Duplicate playOrder
                    if (seenPlayOrder.has(po)) {
                        results.push({
                            id: 'NCX_DUPLICATE_PLAYORDER',
                            title: 'Duplicate playOrder in NCX',
                            status: 'fail',
                            details: `Duplicate playOrder value: ${po}`,
                            suggestion: ''
                        });
                    }
                    seenPlayOrder.add(po);

                    // Broken fragment check
                    const src = p?.content?.['@_src'];
                    if (src && src.includes('#')) {
                        const [file, frag] = src.split('#');
                        const target = path.join(path.dirname(ncxPath), file);

                        if (fs.existsSync(target)) {
                            const html = fs.readFileSync(target, 'utf8');
                            if (!new RegExp(`id="${frag}"`).test(html)) {
                                results.push({
                                    id: 'NCX_BROKEN_FRAGMENT',
                                    title: 'NCX fragment identifier not defined',
                                    status: 'fail',
                                    details: src,
                                    suggestion: ''
                                });
                            }
                        }
                    }
                });
            }
        }

        const manifestOrder = {};
        manifestItems.forEach((it, index) => {
            if (it['@_id']) manifestOrder[it['@_id']] = index;
        });

        let outOfOrder = [];
        for (let i = 1; i < idrefs.length; i++) {
            const prev = manifestOrder[idrefs[i - 1]];
            const curr = manifestOrder[idrefs[i]];

            if (prev !== undefined && curr !== undefined && curr < prev) {
                outOfOrder.push(`${idrefs[i - 1]} → ${idrefs[i]}`);
            }
        }

        if (outOfOrder.length > 0) {
            results.push({
                id: 'S_SPINE_ORDER',
                title: 'Spine reading order incorrect',
                status: 'fail',
                details: `The following spine transitions are out of order:\n${outOfOrder.join('\n')}`,
                suggestion: ''
            });
        } else {
            results.push({
                id: 'S_SPINE_ORDER',
                title: 'Spine reading order valid',
                status: 'pass',
                details: 'Spine order follows manifest order.',
                suggestion: ''
            });
        }

        /* ======================================================
   TOC (nav.xhtml) vs SPINE ORDER CHECK (EPUB3)
====================================================== */
        const navItem = manifestItems.find(
            i => (i['@_properties'] || '').includes('nav')
        );

        if (navItem && spine) {
            const navPath = path.join(path.dirname(opfFull), navItem['@_href']);
            if (fs.existsSync(navPath)) {
                const navHtml = fs.readFileSync(navPath, 'utf8');
                const tocLinks = extractNavLinksFromHtml(navHtml);

                const spineArray = Array.isArray(spine) ? spine : [spine];
                const spineHrefs = spineArray
                    .map(s => {
                        const idref = s['@_idref'];
                        const item = manifestItems.find(i => i['@_id'] === idref);
                        return item ? item['@_href'] : null;
                    })
                    .filter(Boolean);

                let mismatch = false;
                tocLinks.forEach((l, i) => {
                    if (spineHrefs[i] && !l.includes(spineHrefs[i])) {
                        mismatch = true;
                    }
                });

                if (mismatch) {
                    results.push({
                        id: 'NAV_TOC_SPINE_MISMATCH',
                        title: 'TOC order does not match spine',
                        status: 'fail',
                        details: 'TOC entries do not follow OPF spine order',
                        suggestion: ''
                    });
                }
            }
        }
    }
    let navFound = false;
    if (manifest) {
        const items = Array.isArray(manifest) ? manifest : [manifest];
        for (const it of items) {
            const props = it['@_properties'] || '';
            const media = it['@_media-type'] || '';
            const href = it['@_href'] || '';
            if (props.includes('nav') || /nav\.x?html?$/.test(href) || media.includes('ncx')) {
                navFound = true;
                break;
            }
        }
    }

    return results;
}

module.exports = { runStructureChecks };
