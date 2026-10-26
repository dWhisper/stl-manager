import fs from 'fs';
import path from 'path';
import { Worker } from 'worker_threads';
import { getDb } from '../db/schema.js';
import { extractToCache, freshCachePath, extractToFile, privateCachePath } from './zipScanner.js';

const THUMB_DIR  = process.env.THUMB_DIR  || '/data/thumbnails';
// Each worker renders one STL at a time on its own thread
const WORKERS    = Math.max(1, parseInt(process.env.THUMB_WORKERS || '3', 10));

// ── Queue ─────────────────────────────────────────────────────────────────────

const queue = new Set();
// Files someone is looking at right now jump ahead of the background backlog
const priority = new Set();
// Lowest priority: geometry fingerprints for STLs thumbnailed before geo_key existed
const geoQueue = new Set();
let active = 0;
let activeGeo = 0;   // subset of `active`, tracked so thumbnail pending counts exclude it

export function queueThumbnail(fileId) {
  queue.add(fileId);
  drainQueue();
}

export function prioritizeThumbnails(fileIds) {
  for (const id of fileIds) priority.add(id);
  drainQueue();
}

export function queueAll() {
  const db = getDb();
  const rows = db.prepare(`SELECT id FROM files WHERE thumbnail_path IS NULL AND thumb_error IS NULL`).all();
  for (const r of rows) queue.add(r.id);
  drainQueue();
  return rows.length;
}

export function queueGeoBackfill() {
  const rows = getDb().prepare(`
    SELECT id FROM files
    WHERE lower(name) LIKE '%.stl' AND thumbnail_path IS NOT NULL
      AND geo_key IS NULL AND fingerprint_error IS NULL
  `).all();
  for (const r of rows) geoQueue.add(r.id);
  drainQueue();
  return rows.length;
}

// Thumbnail work only, so the CRC fingerprinter isn't held up by the geo backfill
export function getPendingCount() {
  return queue.size + priority.size + (active - activeGeo);
}

export function getGeoPending() {
  return geoQueue.size + activeGeo;
}

function drainQueue() {
  while (active < WORKERS && (priority.size || queue.size || geoQueue.size)) {
    if (!priority.size && !queue.size) {
      const [id] = geoQueue;
      geoQueue.delete(id);
      active++;
      activeGeo++;
      generateGeoKey(id)
        .catch((e) => {
          console.error(`Geo key failed [${id}]: ${e.message}`);
          getDb().prepare(`UPDATE files SET fingerprint_error = ?, updated_at = datetime('now') WHERE id = ?`)
            .run(`geo: ${e.message}`, id);
        })
        .finally(() => { active--; activeGeo--; drainQueue(); });
      continue;
    }
    const [id] = priority.size ? priority : queue;  // first element of a Set
    priority.delete(id);
    queue.delete(id);
    active++;
    generateThumbnail(id)
      .catch((e) => {
        console.error(`Thumb failed [${id}]: ${e.message}`);
        // Remember the failure so page views don't requeue it forever
        getDb().prepare(`UPDATE files SET thumb_error = ?, updated_at = datetime('now') WHERE id = ?`)
          .run(e.message, id);
      })
      .finally(() => { active--; drainQueue(); });
  }
}

// ── Worker pool ───────────────────────────────────────────────────────────────

const idle    = [];
const pending = new Map();   // jobId -> { resolve, reject }
let poolStarted = false;
let nextJobId   = 0;

function spawnWorker() {
  const worker = new Worker(new URL('./thumbWorker.js', import.meta.url));
  worker.jobId = null;
  worker.on('message', ({ jobId, ok, error }) => {
    const job = pending.get(jobId);
    pending.delete(jobId);
    worker.jobId = null;
    idle.push(worker);
    if (error) job?.reject(new Error(error));
    else       job?.resolve(ok);
  });
  // A crash (e.g. out of memory on a huge mesh) fails only that job; replace the worker
  worker.on('error', (err) => console.error(`Thumb worker crashed: ${err.message}`));
  worker.on('exit', () => {
    const job = pending.get(worker.jobId);
    if (job) {
      pending.delete(worker.jobId);
      job.reject(new Error('thumbnail worker exited'));
    }
    const i = idle.indexOf(worker);
    if (i !== -1) idle.splice(i, 1);
    spawnWorker();
  });
  idle.push(worker);
}

function renderInWorker(stlPath, outPath, mode) {
  if (!poolStarted) {
    poolStarted = true;
    for (let i = 0; i < WORKERS; i++) spawnWorker();
  }
  // drainQueue never runs more than WORKERS jobs, so a worker is always idle here
  const worker = idle.pop();
  const jobId  = nextJobId++;
  worker.jobId = jobId;
  return new Promise((resolve, reject) => {
    pending.set(jobId, { resolve, reject });
    worker.postMessage({ jobId, stlPath, outPath, mode });
  });
}

// ── Generator ─────────────────────────────────────────────────────────────────

async function generateThumbnail(fileId) {
  const db  = getDb();
  const row = db.prepare(`SELECT path, name, size, zip_source, zip_entry FROM files WHERE id = ?`).get(fileId);
  if (!row) return;

  const ext = path.extname(row.zip_entry ?? row.name).toLowerCase();
  if (ext !== '.stl') return; // 3MF / OBJ parsers TODO

  let stlPath = row.path;
  if (row.zip_source) {
    if (!fs.existsSync(row.zip_source)) return;
    stlPath = await extractToCache(row.zip_source, row.zip_entry, row.size);
  } else {
    if (!fs.existsSync(stlPath)) return;
  }

  fs.mkdirSync(THUMB_DIR, { recursive: true });
  const thumbPath = path.join(THUMB_DIR, `${fileId}.jpg`);

  const geoKey = await renderInWorker(stlPath, thumbPath);
  if (!geoKey) throw new Error('STL has no readable triangles');

  db.prepare(`UPDATE files SET thumbnail_path = ?, geo_key = ?, thumb_error = NULL, updated_at = datetime('now') WHERE id = ?`)
    .run(thumbPath, geoKey, fileId);
}

// Geometry fingerprint only (no render). Never touches thumb_error.
async function generateGeoKey(fileId) {
  const db  = getDb();
  const row = db.prepare(`SELECT path, name, size, zip_source, zip_entry FROM files WHERE id = ?`).get(fileId);
  if (!row) return;

  let stlPath = row.path;
  let privateCopy = null;   // this job's own extraction; the shared cache is never deleted from here
  try {
    if (row.zip_source) {
      if (!fs.existsSync(row.zip_source)) return;
      stlPath = freshCachePath(row.zip_source, row.zip_entry, row.size);
      if (!stlPath) {
        privateCopy = stlPath = privateCachePath(row.zip_entry);
        await extractToFile(row.zip_source, row.zip_entry, privateCopy);
      }
    } else if (!fs.existsSync(stlPath)) return;

    const geoKey = await renderInWorker(stlPath, null, 'geo');
    if (!geoKey) throw new Error('STL has no readable triangles');
    db.prepare(`UPDATE files SET geo_key = ?, updated_at = datetime('now') WHERE id = ?`).run(geoKey, fileId);
  } finally {
    // Backfill must not bloat the cache; thumbnail renders keep theirs for the viewer
    if (privateCopy) fs.rmSync(privateCopy, { force: true });
  }
}
