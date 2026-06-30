import fs from 'fs';
import path from 'path';
import chokidar from 'chokidar';
import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { scanZip, removeZipEntries } from './zipScanner.js';

const STL_ROOT = process.env.STL_ROOT || '/nas';
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const STL_EXTS = /\.(stl|3mf|obj)$/i;
const ZIP_EXT  = /\.zip$/i;

let watcher = null;
let watcherReady = false;

// In-flight zip scans: debounce rapid change events on large zips
const pendingZips = new Map();

function scheduleZipScan(zipPath) {
  if (pendingZips.has(zipPath)) clearTimeout(pendingZips.get(zipPath));
  pendingZips.set(
    zipPath,
    setTimeout(async () => {
      pendingZips.delete(zipPath);
      const n = await scanZip(zipPath);
      console.log(`Indexed ${n} STL(s) from ${path.basename(zipPath)}`);
    }, 1000)
  );
}

export function startWatcher(onReady) {
  if (watcher) return;

  const db = getDb();

  const upsert = db.prepare(`
    INSERT INTO files (id, path, name, size, modified_at)
    VALUES (@id, @path, @name, @size, @modified_at)
    ON CONFLICT(path) DO UPDATE SET
      name        = excluded.name,
      size        = excluded.size,
      modified_at = excluded.modified_at,
      updated_at  = datetime('now')
  `);

  const removeDirect = db.prepare(`DELETE FROM files WHERE path = ? AND zip_source IS NULL`);

  function upsertFile(filePath) {
    if (!STL_EXTS.test(filePath)) return;
    try {
      const stat = fs.statSync(filePath);
      upsert.run({
        id: randomUUID(),
        path: filePath,
        name: path.basename(filePath),
        size: stat.size,
        modified_at: stat.mtime.toISOString(),
      });
    } catch {
      // file disappeared between event and stat — ignore
    }
  }

  // SMB/CIFS mounts don't emit native inotify events, so we use polling.
  // CHOKIDAR_USEPOLLING=false disables this if your volume does support native events.
  const usePolling   = process.env.CHOKIDAR_USEPOLLING !== 'false';
  const pollInterval = parseInt(process.env.CHOKIDAR_INTERVAL || '30000', 10);

  watcher = chokidar.watch(STL_ROOT, {
    persistent: true,
    // ignoreInitial:false gives us a free initial scan on startup, catching files added while down.
    ignoreInitial: false,
    // Wait for writes to settle — critical for large zips being copied over the network.
    awaitWriteFinish: { stabilityThreshold: 3000, pollInterval: 500 },
    depth: Infinity,
    ignored: /(^|[/\\])\./, // skip hidden files/dirs
    usePolling,
    interval: pollInterval,
  });

  watcher
    .on('add', (filePath) => {
      if (ZIP_EXT.test(filePath))  scheduleZipScan(filePath);
      else                         upsertFile(filePath);
    })
    .on('change', (filePath) => {
      if (ZIP_EXT.test(filePath))  scheduleZipScan(filePath);
      else                         upsertFile(filePath);
    })
    .on('unlink', (filePath) => {
      if (ZIP_EXT.test(filePath)) {
        const n = removeZipEntries(filePath);
        if (n) console.log(`Removed ${n} entries from deleted zip: ${path.basename(filePath)}`);
      } else if (STL_EXTS.test(filePath)) {
        removeDirect.run(filePath);
      }
    })
    .on('ready', () => {
      watcherReady = true;
      const count = db.prepare(`SELECT COUNT(*) as n FROM files`).get().n;
      console.log(`Watcher ready. ${count} files indexed.`);
      onReady?.(count);
    })
    .on('error', (err) => console.error('Watcher error:', err));

  return watcher;
}

export function stopWatcher() {
  watcher?.close();
  watcher = null;
  watcherReady = false;
}

export function getWatcherStatus() {
  const db = getDb();
  const { total, zipped } = db.prepare(`
    SELECT COUNT(*) as total, SUM(zip_source IS NOT NULL) as zipped FROM files
  `).get();
  return { watching: !!watcher, ready: watcherReady, indexed: total, zipped: zipped ?? 0, root: STL_ROOT };
}

// Reconcile: remove DB rows whose source no longer exists on disk.
// For zip entries, checks the zip file; for direct files, checks the file itself.
export function reconcile() {
  const db = getDb();
  const rows = db.prepare(`SELECT id, path, zip_source FROM files`).all();
  const remove = db.prepare(`DELETE FROM files WHERE id = ?`);
  let removed = 0;
  db.transaction(() => {
    for (const row of rows) {
      const checkPath = row.zip_source ?? row.path;
      if (!fs.existsSync(checkPath)) {
        remove.run(row.id);
        removed++;
      }
    }
  })();
  return { removed, total: rows.length };
}

export function getSiblingImages(filePath) {
  // filePath may be a virtual "zip::entry" path — no sibling images in that case
  if (filePath.includes('::')) return [];
  const dir  = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  try {
    return fs.readdirSync(dir)
      .filter((f) => {
        const ext  = path.extname(f).toLowerCase();
        const stem = path.basename(f, ext);
        return IMAGE_EXTS.has(ext) && stem.toLowerCase().startsWith(base.toLowerCase().slice(0, 6));
      })
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}
