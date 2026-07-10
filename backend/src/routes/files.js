import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getDb } from '../db/schema.js';
import { getSiblingImages, getWatcherStatus } from '../services/scanner.js';
import { extractToCache, decodeZipPath } from '../services/zipScanner.js';
import { getPendingCount, queueAll } from '../services/thumbnailer.js';

const router = Router();
const STL_ROOT = process.env.STL_ROOT || '/nas';

router.get('/', (req, res) => {
  const db = getDb();
  const { search, tag, collection, page = 1, limit = 48 } = req.query;
  const offset = (page - 1) * limit;

  let query = `
    SELECT f.*,
      GROUP_CONCAT(DISTINCT t.name) as tag_names,
      GROUP_CONCAT(DISTINCT t.id || ':' || t.color) as tag_data
    FROM files f
    LEFT JOIN file_tags ft ON ft.file_id = f.id
    LEFT JOIN tags t ON t.id = ft.tag_id
  `;
  const params = [];
  const where = [];

  if (search) {
    where.push(`f.name LIKE ?`);
    params.push(`%${search}%`);
  }
  if (tag) {
    where.push(`f.id IN (SELECT file_id FROM file_tags ft2 JOIN tags t2 ON t2.id = ft2.tag_id WHERE t2.name = ?)`);
    params.push(tag);
  }
  if (collection) {
    where.push(`f.id IN (SELECT file_id FROM collection_files WHERE collection_id = ?)`);
    params.push(collection);
  }

  if (where.length) query += ` WHERE ${where.join(' AND ')}`;
  query += ` GROUP BY f.id ORDER BY f.name LIMIT ? OFFSET ?`;
  params.push(Number(limit), offset);

  const files = db.prepare(query).all(...params);
  const total = db.prepare(`SELECT COUNT(DISTINCT f.id) as n FROM files f ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`).get(...params.slice(0, -2)).n;

  res.json({ files: files.map(formatFile), total, page: Number(page), limit: Number(limit) });
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const file = db.prepare(`SELECT * FROM files WHERE id = ?`).get(req.params.id);
  if (!file) return res.status(404).json({ error: 'Not found' });

  const tags    = db.prepare(`SELECT t.* FROM tags t JOIN file_tags ft ON ft.tag_id = t.id WHERE ft.file_id = ?`).all(req.params.id);
  const origins = db.prepare(`SELECT * FROM origins WHERE file_id = ?`).all(req.params.id);
  const images  = getSiblingImages(file.path);

  res.json({
    ...formatFile(file),
    tags,
    origins,
    images: images.map((p) => `/api/files/${req.params.id}/image?path=${encodeURIComponent(p)}`),
  });
});

router.get('/:id/stl', async (req, res) => {
  const db = getDb();
  const file = db.prepare(`SELECT path, zip_source, zip_entry FROM files WHERE id = ?`).get(req.params.id);
  if (!file) return res.status(404).end();

  if (file.zip_source) {
    // Extract from zip to local cache on first access; serve from cache thereafter
    if (!fs.existsSync(file.zip_source)) return res.status(404).end();
    const cachePath = await extractToCache(file.zip_source, file.zip_entry);
    return res.sendFile(cachePath);
  }

  if (!fs.existsSync(file.path)) return res.status(404).end();
  res.sendFile(file.path);
});

router.get('/:id/image', (req, res) => {
  const imgPath = req.query.path;
  if (!imgPath || !imgPath.startsWith(STL_ROOT)) return res.status(403).end();
  if (!fs.existsSync(imgPath)) return res.status(404).end();
  res.sendFile(imgPath);
});

router.patch('/:id', (req, res) => {
  const db = getDb();
  const { notes } = req.body;
  db.prepare(`UPDATE files SET notes = ?, updated_at = datetime('now') WHERE id = ?`).run(notes, req.params.id);
  res.json({ ok: true });
});

router.get('/watcher', (req, res) => res.json({ ...getWatcherStatus(), thumbPending: getPendingCount() }));

// Serve the pre-generated thumbnail JPEG for a file
router.get('/:id/thumb', (req, res) => {
  const db   = getDb();
  const file = db.prepare(`SELECT thumbnail_path FROM files WHERE id = ?`).get(req.params.id);
  if (!file?.thumbnail_path || !fs.existsSync(file.thumbnail_path)) return res.status(404).end();
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(file.thumbnail_path);
});

// Enqueue thumbnail generation for all files that don't have one yet
router.post('/thumbs/generate', (req, res) => {
  const queued = queueAll();
  res.json({ queued });
});

router.post('/:id/tags', (req, res) => {
  const db = getDb();
  const { tagId } = req.body;
  db.prepare(`INSERT OR IGNORE INTO file_tags (file_id, tag_id) VALUES (?, ?)`).run(req.params.id, tagId);
  res.json({ ok: true });
});

router.delete('/:id/tags/:tagId', (req, res) => {
  const db = getDb();
  db.prepare(`DELETE FROM file_tags WHERE file_id = ? AND tag_id = ?`).run(req.params.id, req.params.tagId);
  res.json({ ok: true });
});

function formatFile(f) {
  return {
    id: f.id,
    path: f.path,
    name: f.name,
    size: f.size,
    modifiedAt: f.modified_at,
    notes: f.notes,
    thumbnailPath: f.thumbnail_path,
    createdAt: f.created_at,
    inZip: !!f.zip_source,
    zipSource: f.zip_source ? path.basename(f.zip_source) : null,
  };
}

export default router;
