# Duplicate Finder — Design

Date: 2026-10-24
Status: Approved in conversation, pending spec review

## Goal

Help clean up the STL library by finding duplicate files, folders and zips,
letting the user review each group in the UI, and exporting a script that the
user runs on the NAS to remove the redundant copies.

A rough name+size check on the live library (187k model files, 102k of them
inside zips) already finds ~33k duplicate groups and ~40k redundant copies, so
the payoff is large.

## Decisions (from the user)

- **Report only.** The library stays mounted read-only (`/volume1/3D Files:/nas:ro`).
  The app never moves or deletes files; it produces a script the user runs.
- **What counts as a duplicate:** byte-identical files; duplicate folders and
  zips (including a zip next to its own extracted folder, and a folder that is
  a subset of another); and "same model, different file" by mesh geometry.
  Fuzzy name matching is out.
- **Output:** a review page plus an exported bash script.
- **Keeper for zip-vs-folder groups:** no default — the user decides per group.

## Non-goals

- Deleting or moving files from inside the app.
- Fuzzy folder/file name matching.
- Geometry fingerprints for 3MF/OBJ (the renderer only parses STL today).
- Other cleanup (empty folders, `__MACOSX`/`.lys` junk, broken zips). Possible follow-up.

## 1. Fingerprints

New additive columns on `files` (same migration pattern as `thumb_error`):

| column | meaning |
|---|---|
| `content_key` | `"<crc32 hex>:<size>"`; identical bytes ⇒ identical key |
| `geo_key` | geometry fingerprint for STLs, NULL otherwise |
| `fingerprint_error` | why hashing/parsing failed; set means "skip until the file changes" |

Both keys and the error are cleared when a file's `size` or `modified_at`
changes (same `CASE` pattern the upserts already use for `thumb_error`).

CRC32 + size is used for every file so loose files and zip entries share one
key space; that is what lets a zip match its extracted folder. A false match
needs a 32-bit CRC collision between two files of exactly the same size, which
is negligible at this library's scale, and the script re-checks sizes before
acting (section 5).

**Zip entries.** `scanZip` already walks the central directory; it also saves
`entry.crc32` and `entry.uncompressedSize` as `content_key`. Zips indexed
before this change have no key: on startup, after the watcher is ready, zips
that have entries with a NULL `content_key` are re-scanned one at a time
(central directory only, no extraction).

**Loose files.** A background fingerprint queue (`services/fingerprinter.js`)
streams each loose file with a NULL `content_key` through CRC32 (a small table-based
implementation in `services/crc32.js`; the image runs Node 20, which lacks `zlib.crc32`). One file at a
time, I/O-bound, started after the watcher's initial scan. New and changed
files are queued by the scanner's upsert, as thumbnails are today.

**Geometry (`geo_key`).** Computed from a parsed STL mesh:

- triangle count;
- bounding-box side lengths, sorted ascending (so a copy rotated 90° matches);
- surface area and absolute signed volume;

each rounded to 3 significant figures and joined into a string, e.g.
`"t812004|b31.2,40.5,62.0|a9120|v18300"`. This is a heuristic; groups built
from it are labelled "likely" and never auto-selected.

- New/changed STLs: the thumbnail worker already parses the mesh, so
  `renderStlToJpeg` also returns the `geo_key` and `generateThumbnail` stores it.
- Already-thumbnailed STLs: a low-priority backfill in the same worker pool
  parses the mesh without rendering (`geoKeyForStl`). It only runs when no
  thumbnails are pending. Zip entries are extracted with `extractToCache` as for
  thumbnails. Expect this to take hours to days on the NAS; groups fill in as it runs.
- The mesh is parsed in full for the fingerprint (not decimated via `MAX_TRIS`
  sampling) so the area/volume are exact.

## 2. Grouping engine — `services/dedupe.js`

Pure functions over rows from `files`, plus a cached result rebuilt the same
way the library index is (signature check every 15 s, rebuilt on demand).
Paths use `logicalPath` from `library.js`, so a zip behaves like a folder.

Rows without a `content_key` are left out; the page shows how many are still
pending so the user knows results are incomplete.

**Identical files.** Rows grouped by `content_key`, ≥ 2 members. Members that
fall inside a folder/zip already reported as an identical folder group are
dropped from the file list, so a duplicated pack doesn't also show up as
thousands of file groups.

**Identical folders/zips.** For every folder/zip node, the multiset of
`content_key`s of all files beneath it, hashed to a node signature. Nodes with
equal signatures and ≥ 1 file form a group. Only the topmost match is
reported: if two nodes match, their matching children are not reported again.
The library root and top-level creator folders are never grouped.

**Contained.** Node A is reported as contained in node B when A's key set is a
strict subset of B's and A isn't inside B. To keep this tractable, candidate
pairs come from nodes that share their rarest key; only pairs where A has ≥ 3
files are reported. Shown as "A is fully contained in B".

**Same geometry ("likely").** Rows grouped by `geo_key` where members have
more than one distinct `content_key`. Each group is shown with thumbnails.

**Per group** the engine returns: kind, members (logical path, real path, zip
or not, size, file count, thumbnail ids), reclaimable bytes (total minus the
largest member), a stable group signature, and a suggested keeper.

**Suggested keeper** (identical/contained groups only; the superset is always
the keeper for "contained"):

1. none if the group mixes a zip and a folder (the user decides);
2. the member that has a `model_links` row (it is tied to a purchase);
3. the member whose top-level folder holds the most other files (an organised creator folder rather than an `Unsorted`/`Downloads` dump);
4. the shortest path.

## 3. Decisions — `dedupe_decisions` table

```sql
CREATE TABLE IF NOT EXISTS dedupe_decisions (
  signature   TEXT PRIMARY KEY,   -- group signature from the engine
  kind        TEXT NOT NULL,      -- 'files' | 'folders' | 'contained' | 'geometry'
  action      TEXT NOT NULL,      -- 'keep' | 'not_duplicate'
  keeper_path TEXT,               -- logical path of the member to keep
  members     TEXT NOT NULL,      -- JSON array of member logical paths at decision time
  decided_at  TEXT DEFAULT (datetime('now'))
);
```

The signature covers the group's keys and its member paths, so a decision is
dropped automatically if files are added, removed or changed. "Not a
duplicate" hides the group from the page.

## 4. API — `routes/dedupe.js` mounted at `/api/dedupe`

- `GET /summary` → counts and reclaimable bytes per kind, decided count, files still pending fingerprinting.
- `GET /groups?kind=folders|files|contained|geometry&page=&limit=&decided=` → groups sorted by reclaimable bytes desc.
- `PUT /decisions/:signature` `{ action, keeper_path }` / `DELETE /decisions/:signature`.
- `GET /script?mode=mv|rm` → `text/x-shellscript` download covering decided groups only.

## 5. Script export

Generated by a pure function `buildScript(decisions, mode)` in `services/dedupeScript.js`.

- Header: `set -euo pipefail`, a comment block listing the totals, and `ROOT='/volume1/3D Files'`
  (configurable via `DEDUPE_HOST_ROOT`, since the container sees `/nas`).
- `mv` mode (default): moves each removed member to `"$ROOT/_duplicates/<logical path>"`,
  creating parent dirs. Reversible; the user empties `_duplicates` when satisfied.
  `_duplicates` is added to the scanner's `IGNORED` pattern so moved files leave the index.
- `rm` mode: `rm -rf --` on folders, `rm -f --` on files.
- Every action is guarded: it runs only if the keeper still exists and the
  removed member still has the expected size (files) or file count (folders);
  otherwise it prints `SKIP <path>: <reason>` and continues.
- Zip entries can't be removed without rewriting the zip. A member that is a
  zip entry (rather than a whole zip) is never a removal target; if a group's
  only removable members are entries inside zips, the group is listed in the
  script as a comment for manual handling.
- All paths are single-quoted with embedded `'` escaped; no other shell
  expansion of user data.
- The user runs it with `ssh nas 'bash -s' < dedupe.sh` (or copies it over);
  the watcher then removes the vanished files from the index.

## 6. Frontend — Duplicates page

- Route `#/duplicates`, linked from the header next to Purchases.
- Top: total reclaimable, per-kind counts, "N files still being fingerprinted",
  and an Export button (mode toggle mv/rm, mv default).
- Tabs: Folders & zips · Contained · Files · Likely same.
- Each group card: reclaimable size; members with thumbnail strip, path,
  size, file count, zip badge, "linked to purchase" badge; a keeper radio per
  member (preselected with the suggestion if there is one); "Not a duplicate";
  link to open the member in the library view. Choosing a keeper saves a decision.
- Filter: undecided / decided / all. Paginated with the existing `Pagination` component.
- Component: `frontend/src/components/DuplicatesPage.jsx`, API calls in `api/client.js`.

## 7. Errors

- Unreadable/vanished files: `fingerprint_error` set, row excluded from grouping, count shown in the summary.
- STL parse failures in the geometry backfill set `fingerprint_error` only for `geo_key`
  (the `content_key` from CRC is kept); stored as a prefixed message `geo: …`.
- Engine rebuild failures return a 500 from `/api/dedupe/*`; the rest of the app is unaffected.
- Fingerprinting yields to the thumbnail queue and pauses while the watcher's initial scan is running.

## 8. Testing

The repo has no tests yet. Add `node --test` (built in, no dependency) with
`"test": "node --test"` in `backend/package.json`:

- `dedupe.js`: identical files; identical folders incl. zip-vs-folder;
  topmost-only reporting; file groups suppressed inside folder groups;
  contained detection; geometry groups; keeper rules incl. the zip/folder "no
  suggestion" case; signatures stable across row order.
- `dedupeScript.js`: quoting of paths with spaces, `'`, `$`, and newlines;
  guards present on every action; zip-entry members never removed; mv vs rm.
- `geoKey`: a copy rotated by 90° about any axis gives the same key; a scaled copy doesn't.

Then a live run on the NAS: let fingerprinting finish on a subset, spot-check
a dozen groups of each kind by hand, and dry-read an exported script before
the user runs it.
