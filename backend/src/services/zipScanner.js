import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createHash, randomUUID } from 'crypto';
import yauzl from 'yauzl';
import { getDb } from '../db/schema.js';
import { contentKey } from './crc32.js';

const STL_EXTS = /\.(stl|3mf|obj)$/i;
// macOS zips carry __MACOSX/ folders of "._name.stl" metadata stubs that aren't real models
const ZIP_JUNK = /(^|\/)(__MACOSX\/|\._)/;
const CACHE_DIR = process.env.CACHE_DIR || '/data/cache';

// Virtual path encoding: "<zipAbsPath>::<entryPath>"
export function encodeZipPath(zipSource, zipEntry) {
  return `${zipSource}::${zipEntry}`;
}

export function decodeZipPath(virtualPath) {
  const sep = virtualPath.indexOf('::');
  if (sep === -1) return null;
  return { zipSource: virtualPath.slice(0, sep), zipEntry: virtualPath.slice(sep + 2) };
}

export function cachePathFor(zipSource, zipEntry) {
  const key = createHash('sha1').update(`${zipSource}::${zipEntry}`).digest('hex');
  return path.join(CACHE_DIR, key + path.extname(zipEntry).toLowerCase());
}

// yauzl handles ZIP64 (archives over 4 GB); unzipper 0.10 misread their entry offsets.
// Its strict checks would reject a whole zip over one odd entry, so names are
// validated per entry in walkEntries and extracted sizes are checked in extractToCache.
const ZIP_OPTS = { lazyEntries: true, autoClose: false, decodeStrings: false, validateEntrySizes: false };

class FileReader extends yauzl.RandomAccessReader {
  constructor(filePath) {
    super();
    this.filePath = filePath;
  }
  _readStreamForRange(start, end) {
    return fs.createReadStream(this.filePath, { start, end: end - 1 });
  }
}

function openZip(zipPath) {
  return new Promise((resolve, reject) =>
    yauzl.open(zipPath, ZIP_OPTS, (err, zip) => {
      if (!err) return resolve(zip);
      // Some tools pad a zip with bytes after its end record; retry as if the padding weren't there
      const m = /Invalid comment length\. Expected: (\d+)\. Found: (\d+)/.exec(err.message);
      const padding = m ? Number(m[1]) - Number(m[2]) : 0;
      if (padding <= 0) return reject(err);
      const size = fs.statSync(zipPath).size - padding;
      yauzl.fromRandomAccessReader(new FileReader(zipPath), size, ZIP_OPTS, (err2, zip2) =>
        (err2 ? reject(err2) : resolve(zip2))
      );
    })
  );
}

// Walk the central directory, stopping early when visit() returns true.
// Entries with unsafe names (absolute paths, "..") are skipped rather than failing the zip.
function walkEntries(zip, visit) {
  return new Promise((resolve, reject) => {
    zip.on('entry', (entry) => {
      entry.fileName = yauzl.getFileNameLowLevel(entry.generalPurposeBitFlag, entry.fileNameRaw, entry.extraFields, false);
      if (!yauzl.validateFileName(entry.fileName) && visit(entry)) resolve(entry);
      else zip.readEntry();
    });
    zip.on('end', () => resolve(null));
    zip.on('error', reject);
    zip.readEntry();
  });
}

export async function scanZip(zipPath) {
  const db = getDb();

  const stlEntries = [];
  let zip;
  try {
    zip = await openZip(zipPath);
    await walkEntries(zip, (e) => {
      if (!e.fileName.endsWith('/') && STL_EXTS.test(e.fileName) && !ZIP_JUNK.test(e.fileName)) {
        stlEntries.push({ path: e.fileName, size: e.uncompressedSize, crc: e.crc32, modified: e.getLastModDate() });
      }
      return false;
    });
  } catch (err) {
    console.warn(`Skipping invalid zip ${zipPath}: ${err.message}`);
    return [];
  } finally {
    zip?.close();
  }

  const upsert = db.prepare(`
    INSERT INTO files (id, path, name, size, modified_at, zip_source, zip_entry, content_key)
    VALUES (@id, @path, @name, @size, @modified_at, @zip_source, @zip_entry, @content_key)
    ON CONFLICT(path) DO UPDATE SET
      name        = excluded.name,
      size        = excluded.size,
      modified_at = excluded.modified_at,
      zip_source  = excluded.zip_source,
      zip_entry   = excluded.zip_entry,
      thumb_error = CASE WHEN files.modified_at IS excluded.modified_at THEN files.thumb_error END,
      content_key = excluded.content_key,
      geo_key = CASE WHEN files.modified_at IS excluded.modified_at AND files.size IS excluded.size THEN files.geo_key END,
      fingerprint_error = CASE WHEN files.modified_at IS excluded.modified_at AND files.size IS excluded.size THEN files.fingerprint_error END,
      updated_at  = datetime('now')
    RETURNING id, thumbnail_path, thumb_error
  `);

  const existingPaths = new Set(
    db.prepare(`SELECT path FROM files WHERE zip_source = ?`).all(zipPath).map((r) => r.path)
  );
  const seenPaths = new Set();
  const upserted  = [];

  db.transaction(() => {
    for (const entry of stlEntries) {
      const virtualPath = encodeZipPath(zipPath, entry.path);
      seenPaths.add(virtualPath);
      const { modified } = entry;
      const row = upsert.get({
        id: randomUUID(),
        path: virtualPath,
        name: path.basename(entry.path),
        size: entry.size ?? null,
        modified_at: (modified instanceof Date && !isNaN(modified) ? modified : new Date()).toISOString(),
        zip_source: zipPath,
        zip_entry: entry.path,
        content_key: contentKey(entry.crc, entry.size),
      });
      if (row) upserted.push(row);
    }
    for (const p of existingPaths) {
      if (!seenPaths.has(p)) db.prepare(`DELETE FROM files WHERE path = ?`).run(p);
    }
  })();

  return upserted;
}

export function removeZipEntries(zipPath) {
  const db = getDb();
  const { changes } = db.prepare(`DELETE FROM files WHERE zip_source = ?`).run(zipPath);
  return changes;
}

// The cache path if its file is complete (matches expectedSize when given) and the
// zip hasn't been modified since it was cached, else null.
// Older builds could leave truncated files behind, so check the size too.
export function freshCachePath(zipSource, zipEntry, expectedSize) {
  const cachePath = cachePathFor(zipSource, zipEntry);
  if (!fs.existsSync(cachePath)) return null;
  const cached   = fs.statSync(cachePath);
  const zipTime  = fs.statSync(zipSource).mtimeMs;
  const complete = expectedSize == null || cached.size === expectedSize;
  return zipTime <= cached.mtimeMs && complete ? cachePath : null;
}

// Extract a zip entry to destPath. Written beside it and renamed, so an
// interrupted extraction never looks complete.
export async function extractToFile(zipSource, zipEntry, destPath) {
  const zip = await openZip(zipSource);
  try {
    const entry = await walkEntries(zip, (e) => e.fileName === zipEntry);
    if (!entry) throw new Error(`Entry "${zipEntry}" not found in ${zipSource}`);

    const tmpPath = `${destPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const stream = await new Promise((resolve, reject) =>
        zip.openReadStream(entry, (err, s) => (err ? reject(err) : resolve(s)))
      );
      await pipeline(stream, fs.createWriteStream(tmpPath));
      const written = fs.statSync(tmpPath).size;
      if (written !== entry.uncompressedSize) {
        throw new Error(`Extracted ${written} of ${entry.uncompressedSize} bytes from ${zipEntry}`);
      }
      fs.renameSync(tmpPath, destPath);
    } catch (err) {
      fs.rmSync(tmpPath, { force: true });
      throw err;
    }
  } finally {
    zip.close();
  }
}

// Extract a zip entry to the shared cache dir and return the cache path,
// skipping extraction when a fresh cache file already exists.
export async function extractToCache(zipSource, zipEntry, expectedSize) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const fresh = freshCachePath(zipSource, zipEntry, expectedSize);
  if (fresh) return fresh;
  const cachePath = cachePathFor(zipSource, zipEntry);
  await extractToFile(zipSource, zipEntry, cachePath);
  return cachePath;
}

// A private path in the cache dir for a job that must not touch the shared cache file
export function privateCachePath(zipEntry) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  return path.join(CACHE_DIR, `${randomUUID()}.geo.${process.pid}.tmp${path.extname(zipEntry).toLowerCase()}`);
}
