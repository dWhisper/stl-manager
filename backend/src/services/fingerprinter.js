import { getDb } from '../db/schema.js';
import { crc32File, contentKey } from './crc32.js';
import { scanZip } from './zipScanner.js';
import { getPendingCount } from './thumbnailer.js';

const THUMB_WAIT_MS = 10000;
const LOG_EVERY = 1000;

let started = false;
let running = false;
let startupDone = false;     // startup pass finished; queueFingerprint can drive the drain itself
let remaining = 0;           // startup items (zips + loose files) not yet processed
const queued = new Set();    // ids queued by the scanner after startup

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Yield to thumbnail rendering: it is the user-visible work, fingerprinting can wait
async function waitForThumbnails() {
  while (getPendingCount() > 0) await sleep(THUMB_WAIT_MS);
}

async function fingerprintOne(id) {
  const db = getDb();
  const row = db.prepare(
    `SELECT path, size, modified_at FROM files WHERE id = ? AND zip_source IS NULL AND content_key IS NULL`
  ).get(id);
  if (!row) return;
  try {
    const crc = await crc32File(row.path);
    // Size and mtime guard: a file that changed mid-read is left for its requeue
    db.prepare(`UPDATE files SET content_key = ? WHERE id = ? AND size = ? AND modified_at IS ?`)
      .run(contentKey(crc, row.size), id, row.size, row.modified_at);
  } catch (err) {
    db.prepare(`UPDATE files SET fingerprint_error = ? WHERE id = ?`).run(err.message, id);
  }
}

async function runLoop() {
  const db = getDb();

  // 1. Re-key already-indexed zips (scanZip writes content_key on every entry)
  const zips = db.prepare(
    `SELECT DISTINCT zip_source FROM files WHERE zip_source IS NOT NULL AND content_key IS NULL`
  ).all().map((r) => r.zip_source);
  remaining += zips.length;
  for (const zip of zips) {
    await waitForThumbnails();
    try {
      await scanZip(zip);
    } catch (err) {
      console.error(`Fingerprint rescan failed for ${zip}: ${err.message}`);
    }
    remaining--;
  }

  // 2. Loose files. geo: errors are geometry-only and must not block the CRC
  const ids = db.prepare(
    `SELECT id FROM files WHERE zip_source IS NULL AND content_key IS NULL
       AND (fingerprint_error IS NULL OR fingerprint_error LIKE 'geo:%')`
  ).all().map((r) => r.id);
  remaining += ids.length;
  const total = ids.length;
  let done = 0;
  for (const id of ids) {
    await waitForThumbnails();
    try {
      await fingerprintOne(id);
    } catch (err) {
      console.error(`Fingerprint failed for ${id}: ${err.message}`);
    }
    remaining--;
    done++;
    if (done % LOG_EVERY === 0) console.log(`Fingerprinted ${done}/${total} loose files`);
  }
  if (total) console.log(`Fingerprinted ${done}/${total} loose files`);

  // 3. Files the scanner queues from now on
  startupDone = true;
  await drainQueue();
}

async function drainQueue() {
  running = true;
  try {
    while (queued.size) {
      const id = queued.values().next().value;
      queued.delete(id);
      await waitForThumbnails();
      try {
        await fingerprintOne(id);
      } catch (err) {
        console.error(`Fingerprint failed for ${id}: ${err.message}`);
      }
    }
  } finally {
    running = false;
  }
}

export function startFingerprinter() {
  if (started) return;
  started = true;
  runLoop().catch((err) => console.error(`Fingerprinter stopped: ${err.message}`));
}

export function queueFingerprint(fileId) {
  if (!started) return;  // startup picks these rows up
  queued.add(fileId);
  // While the startup pass runs, drainQueue is invoked at its end; afterwards wake it here
  if (!running && startupDone) drainQueue().catch((err) => console.error(`Fingerprinter error: ${err.message}`));
}

export function getFingerprintPending() {
  return remaining + queued.size;
}
