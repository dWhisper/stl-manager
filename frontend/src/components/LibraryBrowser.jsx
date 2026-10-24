import { useState, useEffect, useCallback, useRef } from 'react';
import { Folder, FolderArchive, Box, ChevronRight } from 'lucide-react';
import { api } from '../api/client.js';
import { formatCount } from '../utils/format.js';
import { cardStyles, ThumbImage, ThumbSkeleton } from './FileCard.jsx';
import Pagination, { usePageSize } from './Pagination.jsx';
import { useThumbPolling } from '../hooks/useThumbPolling.js';

const s = {
  wrapper: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 },
  toolbar: {
    padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex',
    alignItems: 'center', gap: 12, background: 'var(--surface)', minHeight: 41,
  },
  grid: { ...cardStyles.grid, flex: 1, overflowY: 'auto', padding: 16 },
  mosaic: {
    width: '100%', height: '100%', display: 'grid', gap: 2,
    gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr',
  },
  mosaicCell: { position: 'relative', overflow: 'hidden', background: 'var(--surface2)', minHeight: 0 },
  cornerBadge: {
    position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: 4,
    padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
    background: 'rgba(15, 17, 23, 0.8)', color: 'var(--text)', backdropFilter: 'blur(4px)',
  },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 6 },
  chip: {
    fontSize: 10, padding: '1px 6px', borderRadius: 10, color: 'var(--text-dim)',
    border: '1px solid var(--border)', background: 'var(--surface2)', whiteSpace: 'nowrap',
  },
};

export function Breadcrumbs({ crumbs, onNavigate, current }) {
  return (
    <nav style={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', fontSize: 13, minWidth: 0 }}>
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1 && !current;
        return (
          <span key={c.path} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {i > 0 && <ChevronRight size={12} color="var(--text-dim)" />}
            <span
              onClick={last ? undefined : () => onNavigate(c.path)}
              style={{
                padding: '2px 4px', borderRadius: 4,
                color: last ? 'var(--text)' : 'var(--text-dim)', fontWeight: last ? 600 : 400,
                cursor: last ? 'default' : 'pointer',
              }}
            >
              {c.name}
            </span>
          </span>
        );
      })}
      {current && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <ChevronRight size={12} color="var(--text-dim)" />
          <span style={{ padding: '2px 4px', fontWeight: 600 }}>{current}</span>
        </span>
      )}
    </nav>
  );
}

export function VariantChips({ variants, max = 4, active, onToggle }) {
  if (!variants?.length) return null;
  const shown = onToggle ? variants : variants.slice(0, max);
  return (
    <div style={s.chips}>
      {shown.map((v) => (
        <span
          key={v}
          onClick={onToggle ? (e) => { e.stopPropagation(); onToggle(v); } : undefined}
          style={{
            ...s.chip,
            ...(onToggle ? { cursor: 'pointer', fontSize: 11, padding: '2px 8px' } : {}),
            ...(active === v ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' } : {}),
          }}
        >
          {v}
        </span>
      ))}
      {!onToggle && variants.length > max && <span style={s.chip}>+{variants.length - max}</span>}
    </div>
  );
}

function Placeholder({ item }) {
  if (item.pending) return <ThumbSkeleton />;
  const Icon = item.type === 'folder' ? (item.isZip ? FolderArchive : Folder) : Box;
  return <Icon size={44} strokeWidth={1} color="var(--text-dim)" />;
}

function ItemThumb({ item }) {
  const { previews } = item;
  if (item.type === 'model' || previews.length < 2) {
    return (
      <div style={cardStyles.cardThumb}>
        {previews[0]
          ? <ThumbImage id={previews[0].id} version={previews[0].version} fallback={<Placeholder item={item} />} />
          : <Placeholder item={item} />}
      </div>
    );
  }
  // Folders with several models get a 2×2 mosaic; a 3rd preview spans the bottom row
  return (
    <div style={cardStyles.cardThumb}>
      <div style={s.mosaic}>
        {previews.slice(0, 4).map((p, i) => (
          <div
            key={p.id}
            style={{
              ...s.mosaicCell,
              ...(previews.length === 2 ? { gridRow: '1 / 3' } : {}),
              ...(previews.length === 3 && i === 2 ? { gridColumn: '1 / 3' } : {}),
            }}
          >
            <ThumbImage id={p.id} version={p.version} style={{ position: 'absolute', inset: 0 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function LibraryCard({ item, onOpen }) {
  const [hover, setHover] = useState(false);
  const isFolder = item.type === 'folder';
  const BadgeIcon = item.isZip ? FolderArchive : Folder;
  return (
    <div
      style={{ ...cardStyles.card, ...(hover ? cardStyles.cardHover : {}) }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onOpen(item)}
    >
      <div style={{ position: 'relative' }}>
        <ItemThumb item={item} />
        {isFolder && (
          <span style={s.cornerBadge}>
            <BadgeIcon size={11} /> {formatCount(item.modelCount)}
          </span>
        )}
      </div>
      <div style={cardStyles.cardBody}>
        <div style={cardStyles.cardName} title={item.name}>
          {item.self ? `${item.name} (this folder)` : item.name.replace(/\.zip$/i, '')}
        </div>
        <div style={cardStyles.cardMeta}>
          {isFolder
            ? <span>{formatCount(item.modelCount)} models · {formatCount(item.fileCount)} files</span>
            : <span>{formatCount(item.fileCount)} file{item.fileCount !== 1 ? 's' : ''}</span>}
          {item.isZip && <span style={cardStyles.badge}>zip</span>}
        </div>
        {!isFolder && <VariantChips variants={item.variants} />}
      </div>
    </div>
  );
}

export default function LibraryBrowser({ path, onNavigate, onOpenModel }) {
  const [data, setData]       = useState(null);
  const [page, setPage]       = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [pageSize, setPageSize] = usePageSize();
  const gridRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.library.folder(path, { page, limit: pageSize });
      // A folder that holds a single model opens as that model
      if (res.modelPath !== undefined) return onOpenModel(res.modelPath, { replace: true });
      setData(res);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [path, page, pageSize]);

  useEffect(() => { setPage(1); }, [path]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { gridRef.current?.scrollTo(0, 0); }, [path, page, pageSize]);

  const pendingThumbs = useThumbPolling(
    () => data?.items.some((i) => i.pending),
    load,
    [path, page, pageSize],
  );

  function open(item) {
    if (item.type === 'folder') onNavigate(item.path);
    else onOpenModel(item.path);
  }

  const current = data?.path === path ? data : null;

  return (
    <div style={s.wrapper}>
      <div style={s.toolbar}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {current
            ? <Breadcrumbs crumbs={current.crumbs} onNavigate={onNavigate} />
            : <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{error ? 'Folder not found' : 'Loading…'}</span>}
        </div>
        {current && (
          <span style={{ fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
            {formatCount(current.modelCount)} models · {formatCount(current.fileCount)} files
          </span>
        )}
        {pendingThumbs > 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
            Generating {formatCount(pendingThumbs)} thumbnails…
          </span>
        )}
      </div>

      <div style={s.grid} ref={gridRef}>
        {current?.items.map((item) => (
          <LibraryCard key={`${item.type}:${item.path}:${item.self ? 1 : 0}`} item={item} onOpen={open} />
        ))}
        {error && !loading && (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 60, color: 'var(--text-dim)' }}>
            <Folder size={40} strokeWidth={1} style={{ marginBottom: 12 }} />
            <div>This folder isn't in the library. It may have been moved or deleted.</div>
          </div>
        )}
      </div>

      {current && current.total > pageSize && (
        <Pagination page={page} pageSize={pageSize} total={current.total} onPage={setPage} onPageSize={setPageSize} />
      )}
    </div>
  );
}
