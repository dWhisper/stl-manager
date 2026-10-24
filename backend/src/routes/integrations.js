import { Router } from 'express';
import { getDb } from '../db/schema.js';
import * as cults from '../services/cults.js';
import * as mmf   from '../services/mmf.js';

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function getCreds(platform) {
  const row = getDb().prepare(`
    SELECT username, api_key FROM platform_credentials WHERE platform = ? AND profile_json IS NOT NULL
  `).get(platform);
  if (!row) throw Object.assign(new Error(`${platform} not connected`), { status: 401 });
  return row;
}

function saveProfile(platform, profile) {
  getDb().prepare(`
    UPDATE platform_credentials SET profile_json = ?, updated_at = datetime('now') WHERE platform = ?
  `).run(JSON.stringify(profile), platform);
}

// Saves the credentials before verifying them, so a failed check doesn't lose them.
// A blank apiKey reuses the saved one.
function connectRoute(platform, getProfile) {
  return wrapAsync(async (req, res) => {
    const db       = getDb();
    const saved    = db.prepare(`SELECT api_key FROM platform_credentials WHERE platform = ?`).get(platform);
    const username = req.body.username?.trim();
    const apiKey   = req.body.apiKey?.trim() || saved?.api_key;
    if (!username || !apiKey) {
      return res.status(400).json({ error: 'username and apiKey are required' });
    }

    db.prepare(`
      INSERT INTO platform_credentials (platform, username, api_key)
      VALUES (?, ?, ?)
      ON CONFLICT(platform) DO UPDATE SET
        username     = excluded.username,
        api_key      = excluded.api_key,
        profile_json = NULL,
        updated_at   = datetime('now')
    `).run(platform, username, apiKey);

    const profile = await getProfile(username, apiKey);
    saveProfile(platform, profile);
    res.json({ ok: true, profile });
  });
}

// Disconnecting keeps the saved key; ?forget=1 deletes it too
function disconnectRoute(platform) {
  return (req, res) => {
    const db = getDb();
    if (req.query.forget) {
      db.prepare(`DELETE FROM platform_credentials WHERE platform = ?`).run(platform);
    } else {
      db.prepare(`UPDATE platform_credentials SET profile_json = NULL, updated_at = datetime('now') WHERE platform = ?`).run(platform);
    }
    res.json({ ok: true });
  };
}

function wrapAsync(fn) {
  return (req, res, next) => fn(req, res).catch((e) => {
    res.status(e.status ?? 502).json({ error: e.message });
  });
}

// ── Status ────────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const db   = getDb();
  const rows = db.prepare(`SELECT platform, username, profile_json, connected_at, updated_at FROM platform_credentials`).all();
  const byPlatform = Object.fromEntries(rows.map((r) => [r.platform, {
    connected: r.profile_json != null,
    saved: true,
    username: r.username,
    profile: r.profile_json ? JSON.parse(r.profile_json) : null,
    connectedAt: r.connected_at,
    updatedAt: r.updated_at,
  }]));
  res.json({
    cults3d:       byPlatform.cults3d       ?? { connected: false },
    myminifactory: byPlatform.myminifactory ?? { connected: false },
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CULTS 3D
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/cults3d', connectRoute('cults3d', cults.getProfile));

router.delete('/cults3d', disconnectRoute('cults3d'));

router.get('/cults3d/profile', wrapAsync(async (req, res) => {
  const { username, api_key } = getCreds('cults3d');
  const profile = await cults.getProfile(username, api_key);
  saveProfile('cults3d', profile);
  res.json(profile);
}));

router.get('/cults3d/library', wrapAsync(async (req, res) => {
  const { username, api_key } = getCreds('cults3d');
  const { limit = 24, offset = 0 } = req.query;
  const data = await cults.getLibrary(username, api_key, {
    limit:  Math.min(Number(limit),  100),
    offset: Number(offset),
  });
  res.json(data);
}));

router.get('/cults3d/search', wrapAsync(async (req, res) => {
  const { username, api_key } = getCreds('cults3d');
  const { q, limit = 24, offset = 0 } = req.query;
  if (!q?.trim()) return res.json([]);
  const results = await cults.searchCreations(q.trim(), username, api_key, {
    limit:  Math.min(Number(limit),  100),
    offset: Number(offset),
  });
  res.json(results);
}));

router.get('/cults3d/creation/:slug(*)', wrapAsync(async (req, res) => {
  const { username, api_key } = getCreds('cults3d');
  const creation = await cults.getCreation(req.params.slug, username, api_key);
  res.json(creation);
}));

// ═══════════════════════════════════════════════════════════════════════════════
// MY MINI FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

router.post('/myminifactory', connectRoute('myminifactory', mmf.getProfile));

router.delete('/myminifactory', disconnectRoute('myminifactory'));

router.get('/myminifactory/profile', wrapAsync(async (req, res) => {
  const { username, api_key } = getCreds('myminifactory');
  const profile = await mmf.getProfile(username, api_key);
  saveProfile('myminifactory', profile);
  res.json(profile);
}));

router.get('/myminifactory/library', wrapAsync(async (req, res) => {
  const { username, api_key } = getCreds('myminifactory');
  const { page = 1, perPage = 24 } = req.query;
  const data = await mmf.getUserObjects(username, api_key, {
    page:    Number(page),
    perPage: Math.min(Number(perPage), 100),
  });
  res.json(data);
}));

router.get('/myminifactory/search', wrapAsync(async (req, res) => {
  const { username, api_key } = getCreds('myminifactory');
  const { q, page = 1, perPage = 24 } = req.query;
  if (!q?.trim()) return res.json({ items: [], total_count: 0 });
  const data = await mmf.searchObjects(q.trim(), username, api_key, {
    page:    Number(page),
    perPage: Math.min(Number(perPage), 100),
  });
  res.json(data);
}));

router.get('/myminifactory/object/:id', wrapAsync(async (req, res) => {
  const { username, api_key } = getCreds('myminifactory');
  const obj = await mmf.getObject(req.params.id, username, api_key);
  res.json(obj);
}));

export default router;
