// src/checks/metadata-checks.js
const fs = require('fs');
const path = require('path');
// const { aiSuggestion } = require("../utils/ai-suggest");


function safeGet(obj, key) {
  if (!obj) return undefined;
  return obj[key] ?? obj[key.toLowerCase()];
}
function asArray(v) { if (v === undefined || v === null) return []; return Array.isArray(v) ? v : [v]; }

function findLineInfo(filePath, searchSnippet) {
  // returns { line, context } (1-indexed). If not found, returns null.
  try {
    const txt = fs.readFileSync(filePath, 'utf8');
    const idx = txt.indexOf(searchSnippet);
    if (idx === -1) return null;
    const upto = txt.slice(0, idx);
    const line = upto.split(/\r\n|\n/).length;
    // provide +/- 2 lines as context
    const lines = txt.split(/\r\n|\n/);
    const start = Math.max(0, line - 3);
    const end = Math.min(lines.length, line + 2);
    const context = lines.slice(start, end).join('\n');
    return { line, context };
  } catch (e) {
    return null;
  }
}

function isIso8601NoMs(ts) {
  // Very strict for dcterms:modified: YYYY-MM-DDThh:mm:ssZ  (no fractional seconds)
  // Accept timezone Z or +hh:mm / -hh:mm (EPUB allows timezone).
  if (typeof ts !== 'string') return false;
  // Examples: 2024-12-05T06:51:00Z or 2024-12-05T06:51:00+05:30
  const re = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/;
  return re.test(ts);
}

function isUUIDURN(v) {
  if (typeof v !== 'string') return false;
  return /^urn:uuid:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v);
}

function isISBN13(v) {
  // Basic ISBN-13 pattern (no checksum calc)
  if (typeof v !== 'string') return false;
  return /^(97(8|9))?\d{9}(\d|X)$/.test(v.replace(/[-\s]/g, ''));
}

function isBCP47(tag) {
  // lightweight check: language (-region) allowed. Not full BCP-47 validation.
  if (typeof tag !== 'string') return false;
  return /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(tag);
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function readOpfText(opfAbsolute) {
  try {
    return fs.readFileSync(opfAbsolute, 'utf8');
  } catch (e) {
    return null;
  }
}

async function runMetadataChecks({ tempDir, opfAbsolute, opfXml }) {
  const results = [];

  if (!opfAbsolute || !opfXml) {
    results.push({
      id: 'M_OPF',
      title: 'OPF not parsed for metadata checks',
      status: 'warn',
      details: 'No OPF available',
      // suggestion: 'Ensure OPF exists and is parseable'
    });
    return results;
  }

  // raw text for line numbers
  const opfText = readOpfText(opfAbsolute);

  const pkg = opfXml?.package || opfXml;
  const metadata = pkg?.metadata || {};
  const manifest = asArray(pkg?.manifest?.item ?? pkg?.manifest ?? []);
  const uniqueIdAttr = pkg['@_unique-identifier'] || pkg['unique-identifier'] || pkg['uniqueIdentifier'] || pkg?.['unique-identifier'];
  // NOTE: different xml parser shapes -> try to be tolerant
  // metadata keys often appear with dc: prefix or not.
  // We'll normalize by grabbing known dc: keys (try DC names first)
  const getField = (name) => {
    // name like 'dc:title' or 'dc:creator'
    const val = metadata?.[name] ?? metadata?.[name.replace('dc:', '')] ?? metadata?.[name.toLowerCase()];
    return val;
  };

  // Helper that returns first string value when array/object encountered
  const firstText = (v) => {
    if (v === undefined || v === null) return undefined;
    if (typeof v === 'string') return v;
    if (typeof v === 'object') {
      // many xml->js parsers produce { '#text': 'value', '@_id': 'x' } or simply { '@_id':..., '':... }
      if (v['#text']) return String(v['#text']);
      // if v has '@_id' and plain value might be inside
      const keys = Object.keys(v);
      for (const k of keys) {
        if (typeof v[k] === 'string') return v[k];
      }
      // fallback to JSON
      return JSON.stringify(v);
    }
    return String(v);
  };

  // Gather fields (as arrays for duplicates detection)
  const rawTitle = asArray(getField('dc:title') ?? getField('title'));
  const rawIdentifier = asArray(getField('dc:identifier') ?? getField('identifier'));
  const rawLanguage = asArray(getField('dc:language') ?? getField('language'));
  const rawPublisher = asArray(
    getField('dc:publisher') ??
    getField('dcterms:publisher') ??
    getField('publisher')
  );
  const rawRights = asArray(getField('dc:rights') ?? getField('rights'));
  const rawCreator = asArray(getField('dc:creator') ?? getField('creator'));
  const rawContributor = asArray(getField('dc:contributor') ?? getField('contributor'));
  const rawSubject = asArray(getField('dc:subject') ?? getField('subject'));
  const rawDescription = asArray(getField('dc:description') ?? getField('description'));
  const rawDate = asArray(getField('dc:date') ?? getField('date'));
  const rawMetaProperties = []; // we'll also scan <meta property="..."> entries in metadata if available
  // Some parsers put <meta> entries under metadata.meta or metadata['meta']
  const metaEntries = asArray(metadata?.meta ?? metadata?.['@_meta'] ?? metadata?.['meta'] ?? []);
  // metaEntries might be array of objects with '@_property' and '#text' or similar
  for (const me of metaEntries) {
    // try multiple shapes
    const prop = me?.['@_property'] || me?.['property'] || me?.['@_name'] || me?.name || me?.['@_id'];
    const val = firstText(me) || me?.['#text'] || me?.['@_content'] || me?.content || '';
    if (prop) rawMetaProperties.push({ property: prop, value: String(val) });
  }

  // Many xml parsers list metadata children as objects directly; find properties by scanning
  // We'll also inspect metadata for keys that start with 'meta' and pick out '@_property' forms
  // If parser uses attributes with '@_', try to collect them
  if (metadata) {
    Object.keys(metadata).forEach(k => {
      if (k && k.toLowerCase().includes('meta')) {
        const arr = asArray(metadata[k]);
        arr.forEach(me => {
          const prop = me?.['@_property'] || me?.property || me?.['@_name'] || me?.name;
          const val = firstText(me) || me?.['#text'] || me?.['@_content'] || me?.content || '';
          if (prop) rawMetaProperties.push({ property: prop, value: String(val) });
        });
      }
    });
  }

  // Helper to add result with optional line/context + AI suggestion if fail/warn
  async function addResultBase({ id, title, status, details, suggestion, searchSnippet }) {
    const res = { id, title, status, details };

    // Attach file+line context if available
    if (searchSnippet && opfText) {
      const li = findLineInfo(opfAbsolute, searchSnippet);
      if (li) {
        res.file = path.relative(process.cwd(), opfAbsolute);
        res.line = li.line;
        res.context = li.context;
      }
    }

    // If status is fail or warn → replace suggestion with AI version
    if (status !== 'pass') {
      console.log("suggestion")
      // const ai = await aiSuggestion(res);
      // res.suggestion = ai; // Single line suggestion
    } else {
      res.suggestion = ""; // passes have empty suggestion
    }

    results.push(res);
  }


  // ---------- CHECKS START ----------

  // 1. metadata container present
  if (!metadata || Object.keys(metadata).length === 0) {
    await addResultBase({
      id: 'M_METADATA_CONTAINER',
      title: 'Missing metadata container',
      status: 'fail',
      details: 'OPF metadata element missing or empty',
      // suggestion: 'Add <metadata> section in OPF'
    });
    // If metadata missing, many other checks can't run; still continue to push basic placeholders
  } else {
    await addResultBase({
      id: 'M_METADATA_CONTAINER',
      title: 'Metadata container present',
      status: 'pass',
      details: 'OPF metadata appears present'
    });
  }

  // 2. title
  // const titleVal = firstText(rawTitle[0]);
  // if (!titleVal || String(titleVal).trim().length === 0) {
  //   await addResultBase({
  //     id: 'M_TITLE',
  //     title: 'Missing title',
  //     status: 'fail',
  //     details: 'No <dc:title> in OPF metadata',
  //     // suggestion: 'Add <dc:title>'
  //   });
  // } else {
  //   await addResultBase({
  //     id: 'M_TITLE',
  //     title: 'Title present',
  //     status: 'pass',
  //     details: String(titleVal).slice(0, 500)
  //   });
  // }

  // 3. identifier(s) + unique-identifier attribute
  if (!rawIdentifier.length) {
    await addResultBase({
      id: 'M_IDENTIFIER',
      title: 'Missing identifier',
      status: 'fail',
      details: 'No <dc:identifier> (UUID or ISBN) found in OPF metadata',
      // suggestion: 'Add <dc:identifier id="bookid">urn:uuid:...</dc:identifier> or ISBN'
    });
  } else {
    // check that unique-identifier references an existing identifier
    const idsFound = rawIdentifier.map(i => {
      if (typeof i === 'string') return i;
      // try object shapes
      if (i?.['#text']) return i['#text'];
      // sometimes id is in @_id
      if (i?.['@_id']) return firstText(i);
      return firstText(i);
    }).map(s => (s || '').toString());

    // if uniqueIdAttr is defined, check for match
    if (uniqueIdAttr) {
      // find the identifier element with @_id === uniqueIdAttr or id === uniqueIdAttr
      const match = rawIdentifier.find(i => {
        // various shapes
        const aid = i?.['@_id'] || i?.['@_ID'] || i?.id || i?.['@_xml:id'] || i?.['@id'];
        if (aid && String(aid) === String(uniqueIdAttr)) return true;
        return false;
      });
      if (!match) {
        await addResultBase({
          id: 'M_IDENTIFIER',
          title: 'Identifier present but unique-identifier mismatch',
          status: 'fail',
          details: `package unique-identifier="${uniqueIdAttr}" not found among identifier elements`,
          // suggestion: `Ensure <dc:identifier id="${uniqueIdAttr}"> exists and matches OPF package unique-identifier`,
          searchSnippet: `<package` // best-effort
        });
      } else {
        // good
        const idText = firstText(match);
        await addResultBase({
          id: 'M_IDENTIFIER',
          title: 'Identifier present',
          status: 'pass',
          details: idText?.slice ? String(idText).slice(0, 240) : String(idText)
        });
      }
    } else {
      // no unique-identifier attr — warn for EPUB3
      await addResultBase({
        id: 'M_IDENTIFIER',
        title: 'Identifier present (no package unique-identifier set)',
        status: 'warn',
        details: idsFound.join(' || '),
        // suggestion: 'Set package unique-identifier attribute to reference one <dc:identifier>'
      });
    }

    // validate if any identifier looks like urn:uuid or ISBN
    const firstIdText = firstText(rawIdentifier[0]);
    if (firstIdText) {
      if (isUUIDURN(firstIdText)) {
        await addResultBase({ id: 'M_IDENTIFIER_UUID', title: 'UUID format valid', status: 'pass', details: firstIdText });
      } else if (isISBN13(firstIdText)) {
        await addResultBase({ id: 'M_IDENTIFIER_ISBN', title: 'Identifier looks like ISBN', status: 'pass', details: firstIdText });
      } else {
        await addResultBase({
          id: 'M_IDENTIFIER_FORMAT', title: 'Identifier format unknown', status: 'warn', details: firstIdText,
          //  suggestion:'Consider using urn:uuid:... or a valid ISBN if applicable' 
        });
      }
    }
  }

  // 4. language
  const langVal = firstText(rawLanguage[0]);
  if (!langVal) {
    await addResultBase({
      id: 'M_LANGUAGE',
      title: 'Missing language',
      status: 'fail',
      details: 'No <dc:language> in metadata',
      // suggestion: 'Add language element (e.g. en or en-US)'
    });
  } else {
    const ok = isBCP47(String(langVal));
    await addResultBase({
      id: 'M_LANGUAGE',
      title: ok ? 'Language present' : 'Language present (format suspicious)',
      status: ok ? 'pass' : 'warn',
      details: String(langVal),
      suggestion: ok ? '' : 'Use BCP-47 language tag like "en" or "en-US"'
    });
  }

  // 5. publisher
  const metaPublisher = rawMetaProperties.find(
    (entry) => String(entry?.property || "").toLowerCase() === "dcterms:publisher"
  );
  const pubVal = firstText(rawPublisher[0]) || firstText(metaPublisher?.value);
  if (!pubVal) {
    await addResultBase({
      id: 'M_PUBLISHER',
      title: 'Missing publisher',
      status: 'warn',
      details: 'No <dc:publisher> or <meta property="dcterms:publisher"> found',
      // suggestion: 'Add publisher metadata if applicable'
    });
  } else {
    await addResultBase({ id: 'M_PUBLISHER', title: 'Publisher present', status: 'pass', details: String(pubVal) });
  }

  // 6. rights
  // const rightsVal = firstText(rawRights[0]);
  // if (!rightsVal) {
  //   await addResultBase({
  //     id: 'M_RIGHTS',
  //     title: 'Missing rights/copyright',
  //     status: 'warn',
  //     details: 'No <dc:rights>',
  //     // suggestion: 'Add appropriate copyright/rights metadata'
  //   });
  // } else {
  //   await addResultBase({ id: 'M_RIGHTS', title: 'Rights present', status: 'pass', details: String(rightsVal) });
  // }

  // 7. creators (authors)
  // const creators = rawCreator.map(firstText).filter(Boolean);
  // if (!creators.length) {
  //   await addResultBase({
  //     id: 'M_CREATOR',
  //     title: 'Missing creator/author',
  //     status: 'warn',
  //     details: 'No <dc:creator> found',
  //     // suggestion: 'Add <dc:creator> for author(s) with opf:role="aut" where appropriate'
  //   });
  // } else {
  //   // check role attribute if available (some parsers attach @_role or @_opf:role)
  //   const creatorEntries = asArray(getField('dc:creator') ?? getField('creator') ?? []);
  //   let missingRoleCount = 0;
  //   creatorEntries.forEach(c => {
  //     const role = c?.['@_opf:role'] || c?.['@_role'] || c?.['role'] || c?.['@_role'];
  //     if (!role) missingRoleCount++;
  //   });
  //   await addResultBase({
  //     id: 'M_CREATOR',
  //     title: 'Creator(s) present',
  //     status: missingRoleCount ? 'warn' : 'pass',
  //     details: creators.join(' || '),
  //     suggestion: missingRoleCount ? 'Consider adding opf:role="aut" to creator tags' : ''
  //   });
  // }

  // 8. contributors
  // const contributors = rawContributor.map(firstText).filter(Boolean);
  // if (contributors.length) {
  //   await addResultBase({ id: 'M_CONTRIBUTOR', title: 'Contributors present', status: 'pass', details: contributors.join(' || ') });
  // }

  // 9. subject / keywords
  // const subjects = rawSubject.map(firstText).filter(Boolean);
  // if (!subjects.length) {
  //   await addResultBase({
  //     id: 'M_SUBJECT', title: 'No subject/keywords', status: 'warn', details: 'No <dc:subject> found',
  //     //  suggestion:'Add subjects/keywords if applicable'
  //   });
  // } else {
  //   await addResultBase({ id: 'M_SUBJECT', title: 'Subjects present', status: 'pass', details: subjects.join(' || ') });
  // }

  // 10. description
  // const desc = rawDescription.map(firstText).filter(Boolean)[0];
  // if (!desc) {
  //   await addResultBase({
  //     id: 'M_DESCRIPTION', title: 'Missing description', status: 'warn', details: 'No <dc:description> found',
  //     //  suggestion:'Add a short description for better discovery' 
  //   });
  // } else {
  //   // check for HTML inside description (bad)
  //   const hasHtml = /<[^>]+>/.test(desc);
  //   await addResultBase({
  //     id: 'M_DESCRIPTION', title: hasHtml ? 'Description contains HTML' : 'Description present', status: hasHtml ? 'warn' : 'pass', details: String(desc).slice(0, 400),
  //     suggestion: hasHtml ? 'Remove HTML tags from <dc:description>' : ''
  //   });
  // }

  // 11. date
  const dateVal = firstText(rawDate[0]);
  if (dateVal) {
    // basic ISO date check yyyy-mm-dd or ISO datetime
    const ok = /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(dateVal);
    await addResultBase({
      id: 'M_DATE', title: ok ? 'Date present' : 'Date format suspicious', status: ok ? 'pass' : 'warn', details: String(dateVal),
      suggestion: ok ? '' : ''
    });
  } else {
    await addResultBase({ id: 'M_DATE', title: 'No dc:date', status: 'warn', details: 'No <dc:date> found' });
  }

  // 12. dcterms:modified (EPUB3 required)
  // search for meta property dcterms:modified in rawMetaProperties
  // const modifiedMeta = rawMetaProperties.find(m => String(m.property).toLowerCase() === 'dcterms:modified' || String(m.property).toLowerCase() === 'dcterms:modified');
  // if (modifiedMeta) {
  //   const mval = String(modifiedMeta.value || '').trim();
  //   if (mval && isIso8601NoMs(mval)) {
  //     await addResultBase({ id: 'M_DCTERMS_MODIFIED', title: 'dcterms:modified present', status: 'pass', details: mval, searchSnippet: mval });
  //   } else {
  //     await addResultBase({
  //       id: 'M_DCTERMS_MODIFIED', title: 'dcterms:modified format invalid', status: 'fail', details: mval || 'empty',
  //       //  suggestion:'Use YYYY-MM-DDThh:mm:ssZ or +hh:mm timezone (no milliseconds)',
  //       searchSnippet: mval || 'dcterms:modified'
  //     });
  //   }
  // } else {
  //   await addResultBase({
  //     id: 'M_DCTERMS_MODIFIED', title: 'dcterms:modified missing', status: 'warn', details: 'No dcterms:modified meta found',
  //     // suggestion:'Add <meta property="dcterms:modified">YYYY-MM-DDThh:mm:ssZ</meta>'
  //   });
  // }

  // 13. cover image metadata presence
  // meta name="cover" content="cover-image" OR meta property entries like 'cover'
  // let coverMeta = null;
  // // try metadata -> meta elements: we already collected rawMetaProperties
  // coverMeta = rawMetaProperties.find(m => String(m.property).toLowerCase() === 'cover' || String(m.property).toLowerCase() === 'meta:cover' || String(m.property).toLowerCase() === 'cover-image' || (m.property && String(m.property).toLowerCase().includes('cover')));
  // if (coverMeta && coverMeta.value) {
  //   // find manifest item with id == coverMeta.value or href == coverMeta.value
  //   const coverRef = String(coverMeta.value);
  //   const itemById = manifest.find(it => String(it['@_id'] || it.id || it['@id'] || it['@_href'] || '').toLowerCase() === coverRef.toLowerCase());
  //   const itemByHref = manifest.find(it => String(it['@_href'] || it.href || it['href'] || '').toLowerCase() === coverRef.toLowerCase());
  //   if (itemById || itemByHref) {
  //     await addResultBase({ id: 'M_COVER', title: 'Cover metadata present', status: 'pass', details: coverRef });
  //   } else {
  //     await addResultBase({
  //       id: 'M_COVER', title: 'Cover metadata references missing item', status: 'fail', details: coverRef,
  //       //  suggestion:'Ensure manifest contains item with id/href equal to cover metadata content' 
  //     });
  //   }
  // } else {
  //   // also check manifest for any item with properties="cover-image"
  //   const coverItem = manifest.find(it => {
  //     const props = (it['@_properties'] || it.properties || it['properties'] || '').toString();
  //     return props && props.toLowerCase().includes('cover-image');
  //   });
  //   if (coverItem) {
  //     await addResultBase({ id: 'M_COVER', title: 'Cover present via manifest properties', status: 'pass', details: coverItem['@_href'] || coverItem.href || coverItem['href'] || JSON.stringify(coverItem) });
  //   } else {
  //     await addResultBase({
  //       id: 'M_COVER', title: 'No cover metadata found', status: 'warn', details: 'No <meta name="cover" ...> or manifest item with properties="cover-image"',
  //       //  suggestion:'Add cover metadata and manifest item with properties="cover-image"'
  //     });
  //   }
  // }

  // 14. rendition properties checks (EPUB3 fixed/reflowable)
  // check rawMetaProperties for rendition:layout/orientation/spread
  const renditionLayout = rawMetaProperties.find(m => String(m.property).toLowerCase() === 'rendition:layout');
  if (renditionLayout) {
    const v = String(renditionLayout.value || '').toLowerCase();
    if (v === 'reflowable' || v === 'pre-paginated') {
      await addResultBase({ id: 'M_RENDITION_LAYOUT', title: 'Rendition layout valid', status: 'pass', details: v });
    } else {
      await addResultBase({
        id: 'M_RENDITION_LAYOUT', title: 'Rendition layout suspicious', status: 'warn', details: v,
        // suggestion:'Use "reflowable" or "pre-paginated"'
      });
    }
  }

  // rendition:orientation/spread optional checks
  const rendOrient = rawMetaProperties.find(m => String(m.property).toLowerCase() === 'rendition:orientation');
  if (rendOrient)
    await addResultBase({ id: 'M_RENDITION_ORIENTATION', title: 'Rendition orientation', status: 'pass', details: String(rendOrient.value) });

  const rendSpread = rawMetaProperties.find(m => String(m.property).toLowerCase() === 'rendition:spread');
  if (rendSpread)
    await addResultBase({ id: 'M_RENDITION_SPREAD', title: 'Rendition spread', status: 'pass', details: String(rendSpread.value) });

  // 15. namespace validation for metadata block (basic)
  // check top-level package XML for xmlns:dc and xmlns:opf
  const packageXmlAttrs = pkg?.['@_xmlns:dc'] || pkg?.['@_xmlns'] || pkg?.['@_xmlns:opf'] || pkg?.['@xmlns:dc'];
  // Because xml parser shapes vary, check opfText for common namespace strings
  if (opfText) {
    const nsOk = opfText.includes('http://purl.org/dc/elements/1.1/') && (opfText.includes('http://www.idpf.org/2007/opf') || opfText.includes('http://www.w3.org/1999/xhtml'));
    if (!nsOk) {
      await addResultBase({
        id: 'M_NAMESPACE', title: 'Metadata namespace suspicious', status: 'warn', details: 'Missing or unusual DC/OPF namespaces in OPF',
        //  suggestion:'Include xmlns:dc="http://purl.org/dc/elements/1.1/" and OPF namespace' 
      });
    } else {
      await addResultBase({ id: 'M_NAMESPACE', title: 'Metadata namespaces look ok', status: 'pass', details: 'DC and OPF namespaces detected' });
    }
  }

  // 16. duplication checks (identifiers, languages, titles etc)
  // If there are duplicates, warn
  const dupWarns = [];
  if (rawIdentifier.length > 1) {
    const normalizedIds = rawIdentifier.map(firstText).map(s => (s || '').toString());
    const dupIds = normalizedIds.filter((v, i, a) => a.indexOf(v) !== i);
    if (dupIds.length) dupWarns.push({ field: 'identifier', duplicates: uniq(dupIds) });
  }
  if (rawLanguage.length > 1) {
    const vals = rawLanguage.map(firstText);
    const dupLang = vals.filter((v, i, a) => a.indexOf(v) !== i);
    if (dupLang.length) dupWarns.push({ field: 'language', duplicates: uniq(dupLang) });
  }
  if (rawTitle.length > 1) {
    const vals = rawTitle.map(firstText);
    const dupTitle = vals.filter((v, i, a) => a.indexOf(v) !== i);
    if (dupTitle.length) dupWarns.push({ field: 'title', duplicates: uniq(dupTitle) });
  }

  if (dupWarns.length) {
    await addResultBase({ id: 'M_DUPLICATES', title: 'Duplicate metadata entries detected', status: 'warn', details: dupWarns });
  }

  // 17. deprecated EPUB2 checks and guidance
  // look for guide element, or meta items typical for EPUB2
  const opfLower = (opfText || '').toLowerCase();
  const hasGuide = opfLower.includes('<guide>');
  if (hasGuide) {
    await addResultBase({
      id: 'M_EPUB2_GUIDE', title: 'EPUB2 <guide> element found', status: 'warn', details: 'OPF contains <guide> which is deprecated in EPUB3',
      //  suggestion:'Remove guide or migrate to EPUB3 nav'
    });
  }

  // 18. kindle/store suggestions: check for missing cover-image property or common storefront metadata
  // (This is advisory)
  // const kindleHints = [];
  // if (!coverMeta && !manifest.find(it => (it['@_properties'] || it.properties || '').toString().toLowerCase().includes('cover-image'))) {
  //   kindleHints.push('No cover-image property; Kindle may require a clear cover item.');
  // }
  // if (!firstText(rawDescription[0])) kindleHints.push('No description; stores require description for listing.');
  // if (kindleHints.length)
  //   await addResultBase({ id: 'M_STORE_HINTS', title: 'Store compatibility hints', status: 'warn', details: kindleHints.join(' || ') });

  // 19. meta property validation: belongs-to-collection / display-seq
  const belongs = rawMetaProperties.find(m => String(m.property).toLowerCase() === 'belongs-to-collection');
  if (belongs)
    await addResultBase({ id: 'M_COLLECTION', title: 'Belongs-to-collection present', status: 'pass', details: belongs.value });
  const displaySeq = rawMetaProperties.find(m => String(m.property).toLowerCase() === 'display-seq');
  if (displaySeq) {
    const num = Number(displaySeq.value);
    if (!Number.isFinite(num) || num < 0)
      await addResultBase({
        id: 'M_DISPLAY_SEQ', title: 'display-seq invalid', status: 'warn', details: displaySeq.value,
        // suggestion:'Use a positive integer'
      });
    else
      await addResultBase({ id: 'M_DISPLAY_SEQ', title: 'display-seq valid', status: 'pass', details: displaySeq.value });
  }

  // 20. final pass summary (counts)
  // We don't push a summary entry here so your existing aggregator (which computes pass/fail/warn) will show totals.

  // Return results in same shape expected by report.js
  return results;
}

module.exports = { runMetadataChecks };
