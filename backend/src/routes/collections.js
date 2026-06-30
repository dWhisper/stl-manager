import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const collections = db.prepare(`
    SELECT c.*, COUNT(cf.file_id) as file_count
    FROM collections c
    LEFT JOIN collection_files cf ON cf.collection_id = c.id
    GROUP BY c.id
    ORDER BY c.name
  `).all();
  res.json(collections);
});

router.post('/', (req, res) => {
  const db = getDb();
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = randomUUID();
  db.prepare(`INSERT INTO collections (id, name, description) VALUES (?, ?, ?)`).run(id, name.trim(), description || null);
  res.json(db.prepare(`SELECT * FROM collections WHERE id = ?`).get(id));
});

router.patch('/:id', (req, res) => {
  const db = getDb();
  const { name, description } = req.body;
  if (name) db.prepare(`UPDATE collections SET name = ? WHERE id = ?`).run(name.trim(), req.params.id);
  if (description !== undefined) db.prepare(`UPDATE collections SET description = ? WHERE id = ?`).run(description, req.params.id);
  res.json(db.prepare(`SELECT * FROM collections WHERE id = ?`).get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare(`DELETE FROM collections WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

router.post('/:id/files', (req, res) => {
  const db = getDb();
  const { fileId } = req.body;
  db.prepare(`INSERT OR IGNORE INTO collection_files (collection_id, file_id) VALUES (?, ?)`).run(req.params.id, fileId);
  res.json({ ok: true });
});

router.delete('/:id/files/:fileId', (req, res) => {
  const db = getDb();
  db.prepare(`DELETE FROM collection_files WHERE collection_id = ? AND file_id = ?`).run(req.params.id, req.params.fileId);
  res.json({ ok: true });
});

export default router;
