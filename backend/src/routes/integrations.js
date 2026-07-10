import { Router } from 'express';
import { getDb } from '../db/schema.js';
import * as cults from '../services/cults.js';
import * as mmf   from '../services/mmf.js';

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function getCreds(platform) {
  const row = getDb().prepare(`SELECT username, api_key FROM platform_credentials WHERE platform = ?`).get(platform);
  if (!row) throw Object.assign(new Error(`${platform} not connected`), { status: 401 });
  return row;
}

function saveProfile(platform, profile) {
  getDb().prepare(`
    UPDATE platform_credentials SET profile_json = ?, updated_at = datetime('now') WHERE platform = ?
  `).run(JSON.stringify(profile), platform);
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
    connected: true,
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

router.post('/cults3d', wrapAsync(async (req, res) => {
  const { username, apiKey } = req.body;
  if (!username?.trim() || !apiKey?.trim()) {
    return res.status(400).json({ error: 'username and apiKey are required' });
  }

  // Verify credentials by fetching profile
  const profile = await cults.getProfile(username.trim(), apiKey.trim());

  const db = getDb();
  db.prepare(`
    INSERT INTO platform_credentials (platform, username, api_key, profile_json)
    VALUES ('cults3d', ?, ?, ?)
    ON CONFLICT(platform) DO UPDATE SET
      username     = excluded.username,
      api_key      = excluded.api_key,
      profile_json = excluded.profile_json,
      updated_at   = datetime('now')
  `).run(username.trim(), apiKey.trim(), JSON.stringify(profile));

  res.json({ ok: true, profile });
}));

router.delete('/cults3d', (req, res) => {
  getDb().prepare(`DELETE FROM platform_credentials WHERE platform = 'cults3d'`).run();
  res.json({ ok: true });
});

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

router.post('/myminifactory', wrapAsync(async (req, res) => {
  const { username, apiKey } = req.body;
  if (!username?.trim() || !apiKey?.trim()) {
    return res.status(400).json({ error: 'username and apiKey are required' });
  }

  const profile = await mmf.getProfile(username.trim(), apiKey.trim());

  const db = getDb();
  db.prepare(`
    INSERT INTO platform_credentials (platform, username, api_key, profile_json)
    VALUES ('myminifactory', ?, ?, ?)
    ON CONFLICT(platform) DO UPDATE SET
      username     = excluded.username,
      api_key      = excluded.api_key,
      profile_json = excluded.profile_json,
      updated_at   = datetime('now')
  `).run(username.trim(), apiKey.trim(), JSON.stringify(profile));

  res.json({ ok: true, profile });
}));

router.delete('/myminifactory', (req, res) => {
  getDb().prepare(`DELETE FROM platform_credentials WHERE platform = 'myminifactory'`).run();
  res.json({ ok: true });
});

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
