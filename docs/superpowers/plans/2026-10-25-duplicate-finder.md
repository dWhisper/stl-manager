# Duplicate Finder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find duplicate files, folders and zips in the STL library, let the user review each group and pick a keeper, and export a guarded bash script that removes the rest.

**Architecture:** Every `files` row gets a `content_key` (CRC32 + size, from the zip central directory or a background read of loose files) and, for STLs, a `geo_key` (mesh fingerprint). A pure engine (`services/dedupe.js`) builds groups from those rows in memory; a thin store caches them and holds user decisions; a pure script builder turns decided groups into bash. A new Duplicates page drives it.

**Tech Stack:** Node 20 ESM + Express + better-sqlite3 (backend), React 18 + Vite (frontend), `node:test` for tests.

**Spec:** `docs/superpowers/specs/2026-10-24-duplicate-finder-design.md`

## Global Constraints

- The library stays read-only: the app never writes under `STL_ROOT` (`/nas`). Only the exported script touches files.
- `content_key` format: `"<crc32 as 8 lowercase hex digits>:<size in bytes>"`, e.g. `"cbf43926:9"`.
- `geo_key` format: `"t<tris>|b<s1>,<s2>,<s3>|a<area>|v<volume>"`, sides sorted ascending, every number rounded to 3 significant figures (`Number(x.toPrecision(3))`).
- Geometry groups are labelled "likely" and never get a suggested keeper.
- Groups mixing zipped (zip or inside a zip) and unzipped members get no suggested keeper.
- The library root and top-level (creator) folders are never group members.
- Script default mode is `mv` into `"$ROOT/_duplicates/<path relative to ROOT>"`; `ROOT` defaults to `/volume1/3D Files`, overridable with env `DEDUPE_HOST_ROOT`.
- Image is `node:20-alpine`: no `zlib.crc32`. Backend tests are pure modules (no `better-sqlite3`, no `chokidar`) so `node --test` runs on the Mac without `npm install`.
- New schema changes are additive (`ALTER TABLE ... ADD COLUMN` guarded by `table_info`, `CREATE TABLE IF NOT EXISTS`), as in `backend/src/db/schema.js`.
- Deploy (always with the https file): `CERT_DIR=/volume1/docker/stl-manager/certs docker --context nas compose -f docker-compose.yml -f docker-compose.nas.yml -f docker-compose.https.yml up -d --build --no-deps <svc>`.

## Review Focus

1. **Half-fingerprinted folders.** While loose files are still being hashed, a folder whose files are only partly keyed must not match anything. Expected: such folders are left out until complete. Test: Task 6, `folder with an unkeyed file is never grouped`.
2. **One group's keeper deleted by another group's action.** For example, group A keeps `x/` and removes `y/`, while group B keeps `y/f.stl`. Expected: B's action is dropped to the manual list, so no content loses its last copy. Test: Task 7, `drops an action whose keeper another action removes`.
3. **Files that change between export and run.** Expected: the script prints `SKIP` and moves on, never removes. Test: Task 7, `script skips a file whose size changed`.
4. **Re-running the script, or an `mv` target that already exists.** Expected: `SKIP`, no overwrite. Test: Task 7, `script skips when the _duplicates target exists`.
5. **The geometry backfill filling `/data/cache` with extracted zip entries.** Expected: an entry extracted only for the backfill is deleted afterwards. Check: Task 5, the cache size before and after a backfill batch.

---

## Prerequisite

- [ ] Commit or stash the user's uncommitted changes on `main` (`schema.js`, `mmf.js`, `reconcile.js`, `PurchasesPage.jsx`, `mmfExportScript.js`) **with the user's go-ahead**, then rebase `feature/duplicate-finder` on it. Task 3 edits `schema.js` and must not sweep that work into a dedupe commit.

---

### Task 1: Test harness and CRC32

**Files:**
- Create: `backend/src/services/crc32.js`
- Create: `backend/test/crc32.test.js`
- Modify: `backend/package.json` (scripts)

**Interfaces:**
- Produces:
  - `crc32(buf: Buffer, prev?: number) => number` (unsigned 32-bit, chainable over chunks)
  - `crc32File(path: string) => Promise<number>` (streams the file)
  - `contentKey(crc: number, size: number) => string`

- [ ] **Step 1: Add `"test": "node --test test/*.test.js"` to `backend/package.json` scripts.**

- [ ] **Step 2: Write the failing tests** in `backend/test/crc32.test.js`:

```js
test('crc32 of the check string', () => assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926));
test('crc32 chains across chunks', () =>
  assert.equal(crc32(Buffer.from('6789'), crc32(Buffer.from('12345'))), 0xcbf43926));
test('crc32File matches crc32 of the bytes', async () => {
  // write 200 KB of pseudo-random bytes to a temp file (spans several stream chunks)
  assert.equal(await crc32File(tmp), crc32(bytes));
});
test('contentKey pads to 8 hex digits', () => assert.equal(contentKey(0xab, 12), '000000ab:12'));
```

- [ ] **Step 3: Run `cd backend && npm test`.** Expected: FAIL, cannot find module `../src/services/crc32.js`.

- [ ] **Step 4: Implement `crc32.js`.** Use a standard reflected table (polynomial `0xEDB88320`) built once at module load. `crc32File` folds `crc32(chunk, crc)` over `fs.createReadStream` with `highWaterMark: 1 << 20`.

- [ ] **Step 5: Run `npm test`.** Expected: 4 passing.

- [ ] **Step 6: Commit** `feat: add CRC32 helper and node:test harness`.

---

### Task 2: Geometry fingerprint

**Files:**
- Create: `backend/src/services/geoKey.js`
- Create: `backend/test/geoKey.test.js`
- Modify: `backend/src/services/stlRender.js` (`renderStlToJpeg`)
- Modify: `backend/src/services/thumbWorker.js`

**Interfaces:**
- Produces:
  - `geoKeyFromStl(buf: Buffer) => string | null` (null when there are no triangles)
  - `renderStlToJpeg(stlPath, outPath) => Promise<string | null>` (now returns the geo key, null for an empty mesh; callers that test truthiness keep working)
  - worker message `{ jobId, stlPath, outPath, mode: 'render' | 'geo' }` → reply `{ jobId, ok: string | null }` or `{ jobId, error }`. `mode: 'geo'` skips rendering and needs no `outPath`.

- [ ] **Step 1: Write failing tests** in `backend/test/geoKey.test.js`. Include a helper that writes a binary STL buffer (80-byte header, uint32 count, 50 bytes per triangle) for a closed axis-aligned box `w×d×h` with 12 triangles and outward winding, plus an ASCII variant.

```js
test('box 10x20x30 key', () => assert.equal(geoKeyFromStl(box(10, 20, 30)), 't12|b10,20,30|a2200|v6000'));
test('rotating 90° about any axis keeps the key', () => {
  for (const r of [rotX90, rotY90, rotZ90]) assert.equal(geoKeyFromStl(box(10, 20, 30, r)), geoKeyFromStl(box(10, 20, 30)));
});
test('translating keeps the key', () => assert.equal(geoKeyFromStl(box(10, 20, 30, null, [100, -5, 7])), geoKeyFromStl(box(10, 20, 30))));
test('scaling changes the key', () => assert.notEqual(geoKeyFromStl(box(20, 40, 60)), geoKeyFromStl(box(10, 20, 30))));
test('ascii and binary agree', () => assert.equal(geoKeyFromStl(asciiBox(10, 20, 30)), geoKeyFromStl(box(10, 20, 30))));
test('every triangle counts, beyond the renderer cap', () => assert.match(geoKeyFromStl(manyTris(4_000_010)), /^t4000000\|/)); // 4.00e6 at 3 s.f.
test('empty mesh is null', () => assert.equal(geoKeyFromStl(Buffer.alloc(84)), null));
```

Make `manyTris` cheap: degenerate triangles (all-zero vertices) in a `Buffer.alloc(84 + n * 50)` with the count field set.

- [ ] **Step 2: Run `npm test`.** Expected: geoKey tests FAIL (module missing).

- [ ] **Step 3: Implement `geoKeyFromStl(buf)`.** Detect binary vs ASCII the same way as `parseSTL` in `stlRender.js`, but read **every** triangle with no `MAX_TRIS` sampling, and parse ASCII vertices with no 8 MB cap. Do it in a single pass without allocating vertex arrays:
  - count the triangles;
  - track the min/max of each axis;
  - add up the area as `|cross(b−a, c−a)|/2`;
  - add up the signed volume as `dot(a, cross(b, c))/6`, taking the absolute value of the total at the end.

  Sort the three sides, then round each number with `Number(x.toPrecision(3))` and format it with `String()`.

- [ ] **Step 4: Run `npm test`.** Expected: all pass.

- [ ] **Step 5: Wire it into rendering.** Have `renderStlToJpeg` read the buffer once, compute `geoKeyFromStl(buf)` and return it, or `null` where it currently returns `false`. In `thumbWorker.js`, take `mode` from the message: `'geo'` posts `geoKeyFromStl(fs.readFileSync(stlPath))`, and anything else posts the `renderStlToJpeg` result.

- [ ] **Step 6: Run `node --check src/services/stlRender.js && node --check src/services/thumbWorker.js && npm test`.** Expected: no output from the checks, and the tests pass.

- [ ] **Step 7: Commit** `feat: fingerprint STL geometry`.

---

### Task 3: Fingerprint columns, zip keys, change invalidation

**Files:**
- Modify: `backend/src/db/schema.js` (additive migrations, near the existing `thumb_error` one)
- Modify: `backend/src/services/zipScanner.js` (`scanZip`, export `cachePathFor`)
- Modify: `backend/src/services/scanner.js` (`IGNORED`, `upsertFile`)
- Modify: `backend/src/services/thumbnailer.js` (`generateThumbnail` stores `geo_key`)

**Interfaces:**
- Consumes: `contentKey` (Task 1), `renderStlToJpeg` return value (Task 2).
- Produces:
  - columns `files.content_key TEXT`, `files.geo_key TEXT`, `files.fingerprint_error TEXT`, index `idx_files_content_key`, index `idx_files_geo_key`;
  - table `dedupe_decisions` exactly as in spec §3;
  - `export function cachePathFor(zipSource, zipEntry)` from `zipScanner.js`.

- [ ] **Step 1: Schema.** Add the three columns, both indexes and the `dedupe_decisions` table to `migrate()`.

- [ ] **Step 2: Zip keys.** In `scanZip`, push `crc: e.crc32` with each entry and write `content_key: contentKey(entry.crc, entry.size)` in the upsert. In the `ON CONFLICT` clause set `content_key = excluded.content_key`. Also clear `geo_key` and `fingerprint_error` unless both `modified_at` and `size` are unchanged, using the same `CASE WHEN files.modified_at IS excluded.modified_at AND files.size IS excluded.size THEN … END` shape as `thumb_error`.

- [ ] **Step 3: Loose files.** In `upsertFile`'s `ON CONFLICT`, apply that same `CASE` to `content_key`, `geo_key` and `fingerprint_error`, so a changed file is hashed again. New loose files get queued in Task 4.

- [ ] **Step 4: Ignore the quarantine folder.** Add `_duplicates([/\\]|$)` as one more alternative inside `IGNORED`'s group, and extend the comment above it to mention it.

- [ ] **Step 5: Store geometry from thumbnails.** In `generateThumbnail`, keep the result of `renderInWorker`: when it's null, throw the same error as today; otherwise also set `geo_key = ?` in the existing `UPDATE`.

- [ ] **Step 6: Run `cd backend && for f in src/db/schema.js src/services/zipScanner.js src/services/scanner.js src/services/thumbnailer.js; do node --check $f; done && npm test`.** Expected: no syntax errors, and the tests pass.

- [ ] **Step 7: Commit** `feat: store content and geometry keys on files`.

---

### Task 4: Background fingerprinter for loose files and old zips

**Files:**
- Create: `backend/src/services/fingerprinter.js`
- Modify: `backend/src/services/scanner.js` (queue new and changed loose files)
- Modify: `backend/src/index.js` (start after watcher ready; `/api/status`)

**Interfaces:**
- Consumes: `crc32File`, `contentKey` (Task 1), `scanZip` (existing), `getPendingCount` (thumbnailer).
- Produces:
  - `startFingerprinter() => void`. Safe to call once. It (1) re-scans, one at a time, each `DISTINCT zip_source` that has entries with `content_key IS NULL`, then (2) hashes loose rows (`zip_source IS NULL`) that have `content_key IS NULL AND (fingerprint_error IS NULL OR fingerprint_error LIKE 'geo:%')`. A geometry failure must not block the CRC.
  - `queueFingerprint(fileId: string) => void` (for the scanner, after the fingerprinter has started; ignored before that, because startup picks those rows up).
  - `getFingerprintPending() => number`.

- [ ] **Step 1: Implement `fingerprinter.js`.**
  - It's a single sequential loop.
  - Before each item, if `getPendingCount() > 0` (thumbnails are rendering), wait 10 s and check again.
  - On success, run `UPDATE files SET content_key = ? WHERE id = ? AND size = ?`. The size guard means a file that changed mid-read is left for its requeue.
  - If the file is missing or unreadable, set `fingerprint_error` to the message.
  - Log progress every 1000 files: `Fingerprinted N/M loose files`.

- [ ] **Step 2: Wire the scanner and startup.**
  - In `upsertFile`, after the upsert, call `queueFingerprint(row.id)` when the row comes back with no `content_key`. Add `content_key` to the `RETURNING` list.
  - In `index.js`, call `startFingerprinter()` inside the `startWatcher` ready callback, after `queueAll()`.
  - Add `fingerprintPending: getFingerprintPending()` to `/api/status`.

- [ ] **Step 3: Run `node --check` on the three files, then `npm test`.** Expected: clean.

- [ ] **Step 4: Commit** `feat: fingerprint loose files and re-key old zips in the background`.

---

### Task 5: Geometry backfill and first deploy

**Files:**
- Modify: `backend/src/services/thumbnailer.js`
- Modify: `backend/src/index.js`

**Interfaces:**
- Consumes: worker `mode: 'geo'` (Task 2), `cachePathFor` (Task 3).
- Produces: `queueGeoBackfill() => number`. It loads the ids of rows where the name ends in `.stl`, `thumbnail_path IS NOT NULL AND geo_key IS NULL AND fingerprint_error IS NULL`, and returns the count. Also `getGeoPending() => number`.

- [ ] **Step 1: Add a third, lowest-priority queue (`geoQueue`).**
  - `drainQueue` takes from it only when both `priority` and `queue` are empty.
  - A geo job resolves the STL path like `generateThumbnail` does. For a zip entry, note whether `cachePathFor(...)` already existed before calling `extractToCache`; if it didn't, `fs.rmSync` the extracted file in a `finally` once the job is done.
  - Post `{ mode: 'geo' }`. On a result, `UPDATE files SET geo_key = ?`. A null result or an error sets `fingerprint_error = 'geo: <message>'`.

- [ ] **Step 2: Call `queueGeoBackfill()` in the ready callback** in `index.js` and log the count. Add `geoPending: getGeoPending()` to `/api/status`.

- [ ] **Step 3: Run `node --check` and `npm test`.** Expected: clean.

- [ ] **Step 4: Deploy only the backend** (see Global Constraints, `<svc>` = `backend`). Fingerprinting takes days, so it starts here rather than at the end.

- [ ] **Step 5: Verify live.** Wait for startup, about 2 minutes, then:

```bash
docker --context nas exec stl-manager-api du -sm /data/cache   # note before
docker --context nas exec stl-manager-api sqlite3 /data/stl-manager.db \
  "SELECT SUM(zip_source IS NOT NULL AND content_key IS NOT NULL), SUM(zip_source IS NULL AND content_key IS NOT NULL), SUM(geo_key IS NOT NULL), SUM(fingerprint_error IS NOT NULL) FROM files"
curl -sk https://192.168.5.125:8443/api/status
```

Expected:
- the zip-key count rises toward ~102k within minutes;
- the loose-key count rises steadily;
- `geo_key` rises;
- `/api/status` shows `fingerprintPending` and `geoPending`;
- after 10 minutes, `du -sm /data/cache` has grown by no more than a few hundred MB (Review Focus 5).

- [ ] **Step 6: Commit** `feat: backfill geometry keys for existing thumbnails`.

---

### Task 6: Grouping engine (pure)

**Files:**
- Create: `backend/src/services/dedupe.js`
- Create: `backend/test/dedupe.test.js`

**Interfaces:**
- Produces `buildGroups(rows: FileRow[], { linkedPaths: string[], stlRoot: string }) => { folders: Group[], contained: Group[], files: Group[], geometry: Group[] }`, each list sorted by `reclaimable` descending, ties broken by `signature`.

```ts
FileRow = { id: string, logical: string,        // "Creator/Pack.zip/Model/x.stl"
            zipLogical: string | null,          // "Creator/Pack.zip" for zip entries
            real: string,                       // abs path on disk: the loose file, or the zip for an entry
            size: number, contentKey: string | null, geoKey: string | null, hasThumb: boolean }
Member = { path: string,                        // logical path of the folder/zip/file
           real: string,                        // abs disk path: folder, zip file, loose file; for anything inside a zip, the zip
           isZip: boolean, inZip: boolean, isFolder: boolean,
           size: number, fileCount: number, thumbIds: string[] /* ≤4, rows with hasThumb */, linked: boolean,
           container?: true }                   // set on B in a 'contained' group
Group  = { kind: 'folders' | 'contained' | 'files' | 'geometry', signature: string,
           key: string, reclaimable: number, members: Member[], suggested: string | null }
```

- [ ] **Step 1: Write the failing tests.** Use a `row(logical, key, opts)` helper that derives `zipLogical`, `real` (`stlRoot + '/' + …`) and `size` (default 100):

```js
test('identical loose files group', …)                       // files: 1 group, 2 members, reclaimable 100
test('zip and its extracted folder group as folders', …)     // A/Pack.zip/{a,b} vs A/Pack/{a,b} → 1 folders group, suggested null
test('single-folder chain inside a zip collapses to the zip', …) // A/P.zip/P/{a,b} vs B/P/{a,b} → members ['A/P.zip','B/P']
test('only the topmost duplicated folder is reported', …)    // A/X/{s1/a, s2/b} vs B/X/{…} → 1 group, no s1/s2 groups
test('file groups inside a reported folder group are suppressed', …)
test('a file group with one copy outside the folder groups stays, with all members', …)
test('folder with an unkeyed file is never grouped', …)      // Review Focus 1
test('root and top-level folders are never members', …)      // A/{a,b} vs B/{a,b} → no folders group
test('contained: subset folder reported against its superset', …) // A/Sup/{a,b,c} ⊂ B/Pack/{a,b,c,d} → kind contained, suggested 'B/Pack', container on B, reclaimable 300
test('contained needs at least 3 files', …)
test('contained is not reported for a descendant', …)
test('geometry groups need two content keys and never suggest', …)
test('keeper prefers a linked member', …)                    // linkedPaths ['B/X/model'] → suggested 'B/X'
test('keeper prefers the bigger top-level folder, then the shorter path', …)
test('signature is stable across row order and changes with members', …)
```

- [ ] **Step 2: Run `npm test`.** Expected: dedupe tests FAIL (module missing).

- [ ] **Step 3: Implement `dedupe.js`.**
  - Build a tree from `logical` segments. Each node is `{ path, depth, parent, children, files, isZip, inZip, size, fileCount, keys }`:
    - `isZip` is true when `path` equals some row's `zipLogical`;
    - `inZip` is true for nodes strictly below a zip;
    - `real` is the zip's `real` for `isZip`/`inZip` nodes, otherwise `stlRoot + '/' + path`.
  - Node signature: sha1 of the sorted `contentKey`s of every file beneath the node, or `null` if any file beneath it has no key.
  - **folders:**
    - Group the nodes with `depth >= 2` and a non-null signature.
    - Drop a member if its parent has the same signature (chain), or if its parent's signature is shared by at least 2 nodes (covered).
    - Keep the groups that still have at least 2 members.
  - **contained:**
    - For each node A with `depth >= 2`, `fileCount >= 3` and a non-null signature that isn't a member or descendant of a folders-group member:
      - pick A's rarest key, the one fewest files share;
      - for each file with that key outside A, walk up its ancestors (`depth >= 2`, not an ancestor of A) and stop at the first B whose key multiset contains A's and is strictly larger.
    - Skip A if `A.parent` is also contained in the same B (topmost only).
    - Members are `[A, B]`, with `container: true` on B and `suggested = B.path`.
  - **files:**
    - Group rows by `contentKey` (at least 2 rows).
    - Drop a group when every member lies inside some folders-group member or some contained A.
  - **geometry:** group rows by `geoKey` when the members have at least 2 distinct `contentKey`s.
  - **reclaimable:**
    - folders and geometry: total minus the largest member;
    - contained: A's size;
    - files: `(n−1) × size`.
  - **signature:** sha1 of `kind + '\n' + key + '\n' + sortedMemberPaths.join('\n')`.
  - **suggested** (folders and files only):
    1. `null` when the members mix zipped and unzipped;
    2. otherwise the single linked member, where `linked` means some link path equals the member path or sits under it;
    3. then the member whose top-level node has the most files apart from its own;
    4. then the shortest path, then lexicographic order.

- [ ] **Step 4: Run `npm test`.** Expected: all pass.

- [ ] **Step 5: Commit** `feat: duplicate grouping engine`.

---

### Task 7: Script builder (pure)

**Files:**
- Create: `backend/src/services/dedupeScript.js`
- Create: `backend/test/dedupeScript.test.js`

**Interfaces:**
- Consumes: `Group` and `Member` (Task 6).
- Produces:
  - `planActions(groups: Group[], decisions: Map<signature, { action, keeper_path }>, { stlRoot, hostRoot, zipSize: (real) => number | null }) => { actions: Action[], manual: { path: string, reason: string }[] }`
  - `Action = { type: 'file' | 'dir', path: string /* host abs */, rel: string /* path relative to hostRoot */, keeper: string /* host abs */, expectSize?: number, expectCount?: number }`
  - `buildScript(plan, { mode: 'mv' | 'rm', hostRoot: string }) => string`

- [ ] **Step 1: Write the failing tests.**
  - `planActions` (pure):
    - only groups with a `keep` decision whose `keeper_path` is a member produce actions;
    - an `inZip` member goes to `manual` with reason `inside a zip`;
    - an `isZip` member becomes `type 'file'` with `expectSize: zipSize(real)`, or goes to manual as `zip missing` when that is null;
    - a folder becomes `type 'dir'` with `expectCount: fileCount`;
    - real paths are mapped from `stlRoot` to `hostRoot`;
    - `drops an action whose keeper another action removes` (Review Focus 2): the keeper equals or sits under another action's `path`, so it goes to manual as `keeper is removed by another group`;
    - an action nested under another action's path is dropped as redundant;
    - duplicate paths collapse to one.
  - `buildScript`: run it for real. Build a temp tree, generate a script with `hostRoot` = the temp dir, and run it with `spawnSync('bash', ['-c', script])`:
    - `mv mode moves into _duplicates and keeps the relative path`;
    - `rm mode deletes files and dirs`;
    - `script skips a file whose size changed` (Review Focus 3): append a byte after planning, then expect `SKIP` in stdout and the file still present;
    - `script skips a dir whose model-file count changed`;
    - `script skips when the keeper is gone`;
    - `script skips when the _duplicates target exists` (Review Focus 4);
    - `paths with spaces, quotes, $ and newlines survive`: names like `it's $HOME`, `a\nb`, `x y`;
    - `manual items appear as comments only`;
    - `bash -n accepts the output`.

- [ ] **Step 2: Run `npm test`.** Expected: FAIL (module missing).

- [ ] **Step 3: Implement.**
  - Quote with `q = (s) => "'" + s.replaceAll("'", "'\\''") + "'"` and never interpolate unquoted.
  - The script starts with:
    - `#!/usr/bin/env bash`;
    - `set -uo pipefail` (no `-e`, so a failing guard doesn't stop the run);
    - a comment block with the action count, the bytes reclaimed and the generation time;
    - `ROOT=${DEDUPE_HOST_ROOT:-<q(hostRoot)>}`;
    - helper functions:

```bash
count_models() { find "$1" -type f \( -iname '*.stl' -o -iname '*.3mf' -o -iname '*.obj' \) | wc -l | tr -d ' '; }
act() { # type path rel keeper expect
  [ -e "$4" ] || { echo "SKIP $2: keeper missing"; return; }
  [ -e "$2" ] || { echo "SKIP $2: already gone"; return; }
  if [ "$1" = file ]; then got=$(wc -c < "$2" | tr -d ' '); else got=$(count_models "$2"); fi
  [ "$got" = "$5" ] || { echo "SKIP $2: expected $5, found $got"; return; }
  <mode body>
}
```

  - The `mv` mode body: `dest="$ROOT/_duplicates/$3"; [ -e "$dest" ] && { echo "SKIP $2: $dest exists"; return; }; mkdir -p "$(dirname "$dest")" && mv -- "$2" "$dest" && echo "MOVED $2"`.
  - The `rm` mode body: `rm -rf -- "$2" && echo "REMOVED $2"`.
  - Then one `act` line per action, where `path` and `keeper` are emitted as `"$ROOT"/<q(rel)>` so `DEDUPE_HOST_ROOT` really does move the whole script.
  - Then `# MANUAL <path>: <reason>` lines.

- [ ] **Step 4: Run `npm test`.** Expected: all pass. (macOS bash 3.2, `wc` and `find` are portable to the NAS's GNU tools.)

- [ ] **Step 5: Commit** `feat: build guarded cleanup scripts from decisions`.

---

### Task 8: Store, decisions and API

**Files:**
- Create: `backend/src/services/dedupeStore.js`
- Create: `backend/src/routes/dedupe.js`
- Modify: `backend/src/services/library.js` (export `logicalPath`)
- Modify: `backend/src/index.js` (mount `/api/dedupe`)

**Interfaces:**
- Consumes: `buildGroups` (Task 6), `planActions` and `buildScript` (Task 7), `getFingerprintPending` (Task 4), `getGeoPending` (Task 5).
- Produces these endpoints, all JSON except the script:
  - `GET /api/dedupe/summary` → `{ kinds: { folders|contained|files|geometry: { groups, reclaimable } }, decided, fingerprintPending, geoPending, errors }`
  - `GET /api/dedupe/groups?kind=&decided=undecided|decided|all&page=1&limit=25` → `{ groups: (Group & { decision: { action, keeper_path } | null })[], total, page, limit }`. `undecided` (the default) hides groups that have any decision.
  - `PUT /api/dedupe/decisions/:signature` with body `{ action: 'keep' | 'not_duplicate', keeper_path? }` → `{ ok: true }`; 400 if the group is unknown, or if `action` is `keep` and `keeper_path` is not one of its members.
  - `DELETE /api/dedupe/decisions/:signature` → `{ ok: true }`
  - `GET /api/dedupe/script?mode=mv|rm` → `text/x-shellscript`, with `Content-Disposition: attachment; filename="dedupe-<mode>.sh"`

- [ ] **Step 1: Export `logicalPath` from `library.js`** (it's already defined; keep it in `_test` as well).

- [ ] **Step 2: Implement `dedupeStore.js`.**
  - `getGroups()` loads `id, path, size, zip_source, content_key, geo_key, thumbnail_path` from `files`, maps the rows to `FileRow` using `logicalPath`, takes `linkedPaths` from `SELECT DISTINCT model_path FROM model_links`, and calls `buildGroups`.
  - It caches the result like `getIndex()` in `library.js`: re-checked at most every 15 s against `COUNT(*)|MAX(created_at)|COUNT(content_key)|COUNT(geo_key)`, plus the newest `model_links.created_at`.
  - Also provide `getDecisions() => Map`, `setDecision(sig, { kind, action, keeper_path, members })` (an upsert storing member paths as JSON), `clearDecision(sig)` and `summary()`. `decided` counts only decisions whose signature matches a current group.

- [ ] **Step 3: Implement `routes/dedupe.js`** following the style of `routes/reconcile.js`. For the script, `zipSize` uses `fs.statSync(real).size` (the container sees `/nas` read-only), `stlRoot` is `process.env.STL_ROOT || '/nas'`, and `hostRoot` is `process.env.DEDUPE_HOST_ROOT || '/volume1/3D Files'`. Mount it at `app.use('/api/dedupe', dedupeRouter)`.

- [ ] **Step 4: Deploy the backend and verify.**

```bash
curl -sk https://192.168.5.125:8443/api/dedupe/summary
curl -sk 'https://192.168.5.125:8443/api/dedupe/groups?kind=folders&limit=2'
```

Expected: the summary has counts for all four kinds, and `folders` returns groups with members and `reclaimable`. The first call may take a few seconds (cold build); repeat calls within 15 s should be fast. Then PUT a `not_duplicate` decision on one returned signature, confirm the group no longer appears under `decided=undecided`, and DELETE the decision again.

- [ ] **Step 5: Commit** `feat: duplicate groups, decisions and script API`.

---

### Task 9: Duplicates page

**Files:**
- Create: `frontend/src/components/DuplicatesPage.jsx`
- Modify: `frontend/src/api/client.js` (`dedupe` section)
- Modify: `frontend/src/components/Sidebar.jsx` (item under Purchases, lucide `Copy` icon)
- Modify: `frontend/src/App.jsx` (view `'duplicates'`, hash `#/duplicates`, both in the initial state and in `onHash`, like `purchases`)

**Interfaces:**
- Consumes: Task 8 endpoints.
- Produces `api.dedupe = { summary(), groups(params), decide(signature, body), undecide(signature), scriptUrl(mode) }`. `scriptUrl` returns a string.

- [ ] **Step 1: Add the `api.dedupe` methods** in the same style as `reconcile`.

- [ ] **Step 2: Build `DuplicatesPage({ onNavigate })`, following `PurchasesPage.jsx` for layout and inline styles.**
  - **Summary bar:**
    - total reclaimable, formatted with the existing helper in `utils/format.js`;
    - a "N files still being fingerprinted" line when `fingerprintPending + geoPending > 0`;
    - an Export control: an mv/rm toggle (mv by default) and an `<a href={api.dedupe.scriptUrl(mode)} download>` link.
  - **Tabs** with each kind's count: Folders & zips (`folders`), Contained, Files, Likely same (`geometry`).
  - **Filter:** Undecided / Decided / All.
  - **Paging:** the existing `Pagination` component.
  - **Group card:**
    - reclaimable size;
    - one row per member with: up to 4 thumbnails via `api.files.thumbUrl(id)`; the path; size; file count; a `zip` badge; a `in zip` badge; a `purchase` badge when `linked`; a "container" label for contained groups;
    - a keeper radio per member. It's preselected from `decision?.keeper_path ?? suggested`, but a decision is saved only when a radio is changed or "Keep selected" is pressed;
    - a "Not a duplicate" button;
    - a library link that calls `onNavigate(member.isFolder ? member.path : dirname(member.path))`.
    - After a decision, refetch the list and the summary.
  - **Geometry tab:** show a "likely — check the thumbnails" note and never preselect.

- [ ] **Step 3: Run `cd frontend && npx vite build`.** Expected: the build succeeds with no errors.

- [ ] **Step 4: Deploy the frontend** (`<svc>` = `frontend`). Then fully reload https://192.168.5.125:8443/#/duplicates; a hash change keeps the old bundle. Check in the browser:
  - all four tabs load;
  - thumbnails render;
  - choosing a keeper moves the group to Decided;
  - "Not a duplicate" hides the group;
  - the library link opens the right folder;
  - Export downloads `dedupe-mv.sh`.

- [ ] **Step 5: Commit** `feat: duplicates review page`.

---

### Task 10: Live validation

- [ ] **Step 1: Spot-check groups.** Pick 12 groups of each kind and compare them by hand over `ssh nas`:
  - for folders and contained groups, `ls -R` both sides;
  - for files, run `cmp` on the loose pairs;
  - for geometry, look at the thumbnails.

  Record any false positive and fix the engine with a regression test before going on.

- [ ] **Step 2: Dry-read an export.** Decide about 5 groups, export the `mv` script, and read it with the user:
  - every action has a guard;
  - the paths are right under `/volume1/3D Files`;
  - the manual items make sense.

  The user runs it (`ssh nas 'bash -s' < dedupe-mv.sh`). Then confirm the moved files show up under `_duplicates`, disappear from the index once the watcher catches up, and their groups drop off the page.

- [ ] **Step 3: Update the README** with a short "Duplicates" section: what the kinds mean, the `mv` vs `rm` choice, how to run the script, and `DEDUPE_HOST_ROOT`. Commit `docs: describe the duplicate finder`.
