import { Router } from 'express';
import { getDb } from '../db/schema.js';
import { listFolder, getModel, folderTree, findNodes } from '../services/library.js';
import { prioritizeThumbnails } from '../services/thumbnailer.js';
import { formatFile } from './files.js';

const router = Router();

// Folder contents: sub-folders and models, paginated
router.get('/folder', (req, res) => {
  const page  = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 96, 1), 500);
  const result = listFolder(req.query.path ?? '', { page, limit });
  if (!result) return res.status(404).json({ error: 'Folder not found' });
  if (result.wanted) {
    prioritizeThumbnails(result.wanted);
    delete result.wanted;
  }
  res.json(result);
});

// One model: all its files, labelled with the variant folders they came from
router.get('/model', (req, res) => {
  const model = getModel(req.query.path ?? '');
  if (!model) return res.status(404).json({ error: 'Model not found' });

  const db = getDb();
  const rows = new Map();
  const ids = model.files.map((f) => f.id);
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const found = db.prepare(`
      SELECT f.*,
        GROUP_CONCAT(DISTINCT t.name) as tag_names,
        GROUP_CONCAT(DISTINCT t.id || ':' || t.color) as tag_data
      FROM files f
      LEFT JOIN file_tags ft ON ft.file_id = f.id
      LEFT JOIN tags t ON t.id = ft.tag_id
      WHERE f.id IN (${chunk.map(() => '?').join(',')})
      GROUP BY f.id
    `).all(...chunk);
    for (const r of found) rows.set(r.id, r);
  }

  const files = model.files
    .filter((f) => rows.has(f.id))
    .map((f) => ({ ...formatFile(rows.get(f.id)), sub: f.sub }));

  prioritizeThumbnails(
    files.filter((f) => !f.thumbnailPath && !f.thumbError && /\.stl$/i.test(f.name)).map((f) => f.id)
  );
  res.json({ ...model, files });
});

router.get('/tree', (req, res) => {
  const children = folderTree(req.query.path ?? '');
  if (!children) return res.status(404).json({ error: 'Folder not found' });
  res.json(children);
});

// Folders and models by name, for picking a link target
router.get('/find', (req, res) => {
  res.json(findNodes(req.query.q ?? '', Math.min(Number(req.query.limit) || 20, 100)));
});

export default router;
