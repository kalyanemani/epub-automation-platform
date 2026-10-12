const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');

function isZipSignature(buffer) {
  return (
    buffer &&
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) &&
    (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08)
  );
}

function validateEpubArchive(epubPath) {
  const header = Buffer.alloc(4);
  const fd = fs.openSync(epubPath, 'r');

  try {
    fs.readSync(fd, header, 0, 4, 0);
  } finally {
    fs.closeSync(fd);
  }

  if (!isZipSignature(header)) {
    throw new Error(
      'Autofix expects an EPUB file. The uploaded file is not a ZIP/EPUB archive.'
    );
  }
}

function unzipToTemp(epubPath) {
  return new Promise((resolve, reject) => {
    try {
      validateEpubArchive(epubPath);

      const zip = new AdmZip(epubPath);
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epub-'));
      const entries = zip.getEntries();

      entries.forEach((entry) => {
        const outPath = path.join(tempDir, entry.entryName);
        if (entry.isDirectory) {
          fs.mkdirSync(outPath, { recursive: true });
        } else {
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, entry.getData());
        }
      });

      fs.writeFileSync(
        path.join(process.cwd(), 'last-temp-dir.txt'),
        tempDir,
        'utf8'
      );

      console.log('Extracted EPUB ->', tempDir);
      resolve({ tempDir, zipEntries: entries.map((entry) => entry.entryName) });
    } catch (err) {
      if (
        err &&
        typeof err.message === 'string' &&
        /invalid|unsupported zip format|no end header/i.test(err.message)
      ) {
        return reject(
          new Error(
            'Autofix expects a valid EPUB archive. The uploaded file could not be opened as EPUB.'
          )
        );
      }

      reject(err);
    }
  });
}

function listAllFiles(dir) {
  const out = [];

  function walk(currentDir) {
    const items = fs.readdirSync(currentDir);
    items.forEach((item) => {
      const full = path.join(currentDir, item);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
      } else {
        out.push(full);
      }
    });
  }

  walk(dir);
  return out;
}

function readTextFile(fp) {
  try {
    return fs.readFileSync(fp, 'utf8');
  } catch (error) {
    return null;
  }
}

module.exports = { unzipToTemp, listAllFiles, readTextFile };
