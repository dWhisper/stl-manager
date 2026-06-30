import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';

const router = Router();

export const SOURCES = [
  { id: 'cults3d', label: 'Cults 3D', baseUrl: 'https://cults3d.com' },
  { id: 'myminifactory', label: 'MyMiniFactory', baseUrl: 'https://www.myminifactory.com' },
  { id: 'patreon', label: 'Patreon', baseUrl: 'https://www.patreon.com' },
  { id: 'printables', label: 'Printables', baseUrl: 'https://www.printables.com' },
  { id: 'thingiverse', label: 'Thingiverse', baseUrl: 'https://www.thingiverse.com' },
  { id: 'thangs', label: 'Thangs', baseUrl: 'https://thangs.com' },
  { id: 'cgtrader', label: 'CGTrader', baseUrl: 'https://www.cgtrader.com' },
  { id: 'other', label: 'Other', baseUrl: null },
];

router.get('/sources', (req, res) => res.json(SOURCES));

router.post('/', (req, res) => {
  const db = getDb();
  const { fileId, source, url, externalName, externalAuthor } = req.body;
  if (!fileId || !source) return res.status(400).json({ error: 'fileId and source required' });
  const id = randomUUID();
  db.prepare(`
    INSERT INTO origins (id, file_id, source, url, external_name, external_author)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, fileId, source, url || null, externalName || null, externalAuthor || null);
  res.json(db.prepare(`SELECT * FROM origins WHERE id = ?`).get(id));
});

router.patch('/:id', (req, res) => {
  const db = getDb();
  const { url, externalName, externalAuthor } = req.body;
  db.prepare(`
    UPDATE origins SET url = COALESCE(?, url), external_name = COALESCE(?, external_name),
    external_author = COALESCE(?, external_author) WHERE id = ?
  `).run(url ?? null, externalName ?? null, externalAuthor ?? null, req.params.id);
  res.json(db.prepare(`SELECT * FROM origins WHERE id = ?`).get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare(`DELETE FROM origins WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

export default router;
