const path = require('path');
const fs = require('fs');
const { parseXml } = require('../utils/xml');

function getArray(xmlNode) {
    return Array.isArray(xmlNode) ? xmlNode : xmlNode ? [xmlNode] : [];
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validatePlayOrders(items, context) {
    const playOrders = items.map((i, idx) => ({
        order: parseInt(i['@_playOrder']),
        index: idx,
        id: i['@_id'] || i.$?.id,
        label: i.navLabel?.text || i.navLabel?.text?._ || `Item ${idx + 1}`,
        src: i.content?.['@_src'] || ''
    })).filter(p => !isNaN(p.order));
    
    const issues = [];
    const detailedErrors = [];
    
    // Check for duplicates
    const orderCounts = {};
    playOrders.forEach(p => {
        orderCounts[p.order] = (orderCounts[p.order] || 0) + 1;
    });
    const duplicates = Object.entries(orderCounts)
        .filter(([order, count]) => count > 1)
        .map(([order]) => parseInt(order));
    
    if (duplicates.length > 0) {
        issues.push('duplicates');
        duplicates.forEach(dupOrder => {
            const dupeItems = playOrders.filter(p => p.order === dupOrder);
            detailedErrors.push({
                type: 'duplicate',
                playOrder: dupOrder,
                items: dupeItems.map(d => `#${d.id} (index ${d.index + 1}): "${d.label}"`).join(', ')
            });
        });
    }
    
    // Check if starts at 1
    if (playOrders.length && playOrders[0].order !== 1) {
        issues.push('must start at 1');
        detailedErrors.push({
            type: 'wrong_start',
            expected: 1,
            actual: playOrders[0].order,
            item: `#${playOrders[0].id} (index 1): "${playOrders[0].label}"`
        });
    }
    
    // Check for sequence breaks and gaps
    const sortedOrders = [...playOrders].sort((a, b) => a.order - b.order);
    for (let i = 1; i < sortedOrders.length; i++) {
        const prev = sortedOrders[i - 1];
        const curr = sortedOrders[i];
        const expectedOrder = prev.order + 1;
        
        if (curr.order !== expectedOrder) {
            const gap = curr.order - prev.order;
            if (gap > 1) {
                // Gap detected
                detailedErrors.push({
                    type: 'gap',
                    from: prev.order,
                    to: curr.order,
                    missing: Array.from({length: gap - 1}, (_, idx) => prev.order + idx + 1),
                    afterItem: `#${prev.id} (index ${prev.index + 1}): "${prev.label}"`,
                    beforeItem: `#${curr.id} (index ${curr.index + 1}): "${curr.label}"`
                });
                issues.push('not sequential');
            }
        }
    }
    
    return { 
        valid: issues.length === 0, 
        issues, 
        count: playOrders.length, 
        playOrders: sortedOrders.map(p => p.order),
        detailedErrors 
    };
}

function extractFilename(href) {
    return path.basename(href || '').split('#')[0].toLowerCase();
}

function extractTocLinksFromHtml(html) {
    const links = [];
    const regex = /<a[^>]+href\s*=\s*["']([^"']+)["']/gi;
    let match;
    while ((match = regex.exec(html))) {
        const href = match[1];
        links.push(extractFilename(href));
    }
    return links;
}

function getSpineFilenames(spineItemrefs, manifest) {
    return spineItemrefs
        .map(ref => {
            const item = manifest.find(i => i['@_id'] === ref['@_idref']);
            return item ? extractFilename(item['@_href']) : null;
        })
        .filter(Boolean);
}

function validateUniqueId(pkg) {
    const uniqueId = pkg.$?.['unique-identifier'];
    if (!uniqueId) return { valid: false, issue: 'missing unique-identifier attribute' };
    
    const metadata = pkg.metadata;
    const identifiers = getArray(metadata?.['dc:identifier']);
    const matchingId = identifiers.find(id => id.$?.id === uniqueId);
    
    if (!matchingId) {
        return { valid: false, issue: `unique-identifier="${uniqueId}" not found in metadata` };
    }
    
    return { valid: true, identifier: matchingId._ || matchingId };
}

function validateMetadata(pkg, isEpub3) {
    const issues = [];
    const metadata = pkg.metadata;
    
    if (!metadata) {
        issues.push({ field: 'metadata', issue: 'missing entirely' });
        return issues;
    }
    
    // Required Dublin Core elements
    const requiredDC = ['dc:title', 'dc:language', 'dc:identifier'];
    requiredDC.forEach(field => {
        const values = getArray(metadata[field]);
        if (!values.length) {
            issues.push({ field, issue: 'required field missing' });
        }
    });
    
    // Language validation
    const languages = getArray(metadata['dc:language']);
    languages.forEach((lang, idx) => {
        const langCode = lang._ || lang;
        if (!/^[a-z]{2,3}(-[A-Z]{2})?$/.test(langCode)) {
            issues.push({ field: 'dc:language', issue: `invalid language code: "${langCode}"` });
        }
    });
    
    // Modified date for EPUB3
    if (isEpub3) {
        const metaElements = getArray(metadata.meta);
        const hasModified = metaElements.some(m => m.$?.property === 'dcterms:modified');
        if (!hasModified) {
            issues.push({ field: 'dcterms:modified', issue: 'required for EPUB3' });
        }
    }
    
    return issues;
}

function validateManifestItems(manifest, opfDir, tempDir) {
    const issues = [];
    const fileRefs = new Set();
    
    manifest.forEach((item, idx) => {
        const id = item['@_id'];
        const href = item['@_href'];
        const mediaType = item['@_media-type'];
        
        // Required attributes
        if (!id) issues.push({ index: idx, issue: 'missing id attribute' });
        if (!href) issues.push({ index: idx, issue: 'missing href attribute' });
        if (!mediaType) issues.push({ index: idx, issue: 'missing media-type attribute' });
        
        if (href) {
            // Check for duplicate hrefs
            if (fileRefs.has(href)) {
                issues.push({ index: idx, href, issue: 'duplicate href in manifest' });
            }
            fileRefs.add(href);
            
            // File existence check
            const fullPath = path.join(opfDir, href);
            if (!fs.existsSync(fullPath)) {
                issues.push({ index: idx, href, issue: 'file does not exist' });
            }
            
            // Media type validation
            if (mediaType && href) {
                const ext = path.extname(href).toLowerCase();
                const expectedTypes = {
                    '.xhtml': 'application/xhtml+xml',
                    '.html': 'application/xhtml+xml',
                    '.css': 'text/css',
                    '.jpg': 'image/jpeg',
                    '.jpeg': 'image/jpeg',
                    '.png': 'image/png',
                    '.gif': 'image/gif',
                    '.svg': 'image/svg+xml',
                    '.ncx': 'application/x-dtbncx+xml',
                    '.otf': 'font/otf',
                    '.ttf': 'font/ttf',
                    '.woff': 'font/woff',
                    '.woff2': 'font/woff2'
                };
                
                if (expectedTypes[ext] && mediaType !== expectedTypes[ext]) {
                    issues.push({ 
                        index: idx, 
                        href, 
                        issue: `media-type mismatch: got "${mediaType}", expected "${expectedTypes[ext]}"` 
                    });
                }
            }
        }
    });
    
    return issues;
}

function validateSpineItemrefs(spineItemrefs, manifest) {
    const issues = [];
    
    spineItemrefs.forEach((itemref, idx) => {
        const idref = itemref['@_idref'];
        
        if (!idref) {
            issues.push({ index: idx, issue: 'missing idref attribute' });
            return;
        }
        
        // Check if idref points to valid manifest item
        const manifestItem = manifest.find(item => item['@_id'] === idref);
        if (!manifestItem) {
            issues.push({ index: idx, idref, issue: 'idref not found in manifest' });
            return;
        }
        
        // Check if referenced item is valid content document
        const mediaType = manifestItem['@_media-type'];
        const validContentTypes = ['application/xhtml+xml', 'application/x-dtbook+xml'];
        if (!validContentTypes.includes(mediaType)) {
            issues.push({ 
                index: idx, 
                idref, 
                issue: `invalid content type "${mediaType}" for spine (must be XHTML)` 
            });
        }
        
        // Validate linear attribute
        const linear = itemref['@_linear'];
        if (linear && !['yes', 'no'].includes(linear)) {
            issues.push({ index: idx, idref, issue: `invalid linear attribute: "${linear}"` });
        }
    });
    
    return issues;
}

function checkInternalLinks(manifest, opfDir) {
    const issues = [];
    const htmlFiles = manifest.filter(item => {
        const mt = item['@_media-type'];
        return mt === 'application/xhtml+xml';
    });
    
    const manifestHrefs = new Set(manifest.map(item => 
        path.normalize(item['@_href']).replace(/\\/g, '/').toLowerCase()
    ));
    
    htmlFiles.forEach(item => {
        const htmlPath = path.join(opfDir, item['@_href']);
        if (!fs.existsSync(htmlPath)) return;
        
        const html = fs.readFileSync(htmlPath, 'utf8');
        const linkRegex = /(?:href|src)\s*=\s*["']([^"'#]+)(?:#[^"']*)?["']/gi;
        let match;
        
        while ((match = linkRegex.exec(html))) {
            const link = match[1];
            
            // Skip external links
            if (/^https?:\/\//i.test(link)) continue;
            if (/^data:/i.test(link)) continue;
            
            // Resolve relative path
            const linkDir = path.dirname(item['@_href']);
            const resolvedLink = path.normalize(path.join(linkDir, link)).replace(/\\/g, '/').toLowerCase();
            
            if (!manifestHrefs.has(resolvedLink)) {
                issues.push({
                    file: item['@_href'],
                    brokenLink: link,
                    resolved: resolvedLink,
                    issue: 'internal link target not in manifest'
                });
            }
        }
    });
    
    return issues.slice(0, 20); // Limit to first 20 issues
}

function validateGuide(pkg, manifest) {
    const issues = [];
    const guide = pkg.guide;
    
    if (!guide) return issues;
    
    const references = getArray(guide.reference);
    references.forEach((ref, idx) => {
        const type = ref['@_type'];
        const href = ref['@_href'];
        const title = ref['@_title'];
        
        if (!type) issues.push({ index: idx, issue: 'missing type attribute' });
        if (!href) issues.push({ index: idx, issue: 'missing href attribute' });
        
        if (href) {
            const baseHref = href.split('#')[0];
            const manifestItem = manifest.find(item => item['@_href'] === baseHref);
            if (!manifestItem) {
                issues.push({ index: idx, href, issue: 'guide href not in manifest' });
            }
        }
    });
    
    return issues;
}

function checkForCommonIssues(manifest, opfDir) {
    const issues = [];
    
    // Check for multiple cover images
    const coverImages = manifest.filter(item => {
        const props = (item['@_properties'] || '').toLowerCase();
        return props.includes('cover-image') || item['@_id'] === 'cover-image';
    });
    
    if (coverImages.length > 1) {
        issues.push({
            id: 'MULTIPLE_COVERS',
            title: 'Multiple cover images declared',
            count: coverImages.length,
            issue: 'Only one cover-image should be declared'
        });
    }
    
    // Check for empty XHTML files
    const xhtmlItems = manifest.filter(item => 
        item['@_media-type'] === 'application/xhtml+xml'
    );
    
    xhtmlItems.forEach(item => {
        const filePath = path.join(opfDir, item['@_href']);
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            const bodyMatch = content.match(/<body[^>]*>(.*?)<\/body>/is);
            if (bodyMatch) {
                const bodyContent = bodyMatch[1].replace(/\s/g, '');
                if (bodyContent.length < 10) {
                    issues.push({
                        file: item['@_href'],
                        issue: 'nearly empty content document'
                    });
                }
            }
        }
    });
    
    // Check for unreferenced images/fonts
    const mediaFiles = manifest.filter(item => {
        const mt = item['@_media-type'];
        return mt && (mt.startsWith('image/') || mt.startsWith('font/') || mt.startsWith('audio/') || mt.startsWith('video/'));
    });
    
    const allHtmlContent = xhtmlItems.map(item => {
        const filePath = path.join(opfDir, item['@_href']);
        return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    }).join('\n');
    
    const cssFiles = manifest.filter(item => item['@_media-type'] === 'text/css');
    const allCssContent = cssFiles.map(item => {
        const filePath = path.join(opfDir, item['@_href']);
        return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    }).join('\n');
    
    const unreferencedMedia = mediaFiles.filter(item => {
        const filename = path.basename(item['@_href']);
        const inHtml = allHtmlContent.includes(filename);
        const inCss = allCssContent.includes(filename);
        return !inHtml && !inCss;
    });
    
    if (unreferencedMedia.length > 0) {
        issues.push({
            id: 'UNREFERENCED_MEDIA',
            title: `${unreferencedMedia.length} unreferenced media files`,
            files: unreferencedMedia.slice(0, 5).map(i => i['@_href'])
        });
    }
    
    return issues;
}

async function runStructureChecks({ tempDir, zipEntries, epubPath }) {
    const results = [];

    // 1. MIMETYPE CHECK
    const mimetypePath = path.join(tempDir, 'mimetype');
    if (!fs.existsSync(mimetypePath)) {
        results.push({
            id: 'S_MIMETYPE_MISSING', 
            title: 'Missing mimetype', 
            status: 'fail',
            details: 'mimetype file required at root', 
            autofix: { action: 'create', path: 'mimetype', content: 'application/epub+zip' }
        });
    } else {
        const content = fs.readFileSync(mimetypePath, 'utf8').trim();
        if (content !== 'application/epub+zip') {
            results.push({
                id: 'S_MIMETYPE_CONTENT', 
                title: 'Wrong mimetype', 
                status: 'fail',
                details: `Expected "application/epub+zip", got "${content}"`,
                autofix: { action: 'overwrite', path: 'mimetype', content: 'application/epub+zip' }
            });
        } else {
            results.push({ 
                id: 'S_MIMETYPE', 
                title: 'Mimetype OK', 
                status: 'pass' 
            });
        }
    }

    // 2. CONTAINER → OPF
    const containerPath = path.join(tempDir, 'META-INF', 'container.xml');
    if (!fs.existsSync(containerPath)) {
        results.push({
            id: 'S_CONTAINER_MISSING', 
            title: 'Missing container.xml', 
            status: 'fail',
            autofix: { action: 'createContainer' }
        });
        return results;
    }

    const containerXml = parseXml(fs.readFileSync(containerPath, 'utf8'));
    const rootfiles = getArray(containerXml?.container?.rootfiles?.rootfile);
    const opfPath = rootfiles[0]?.['@_full-path']?.replace(/\\/g, '/');
    const opfFull = path.join(tempDir, opfPath);

    if (!opfPath || !fs.existsSync(opfFull)) {
        results.push({ 
            id: 'S_OPF_MISSING', 
            title: 'OPF missing', 
            status: 'fail', 
            details: opfPath 
        });
        return results;
    }
    
    // Return OPF path for other checks to use
    results.push({ 
        id: 'S_OPF_PATH', 
        title: 'OPF found', 
        status: 'pass', 
        details: { opfPath } 
    });

    // 3. PARSE OPF
    const opfXml = parseXml(fs.readFileSync(opfFull, 'utf8'));
    const pkg = opfXml?.package;
    if (!pkg) {
        results.push({ 
            id: 'S_OPF_INVALID', 
            title: 'Invalid OPF XML', 
            status: 'fail' 
        });
        return results;
    }

    const version = pkg.$?.version || 'unknown';
    const isEpub3 = version.startsWith('3.');
    const manifest = getArray(pkg.manifest?.item);
    const spineItemrefs = getArray(pkg.spine?.itemref);
    const spineToc = pkg.spine?.$?.toc;
    const opfDir = path.dirname(opfFull);

    results.push({ 
        id: 'S_VERSION', 
        title: `Version ${version}`, 
        status: 'pass' 
    });

    // 4. UNIQUE IDENTIFIER CHECK
    const uniqueIdCheck = validateUniqueId(pkg);
    if (!uniqueIdCheck.valid) {
        results.push({
            id: 'S_UNIQUE_ID_INVALID',
            title: 'Invalid unique-identifier',
            status: 'fail',
            details: uniqueIdCheck.issue,
            autofix: { action: 'fixUniqueIdentifier' }
        });
    } else {
        results.push({
            id: 'S_UNIQUE_ID',
            title: 'Unique identifier OK',
            status: 'pass',
            details: uniqueIdCheck.identifier
        });
    }

    // 5. METADATA VALIDATION
    const metadataIssues = validateMetadata(pkg, isEpub3);
    if (metadataIssues.length > 0) {
        results.push({
            id: 'S_METADATA_ISSUES',
            title: `${metadataIssues.length} metadata issue(s)`,
            status: 'fail',
            details: metadataIssues.map(i => `${i.field}: ${i.issue}`).join('; '),
            autofix: { action: 'fixMetadata', issues: metadataIssues }
        });
    } else {
        results.push({ 
            id: 'S_METADATA', 
            title: 'Metadata OK', 
            status: 'pass' 
        });
    }

    // 6. MANIFEST VALIDATION
    if (!manifest.length) {
        results.push({ 
            id: 'S_MANIFEST_EMPTY', 
            title: 'Empty manifest', 
            status: 'fail' 
        });
    } else {
        // Check duplicate manifest IDs
        const manifestIds = manifest.map(i => i['@_id']).filter(Boolean);
        const dupManifestIds = manifestIds.filter((id, i) => manifestIds.indexOf(id) !== i);
        if (dupManifestIds.length) {
            results.push({
                id: 'S_MANIFEST_DUP_IDS', 
                title: 'Duplicate manifest IDs', 
                status: 'fail',
                details: dupManifestIds.join(', '),
                autofix: { action: 'fixDuplicateIds', target: 'manifest' }
            });
        }

        // Detailed manifest item validation
        const manifestIssues = validateManifestItems(manifest, opfDir, tempDir);
        if (manifestIssues.length > 0) {
            results.push({
                id: 'S_MANIFEST_ITEMS_INVALID',
                title: `${manifestIssues.length} manifest item issue(s)`,
                status: 'fail',
                details: manifestIssues.slice(0, 10).map(i => 
                    `Item ${i.index}${i.href ? ` (${i.href})` : ''}: ${i.issue}`
                ).join('; '),
                autofix: { action: 'fixManifestItems', issues: manifestIssues }
            });
        }
    }

    // 7. SPINE VALIDATION
    if (!spineItemrefs?.length) {
        results.push({ 
            id: 'S_SPINE_EMPTY', 
            title: 'Empty spine', 
            status: 'fail' 
        });
    } else {
        // Check duplicate spine IDREFs
        const spineIdrefs = spineItemrefs.map(r => r['@_idref']).filter(Boolean);
        const dupSpineIdrefs = spineIdrefs.filter((id, i) => spineIdrefs.indexOf(id) !== i);
        if (dupSpineIdrefs.length) {
            results.push({
                id: 'S_SPINE_DUP_IDREFS', 
                title: 'Duplicate spine IDREFs', 
                status: 'fail',
                details: dupSpineIdrefs.join(', ')
            });
        }

        // Detailed spine itemref validation
        const spineIssues = validateSpineItemrefs(spineItemrefs, manifest);
        if (spineIssues.length > 0) {
            results.push({
                id: 'S_SPINE_ITEMREFS_INVALID',
                title: `${spineIssues.length} spine itemref issue(s)`,
                status: 'fail',
                details: spineIssues.slice(0, 10).map(i => 
                    `Itemref ${i.index}${i.idref ? ` (${i.idref})` : ''}: ${i.issue}`
                ).join('; '),
                autofix: { action: 'fixSpineItemrefs', issues: spineIssues }
            });
        }

        // Spine reading order vs manifest declaration order
        const manifestOrder = {};
        manifest.forEach((item, i) => { 
            if (item['@_id']) manifestOrder[item['@_id']] = i; 
        });
        const outOfOrder = [];
        for (let i = 1; i < spineIdrefs.length; i++) {
            const prev = manifestOrder[spineIdrefs[i-1]];
            const curr = manifestOrder[spineIdrefs[i]];
            if (prev !== undefined && curr !== undefined && curr < prev) {
                outOfOrder.push(`${spineIdrefs[i-1]}→${spineIdrefs[i]}`);
            }
        }
        if (outOfOrder.length) {
            results.push({
                id: 'S_SPINE_OUT_OF_ORDER', 
                title: 'Spine reading order vs manifest', 
                status: 'warn',
                details: outOfOrder.slice(0,5).join('; ')
            });
        }
    }

    // 8. ORPHAN FILE CHECK (using FULL PATHS from zip root)
    const declaredPaths = new Set();
    const opfDirFromRoot = path.dirname(opfPath); // e.g., "OEBPS" or "OEBPS/content" etc.
     let ncxItem = manifest.find(item => (item['@_media-type'] || '').includes('ncx'));
    manifest.forEach(item => {
        if (item['@_href']) {
            // Resolve relative path from OPF location to absolute path from zip root
            const relativePath = item['@_href'];
            const absolutePath = path.join(opfDirFromRoot, relativePath).replace(/\\/g, '/');
            declaredPaths.add(absolutePath);
        }
    });
    
    // Also add the OPF file itself and NCX if present
    declaredPaths.add(opfPath.replace(/\\/g, '/'));
    if (ncxItem) {
        const ncxAbsolutePath = path.join(opfDirFromRoot, ncxItem['@_href']).replace(/\\/g, '/');
        declaredPaths.add(ncxAbsolutePath);
    }
    
    const contentFiles = zipEntries
        .map(e => path.normalize(e).replace(/\\/g, '/'))
        .filter(f => !f.startsWith('mimetype') && !f.startsWith('META-INF/'));
    
    const orphans = contentFiles.filter(f => !declaredPaths.has(f));
    if (orphans.length) {
        results.push({
            id: 'S_ORPHAN_FILES', 
            title: `${orphans.length} undeclared files`, 
            status: 'fail',
            details: orphans.slice(0,10).join(', '),
            autofix: { action: 'addToManifest', files: orphans.slice(0,5) }
        });
    } else {
        results.push({ 
            id: 'S_ORPHAN_FILES', 
            title: 'No orphans', 
            status: 'pass' 
        });
    }

    // 9. INTERNAL LINKS VALIDATION
    const brokenLinks = checkInternalLinks(manifest, opfDir);
    if (brokenLinks.length > 0) {
        results.push({
            id: 'S_BROKEN_INTERNAL_LINKS',
            title: `${brokenLinks.length}+ broken internal links`,
            status: 'fail',
            details: brokenLinks.slice(0, 5).map(l => 
                `${l.file}: "${l.brokenLink}"`
            ).join('; ')
        });
    } else {
        results.push({ 
            id: 'S_INTERNAL_LINKS', 
            title: 'Internal links OK', 
            status: 'pass' 
        });
    }

    // 10. GUIDE VALIDATION (EPUB2)
    if (!isEpub3) {
        const guideIssues = validateGuide(pkg, manifest);
        if (guideIssues.length > 0) {
            results.push({
                id: 'S_GUIDE_INVALID',
                title: `${guideIssues.length} guide issue(s)`,
                status: 'warn',
                details: guideIssues.map(i => `Ref ${i.index}: ${i.issue}`).join('; ')
            });
        }
    }

    // 11. NAVIGATION CHECKS
    let navItem = manifest.find(item => {
        const props = (item['@_properties'] || '').toLowerCase();
        return props.includes('nav') || /nav\.(x?html?)$/i.test(item['@_href'] || '');
    });
   

    // 11a. NCX toc.ncx vs SPINE MATCHING
    if (ncxItem) {
        const ncxPath = path.join(opfDir, ncxItem['@_href']);
        if (fs.existsSync(ncxPath)) {
            const ncxXml = parseXml(fs.readFileSync(ncxPath, 'utf8'));
            const navPoints = getArray(ncxXml?.ncx?.navMap?.navPoint);
            
            if (navPoints.length) {
                // CHECK 1: NCX playOrder sequence + duplicates
                const navPoCheck = validatePlayOrders(navPoints, 'NCX navMap');
                if (!navPoCheck.valid) {
                    const errorDetails = navPoCheck.detailedErrors.map(err => {
                        if (err.type === 'gap') {
                            return `GAP after playOrder ${err.from}: jumps to ${err.to} (missing ${err.missing.join(', ')})\n  After: ${err.afterItem}\n  Before: ${err.beforeItem}`;
                        } else if (err.type === 'duplicate') {
                            return `DUPLICATE playOrder ${err.playOrder}: ${err.items}`;
                        } else if (err.type === 'wrong_start') {
                            return `MUST START AT 1: starts at ${err.actual} (${err.item})`;
                        }
                        return '';
                    }).filter(Boolean).join('\n\n');
                    
                    results.push({
                        id: 'NCX_PLAYORDER_INVALID',
                        title: 'NCX navMap playOrder broken',
                        status: 'fail',
                        details: `${navPoCheck.count} entries, ${navPoCheck.issues.join(', ')}\n\n${errorDetails}`,
                        autofix: { action: 'fixSequentialPlayOrder', target: 'ncx/navMap' }
                    });
                }

                // CHECK 2: NCX order vs SPINE order (filename sequence match)
                const spineFilenames = getSpineFilenames(spineItemrefs, manifest);
                const ncxFilenames = navPoints.map(np => extractFilename(np.content?.['@_src']));
                
                const maxCheck = Math.min(spineFilenames.length, ncxFilenames.length);
                let ncxSpineMatch = true;
                const mismatches = [];
                
                for (let i = 0; i < maxCheck; i++) {
                    if (spineFilenames[i] !== ncxFilenames[i]) {
                        ncxSpineMatch = false;
                        const navPoint = navPoints[i];
                        mismatches.push(
                            `Position ${i+1}:\n` +
                            `  NCX: "${ncxFilenames[i]}" (${navPoint.navLabel?.text || 'untitled'})\n` +
                            `  SPINE: "${spineFilenames[i]}"`
                        );
                    }
                }
                
                if (!ncxSpineMatch || maxCheck < spineItemrefs.length) {
                    const mismatchDetails = mismatches.length 
                        ? `MISMATCHES FOUND:\n\n${mismatches.slice(0,8).join('\n\n')}`
                        : `NCX has ${ncxFilenames.length} entries but spine has ${spineFilenames.length}`;
                    
                    results.push({
                        id: 'NCX_SPINE_MISMATCH',
                        title: 'NCX order ≠ spine order',
                        status: 'fail',
                        details: mismatchDetails,
                        autofix: null
                    });
                } else {
                    results.push({ 
                        id: 'NCX_SPINE_MATCH', 
                        title: 'NCX matches spine', 
                        status: 'pass' 
                    });
                }

                // NCX pagelist playOrder
                const pageTargets = getArray(ncxXml?.ncx?.pageList?.pageTarget);
                if (pageTargets.length) {
                    const pagePoCheck = validatePlayOrders(pageTargets, 'NCX pageList');
                    if (!pagePoCheck.valid) {
                        const errorDetails = pagePoCheck.detailedErrors.map(err => {
                            if (err.type === 'gap') {
                                return `GAP after playOrder ${err.from}: jumps to ${err.to} (missing ${err.missing.join(', ')})\n  After: ${err.afterItem}\n  Before: ${err.beforeItem}`;
                            } else if (err.type === 'duplicate') {
                                return `DUPLICATE playOrder ${err.playOrder}: ${err.items}`;
                            } else if (err.type === 'wrong_start') {
                                return `MUST START AT 1: starts at ${err.actual} (${err.item})`;
                            }
                            return '';
                        }).filter(Boolean).join('\n\n');
                        
                        results.push({
                            id: 'NCX_PAGELIST_PLAYORDER',
                            title: 'NCX pageList playOrder broken',
                            status: 'fail',
                            details: `${pagePoCheck.count} entries, ${pagePoCheck.issues.join(', ')}\n\n${errorDetails}`,
                            autofix: { action: 'fixSequentialPlayOrder', target: 'ncx/pageList' }
                        });
                    }
                }
            }
        }
    }

    // 11b. NAV.XHTML vs SPINE MATCHING (EPUB3)
    if (isEpub3 && navItem) {
        const navPath = path.join(opfDir, navItem['@_href']);
        if (fs.existsSync(navPath)) {
            const navHtml = fs.readFileSync(navPath, 'utf8');
            const tocLinks = extractTocLinksFromHtml(navHtml);
            const spineFilenames = getSpineFilenames(spineItemrefs, manifest);
            
            const maxCheck = Math.min(tocLinks.length, spineFilenames.length);
            let navMatch = true;
            const mismatches = [];
            
            for (let i = 0; i < maxCheck; i++) {
                if (tocLinks[i] !== spineFilenames[i]) {
                    navMatch = false;
                    mismatches.push(
                        `Position ${i+1}:\n` +
                        `  NAV: "${tocLinks[i]}"\n` +
                        `  SPINE: "${spineFilenames[i]}"`
                    );
                }
            }
            
            if (!navMatch || maxCheck < spineFilenames.length) {
                const mismatchDetails = mismatches.length 
                    ? `MISMATCHES FOUND:\n\n${mismatches.slice(0,8).join('\n\n')}`
                    : `NAV has ${tocLinks.length} links but spine has ${spineFilenames.length} items`;
                
                results.push({
                    id: 'NAV_SPINE_MISMATCH',
                    title: 'nav.xhtml TOC ≠ spine order',
                    status: 'fail',
                    details: mismatchDetails,
                    autofix: null
                });
            } else {
                results.push({ 
                    id: 'NAV_SPINE_MATCH', 
                    title: 'nav.xhtml matches spine', 
                    status: 'pass' 
                });
            }

            // page-list in nav.xhtml
            const pageListLinks = [];
            const pageRegex = /<a[^>]+href\s*=\s*["']([^"']*page_\d+)["']/gi;
            let pageMatch;
            while ((pageMatch = pageRegex.exec(navHtml))) {
                pageListLinks.push(extractFilename(pageMatch[1]));
            }
            if (pageListLinks.length && spineFilenames.length) {
                results.push({ 
                    id: 'NAV_PAGE_LIST', 
                    title: `${pageListLinks.length} page-list entries`, 
                    status: 'pass' 
                });
            }
        }
    }

    // 12. MISSING NAVIGATION
    if (!ncxItem && !navItem) {
        results.push({
            id: 'S_NO_NAVIGATION',
            title: 'Missing navigation (NCX or nav)',
            status: isEpub3 ? 'fail' : 'warn',
            autofix: { action: 'addNavigation', epub3: isEpub3 }
        });
    }

    // 13. SPINE TOC ATTRIBUTE (legacy readers)
    if (!isEpub3 && !spineToc) {
        results.push({
            id: 'S_SPINE_NO_TOC',
            title: 'Missing spine@toc (legacy)',
            status: 'warn',
            details: 'Add spine toc="ncx"',
            autofix: { action: 'addSpineTocAttr', value: ncxItem?.['@_id'] || 'ncx' }
        });
    }

    // 14. COMMON ISSUES CHECK
    const commonIssues = checkForCommonIssues(manifest, opfDir);
    commonIssues.forEach(issue => {
        results.push({
            id: issue.id,
            title: issue.title,
            status: 'warn',
            details: issue.files ? issue.files.join(', ') : issue.issue,
            count: issue.count
        });
    });

    return results;
}

module.exports = { runStructureChecks };