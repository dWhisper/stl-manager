import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGroups } from '../src/services/dedupe.js';

const stlRoot = '/stl';
let nextId = 0;

// FileRow for a logical path; anything under a "*.zip" segment is a zip entry
function row(logical, key, opts = {}) {
  const segs = logical.split('/');
  const zi = segs.findIndex(s => s.toLowerCase().endsWith('.zip'));
  const zipLogical = zi >= 0 && zi < segs.length - 1 ? segs.slice(0, zi + 1).join('/') : null;
  return {
    id: opts.id ?? `f${nextId++}`,
    logical,
    zipLogical,
    real: `${stlRoot}/${zipLogical ?? logical}`,
    size: opts.size ?? 100,
    contentKey: key,
    geoKey: opts.geo ?? null,
    hasThumb: opts.thumb ?? false,
  };
}

const build = (rows, linkedPaths = []) => buildGroups(rows, { linkedPaths, stlRoot });
const paths = g => g.members.map(m => m.path);

test('identical loose files group', () => {
  const r = build([
    row('A/X/a.stl', 'k1'), row('A/X/b.stl', 'k2'),
    row('B/Y/a.stl', 'k1'), row('B/Y/c.stl', 'k3'),
  ]);
  assert.equal(r.files.length, 1);
  assert.deepEqual(paths(r.files[0]), ['A/X/a.stl', 'B/Y/a.stl']);
  assert.equal(r.files[0].reclaimable, 100);
  assert.equal(r.files[0].kind, 'files');
  assert.equal(r.files[0].members[0].isFolder, false);
  assert.equal(r.files[0].members[0].real, '/stl/A/X/a.stl');
  assert.equal(r.folders.length, 0);
});

test('zip and its extracted folder group as folders', () => {
  const r = build([
    row('A/Pack.zip/a.stl', 'k1'), row('A/Pack.zip/b.stl', 'k2'),
    row('A/Pack/a.stl', 'k1'),     row('A/Pack/b.stl', 'k2'),
  ]);
  assert.equal(r.folders.length, 1);
  const g = r.folders[0];
  assert.deepEqual(paths(g), ['A/Pack', 'A/Pack.zip']);
  assert.equal(g.suggested, null);
  assert.equal(g.reclaimable, 200);
  const zip = g.members.find(m => m.path === 'A/Pack.zip');
  assert.equal(zip.isZip, true);
  assert.equal(zip.isFolder, true);
  assert.equal(zip.real, '/stl/A/Pack.zip');
  assert.equal(zip.fileCount, 2);
  assert.equal(r.files.length, 0);
});

test('single-folder chain inside a zip collapses to the zip', () => {
  const r = build([
    row('A/P.zip/P/a.stl', 'k1'), row('A/P.zip/P/b.stl', 'k2'),
    row('B/P/a.stl', 'k1'),       row('B/P/b.stl', 'k2'),
  ]);
  assert.equal(r.folders.length, 1);
  assert.deepEqual(paths(r.folders[0]), ['A/P.zip', 'B/P']);
});

test('only the topmost duplicated folder is reported', () => {
  const r = build([
    row('A/X/s1/a.stl', 'k1'), row('A/X/s2/b.stl', 'k2'),
    row('B/X/s1/a.stl', 'k1'), row('B/X/s2/b.stl', 'k2'),
  ]);
  assert.equal(r.folders.length, 1);
  assert.deepEqual(paths(r.folders[0]), ['A/X', 'B/X']);
});

test('file groups inside a reported folder group are suppressed', () => {
  const r = build([
    row('A/X/s1/a.stl', 'k1'), row('A/X/s2/b.stl', 'k2'),
    row('B/X/s1/a.stl', 'k1'), row('B/X/s2/b.stl', 'k2'),
  ]);
  assert.equal(r.files.length, 0);
});

test('a file group with one copy outside the folder groups stays, with all members', () => {
  const r = build([
    row('A/X/a.stl', 'k1'), row('A/X/b.stl', 'k2'),
    row('B/X/a.stl', 'k1'), row('B/X/b.stl', 'k2'),
    row('C/Y/a.stl', 'k1'), row('C/Y/z.stl', 'k9'),
  ]);
  assert.equal(r.folders.length, 1);
  assert.equal(r.files.length, 1);
  assert.deepEqual(paths(r.files[0]), ['A/X/a.stl', 'B/X/a.stl', 'C/Y/a.stl']);
  assert.equal(r.files[0].reclaimable, 200);
});

test('folder with an unkeyed file is never grouped', () => {
  const r = build([
    row('A/X/a.stl', 'k1'), row('A/X/u.stl', null),
    row('B/X/a.stl', 'k1'), row('B/X/u.stl', null),
  ]);
  assert.equal(r.folders.length, 0);
  assert.equal(r.contained.length, 0);
  // The keyed copies are still reported as files, and unkeyed rows never are
  assert.equal(r.files.length, 1);
  assert.deepEqual(paths(r.files[0]), ['A/X/a.stl', 'B/X/a.stl']);
});

test('root and top-level folders are never members', () => {
  const r = build([
    row('A/a.stl', 'k1'), row('A/b.stl', 'k2'),
    row('B/a.stl', 'k1'), row('B/b.stl', 'k2'),
  ]);
  assert.equal(r.folders.length, 0);
  assert.equal(r.files.length, 2);
});

test('contained: subset folder reported against its superset', () => {
  const r = build([
    row('A/Sup/a.stl', 'k1'),  row('A/Sup/b.stl', 'k2'),  row('A/Sup/c.stl', 'k3'),
    row('B/Pack/a.stl', 'k1'), row('B/Pack/b.stl', 'k2'), row('B/Pack/c.stl', 'k3'),
    row('B/Pack/d.stl', 'k4'),
  ]);
  assert.equal(r.contained.length, 1);
  const g = r.contained[0];
  assert.equal(g.kind, 'contained');
  assert.deepEqual(paths(g), ['A/Sup', 'B/Pack']);
  assert.equal(g.suggested, 'B/Pack');
  assert.equal(g.members[0].container, undefined);
  assert.equal(g.members[1].container, true);
  assert.equal(g.reclaimable, 300);
});

test('an unkeyed folder is never a container', () => {
  const r = build([
    row('A/S/a.stl', 'k1'), row('A/S/b.stl', 'k2'), row('A/S/c.stl', 'k3'),
    row('B/P/a.stl', 'k1'), row('B/P/b.stl', 'k2'), row('B/P/c.stl', 'k3'),
    row('B/P/u.stl', null),
  ]);
  assert.equal(r.contained.length, 0);
});

test('contained picks the same container regardless of row order', () => {
  const rows = [
    row('A/S/a.stl', 'k1'), row('A/S/b.stl', 'k2'), row('A/S/c.stl', 'k3'),
    row('B/P/a.stl', 'k1'), row('B/P/b.stl', 'k2'), row('B/P/c.stl', 'k3'), row('B/P/d.stl', 'k4'),
    row('C/Q/a.stl', 'k1'), row('C/Q/b.stl', 'k2'), row('C/Q/c.stl', 'k3'), row('C/Q/e.stl', 'k5'),
    row('C/Q/f.stl', 'k6'),
  ];
  const one = build(rows);
  const two = build([...rows].reverse());
  assert.equal(one.contained.length, 1);
  assert.deepEqual(paths(one.contained[0]), ['A/S', 'B/P']); // the smaller superset
  assert.deepEqual(two.contained, one.contained);
});

test('contained needs at least 3 files', () => {
  const r = build([
    row('A/Sup/a.stl', 'k1'),  row('A/Sup/b.stl', 'k2'),
    row('B/Pack/a.stl', 'k1'), row('B/Pack/b.stl', 'k2'), row('B/Pack/c.stl', 'k3'),
  ]);
  assert.equal(r.contained.length, 0);
});

test('contained is not reported for a descendant', () => {
  const r = build([
    row('B/Pack/Sub/a.stl', 'k1'), row('B/Pack/Sub/b.stl', 'k2'), row('B/Pack/Sub/c.stl', 'k3'),
    row('B/Pack/d.stl', 'k4'),
  ]);
  assert.equal(r.contained.length, 0);
});

test('geometry groups need two content keys and never suggest', () => {
  const r = build([
    row('A/X/a.stl', 'k1', { geo: 'g1', size: 100 }),
    row('B/Y/b.stl', 'k2', { geo: 'g1', size: 300 }),
    row('C/Z/c.stl', 'k3', { geo: 'g2' }),
    row('D/W/c.stl', 'k3', { geo: 'g2' }),
  ]);
  assert.equal(r.geometry.length, 1);
  const g = r.geometry[0];
  assert.equal(g.kind, 'geometry');
  assert.equal(g.key, 'g1');
  assert.deepEqual(paths(g), ['A/X/a.stl', 'B/Y/b.stl']);
  assert.equal(g.suggested, null);
  assert.equal(g.reclaimable, 100);
});

test('keeper prefers a linked member', () => {
  const rows = () => [
    row('A/X/model/a.stl', 'k1'), row('A/X/b.stl', 'k2'),
    row('B/X/model/a.stl', 'k1'), row('B/X/b.stl', 'k2'),
  ];
  assert.equal(build(rows()).folders[0].suggested, 'A/X');
  const r = build(rows(), ['B/X/model']);
  assert.equal(r.folders.length, 1);
  assert.equal(r.folders[0].suggested, 'B/X');
  assert.equal(r.folders[0].members.find(m => m.path === 'B/X').linked, true);
  assert.equal(r.folders[0].members.find(m => m.path === 'A/X').linked, false);
});

test('keeper prefers the bigger top-level folder, then the shorter path', () => {
  const bigger = build([
    row('A/X/a.stl', 'k1'), row('A/X/b.stl', 'k2'),
    row('B/X/a.stl', 'k1'), row('B/X/b.stl', 'k2'),
    row('B/Other/c.stl', 'k3'),
  ]);
  assert.equal(bigger.folders[0].suggested, 'B/X');

  const shorter = build([
    row('C/LongName/d.stl', 'k4'), row('C/LongName/e.stl', 'k5'),
    row('D/X/d.stl', 'k4'),        row('D/X/e.stl', 'k5'),
  ]);
  assert.equal(shorter.folders[0].suggested, 'D/X');
});

test('signature is stable across row order and changes with members', () => {
  const rows = [
    row('A/X/a.stl', 'k1'), row('A/X/b.stl', 'k2'),
    row('B/X/a.stl', 'k1'), row('B/X/b.stl', 'k2'),
    row('C/Y/a.stl', 'k1'), row('C/Y/z.stl', 'k9'),
  ];
  const one = build(rows);
  const two = build([...rows].reverse());
  assert.equal(one.folders[0].signature, two.folders[0].signature);
  assert.equal(one.files[0].signature, two.files[0].signature);

  const sub = [
    row('A/S/a.stl', 'k1'), row('A/S/b.stl', 'k2'), row('A/S/c.stl', 'k3'),
    row('B/P/a.stl', 'k1'), row('B/P/b.stl', 'k2'), row('B/P/c.stl', 'k3'), row('B/P/d.stl', 'k4'),
    row('C/Q/a.stl', 'k1'), row('C/Q/b.stl', 'k2'), row('C/Q/c.stl', 'k3'), row('C/Q/e.stl', 'k5'),
  ];
  assert.deepEqual(build([...sub].reverse()).contained, build(sub).contained);

  const three = build([...rows, row('D/X/a.stl', 'k1'), row('D/X/b.stl', 'k2')]);
  assert.notEqual(three.folders[0].signature, one.folders[0].signature);
  assert.notEqual(three.files[0].signature, one.files[0].signature);
});

test('looseCount counts only files outside zips', () => {
  const r = build([
    row('A/X/a.stl', 'k1'), row('A/X/P.zip/b.stl', 'k2'), row('A/X/P.zip/c.stl', 'k3'),
    row('B/X/a.stl', 'k1'), row('B/X/P.zip/b.stl', 'k2'), row('B/X/P.zip/c.stl', 'k3'),
  ]);
  assert.equal(r.folders.length, 1);
  for (const m of r.folders[0].members) {
    assert.equal(m.fileCount, 3);
    assert.equal(m.looseCount, 1);
  }
  const z = build([
    row('A/Pack.zip/a.stl', 'k1'), row('A/Pack.zip/b.stl', 'k2'),
    row('B/Pack/a.stl', 'k1'),     row('B/Pack/b.stl', 'k2'),
  ]).folders[0].members;
  assert.deepEqual(z.map(m => [m.path, m.looseCount]), [['A/Pack.zip', 0], ['B/Pack', 2]]);
  const f = build([
    row('A/X/a.stl', 'k1'), row('A/X/o.stl', 'k5'),
    row('B/P.zip/a.stl', 'k1'), row('B/P.zip/q.stl', 'k6'),
  ]).files[0].members;
  assert.deepEqual(f.map(m => m.looseCount), [1, 0]);
});

test('zipCount counts zip files beneath a folder, not entries or zip nodes', () => {
  const r = build([
    row('A/X/a.stl', 'k1'), row('A/X/P.zip/b.stl', 'k2'), row('A/X/P.zip/c.stl', 'k3'), row('A/X/Q.zip/d.stl', 'k4'),
    row('B/X/a.stl', 'k1'), row('B/X/P.zip/b.stl', 'k2'), row('B/X/P.zip/c.stl', 'k3'), row('B/X/Q.zip/d.stl', 'k4'),
  ]);
  assert.deepEqual(r.folders[0].members.map(m => m.zipCount), [2, 2]);
  const z = build([
    row('A/Pack.zip/a.stl', 'k1'), row('A/Pack.zip/b.stl', 'k2'),
    row('B/Pack/a.stl', 'k1'),     row('B/Pack/b.stl', 'k2'),
  ]).folders[0].members;
  assert.deepEqual(z.map(m => m.zipCount), [0, 0]);
  const only = build([
    row('A/X/P.zip/a.stl', 'k1'), row('A/X/P.zip/b.stl', 'k2'),
    row('B/X/P.zip/a.stl', 'k1'), row('B/X/P.zip/b.stl', 'k2'),
  ]);
  const x = only.folders.flatMap(g => g.members).filter(m => !m.isZip);
  assert.ok(x.length >= 2);
  for (const m of x) assert.equal(m.looseCount + m.zipCount, 1);
  const f = build([
    row('A/X/a.stl', 'k1'), row('A/X/o.stl', 'k5'),
    row('B/P.zip/a.stl', 'k1'), row('B/P.zip/q.stl', 'k6'),
  ]).files[0].members;
  assert.deepEqual(f.map(m => m.zipCount), [0, 0]);
});
