import { Router } from 'express';
import path from 'path';
import { getDb } from '../db/schema.js';

const router = Router();

// Patterns matched at the END of the stem (after removing extension),
// preceded by a separator character. Checked in order: unsupported first
// so "unsupported" doesn't accidentally match the "supported" branch.
const UNSUPPORTED_RE = /[-_\s\[\(]+(unsupported|unsup)[\s\]\)]*$/i;
const SUPPORTED_RE   = /[-_\s\[\(]+(pre[-_\s]?supported|presupported|supported|sup)[\s\]\)]*$/i;
const EITHER_RE      = /[-_\s\[\(]+(unsupported|unsup|pre[-_\s]?supported|presupported|supported|sup)[\s\]\)]*$/i;

function stem(filename) {
  return filename.replace(/\.[^.]+$/, '');
}

function detectSupportState(filename) {
  const s = stem(filename);
  if (UNSUPPORTED_RE.test(s)) return 'unsupported';
  if (SUPPORTED_RE.test(s))   return 'supported';
  return null;
}

// Strip support suffixes and lowercase — produces the grouping key.
function normalizedName(filename) {
  return stem(filename).replace(EITHER_RE, '').replace(/[-_]+$/, '').trim().toLowerCase();
}

// "Directory" used for locality checks.
// Zip entries are considered local to their zip file, not to the zip's parent folder.
function fileDir(row) {
  return row.zip_source ?? path.dirname(row.path);
}

router.get('/', (req, res) => {
  const q = (req.query.q ?? '').trim();
  if (q.length < 2) return res.json({ query: q, groups: [], total: 0 });

  const db = getDb();
  const rows = db.prepare(`
    SELECT f.*,
      GROUP_CONCAT(DISTINCT t.name) as tag_names,
      GROUP_CONCAT(DISTINCT t.id || ':' || t.color) as tag_data
    FROM files f
    LEFT JOIN file_tags ft ON ft.file_id = f.id
    LEFT JOIN tags t       ON t.id = ft.tag_id
    WHERE f.name LIKE ?
    GROUP BY f.id
    ORDER BY f.name
    LIMIT 200
  `).all(`%${q}%`);

  // Annotate every row
  const annotated = rows.map((f) => {
    const state = detectSupportState(f.name);
    const norm  = normalizedName(f.name);
    const dir   = fileDir(f);
    const tagNames = f.tag_names ? f.tag_names.split(',').filter(Boolean) : [];
    const tagColors = {};
    if (f.tag_data) {
      for (const t of f.tag_data.split(',')) {
        const sep = t.lastIndexOf(':');
        tagColors[t.slice(0, sep)] = t.slice(sep + 1);
      }
    }
    return {
      id: f.id, name: f.name, path: f.path, size: f.size,
      modifiedAt: f.modified_at, notes: f.notes,
      inZip: !!f.zip_source,
      zipSource: f.zip_source ? path.basename(f.zip_source) : null,
      createdAt: f.created_at,
      tagNames, tagColors,
      supportState: state,
      normalizedName: norm,
      dir,
    };
  });

  // Group by normalizedName
  const groupMap = new Map();
  for (const f of annotated) {
    const key = f.normalizedName;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(f);
  }

  const groups = [];
  for (const [norm, files] of groupMap) {
    const states  = files.map((f) => f.supportState);
    const stateSet = new Set(states);

    // Support pair: has at least one "supported" AND one "unsupported" (or one unlabeled neutral)
    const hasSupportedVariant   = stateSet.has('supported');
    const hasUnsupportedVariant = stateSet.has('unsupported') || stateSet.has(null);
    const hasSupportPair = hasSupportedVariant && hasUnsupportedVariant && files.length >= 2;

    // True duplicates: multiple files with the same support-state in the same directory
    const seenDirState = new Map();
    let hasDuplicates = false;
    for (const f of files) {
      const key = `${f.dir}|${f.supportState ?? '_'}`;
      seenDirState.set(key, (seenDirState.get(key) ?? 0) + 1);
      if (seenDirState.get(key) > 1) hasDuplicates = true;
    }

    // Cross-directory: same base name appears in more than one location, without being a support pair
    const dirs = new Set(files.map((f) => f.dir));
    const hasCrossDir = dirs.size > 1 && !hasSupportPair && !hasDuplicates;

    groups.push({ normalizedName: norm, files, flags: { hasSupportPair, hasDuplicates, hasCrossDir } });
  }

  // Flagged groups first, then alphabetical
  groups.sort((a, b) => {
    const aF = Object.values(a.flags).some(Boolean);
    const bF = Object.values(b.flags).some(Boolean);
    if (aF !== bF) return aF ? -1 : 1;
    return a.normalizedName.localeCompare(b.normalizedName);
  });

  res.json({ query: q, groups, total: rows.length });
});

export default router;
