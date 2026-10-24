import { useState } from 'react';
import { formatCount } from '../utils/format.js';

export const PAGE_SIZES = [48, 96, 192, 384];
const PAGE_SIZE_KEY = 'stl-manager.pageSize';

const s = {
  bar: {
    padding: '8px 16px', borderTop: '1px solid var(--border)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    fontSize: 12, color: 'var(--text-dim)', background: 'var(--surface)',
  },
  btn: {
    padding: '4px 10px', background: 'var(--surface2)', border: '1px solid var(--border)',
    color: 'var(--text)', borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: 12,
  },
  group: { display: 'flex', alignItems: 'center', gap: 6 },
  select: {
    padding: '3px 6px', background: 'var(--surface2)', border: '1px solid var(--border)',
    color: 'var(--text)', borderRadius: 'var(--radius)', fontSize: 12,
  },
};

function initialPageSize() {
  try {
    const saved = Number(localStorage.getItem(PAGE_SIZE_KEY));
    if (PAGE_SIZES.includes(saved)) return saved;
  } catch { /* storage unavailable */ }
  return 96;
}

// Page size shared by every paginated view and remembered in this browser
export function usePageSize() {
  const [pageSize, setPageSize] = useState(initialPageSize);
  function save(size) {
    try { localStorage.setItem(PAGE_SIZE_KEY, String(size)); } catch { /* storage unavailable */ }
    setPageSize(size);
  }
  return [pageSize, save];
}

export default function Pagination({ page, pageSize, total, noun = 'tiles', onPage, onPageSize }) {
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const firstShown = total ? (page - 1) * pageSize + 1 : 0;
  const lastShown  = Math.min(page * pageSize, total);

  function changePageSize(size) {
    // Keep the first visible tile on screen when the page size changes
    onPage(Math.floor(((page - 1) * pageSize) / size) + 1);
    onPageSize(size);
  }

  return (
    <div style={s.bar}>
      <span>Showing {formatCount(firstShown)}–{formatCount(lastShown)} of {formatCount(total)}</span>
      <div style={s.group}>
        <button style={s.btn} disabled={page === 1}          onClick={() => onPage(1)}>« First</button>
        <button style={s.btn} disabled={page === 1}          onClick={() => onPage(page - 1)}>← Prev</button>
        <span style={{ padding: '0 6px' }}>Page {formatCount(page)} of {formatCount(totalPages)}</span>
        <button style={s.btn} disabled={page >= totalPages}  onClick={() => onPage(page + 1)}>Next →</button>
        <button style={s.btn} disabled={page >= totalPages}  onClick={() => onPage(totalPages)}>Last »</button>
      </div>
      <label style={s.group}>
        {noun[0].toUpperCase() + noun.slice(1)} per page
        <select style={s.select} value={pageSize} onChange={(e) => changePageSize(Number(e.target.value))}>
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
    </div>
  );
}
