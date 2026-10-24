import { useState, useEffect, useCallback, useRef } from 'react';
import { Box } from 'lucide-react';
import { api } from '../api/client.js';
import { formatCount } from '../utils/format.js';
import { FileCard, cardStyles } from './FileCard.jsx';
import Pagination, { usePageSize } from './Pagination.jsx';
import { useThumbPolling } from '../hooks/useThumbPolling.js';

const s = {
  wrapper: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  toolbar: {
    padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex',
    alignItems: 'center', gap: 12, background: 'var(--surface)',
  },
  grid: { ...cardStyles.grid, flex: 1, overflowY: 'auto', padding: 16 },
};

export default function FileGrid({ filter, onSelect }) {
  const [files, setFiles]   = useState([]);
  const [total, setTotal]   = useState(0);
  const [page, setPage]     = useState(1);
  const [loading, setLoading] = useState(false);
  const [pageSize, setPageSize] = usePageSize();
  const gridRef  = useRef(null);

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

  // Re-fetch the current page only while some of its STL cards still lack a thumbnail
  const pendingThumbs = useThumbPolling(
    () => files.some((f) => !f.thumbnailPath && !f.thumbError && f.name.toLowerCase().endsWith('.stl')),
    load,
    [filter, page, pageSize],
  );

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
        {files.map((f) => <FileCard key={f.id} file={f} onSelect={onSelect} />)}
        {!loading && files.length === 0 && (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 60, color: 'var(--text-dim)' }}>
            <Box size={40} strokeWidth={1} style={{ marginBottom: 12 }} />
            <div>No files found. Click "Scan Library" to index your NAS.</div>
          </div>
        )}
      </div>

      {total > 0 && (
        <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={setPageSize} />
      )}
    </div>
  );
}
