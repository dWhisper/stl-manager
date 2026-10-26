import { getDb } from '../db/schema.js';
import { logicalPath } from './library.js';
import { buildGroups } from './dedupe.js';
import { getFingerprintPending } from './fingerprinter.js';
import { getGeoPending } from './thumbnailer.js';

const STL_ROOT = process.env.STL_ROOT || '/nas';
const RECHECK_MS = 15000;
export const KINDS = ['folders', 'contained', 'files', 'geometry'];

let groups = null;
let signature = '';
let checkedAt = 0;

function toRow(r) {
  const zip = !!r.zip_source;
  return {
    id: r.id,
    logical: logicalPath(r),
    zipLogical: zip ? logicalPath({ path: r.zip_source }) : null,
    real: zip ? r.zip_source : r.path,  // the file on disk: the zip itself for an entry
    size: r.size ?? 0,
    contentKey: r.content_key,
    geoKey: r.geo_key,
    hasThumb: r.thumbnail_path != null,
  };
}

function buildAll() {
  const started = Date.now();
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, path, size, zip_source, zip_entry, content_key, geo_key, thumbnail_path FROM files`
  ).all().map(toRow);
  const linkedPaths = db.prepare(`SELECT DISTINCT model_path FROM model_links`).all().map(r => r.model_path);
  const out = buildGroups(rows, { linkedPaths, stlRoot: STL_ROOT });
  console.log(`Duplicate groups: ${KINDS.map(k => `${out[k].length} ${k}`).join(', ')} (${Date.now() - started}ms)`);
  return out;
}

export function getGroups() {
  const now = Date.now();
  if (groups && now - checkedAt < RECHECK_MS) return groups;
  checkedAt = now;
  const db = getDb();
  const f = db.prepare(`SELECT COUNT(*) n, MAX(created_at) c, COUNT(content_key) k, COUNT(geo_key) g FROM files`).get();
  const l = db.prepare(`SELECT MAX(created_at) c FROM model_links`).get();
  const sig = `${f.n}|${f.c}|${f.k}|${f.g}|${l.c}`;
  if (!groups || sig !== signature) {
    groups = buildAll();
    signature = sig;
  }
  return groups;
}

export function getDecisions() {
  const map = new Map();
  for (const d of getDb().prepare(`SELECT signature, action, keeper_path FROM dedupe_decisions`).all()) {
    map.set(d.signature, { action: d.action, keeper_path: d.keeper_path });
  }
  return map;
}

export function setDecision(sig, { kind, action, keeper_path, members }) {
  getDb().prepare(`
    INSERT INTO dedupe_decisions (signature, kind, action, keeper_path, members, decided_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(signature) DO UPDATE SET kind = excluded.kind, action = excluded.action,
      keeper_path = excluded.keeper_path, members = excluded.members, decided_at = excluded.decided_at
  `).run(sig, kind, action, keeper_path ?? null, JSON.stringify(members));
}

export function clearDecision(sig) {
  getDb().prepare(`DELETE FROM dedupe_decisions WHERE signature = ?`).run(sig);
}

export function summary() {
  const g = getGroups();
  const decisions = getDecisions();
  const kinds = {};
  const current = new Set();
  for (const k of KINDS) {
    kinds[k] = { groups: g[k].length, reclaimable: g[k].reduce((n, x) => n + x.reclaimable, 0) };
    for (const x of g[k]) current.add(x.signature);
  }
  let decided = 0;
  for (const sig of decisions.keys()) if (current.has(sig)) decided++;
  const { errors } = getDb().prepare(`SELECT COUNT(*) errors FROM files WHERE fingerprint_error IS NOT NULL`).get();
  return { kinds, decided, fingerprintPending: getFingerprintPending(), geoPending: getGeoPending(), errors };
}
