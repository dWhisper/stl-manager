import { useState, useEffect } from 'react';
import { Link2, Plus, Trash2, ExternalLink, Download, Pencil } from 'lucide-react';
import { api } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';

const s = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 },
  header: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: 'var(--text-dim)' },
  list: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  link: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', fontSize: 12,
    borderRadius: 'var(--radius)', background: 'var(--surface2)', border: '1px solid var(--border)',
    maxWidth: '100%', minWidth: 0,
  },
  source: { fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' },
  text: { color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  icon: { background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', display: 'flex', padding: 2 },
  form: {
    display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: 8,
    borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--border)', maxWidth: 760,
  },
  input: {
    background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)',
    borderRadius: 'var(--radius)', padding: '5px 8px', fontSize: 12, outline: 'none', flex: '1 1 160px', minWidth: 0,
  },
  btn: (primary) => ({
    padding: '5px 10px', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 12,
    display: 'inline-flex', alignItems: 'center', gap: 5,
    border: primary ? 'none' : '1px solid var(--border)',
    background: primary ? 'var(--accent)' : 'var(--surface2)', color: primary ? '#fff' : 'var(--text-dim)',
  }),
  error: { fontSize: 12, color: '#f87171', flexBasis: '100%' },
};

const EMPTY = { source: 'patreon', url: '', externalName: '', externalAuthor: '' };

function errorText(e) {
  try { return JSON.parse(e.message).error ?? e.message; } catch { return e.message; }
}

// Where a library folder or model came from (Patreon, Printables, a purchase…)
export default function ModelLinks({ path }) {
  const { data: sources } = useApi(() => api.origins.sources());
  const { data: links, refresh } = useApi(() => api.links.list(path), [path]);
  const [editing, setEditing] = useState(null);  // null | 'new' | link id
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);

  useEffect(() => { setEditing(null); }, [path]);

  const label = (id) => sources?.find((x) => x.id === id)?.label ?? id;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function startNew() {
    setForm(EMPTY);
    setError(null);
    setEditing('new');
  }

  function startEdit(l) {
    setForm({ source: l.source, url: l.url ?? '', externalName: l.external_name ?? '', externalAuthor: l.external_author ?? '' });
    setError(null);
    setEditing(l.id);
  }

  async function save() {
    try {
      if (editing === 'new') await api.links.create({ path, ...form });
      else await api.links.update(editing, form);
      setEditing(null);
      refresh();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function remove(id) {
    await api.links.delete(id);
    refresh();
  }

  const editingPurchase = editing && editing !== 'new' && links?.find((l) => l.id === editing)?.external_id;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <Link2 size={12} /> Links
        {editing === null && (
          <button style={{ ...s.icon, fontSize: 12, gap: 3 }} onClick={startNew} title="Save where this came from">
            <Plus size={12} /> Add
          </button>
        )}
      </div>

      {links?.length > 0 && (
        <div style={s.list}>
          {links.map((l) => (
            <div key={l.id} style={s.link}>
              <span style={s.source}>{label(l.source)}</span>
              {(l.external_name || l.external_author) && (
                <span style={s.text} title={l.external_name ?? ''}>
                  {[l.external_name, l.external_author && `by ${l.external_author}`].filter(Boolean).join(' ')}
                </span>
              )}
              {l.url && (
                <a href={l.url} target="_blank" rel="noopener noreferrer" style={s.icon} title={l.url}><ExternalLink size={12} /></a>
              )}
              {l.download_url && (
                <a href={l.download_url} target="_blank" rel="noopener noreferrer" style={s.icon} title="Download again"><Download size={12} /></a>
              )}
              <button style={s.icon} onClick={() => startEdit(l)} title="Edit"><Pencil size={11} /></button>
              <button style={s.icon} onClick={() => remove(l.id)} title="Remove link"><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
      )}

      {editing !== null && (
        <div style={s.form}>
          <select style={{ ...s.input, flex: '0 0 auto' }} value={form.source} onChange={set('source')} disabled={!!editingPurchase}>
            {(sources ?? []).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
          <input style={{ ...s.input, flex: '2 1 240px' }} placeholder="URL" value={form.url} onChange={set('url')} autoFocus />
          <input style={s.input} placeholder="Name on the site" value={form.externalName} onChange={set('externalName')} />
          <input style={s.input} placeholder="Creator" value={form.externalAuthor} onChange={set('externalAuthor')} />
          <button style={s.btn(true)} onClick={save}>Save</button>
          <button style={s.btn(false)} onClick={() => setEditing(null)}>Cancel</button>
          {error && <div style={s.error}>{error}</div>}
        </div>
      )}
    </div>
  );
}
