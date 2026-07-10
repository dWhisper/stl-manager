import { useState, useEffect } from 'react';
import { X, ExternalLink, Scissors, Trash2, Plus } from 'lucide-react';
import { api } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import STLViewer from './STLViewer.jsx';
import PlatformPicker from './PlatformPicker.jsx';

const SLICERS = [
  { id: 'bambu', label: 'Bambu Studio', proto: (p) => `bambustudio://open?file=${encodeURIComponent(p)}` },
  { id: 'chitubox', label: 'Chitubox', proto: (p) => `chitubox://open?file=${encodeURIComponent(p)}` },
  { id: 'lychee', label: 'Lychee Slicer', proto: (p) => `lychee://open?file=${encodeURIComponent(p)}` },
];

const SOURCE_LABELS = {
  cults3d: 'Cults 3D', myminifactory: 'MyMiniFactory', patreon: 'Patreon',
  printables: 'Printables', thingiverse: 'Thingiverse', thangs: 'Thangs', cgtrader: 'CGTrader', other: 'Other',
};

const s = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  panel: {
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12,
    width: '90vw', maxWidth: 960, maxHeight: '90vh', display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    padding: '14px 18px', borderBottom: '1px solid var(--border)',
    display: 'flex', alignItems: 'center', gap: 10,
  },
  title: { flex: 1, fontWeight: 600, fontSize: 15, wordBreak: 'break-word' },
  closeBtn: {
    background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer',
    padding: 4, display: 'flex',
  },
  body: { display: 'flex', flex: 1, overflow: 'hidden' },
  left: { flex: '0 0 420px', padding: 16, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12 },
  right: { flex: 1, padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 },
  section: { display: 'flex', flexDirection: 'column', gap: 8 },
  sectionLabel: { fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' },
  tag: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 4, fontSize: 12, color: '#fff', fontWeight: 500 },
  tagX: { cursor: 'pointer', opacity: 0.7, lineHeight: 1 },
  input: {
    background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)',
    borderRadius: 'var(--radius)', padding: '6px 10px', fontSize: 13, outline: 'none', width: '100%',
  },
  select: {
    background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)',
    borderRadius: 'var(--radius)', padding: '6px 10px', fontSize: 13, outline: 'none', width: '100%',
  },
  btn: {
    padding: '6px 12px', borderRadius: 'var(--radius)', border: 'none', cursor: 'pointer',
    fontSize: 12, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 5,
  },
  imgThumb: { height: 140, objectFit: 'cover', borderRadius: 'var(--radius)', border: '1px solid var(--border)', cursor: 'pointer' },
  path: { fontSize: 11, color: 'var(--text-dim)', wordBreak: 'break-all', background: 'var(--surface2)', padding: '4px 8px', borderRadius: 4 },
  originCard: {
    background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
    padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4,
  },
  slicerRow: { display: 'flex', gap: 6, flexWrap: 'wrap' },
};

export default function FileDetail({ fileId, onClose, allTags, refreshTags, integrationStatus }) {
  const { data: file, refresh } = useApi(() => api.files.get(fileId), [fileId]);
  const [addingTag,      setAddingTag]     = useState(false);
  const [addingOrigin,   setAddingOrigin]  = useState(false);
  const [showPicker,     setShowPicker]    = useState(false);
  const [originForm, setOriginForm] = useState({ source: 'cults3d', url: '', externalName: '', externalAuthor: '' });
  const [imgIdx, setImgIdx] = useState(0);
  const [notes, setNotes] = useState('');

  const connectedPlatforms = integrationStatus
    ? Object.entries(integrationStatus).filter(([, v]) => v.connected).map(([k]) => k)
    : [];

  useEffect(() => { if (file) setNotes(file.notes || ''); }, [file]);

  if (!file) return null;

  async function removeTag(tagId) {
    await api.files.removeTag(fileId, tagId);
    refresh();
  }

  async function addTag(tagId) {
    await api.files.addTag(fileId, tagId);
    setAddingTag(false);
    refresh();
  }

  async function addOrigin() {
    await api.origins.create({ fileId, ...originForm });
    setAddingOrigin(false);
    setOriginForm({ source: 'cults3d', url: '', externalName: '', externalAuthor: '' });
    refresh();
  }

  async function deleteOrigin(id) {
    await api.origins.delete(id);
    refresh();
  }

  async function saveNotes() {
    await api.files.patch(fileId, { notes });
  }

  const unusedTags = (allTags || []).filter((t) => !file.tags?.find((ft) => ft.id === t.id));

  return (
    <div style={s.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={s.panel}>
        <div style={s.header}>
          <div style={s.title}>{file.name}</div>
          <button style={s.closeBtn} onClick={onClose}><X size={18} /></button>
        </div>

        <div style={s.body}>
          {/* Left: viewer + images */}
          <div style={s.left}>
            <STLViewer url={api.files.stlUrl(fileId)} height="280px" />

            {file.images?.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {file.images.map((img, i) => (
                  <img key={i} src={img} style={s.imgThumb} alt="" onClick={() => setImgIdx(i)} />
                ))}
              </div>
            )}

            {/* Slicer buttons */}
            <div style={s.section}>
              <div style={s.sectionLabel}>Open in Slicer</div>
              <div style={s.slicerRow}>
                {SLICERS.map((sl) => (
                  <a key={sl.id} href={sl.proto(file.path)} style={{ textDecoration: 'none' }}>
                    <button style={{ ...s.btn, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                      <Scissors size={12} /> {sl.label}
                    </button>
                  </a>
                ))}
              </div>
              <div style={s.path}>{file.path}</div>
            </div>
          </div>

          {/* Right: metadata */}
          <div style={s.right}>
            {/* Tags */}
            <div style={s.section}>
              <div style={s.sectionLabel}>Tags</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                {(file.tags || []).map((t) => (
                  <span key={t.id} style={{ ...s.tag, background: t.color }}>
                    {t.name}
                    <span style={s.tagX} onClick={() => removeTag(t.id)}>×</span>
                  </span>
                ))}
                <button
                  style={{ ...s.btn, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text-dim)' }}
                  onClick={() => setAddingTag((v) => !v)}
                >
                  <Plus size={11} /> Add Tag
                </button>
              </div>
              {addingTag && (
                <select style={s.select} onChange={(e) => e.target.value && addTag(e.target.value)}>
                  <option value="">— Select tag —</option>
                  {unusedTags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}
            </div>

            {/* Notes */}
            <div style={s.section}>
              <div style={s.sectionLabel}>Notes</div>
              <textarea
                style={{ ...s.input, minHeight: 80, resize: 'vertical' }}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={saveNotes}
                placeholder="Add notes…"
              />
            </div>

            {/* Origins */}
            <div style={s.section}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={s.sectionLabel}>Origins</div>
                <button
                  style={{ ...s.btn, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text-dim)' }}
                  onClick={() => setAddingOrigin((v) => !v)}
                >
                  <Plus size={11} /> Add
                </button>
              </div>

              {(file.origins || []).map((o) => (
                <div key={o.id} style={s.originCard}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>{SOURCE_LABELS[o.source] || o.source}</span>
                    <button style={{ ...s.closeBtn, fontSize: 10 }} onClick={() => deleteOrigin(o.id)}><Trash2 size={12} /></button>
                  </div>
                  {o.external_name && <div style={{ fontSize: 12 }}>{o.external_name}</div>}
                  {o.external_author && <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>by {o.external_author}</div>}
                  {o.url && (
                    <a href={o.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 3 }}>
                      <ExternalLink size={10} /> {o.url.slice(0, 48)}…
                    </a>
                  )}
                </div>
              ))}

              {addingOrigin && (
                <div style={{ ...s.originCard, gap: 8 }}>
                  {/* Platform picker toggle — only shown when at least one platform is connected */}
                  {connectedPlatforms.length > 0 && (
                    <button
                      style={{ ...s.btn, background: showPicker ? 'var(--accent)' : 'var(--surface2)', border: '1px solid var(--border)', color: showPicker ? '#fff' : 'var(--text-dim)', width: '100%', justifyContent: 'center' }}
                      onClick={() => setShowPicker(v => !v)}
                    >
                      {showPicker ? 'Fill manually instead' : '🔗 Import from connected platform'}
                    </button>
                  )}

                  {showPicker ? (
                    <PlatformPicker
                      connectedPlatforms={connectedPlatforms}
                      onSelect={(origin) => {
                        setOriginForm({ source: origin.source, url: origin.url, externalName: origin.externalName, externalAuthor: origin.externalAuthor });
                        setShowPicker(false);
                      }}
                    />
                  ) : (
                    <>
                      <select style={s.select} value={originForm.source} onChange={(e) => setOriginForm((f) => ({ ...f, source: e.target.value }))}>
                        {Object.entries(SOURCE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                      </select>
                      <input style={s.input} placeholder="Name on source site" value={originForm.externalName} onChange={(e) => setOriginForm((f) => ({ ...f, externalName: e.target.value }))} />
                      <input style={s.input} placeholder="Author / designer" value={originForm.externalAuthor} onChange={(e) => setOriginForm((f) => ({ ...f, externalAuthor: e.target.value }))} />
                      <input style={s.input} placeholder="URL (optional)" value={originForm.url} onChange={(e) => setOriginForm((f) => ({ ...f, url: e.target.value }))} />
                    </>
                  )}

                  <div style={{ display: 'flex', gap: 6 }}>
                    <button style={{ ...s.btn, background: 'var(--accent)', color: '#fff' }} onClick={addOrigin} disabled={showPicker}>Save</button>
                    <button style={{ ...s.btn, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-dim)' }} onClick={() => { setAddingOrigin(false); setShowPicker(false); }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>

            {/* File info */}
            <div style={s.section}>
              <div style={s.sectionLabel}>File Info</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span>Size: {file.size ? `${(file.size / 1048576).toFixed(2)} MB` : 'unknown'}</span>
                <span>Modified: {file.modifiedAt ? new Date(file.modifiedAt).toLocaleString() : '—'}</span>
                {file.inZip && <span style={{ color: 'var(--accent)' }}>Stored inside: {file.zipSource}</span>}
              </div>
              <div style={s.path}>{file.inZip ? file.path.split('::')[1] : file.path}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
