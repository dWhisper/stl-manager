import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import unzipper from 'unzipper';
import { getDb } from '../db/schema.js';

const STL_EXTS = /\.(stl|3mf|obj)$/i;
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

function cachePathFor(zipSource, zipEntry) {
  const key = createHash('sha1').update(`${zipSource}::${zipEntry}`).digest('hex');
  return path.join(CACHE_DIR, key + path.extname(zipEntry).toLowerCase());
}

export async function scanZip(zipPath) {
  const db = getDb();

  let directory;
  try {
    directory = await unzipper.Open.file(zipPath);
  } catch (err) {
    console.warn(`Skipping invalid zip ${zipPath}: ${err.message}`);
    return 0;
  }

  const stlEntries = directory.files.filter(
    (e) => e.type !== 'Directory' && STL_EXTS.test(e.path)
  );

  const upsert = db.prepare(`
    INSERT INTO files (id, path, name, size, modified_at, zip_source, zip_entry)
    VALUES (@id, @path, @name, @size, @modified_at, @zip_source, @zip_entry)
    ON CONFLICT(path) DO UPDATE SET
      name        = excluded.name,
      size        = excluded.size,
      modified_at = excluded.modified_at,
      zip_source  = excluded.zip_source,
      zip_entry   = excluded.zip_entry,
      updated_at  = datetime('now')
    RETURNING id, thumbnail_path
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
      const row = upsert.get({
        id: randomUUID(),
        path: virtualPath,
        name: path.basename(entry.path),
        size: entry.uncompressedSize ?? null,
        modified_at: entry.lastModifiedDate?.toISOString() ?? new Date().toISOString(),
        zip_source: zipPath,
        zip_entry: entry.path,
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

// Extract a zip entry to the cache dir and return the cache path.
// If the cache file already exists and the zip hasn't been modified since
// it was cached, skip extraction.
export async function extractToCache(zipSource, zipEntry) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const cachePath = cachePathFor(zipSource, zipEntry);

  if (fs.existsSync(cachePath)) {
    const cacheTime = fs.statSync(cachePath).mtimeMs;
    const zipTime = fs.statSync(zipSource).mtimeMs;
    if (zipTime <= cacheTime) return cachePath; // cache is fresh
  }

  const directory = await unzipper.Open.file(zipSource);
  const entry = directory.files.find((e) => e.path === zipEntry);
  if (!entry) throw new Error(`Entry "${zipEntry}" not found in ${zipSource}`);

  await new Promise((resolve, reject) =>
    entry.stream().pipe(fs.createWriteStream(cachePath)).on('finish', resolve).on('error', reject)
  );

  return cachePath;
}
