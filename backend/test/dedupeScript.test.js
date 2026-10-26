import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { planActions, buildScript } from '../src/services/dedupeScript.js';

const stlRoot = '/nas';
const hostRoot = '/volume1/3D Files';

// Member for a logical path; a path under "*.zip/" is a zip entry
function member(logical, opts = {}) {
  const segs = logical.split('/');
  const zi = segs.findIndex(s => s.toLowerCase().endsWith('.zip'));
  const isZip = zi === segs.length - 1;
  const inZip = zi >= 0 && zi < segs.length - 1;
  const real = `${stlRoot}/${inZip ? segs.slice(0, zi + 1).join('/') : logical}`;
  const isFolder = opts.folder ?? isZip;
  return {
    path: logical, real, isZip, inZip, isFolder,
    size: opts.size ?? 100,
    fileCount: opts.count ?? 1,
    looseCount: opts.loose ?? (isZip || inZip ? 0 : opts.count ?? 1),
    thumbIds: [], linked: false,
    ...(opts.container ? { container: true } : {}),
  };
}

let nextSig = 0;
const group = (kind, members) => ({ kind, signature: `s${nextSig++}`, key: 'k', reclaimable: 0, members, suggested: null });
const keep = (...pairs) => new Map(pairs.map(([g, k]) => [g.signature, { action: 'keep', keeper_path: k }]));
const plan = (groups, decisions, zipSize = () => 1234) => planActions(groups, decisions, { stlRoot, hostRoot, zipSize });

// ---- planActions ----

test('only keep decisions with a member keeper produce actions', () => {
  const g1 = group('files', [member('A/a.stl'), member('B/a.stl')]);
  const g2 = group('files', [member('A/b.stl'), member('B/b.stl')]);
  const g3 = group('files', [member('A/c.stl'), member('B/c.stl')]);
  const g4 = group('files', [member('A/d.stl'), member('B/d.stl')]);
  const decisions = keep([g1, 'A/a.stl'], [g2, 'Z/nope.stl']);
  decisions.set(g3.signature, { action: 'ignore', keeper_path: 'A/c.stl' });
  const r = plan([g1, g2, g3, g4], decisions);
  assert.deepEqual(r.actions, [{
    type: 'file', path: `${hostRoot}/B/a.stl`, rel: 'B/a.stl',
    keeper: `${hostRoot}/A/a.stl`, expectSize: 100, size: 100,
  }]);
  assert.deepEqual(r.manual, []);
});

test('a zip entry goes to manual', () => {
  const g = group('files', [member('A/a.stl'), member('B/P.zip/a.stl')]);
  const r = plan([g], keep([g, 'A/a.stl']));
  assert.deepEqual(r.actions, []);
  assert.deepEqual(r.manual, [{ path: 'B/P.zip/a.stl', reason: 'inside a zip' }]);
});

test('a whole zip is a file action with its disk size, or manual when missing', () => {
  const g = group('folders', [member('A/P', { folder: true, count: 2 }), member('B/P.zip', { count: 2 })]);
  const seen = [];
  let r = plan([g], keep([g, 'A/P']), real => { seen.push(real); return 777; });
  assert.deepEqual(seen, ['/nas/B/P.zip']);
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].type, 'file');
  assert.equal(r.actions[0].expectSize, 777);
  assert.equal(r.actions[0].path, `${hostRoot}/B/P.zip`);
  r = plan([g], keep([g, 'A/P']), () => null);
  assert.deepEqual(r.actions, []);
  assert.deepEqual(r.manual, [{ path: 'B/P.zip', reason: 'zip missing' }]);
});

test('a folder is a dir action counting loose model files', () => {
  const g = group('folders', [
    member('A/P', { folder: true, count: 5, loose: 5 }),
    member('B/P', { folder: true, count: 5, loose: 3 }),
  ]);
  const r = plan([g], keep([g, 'A/P']));
  assert.deepEqual(r.actions, [{
    type: 'dir', path: `${hostRoot}/B/P`, rel: 'B/P',
    keeper: `${hostRoot}/A/P`, expectCount: 3, size: 100,
  }]);
});

test('real paths are mapped from stlRoot to hostRoot', () => {
  const g = group('files', [member('A/x y.stl'), member('B/x y.stl')]);
  const r = planActions([g], keep([g, 'B/x y.stl']), { stlRoot: '/nas/', hostRoot: '/vol/', zipSize: () => 1 });
  assert.equal(r.actions[0].path, '/vol/A/x y.stl');
  assert.equal(r.actions[0].rel, 'A/x y.stl');
  assert.equal(r.actions[0].keeper, '/vol/B/x y.stl');
});

test('a member outside stlRoot goes to manual', () => {
  const m = { ...member('B/a.stl'), real: '/elsewhere/B/a.stl' };
  const g = group('files', [member('A/a.stl'), m]);
  const r = plan([g], keep([g, 'A/a.stl']));
  assert.deepEqual(r.actions, []);
  assert.deepEqual(r.manual, [{ path: 'B/a.stl', reason: 'outside the library' }]);
});

test('a member at the library root, or with empty or dot segments, goes to manual', () => {
  for (const real of ['/nas/', '/nas//A', '/nas/A/../B', '/nas/./A', '/nas']) {
    const m = { ...member('B/a.stl'), real };
    const g = group('files', [member('A/a.stl'), m]);
    const r = plan([g], keep([g, 'A/a.stl']));
    assert.deepEqual(r.actions, [], real);
    assert.deepEqual(r.manual, [{ path: 'B/a.stl', reason: 'outside the library' }], real);
    // The same check guards the keeper
    const r2 = plan([g], keep([g, 'B/a.stl']));
    assert.deepEqual(r2.actions, [], real);
  }
});

test('a container is never removed in favour of its subset', () => {
  const g = group('contained', [
    member('A/P', { folder: true, count: 3 }),
    member('B/Big', { folder: true, count: 9, container: true }),
  ]);
  const r = plan([g], keep([g, 'A/P']));
  assert.deepEqual(r.actions, []);
  assert.deepEqual(r.manual, [{ path: 'B/Big', reason: 'holds files the keeper lacks' }]);
  const r2 = plan([g], keep([g, 'B/Big']));
  assert.deepEqual(r2.actions.map(a => a.rel), ['A/P']);
});

test('drops an action whose keeper another action removes', () => {
  // Folders group removes B/X; a files group keeps B/X/a.stl, which would vanish with it
  const gf = group('folders', [member('A/X', { folder: true, count: 2 }), member('B/X', { folder: true, count: 2 })]);
  const g1 = group('files', [member('B/X/a.stl'), member('C/a.stl')]);
  // Keeper equal to another action's path
  const g2 = group('files', [member('D/b.stl'), member('E/b.stl')]);
  const g3 = group('files', [member('E/b.stl'), member('F/b.stl')]);
  const r = plan([gf, g1, g2, g3], keep([gf, 'A/X'], [g1, 'B/X/a.stl'], [g2, 'D/b.stl'], [g3, 'E/b.stl']));
  assert.deepEqual(r.actions.map(a => a.rel).sort(), ['B/X', 'E/b.stl']);
  assert.deepEqual(r.manual, [
    { path: 'C/a.stl', reason: 'keeper is removed by another group' },
    { path: 'F/b.stl', reason: 'keeper is removed by another group' },
  ]);
});

test('the keeper check respects path boundaries', () => {
  const gf = group('folders', [member('A/X', { folder: true }), member('B/X', { folder: true })]);
  const g1 = group('files', [member('B/Xy/a.stl'), member('C/a.stl')]);
  const r = plan([gf, g1], keep([gf, 'A/X'], [g1, 'B/Xy/a.stl']));
  assert.deepEqual(r.actions.map(a => a.rel).sort(), ['B/X', 'C/a.stl']);
  assert.deepEqual(r.manual, []);
});

test('an action nested under another action is dropped as redundant', () => {
  const gf = group('folders', [member('A/X', { folder: true }), member('B/X', { folder: true })]);
  const g1 = group('files', [member('B/X/a.stl'), member('C/a.stl')]);
  const r = plan([gf, g1], keep([gf, 'A/X'], [g1, 'C/a.stl']));
  assert.deepEqual(r.actions.map(a => a.rel), ['B/X']);
  assert.deepEqual(r.manual, []);
});

test('duplicate paths collapse to one', () => {
  const g1 = group('files', [member('A/a.stl'), member('B/a.stl')]);
  const g2 = group('geometry', [member('A/a.stl'), member('B/a.stl'), member('C/a.stl')]);
  const r = plan([g1, g2], keep([g1, 'A/a.stl'], [g2, 'A/a.stl']));
  assert.deepEqual(r.actions.map(a => a.rel), ['B/a.stl', 'C/a.stl']);
});

// ---- buildScript (run for real) ----

function withTree(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dedupe-script-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function put(root, rel, content = 'solid x\n') {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

const fileAction = (root, rel, keeperRel) => ({
  type: 'file', path: path.join(root, rel), rel, keeper: path.join(root, keeperRel),
  expectSize: fs.statSync(path.join(root, rel)).size, size: fs.statSync(path.join(root, rel)).size,
});
const dirAction = (root, rel, keeperRel, count) => ({
  type: 'dir', path: path.join(root, rel), rel, keeper: path.join(root, keeperRel), expectCount: count, size: 0,
});

function run(script, env = {}) {
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

const exists = p => fs.existsSync(p);

test('mv mode moves into _duplicates and keeps the relative path', () => withTree(root => {
  put(root, 'A/X/a.stl'); put(root, 'B/X/a.stl');
  put(root, 'A/P/m.stl'); put(root, 'B/P/m.stl'); put(root, 'B/P/sub/n.3MF');
  const plan = { actions: [fileAction(root, 'B/X/a.stl', 'A/X/a.stl'), dirAction(root, 'B/P', 'A/P', 2)], manual: [] };
  const out = run(buildScript(plan, { mode: 'mv', hostRoot: root }));
  assert.match(out, /MOVED .*B\/X\/a\.stl/);
  assert.match(out, /MOVED .*B\/P/);
  assert.ok(!exists(path.join(root, 'B/X/a.stl')));
  assert.ok(exists(path.join(root, '_duplicates/B/X/a.stl')));
  assert.ok(exists(path.join(root, '_duplicates/B/P/sub/n.3MF')));
  assert.ok(exists(path.join(root, 'A/X/a.stl')));
  assert.ok(exists(path.join(root, 'A/P/m.stl')));
}));

test('DEDUPE_HOST_ROOT relocates every path', () => withTree(root => {
  const other = path.join(root, 'moved');
  put(other, 'A/a.stl'); put(other, 'B/a.stl');
  const fake = '/does/not/exist';
  const plan = { actions: [{ ...fileAction(other, 'B/a.stl', 'A/a.stl'), path: `${fake}/B/a.stl`, keeper: `${fake}/A/a.stl` }], manual: [] };
  const script = buildScript(plan, { mode: 'mv', hostRoot: fake });
  run(script, { DEDUPE_HOST_ROOT: other });
  assert.ok(exists(path.join(other, '_duplicates/B/a.stl')));
}));

test('rm mode deletes files and dirs', () => withTree(root => {
  put(root, 'A/a.stl'); put(root, 'B/a.stl');
  put(root, 'A/P/m.stl'); put(root, 'B/P/m.stl');
  const plan = { actions: [fileAction(root, 'B/a.stl', 'A/a.stl'), dirAction(root, 'B/P', 'A/P', 1)], manual: [] };
  const out = run(buildScript(plan, { mode: 'rm', hostRoot: root }));
  assert.match(out, /REMOVED .*B\/a\.stl/);
  assert.ok(!exists(path.join(root, 'B/a.stl')));
  assert.ok(!exists(path.join(root, 'B/P')));
  assert.ok(!exists(path.join(root, '_duplicates')));
  assert.ok(exists(path.join(root, 'A/a.stl')));
  assert.ok(exists(path.join(root, 'A/P/m.stl')));
}));

test('script skips a file whose size changed', () => withTree(root => {
  put(root, 'A/a.stl'); const b = put(root, 'B/a.stl');
  const script = buildScript({ actions: [fileAction(root, 'B/a.stl', 'A/a.stl')], manual: [] }, { mode: 'rm', hostRoot: root });
  fs.appendFileSync(b, 'x');
  const out = run(script);
  assert.match(out, /SKIP .*B\/a\.stl: expected 8, found 9/);
  assert.ok(exists(b));
}));

test('script skips a dir whose model-file count changed', () => withTree(root => {
  put(root, 'A/P/m.stl'); put(root, 'B/P/m.stl');
  const script = buildScript({ actions: [dirAction(root, 'B/P', 'A/P', 1)], manual: [] }, { mode: 'rm', hostRoot: root });
  put(root, 'B/P/new.obj');
  const out = run(script);
  assert.match(out, /SKIP .*B\/P: expected 1, found 2/);
  assert.ok(exists(path.join(root, 'B/P/new.obj')));
}));

test('the model count ignores what the scanner skips', () => withTree(root => {
  put(root, '.hidden/A/P/m.stl'); put(root, '.hidden/B/P/m.stl');
  for (const junk of ['.x.stl', '@eaDir/t.stl', '__MACOSX/a.stl', '_Duplicates/a.stl',
    '#recycle/a.stl', '#Snapshot/a.stl', 'sub/.git/a.stl', 'readme.txt']) put(root, `.hidden/B/P/${junk}`);
  put(root, '.hidden/B/P/#32 Sky/a.STL'); // real folder, counted
  const base = path.join(root, '.hidden'); // a dotted ancestor must not hide anything
  const script = buildScript({ actions: [dirAction(base, 'B/P', 'A/P', 2)], manual: [] }, { mode: 'rm', hostRoot: base });
  const out = run(script);
  assert.match(out, /REMOVED/, out);
  assert.ok(!exists(path.join(base, 'B/P')));
}));

test('script skips when the copy changed type', () => withTree(root => {
  put(root, 'A/a.stl'); put(root, 'A/P/m.stl'); put(root, 'B/a.stl/x'); put(root, 'B/P', '');
  const plan = { actions: [
    { type: 'file', path: path.join(root, 'B/a.stl'), rel: 'B/a.stl', keeper: path.join(root, 'A/a.stl'), expectSize: 8, size: 8 },
    dirAction(root, 'B/P', 'A/P', 0),
  ], manual: [] };
  const out = run(buildScript(plan, { mode: 'rm', hostRoot: root }));
  assert.match(out, /SKIP .*B\/a\.stl: not a file/);
  assert.match(out, /SKIP .*B\/P: not a folder/);
  assert.ok(exists(path.join(root, 'B/a.stl/x')));
  assert.ok(exists(path.join(root, 'B/P')));
}));

test('script skips when the keeper is gone', () => withTree(root => {
  put(root, 'B/a.stl');
  const plan = { actions: [{ ...fileAction(root, 'B/a.stl', 'B/a.stl'), keeper: path.join(root, 'A/a.stl') }], manual: [] };
  const out = run(buildScript(plan, { mode: 'rm', hostRoot: root }));
  assert.match(out, /SKIP .*B\/a\.stl: keeper missing/);
  assert.ok(exists(path.join(root, 'B/a.stl')));
}));

test('script skips when the _duplicates target exists', () => withTree(root => {
  put(root, 'A/a.stl'); put(root, 'B/a.stl'); put(root, '_duplicates/B/a.stl', 'older');
  const out = run(buildScript({ actions: [fileAction(root, 'B/a.stl', 'A/a.stl')], manual: [] }, { mode: 'mv', hostRoot: root }));
  assert.match(out, /SKIP .*B\/a\.stl: .*_duplicates\/B\/a\.stl exists/);
  assert.ok(exists(path.join(root, 'B/a.stl')));
  assert.equal(fs.readFileSync(path.join(root, '_duplicates/B/a.stl'), 'utf8'), 'older');
}));

test('paths with spaces, quotes, $ and newlines survive', () => withTree(root => {
  const names = ["it's $HOME.stl", 'a\nb.stl', 'x y.stl', '`touch pwned`.stl', '$(touch pwned).stl'];
  const actions = names.map(n => {
    put(root, `keep/${n}`); put(root, `dup dir/${n}`);
    return fileAction(root, `dup dir/${n}`, `keep/${n}`);
  });
  put(root, 'K/x y/m.stl'); put(root, "D/it's $HOME/m.stl");
  actions.push(dirAction(root, "D/it's $HOME", 'K/x y', 1));
  const manual = [{ path: 'Z/evil\nrm -rf /.stl', reason: 'inside a zip' }];
  run(buildScript({ actions, manual }, { mode: 'mv', hostRoot: root }));
  for (const n of names) {
    assert.ok(exists(path.join(root, '_duplicates/dup dir', n)), n);
    assert.ok(exists(path.join(root, 'keep', n)), n);
  }
  assert.ok(exists(path.join(root, "_duplicates/D/it's $HOME/m.stl")));
  assert.ok(!exists(path.join(root, 'pwned')));
  assert.ok(!exists(path.join(process.cwd(), 'pwned')));
}));

test('manual items appear as comments only', () => {
  const s = buildScript({ actions: [], manual: [
    { path: 'A/P.zip/a.stl', reason: 'inside a zip' },
    { path: 'B/evil\necho PWNED', reason: 'zip missing' },
  ] }, { mode: 'mv', hostRoot: '/vol' });
  const lines = s.split('\n').filter(l => l.includes('A/P.zip') || l.includes('PWNED'));
  assert.equal(lines.length, 2);
  for (const l of lines) assert.match(l, /^# MANUAL /);
  assert.ok(lines.includes('# MANUAL A/P.zip/a.stl: inside a zip'));
  const r = spawnSync('bash', ['-c', s], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('buildScript refuses paths that leave or are ROOT', () => {
  const ok = { type: 'file', path: '/vol/B/a.stl', rel: 'B/a.stl', keeper: '/vol/A/a.stl', expectSize: 1, size: 1 };
  const bad = [
    { ...ok, path: '/vol/../etc', rel: '../etc' },
    { ...ok, path: '/vol/', rel: '' },
    { ...ok, path: '/vol/B//a.stl' },
    { ...ok, path: '/vol/B/./a.stl' },
    { ...ok, keeper: '/vol/A/..' },
  ];
  for (const a of bad) {
    assert.throws(() => buildScript({ actions: [a], manual: [] }, { mode: 'rm', hostRoot: '/vol' }), /outside hostRoot/, JSON.stringify(a));
  }
  assert.doesNotThrow(() => buildScript({ actions: [ok], manual: [] }, { mode: 'rm', hostRoot: '/vol' }));
});

test('CDPATH cannot leak into the model count', () => withTree(root => {
  // A relative ROOT found through CDPATH makes cd print the directory
  const tree = path.join(root, 'tree');
  put(tree, 'A/P/m.stl'); put(tree, 'B/P/m.stl');
  const script = buildScript({ actions: [dirAction(tree, 'B/P', 'A/P', 1)], manual: [] }, { mode: 'rm', hostRoot: tree });
  const r = spawnSync('bash', ['-c', script], {
    encoding: 'utf8', cwd: root, env: { ...process.env, CDPATH: root, DEDUPE_HOST_ROOT: 'tree' },
  });
  assert.match(r.stdout, /REMOVED/, r.stdout);
  assert.ok(!exists(path.join(tree, 'B/P')));
}));

test('bash -n accepts the output', () => withTree(root => {
  const plan = {
    actions: [
      { type: 'file', path: `${root}/B/it's.stl`, rel: "B/it's.stl", keeper: `${root}/A/a.stl`, expectSize: 3, size: 3 },
      { type: 'dir', path: `${root}/B/P`, rel: 'B/P', keeper: `${root}/A/P`, expectCount: 4, size: 9 },
    ],
    manual: [{ path: 'x', reason: 'inside a zip' }],
  };
  for (const mode of ['mv', 'rm']) {
    const s = buildScript(plan, { mode, hostRoot: root });
    assert.match(s, /^#!\/usr\/bin\/env bash\nset -uo pipefail\n/);
    assert.match(s, /# 2 actions, 12 bytes reclaimed/);
    const f = path.join(root, `${mode}.sh`);
    fs.writeFileSync(f, s);
    const r = spawnSync('bash', ['-n', f], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
  assert.throws(() => buildScript(plan, { mode: 'nuke', hostRoot: root }));
}));
