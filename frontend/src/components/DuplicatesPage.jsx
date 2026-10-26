import { useState } from 'react';
import { Loader, Folder, FolderArchive, FileText, Undo2, ExternalLink, Download } from 'lucide-react';
import { api } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { formatCount, formatBytes } from '../utils/format.js';
import Pagination from './Pagination.jsx';

const KINDS = [
  { id: 'folders',  label: 'Folders & zips' },
  { id: 'contained', label: 'Contained' },
  { id: 'files',    label: 'Files' },
  { id: 'geometry', label: 'Likely same' },
];

const FILTERS = [
  { id: 'undecided', label: 'Undecided' },
  { id: 'decided',   label: 'Decided' },
  { id: 'all',       label: 'All' },
];

const PAGE_SIZES = [24, 48, 96];  // the API clamps limit to 100

const s = {
  wrapper: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 },
  toolbar: {
    padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex',
    alignItems: 'center', gap: 12, background: 'var(--surface)', minHeight: 41, flexWrap: 'wrap',
  },
  title: { fontSize: 15, fontWeight: 600 },
  dim: { fontSize: 12, color: 'var(--text-dim)' },
  warn: { fontSize: 12, color: '#f59e0b' },
  tabs: { display: 'flex', gap: 4, flexWrap: 'wrap' },
  tab: (active) => ({
    padding: '4px 10px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--accent)' : 'var(--surface2)',
    color: active ? '#fff' : 'var(--text-dim)',
  }),
  btn: (variant = 'ghost') => ({
    padding: '5px 10px', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 12,
    display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
    border: variant === 'ghost' ? '1px solid var(--border)' : 'none',
    background: variant === 'primary' ? 'var(--accent)' : 'var(--surface2)',
    color: variant === 'primary' ? '#fff' : 'var(--text-dim)',
    textDecoration: 'none',
  }),
  list: { flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 },
  card: {
    display: 'flex', flexDirection: 'column', gap: 6, padding: 10,
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
  },
  cardHead: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12 },
  member: {
    display: 'flex', gap: 10, alignItems: 'center', padding: 6, borderRadius: 8,
    background: 'var(--surface2)', border: '1px solid var(--border)',
  },
  thumbs: { display: 'flex', gap: 4, flexShrink: 0 },
  thumb: {
    width: 56, height: 56, borderRadius: 6, objectFit: 'cover', flexShrink: 0,
    background: 'var(--surface)', border: '1px solid var(--border)',
  },
  main: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 },
  path: { fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  meta: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 11, color: 'var(--text-dim)' },
  badge: (color = 'var(--accent)') => ({
    fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 10,
    color, border: `1px solid ${color}`, whiteSpace: 'nowrap',
  }),
  actions: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 2 },
  error: { fontSize: 12, color: '#f87171' },
  empty: { textAlign: 'center', padding: 60, color: 'var(--text-dim)' },
};

const dirname = (p) => p.slice(0, Math.max(p.lastIndexOf('/'), 0));

// The API returns errors as {"error": "..."} text
function errorText(e) {
  try { return JSON.parse(e.message).error ?? e.message; } catch { return e.message; }
}

function Thumbs({ ids }) {
  const shown = ids.slice(0, 4);
  if (!shown.length) return <div style={s.thumbs}><div style={s.thumb} /></div>;
  return (
    <div style={s.thumbs}>
      {shown.map((id) => <img key={id} src={api.files.thumbUrl(id)} alt="" loading="lazy" style={s.thumb} />)}
    </div>
  );
}

function Member({ member, kind, checked, disabled, onPick, onOpen }) {
  const Icon = member.isFolder ? Folder : member.isZip ? FolderArchive : FileText;
  return (
    <div style={s.member}>
      <label style={{ ...s.meta, cursor: 'pointer', flexShrink: 0 }}>
        <input type="radio" checked={checked} disabled={disabled} onChange={onPick} />
        Keep
      </label>
      <Thumbs ids={member.thumbIds ?? []} />
      <div style={s.main}>
        <div style={s.path} title={member.path}>{member.path}</div>
        <div style={s.meta}>
          <Icon size={12} />
          <span>{formatBytes(member.size)}</span>
          {member.fileCount > 0 && <span>{formatCount(member.fileCount)} files</span>}
          {member.isZip && <span style={s.badge('#f59e0b')}>zip</span>}
          {member.inZip && <span style={s.badge('#f59e0b')}>in zip</span>}
          {member.linked && <span style={s.badge('#10b981')}>purchase</span>}
          {kind === 'contained' && member.container && <span style={s.badge()}>contains all of the other</span>}
        </div>
      </div>
      <button
        type="button"
        style={s.btn()}
        title="Open in the library"
        onClick={() => onOpen(member.isFolder ? member.path : dirname(member.path))}
      >
        <ExternalLink size={12} /> Library
      </button>
    </div>
  );
}

function GroupCard({ group, onChanged, onNavigate }) {
  const { kind, signature, members, decision } = group;
  const geometry = kind === 'geometry';
  const initial = decision ? (decision.keeper_path ?? null) : (geometry ? null : group.suggested ?? null);
  const [picked, setPicked] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const decided = !!decision;

  async function run(fn) {
    setBusy(true);
    setErr(null);
    try { await fn(); await onChanged(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  }

  const keep = (path) => run(() => api.dedupe.decide(signature, { action: 'keep', keeper_path: path }));

  return (
    <div style={s.card}>
      <div style={s.cardHead}>
        <strong>{formatBytes(group.reclaimable)} reclaimable</strong>
        <span style={s.dim}>{members.length} copies</span>
        {geometry && <span style={s.warn}>Likely the same (mirrored left/right copies match too), check the thumbnails</span>}
        {decided && (
          <span style={s.badge('#10b981')}>
            {decision.action === 'keep' ? 'Keeping one' : 'Not a duplicate'}
          </span>
        )}
        {decided && (
          <button style={s.btn()} disabled={busy} onClick={() => run(() => api.dedupe.undecide(signature))}>
            <Undo2 size={12} /> Undo
          </button>
        )}
      </div>
      {members.map((m) => (
        <Member
          key={m.path}
          member={m}
          kind={kind}
          checked={picked === m.path}
          disabled={busy}
          onPick={() => { setPicked(m.path); keep(m.path); }}
          onOpen={onNavigate}
        />
      ))}
      <div style={s.actions}>
        <button style={s.btn('primary')} disabled={busy || !picked} onClick={() => keep(picked)}>Keep selected</button>
        <button
          style={s.btn()}
          disabled={busy}
          onClick={() => run(() => api.dedupe.decide(signature, { action: 'not_duplicate' }))}
        >
          Not a duplicate
        </button>
        {busy && <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} />}
        {err && <span style={s.error}>{err}</span>}
      </div>
    </div>
  );
}

export default function DuplicatesPage({ onNavigate }) {
  const [kind, setKind] = useState('folders');
  const [filter, setFilter] = useState('undecided');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(48);
  const [mode, setMode] = useState('mv');

  const summary = useApi(() => api.dedupe.summary());
  const list = useApi(
    () => api.dedupe.groups({ kind, decided: filter, page, limit: pageSize }),
    [kind, filter, page, pageSize],
  );

  const sum = summary.data;
  const reclaimable = sum ? Object.entries(sum.kinds).reduce((n, [k, v]) => (k === 'geometry' ? n : n + (v.reclaimable ?? 0)), 0) : 0;
  const pending = sum ? (sum.fingerprintPending ?? 0) + (sum.geoPending ?? 0) : 0;
  const groups = list.data?.groups ?? [];

  const changed = () => Promise.all([summary.refresh(), list.refresh()]);
  const pick = (setter) => (v) => { setter(v); setPage(1); };

  return (
    <div style={s.wrapper}>
      <div style={s.toolbar}>
        <span style={s.title}>Duplicates</span>
        {sum && <span style={s.dim}>{formatBytes(reclaimable)} reclaimable, excluding likely-same</span>}
        {pending > 0 && <span style={s.warn}>{formatCount(pending)} files still being fingerprinted</span>}
        <div style={{ flex: 1 }} />
        <div style={s.tabs}>
          {['mv', 'rm'].map((m) => (
            <span key={m} style={s.tab(mode === m)} onClick={() => setMode(m)}>{m}</span>
          ))}
        </div>
        {mode === 'rm' && <span style={s.warn}>deletes single files permanently; folders and zips are still moved to _duplicates</span>}
        <a style={s.btn('primary')} href={api.dedupe.scriptUrl(mode)} download>
          <Download size={12} /> Export script
        </a>
      </div>
      <div style={s.toolbar}>
        <div style={s.tabs}>
          {KINDS.map((k) => (
            <span key={k.id} style={s.tab(kind === k.id)} onClick={() => pick(setKind)(k.id)}>
              {k.label}{sum?.kinds?.[k.id] ? ` (${formatCount(sum.kinds[k.id].groups)})` : ''}
            </span>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <div style={s.tabs}>
          {FILTERS.map((f) => (
            <span key={f.id} style={s.tab(filter === f.id)} onClick={() => pick(setFilter)(f.id)}>{f.label}</span>
          ))}
        </div>
      </div>
      <div style={s.list}>
        {list.error && <div style={s.error}>{errorText({ message: list.error })}</div>}
        {list.loading && !list.data && <div style={s.empty}><Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /></div>}
        {list.data && !groups.length && <div style={s.empty}>No duplicate groups here.</div>}
        {groups.map((g) => (
          <GroupCard
            key={`${g.signature}:${g.decision?.action ?? ''}:${g.decision?.keeper_path ?? ''}`}
            group={g}
            onChanged={changed}
            onNavigate={onNavigate}
          />
        ))}
      </div>
      <Pagination
        page={page}
        pageSize={pageSize}
        total={list.data?.total ?? 0}
        noun="groups"
        onPage={setPage}
        sizes={PAGE_SIZES}
        onPageSize={setPageSize}
      />
    </div>
  );
}
