// Cleanup script builder. Pure: turns reviewed duplicate groups into a bash script
// the user runs on the NAS host. This is the only path that touches the user's
// files, so every action is guarded in the script and nothing kept is ever removed.
//
// Action = { type: 'file' | 'dir', path, rel, keeper, expectSize?, expectCount?, size }
//   path/keeper are host absolute paths, rel is path relative to hostRoot,
//   size is the bytes it frees (for the script's totals).

const KEEPER_REMOVED = 'keeper is removed by another group';

const trimSlash = s => s.replace(/\/+$/, '');
// p equals a or sits under it, on a '/' boundary (a/b is not under a/bc)
const atOrUnder = (p, a) => p === a || p.startsWith(a + '/');
// A usable relative path: never empty, never ROOT itself, never escaping it
const safeRel = rel => (rel === '' || rel.split('/').some(s => s === '' || s === '.' || s === '..') ? null : rel);

export function planActions(groups, decisions, { stlRoot, hostRoot, zipSize }) {
  const stl = trimSlash(stlRoot);
  const host = trimSlash(hostRoot);
  const toRel = real => (real.startsWith(stl + '/') ? safeRel(real.slice(stl.length + 1)) : null);

  const collected = [];
  const manual = [];
  for (const g of groups) {
    const d = decisions.get(g.signature);
    if (!d || d.action !== 'keep') continue;
    const keeper = g.members.find(m => m.path === d.keeper_path);
    if (!keeper) continue;
    const keeperRel = toRel(keeper.real);
    for (const m of g.members) {
      if (m === keeper) continue;
      const out = reason => manual.push({ path: m.path, reason });
      if (m.inZip) { out('inside a zip'); continue; }
      // A container also holds files its subset lacks
      if (m.container) { out('holds files the keeper lacks'); continue; }
      const rel = toRel(m.real);
      if (rel === null || keeperRel === null) { out('outside the library'); continue; }
      const base = { path: `${host}/${rel}`, rel, keeper: `${host}/${keeperRel}` };
      if (m.isZip) {
        const bytes = zipSize(m.real);
        if (bytes == null) { out('zip missing'); continue; }
        collected.push({ type: 'file', zip: true, ...base, expectSize: bytes, size: bytes, member: m.path });
      } else if (m.isFolder) {
        collected.push({ type: 'dir', ...base, expectCount: m.looseCount + (m.zipCount ?? 0), size: m.size, member: m.path });
      } else {
        collected.push({ type: 'file', ...base, expectSize: m.size, size: m.size, member: m.path });
      }
    }
  }

  // The same copy can be a non-keeper in several groups
  const seen = new Set();
  const unique = collected.filter(a => !seen.has(a.path) && seen.add(a.path));

  // Groups overlap: never remove something that holds another group's keeper.
  // One pass suffices since this only ever drops actions.
  const safe = unique.filter(a => {
    if (!unique.some(o => atOrUnder(a.keeper, o.path))) return true;
    manual.push({ path: a.member, reason: KEEPER_REMOVED });
    return false;
  });

  // Inside another removed path: redundant
  const actions = safe
    .filter(a => !safe.some(o => o !== a && atOrUnder(a.path, o.path)))
    .map(({ member, ...a }) => a);
  return { actions, manual };
}

// Single-quoted shell word; nothing in it is expanded
const q = s => "'" + s.replaceAll("'", "'\\''") + "'";
// Comment text must stay on one line, or a path could become a command
const oneLine = s => s.replace(/[\r\n]/g, m => (m === '\n' ? '\\n' : '\\r'));

const MV_BODY = 'dest="$ROOT/_duplicates/$3"; [ -e "$dest" ] && { echo "SKIP $2: $dest exists"; return; }; '
  + 'mkdir -p "$(dirname "$dest")" && mv -- "$2" "$dest" && echo "MOVED $2" || echo "FAIL $2"';
// rm mode only ever deletes one loose model file ($6 = rm); the guards above have
// already proven it is a regular file of the expected size
const RM_BODY = 'if [ "$6" = rm ]; then rm -f -- "$2" && echo "REMOVED $2" || echo "FAIL $2"; return; fi; ';
const MODES = ['mv', 'rm'];

// Groups compare model files only, so a folder or zip can hold unique images, PDFs or
// project files. Those are never deleted, whatever the mode.
const deletable = a => a.type === 'file' && !a.zip && !/\.zip$/i.test(a.rel);

// Model and zip files the scanner indexes, below "$1" only, skipping what it ignores
const COUNT_MODELS = 'count_models() { ( cd -- "$1" >/dev/null && find . \\( -name \'.*\' -o -name \'@*\' '
  + '-o -iname __MACOSX -o -iname _duplicates -o -iname \'#recycle\' -o -iname \'#snapshot\' \\) '
  + '! -name . -prune -o -type f \\( -iname \'*.stl\' -o -iname \'*.3mf\' -o -iname \'*.obj\' -o -iname \'*.zip\' \\) -print ) '
  + '| wc -l | tr -d \' \'; }';

export function buildScript(plan, { mode, hostRoot }) {
  if (!MODES.includes(mode)) throw new Error(`unknown mode: ${mode}`);
  const host = trimSlash(hostRoot);
  const relOf = p => (p.startsWith(host + '/') ? safeRel(p.slice(host.length + 1)) : null);
  const bytes = plan.actions.reduce((s, a) => s + (a.size ?? 0), 0);

  const lines = [
    '#!/usr/bin/env bash',
    'set -uo pipefail', // no -e: a failed guard skips one action, not the rest
    `# STL Manager duplicate cleanup (${mode} mode)`,
    `# ${plan.actions.length} actions, ${bytes} bytes reclaimed, ${plan.manual.length} for manual handling`,
    `# Generated ${new Date().toISOString()}`,
    '# Each action runs only if its keeper exists and the copy is unchanged; otherwise SKIP.',
    ...(mode === 'rm' ? ['# rm deletes single loose model files only. Folders and zips are moved to _duplicates/',
      '# instead, since they may hold images, PDFs or project files that no duplicate check covered.'] : []),
    `ROOT=\${DEDUPE_HOST_ROOT:-${q(host)}}`,
    '',
    COUNT_MODELS,
    'act() { # type path rel keeper expect disposal',
    '  [ -e "$4" ] || { echo "SKIP $2: keeper missing"; return; }',
    '  [ -e "$2" ] || { echo "SKIP $2: already gone"; return; }',
    '  if [ "$1" = file ]; then [ -f "$2" ] || { echo "SKIP $2: not a file"; return; }; got=$(wc -c < "$2" | tr -d \' \');',
    '  else [ -d "$2" ] || { echo "SKIP $2: not a folder"; return; }; got=$(count_models "$2"); fi',
    '  [ "$got" = "$5" ] || { echo "SKIP $2: expected $5, found $got"; return; }',
    `  ${mode === 'rm' ? RM_BODY : ''}${MV_BODY}`,
    '}',
    '',
  ];
  for (const a of plan.actions) {
    const rel = relOf(a.path), keeperRel = relOf(a.keeper);
    if (rel === null || keeperRel === null) throw new Error(`action outside hostRoot: ${a.path}`);
    const expect = a.type === 'file' ? a.expectSize : a.expectCount;
    if (!Number.isInteger(expect)) throw new Error(`action without expectation: ${a.path}`);
    lines.push(`act ${a.type === 'file' ? 'file' : 'dir'} "$ROOT"/${q(rel)} ${q(rel)} "$ROOT"/${q(keeperRel)} ${expect} ${mode === 'rm' && deletable(a) ? 'rm' : 'mv'}`);
  }
  if (plan.manual.length) lines.push('');
  for (const m of plan.manual) lines.push(`# MANUAL ${oneLine(m.path)}: ${oneLine(m.reason)}`);
  return lines.join('\n') + '\n';
}
