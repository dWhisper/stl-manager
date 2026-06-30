import { useState, useEffect, useCallback } from 'react';
import { Box, FileBox, FileArchive } from 'lucide-react';
import { api } from '../api/client.js';

const s = {
  wrapper: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  toolbar: {
    padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex',
    alignItems: 'center', gap: 12, background: 'var(--surface)',
  },
  grid: {
    flex: 1, overflowY: 'auto', padding: 16,
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12,
  },
  card: {
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
    cursor: 'pointer', overflow: 'hidden', transition: 'border-color 0.15s, transform 0.1s',
  },
  cardHover: { borderColor: 'var(--accent)', transform: 'translateY(-1px)' },
  cardThumb: {
    height: 140, background: 'var(--surface2)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', color: 'var(--accent)',
  },
  cardBody: { padding: '8px 10px 10px' },
  cardName: { fontSize: 12, fontWeight: 500, color: 'var(--text)', wordBreak: 'break-word' },
  cardMeta: { fontSize: 10, color: 'var(--text-dim)', marginTop: 2 },
  tags: { display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 6 },
  tag: { fontSize: 10, padding: '1px 5px', borderRadius: 4, color: '#fff', fontWeight: 500 },
  pagination: {
    padding: '8px 16px', borderTop: '1px solid var(--border)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    fontSize: 12, color: 'var(--text-dim)', background: 'var(--surface)',
  },
  pgBtn: {
    padding: '4px 10px', background: 'var(--surface2)', border: '1px solid var(--border)',
    color: 'var(--text)', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 12,
  },
};

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

export default function FileGrid({ filter, onSelect }) {
  const [files, setFiles] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hover, setHover] = useState(null);
  const [loading, setLoading] = useState(false);
  const LIMIT = 48;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: LIMIT };
      if (filter.tag) params.tag = filter.tag;
      if (filter.collection) params.collection = filter.collection;
      const res = await api.files.list(params);
      setFiles(res.files);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [page, filter]);

  useEffect(() => { setPage(1); }, [filter]);
  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div style={s.wrapper}>
      <div style={s.toolbar}>
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          {loading ? 'Loading…' : `${total} files`}
        </span>
      </div>

      <div style={s.grid}>
        {files.map((f) => {
          const tagList = f.tag_names ? f.tag_names.split(',').filter(Boolean) : [];
          const tagColors = {};
          if (f.tag_data) {
            f.tag_data.split(',').forEach((t) => {
              const [id, color] = t.split(':');
              tagColors[id] = color;
            });
          }
          return (
            <div
              key={f.id}
              style={{ ...s.card, ...(hover === f.id ? s.cardHover : {}) }}
              onMouseEnter={() => setHover(f.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect(f.id)}
            >
              <div style={s.cardThumb}>
                {f.inZip
                  ? <FileArchive size={40} strokeWidth={1} color="var(--text-dim)" />
                  : <FileBox size={40} strokeWidth={1} />}
              </div>
              <div style={s.cardBody}>
                <div style={s.cardName}>{f.name}</div>
                <div style={s.cardMeta}>
                  {formatSize(f.size)}
                  {f.inZip && <span style={{ marginLeft: 5, fontSize: 10, color: 'var(--text-dim)', background: 'var(--surface2)', padding: '1px 4px', borderRadius: 3 }}>zip</span>}
                </div>
                {tagList.length > 0 && (
                  <div style={s.tags}>
                    {tagList.slice(0, 3).map((t, i) => (
                      <span key={i} style={{ ...s.tag, background: Object.values(tagColors)[i] || 'var(--accent)' }}>{t}</span>
                    ))}
                    {tagList.length > 3 && <span style={{ ...s.tag, background: 'var(--border)' }}>+{tagList.length - 3}</span>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {!loading && files.length === 0 && (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 60, color: 'var(--text-dim)' }}>
            <Box size={40} strokeWidth={1} style={{ marginBottom: 12 }} />
            <div>No files found. Click "Scan Library" to index your NAS.</div>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div style={s.pagination}>
          <button style={s.pgBtn} disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
          <span>Page {page} of {totalPages}</span>
          <button style={s.pgBtn} disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}
