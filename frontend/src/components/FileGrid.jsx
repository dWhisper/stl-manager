import { useState, useEffect, useCallback, useRef } from 'react';
import { Box, FileBox, FileArchive } from 'lucide-react';
import { api } from '../api/client.js';
import { formatCount } from '../utils/format.js';

const PAGE_SIZES = [48, 96, 192, 384];
const PAGE_SIZE_KEY = 'stl-manager.pageSize';

function initialPageSize() {
  try {
    const saved = Number(localStorage.getItem(PAGE_SIZE_KEY));
    if (PAGE_SIZES.includes(saved)) return saved;
  } catch { /* storage unavailable */ }
  return 96;
}

const s = {
  wrapper: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  toolbar: {
    padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex',
    alignItems: 'center', gap: 12, background: 'var(--surface)',
  },
  grid: {
    flex: 1, overflowY: 'auto', padding: 16,
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14,
    // Without these, rows shrink to fit the viewport (cards have overflow:hidden,
    // so their min height is 0) and every card collapses into a thin bar.
    gridAutoRows: 'max-content', alignContent: 'start',
  },
  card: {
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
    cursor: 'pointer', overflow: 'hidden', transition: 'border-color 0.15s, transform 0.1s',
  },
  cardHover: { borderColor: 'var(--accent)', transform: 'translateY(-1px)' },
  cardThumb: {
    aspectRatio: '1 / 1', background: 'var(--surface2)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', color: 'var(--accent)',
    overflow: 'hidden', position: 'relative',
  },
  noPreview: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
    color: 'var(--text-dim)', fontSize: 11,
  },
  thumbImg: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  cardBody: { padding: '8px 10px 10px' },
  cardName: {
    fontSize: 12, fontWeight: 500, color: 'var(--text)', wordBreak: 'break-word',
    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
  },
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
  pgGroup: { display: 'flex', alignItems: 'center', gap: 6 },
  pgSelect: {
    padding: '3px 6px', background: 'var(--surface2)', border: '1px solid var(--border)',
    color: 'var(--text)', borderRadius: 'var(--radius)', fontSize: 12,
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
    <div style={s.cardThumb} title={file.thumbError ? `No preview: ${file.thumbError}` : undefined}>
      {/* Skeleton while an STL thumbnail is on its way; icon for failures and other formats */}
      {file.name.toLowerCase().endsWith('.stl') && !file.thumbError
        ? <ThumbSkeleton />
        : (
          <div style={s.noPreview}>
            <Icon size={40} strokeWidth={1} />
            {file.thumbError && <span>No preview</span>}
          </div>
        )}
    </div>
  );

  return (
    <div style={s.cardThumb}>
      {!loaded && !errored && <ThumbSkeleton />}
      {errored && <Icon size={40} strokeWidth={1} color="var(--text-dim)" />}
      <img
        src={api.files.thumbUrl(file.id, file.updatedAt)}
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
  const [pageSize, setPageSize] = useState(initialPageSize);
  const pollRef  = useRef(null);
  const gridRef  = useRef(null);
  const filesRef = useRef(files);
  filesRef.current = files;

  function changePageSize(size) {
    try { localStorage.setItem(PAGE_SIZE_KEY, String(size)); } catch { /* storage unavailable */ }
    // Keep the first visible tile on screen when the page size changes
    setPage(Math.floor(((page - 1) * pageSize) / size) + 1);
    setPageSize(size);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: pageSize };
      if (filter.tag)        params.tag        = filter.tag;
      if (filter.collection) params.collection = filter.collection;
      const res = await api.files.list(params);
      setFiles(res.files);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filter]);

  useEffect(() => { setPage(1); }, [filter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { gridRef.current?.scrollTo(0, 0); }, [page, pageSize, filter]);

  // Check pending thumbnail count from the watcher status endpoint.
  // While thumbnails are generating, poll every 4s and refresh the grid
  // to pick up newly completed thumbnails.
  useEffect(() => {
    async function checkPending() {
      try {
        const s = await api.watcher.status();
        setPendingThumbs(s.thumbPending ?? 0);
        // Re-fetch the current page only while some of its STL cards still lack a thumbnail
        const pageMissing = filesRef.current.some(
          (f) => !f.thumbnailPath && !f.thumbError && f.name.toLowerCase().endsWith('.stl')
        );
        if ((s.thumbPending ?? 0) > 0 && pageMissing) load();
      } catch { /* ignore */ }
    }

    clearInterval(pollRef.current);
    // Start polling when we know some are pending, or on initial mount to find out
    pollRef.current = setInterval(checkPending, 4000);
    checkPending(); // immediate check
    return () => clearInterval(pollRef.current);
  }, [filter, page, pageSize]); // restart poll on navigation

  const totalPages = Math.ceil(total / pageSize);
  const firstShown = total ? (page - 1) * pageSize + 1 : 0;
  const lastShown  = Math.min(page * pageSize, total);

  return (
    <div style={s.wrapper}>
      <div style={s.toolbar}>
        <span style={{ fontSize: 12, color: 'var(--text-dim)', flex: 1 }}>
          {loading && !total ? 'Loading…' : `${formatCount(total)} files`}
        </span>
        {pendingThumbs > 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            Generating {formatCount(pendingThumbs)} thumbnail{pendingThumbs !== 1 ? 's' : ''}…
          </span>
        )}
      </div>

      <div style={s.grid} ref={gridRef}>
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
                <div style={s.cardName} title={f.name}>{f.name}</div>
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

      {total > 0 && (
        <div style={s.pagination}>
          <span>
            Showing {formatCount(firstShown)}–{formatCount(lastShown)} of {formatCount(total)}
          </span>
          <div style={s.pgGroup}>
            <button style={s.pgBtn} disabled={page === 1}           onClick={() => setPage(1)}>« First</button>
            <button style={s.pgBtn} disabled={page === 1}           onClick={() => setPage(p => p - 1)}>← Prev</button>
            <span style={{ padding: '0 6px' }}>Page {formatCount(page)} of {formatCount(totalPages)}</span>
            <button style={s.pgBtn} disabled={page >= totalPages}   onClick={() => setPage(p => p + 1)}>Next →</button>
            <button style={s.pgBtn} disabled={page >= totalPages}   onClick={() => setPage(totalPages)}>Last »</button>
          </div>
          <label style={s.pgGroup}>
            Tiles per page
            <select style={s.pgSelect} value={pageSize} onChange={(e) => changePageSize(Number(e.target.value))}>
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
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
