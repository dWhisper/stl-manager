import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { SOURCES } from './origins.js';
import { invalidate } from '../services/reconcile.js';

// Where a library folder or model came from: Patreon, Printables, a Cults
// purchase... Links made from the Purchases page show up here too.
const router = Router();

const isSource = (id) => SOURCES.some((s) => s.id === id);

router.get('/', (req, res) => {
  const rows = getDb().prepare(`
    SELECT l.*, p.download_url
    FROM model_links l
    LEFT JOIN purchases p ON p.platform = l.source AND p.external_id = l.external_id
    WHERE l.model_path = ?
    ORDER BY l.created_at
  `).all(req.query.path ?? '');
  res.json(rows);
});

router.post('/', (req, res) => {
  const { path, source, url, externalName, externalAuthor } = req.body;
  if (!path || !isSource(source)) return res.status(400).json({ error: 'path and a known source are required' });
  if (!url?.trim() && !externalName?.trim()) return res.status(400).json({ error: 'Give a URL or a name' });
  const id = randomUUID();
  const db = getDb();
  db.prepare(`
    INSERT INTO model_links (id, model_path, source, url, external_name, external_author)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, path, source, url?.trim() || null, externalName?.trim() || null, externalAuthor?.trim() || null);
  res.json(db.prepare(`SELECT * FROM model_links WHERE id = ?`).get(id));
});

router.patch('/:id', (req, res) => {
  const { source, url, externalName, externalAuthor } = req.body;
  if (source !== undefined && !isSource(source)) return res.status(400).json({ error: 'Unknown source' });
  const db = getDb();
  // Purchase links keep their source; their URL comes from the platform
  db.prepare(`
    UPDATE model_links SET
      source          = CASE WHEN external_id IS NULL THEN COALESCE(?, source) ELSE source END,
      url             = COALESCE(?, url),
      external_name   = COALESCE(?, external_name),
      external_author = COALESCE(?, external_author)
    WHERE id = ?
  `).run(source ?? null, url?.trim() ?? null, externalName?.trim() ?? null, externalAuthor?.trim() ?? null, req.params.id);
  const row = db.prepare(`SELECT * FROM model_links WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Link not found' });
  res.json(row);
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare(`SELECT external_id FROM model_links WHERE id = ?`).get(req.params.id);
  db.prepare(`DELETE FROM model_links WHERE id = ?`).run(req.params.id);
  // Removing a purchase link changes what the Purchases page shows
  if (row?.external_id) invalidate();
  res.json({ ok: true });
});

export default router;
