import { useState, useEffect, useRef } from 'react';
import { Search, Loader, ExternalLink, Library, ArrowLeft } from 'lucide-react';
import { api } from '../api/client.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function cultsItemToOrigin(item) {
  return {
    source: 'cults3d',
    url: item.url ?? (item.slug ? `https://cults3d.com/en/3d-model/${item.slug}` : ''),
    externalName: item.name ?? '',
    externalAuthor: item.creator?.nick ?? '',
  };
}

function mmfItemToOrigin(item) {
  return {
    source: 'myminifactory',
    url: item.url ?? (item.id ? `https://www.myminifactory.com/object/${item.id}` : ''),
    externalName: item.name ?? '',
    externalAuthor: item.designer?.name ?? item.creator?.name ?? '',
  };
}

function ItemThumb({ src, size = 48 }) {
  const [err, setErr] = useState(false);
  if (!src || err) return <div style={{ width: size, height: size, borderRadius: 6, background: 'var(--surface2)', flexShrink: 0 }} />;
  return <img src={src} alt="" style={{ width: size, height: size, objectFit: 'cover', borderRadius: 6, flexShrink: 0, border: '1px solid var(--border)' }} onError={() => setErr(true)} />;
}

// ── Search/browse panel for one platform ─────────────────────────────────────

function PlatformResults({ platform, onSelect }) {
  const [mode,    setMode]    = useState('library');  // 'library' | 'search'
  const [q,       setQ]       = useState('');
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [page,    setPage]    = useState(1);
  const [total,   setTotal]   = useState(0);
  const debounce = useRef(null);

  const isCults = platform === 'cults3d';
  const PER = 12;

  async function loadLibrary(pg = 1) {
    setLoading(true);
    try {
      if (isCults) {
        const data = await api.integrations.cults.library({ limit: PER, offset: (pg - 1) * PER });
        const list = (data?.orders ?? []).map(o => o.creation).filter(Boolean);
        setItems(list);
        setTotal(data?.ordersCount ?? list.length);
      } else {
        const data = await api.integrations.mmf.library({ page: pg, perPage: PER });
        setItems(data?.items ?? []);
        setTotal(data?.total_count ?? 0);
      }
      setPage(pg);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function runSearch(query, pg = 1) {
    if (!query.trim()) return;
    setLoading(true);
    try {
      if (isCults) {
        const list = await api.integrations.cults.search(query, { limit: PER, offset: (pg - 1) * PER });
        setItems(Array.isArray(list) ? list : []);
        setTotal(Array.isArray(list) ? list.length : 0);
      } else {
        const data = await api.integrations.mmf.search(query, { page: pg, perPage: PER });
        setItems(data?.items ?? []);
        setTotal(data?.total_count ?? 0);
      }
      setPage(pg);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadLibrary(1); }, [platform]);

  useEffect(() => {
    if (mode !== 'search' || !q.trim()) return;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => runSearch(q, 1), 400);
    return () => clearTimeout(debounce.current);
  }, [q, mode]);

  function handleModeChange(m) {
    setMode(m);
    setItems([]);
    setTotal(0);
    setPage(1);
    if (m === 'library') loadLibrary(1);
  }

  const totalPages = Math.ceil(total / PER);

  function pickItem(item) {
    const origin = isCults ? cultsItemToOrigin(item) : mmfItemToOrigin(item);
    onSelect(origin);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Mode tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
        {['library', 'search'].map(m => (
          <button
            key={m}
            onClick={() => handleModeChange(m)}
            style={{
              padding: '4px 10px', borderRadius: 'var(--radius)', border: 'none',
              fontSize: 12, fontWeight: 500, cursor: 'pointer',
              background: mode === m ? 'var(--accent)' : 'var(--surface2)',
              color:      mode === m ? '#fff' : 'var(--text-dim)',
            }}
          >
            {m === 'library' ? <><Library size={11} style={{ marginRight: 4 }} />My Library</> : <><Search size={11} style={{ marginRight: 4 }} />Search</>}
          </button>
        ))}
      </div>

      {/* Search input */}
      {mode === 'search' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '6px 10px' }}>
          <Search size={13} color="var(--text-dim)" />
          <input
            style={{ background: 'none', border: 'none', color: 'var(--text)', fontSize: 12, outline: 'none', flex: 1 }}
            placeholder={`Search ${isCults ? 'Cults 3D' : 'MyMiniFactory'}…`}
            value={q}
            onChange={e => setQ(e.target.value)}
            autoFocus
          />
        </div>
      )}

      {/* Results */}
      <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {loading && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)' }}>
            <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        )}
        {!loading && items.length === 0 && (
          <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-dim)' }}>
            {mode === 'search' && !q.trim() ? 'Type to search…' : 'No results'}
          </div>
        )}
        {!loading && items.map((item, i) => {
          const thumb = isCults
            ? (item.thumbnailUrl ?? item.illustrationsImageUrls?.[0])
            : (item.images?.images?.[0]?.thumbnail_url ?? item.images?.[0]?.thumbnail_url);
          const name    = item.name ?? '';
          const creator = isCults ? item.creator?.nick : (item.designer?.name ?? item.creator?.name);
          const itemUrl = isCults
            ? (item.url ?? (item.slug ? `https://cults3d.com/en/3d-model/${item.slug}` : null))
            : item.url;

          return (
            <div
              key={item.slug ?? item.id ?? i}
              onClick={() => pickItem(item)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 6px',
                cursor: 'pointer', borderRadius: 6, transition: 'background 0.1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <ItemThumb src={thumb} size={44} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                {creator && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 1 }}>by {creator}</div>}
              </div>
              {itemUrl && (
                <a href={itemUrl} target="_blank" rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  style={{ color: 'var(--text-dim)', display: 'flex', flexShrink: 0 }}>
                  <ExternalLink size={12} />
                </a>
              )}
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', paddingTop: 4 }}>
          <button
            style={{ padding: '3px 8px', fontSize: 11, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text-dim)', borderRadius: 4, cursor: 'pointer' }}
            disabled={page <= 1}
            onClick={() => mode === 'library' ? loadLibrary(page - 1) : runSearch(q, page - 1)}
          >← Prev</button>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', padding: '3px 4px' }}>{page} / {totalPages}</span>
          <button
            style={{ padding: '3px 8px', fontSize: 11, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text-dim)', borderRadius: 4, cursor: 'pointer' }}
            disabled={page >= totalPages}
            onClick={() => mode === 'library' ? loadLibrary(page + 1) : runSearch(q, page + 1)}
          >Next →</button>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const PLATFORM_META = {
  cults3d:       { label: 'Cults 3D',        color: '#e94f37' },
  myminifactory: { label: 'MyMiniFactory',    color: '#00b0f0' },
};

export default function PlatformPicker({ connectedPlatforms = [], onSelect, onClose }) {
  const [platform, setPlatform] = useState(null);

  const available = Object.entries(PLATFORM_META).filter(([k]) => connectedPlatforms.includes(k));

  if (available.length === 0) {
    return (
      <div style={{ padding: 16, fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>
        No platforms connected. Go to <strong>Integrations</strong> in the sidebar to connect your accounts.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Platform selector */}
      {!platform ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Choose platform
          </div>
          {available.map(([key, meta]) => (
            <button
              key={key}
              onClick={() => setPlatform(key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px', borderRadius: 6, cursor: 'pointer',
                background: 'var(--surface2)', border: '1px solid var(--border)', textAlign: 'left',
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{meta.label}</span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <button
              onClick={() => setPlatform(null)}
              style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', display: 'flex', padding: 0 }}
            >
              <ArrowLeft size={14} />
            </button>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
              {PLATFORM_META[platform].label}
            </span>
          </div>
          <PlatformResults platform={platform} onSelect={onSelect} />
        </>
      )}
    </div>
  );
}
