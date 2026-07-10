import { useState, useEffect, useCallback, useRef } from 'react';
import { Box, FileBox, FileArchive } from 'lucide-react';
import { api } from '../api/client.js';

const s = {
  wrapper: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  toolbar: {
    padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex',
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
    overflow: 'hidden', position: 'relative',
  },
  thumbImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  cardBody: { padding: '8px 10px 10px' },
  cardName: { fontSize: 12, fontWeight: 500, color: 'var(--text)', wordBreak: 'break-word' },
  cardMeta: { fontSize: 10, color: 'var(--text-dim)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 },
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
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// Shimmer skeleton shown while a thumbnail is being generated
function ThumbSkeleton() {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', background: 'var(--surface2)' }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)',
        animation: 'shimmer 1.6s infinite',
        backgroundSize: '200% 100%',
      }} />
    </div>
  );
}

// Individual thumbnail cell — tracks its own loaded/error state
function CardThumb({ file }) {
  const [loaded, setLoaded]   = useState(false);
  const [errored, setErrored] = useState(false);
  const hasThumbnail = !!file.thumbnailPath;
  const Icon = file.inZip ? FileArchive : FileBox;

  if (!hasThumbnail) return (
    <div style={s.cardThumb}>
      {/* Show skeleton for STL files (thumbnail will arrive), icon for others */}
      {file.name.toLowerCase().endsWith('.stl')
        ? <ThumbSkeleton />
        : <Icon size={40} strokeWidth={1} color="var(--text-dim)" />}
    </div>
  );

  return (
    <div style={s.cardThumb}>
      {!loaded && !errored && <ThumbSkeleton />}
      {errored && <Icon size={40} strokeWidth={1} color="var(--text-dim)" />}
      <img
        src={api.files.thumbUrl(file.id)}
        alt=""
        style={{ ...s.thumbImg, display: loaded && !errored ? 'block' : 'none' }}
        onLoad={() => setLoaded(true)}
        onError={() => setErrored(true)}
      />
    </div>
  );
}

export default function FileGrid({ filter, onSelect }) {
  const [files, setFiles]   = useState([]);
  const [total, setTotal]   = useState(0);
  const [page, setPage]     = useState(1);
  const [hover, setHover]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [pendingThumbs, setPendingThumbs] = useState(0);
  const pollRef = useRef(null);
  const LIMIT = 48;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: LIMIT };
      if (filter.tag)        params.tag        = filter.tag;
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

  // Check pending thumbnail count from the watcher status endpoint.
  // While thumbnails are generating, poll every 4s and refresh the grid
  // to pick up newly completed thumbnails.
  useEffect(() => {
    async function checkPending() {
      try {
        const s = await api.watcher.status();
        setPendingThumbs(s.thumbPending ?? 0);
        if ((s.thumbPending ?? 0) > 0) {
          // Re-fetch current page so cards with freshly-generated thumbs update
          load();
        }
      } catch { /* ignore */ }
    }

    clearInterval(pollRef.current);
    // Start polling when we know some are pending, or on initial mount to find out
    pollRef.current = setInterval(checkPending, 4000);
    checkPending(); // immediate check
    return () => clearInterval(pollRef.current);
  }, [filter, page]); // restart poll on navigation

  // Stop polling once queue drains
  useEffect(() => {
    if (pendingThumbs === 0) clearInterval(pollRef.current);
  }, [pendingThumbs]);

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div style={s.wrapper}>
      <div style={s.toolbar}>
        <span style={{ fontSize: 12, color: 'var(--text-dim)', flex: 1 }}>
          {loading ? 'Loading…' : `${total} files`}
        </span>
        {pendingThumbs > 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            Generating {pendingThumbs} thumbnail{pendingThumbs !== 1 ? 's' : ''}…
          </span>
        )}
      </div>

      <div style={s.grid}>
        {files.map((f) => {
          const tagList = f.tag_names ? f.tag_names.split(',').filter(Boolean) : [];
          const tagColors = {};
          if (f.tag_data) {
            f.tag_data.split(',').forEach((t) => {
              const sep = t.lastIndexOf(':');
              tagColors[t.slice(0, sep)] = t.slice(sep + 1);
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
              <CardThumb file={f} />
              <div style={s.cardBody}>
                <div style={s.cardName}>{f.name}</div>
                <div style={s.cardMeta}>
                  <span>{formatSize(f.size)}</span>
                  {f.inZip && (
                    <span style={{ background: 'var(--surface2)', border: '1px solid var(--border)', padding: '0 4px', borderRadius: 3 }}>zip</span>
                  )}
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
          <button style={s.pgBtn} disabled={page === 1}          onClick={() => setPage(p => p - 1)}>← Prev</button>
          <span>Page {page} of {totalPages}</span>
          <button style={s.pgBtn} disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}

      <style>{`
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
      `}</style>
    </div>
  );
}
