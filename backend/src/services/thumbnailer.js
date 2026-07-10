import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { getDb } from '../db/schema.js';
import { extractToCache } from './zipScanner.js';

const THUMB_DIR  = process.env.THUMB_DIR  || '/data/thumbnails';
const THUMB_SIZE = 256;
const MAX_TRIS   = 80_000; // sample large meshes — enough detail for a 256px thumb

// ── Queue ─────────────────────────────────────────────────────────────────────

const queue = new Set();
let processing = false;

export function queueThumbnail(fileId) {
  queue.add(fileId);
  if (!processing) drainQueue();
}

export function queueAll() {
  const db = getDb();
  const rows = db.prepare(`SELECT id FROM files WHERE thumbnail_path IS NULL`).all();
  for (const r of rows) queue.add(r.id);
  if (!processing) drainQueue();
  return rows.length;
}

export function getPendingCount() {
  return queue.size + (processing ? 1 : 0);
}

async function drainQueue() {
  if (queue.size === 0) return;
  processing = true;
  const [id] = queue;          // first element of a Set
  queue.delete(id);
  try {
    await generateThumbnail(id);
  } catch (e) {
    console.error(`Thumb failed [${id}]: ${e.message}`);
  }
  processing = false;
  setImmediate(drainQueue);    // yield to event loop between each file
}

// ── Generator ─────────────────────────────────────────────────────────────────

async function generateThumbnail(fileId) {
  const db  = getDb();
  const row = db.prepare(`SELECT path, name, zip_source, zip_entry FROM files WHERE id = ?`).get(fileId);
  if (!row) return;

  const ext = path.extname(row.zip_entry ?? row.name).toLowerCase();
  if (ext !== '.stl') return; // 3MF / OBJ parsers TODO

  let stlPath = row.path;
  if (row.zip_source) {
    if (!fs.existsSync(row.zip_source)) return;
    stlPath = await extractToCache(row.zip_source, row.zip_entry);
  } else {
    if (!fs.existsSync(stlPath)) return;
  }

  fs.mkdirSync(THUMB_DIR, { recursive: true });
  const thumbPath = path.join(THUMB_DIR, `${fileId}.jpg`);

  const buf  = fs.readFileSync(stlPath);
  const mesh = parseSTL(buf);
  if (mesh.count === 0) return;

  const rgba = renderMesh(mesh);

  await sharp(Buffer.from(rgba), {
    raw: { width: THUMB_SIZE, height: THUMB_SIZE, channels: 4 },
  })
    .jpeg({ quality: 82 })
    .toFile(thumbPath);

  db.prepare(`UPDATE files SET thumbnail_path = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(thumbPath, fileId);
}

// ── STL parser ────────────────────────────────────────────────────────────────

function parseSTL(buf) {
  if (buf.length < 84) return parseAsciiSTL(buf.toString('ascii'));
  const declaredCount = buf.readUInt32LE(80);
  // Binary STLs can start with "solid" — check if declared size fits
  if (declaredCount > 0 && 84 + declaredCount * 50 <= buf.length) {
    return parseBinarySTL(buf, declaredCount);
  }
  return parseAsciiSTL(buf.toString('ascii', 0, Math.min(buf.length, 8_000_000)));
}

function parseBinarySTL(buf, total) {
  const step = total > MAX_TRIS ? Math.ceil(total / MAX_TRIS) : 1;
  const cap   = Math.ceil(total / step);
  const nx    = new Float32Array(cap * 3);
  const vx    = new Float32Array(cap * 9);
  let n = 0;

  for (let i = 0; i < total && n < cap; i += step) {
    const o = 84 + i * 50;
    if (o + 50 > buf.length) break;
    nx[n*3]   = buf.readFloatLE(o);     nx[n*3+1] = buf.readFloatLE(o+4);  nx[n*3+2] = buf.readFloatLE(o+8);
    vx[n*9]   = buf.readFloatLE(o+12); vx[n*9+1] = buf.readFloatLE(o+16); vx[n*9+2] = buf.readFloatLE(o+20);
    vx[n*9+3] = buf.readFloatLE(o+24); vx[n*9+4] = buf.readFloatLE(o+28); vx[n*9+5] = buf.readFloatLE(o+32);
    vx[n*9+6] = buf.readFloatLE(o+36); vx[n*9+7] = buf.readFloatLE(o+40); vx[n*9+8] = buf.readFloatLE(o+44);
    n++;
  }
  return { normals: nx, verts: vx, count: n };
}

function parseAsciiSTL(text) {
  const normals = [], verts = [];
  const NR = /facet\s+normal\s+([\S]+)\s+([\S]+)\s+([\S]+)/g;
  const VR = /vertex\s+([\S]+)\s+([\S]+)\s+([\S]+)/g;
  let m;
  while ((m = NR.exec(text))) normals.push(+m[1], +m[2], +m[3]);
  while ((m = VR.exec(text))) verts.push(+m[1], +m[2], +m[3]);

  const count = Math.min(normals.length / 3, verts.length / 9, MAX_TRIS);
  const nx    = new Float32Array(normals.slice(0, count * 3));
  const vx    = new Float32Array(verts.slice(0, count * 9));
  return { normals: nx, verts: vx, count };
}

// ── Renderer ──────────────────────────────────────────────────────────────────

function renderMesh({ normals, verts, count }) {
  const W = THUMB_SIZE, H = THUMB_SIZE;

  // Bounding box
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < count * 9; i += 3) {
    if (verts[i]   < minX) minX = verts[i];   if (verts[i]   > maxX) maxX = verts[i];
    if (verts[i+1] < minY) minY = verts[i+1]; if (verts[i+1] > maxY) maxY = verts[i+1];
    if (verts[i+2] < minZ) minZ = verts[i+2]; if (verts[i+2] > maxZ) maxZ = verts[i+2];
  }

  const cx  = (minX + maxX) / 2;
  const cy  = (minY + maxY) / 2;
  const cz  = (minZ + maxZ) / 2;
  const sc  = 1.7 / Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-9);

  // Rotation: 25° elevation around X, 45° azimuth around Y
  const AZ  = 45 * (Math.PI / 180);
  const EL  = 25 * (Math.PI / 180);
  const cosA = Math.cos(AZ), sinA = Math.sin(AZ);
  const cosE = Math.cos(EL), sinE = Math.sin(EL);

  // Transform a world-space point to view space
  function xfPoint(x, y, z) {
    x = (x - cx) * sc; y = (y - cy) * sc; z = (z - cz) * sc;
    const x2 =  x * cosA + z * sinA;
    const z2 = -x * sinA + z * cosA;
    const y3 =  y * cosE - z2 * sinE;
    const z3 =  y * sinE + z2 * cosE;
    return [x2, y3, z3];
  }

  // Transform a direction (no translation/scale)
  function xfDir(dx, dy, dz) {
    const x2 =  dx * cosA + dz * sinA;
    const z2 = -dx * sinA + dz * cosA;
    const y3 =  dy * cosE - z2 * sinE;
    return [x2, y3];          // only X,Y needed for lighting
  }

  // Orthographic projection to canvas coords
  const half = W * 0.42;
  function project(x, y, z) {
    return [x * half + W * 0.5, -y * half + H * 0.5, z];
  }

  // RGBA pixel buffer — dark background
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i*4] = 15; rgba[i*4+1] = 17; rgba[i*4+2] = 26; rgba[i*4+3] = 255;
  }
  const zbuf = new Float32Array(W * H).fill(Infinity);

  // Light direction in view space (front-left-above)
  const [lx, ly] = (() => { const [a, b] = xfDir(0.5, 0.9, 0.7); const l = Math.sqrt(a*a+b*b); return [a/l, b/l]; })();

  for (let t = 0; t < count; t++) {
    const vi = t * 9, ni = t * 3;

    const p1 = project(...xfPoint(verts[vi],   verts[vi+1], verts[vi+2]));
    const p2 = project(...xfPoint(verts[vi+3], verts[vi+4], verts[vi+5]));
    const p3 = project(...xfPoint(verts[vi+6], verts[vi+7], verts[vi+8]));

    // Normal — use stored, or compute from verts if degenerate
    let dx = normals[ni], dy = normals[ni+1], dz = normals[ni+2];
    const nLen = Math.sqrt(dx*dx + dy*dy + dz*dz);
    if (nLen < 1e-9) {
      const ex = verts[vi+3]-verts[vi],   ey = verts[vi+4]-verts[vi+1], ez = verts[vi+5]-verts[vi+2];
      const fx = verts[vi+6]-verts[vi],   fy = verts[vi+7]-verts[vi+1], fz = verts[vi+8]-verts[vi+2];
      dx = ey*fz - ez*fy; dy = ez*fx - ex*fz; dz = ex*fy - ey*fx;
      const nl = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (nl < 1e-9) continue;
      dx /= nl; dy /= nl; dz /= nl;
    } else { dx /= nLen; dy /= nLen; dz /= nLen; }

    const [tnx, tny] = xfDir(dx, dy, dz);
    const diffuse    = Math.max(0, tnx * lx + tny * ly);
    const light      = 0.28 + 0.72 * diffuse;

    // Material: indigo-ish (#a5b4fc) tinted by light
    const r = Math.round(165 * light);
    const g = Math.round(180 * light);
    const b = Math.round(252 * light);

    fillTriangle(rgba, zbuf, W, H, p1, p2, p3, r, g, b);
  }

  return rgba;
}

// ── Software rasterizer ───────────────────────────────────────────────────────

function fillTriangle(rgba, zbuf, W, H, p1, p2, p3, r, g, b) {
  const [ax, ay, az] = p1;
  const [bx, by, bz] = p2;
  const [cx, cy, cz] = p3;

  const minX = Math.max(0,   Math.floor(Math.min(ax, bx, cx)));
  const maxX = Math.min(W-1, Math.ceil (Math.max(ax, bx, cx)));
  const minY = Math.max(0,   Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(H-1, Math.ceil (Math.max(ay, by, cy)));

  // Pre-compute barycentric denominator
  const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(denom) < 0.5) return; // degenerate / sub-pixel

  const invD = 1 / denom;

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const w1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) * invD;
      const w2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) * invD;
      const w3 = 1 - w1 - w2;
      if (w1 < 0 || w2 < 0 || w3 < 0) continue;

      const z   = w1 * az + w2 * bz + w3 * cz;
      const idx = py * W + px;
      if (z >= zbuf[idx]) continue;
      zbuf[idx] = z;

      const i4 = idx * 4;
      rgba[i4]   = r;
      rgba[i4+1] = g;
      rgba[i4+2] = b;
      // alpha already 255 from init
    }
  }
}
