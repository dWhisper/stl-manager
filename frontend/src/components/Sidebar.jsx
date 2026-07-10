import { useState, useEffect } from 'react';
import { Tag, FolderOpen, RefreshCw, Plus, Loader, Plug } from 'lucide-react';
import { api } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';

const s = {
  sidebar: {
    width: 240, minWidth: 240, background: 'var(--surface)', borderRight: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  status: {
    padding: '6px 14px 8px', borderBottom: '1px solid var(--border)',
    display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-dim)',
  },
  statusDot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  section: { padding: '8px 0' },
  sectionHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '4px 12px', fontSize: 11, fontWeight: 600,
    color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em',
  },
  item: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px',
    fontSize: 13, cursor: 'pointer', color: 'var(--text-dim)',
    transition: 'background 0.1s', userSelect: 'none',
  },
  itemActive: { background: 'var(--surface2)', color: 'var(--text)' },
  dot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  reconcileBtn: {
    margin: '8px 12px', padding: '6px 10px', background: 'var(--surface2)',
    border: '1px solid var(--border)', color: 'var(--text-dim)',
    borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 12,
    display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'center',
  },
  input: {
    background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)',
    borderRadius: 'var(--radius)', padding: '4px 8px', fontSize: 12, width: '100%', outline: 'none',
  },
};

export default function Sidebar({ filter, setFilter, view, setView }) {
  const [reconciling, setReconciling] = useState(false);
  const [reconcileMsg, setReconcileMsg] = useState(null);
  const [newTag, setNewTag] = useState('');
  const [newCol, setNewCol] = useState('');
  const { data: tags, refresh: refreshTags } = useApi(() => api.tags.list());
  const { data: collections, refresh: refreshCollections } = useApi(() => api.collections.list());
  const { data: status, refresh: refreshStatus } = useApi(() => api.watcher.status());

  // Poll watcher status until ready, then slow down
  useEffect(() => {
    if (status?.ready) return;
    const t = setInterval(refreshStatus, 2000);
    return () => clearInterval(t);
  }, [status?.ready]);

  async function reconcile() {
    setReconciling(true);
    setReconcileMsg(null);
    try {
      const r = await api.watcher.reconcile();
      setReconcileMsg(`Removed ${r.removed} stale entries`);
      setTimeout(() => setReconcileMsg(null), 4000);
    } finally {
      setReconciling(false);
    }
  }

  async function createTag(e) {
    if (e.key !== 'Enter' || !newTag.trim()) return;
    const colors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444'];
    await api.tags.create({ name: newTag.trim(), color: colors[Math.floor(Math.random() * colors.length)] });
    setNewTag('');
    refreshTags();
  }

  async function createCollection(e) {
    if (e.key !== 'Enter' || !newCol.trim()) return;
    await api.collections.create({ name: newCol.trim() });
    setNewCol('');
    refreshCollections();
  }

  const navItem = (label, value, icon, filterKey = 'view') => {
    const active =
      (filterKey === 'view' && filter.view === value && !filter.tag && !filter.collection) ||
      (filterKey === 'tag' && filter.tag === value) ||
      (filterKey === 'collection' && filter.collection === value);
    return (
      <div
        key={value}
        style={{ ...s.item, ...(active ? s.itemActive : {}) }}
        onClick={() => setFilter(filterKey === 'view' ? { view: value } : { view: 'all', [filterKey]: value })}
      >
        {icon}
        <span style={{ flex: 1 }}>{label}</span>
      </div>
    );
  };

  const watching = status?.watching;
  const ready = status?.ready;
  const dotColor = !watching ? '#ef4444' : !ready ? '#f59e0b' : '#10b981';
  const statusLabel = !watching
    ? 'Watcher stopped'
    : !ready
    ? 'Scanning…'
    : `${status.indexed} files${status.zipped ? ` · ${status.zipped} in zips` : ''}`;

  return (
    <div style={s.sidebar}>
      <div style={s.status}>
        <span style={{ ...s.statusDot, background: dotColor }} />
        <span style={{ flex: 1 }}>{statusLabel}</span>
        {!ready && <Loader size={10} style={{ animation: 'spin 1s linear infinite' }} />}
      </div>

      <div style={s.section}>
        {navItem('All Files', 'all', <FolderOpen size={14} />, 'view')}
      </div>

      <button style={s.reconcileBtn} onClick={reconcile} disabled={reconciling} title="Remove DB entries for files no longer on disk">
        {reconciling ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={12} />}
        {reconcileMsg || 'Reconcile Library'}
      </button>

      <div style={{ ...s.section, borderTop: '1px solid var(--border)', flex: 1, overflowY: 'auto' }}>
        <div style={s.sectionHeader}>
          <span>Tags</span>
          <Tag size={11} />
        </div>
        {(tags || []).map((t) => (
          <div
            key={t.id}
            style={{ ...s.item, ...(filter.tag === t.name ? s.itemActive : {}) }}
            onClick={() => setFilter({ view: 'all', tag: t.name })}
          >
            <span style={{ ...s.dot, background: t.color }} />
            <span style={{ flex: 1 }}>{t.name}</span>
            <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{t.file_count}</span>
          </div>
        ))}
        <div style={{ padding: '4px 12px' }}>
          <input
            style={s.input} placeholder="+ New tag" value={newTag}
            onChange={(e) => setNewTag(e.target.value)} onKeyDown={createTag}
          />
        </div>
      </div>

      <div style={{ ...s.section, borderTop: '1px solid var(--border)' }}>
        <div style={s.sectionHeader}>
          <span>Collections</span>
          <FolderOpen size={11} />
        </div>
        {(collections || []).map((c) => (
          <div
            key={c.id}
            style={{ ...s.item, ...(filter.collection === c.id ? s.itemActive : {}) }}
            onClick={() => setFilter({ view: 'all', collection: c.id })}
          >
            <FolderOpen size={13} />
            <span style={{ flex: 1 }}>{c.name}</span>
            <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{c.file_count}</span>
          </div>
        ))}
        <div style={{ padding: '4px 12px 8px' }}>
          <input
            style={s.input} placeholder="+ New collection" value={newCol}
            onChange={(e) => setNewCol(e.target.value)} onKeyDown={createCollection}
          />
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--border)', padding: '8px 0 4px' }}>
        <div
          onClick={() => setView('integrations')}
          style={{
            ...s.item,
            ...(view === 'integrations' ? s.itemActive : {}),
            color: view === 'integrations' ? 'var(--accent)' : 'var(--text-dim)',
          }}
        >
          <Plug size={13} />
          <span style={{ flex: 1 }}>Integrations</span>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
