const fs = require("fs");
const path = require("path");

function extractFilename(href) {
  return path.basename(href || "").split("#")[0].toLowerCase();
}

function capitalize(str) {
  return String(str || "").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function generateNavLabel(filename) {
  let label = String(filename || "").replace(/\.(x?html?)$/i, "");
  label = label.replace(/^\d+_/, "");
  label = label.replace(/_/g, " ");
  return capitalize(label);
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function stripTags(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getAttribute(rawAttributes, name) {
  const match = String(rawAttributes || "").match(
    new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i")
  );
  return match ? match[1] : "";
}

function derivePageValue(text, href, index) {
  const cleanedText = stripTags(text);
  if (cleanedText) {
    return cleanedText;
  }

  const fragment = String(href || "").split("#")[1] || "";
  const fragmentValue = fragment.replace(/^page_/i, "").replace(/_/g, " ").trim();
  if (fragmentValue) {
    return fragmentValue;
  }

  return String(index + 1);
}

function extractPageListEntriesFromNav(navPath, ncxPath) {
  if (!navPath || !fs.existsSync(navPath)) {
    return [];
  }

  const navHtml = fs.readFileSync(navPath, "utf8");
  const navDir = path.dirname(navPath);
  const ncxDir = path.dirname(ncxPath);
  const entries = [];
  const pageRegex = /<a[^>]+href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = pageRegex.exec(navHtml)) !== null) {
    const rawHref = String(match[1] || "").trim();
    const rawLabel = match[2] || "";
    const label = stripTags(rawLabel);

    if (
      !rawHref ||
      (!rawHref.includes("page_") && !/^\d+$|^[ivxlcdm]+$/i.test(label))
    ) {
      continue;
    }

    const hashIndex = rawHref.indexOf("#");
    const filePart = hashIndex === -1 ? rawHref : rawHref.slice(0, hashIndex);
    const fragment = hashIndex === -1 ? "" : rawHref.slice(hashIndex + 1);

    let relativeHref;
    if (filePart) {
      const absoluteTarget = path.resolve(navDir, filePart);
      relativeHref = path.relative(ncxDir, absoluteTarget).replace(/\\/g, "/");
    } else {
      relativeHref = path.relative(ncxDir, navPath).replace(/\\/g, "/");
    }

    const normalizedSrc = fragment ? `${relativeHref}#${fragment}` : relativeHref;
    entries.push({
      src: normalizedSrc,
      value: derivePageValue(label, rawHref, entries.length),
    });
  }

  return entries;
}

function getAllExistingIds(ncxContent) {
  const allIds = new Set();
  const navPointRegex = /<navPoint\s+id="([^"]+)"/g;
  const pageTargetRegex = /<pageTarget\s+[^>]*id="([^"]+)"/g;
  let match;

  while ((match = navPointRegex.exec(ncxContent)) !== null) {
    allIds.add(match[1]);
  }

  while ((match = pageTargetRegex.exec(ncxContent)) !== null) {
    allIds.add(match[1]);
  }

  return allIds;
}

function getMaxIdNumber(existingIds) {
  return Math.max(
    ...Array.from(existingIds).map((id) => {
      const number = String(id || "").match(/\d+/);
      return number ? parseInt(number[0], 10) : 0;
    }),
    0
  );
}

function generateUniqueId(existingIds, baseNumber) {
  let counter = baseNumber;
  let newId = `a${counter}`;

  while (existingIds.has(newId)) {
    counter += 1;
    newId = `a${counter}`;
  }

  existingIds.add(newId);
  return newId;
}

function fixNcxDuplicateIds(ncxPath) {
  console.log("[NCX] Fixing duplicate IDs in NCX at:", ncxPath);

  let ncxContent = fs.readFileSync(ncxPath, "utf8");
  const originalContent = ncxContent;
  const allIds = new Map();

  const navPointRegex = /<navPoint\s+id="([^"]+)"/g;
  const pageTargetRegex = /<pageTarget\s+[^>]*id="([^"]+)"/g;
  let match;

  while ((match = navPointRegex.exec(ncxContent)) !== null) {
    const id = match[1];
    if (!allIds.has(id)) {
      allIds.set(id, { type: "navPoint", count: 0 });
    }
    allIds.get(id).count += 1;
  }

  while ((match = pageTargetRegex.exec(ncxContent)) !== null) {
    const id = match[1];
    if (!allIds.has(id)) {
      allIds.set(id, { type: "pageTarget", count: 0 });
    } else {
      allIds.get(id).type = "both";
    }
    allIds.get(id).count += 1;
  }

  const duplicateIds = Array.from(allIds.entries())
    .filter(([, info]) => info.count > 1 || info.type === "both")
    .map(([id]) => id);

  if (!duplicateIds.length) {
    console.log("   No duplicate IDs found");
    return;
  }

  console.log(`   Found ${duplicateIds.length} duplicate ID(s): ${duplicateIds.join(", ")}`);

  let nextIdNumber = getMaxIdNumber(new Set(allIds.keys())) + 1;
  const existingIdsSet = new Set(allIds.keys());

  duplicateIds.forEach((duplicateId) => {
    const info = allIds.get(duplicateId);

    if (info.type === "navPoint" && info.count > 1) {
      const navPointPattern = new RegExp(
        `<navPoint\\s+id="${duplicateId}"[^>]*>[\\s\\S]*?<\\/navPoint>`,
        "g"
      );
      let occurrence = 0;

      ncxContent = ncxContent.replace(navPointPattern, (fullMatch) => {
        occurrence += 1;
        if (occurrence === 1) {
          return fullMatch;
        }

        const newId = generateUniqueId(existingIdsSet, nextIdNumber++);
        console.log(`   Renamed navPoint ID: ${duplicateId} -> ${newId}`);
        return fullMatch.replace(/id="[^"]+"/, `id="${newId}"`);
      });
    }

    if (info.type === "pageTarget" && info.count > 1) {
      const pageTargetPattern = new RegExp(
        `<pageTarget\\s+[^>]*id="${duplicateId}"[^>]*>[\\s\\S]*?<\\/pageTarget>`,
        "g"
      );
      let occurrence = 0;

      ncxContent = ncxContent.replace(pageTargetPattern, (fullMatch) => {
        occurrence += 1;
        if (occurrence === 1) {
          return fullMatch;
        }

        const newId = generateUniqueId(existingIdsSet, nextIdNumber++);
        console.log(`   Renamed pageTarget ID: ${duplicateId} -> ${newId}`);
        return fullMatch.replace(/id="[^"]+"/, `id="${newId}"`);
      });
    }

    if (info.type === "both") {
      const pageTargetPattern = new RegExp(
        `<pageTarget\\s+[^>]*id="${duplicateId}"[^>]*>[\\s\\S]*?<\\/pageTarget>`,
        "g"
      );

      ncxContent = ncxContent.replace(pageTargetPattern, (fullMatch) => {
        const newId = generateUniqueId(existingIdsSet, nextIdNumber++);
        console.log(
          `   Renamed pageTarget ID (conflict with navPoint): ${duplicateId} -> ${newId}`
        );
        return fullMatch.replace(/id="[^"]+"/, `id="${newId}"`);
      });
    }
  });

  if (ncxContent !== originalContent) {
    fs.writeFileSync(ncxPath, ncxContent, "utf8");
    console.log("   NCX file saved with duplicate ID fixes");
  } else {
    console.log("   NCX already correct, no changes needed");
  }
}

function fixNcx(ncxPath, spineHrefs, navPath = null) {
  console.log("[NCX] Fixing NCX at:", ncxPath);

  fixNcxDuplicateIds(ncxPath);

  let ncxContent = fs.readFileSync(ncxPath, "utf8");
  const originalContent = ncxContent;
  const existingIdsSet = getAllExistingIds(ncxContent);
  let nextIdNumber = getMaxIdNumber(existingIdsSet) + 1;

  console.log(`   Total existing IDs in NCX: ${existingIdsSet.size}`);

  const spineFilenames = spineHrefs.map((href) => extractFilename(href));
  const navMapMatch = ncxContent.match(/<navMap>([\s\S]*?)<\/navMap>/);
  if (!navMapMatch) {
    console.log("   No navMap found");
    return;
  }

  const navMapContent = navMapMatch[1];
  const navPointRegex =
    /<navPoint id="([^"]*)" playOrder="(\d+)">[\s\S]*?<navLabel><text>([^<]*)<\/text><\/navLabel>[\s\S]*?<content src="([^"]*)"[^>]*\/><\/navPoint>/g;
  const existingNavPoints = [];
  const navPointsByFile = new Map();
  let match;

  while ((match = navPointRegex.exec(navMapContent)) !== null) {
    const [fullMatch, id, playOrder, label, src] = match;
    const filename = extractFilename(src);
    const navPoint = {
      id,
      playOrder: parseInt(playOrder, 10),
      label,
      src,
      filename,
      fullMatch,
    };

    existingNavPoints.push(navPoint);
    navPointsByFile.set(filename, navPoint);
  }

  console.log(`   Found ${existingNavPoints.length} existing navPoints`);

  const missingFiles = spineFilenames.filter((filename) => !navPointsByFile.has(filename));
  if (missingFiles.length) {
    console.log(`   Missing ${missingFiles.length} navPoints: ${missingFiles.join(", ")}`);

    missingFiles.forEach((filename) => {
      const newId = generateUniqueId(existingIdsSet, nextIdNumber++);
      const href = spineHrefs.find((entry) => extractFilename(entry) === filename);
      const label = generateNavLabel(filename);
      const navPoint = {
        id: newId,
        playOrder: 999,
        label,
        src: href,
        filename,
        fullMatch: `<navPoint id="${newId}" playOrder="999"><navLabel><text>${escapeXml(
          label
        )}</text></navLabel><content src="${escapeXml(href)}" /></navPoint>`,
      };

      existingNavPoints.push(navPoint);
      navPointsByFile.set(filename, navPoint);
      console.log(`   Created new navPoint: ${newId} for ${filename}`);
    });
  }

  const spineOrderMap = {};
  spineFilenames.forEach((filename, index) => {
    spineOrderMap[filename] = index;
  });

  existingNavPoints.sort((left, right) => {
    const leftOrder = spineOrderMap[left.filename] ?? 9999;
    const rightOrder = spineOrderMap[right.filename] ?? 9999;
    return leftOrder - rightOrder;
  });

  let navMapReplacement = "";
  existingNavPoints.forEach((navPoint, index) => {
    const correctOrder = index + 1;
    let navPointXml = navPoint.fullMatch;

    if (navPoint.playOrder !== correctOrder) {
      navPointXml = navPointXml.replace(/playOrder="\d+"/, `playOrder="${correctOrder}"`);
      console.log(
        `   Fixed navPoint #${navPoint.id}: playOrder ${navPoint.playOrder} -> ${correctOrder}`
      );
    }

    navMapReplacement += `\n${navPointXml}`;
  });

  ncxContent = ncxContent.replace(
    /<navMap>[\s\S]*?<\/navMap>/,
    `<navMap>${navMapReplacement}\n</navMap>`
  );

  const pageListMatch = ncxContent.match(/<pageList>([\s\S]*?)<\/pageList>/);
  const navPageEntries = extractPageListEntriesFromNav(navPath, ncxPath);

  if (navPageEntries.length) {
    const startOrder = existingNavPoints.length + 1;
    const existingPageTargets = [];
    if (pageListMatch) {
      const pageTargetBlockRegex = /<pageTarget\b([^>]*)>[\s\S]*?<\/pageTarget>/g;
      let pageTargetMatch;
      while ((pageTargetMatch = pageTargetBlockRegex.exec(pageListMatch[1])) !== null) {
        const attributes = pageTargetMatch[1];
        existingPageTargets.push({
          id: getAttribute(attributes, "id"),
          type: getAttribute(attributes, "type") || "normal",
          value: getAttribute(attributes, "value"),
        });
      }
    }

    let pageListReplacement = "";
    navPageEntries.forEach((entry, index) => {
      const existingPageTarget = existingPageTargets[index] || {};
      const id =
        existingPageTarget.id || generateUniqueId(existingIdsSet, nextIdNumber++);
      const type = existingPageTarget.type || "normal";
      const value = entry.value || existingPageTarget.value || String(index + 1);
      const playOrder = startOrder + index;

      pageListReplacement +=
        `\n<pageTarget id="${escapeXml(id)}" type="${escapeXml(type)}" ` +
        `value="${escapeXml(value)}" playOrder="${playOrder}">` +
        `<navLabel><text>${escapeXml(value)}</text></navLabel>` +
        `<content src="${escapeXml(entry.src)}" />` +
        `</pageTarget>`;
    });

    const newPageList = `<pageList>${pageListReplacement}\n</pageList>`;
    if (pageListMatch) {
      ncxContent = ncxContent.replace(/<pageList>[\s\S]*?<\/pageList>/, newPageList);
    } else {
      ncxContent = ncxContent.replace(/<\/navMap>/, `</navMap>\n${newPageList}`);
    }

    console.log(`   Synced ${navPageEntries.length} pageTarget entries from nav.xhtml`);
  } else if (pageListMatch) {
    const pageListContent = pageListMatch[1];
    const startOrder = existingNavPoints.length + 1;
    const pageTargetRegex =
      /<pageTarget[^>]*id="([^"]*)"[^>]*playOrder="(\d+)"[^>]*value="([^"]*)"[^>]*>/g;
    const pageTargets = [];
    let pageMatch;

    while ((pageMatch = pageTargetRegex.exec(pageListContent)) !== null) {
      const [, id, playOrder, value] = pageMatch;
      const cleanValue = value.replace(/\s+/g, " ").trim();
      pageTargets.push({
        id,
        currentPlayOrder: parseInt(playOrder, 10),
        value: cleanValue,
        romanValue: parseRomanNumeral(cleanValue),
        numericValue: parseInt(cleanValue, 10),
      });
    }

    pageTargets.sort((left, right) => {
      if (left.romanValue !== null && right.romanValue !== null) {
        return left.romanValue - right.romanValue;
      }
      if (!Number.isNaN(left.numericValue) && !Number.isNaN(right.numericValue)) {
        return left.numericValue - right.numericValue;
      }
      return 0;
    });

    pageTargets.forEach((pageTarget, index) => {
      const correctOrder = startOrder + index;
      if (pageTarget.currentPlayOrder !== correctOrder) {
        ncxContent = ncxContent.replace(
          new RegExp(
            `(<pageTarget[^>]*id="${pageTarget.id}"[^>]*?)playOrder="${pageTarget.currentPlayOrder}"`
          ),
          `$1playOrder="${correctOrder}"`
        );

        console.log(
          `   Fixed pageTarget #${pageTarget.id} (${pageTarget.value}): playOrder ${pageTarget.currentPlayOrder} -> ${correctOrder}`
        );
      }

      const valueRegex = new RegExp(
        `(<pageTarget[^>]*id="${pageTarget.id}"[^>]*value=")([^"]*)(")`,
        "g"
      );

      ncxContent = ncxContent.replace(valueRegex, (fullMatch, before, value, after) => {
        const cleanedValue = value.replace(/\s+/g, " ").trim();
        if (cleanedValue !== value) {
          console.log(
            `   Cleaned value for #${pageTarget.id}: "${value}" -> "${cleanedValue}"`
          );
        }
        return `${before}${cleanedValue}${after}`;
      });
    });
  }

  if (ncxContent !== originalContent) {
    fs.writeFileSync(ncxPath, ncxContent, "utf8");
    console.log("   NCX file saved with fixes");
  } else {
    console.log("   NCX already correct, no changes needed");
  }
}

function parseRomanNumeral(str) {
  const romanMap = {
    i: 1,
    v: 5,
    x: 10,
    l: 50,
    c: 100,
    d: 500,
    m: 1000,
  };

  const value = String(str || "").toLowerCase();
  if (!/^[ivxlcdm]+$/.test(value)) {
    return null;
  }

  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    const current = romanMap[value[index]];
    const next = romanMap[value[index + 1]];
    if (next && current < next) {
      result -= current;
    } else {
      result += current;
    }
  }

  return result;
}

module.exports = { fixNcx, fixNcxDuplicateIds };
