import { useRef, useEffect } from 'react';
import { Search, X, Box } from 'lucide-react';

export default function Header({ query, setQuery }) {
  const ref = useRef();

  // Ctrl+K / Cmd+K focuses the search bar
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
      if (e.key === 'Escape' && document.activeElement === ref.current) {
        setQuery('');
        ref.current?.blur();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setQuery]);

  return (
    <header style={{
      height: 52, background: 'var(--surface)', borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', padding: '0 16px', gap: 16, flexShrink: 0, zIndex: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent)', fontWeight: 700, fontSize: 15, letterSpacing: '-0.3px', minWidth: 140 }}>
        <Box size={17} />
        STL Manager
      </div>

      <div style={{
        flex: 1, maxWidth: 560, display: 'flex', alignItems: 'center', gap: 8,
        background: 'var(--surface2)', border: `1px solid ${query ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 'var(--radius)', padding: '7px 12px', transition: 'border-color 0.15s',
      }}>
        <Search size={14} color="var(--text-dim)" style={{ flexShrink: 0 }} />
        <input
          ref={ref}
          style={{ background: 'none', border: 'none', color: 'var(--text)', fontSize: 13, outline: 'none', flex: 1, minWidth: 0 }}
          placeholder="Search all files…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query ? (
          <button
            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 0, display: 'flex', flexShrink: 0 }}
            onClick={() => { setQuery(''); ref.current?.focus(); }}
          >
            <X size={14} />
          </button>
        ) : (
          <kbd style={{ fontSize: 10, color: 'var(--text-dim)', background: 'var(--border)', padding: '1px 5px', borderRadius: 3, flexShrink: 0 }}>⌘K</kbd>
        )}
      </div>
    </header>
  );
}
