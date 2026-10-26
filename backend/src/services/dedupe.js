// Duplicate grouping engine. Pure: built-ins only, so it is unit-testable and the
// caller (routes/dedupe.js) owns the DB. Paths are logical, a zip behaves like a folder.
//
// Kinds: identical folders/zips, folders contained in a bigger one, identical files,
// and same-geometry files ("likely", never a suggested keeper).
import crypto from 'node:crypto';

const MIN_CONTAINED_FILES = 3;   // smaller subsets are noise ("a folder with a readme")
const MAX_RARE_OCCURRENCES = 64; // skip contained search when even A's rarest key is everywhere
const MAX_THUMBS = 4;

const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

export function buildGroups(rows, { linkedPaths = [], stlRoot }) {
  const tree = buildTree(rows, stlRoot);
  summarise(tree.nodes, rows);
  const isLinked = linkTester(linkedPaths);
  const keyRows = groupRows(rows, r => r.contentKey);

  const folders = folderGroups(tree.nodes, isLinked);
  const contained = containedGroups(tree, rows, keyRows, isLinked);
  markSuppressed(tree.nodes);
  const files = fileGroups(tree, rows, keyRows, isLinked);
  const geometry = geometryGroups(tree, rows, isLinked);

  return {
    folders: sortGroups(folders),
    contained: sortGroups(contained),
    files: sortGroups(files),
    geometry: sortGroups(geometry),
  };
}

// ---- tree ----

function newNode(path, depth, parent, real, isZip) {
  return {
    path, depth, parent, real, isZip,
    inZip: !!parent && (parent.isZip || parent.inZip),
    top: null,            // depth-1 (creator) ancestor, or itself at depth 1
    children: new Map(), files: [],
    size: 0, fileCount: 0, looseCount: 0, zipCount: 0, unkeyed: false,
    keys: null, sig: null, thumbIds: [],
    folderMember: false, underFolder: false, containedA: false, suppressed: false,
  };
}

function buildTree(rows, stlRoot) {
  const zipReal = new Map();
  for (const r of rows) if (r.zipLogical) zipReal.set(r.zipLogical, r.real);

  const root = newNode('', 0, null, stlRoot, false);
  const nodes = [root];
  const rowNode = new Array(rows.length);

  rows.forEach((r, i) => {
    const segs = r.logical.split('/').filter(Boolean);
    let node = root;
    for (let d = 0; d < segs.length - 1; d++) {
      let child = node.children.get(segs[d]);
      if (!child) {
        const path = node.path ? `${node.path}/${segs[d]}` : segs[d];
        const isZip = zipReal.has(path);
        // Anything inside a zip lives on disk as the zip itself
        const real = isZip ? zipReal.get(path)
          : (node.isZip || node.inZip) ? node.real
          : `${stlRoot}/${path}`;
        child = newNode(path, d + 1, node, real, isZip);
        child.top = child.depth === 1 ? child : node.top;
        node.children.set(segs[d], child);
        nodes.push(child);
      }
      node = child;
    }
    node.files.push(i);
    rowNode[i] = node;
  });
  return { nodes, rowNode }; // nodes: every parent before its children
}

// Bottom-up totals and signatures. Key lists are only kept from depth 2 down:
// the root and creator folders are never members, and their lists would be huge.
function summarise(nodes, rows) {
  for (let o = nodes.length - 1; o >= 0; o--) {
    const n = nodes[o];
    const kids = [...n.children.values()].sort(byPath);
    let keys = n.depth >= 2 ? [] : null;
    for (const i of n.files) {
      const r = rows[i];
      n.size += r.size;
      n.fileCount++;
      if (!r.zipLogical) n.looseCount++; // what find can see on disk
      if (r.contentKey == null) n.unkeyed = true;
      else if (keys) keys.push(r.contentKey);
      if (r.hasThumb && n.thumbIds.length < MAX_THUMBS) n.thumbIds.push(r.id);
    }
    for (const c of kids) {
      n.size += c.size;
      n.fileCount += c.fileCount;
      n.looseCount += c.looseCount;
      n.zipCount += c.isZip ? 1 : c.zipCount; // zip files find sees; their entries are not on disk
      if (c.unkeyed) n.unkeyed = true;
      if (keys) for (const k of c.keys) keys.push(k);
      for (const t of c.thumbIds) if (n.thumbIds.length < MAX_THUMBS) n.thumbIds.push(t);
    }
    if (n.isZip || n.inZip) n.zipCount = 0;
    if (keys) {
      keys.sort();
      n.keys = keys;
      if (!n.unkeyed && n.fileCount > 0) n.sig = sha1(keys.join('\n'));
    }
  }
}

function groupRows(rows, keyOf) {
  const map = new Map();
  rows.forEach((r, i) => {
    const k = keyOf(r);
    if (k == null || r.contentKey == null) return; // unfingerprinted rows are left out
    let list = map.get(k);
    if (!list) map.set(k, list = []);
    list.push(i);
  });
  return map;
}

// ---- folders ----

const eligible = n => !!n && n.depth >= 2 && n.sig !== null;

function folderGroups(nodes, isLinked) {
  // Chain tops: a node whose parent holds exactly the same files is the same copy
  const tops = new Map();
  for (const n of nodes) {
    if (!eligible(n)) continue;
    if (eligible(n.parent) && n.parent.sig === n.sig) continue;
    let list = tops.get(n.sig);
    if (!list) tops.set(n.sig, list = []);
    list.push(n);
  }
  const dup = sig => (tops.get(sig)?.length ?? 0) >= 2;

  // Covered: some eligible ancestor is itself duplicated, so only it is reported
  const covered = new Set();
  for (const n of nodes) {
    const p = n.parent;
    if (eligible(p) && (dup(p.sig) || covered.has(p))) covered.add(n);
  }

  const groups = [];
  for (const [sig, list] of tops) {
    const kept = list.filter(n => !covered.has(n)).sort(byPath);
    if (kept.length < 2) continue;
    for (const n of kept) n.folderMember = true;
    const members = kept.map(n => nodeMember(n, isLinked));
    const total = kept.reduce((s, n) => s + n.size, 0);
    groups.push(makeGroup('folders', sig, members, total - Math.max(...kept.map(n => n.size)),
      suggestKeeper(members, kept.map(topCount))));
  }

  for (const n of nodes) {
    n.underFolder = n.folderMember || !!n.parent?.underFolder;
  }
  return groups;
}

// ---- contained ----

function containedGroups(tree, rows, keyRows, isLinked) {
  const containerOf = new Map(); // A -> B
  for (const a of tree.nodes) {
    if (!eligible(a) || a.fileCount < MIN_CONTAINED_FILES || a.underFolder) continue;
    const b = findContainer(a, tree, rows, keyRows);
    if (b) containerOf.set(a, b);
  }

  const groups = [];
  for (const [a, b] of containerOf) {
    // Topmost only: the parent's report already covers A
    const pb = containerOf.get(a.parent);
    if (pb && (pb === b || b.path.startsWith(pb.path + '/'))) continue;
    a.containedA = true;
    const members = [nodeMember(a, isLinked), { ...nodeMember(b, isLinked), container: true }];
    // The superset is the keeper, unless zipped and unzipped copies are mixed
    const suggested = isMixed(members) ? null : b.path;
    groups.push(makeGroup('contained', a.sig, members, a.size, suggested));
  }
  return groups;
}

function findContainer(a, tree, rows, keyRows) {
  let rare = null, rareCount = Infinity;
  for (let i = 0; i < a.keys.length; i++) {
    if (i > 0 && a.keys[i] === a.keys[i - 1]) continue;
    const c = keyRows.get(a.keys[i])?.length ?? 0;
    if (c < rareCount) { rare = a.keys[i]; rareCount = c; }
  }
  if (rareCount > MAX_RARE_OCCURRENCES) return null;

  const prefix = a.path + '/';
  // Every walk's first container is a candidate; picking among them by a fixed
  // order (not row order) keeps the group signature stable across rebuilds
  const seen = new Set();
  let best = null;
  for (const i of keyRows.get(rare)) {
    if (rows[i].logical.startsWith(prefix)) continue; // inside A
    for (let n = tree.rowNode[i]; n && n.depth >= 2; n = n.parent) {
      if (seen.has(n)) break;                          // this walk was already done above
      seen.add(n);
      if (a.path.startsWith(n.path + '/')) break;      // an ancestor of A, as is all above it
      // Keyed only: unkeyed files would make B look bigger without proving anything
      if (eligible(n) && n.keys.length > a.keys.length && containsAll(n.keys, a.keys)) {
        if (!best || betterContainer(n, best)) best = n;
        break;
      }
    }
  }
  return best;
}

// Smallest container first, then shortest path, then lexicographic
const betterContainer = (n, b) => (n.fileCount - b.fileCount
  || n.path.length - b.path.length
  || (n.path < b.path ? -1 : 1)) < 0;

// Multiset containment of sorted `small` in sorted `big`, by binary search per run
function containsAll(big, small) {
  if (big.length < small.length) return false;
  for (let i = 0; i < small.length;) {
    const k = small[i];
    let j = i;
    while (j < small.length && small[j] === k) j++;
    const at = lowerBound(big, k);
    const end = at + (j - i) - 1;
    if (end >= big.length || big[end] !== k) return false;
    i = j;
  }
  return true;
}

function lowerBound(arr, k) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < k) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function markSuppressed(nodes) {
  for (const n of nodes) {
    n.suppressed = n.underFolder || n.containedA || !!n.parent?.suppressed;
  }
}

// ---- files and geometry ----

function fileGroups(tree, rows, keyRows, isLinked) {
  const groups = [];
  for (const [key, idx] of keyRows) {
    if (idx.length < 2) continue;
    // Every copy is already inside a reported folder or contained subset
    if (idx.every(i => tree.rowNode[i].suppressed)) continue;
    const sorted = sortRowIdx(rows, idx);
    const members = sorted.map(i => fileMember(rows[i], isLinked));
    const tops = sorted.map(i => (tree.rowNode[i].top?.fileCount ?? 0) - 1);
    groups.push(makeGroup('files', key, members, (idx.length - 1) * rows[idx[0]].size,
      suggestKeeper(members, tops)));
  }
  return groups;
}

function geometryGroups(tree, rows, isLinked) {
  const groups = [];
  for (const [key, idx] of groupRows(rows, r => r.geoKey)) {
    if (new Set(idx.map(i => rows[i].contentKey)).size < 2) continue;
    const members = sortRowIdx(rows, idx).map(i => fileMember(rows[i], isLinked));
    const sizes = members.map(m => m.size);
    const total = sizes.reduce((s, x) => s + x, 0);
    groups.push(makeGroup('geometry', key, members, total - Math.max(...sizes), null));
  }
  return groups;
}

const sortRowIdx = (rows, idx) =>
  [...idx].sort((a, b) => (rows[a].logical < rows[b].logical ? -1 : rows[a].logical > rows[b].logical ? 1 : 0));

// ---- members, keepers, groups ----

function nodeMember(n, isLinked) {
  return {
    path: n.path, real: n.real, isZip: n.isZip, inZip: n.inZip, isFolder: true,
    size: n.size, fileCount: n.fileCount, looseCount: n.looseCount, zipCount: n.zipCount, thumbIds: n.thumbIds, linked: isLinked(n.path),
  };
}

function fileMember(r, isLinked) {
  return {
    path: r.logical, real: r.real, isZip: false, inZip: !!r.zipLogical, isFolder: false,
    size: r.size, fileCount: 1, looseCount: r.zipLogical ? 0 : 1, zipCount: 0, thumbIds: r.hasThumb ? [r.id] : [], linked: isLinked(r.logical),
  };
}

// Files in the member's creator folder apart from its own
const topCount = n => (n.top?.fileCount ?? 0) - n.fileCount;

// Linked: a link sits at or under the member, or the member sits under a link
function linkTester(linkedPaths) {
  const atOrUnder = new Set(); // every link path and all of its ancestors
  const links = new Set(linkedPaths);
  for (const l of linkedPaths) {
    const segs = l.split('/');
    for (let i = 1; i <= segs.length; i++) atOrUnder.add(segs.slice(0, i).join('/'));
  }
  return path => {
    if (atOrUnder.has(path)) return true;
    const segs = path.split('/');
    for (let i = 1; i < segs.length; i++) if (links.has(segs.slice(0, i).join('/'))) return true;
    return false;
  };
}

const zipped = m => m.isZip || m.inZip;
const isMixed = members => members.some(zipped) && !members.every(zipped);

// 1. none when zipped and unzipped copies mix; 2. the single linked member
// (several linked: decide among those); 3. the most other files in its creator
// folder; 4. the shortest path, then lexicographic
function suggestKeeper(members, tops) {
  if (isMixed(members)) return null;
  let cand = members.map((m, i) => ({ m, top: tops[i] }));
  const linked = cand.filter(c => c.m.linked);
  if (linked.length === 1) return linked[0].m.path;
  if (linked.length > 1) cand = linked;
  cand.sort((x, y) => (y.top - x.top)
    || (x.m.path.length - y.m.path.length)
    || (x.m.path < y.m.path ? -1 : x.m.path > y.m.path ? 1 : 0));
  return cand[0].m.path;
}

function makeGroup(kind, key, members, reclaimable, suggested) {
  const paths = members.map(m => m.path).sort();
  const signature = sha1(`${kind}\n${key}\n${paths.join('\n')}`);
  return { kind, signature, key, reclaimable, members, suggested };
}

function sortGroups(groups) {
  return groups.sort((a, b) => (b.reclaimable - a.reclaimable)
    || (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0));
}
