const fs = require("fs");
const path = require("path");
const glob = require("glob");
const ffprobe = require("ffprobe");
const ffprobeStatic = require("ffprobe-static");
const { runInBatches, envInt } = require("../utils/batch-runner");

/* ---------------------------------------------
   HTML <audio> / <video> attribute parsing
--------------------------------------------- */

function extractTags(html, tag) {
  const regex = new RegExp(`<${tag}([^>]*)>`, "gi");
  let match, list = [];
  while ((match = regex.exec(html))) list.push(match[1]);
  return list;
}

function parseAttr(attrs, key) {
  const r = new RegExp(`${key}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(attrs);
  return r ? r[2] : null;
}

function hasAttr(attrs, key) {
  return new RegExp(`${key}`, "i").test(attrs);
}

/* ---------------------------------------------
   ffprobe wrapper
--------------------------------------------- */
async function probe(filePath) {
  try {
    return await ffprobe(filePath, { path: ffprobeStatic.path });
  } catch (err) {
    return null;
  }
}

/* ---------------------------------------------
   Compatibility database
--------------------------------------------- */

const AUDIO_COMPAT = {
  mp3:  { epub:true, kindle:true, android:true },
  aac:  { epub:true, kindle:true, android:true },
  m4a:  { epub:true, kindle:true, android:true },
  wav:  { epub:true, kindle:false, android:true },
  ogg:  { epub:"partial", kindle:false, android:true },
  flac: { epub:false, kindle:false, android:true }
};

const VIDEO_COMPAT = {
  mp4:  { epub:true, kindle:true, android:true },
  webm: { epub:"partial", kindle:false, android:true },
  mov:  { epub:true, kindle:false, android:"partial" },
  mkv:  { epub:false, kindle:false, android:"partial" }
};

const VIDEO_CODECS = {
  h264: { epub:true, kindle:true, android:true },
  hevc: { epub:true, kindle:false, android:"partial" },
  vp8:  { epub:"partial", kindle:false, android:true },
  vp9:  { epub:"partial", kindle:false, android:true },
  av1:  { epub:"partial", kindle:false, android:"partial" }
};

/* ---------------------------------------------
   Compatibility evaluator
--------------------------------------------- */
function evaluateCompatibility(ext, codec, isVideo=true) {
  let score = 100;
  const issues = [];

  const base = isVideo ? VIDEO_COMPAT[ext] : AUDIO_COMPAT[ext];
  const codecBase = isVideo ? VIDEO_CODECS[codec] : null;

  function warn(msg, loss=20) {
    issues.push(msg);
    score -= loss;
  }

  if (!base) warn("Unknown or unsupported media format");
  else {
    if (!base.epub) warn("Not supported in EPUB3 readers");
    if (!base.kindle) warn("Not supported in Kindle");
    if (!base.android) warn("Not fully supported in Android browsers", 10);
  }

  if (isVideo && codecBase) {
    if (!codecBase.epub) warn("Video codec unsupported in EPUB3");
    if (!codecBase.kindle) warn("Video codec unsupported in Kindle");
  }

  score = Math.max(0, Math.min(100, score));
  return { compatibility: score + "%", issues: issues.length ? issues : ["✔ Fully compatible"] };
}

/* ---------------------------------------------
   Silent audio detection (RMS)
--------------------------------------------- */
function isSilent(meta) {
  const stream = meta?.streams?.find(s => s.codec_type === "audio");
  if (!stream) return false;
  const br = parseInt(stream.bit_rate || 0);
  return br < 1000; // extremely low bitrate = almost silent
}

/* ---------------------------------------------
   MEDIA VALIDATION
--------------------------------------------- */
// function extractSourceTags(html, parentTag) {
//     const regex = new RegExp(`<${parentTag}[^>]*>[\\s\\S]*?<source([^>]*)>`, "gi");
//     let match, list = [];
//     while ((match = regex.exec(html))) {
//         list.push(match[1]); // attributes of <source>
//     }
//     return list;
// }
function extractVideoTags(html) {
    const regex = /<video([^>]*?)>/gi;
    let match, list = [];
    while ((match = regex.exec(html))) list.push(match[1]);
    return list;
}

function extractAudioTags(html) {
    const regex = /<audio([^>]*?)>/gi;
    let match, list = [];
    while ((match = regex.exec(html))) list.push(match[1]);
    return list;
}

function extractSourceTags(html, parentTag) {
    const regex = new RegExp(`<${parentTag}[^>]*>([\\s\\S]*?)<\\/${parentTag}>`, "gi");
    const srcRegex = /<source([^>]*)>/gi;
    let outer, list = [];

    while ((outer = regex.exec(html))) {
        const inner = outer[1];
        let m;
        while ((m = srcRegex.exec(inner))) list.push(m[1]);
    }
    return list;
}


function extractImgTags(html) {
  const regex = /<img([^>]+)>/gi;
  let match, list = [];
  while ((match = regex.exec(html))) list.push(match[1]);
  return list;
}


async function runMediaChecks({ tempDir, opfAbsolute, opfXml }) {
  const results = [];
  const htmlFiles = glob.sync("**/*.{xhtml,html}", { cwd: tempDir });
  const manifest = opfXml?.package?.manifest?.item || [];
  const manifestItems = Array.isArray(manifest) ? manifest : [manifest];

  /* ============================================================
       LOOP THROUGH EVERY XHTML PAGE
  ============================================================ */
  const MEDIA_BATCH = envInt("MEDIA_BATCH_SIZE", 6);
  await runInBatches(htmlFiles, MEDIA_BATCH, async (rel) => {
    const full = path.join(tempDir, rel);
    const raw = fs.readFileSync(full, "utf8");

    // const videos = extractTags(raw, "video");
    // const audios = extractTags(raw, "audio");
//     const videos = extractSourceTags(raw, "video");
// const audios = extractSourceTags(raw, "audio");
const videos = extractVideoTags(raw);        // <video ...>
const videoSources = extractSourceTags(raw, "video");  // <source ...>

const audios = extractAudioTags(raw);        // <audio ...>
const audioSources = extractSourceTags(raw, "audio");  // <source ...>

const images = extractImgTags(raw);

    /* ---------------- VIDEO CHECK ---------------- */
    for (const tag of videos) {
     let src = parseAttr(tag, "src");

// if (!src) {
//     const videoSources = extractSourceTags(raw, "video");
//     if (videoSources.length > 0) {
//         src = parseAttr(videoSources[0], "src");
//     }
// }
// If <video> has no src, pull from first <source>
if (!src && videoSources.length > 0) {
    src = parseAttr(videoSources[0], "src");
}

console.log(src,"srccc")
      if (!src) {
        results.push({
          id: "Media_video_missing",
          title: "<video> missing src",
          status: "fail",
          details: { chapter: rel },
          suggestion: ""
        });
        continue;
      }

      if (!hasAttr(tag, "controls")) {
        results.push({
          id: "Media_missing_control",
          title: "<video> missing controls attribute",
          status: "warn",
          details: { chapter: rel, file: src },
          suggestion: ""
        });
    }
         else {
        results.push({
          id: "Media_video_controls_ok",
          title: "<video> has controls",
          status: "pass",
          details: { chapter: rel, file: src }
        });
      }

      if (hasAttr(tag, "poster")) {
        results.push({
          id: "Media_video_poster_ok",
          title: "<video> has poster",
          status: "pass",
          details: { chapter: rel, file: src }
        });
      } else {
        results.push({
          id: "Media_missing_poster",
          title: "<video> missing poster attribute",
          status: "warn",
          details: { chapter: rel, file: src },
          suggestion: ""
        });
      }

      // const abs = fs.existsSync(path.join(path.dirname(opfAbsolute), src))
      //   ? path.join(path.dirname(opfAbsolute), src)
      //   : path.join(tempDir, src);
      const xhtmlDir = path.dirname(path.join(tempDir, rel));

// Resolve image relative to XHTML file
const abs = path.normalize(path.join(xhtmlDir, src));

      if (!fs.existsSync(abs)) {
        results.push({
          id: "Media_missing_file",
          title: "Video file missing",
          status: "fail",
          details: { chapter: rel, file: src },
          suggestion: ""
        });
        continue;
      }

      const stat = fs.statSync(abs);
      if (stat.size === 0) {
        results.push({
          id: "Media_file_empty",
          title: "Video file is empty",
          status: "fail",
          details: { chapter: rel, file: src },
          suggestion: "Re-export video"
        });
        continue;
      }

      const meta = await probe(abs);
      console.log("VIDEO META", abs, meta);
      if (!meta) {
        results.push({
          id: "Media_video_unreadable",
          title: "Video unreadable / corrupt",
          status: "fail",
          details: { chapter: rel, file: src },
          suggestion: "Re-encode video"
        });
        continue;
      }

      const v = meta.streams.find(s => s.codec_type === "video");
      const a = meta.streams.find(s => s.codec_type === "audio");

      if (!v) {
        results.push({
          id: "Media_no_stream",
          title: "No video stream inside file",
          status: "fail",
          details: { chapter: rel, file: src },
          suggestion: "Re-export video"
        });
        continue;
      }

      const duration = parseFloat(v.duration || meta.format?.duration || 0);
      if (duration > 0) {
        results.push({
          id: "Media_video_duration_ok",
          title: "Video duration valid",
          status: "pass",
          details: { chapter: rel, file: src, duration }
        });
      } else {
        results.push({
          id: "Media_video_duration",
          title: "Video duration = 0",
          status: "fail",
          details: { chapter: rel, file: src }
        });
      }

      if (!a) {
        results.push({
          id: "Media_no_audio",
          title: "Video has no audio track",
          status: "warn",
          details: { chapter: rel, file: src },
          suggestion: "Add audio track if required"
        });
      }

      const ext = path.extname(src).replace(".", "").toLowerCase();
      const codec = v.codec_name || "unknown";
      const compat = evaluateCompatibility(ext, codec, true);

      results.push({
        id: "Media_video_validation",
        title: "Video validation",
        status: compat.issues.some(i => i.startsWith("⚠")) ? "warn" : "pass",
        details: {
          chapter: rel,
          file: src,
          codec,
          resolution: `${v.width}x${v.height}`,
          duration,
          audioTrack: !!a,
          compatibility: compat.compatibility,
          issues: compat.issues
        }
      });
    }
/* ---------------- IMAGE CHECK ---------------- */
for (const tag of images) {
    const src = parseAttr(tag, "src");
    const alt = parseAttr(tag, "alt");

    if (!src) {
        results.push({
            id: "Media_IMAGE_NO_SRC",
            title: "<img> missing src",
            status: "fail",
            details: { chapter: rel, tag },
            suggestion: "Add src attribute"
        });
        continue;
    }

    if (alt === null) {
        results.push({
            id: "Media_IMAGE_NO_ALT",
            title: "<img> missing alt text",
            status: "fail",
            details: { chapter: rel, file: src },
            suggestion: ""
        });
    }else {
    results.push({
       id: "Media_IMAGE_ALT_Present",
            title: "<img> alt text present",
            status: "pass",
            details: { chapter: rel, file: src },
           
    });
  }

    // const abs = fs.existsSync(path.join(path.dirname(opfAbsolute), src))
    //     ? path.join(path.dirname(opfAbsolute), src)
    //     : path.join(tempDir, src);
    // XHTML absolute directory
const xhtmlDir = path.dirname(path.join(tempDir, rel));

// Resolve image relative to XHTML file
const abs = path.normalize(path.join(xhtmlDir, src));

    if (!fs.existsSync(abs)) {
        results.push({
            id: "Media_IMAGE_MISSING_FILE",
            title: "Image file missing",
            status: "fail",
            details: { chapter: rel, file: src },
            suggestion: ""
        });
        continue;
    }

    const stat = fs.statSync(abs);
    if (stat.size === 0) {
        results.push({
            id: "Media_IMAGE_EMPTY",
            title: "Image file is empty",
            status: "fail",
            details: { chapter: rel, file: src },
            suggestion: "Replace the empty image with a valid asset."
        });
        continue;
    }
    results.push({
        id: "Media_IMAGE_VALID",
        title: "Image OK",
        status: "pass",
        details: { chapter: rel, file: src, size: stat.size },
        suggestion: ""
    });
}

    /* ---------------- AUDIO CHECK ---------------- */
    for (const tag of audios) {
      let src = parseAttr(tag, "src");
     

// if (!src) {
//     const audioSources = extractSourceTags(raw, "audio");
//     if (audioSources.length > 0) {
//         src = parseAttr(audioSources[0], "src");
//     }
// }

// If <video> has no src, pull from first <source>
if (!src && audioSources.length > 0) {
    src = parseAttr(audioSources[0], "src");
}

      if (!src) {
        results.push({
          id: "Media_audio_src",
          title: "<audio> missing src",
          status: "fail",
          details: { chapter: rel },
          suggestion: ""
        });
        continue;
      }

      if (!hasAttr(tag, "controls")) {
        results.push({
          id: "Media_audio_controls",
          title: "<audio> missing controls attribute",
          status: "fail",
          details: { chapter: rel, file: src },
          suggestion: ""
        });
      }

      // const abs = fs.existsSync(path.join(path.dirname(opfAbsolute), src))
      //   ? path.join(path.dirname(opfAbsolute), src)
      //   : path.join(tempDir, src);
      const xhtmlDir = path.dirname(path.join(tempDir, rel));

// Resolve image relative to XHTML file
const abs = path.normalize(path.join(xhtmlDir, src));

      if (!fs.existsSync(abs)) {
        results.push({
          id: "Media_audio_file",
          title: "Audio file missing",
          status: "fail",
          details: { chapter: rel, file: src },
          suggestion: ""
        });
        continue;
      }

      const stat = fs.statSync(abs);
      if (stat.size === 0) {
        results.push({
          id: "Media_audio_empty",
          title: "Audio file is empty",
          status: "fail",
          details: { chapter: rel, file: src },
          suggestion: "Re-export audio"
        });
        continue;
      }

      const meta = await probe(abs);
      console.log("audio META", meta);
      if (!meta) {
        results.push({
          id: "Media_audio_corrupt",
          title: "Audio unreadable",
          status: "fail",
          details: { chapter: rel, file: src },
          suggestion: "Re-export audio"
        });
        continue;
      }

      const a = meta.streams.find(s => s.codec_type === "audio");
      if (!a) {
        results.push({
          id: "Media_audio_no_stream",
          title: "No audio stream found",
          status: "fail",
          details: { chapter: rel, file: src },
          suggestion: "Re-render the audio file"
        });
        continue;
      }

      const duration = parseFloat(a.duration || meta.format?.duration || 0);
      if (duration <= 0) {
        results.push({
          id: "Media_audio_duration",
          title: "Audio duration = 0",
          status: "fail",
          details: { chapter: rel, file: src },
          suggestion: "Re-export audio"
        });
      }

      if (isSilent(meta)) {
        results.push({
          id: "Media_audio_silent",
          title: "Audio appears silent (very low bitrate)",
          status: "warn",
          details: { chapter: rel, file: src },
          suggestion: "Verify if this is expected"
        });
      }

      const ext = path.extname(src).replace(".", "").toLowerCase();
      const codec = a.codec_name || "unknown";
      const compat = evaluateCompatibility(ext, codec, false);

      results.push({
        id: "Media_audio_validation",
        title: "Audio validation",
        status: compat.issues.some(i => i.startsWith("⚠")) ? "warn" : "pass",
        details: {
          chapter: rel,
          file: src,
          codec,
          duration,
          channels: a.channels,
          bitrate: a.bit_rate,
          compatibility: compat.compatibility,
          issues: compat.issues
        }
      });
    }
  });

  /* ---------------------------------------------
     SMIL CHECKS
  --------------------------------------------- */
  const smilFiles = manifestItems.filter(x =>
    (x["@_href"] || "").toLowerCase().endsWith(".smil")
  );

  if (!smilFiles.length) {
    results.push({
      id: "SMIL_",
      title: "No SMIL read-aloud files",
      status: "warn",
      details: "EPUB has multimedia but → No SMIL sync",
      suggestion: ""
    });
  } else {
    results.push({
      id: "SMIL_",
      title: "SMIL files available",
      status: "pass",
      details: `${smilFiles.length} SMIL files`,
      suggestion: ""
    });
  }

  return results;
}

module.exports = { runMediaChecks };
