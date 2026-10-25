import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { reconcile, savePurchases, saveSyncError, invalidate } from '../services/reconcile.js';
import { describePath } from '../services/library.js';
import { runSync, SYNC_PLATFORMS } from '../services/syncWorker.js';
import { parseLibraryExport } from '../services/mmf.js';

const router = Router();

// Platforms whose purchases come from an uploaded export instead of a sync
const IMPORTERS = {
  myminifactory: parseLibraryExport,
};

function platformParam(req, res, next) {
  if (!SYNC_PLATFORMS.includes(req.params.platform) && !IMPORTERS[req.params.platform]) return res.status(404).json({ error: 'Unknown platform' });
  next();
}

function getPurchase(platform, externalId) {
  return getDb().prepare(`SELECT * FROM purchases WHERE platform = ? AND external_id = ?`).get(platform, externalId);
}

// Syncs in progress: platform -> { startedAt, done, total }
const syncs = new Map();

router.get('/:platform', platformParam, (req, res) => {
  res.json({ ...reconcile(req.params.platform), syncing: syncs.get(req.params.platform) ?? null });
});

// Starts a sync and returns at once; it can outlast a proxy timeout on a busy
// NAS. The page polls GET /:platform until `syncing` is null.
router.post('/:platform/sync', platformParam, (req, res) => {
  const { platform } = req.params;
  if (!SYNC_PLATFORMS.includes(platform)) return res.status(400).json({ error: `${platform} purchases are imported, not synced` });
  const creds = getDb().prepare(`
    SELECT username, api_key FROM platform_credentials WHERE platform = ? AND profile_json IS NOT NULL
  `).get(platform);
  if (!creds) return res.status(401).json({ error: `${platform} not connected` });
  if (syncs.has(platform)) return res.status(202).json({ ok: true, running: true });

  const state = { startedAt: new Date().toISOString(), done: 0, total: null };
  syncs.set(platform, state);
  runSync(platform, creds.username, creds.api_key, (done, total) => Object.assign(state, { done, total }))
    .then((list) => console.log(`Synced ${savePurchases(platform, list)} ${platform} purchases`))
    .catch((e) => {
      console.error(`${platform} sync failed: ${e.message}`);
      saveSyncError(platform, e.message);
    })
    .finally(() => syncs.delete(platform));
  res.status(202).json({ ok: true });
});

// Add purchases from saved library pages: body is { files: [parsed JSON, ...] }
router.post('/:platform/import', platformParam, (req, res) => {
  const { platform } = req.params;
  const parse = IMPORTERS[platform];
  if (!parse) return res.status(400).json({ error: `${platform} purchases are synced, not imported` });
  const files = Array.isArray(req.body.files) ? req.body.files : [];

  const purchases = [];
  let totalCount = null;
  // The export script's notes on groups it couldn't read
  const exportNotes = files.map((f) => f?.export).filter(Boolean);
  for (const data of files) {
    const parsed = parse(data);
    purchases.push(...parsed.purchases);
    totalCount = Math.max(totalCount ?? 0, parsed.totalCount ?? 0) || null;
  }
  if (!purchases.length) {
    return res.status(400).json({ error: "Didn't find any purchases in that file. Is it the library data page saved as JSON?" });
  }
  savePurchases(platform, purchases, { merge: true });
  const stored = getDb().prepare(`SELECT COUNT(*) n FROM purchases WHERE platform = ?`).get(platform).n;
  res.json({
    ok: true, imported: purchases.length, stored, totalCount,
    failures: exportNotes.flatMap((n) => n.failures ?? []),
    emptyGroups: exportNotes.reduce((sum, n) => sum + (n.empty?.length ?? 0), 0),
  });
});

// Confirm which library folder or model holds a purchase (replaces any earlier link)
router.post('/:platform/:externalId/link', platformParam, (req, res) => {
  const { platform, externalId } = req.params;
  const purchase = getPurchase(platform, externalId);
  if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
  if (!req.body.path || !describePath(req.body.path)) return res.status(400).json({ error: 'Not a folder or model in the library' });

  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM model_links WHERE source = ? AND external_id = ?`).run(platform, externalId);
    db.prepare(`
      INSERT INTO model_links (id, model_path, source, external_id, url, external_name, external_author)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), req.body.path, platform, externalId, purchase.url, purchase.name, purchase.creator);
    db.prepare(`UPDATE purchases SET ignored = 0 WHERE platform = ? AND external_id = ?`).run(platform, externalId);
  })();
  invalidate();
  res.json({ ok: true });
});

router.delete('/:platform/:externalId/link', platformParam, (req, res) => {
  getDb().prepare(`DELETE FROM model_links WHERE source = ? AND external_id = ?`)
    .run(req.params.platform, req.params.externalId);
  invalidate();
  res.json({ ok: true });
});

// "Not this one": stop suggesting a path for a purchase
router.post('/:platform/:externalId/reject', platformParam, (req, res) => {
  const { platform, externalId } = req.params;
  if (!req.body.path) return res.status(400).json({ error: 'path required' });
  getDb().prepare(`
    INSERT OR IGNORE INTO match_rejections (platform, external_id, model_path) VALUES (?, ?, ?)
  `).run(platform, externalId, req.body.path);
  invalidate();
  res.json({ ok: true });
});

// Ignored purchases don't count as missing (things you don't want on the NAS)
router.post('/:platform/:externalId/ignore', platformParam, (req, res) => {
  const { platform, externalId } = req.params;
  getDb().prepare(`UPDATE purchases SET ignored = ? WHERE platform = ? AND external_id = ?`)
    .run(req.body.ignored === false ? 0 : 1, platform, externalId);
  invalidate();
  res.json({ ok: true });
});

export default router;
