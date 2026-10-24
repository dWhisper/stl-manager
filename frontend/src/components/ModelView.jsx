import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Box } from 'lucide-react';
import { api } from '../api/client.js';
import { formatCount } from '../utils/format.js';
import { FileCard, cardStyles } from './FileCard.jsx';
import { Breadcrumbs, VariantChips } from './LibraryBrowser.jsx';
import { useThumbPolling } from '../hooks/useThumbPolling.js';
import ModelLinks from './ModelLinks.jsx';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const s = {
  wrapper: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 },
  toolbar: {
    padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex',
    alignItems: 'center', gap: 12, background: 'var(--surface)', minHeight: 41,
  },
  body: { flex: 1, overflowY: 'auto', padding: 16 },
  header: { marginBottom: 16 },
  title: { fontSize: 20, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 },
  sub: { fontSize: 12, color: 'var(--text-dim)', marginTop: 4 },
  // Small variant groups sit side by side; big ones take the full width
  sections: { display: 'flex', flexWrap: 'wrap', gap: '22px 28px', alignItems: 'flex-start' },
  section: { minWidth: 214, maxWidth: '100%' },
  sectionTitle: {
    fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', margin: '0 0 8px',
    display: 'flex', alignItems: 'center', gap: 8,
  },
};

// Files grouped by the variant folders they came from ("75mm / Supported / Hollow")
function groupFiles(files, variant) {
  const groups = new Map();
  for (const f of files) {
    if (variant && !f.sub.split('/').includes(variant)) continue;
    if (!groups.has(f.sub)) groups.set(f.sub, []);
    groups.get(f.sub).push(f);
  }
  return [...groups]
    .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : collator.compare(a, b)))
    .map(([sub, list]) => [sub, list.sort((a, b) => collator.compare(a.name, b.name))]);
}

export default function ModelView({ path, onNavigate, onSelect }) {
  const [model, setModel]   = useState(null);
  const [error, setError]   = useState(null);
  const [variant, setVariant] = useState(null);
  const bodyRef = useRef(null);

  const load = useCallback(async () => {
    try {
      setModel(await api.library.model(path));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [path]);

  useEffect(() => { setModel(null); setVariant(null); load(); }, [load]);
  useEffect(() => { bodyRef.current?.scrollTo(0, 0); }, [path]);

  useThumbPolling(
    () => model?.files.some((f) => !f.thumbnailPath && !f.thumbError && f.name.toLowerCase().endsWith('.stl')),
    load,
    [path],
  );

  const groups = useMemo(() => (model ? groupFiles(model.files, variant) : []), [model, variant]);
  const current = model?.path === path ? model : null;

  return (
    <div style={s.wrapper}>
      <div style={s.toolbar}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {current
            ? <Breadcrumbs crumbs={current.crumbs} onNavigate={onNavigate} />
            : <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{error ? 'Model not found' : 'Loading…'}</span>}
        </div>
      </div>

      <div style={s.body} ref={bodyRef}>
        {error && (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-dim)' }}>
            <Box size={40} strokeWidth={1} style={{ marginBottom: 12 }} />
            <div>This model isn't in the library. It may have been moved or deleted.</div>
          </div>
        )}
        {current && (
          <>
            <div style={s.header}>
              <div style={s.title}>
                <Box size={18} color="var(--accent)" />
                {current.name.replace(/\.zip$/i, '')}
              </div>
              <div style={s.sub}>
                {formatCount(current.files.length)} file{current.files.length !== 1 ? 's' : ''}
                {current.isZip && ' · in a zip'}
                {current.variants.length > 0 && ' · click a variant to filter'}
              </div>
              <VariantChips
                variants={current.variants}
                active={variant}
                onToggle={(v) => setVariant(variant === v ? null : v)}
              />
              <ModelLinks path={current.path} />
            </div>

            <div style={s.sections}>
            {groups.map(([sub, files]) => (
              <section key={sub} style={{ ...s.section, flex: `0 1 ${files.length * 214}px` }}>
                {(groups.length > 1 || sub) && (
                  <h3 style={s.sectionTitle}>
                    {sub ? sub.split('/').join(' / ') : 'Main files'}
                    <span style={{ fontWeight: 400 }}>{formatCount(files.length)}</span>
                  </h3>
                )}
                <div style={cardStyles.grid}>
                  {files.map((f) => <FileCard key={f.id} file={f} onSelect={onSelect} />)}
                </div>
              </section>
            ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
