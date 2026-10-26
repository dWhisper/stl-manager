import { useState, useEffect, useMemo, useRef } from 'react';
import {
  RefreshCw, Loader, ExternalLink, Download, Check, X, Folder, Box, Search,
  EyeOff, Eye, Link2, Unlink, Copy, ShoppingBag, Upload,
} from 'lucide-react';
import { api } from '../api/client.js';
import { formatCount } from '../utils/format.js';
import Pagination, { usePageSize } from './Pagination.jsx';
import { MMF_EXPORT_SCRIPT } from '../utils/mmfExportScript.js';

// Cults purchases sync through its API. MyMiniFactory's API has no purchases
// endpoint, so its library data is saved from the browser and uploaded.
const PLATFORMS = [
  { id: 'cults3d', label: 'Cults 3D', mode: 'sync' },
  { id: 'myminifactory', label: 'MyMiniFactory', mode: 'import' },
];

const MMF_DATA_URL = 'https://www.myminifactory.com/data-library/purchases';

const FILTERS = [
  { id: 'missing',  label: 'Missing',  hint: 'Bought, but not found on the NAS' },
  { id: 'possible', label: 'Check',    hint: 'Might be on the NAS; confirm or reject the suggestion' },
  { id: 'found',    label: 'On NAS',   hint: 'Found on the NAS' },
  { id: 'ignored',  label: 'Ignored',  hint: "Things you don't want on the NAS" },
  { id: 'all',      label: 'All',      hint: 'Everything' },
];

const s = {
  wrapper: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 },
  toolbar: {
    padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex',
    alignItems: 'center', gap: 12, background: 'var(--surface)', minHeight: 41, flexWrap: 'wrap',
  },
  title: { fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 },
  dim: { fontSize: 12, color: 'var(--text-dim)' },
  tabs: { display: 'flex', gap: 4, flexWrap: 'wrap' },
  tab: (active) => ({
    padding: '4px 10px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--accent)' : 'var(--surface2)',
    color: active ? '#fff' : 'var(--text-dim)',
  }),
  input: {
    background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)',
    borderRadius: 'var(--radius)', padding: '5px 8px', fontSize: 12, outline: 'none', minWidth: 180,
  },
  btn: (variant = 'ghost') => ({
    padding: '5px 10px', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 12,
    display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
    border: variant === 'ghost' ? '1px solid var(--border)' : 'none',
    background: variant === 'primary' ? 'var(--accent)' : 'var(--surface2)',
    color: variant === 'primary' ? '#fff' : 'var(--text-dim)',
    textDecoration: 'none',
  }),
  list: { flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 },
  row: {
    display: 'flex', gap: 12, padding: 10, alignItems: 'flex-start', flexWrap: 'wrap',
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
  },
  thumb: {
    width: 64, height: 64, borderRadius: 6, objectFit: 'cover', flexShrink: 0,
    background: 'var(--surface2)', border: '1px solid var(--border)',
  },
  main: { flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 },
  name: {
    fontSize: 13, fontWeight: 600, color: 'var(--text)', textDecoration: 'none',
    display: 'inline-flex', alignItems: 'center', gap: 4,
  },
  match: {
    display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, minWidth: 0,
    color: 'var(--text)', cursor: 'pointer',
  },
  path: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  actions: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
  badge: (status) => {
    const c = { found: '#10b981', possible: '#f59e0b', missing: '#f87171', ignored: '#6b7280' }[status];
    return {
      fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 10,
      color: c, border: `1px solid ${c}55`, background: `${c}1a`, whiteSpace: 'nowrap',
    };
  },
  picker: {
    flexBasis: '100%', display: 'flex', flexDirection: 'column', gap: 6,
    padding: 10, borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--border)',
  },
  pick: {
    display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 6px',
    borderRadius: 4, cursor: 'pointer', color: 'var(--text)',
  },
  error: { fontSize: 12, color: '#f87171' },
  empty: { textAlign: 'center', padding: 60, color: 'var(--text-dim)' },
};

const STATUS_LABEL = { found: 'On NAS', possible: 'Check', missing: 'Missing', ignored: 'Ignored' };

// The API returns errors as {"error": "..."} text
function errorText(e) {
  try { return JSON.parse(e.message).error ?? e.message; } catch { return e.message; }
}

function Thumb({ src }) {
  const [err, setErr] = useState(false);
  if (!src || err) return <div style={s.thumb} />;
  return <img src={src} alt="" loading="lazy" style={s.thumb} onError={() => setErr(true)} />;
}

function PathLabel({ target, onOpen, extra }) {
  const Icon = target.kind === 'model' ? Box : Folder;
  return (
    <div style={s.match} onClick={() => onOpen(target)} title={`Open ${target.path}`}>
      <Icon size={13} color="var(--accent)" style={{ flexShrink: 0 }} />
      <span style={s.path}>{target.path.replace(/\.zip(?=\/|$)/gi, '')}</span>
      {extra && <span style={{ ...s.dim, whiteSpace: 'nowrap' }}>{extra}</span>}
    </div>
  );
}

// Search the library for the folder or model that holds a purchase
function LibraryPicker({ item, onPick, onClose }) {
  const [q, setQ] = useState(item.name);
  const [results, setResults] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      try { setResults(await api.library.find(q)); } catch { setResults([]); }
    }, 250);
    return () => clearTimeout(timer.current);
  }, [q]);

  const suggestions = item.alternatives ?? [];
  return (
    <div style={s.picker}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Search size={13} color="var(--text-dim)" />
        <input
          style={{ ...s.input, flex: 1 }} value={q} autoFocus
          placeholder="Folder or model name" onChange={(e) => setQ(e.target.value)}
        />
        <button style={s.btn()} onClick={onClose}><X size={12} /></button>
      </div>
      {suggestions.length > 0 && (
        <>
          <div style={s.dim}>Other suggestions</div>
          {suggestions.map((t) => (
            <div key={t.path} style={s.pick}>
              <PathLabel target={t} onOpen={() => onPick(t.path)} extra={`${Math.round(t.score * 100)}% · ${t.reason}`} />
            </div>
          ))}
        </>
      )}
      <div style={s.dim}>
        {results === null ? 'Searching…' : results.length ? 'Library matches' : q.trim().length < 2 ? 'Type to search' : 'Nothing in the library matches. Try other words.'}
      </div>
      {(results ?? []).map((t) => (
        <div key={t.path} style={s.pick}>
          <PathLabel
            target={t} onOpen={() => onPick(t.path)}
            extra={t.kind === 'folder' ? `${formatCount(t.modelCount)} models` : `${formatCount(t.fileCount)} files`}
          />
        </div>
      ))}
    </div>
  );
}

// Upload or paste saved copies of MMF's library data pages
function ImportPanel({ platform, onImported, onClose }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  async function copyScript() {
    try {
      await navigator.clipboard.writeText(MMF_EXPORT_SCRIPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked */ }
  }

  async function send(sources) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const files = sources.map(({ name, body }) => {
        // A copy from the browser's JSON viewer starts with its toolbar ("Raw Parsed Copy…")
        const start = body.search(/[{[]/);
        try { return JSON.parse(start > 0 ? body.slice(start) : body); } catch { throw new Error(`${name} isn't JSON. Save the page as raw JSON, not as a web page.`); }
      });
      const r = await api.reconcile.import(platform, files);
      setResult(r);
      setText('');
      onImported();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function pickFiles(e) {
    const list = [...e.target.files];
    e.target.value = '';
    if (list.length) send(await Promise.all(list.map(async (f) => ({ name: f.name, body: await f.text() }))));
  }

  const nextPage = result?.totalCount && result.stored < result.totalCount
    ? Math.floor(result.stored / Math.max(result.imported, 1)) + 1
    : null;

  return (
    <div style={{ ...s.picker, flexBasis: 'auto', margin: '12px 16px 0', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: 13, flex: 1 }}>Import MyMiniFactory purchases</strong>
        <button style={s.btn()} onClick={onClose}><X size={12} /></button>
      </div>
      <div style={{ fontSize: 12, fontWeight: 600 }}>Whole library (purchases, campaigns, tribes, shared)</div>
      <ol style={{ ...s.dim, margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
        <li>
          <button style={{ ...s.btn(), padding: '2px 8px' }} onClick={copyScript}>
            <Copy size={11} /> {copied ? 'Copied' : 'Copy export script'}
          </button>
        </li>
        <li>
          Open <a href="https://www.myminifactory.com/library" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>your MyMiniFactory library</a> while
          logged in, open the browser console (<code>⌥⌘J</code> in Chrome, <code>⌥⌘C</code> in Safari), paste, and press Enter.
          Chrome may ask you to type <code>allow pasting</code> first.
        </li>
        <li>It reads every page one at a time (a few minutes), then downloads <code>mmf-library.json</code>. Upload that here.</li>
      </ol>
      <div style={{ fontSize: 12, fontWeight: 600 }}>Or just one page</div>
      <div style={{ ...s.dim, lineHeight: 1.6 }}>
        Open <a href={MMF_DATA_URL} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{MMF_DATA_URL}</a> (and{' '}
        <code>?page=2</code>, <code>?page=3</code>…), save each as raw JSON and upload them, or copy one and paste it below.
        The <a href="https://www.myminifactory.com/api/data-library/objectPreviews" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>object list</a> works
        too: it adds every item with its tribe, but without file names, so those match by name only.
        Importing adds to what's already here.
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <label style={{ ...s.btn('primary'), opacity: busy ? 0.6 : 1 }}>
          <Upload size={12} /> Upload files
          <input type="file" accept=".json,application/json,text/plain" multiple hidden disabled={busy} onChange={pickFiles} />
        </label>
        <textarea
          style={{ ...s.input, flex: 1, minHeight: 34, height: 34, resize: 'vertical', fontFamily: 'monospace' }}
          placeholder="…or paste the page here" value={text} onChange={(e) => setText(e.target.value)}
        />
        <button style={s.btn()} disabled={busy || !text.trim()} onClick={() => send([{ name: 'Pasted text', body: text }])}>
          {busy ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={12} />} Import pasted
        </button>
      </div>
      {error && <div style={s.error}>{error}</div>}
      {result && (
        <div style={{ fontSize: 12, color: 'var(--text)' }}>
          Imported {formatCount(result.imported)} purchases; {formatCount(result.stored)} saved in total
          {result.totalCount ? ` of ${formatCount(result.totalCount)} in your MMF library` : ''}.
          {nextPage && <> Next, open <a href={`${MMF_DATA_URL}?page=${nextPage}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>page {nextPage}</a>.</>}
          {result.emptyGroups > 0 && ` ${formatCount(result.emptyGroups)} library groups were empty.`}
          {result.failures?.length > 0 && (
            <div style={s.error}>
              {formatCount(result.failures.length)} groups couldn't be read: {result.failures.slice(0, 5).map((f) => f.group).join('; ')}
              {result.failures.length > 5 && '…'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PurchaseRow({ item, platform, onChanged, onOpen }) {
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function act(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setPicking(false);
      await onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const id = item.externalId;
  const link   = (path) => act(() => api.reconcile.link(platform, id, path));
  const reject = () => act(() => api.reconcile.reject(platform, id, item.match.path));
  const unlink = () => act(() => api.reconcile.unlink(platform, id));
  const ignore = (ignored) => act(() => api.reconcile.ignore(platform, id, ignored));

  const bought = item.purchasedAt ? new Date(item.purchasedAt).toLocaleDateString() : null;
  // Without a direct link (e.g. an MMF item with several archives) the item's page has the downloads
  const download = (item.downloadUrl || item.url) && (
    <a style={s.btn(item.status === 'missing' ? 'primary' : 'ghost')} href={item.downloadUrl || item.url} target="_blank" rel="noopener noreferrer"
      title={item.downloadUrl ? 'Download' : 'Open the download page'}>
      <Download size={12} /> {item.downloadUrl ? 'Download' : 'Downloads'}
    </a>
  );

  return (
    <div style={{ ...s.row, opacity: busy ? 0.6 : 1 }}>
      <Thumb src={item.thumbnailUrl} />
      <div style={s.main}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <a style={s.name} href={item.url} target="_blank" rel="noopener noreferrer" title="Open on the platform">
            {item.name} <ExternalLink size={11} color="var(--text-dim)" />
          </a>
          <span style={s.badge(item.status)}>{item.confirmed ? 'Confirmed' : STATUS_LABEL[item.status]}</span>
        </div>
        <div style={s.dim}>
          {[item.creator, item.source && item.source !== 'Purchases' && item.source, bought && `bought ${bought}`, item.fileNames.length && `${item.fileNames.length} file${item.fileNames.length !== 1 ? 's' : ''}`]
            .filter(Boolean).join(' · ')}
        </div>
        {item.match ? (
          <PathLabel
            target={item.match} onOpen={onOpen}
            extra={item.confirmed ? null : `${Math.round(item.match.score * 100)}% · ${item.match.reason}`}
          />
        ) : item.staleLink ? (
          <div style={s.dim}>Was linked to {item.staleLink}, which is no longer in the library</div>
        ) : item.status === 'missing' && item.alternatives[0] ? (
          <div style={s.dim}>Closest: {item.alternatives[0].path} ({Math.round(item.alternatives[0].score * 100)}%)</div>
        ) : null}
        {error && <div style={s.error}>{error}</div>}
      </div>

      <div style={s.actions}>
        {item.status === 'missing' && download}
        {(item.status === 'possible' || (item.status === 'found' && !item.confirmed)) && (
          <>
            <button style={s.btn(item.status === 'possible' ? 'primary' : 'ghost')} disabled={busy} onClick={() => link(item.match.path)} title="Yes, this is it">
              <Check size={12} /> Confirm
            </button>
            <button style={s.btn()} disabled={busy} onClick={reject} title="Stop suggesting this folder">
              <X size={12} /> Not this
            </button>
          </>
        )}
        {item.status !== 'ignored' && (
          <button style={s.btn()} disabled={busy} onClick={() => setPicking((v) => !v)} title="Pick the folder or model by hand">
            <Link2 size={12} /> {item.match ? 'Change…' : 'Link to…'}
          </button>
        )}
        {item.confirmed && (
          <button style={s.btn()} disabled={busy} onClick={unlink} title="Remove the confirmed link">
            <Unlink size={12} /> Unlink
          </button>
        )}
        {item.status === 'possible' && download}
        {item.status === 'missing' && (
          <button style={s.btn()} disabled={busy} onClick={() => ignore(true)} title="Don't count this as missing">
            <EyeOff size={12} /> Ignore
          </button>
        )}
        {item.status === 'ignored' && (
          <>
            {download}
            <button style={s.btn()} disabled={busy} onClick={() => ignore(false)}>
              <Eye size={12} /> Stop ignoring
            </button>
          </>
        )}
      </div>

      {picking && <LibraryPicker item={item} onPick={link} onClose={() => setPicking(false)} />}
    </div>
  );
}

export default function PurchasesPage({ onNavigate, onOpenModel, integrationStatus }) {
  const [platform, setPlatform] = useState('cults3d');
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [syncError, setSyncError] = useState(null);
  const [filter, setFilter] = useState('missing');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize();
  const [copied, setCopied] = useState(false);
  const [importing, setImporting] = useState(false);
  const listRef = useRef(null);

  const platformInfo = PLATFORMS.find((p) => p.id === platform);
  const imports = platformInfo.mode === 'import';
  // Imports need no account connection
  const connected = imports || integrationStatus?.[platform]?.connected;

  async function load() {
    try {
      setData(await api.reconcile.get(platform));
      setLoadError(null);
    } catch (e) {
      setLoadError(errorText(e));
    }
  }

  async function sync() {
    setSyncError(null);
    try {
      await api.reconcile.sync(platform);
    } catch (e) {
      setSyncError(errorText(e));
    }
    load();
  }

  useEffect(() => { setData(null); setImporting(false); load(); }, [platform]);

  // The sync runs on the server; poll until it's done
  const syncState = data?.syncing;
  const syncing = !!syncState;
  useEffect(() => {
    if (!syncing) return;
    const t = setTimeout(load, 2000);
    return () => clearTimeout(t);
  }, [data]);
  useEffect(() => { setPage(1); }, [filter, q, platform]);
  useEffect(() => { listRef.current?.scrollTo(0, 0); }, [filter, q, page, pageSize]);

  const shown = useMemo(() => {
    if (!data) return [];
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return data.items.filter((i) =>
      (filter === 'all' || i.status === filter) &&
      words.every((w) => `${i.name} ${i.creator ?? ''} ${i.match?.path ?? ''}`.toLowerCase().includes(w)));
  }, [data, filter, q]);

  const pageItems = shown.slice((page - 1) * pageSize, page * pageSize);

  function open(target) {
    if (target.kind === 'model') onOpenModel(target.path);
    else onNavigate(target.path);
  }

  async function copyMissing() {
    const urls = shown.filter((i) => i.downloadUrl).map((i) => i.downloadUrl).join('\n');
    try {
      await navigator.clipboard.writeText(urls);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked */ }
  }

  const counts = data ? { ...data.summary, all: data.items.length } : {};
  const neverSynced = data && !data.syncedAt;

  return (
    <div style={s.wrapper}>
      <div style={s.toolbar}>
        <div style={s.title}><ShoppingBag size={16} color="var(--accent)" /> Purchases</div>
        {PLATFORMS.length > 1 && (
          <select style={s.input} value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        )}
        <span style={s.dim}>
          {PLATFORMS.length === 1 && platformInfo.label}
          {data?.syncedAt && `${PLATFORMS.length === 1 ? ' · ' : ''}${imports ? 'Imported' : 'Synced'} ${new Date(data.syncedAt.replace(' ', 'T') + 'Z').toLocaleString()}`}
        </span>
        <div style={{ flex: 1 }} />
        {imports ? (
          <button style={s.btn(neverSynced ? 'primary' : 'ghost')} onClick={() => setImporting((v) => !v)}>
            <Upload size={12} /> Import purchases
          </button>
        ) : (
        <button style={s.btn(neverSynced ? 'primary' : 'ghost')} onClick={sync} disabled={syncing || !connected}
          title={connected ? 'Fetch your purchases from the platform' : 'Connect the account on the Integrations page first'}>
          {syncing ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={12} />}
          {!syncing ? 'Sync purchases'
            : syncState.total ? `Syncing… ${formatCount(syncState.done)}/${formatCount(syncState.total)} orders`
            : 'Syncing…'}
        </button>
        )}
      </div>

      {imports && (importing || neverSynced) && (
        <ImportPanel platform={platform} onImported={load} onClose={() => setImporting(false)} />
      )}

      {data && data.items.length > 0 && (
        <div style={{ ...s.toolbar, minHeight: 0 }}>
          <div style={s.tabs}>
            {FILTERS.map((f) => (
              <span key={f.id} style={s.tab(filter === f.id)} title={f.hint} onClick={() => setFilter(f.id)}>
                {f.label} {formatCount(counts[f.id] ?? 0)}
              </span>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          {filter === 'missing' && shown.some((i) => i.downloadUrl) && (
            <button style={s.btn()} onClick={copyMissing} title="Copy the download links of the purchases listed below">
              <Copy size={12} /> {copied ? 'Copied' : `Copy ${formatCount(shown.length)} download links`}
            </button>
          )}
          <input style={s.input} placeholder="Filter by name, creator or folder" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}

      <div style={s.list} ref={listRef}>
        {(syncError || data?.syncError || loadError) && (
          <div style={s.error}>{syncError || loadError || `Last sync failed: ${data.syncError}`}</div>
        )}
        {!connected && integrationStatus && (
          <div style={s.empty}>Connect your {platformInfo.label} account on the Integrations page, then sync.</div>
        )}
        {connected && !imports && neverSynced && !syncing && (
          <div style={s.empty}>Sync to fetch your purchases and check which ones are on the NAS.</div>
        )}
        {connected && syncing && neverSynced && (
          <div style={s.empty}>Fetching purchases… this takes about half a minute.</div>
        )}
        {!data && !loadError && <div style={s.empty}>Loading…</div>}
        {data && data.items.length > 0 && !shown.length && (
          <div style={s.empty}>Nothing here{q ? ' matches that filter' : ''}.</div>
        )}
        {pageItems.map((item) => (
          <PurchaseRow key={item.externalId} item={item} platform={platform} onChanged={load} onOpen={open} />
        ))}
      </div>

      {shown.length > pageSize && (
        <Pagination page={page} pageSize={pageSize} total={shown.length} noun="purchases" onPage={setPage} onPageSize={setPageSize} />
      )}
    </div>
  );
}
