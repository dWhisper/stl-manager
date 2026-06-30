import { useState } from 'react';
import Header from './components/Header.jsx';
import Sidebar from './components/Sidebar.jsx';
import FileGrid from './components/FileGrid.jsx';
import FileDetail from './components/FileDetail.jsx';
import SearchResults from './components/SearchResults.jsx';
import { useApi } from './hooks/useApi.js';
import { api } from './api/client.js';

export default function App() {
  const [filter, setFilter]   = useState({ view: 'all' });
  const [selectedId, setSelectedId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const { data: allTags, refresh: refreshTags } = useApi(() => api.tags.list());

  const isSearching = searchQuery.trim().length >= 2;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Header query={searchQuery} setQuery={setSearchQuery} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar filter={filter} setFilter={(f) => { setFilter(f); setSearchQuery(''); }} />
        {isSearching
          ? <SearchResults query={searchQuery} onSelect={setSelectedId} />
          : <FileGrid filter={filter} onSelect={setSelectedId} />}
      </div>
      {selectedId && (
        <FileDetail
          fileId={selectedId}
          onClose={() => setSelectedId(null)}
          allTags={allTags}
          refreshTags={refreshTags}
        />
      )}
    </div>
  );
}
