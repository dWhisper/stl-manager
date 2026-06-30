import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const tags = db.prepare(`
    SELECT t.*, COUNT(ft.file_id) as file_count
    FROM tags t
    LEFT JOIN file_tags ft ON ft.tag_id = t.id
    GROUP BY t.id
    ORDER BY t.name
  `).all();
  res.json(tags);
});

router.post('/', (req, res) => {
  const db = getDb();
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = randomUUID();
  db.prepare(`INSERT INTO tags (id, name, color) VALUES (?, ?, ?)`).run(id, name.trim(), color || '#6366f1');
  res.json(db.prepare(`SELECT * FROM tags WHERE id = ?`).get(id));
});

router.patch('/:id', (req, res) => {
  const db = getDb();
  const { name, color } = req.body;
  if (name) db.prepare(`UPDATE tags SET name = ? WHERE id = ?`).run(name.trim(), req.params.id);
  if (color) db.prepare(`UPDATE tags SET color = ? WHERE id = ?`).run(color, req.params.id);
  res.json(db.prepare(`SELECT * FROM tags WHERE id = ?`).get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare(`DELETE FROM tags WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

export default router;
