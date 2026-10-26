import path from 'path';
import { getDb } from '../db/schema.js';

const STL_ROOT = process.env.STL_ROOT || '/nas';
// How often a request may re-check the files table for added/removed rows
const RECHECK_MS = 15_000;

// Folder names that hold a variant of one model (support style, scale, fill...).
// These fold into their parent folder and show up as chips on the model card.
// Names are normalized first: lowercase, "_" and "-" runs become single spaces.
const VARIANT = [
  /^(pre ?|new ?)?(un|no ?)?support(s|ed)?( stls?| files)?$/,   // Supported, No Supports, Pre-Supported
  /^(hollow(ed)?|solid)( parts?)?( for (resin|fdm))?$/,
  /^\d+(\.\d+)? ?mm( scale)?$/,                             // 32mm, 75mm
  /^(single|double|triple|trible|quadruple|quintuple|freescale|combined|separated|pre ?separated|split|unsplit|cut|uncut|beefed|resin|fdm|user ?friendly|ready ?to ?slice|destroyed|intact)$/,
  /^pre ?cut\b/,                                           // Pre-cut for smaller printers
  /^stls? .+/,                                             // STL - Cut + Supported
];
// Folder names that hold pieces of one model; they fold silently
const PART = /^(stls?|files|models?|obj|3mf|parts?|pieces|bits|images|renders|arms?|heads?|legs?|torsos?|body|bodies|helmets?|weapons?|shoulders?|tabards?|accessories|accesories|bases?|options?|poses?( \d+)?|batch files|lychee|chitubox)$/;

const normalize = (name) => name.toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
const isVariant = (name) => VARIANT.some((re) => re.test(normalize(name)));
const isFoldable = (name) => isVariant(name) || PART.test(normalize(name));

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const byName = (a, b) => collator.compare(a.name, b.name);

let index = null;
let signature = null;
let checkedAt = 0;

function newNode(nodePath, name, parent) {
  return {
    path: nodePath, name, parent,
    children: new Map(), isZip: false,
    files: [],            // files that fold into this folder as its model
    variants: new Map(),  // variant folder name -> file count
    fileCount: 0, modelCount: 0,
  };
}

// Path inside the library, with a zip treated as a folder: "Creator/Pack.zip/Model/x.stl"
export function logicalPath(row) {
  const rel = (p) => (p.startsWith(STL_ROOT + '/') ? p.slice(STL_ROOT.length + 1) : p);
  return row.zip_source ? `${rel(row.zip_source)}/${row.zip_entry}` : rel(row.path);
}

function buildIndex() {
  const started = Date.now();
  const rows = getDb().prepare(`SELECT id, path, name, size, zip_source, zip_entry FROM files`).all();
  const root  = newNode('', 'Library', null);
  const nodes = new Map([['', root]]);
  const modelOf = new Map();  // file id -> path of the model it folds into

  for (const row of rows) {
    const segs = logicalPath(row).split('/').filter(Boolean);
    const dirs = segs.slice(0, -1);
    // Never fold a model above its zip, or into the library root
    const zipDepth = row.zip_source ? logicalPath({ path: row.zip_source }).split('/').length : 0;

    let node = root;
    for (let i = 0; i < dirs.length; i++) {
      let child = node.children.get(dirs[i]);
      if (!child) {
        child = newNode(dirs.slice(0, i + 1).join('/'), dirs[i], node);
        node.children.set(dirs[i], child);
        nodes.set(child.path, child);
      }
      if (i === zipDepth - 1) child.isZip = true;
      node = child;
    }

    let depth = dirs.length;
    const folded = [];
    while (depth > Math.max(1, zipDepth) && isFoldable(dirs[depth - 1])) folded.unshift(dirs[--depth]);
    const model = nodes.get(dirs.slice(0, depth).join('/'));
    modelOf.set(row.id, model.path);

    const sub = folded.join('/');
    const supported = /support/i.test(`${sub}/${row.name}`) && !/(un|no)[ _-]?support/i.test(`${sub}/${row.name}`);
    model.files.push({ id: row.id, size: row.size ?? 0, stl: /\.stl$/i.test(row.name), sub, supported });
    for (const name of folded) {
      if (isVariant(name)) model.variants.set(name, (model.variants.get(name) ?? 0) + 1);
    }
  }

  // Post-order: subtree counts, sorted children and cover candidates
  (function finish(node) {
    node.sorted = [...node.children.values()].sort(byName);
    for (const child of node.sorted) finish(child);
    node.fileCount  = node.files.length + node.sorted.reduce((n, c) => n + c.fileCount, 0);
    node.modelCount = (node.files.length ? 1 : 0) + node.sorted.reduce((n, c) => n + c.modelCount, 0);
    // Prefer unsupported files (support scaffolding hides the model), then the
    // biggest, which is usually the main body
    node.cover = node.files.filter((f) => f.stl)
      .sort((a, b) => a.supported - b.supported || b.size - a.size)
      .slice(0, 3).map((f) => f.id);
  })(root);

  console.log(`Library index: ${nodes.size} folders, ${root.modelCount} models (${Date.now() - started}ms)`);
  return { root, nodes, modelOf };
}

function getIndex() {
  const now = Date.now();
  if (index && now - checkedAt < RECHECK_MS) return index;
  checkedAt = now;
  // Rows are only ever inserted or deleted by path, so count + newest insert detects changes
  const { n, c } = getDb().prepare(`SELECT COUNT(*) n, MAX(created_at) c FROM files`).get();
  const sig = `${n}|${c}`;
  if (!index || sig !== signature) {
    index = buildIndex();
    signature = sig;
  }
  return index;
}

// A folder whose whole subtree is one model is shown as that model
function soleModel(node) {
  while (!node.files.length && node.sorted.length === 1) node = node.sorted[0];
  return node;
}

function crumbs(node) {
  const out = [];
  for (let n = node; n; n = n.parent) out.unshift({ name: n.name, path: n.path });
  return out;
}

function topVariants(node, max = 6) {
  return [...node.variants].sort((a, b) => b[1] - a[1]).slice(0, max).map(([name]) => name);
}

// Up to `max` models from a subtree, one per child first so mosaics show variety
function sampleModels(node, max) {
  const out = node.files.length ? [node] : [];
  for (const child of node.sorted) {
    if (out.length >= max) break;
    const m = soleModel(child);
    if (m.files.length) out.push(m);
    else out.push(...sampleModels(child, 1));
  }
  return out.slice(0, max);
}

function modelItem(node, self = false) {
  return {
    type: 'model', path: node.path, name: node.name, isZip: node.isZip, self,
    fileCount: node.files.length, variants: topVariants(node), candidates: [node.cover],
  };
}

function folderItem(node) {
  return {
    type: 'folder', path: node.path, name: node.name, isZip: node.isZip,
    modelCount: node.modelCount, fileCount: node.fileCount,
    candidates: sampleModels(node, 4).map((m) => m.cover),
  };
}

// Swap each item's cover candidates for the thumbnails that exist, and report
// the ones still worth generating so the caller can move them up the queue.
function attachPreviews(items) {
  const ids = [...new Set(items.flatMap((i) => i.candidates.flat()))];
  const state = new Map();
  const db = getDb();
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const rows = db.prepare(
      `SELECT id, thumbnail_path, thumb_error, updated_at FROM files WHERE id IN (${chunk.map(() => '?').join(',')})`
    ).all(...chunk);
    for (const r of rows) state.set(r.id, r);
  }

  const wanted = [];
  for (const item of items) {
    item.previews = [];
    item.pending = false;
    for (const group of item.candidates) {
      const rows  = group.map((id) => state.get(id)).filter(Boolean);
      const ready = rows.find((r) => r.thumbnail_path);
      // Best-ranked candidate that can still be rendered and isn't yet
      const next  = rows.find((r) => r.thumbnail_path || !r.thumb_error);
      if (next && !next.thumbnail_path) wanted.push(next.id);
      if (ready) item.previews.push({ id: ready.id, version: ready.updated_at });
      else if (next) item.pending = true;
    }
    delete item.candidates;
  }
  return wanted;
}

export function listFolder(folderPath, { page = 1, limit = 96 } = {}) {
  const { nodes } = getIndex();
  const node = nodes.get(folderPath);
  if (!node) return null;

  // A folder that is just one model opens as that model
  const sole = soleModel(node);
  if (sole.files.length && sole.modelCount === 1) return { modelPath: sole.path };

  const all = [];
  if (node.files.length) all.push(modelItem(node, true));
  for (const child of node.sorted) {
    const m = soleModel(child);
    // Skip single-folder chains (e.g. a zip whose only entry is a folder) but keep the visible name
    all.push(m.modelCount === 1 && m.files.length ? modelItem(m) : { ...folderItem(m), name: child.name });
  }

  const items = all.slice((page - 1) * limit, page * limit);
  const wanted = attachPreviews(items);
  return {
    path: node.path, name: node.name, isZip: node.isZip, crumbs: crumbs(node),
    modelCount: node.modelCount, fileCount: node.fileCount,
    items, total: all.length, page, limit, wanted,
  };
}

export function getModel(modelPath) {
  const { nodes } = getIndex();
  const node = nodes.get(modelPath);
  if (!node?.files.length) return null;
  return {
    path: node.path, name: node.name, isZip: node.isZip, crumbs: crumbs(node),
    variants: topVariants(node, 50),
    files: node.files.map(({ id, sub }) => ({ id, sub })),
  };
}

// Folder-only children for the sidebar tree
export function folderTree(folderPath) {
  const { nodes } = getIndex();
  const node = nodes.get(folderPath);
  if (!node) return null;
  const isFolder = (n) => soleModel(n).modelCount > 1;
  return node.sorted.filter(isFolder).map((c) => ({
    path: c.path, name: c.name, isZip: c.isZip, modelCount: c.modelCount,
    hasChildren: c.sorted.some(isFolder),
  }));
}

// The whole index, for services that match against it (see reconcile.js).
// A new object is returned whenever the library changes.
export function libraryIndex() {
  return getIndex();
}

// What a stored path points at now: a model, a folder of models, or null if it's gone
export function describePath(nodePath) {
  const node = getIndex().nodes.get(nodePath);
  if (!node || !node.fileCount) return null;
  const sole = soleModel(node);
  const isModel = sole.files.length > 0 && sole.modelCount === 1;
  return {
    path: node.path, name: node.name.replace(/\.zip$/i, ''), isZip: node.isZip,
    kind: isModel ? 'model' : 'folder',
    modelCount: node.modelCount, fileCount: node.fileCount,
    parent: node.parent?.path ? node.parent.path : null,
  };
}

// Folders and models whose names share the most words with the query. At least
// half the words must appear, so a whole purchase name still finds its folder.
export function findNodes(query, limit = 20) {
  const words = [...new Set(normalize(query).split(' ').filter((w) => w.length > 1))];
  if (!words.length) return [];
  const needed = Math.ceil(words.length / 2);
  const hits = [];
  for (const node of getIndex().nodes.values()) {
    if (!node.path || !node.fileCount) continue;
    const name = normalize(node.name);
    const matched = words.filter((w) => name.includes(w)).length;
    if (matched < needed) continue;
    hits.push({ node, matched, length: name.length });
  }
  return hits
    // Most words first; then shorter names and smaller subtrees
    .sort((a, b) => b.matched - a.matched || a.length - b.length || a.node.modelCount - b.node.modelCount)
    .slice(0, limit)
    .map((h) => describePath(h.node.path));
}

export const _test = { isVariant, isFoldable, logicalPath };
