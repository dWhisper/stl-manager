import { useState, useEffect, useRef } from 'react';
import { FileBox, FileArchive, AlertTriangle, Layers, ArrowLeftRight, Loader } from 'lucide-react';
import { api } from '../api/client.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function titleCase(s) {
  return s.replace(/(^|\s|-|_)(\w)/g, (_, sep, c) => (sep === '-' || sep === '_' ? ' ' : sep) + c.toUpperCase());
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function displayDir(file) {
  if (file.inZip) return `inside ${file.zipSource}`;
  const parts = file.path.split('/');
  return parts.slice(-3, -1).join('/') || parts.slice(0, -1).join('/');
}

// ─── sub-components ──────────────────────────────────────────────────────────

const STATE_STYLES = {
  supported:   { background: '#166534', color: '#86efac', label: 'Supported' },
  unsupported: { background: '#7c2d12', color: '#fdba74', label: 'Unsupported' },
};

function SupportBadge({ state }) {
  if (!state) return null;
  const { background, color, label } = STATE_STYLES[state];
  return (
    <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 3, background, color, flexShrink: 0 }}>
      {label}
    </span>
  );
}

function FlagBadge({ icon: Icon, label, color }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600,
      padding: '2px 7px', borderRadius: 4, background: `${color}22`, color,
      border: `1px solid ${color}44`,
    }}>
      <Icon size={11} /> {label}
    </span>
  );
}

function FileRow({ file, onSelect, highlight }) {
  const [hover, setHover]     = useState(false);
  const [imgOk, setImgOk]     = useState(!!file.thumbnailPath);
  const Icon = file.inZip ? FileArchive : FileBox;
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
        cursor: 'pointer', borderRadius: 6, transition: 'background 0.1s',
        background: hover ? 'var(--surface2)' : highlight ? 'rgba(99,102,241,0.04)' : 'transparent',
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onSelect(file.id)}
    >
      {file.thumbnailPath && imgOk ? (
        <img
          src={api.files.thumbUrl(file.id)}
          alt=""
          style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4, flexShrink: 0, border: '1px solid var(--border)' }}
          onError={() => setImgOk(false)}
        />
      ) : (
        <Icon size={18} strokeWidth={1.5} color={file.inZip ? 'var(--text-dim)' : 'var(--accent)'} style={{ flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{file.name}</span>
          <SupportBadge state={file.supportState} />
          {file.inZip && (
            <span style={{ fontSize: 10, color: 'var(--text-dim)', background: 'var(--border)', padding: '1px 4px', borderRadius: 3 }}>zip</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayDir(file)}{file.size ? ` · ${formatSize(file.size)}` : ''}
        </div>
      </div>
      {file.tagNames.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 160 }}>
          {file.tagNames.slice(0, 3).map((t, i) => (
            <span key={i} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: Object.values(file.tagColors)[i] || 'var(--accent)', color: '#fff' }}>{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// Card for a support pair — shows unsupported/neutral on left, supported on right
function SupportPairCard({ group, onSelect }) {
  const supported   = group.files.filter((f) => f.supportState === 'supported');
  const unsupported = group.files.filter((f) => f.supportState === 'unsupported');
  const neutral     = group.files.filter((f) => f.supportState === null);
  // "source" side = unsupported + neutral files
  const sourceFiles = [...unsupported, ...neutral];

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
        background: 'var(--surface2)', borderBottom: '1px solid var(--border)',
      }}>
        <ArrowLeftRight size={13} color="#a78bfa" />
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', flex: 1 }}>
          {titleCase(group.normalizedName)}
        </span>
        <FlagBadge icon={ArrowLeftRight} label="Support Pair" color="#a78bfa" />
        {group.flags.hasDuplicates && <FlagBadge icon={AlertTriangle} label="Duplicate" color="#f59e0b" />}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr' }}>
        {/* Source (unsupported / neutral) */}
        <div style={{ borderRight: '1px solid var(--border)' }}>
          <div style={{ padding: '4px 12px', fontSize: 10, fontWeight: 600, color: '#fdba74', background: 'rgba(124,45,18,0.15)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Unsupported / Original
          </div>
          {sourceFiles.length > 0
            ? sourceFiles.map((f) => <FileRow key={f.id} file={f} onSelect={onSelect} />)
            : <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-dim)' }}>—</div>}
        </div>

        {/* Divider arrow */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 6px', color: 'var(--text-dim)' }}>
          <ArrowLeftRight size={14} />
        </div>

        {/* Supported */}
        <div>
          <div style={{ padding: '4px 12px', fontSize: 10, fontWeight: 600, color: '#86efac', background: 'rgba(22,101,52,0.2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Supported
          </div>
          {supported.length > 0
            ? supported.map((f) => <FileRow key={f.id} file={f} onSelect={onSelect} />)
            : <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-dim)' }}>—</div>}
        </div>
      </div>
    </div>
  );
}

// Card for duplicates or cross-directory groups
function GroupCard({ group, onSelect }) {
  const flagColor  = group.flags.hasDuplicates ? '#f59e0b' : '#60a5fa';
  const flagLabel  = group.flags.hasDuplicates ? 'Possible Duplicate' : 'Cross-Directory';
  const FlagIcon   = group.flags.hasDuplicates ? AlertTriangle : Layers;

  return (
    <div style={{ border: `1px solid ${flagColor}44`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
        background: `${flagColor}0d`, borderBottom: `1px solid ${flagColor}44`,
      }}>
        <FlagIcon size={13} color={flagColor} />
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', flex: 1 }}>
          {titleCase(group.normalizedName)}
        </span>
        <FlagBadge icon={FlagIcon} label={flagLabel} color={flagColor} />
      </div>
      {group.files.map((f) => <FileRow key={f.id} file={f} onSelect={onSelect} highlight />)}
    </div>
  );
}

// Plain single-file result
function SingleResult({ file, onSelect }) {
  return <FileRow file={file} onSelect={onSelect} />;
}

// ─── main component ───────────────────────────────────────────────────────────

export default function SearchResults({ query, onSelect }) {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(false);
  const debounce = useRef(null);

  useEffect(() => {
    if (query.trim().length < 2) { setData(null); return; }
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        setData(await api.search.query(query.trim()));
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(debounce.current);
  }, [query]);

  if (query.trim().length < 2) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 13 }}>
        Type at least 2 characters to search
      </div>
    );
  }

  const flaggedGroups   = (data?.groups ?? []).filter((g) => Object.values(g.flags).some(Boolean));
  const unflaggedGroups = (data?.groups ?? []).filter((g) => !Object.values(g.flags).some(Boolean));

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Result count header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
          {loading
            ? 'Searching…'
            : data
            ? `${data.total} result${data.total !== 1 ? 's' : ''} for "${data.query}"`
            : ''}
        </span>
        {loading && <Loader size={13} color="var(--text-dim)" style={{ animation: 'spin 1s linear infinite' }} />}
        {!loading && flaggedGroups.length > 0 && (
          <span style={{ fontSize: 12, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 4 }}>
            <AlertTriangle size={12} /> {flaggedGroups.length} group{flaggedGroups.length !== 1 ? 's' : ''} flagged
          </span>
        )}
      </div>

      {/* Flagged groups section */}
      {flaggedGroups.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Flagged
          </div>
          {flaggedGroups.map((g) =>
            g.flags.hasSupportPair
              ? <SupportPairCard key={g.normalizedName} group={g} onSelect={onSelect} />
              : <GroupCard       key={g.normalizedName} group={g} onSelect={onSelect} />
          )}
        </section>
      )}

      {/* Regular results */}
      {unflaggedGroups.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {flaggedGroups.length > 0 && (
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Other Results
            </div>
          )}
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {unflaggedGroups.map((g, i) => (
              <div key={g.normalizedName} style={{ borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
                <SingleResult file={g.files[0]} onSelect={onSelect} />
              </div>
            ))}
          </div>
        </section>
      )}

      {!loading && data && data.total === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-dim)' }}>
          No files found matching "{query}"
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
