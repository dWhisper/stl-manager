import fs from 'fs';
import sharp from 'sharp';
import { geoKeyFromStl } from './geoKey.js';

// Pure STL -> JPEG rendering, with no DB or queue state, so it can run in a worker thread.

const THUMB_SIZE = 256;
// Render at 2x and downscale with sharp for anti-aliased edges
const RENDER_SCALE = 2;
// Dense sculpts need every triangle: decimating by skipping triangles leaves
// holes everywhere and the thumbnail looks like scattered dust.
const MAX_TRIS   = 4_000_000;
// 3D-printing STLs are almost always Z-up; the renderer's camera is Y-up
const Z_UP = true;

// Render an STL file to a THUMB_SIZE JPEG. Returns the mesh's geo key (so the
// file is only read once), or null if the mesh is empty.
export async function renderStlToJpeg(stlPath, outPath, { zUp = Z_UP } = {}) {
  const buf = fs.readFileSync(stlPath);
  const mesh = parseSTL(buf);
  if (mesh.count === 0) return null;

  const size = THUMB_SIZE * RENDER_SCALE;
  const rgba = renderMesh(mesh, size, zUp);

  await sharp(Buffer.from(rgba), { raw: { width: size, height: size, channels: 4 } })
    .resize(THUMB_SIZE, THUMB_SIZE)
    .jpeg({ quality: 82 })
    .toFile(outPath);
  return geoKeyFromStl(buf);
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

function renderMesh({ normals, verts, count }, size, zUp) {
  const W = size, H = size;

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
    if (zUp) [y, z] = [z, -y];
    const x2 =  x * cosA + z * sinA;
    const z2 = -x * sinA + z * cosA;
    const y3 =  y * cosE - z2 * sinE;
    const z3 =  y * sinE + z2 * cosE;
    return [x2, y3, z3];
  }

  // Transform a direction (no translation/scale)
  function xfDir(dx, dy, dz) {
    if (zUp) [dy, dz] = [dz, -dy];
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

  // Sub-pixel triangles (most of a dense sculpt at thumbnail size) cover no pixel
  // centre, so splat them onto the pixel under their centroid instead of dropping them.
  if (Math.abs(denom) < 2) {
    const px = Math.floor((ax + bx + cx) / 3), py = Math.floor((ay + by + cy) / 3);
    if (px < 0 || py < 0 || px >= W || py >= H) return;
    const z = (az + bz + cz) / 3, idx = py * W + px;
    if (z >= zbuf[idx]) return;
    zbuf[idx] = z;
    rgba[idx*4] = r; rgba[idx*4+1] = g; rgba[idx*4+2] = b;
    return;
  }

  const invD = 1 / denom;

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      // Sample at pixel centres
      const sx = px + 0.5, sy = py + 0.5;
      const w1 = ((by - cy) * (sx - cx) + (cx - bx) * (sy - cy)) * invD;
      const w2 = ((cy - ay) * (sx - cx) + (ax - cx) * (sy - cy)) * invD;
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
