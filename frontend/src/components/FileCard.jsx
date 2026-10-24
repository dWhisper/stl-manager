import { useState } from 'react';
import { FileBox, FileArchive } from 'lucide-react';
import { api } from '../api/client.js';

export const cardStyles = {
  grid: {
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
  cardMeta: { fontSize: 10, color: 'var(--text-dim)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  badge: { background: 'var(--surface2)', border: '1px solid var(--border)', padding: '0 4px', borderRadius: 3 },
  tags: { display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 6 },
  tag: { fontSize: 10, padding: '1px 5px', borderRadius: 4, color: '#fff', fontWeight: 500 },
};
const s = cardStyles;

export function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// Shimmer skeleton shown while a thumbnail is being generated
export function ThumbSkeleton() {
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', background: 'var(--surface2)' }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)',
        animation: 'shimmer 1.6s infinite',
        backgroundSize: '200% 100%',
      }} />
      <style>{`
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
      `}</style>
    </div>
  );
}

// A thumbnail image that falls back to `fallback` until it loads, or if it fails
export function ThumbImage({ id, version, fallback = <ThumbSkeleton />, style }) {
  const [loaded, setLoaded]   = useState(false);
  const [errored, setErrored] = useState(false);
  return (
    <>
      {(!loaded || errored) && fallback}
      {!errored && (
        <img
          src={api.files.thumbUrl(id, version)}
          alt=""
          style={{ ...s.thumbImg, ...style, display: loaded ? 'block' : 'none' }}
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
        />
      )}
    </>
  );
}

// Individual thumbnail cell for a file
function CardThumb({ file }) {
  const Icon = file.inZip ? FileArchive : FileBox;
  const icon = (
    <div style={s.noPreview}>
      <Icon size={40} strokeWidth={1} />
      {file.thumbError && <span>No preview</span>}
    </div>
  );

  if (!file.thumbnailPath) return (
    <div style={s.cardThumb} title={file.thumbError ? `No preview: ${file.thumbError}` : undefined}>
      {/* Skeleton while an STL thumbnail is on its way; icon for failures and other formats */}
      {file.name.toLowerCase().endsWith('.stl') && !file.thumbError ? <ThumbSkeleton /> : icon}
    </div>
  );

  return (
    <div style={s.cardThumb}>
      <ThumbImage id={file.id} version={file.updatedAt} />
    </div>
  );
}

export function FileCard({ file, onSelect }) {
  const [hover, setHover] = useState(false);
  const tagList = file.tag_names ? file.tag_names.split(',').filter(Boolean) : [];
  const tagColors = {};
  if (file.tag_data) {
    file.tag_data.split(',').forEach((t) => {
      const sep = t.lastIndexOf(':');
      tagColors[t.slice(0, sep)] = t.slice(sep + 1);
    });
  }
  return (
    <div
      style={{ ...s.card, ...(hover ? s.cardHover : {}) }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onSelect(file.id)}
    >
      <CardThumb file={file} />
      <div style={s.cardBody}>
        <div style={s.cardName} title={file.name}>{file.name}</div>
        <div style={s.cardMeta}>
          <span>{formatSize(file.size)}</span>
          {file.inZip && <span style={s.badge}>zip</span>}
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
}
