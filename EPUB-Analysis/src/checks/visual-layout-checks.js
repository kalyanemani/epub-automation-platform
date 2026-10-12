const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const puppeteer = require("puppeteer");
const pixelmatch = require("pixelmatch");
const PNG = require("pngjs").PNG;

const AgentLogger = require("../utils/agent-logger");
const { listAllFiles } = require("../utils/unzip");
const { runInBatches, envInt } = require("../utils/batch-runner");

// Single viewport — mobile covers the most critical responsive breakpoint
const VIEWPORTS = [
  { name: "mobile", width: 430, height: 932 },
];

function createBucketStore() {
  return new Map();
}

function recordBucket(store, id, title, status, sample, suggestion = "") {
  if (!store.has(id)) {
    store.set(id, {
      id,
      title,
      status,
      suggestion,
      totalCount: 0,
      samples: [],
      keys: new Set(),
    });
  }

  const bucket = store.get(id);
  bucket.totalCount += Math.max(1, Number(sample?.occurrenceCount) || 1);
  if (status === "fail" || (status === "warn" && bucket.status !== "fail")) {
    bucket.status = status;
  }
  if (suggestion && !bucket.suggestion) {
    bucket.suggestion = suggestion;
  }

  const key = JSON.stringify(sample || {});
  if (!bucket.keys.has(key) && bucket.samples.length < 16) {
    bucket.keys.add(key);
    bucket.samples.push(sample);
  }
}

function toResults(store) {
  return Array.from(store.values()).map((bucket) => ({
    id: bucket.id,
    title: bucket.title,
    status: bucket.status,
    location: deriveLocation(bucket.samples[0]),
    details: {
      count: bucket.totalCount || bucket.samples.length,
      samples: bucket.samples,
    },
    suggestion: bucket.suggestion,
  }));
}

function deriveLocation(sample) {
  if (!sample || !sample.file) {
    return undefined;
  }

  return {
    file: sample.file,
  };
}

async function captureScreenshot(page, outputPath) {
  await page.screenshot({ path: outputPath, fullPage: true });
}

async function inspectRenderedPage(page) {
  return page.evaluate(() => {
    function visible(element) {
      const style = window.getComputedStyle(element);
      if (!style) {
        return false;
      }

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || "1") !== 0
      );
    }

    function overlapX(a, b) {
      return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    }

    const viewportWidth = window.innerWidth;
    const html = document.documentElement;
    const body = document.body || document.documentElement;
    const horizontalScroll = html.scrollWidth > viewportWidth + 2;

    const clippingSamples = [];
    Array.from(
      document.querySelectorAll(
        "h1,h2,h3,h4,h5,h6,p,li,td,th,blockquote,pre,code"
      )
    )
      .slice(0, 220)
      .forEach((element) => {
        if (!visible(element)) {
          return;
        }

        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const isHorizontallyClipped =
          element.scrollWidth > element.clientWidth + 2 &&
          ["hidden", "clip"].includes(String(style.overflowX || "").toLowerCase());
        const isVerticallyClipped =
          element.scrollHeight > element.clientHeight + 2 &&
          ["hidden", "clip"].includes(String(style.overflowY || "").toLowerCase());
        const extendsPastViewport = rect.right > viewportWidth + 2;

        if (isHorizontallyClipped || isVerticallyClipped || extendsPastViewport) {
          clippingSamples.push({
            tag: element.tagName.toLowerCase(),
            text: String(element.textContent || "").trim().slice(0, 120),
            rect: {
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              top: Math.round(rect.top),
              bottom: Math.round(rect.bottom),
            },
            reason: extendsPastViewport
              ? "extends_past_viewport"
              : isHorizontallyClipped
                ? "horizontal_clip"
                : "vertical_clip",
          });
        }
      });

    const blockRects = Array.from(document.querySelectorAll("p, img, table, blockquote, pre, h1, h2, h3"))
      .slice(0, 140)
      .map((element) => {
        if (!visible(element)) {
          return null;
        }

        const rect = element.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) {
          return null;
        }

        return {
          tag: element.tagName.toLowerCase(),
          rect: {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
          },
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.rect.top - right.rect.top);

    const overlapSamples = [];
    for (let index = 1; index < blockRects.length; index += 1) {
      const previous = blockRects[index - 1];
      const current = blockRects[index];
      if (current.rect.top >= previous.rect.bottom - 4) {
        continue;
      }

      if (overlapX(previous.rect, current.rect) <= 12) {
        continue;
      }

      overlapSamples.push({
        previous: previous.tag,
        current: current.tag,
        top: Math.round(current.rect.top),
      });
      if (overlapSamples.length >= 8) {
        break;
      }
    }

    const tableSamples = [];
    Array.from(document.querySelectorAll("table")).forEach((table, index) => {
      if (!visible(table)) {
        return;
      }

      const rect = table.getBoundingClientRect();
      const tableStyle = window.getComputedStyle(table);
      const fontSize = parseFloat(tableStyle.fontSize || "0") || 0;
      if (
        table.scrollWidth > viewportWidth + 2 ||
        rect.right > viewportWidth + 2 ||
        fontSize < 10
      ) {
        tableSamples.push({
          tableIndex: index + 1,
          width: Math.round(rect.width),
          scrollWidth: table.scrollWidth,
          fontSize,
        });
      }
    });

    const imageSamples = [];
    Array.from(document.images).forEach((image, index) => {
      if (!visible(image)) {
        return;
      }

      const rect = image.getBoundingClientRect();
      const naturalWidth = image.naturalWidth || 0;
      const naturalHeight = image.naturalHeight || 0;
      const aspectDelta =
        naturalWidth > 0 && naturalHeight > 0 && rect.width > 0 && rect.height > 0
          ? Math.abs(naturalWidth / naturalHeight - rect.width / rect.height)
          : 0;
      const lowResolution = naturalWidth > 0 && rect.width > naturalWidth * 1.2;
      const overflow = rect.right > viewportWidth + 2;

      if (aspectDelta > 0.08 || lowResolution || overflow) {
        imageSamples.push({
          imageIndex: index + 1,
          src: image.getAttribute("src") || "",
          aspectDelta: Number(aspectDelta.toFixed(3)),
          lowResolution,
          overflow,
        });
      }
    });

    return {
      viewportWidth,
      bodyWidth: Math.round(body.getBoundingClientRect().width),
      scrollWidth: html.scrollWidth,
      horizontalScroll,
      clippingSamples: clippingSamples.slice(0, 8),
      overlapSamples,
      tableSamples: tableSamples.slice(0, 8),
      imageSamples: imageSamples.slice(0, 8),
    };
  });
}

async function runVisualLayoutChecks(context) {
  const { tempDir } = context;
  const bucketStore = createBucketStore();
  const snapshotDir = path.join(context.outputDir || tempDir, "snapshots");
  fs.mkdirSync(snapshotDir, { recursive: true });

  const allHtmlFiles = listAllFiles(tempDir).filter((filePath) => {
    const lower = filePath.toLowerCase();
    return lower.endsWith(".html") || lower.endsWith(".xhtml");
  });
  // Tight cap — 3 files × 1 viewport × 2.5s max = ~7.5s worst case
  const MAX_FILES = envInt("MAX_VISUAL_FILES", 3);
  const htmlFiles = allHtmlFiles.slice(0, MAX_FILES);

  AgentLogger.log("LAYOUT_VISUAL_CHECK", "LayoutEngine", {
    phase: "start",
    htmlFileCount: htmlFiles.length,
    totalHtmlFiles: allHtmlFiles.length,
    capped: allHtmlFiles.length > MAX_FILES,
  });

  let browser = null;
  const capturedSnapshots = [];

  try {
    try {
      browser = await Promise.race([
        puppeteer.launch({ headless: true }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Browser launch timed out after 8s")), 8000)
        ),
      ]);
    } catch (error) {
      recordBucket(
        bucketStore,
        "L_VISUAL_RENDER_UNAVAILABLE",
        "Visual browser validation is unavailable in this runtime",
        "warn",
        {
          error: error.message,
          renderer: "chromium",
        },
        "Run the visual pass in an environment where Chromium can be spawned, or keep deterministic layout checks as the fallback gate."
      );

      const results = toResults(bucketStore);
      AgentLogger.log("LAYOUT_VISUAL_CHECK", "LayoutEngine", {
        phase: "complete",
        issueCount: results.length,
        snapshotCount: 0,
        browserAvailable: false,
      });
      return results;
    }

    const PARALLEL_PAGES = envInt("VISUAL_BATCH_SIZE", 4);
    const processPage = async (htmlFile) => {
      const page = await browser.newPage();
      const htmlRelPath = path.relative(tempDir, htmlFile).replace(/\\/g, "/");
      const fileUrl = pathToFileURL(htmlFile).toString();

      const PAGE_TIMEOUT_MS = 2500;
      const pageTimer = setTimeout(() => {
        page.close().catch(() => {});
      }, PAGE_TIMEOUT_MS);

      try {
        for (const viewport of VIEWPORTS) {
          await page.setViewport({
            width: viewport.width,
            height: viewport.height,
            deviceScaleFactor: 1,
          });
          await page.goto(fileUrl, { waitUntil: "load" });

          const screenshotPath = path.join(
            snapshotDir,
            `${path.basename(htmlFile, path.extname(htmlFile))}_${viewport.name}.png`
          );
          await captureScreenshot(page, screenshotPath);
          capturedSnapshots.push({
            file: htmlRelPath,
            viewport: viewport.name,
            screenshotPath,
          });

          const metrics = await inspectRenderedPage(page);
          const baseSample = {
            file: htmlRelPath,
            viewport: viewport.name,
            screenshotPath,
          };

          if (metrics.horizontalScroll) {
            recordBucket(
              bucketStore,
              "L_RESPONSIVE_HORIZONTAL_SCROLL",
              "Horizontal scrolling or width overflow detected",
              "fail",
              {
                ...baseSample,
                scrollWidth: metrics.scrollWidth,
                viewportWidth: metrics.viewportWidth,
              },
              "Replace fixed widths with reflow-safe sizing and constrain wide content for small screens."
            );
          }

          metrics.clippingSamples.forEach((sample) => {
            recordBucket(
              bucketStore,
              "L_RESPONSIVE_TEXT_CLIPPING",
              "Text clipping or viewport overflow detected",
              "fail",
              {
                ...baseSample,
                ...sample,
              },
              "Remove clipping constraints and make text containers reflow within the reader viewport."
            );
          });

          metrics.overlapSamples.forEach((sample) => {
            recordBucket(
              bucketStore,
              "L_LAYOUT_OVERLAP",
              "Overlapping rendered elements detected",
              "fail",
              {
                ...baseSample,
                ...sample,
              },
              "Review positioning, margins, and image/table sizing to prevent layout overlap."
            );
          });

          metrics.tableSamples.forEach((sample) => {
            recordBucket(
              bucketStore,
              "L_TABLE_RESPONSIVE",
              "Table rendering breaks at one or more viewports",
              "warn",
              {
                ...baseSample,
                ...sample,
              },
              "Wrap wide tables safely, reduce fixed widths, and keep cell content readable on narrow screens."
            );
          });

          metrics.imageSamples.forEach((sample) => {
            recordBucket(
              bucketStore,
              "L_IMAGE_RENDERING",
              "Image rendering issues detected",
              "warn",
              {
                ...baseSample,
                ...sample,
              },
              "Preserve image aspect ratio, avoid upscaling low-resolution assets, and constrain images to the viewport width."
            );
          });
        }
      } catch (error) {
        recordBucket(
          bucketStore,
          "L_VISUAL_RENDER_FAILURE",
          "Visual rendering validation failed for one or more chapters",
          "fail",
          {
            file: htmlRelPath,
            error: error.message,
          },
          "Ensure the XHTML and its local assets can be rendered by the validation browser."
        );
      } finally {
        clearTimeout(pageTimer);
        await page.close();
      }
    };
    await runInBatches(htmlFiles, PARALLEL_PAGES, processPage);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  recordBucket(
    bucketStore,
    "L_VISUAL_READER_COVERAGE",
    "Visual validation currently uses a Chromium renderer profile",
    "warn",
    {
      renderer: "chromium",
      viewportProfiles: VIEWPORTS.map((viewport) => viewport.name),
    },
    "Add additional EPUB-reader automation if strict multi-reader parity is required."
  );

  if (capturedSnapshots.length) {
    const preview = capturedSnapshots[0];
    bucketStore.set("L_VISUAL_SNAPSHOTS", {
      id: "L_VISUAL_SNAPSHOTS",
      title: "Responsive screenshots captured successfully",
      status: "pass",
      suggestion: "",
      samples: capturedSnapshots.slice(0, 12).map((entry) => ({
        file: entry.file,
        viewport: entry.viewport,
        screenshotPath: entry.screenshotPath,
      })),
      keys: new Set(),
      screenshot_path: preview.screenshotPath,
    });
  }

  const results = toResults(bucketStore).map((result) => {
    if (result.id === "L_VISUAL_SNAPSHOTS") {
      return {
        ...result,
        screenshot_path: capturedSnapshots[0]?.screenshotPath || "",
      };
    }
    return result;
  });

  AgentLogger.log("LAYOUT_VISUAL_CHECK", "LayoutEngine", {
    phase: "complete",
    issueCount: results.length,
    snapshotCount: capturedSnapshots.length,
  });

  return results;
}

function compareSnapshots(img1Path, img2Path, diffOutputPath) {
  const img1 = PNG.sync.read(fs.readFileSync(img1Path));
  const img2 = PNG.sync.read(fs.readFileSync(img2Path));
  const { width, height } = img1;
  const diff = new PNG({ width, height });

  const numDiffPixels = pixelmatch(img1.data, img2.data, diff.data, width, height, {
    threshold: 0.1,
  });
  fs.writeFileSync(diffOutputPath, PNG.sync.write(diff));

  return numDiffPixels;
}

module.exports = {
  captureScreenshot,
  compareSnapshots,
  runVisualLayoutChecks,
};
