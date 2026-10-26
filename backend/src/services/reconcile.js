// Matches items bought on a platform (the purchases table) to folders and
// models in the library, so the UI can show what's on the NAS and what's missing.
//
// Two kinds of evidence:
//   - file names: the platform lists each item's files; any found in the
//     library (as a file or a zip) point at the model holding them
//   - names: words of the item's name against folder and model names, with a
//     bonus when the creator's name appears somewhere in the path
// A link the user confirmed (model_links.external_id) always wins.

import path from 'path';
import { getDb } from '../db/schema.js';
import { libraryIndex, describePath } from './library.js';

const STL_ROOT = process.env.STL_ROOT || '/nas';

// Score at or above which a suggestion counts as found, and as worth showing
export const FOUND = 0.7;
export const POSSIBLE = 0.4;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'for', 'with', 'in', 'on', 'to', 'by', 'de', 'la', 'le', 'et',
  'stl', 'stls', 'file', 'files', 'model', 'models', '3d', 'print', 'printable', 'printing',
  'printed', 'free', 'version', 'pack', 'kit', 'set', 'zip',
]);

export function tokens(text) {
  return (text ?? '')
    .toLowerCase()
    .replace(/\.(zip|stl|3mf|obj|lys|chitubox|step|stp|blend)$/i, '')
    // Cults download zips end in a date and id: "tactical-cube20250424-1-iym24"
    .replace(/\d{8}-\d+-[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

const compact = (text) => (text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ── Lookup tables built from the library index, rebuilt when it changes ───────

let lookups = null;

function getLookups() {
  const index = libraryIndex();
  if (lookups?.index === index) return lookups;

  const started = Date.now();
  const byFileName = new Map();  // lowercase file name -> Set of model paths
  const byZipName  = new Map();  // lowercase zip name   -> Set of zip node paths
  const add = (map, key, value) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(value);
  };
  const rel = (p) => (p.startsWith(STL_ROOT + '/') ? p.slice(STL_ROOT.length + 1) : p);

  const rows = getDb().prepare(`SELECT id, name, zip_source FROM files`).all();
  for (const row of rows) {
    const modelPath = index.modelOf.get(row.id);
    if (modelPath === undefined) continue;
    add(byFileName, row.name.toLowerCase(), modelPath);
    if (row.zip_source) add(byZipName, path.basename(row.zip_source).toLowerCase(), rel(row.zip_source));
  }

  // Word -> nodes whose name has it, for name matching
  const byToken = new Map();
  const nodeTokens = new Map();
  for (const node of index.nodes.values()) {
    if (!node.path || !node.fileCount) continue;
    const toks = new Set(tokens(node.name));
    if (!toks.size) continue;
    nodeTokens.set(node, toks);
    for (const t of toks) {
      if (!byToken.has(t)) byToken.set(t, []);
      byToken.get(t).push(node);
    }
  }

  const n = nodeTokens.size || 1;
  const idf = (t) => Math.log(1 + n / (byToken.get(t)?.length ?? 1));

  lookups = { index, byFileName, byZipName, byToken, nodeTokens, idf };
  console.log(`Reconcile lookups: ${byFileName.size} file names, ${nodeTokens.size} named folders (${Date.now() - started}ms)`);
  return lookups;
}

const within = (p, ancestor) => p === ancestor || p.startsWith(ancestor + '/');

// ── Matching one purchase ─────────────────────────────────────────────────────

// Library paths holding the purchase's files. A name found in many models
// (e.g. "base.stl") says little, so it counts for less.
function fileHits(purchase, L) {
  const hits = [];
  for (const name of purchase.fileNames) {
    const key = name.toLowerCase();
    const paths = L.byZipName.get(key) ?? L.byFileName.get(key);
    if (!paths) continue;
    const weight = paths.size <= 2 ? 1 : paths.size <= 5 ? 0.4 : 0.1;
    hits.push({ paths: [...paths], weight, zip: L.byZipName.has(key) });
  }
  return hits;
}

// Share of the item's files found under a path. A whole archive with a
// distinctive name counts for more than its share: items often offer
// alternatives (FDM / resin, v6 / v7) and people keep only one.
const ZIP_FLOOR = 0.6;

function fileScore(candidatePath, hits, total) {
  if (!total) return 0;
  let found = 0, zip = false;
  for (const h of hits) {
    if (!h.paths.some((p) => within(p, candidatePath))) continue;
    found += h.weight;
    if (h.zip && h.weight === 1) zip = true;
  }
  return Math.max(found / total, zip ? ZIP_FLOOR : 0);
}

// Below this, a match on name alone is only worth checking, never certain
const ONE_WORD_CAP = 0.55;

// Weighted overlap of name words: shared / all, each word weighted by rarity.
// One shared word ("Bard", "Angel") is too little to be sure of on its own.
function nameScore(want, node, L) {
  const have = L.nodeTokens.get(node);
  if (!have) return 0;
  let shared = 0, all = 0, count = 0;
  for (const t of new Set([...want, ...have])) {
    const w = L.idf(t);
    all += w;
    if (want.has(t) && have.has(t)) { shared += w; count++; }
  }
  const score = all ? shared / all : 0;
  return count < 2 ? Math.min(score, ONE_WORD_CAP) : score;
}

function creatorInPath(creator, nodePath) {
  const c = compact(creator);
  if (c.length < 3) return false;
  return nodePath.split('/').some((seg) => compact(seg).includes(c));
}

// Candidate paths with scores, best first
function candidatesFor(purchase, L, rejected) {
  const want = new Set(tokens(purchase.name));
  const hits = fileHits(purchase, L);
  const candidates = new Map();  // path -> node

  // Folders and models sharing a rare-ish word with the name
  for (const t of want) {
    const list = L.byToken.get(t);
    if (!list || list.length > 3000) continue;
    for (const node of list) candidates.set(node.path, node);
  }
  // Wherever the item's files turned up, and the folders around them: a
  // collection's zips usually sit together in one folder (e.g. "Print Minis/2023-10")
  for (const h of hits) for (const p of h.paths) {
    for (let node = L.index.nodes.get(p); node?.path; node = node.parent) candidates.set(node.path, node);
  }

  const out = [];
  for (const [p, node] of candidates) {
    if (rejected.has(p)) continue;
    let files = fileScore(p, hits, purchase.fileNames.length);
    // A big folder around the files holds lots of other things; don't let that
    // alone match. Where the files themselves are (e.g. the item's own zip) is fine.
    const direct = hits.some((h) => h.paths.includes(p));
    if (!direct && node.modelCount > Math.max(5, purchase.fileNames.length * 3)) files *= 0.5;
    const name = nameScore(want, node, L);
    const creator = creatorInPath(purchase.creator, p);
    let score = files > 0 ? Math.max(files * 0.85 + name * 0.15, name) : name;
    if (creator && score > 0.2) score += 0.1;
    score = Math.min(score, 1);
    if (score < 0.25) continue;
    const filesFound = hits.filter((h) => h.paths.some((hp) => within(hp, p))).length;
    out.push({ path: p, score, files, filesFound, name, creator });
  }
  return out.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
}

function reasonFor(c, purchase) {
  const parts = [];
  if (c.files > 0) parts.push(`${c.filesFound}/${purchase.fileNames.length} file names`);
  if (c.name >= 0.3) parts.push('name');
  if (c.creator) parts.push('creator');
  return parts.join(' + ') || 'similar name';
}

// ── Results for the UI ────────────────────────────────────────────────────────

let cache = null;  // { key, result }
let version = 0;   // bumped by every write that changes results

export function invalidate() {
  version++;
}

function loadPurchases(platform) {
  return getDb().prepare(`
    SELECT * FROM purchases WHERE platform = ? ORDER BY purchased_at DESC, name
  `).all(platform).map((r) => ({
    externalId: r.external_id, name: r.name, creator: r.creator, url: r.url,
    downloadUrl: r.download_url, thumbnailUrl: r.thumbnail_url,
    fileNames: r.file_names ? JSON.parse(r.file_names) : [],
    purchasedAt: r.purchased_at, source: r.source, ignored: !!r.ignored,
    tribeId: r.tribe_id, tierId: r.tier_id,
  }));
}

export function reconcile(platform) {
  const L = getLookups();
  const key = `${platform}|${version}`;
  if (cache?.key === key && cache.index === L.index) return cache.result;

  const started = Date.now();
  const db = getDb();
  const links = new Map();
  for (const l of db.prepare(`SELECT * FROM model_links WHERE source = ? AND external_id IS NOT NULL`).all(platform)) {
    links.set(l.external_id, l);
  }
  const rejections = new Map();
  for (const r of db.prepare(`SELECT external_id, model_path FROM match_rejections WHERE platform = ?`).all(platform)) {
    if (!rejections.has(r.external_id)) rejections.set(r.external_id, new Set());
    rejections.get(r.external_id).add(r.model_path);
  }

  const items = loadPurchases(platform).map((p) => {
    const link = links.get(p.externalId);
    const target = link ? describePath(link.model_path) : null;
    if (link && target) {
      return { ...p, status: 'found', confirmed: true, linkId: link.id, match: { ...target, score: 1, reason: 'confirmed' }, alternatives: [] };
    }

    const ranked = candidatesFor(p, L, rejections.get(p.externalId) ?? new Set());
    const described = [];
    for (const c of ranked) {
      const d = describePath(c.path);
      if (d) described.push({ ...d, score: Math.round(c.score * 100) / 100, reason: reasonFor(c, p) });
      if (described.length >= 4) break;
    }
    const best = described[0] ?? null;
    const status = p.ignored ? 'ignored'
      : best?.score >= FOUND ? 'found'
      : best?.score >= POSSIBLE ? 'possible'
      : 'missing';
    return {
      ...p, status, confirmed: false,
      // A confirmed link whose folder was moved or deleted
      staleLink: link ? link.model_path : null,
      match: status === 'missing' || status === 'ignored' ? null : best,
      alternatives: described.slice(best && status !== 'missing' ? 1 : 0),
    };
  });

  const summary = { found: 0, possible: 0, missing: 0, ignored: 0 };
  for (const i of items) summary[i.status]++;
  const sync = db.prepare(`SELECT synced_at, total, error FROM platform_sync WHERE platform = ?`).get(platform);
  const result = {
    platform, items, summary,
    syncedAt: sync?.synced_at ?? null, syncError: sync?.error ?? null,
  };
  console.log(`Reconciled ${items.length} ${platform} purchases (${Date.now() - started}ms)`);
  cache = { key, index: L.index, result };
  return result;
}

// Save a fresh list of the platform's purchases, keeping what the user set.
// A full sync replaces the list; an import of some pages (merge) only adds.
export function savePurchases(platform, list, { merge = false } = {}) {
  const db = getDb();
  const insert = `
    INSERT INTO purchases (platform, external_id, name, creator, url, download_url, thumbnail_url, file_names, purchased_at, source, tribe_id, tier_id, synced_at)
    VALUES (@platform, @externalId, @name, @creator, @url, @downloadUrl, @thumbnailUrl, @fileNames, @purchasedAt, @source, @tribeId, @tierId, datetime('now'))
    ON CONFLICT(platform, external_id) DO UPDATE SET`;
  const upsert = db.prepare(`${insert}
      name = excluded.name, creator = excluded.creator, url = excluded.url,
      download_url = excluded.download_url, thumbnail_url = excluded.thumbnail_url,
      file_names = excluded.file_names, purchased_at = excluded.purchased_at,
      source = COALESCE(excluded.source, source),
      tribe_id = COALESCE(excluded.tribe_id, tribe_id), tier_id = COALESCE(excluded.tier_id, tier_id),
      synced_at = excluded.synced_at
  `);
  // Partial items (an MMF object known only from its preview) have no files or
  // links, so they only fill in what an earlier full import left empty
  const fill = db.prepare(`${insert}
      creator = COALESCE(creator, excluded.creator), purchased_at = COALESCE(purchased_at, excluded.purchased_at),
      source = COALESCE(source, excluded.source),
      tribe_id = COALESCE(excluded.tribe_id, tribe_id), tier_id = COALESCE(excluded.tier_id, tier_id),
      synced_at = excluded.synced_at
  `);
  // Newest first, so an item bought twice keeps its latest download link
  // Partial items go after the full ones and always run, since filling in is harmless
  const seen = new Set();
  const ordered = [...list.filter((p) => !p.partial), ...list.filter((p) => p.partial)];
  db.transaction(() => {
    for (const p of ordered) {
      if (!p.externalId || (!p.partial && seen.has(p.externalId))) continue;
      seen.add(p.externalId);
      (p.partial ? fill : upsert).run({
        platform, externalId: p.externalId, name: p.name, creator: p.creator ?? null, url: p.url ?? null,
        downloadUrl: p.downloadUrl ?? null, thumbnailUrl: p.thumbnailUrl ?? null, purchasedAt: p.purchasedAt ?? null,
        source: p.source ?? null, tribeId: p.tribeId ?? null, tierId: p.tierId ?? null,
        fileNames: JSON.stringify(p.fileNames ?? []),
      });
    }
    // Drop items no longer on the account (refunds); their model_links stay
    if (!merge) {
      db.prepare(`
        DELETE FROM purchases WHERE platform = ? AND external_id NOT IN (SELECT value FROM json_each(?))
      `).run(platform, JSON.stringify([...seen]));
    }
    const total = db.prepare(`SELECT COUNT(*) n FROM purchases WHERE platform = ?`).get(platform).n;
    db.prepare(`
      INSERT INTO platform_sync (platform, synced_at, total, error) VALUES (?, datetime('now'), ?, NULL)
      ON CONFLICT(platform) DO UPDATE SET synced_at = excluded.synced_at, total = excluded.total, error = NULL
    `).run(platform, total);
  })();
  invalidate();
  return seen.size;
}

export function saveSyncError(platform, message) {
  getDb().prepare(`
    INSERT INTO platform_sync (platform, error) VALUES (?, ?)
    ON CONFLICT(platform) DO UPDATE SET error = excluded.error
  `).run(platform, message);
  invalidate();
}
