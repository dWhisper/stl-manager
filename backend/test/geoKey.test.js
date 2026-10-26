import test from 'node:test';
import assert from 'node:assert/strict';
import { geoKeyFromStl } from '../src/services/geoKey.js';

const rotX90 = ([x, y, z]) => [x, -z, y];
const rotY90 = ([x, y, z]) => [z, y, -x];
const rotZ90 = ([x, y, z]) => [-y, x, z];

// 12 outward-wound triangles of a closed axis-aligned w x d x h box, optionally rotated/translated
function boxTris(w, d, h, rot = null, shift = [0, 0, 0]) {
  const p = (i, j, k) => [i * w, j * d, k * h];
  const quads = [
    [p(0,0,0), p(0,1,0), p(1,1,0), p(1,0,0)], // -z
    [p(0,0,1), p(1,0,1), p(1,1,1), p(0,1,1)], // +z
    [p(0,0,0), p(1,0,0), p(1,0,1), p(0,0,1)], // -y
    [p(0,1,0), p(0,1,1), p(1,1,1), p(1,1,0)], // +y
    [p(0,0,0), p(0,0,1), p(0,1,1), p(0,1,0)], // -x
    [p(1,0,0), p(1,1,0), p(1,1,1), p(1,0,1)], // +x
  ];
  const tris = [];
  for (const [a, b, c, e] of quads) tris.push([a, b, c], [a, c, e]);
  return tris.map(t => t.map(v => {
    const r = rot ? rot(v) : v;
    return [r[0] + shift[0], r[1] + shift[1], r[2] + shift[2]];
  }));
}

function box(w, d, h, rot, shift) {
  const tris = boxTris(w, d, h, rot, shift);
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => {
    const o = 84 + i * 50;
    t.forEach((v, j) => v.forEach((x, k) => buf.writeFloatLE(x, o + 12 + j * 12 + k * 4)));
  });
  return buf;
}

function asciiBox(w, d, h) {
  const lines = ['solid box'];
  for (const t of boxTris(w, d, h)) {
    lines.push('facet normal 0 0 0', 'outer loop');
    for (const v of t) lines.push(`vertex ${v[0]} ${v[1]} ${v[2]}`);
    lines.push('endloop', 'endfacet');
  }
  lines.push('endsolid box');
  return Buffer.from(lines.join('\n'));
}

// Degenerate (all-zero) triangles: cheap to build, still counted
function manyTris(n) {
  const buf = Buffer.alloc(84 + n * 50);
  buf.writeUInt32LE(n, 80);
  return buf;
}

test('box 10x20x30 key', () => assert.equal(geoKeyFromStl(box(10, 20, 30)), 't12|b10,20,30|a2200|v6000'));
test('rotating 90° about any axis keeps the key', () => {
  for (const r of [rotX90, rotY90, rotZ90]) assert.equal(geoKeyFromStl(box(10, 20, 30, r)), geoKeyFromStl(box(10, 20, 30)));
});
test('translating keeps the key', () => assert.equal(geoKeyFromStl(box(10, 20, 30, null, [100, -5, 7])), geoKeyFromStl(box(10, 20, 30))));
test('scaling changes the key', () => assert.notEqual(geoKeyFromStl(box(20, 40, 60)), geoKeyFromStl(box(10, 20, 30))));
test('ascii and binary agree', () => assert.equal(geoKeyFromStl(asciiBox(10, 20, 30)), geoKeyFromStl(box(10, 20, 30))));
test('every triangle counts, beyond the renderer cap', () => assert.match(geoKeyFromStl(manyTris(4_000_010)), /^t4000000\|/)); // 4.00e6 at 3 s.f.
test('empty mesh is null', () => assert.equal(geoKeyFromStl(Buffer.alloc(84)), null));

test('a non-finite vertex gives no key', () => {
  const b = box(2, 3, 4);
  b.writeFloatLE(NaN, 84 + 12);
  assert.equal(geoKeyFromStl(b), null);
});
