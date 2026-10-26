import { useState, useEffect } from 'react';
import Header from './components/Header.jsx';
import Sidebar from './components/Sidebar.jsx';
import FileGrid from './components/FileGrid.jsx';
import LibraryBrowser from './components/LibraryBrowser.jsx';
import ModelView from './components/ModelView.jsx';
import FileDetail from './components/FileDetail.jsx';
import SearchResults from './components/SearchResults.jsx';
import IntegrationsPage from './components/IntegrationsPage.jsx';
import PurchasesPage from './components/PurchasesPage.jsx';
import DuplicatesPage from './components/DuplicatesPage.jsx';
import { useApi } from './hooks/useApi.js';
import { api } from './api/client.js';

// Library and model views live in the URL hash so links and the back button work
function parseHash() {
  const m = window.location.hash.match(/^#\/(library|model)(?:\/(.*))?$/);
  if (m) return { view: m[1], path: decodeURIComponent(m[2] ?? '') };
  if (window.location.hash === '#/all') return { view: 'all' };
  return null;
}

function hashFor(f) {
  if (f.view === 'library' || f.view === 'model') return `#/${f.view}/${encodeURIComponent(f.path ?? '')}`;
  return '#/all';
}

export default function App() {
  const [filter, setFilter]   = useState(() => parseHash() ?? { view: 'library', path: '' });
  const [view,   setView]     = useState(() => (window.location.hash === '#/purchases' ? 'purchases' : window.location.hash === '#/duplicates' ? 'duplicates' : 'files'));   // 'files' | 'integrations' | 'purchases' | 'duplicates'
  const [selectedId, setSelectedId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const { data: allTags, refresh: refreshTags } = useApi(() => api.tags.list());
  const { data: integrationStatus } = useApi(() => api.integrations.status());

  const isSearching = searchQuery.trim().length >= 2;

  useEffect(() => {
    const onHash = () => {
      if (window.location.hash === '#/purchases') return setView('purchases');
      if (window.location.hash === '#/duplicates') return setView('duplicates');
      const f = parseHash();
      if (f) { setFilter(f); setView('files'); }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function handleSetFilter(f, { replace = false } = {}) {
    const hash = hashFor(f);
    if (hash !== window.location.hash) {
      // pushState doesn't fire hashchange, so state is set here; Back fires it later
      if (replace) window.history.replaceState(null, '', hash);
      else         window.history.pushState(null, '', hash);
    }
    setFilter(f);
    setSearchQuery('');
    setView('files');
  }

  const browse    = (path) => handleSetFilter({ view: 'library', path });
  const openModel = (path, opts) => handleSetFilter({ view: 'model', path }, opts);

  function handleSetView(v) {
    // The purchases list links into the library, so it gets a history entry for Back
    if (v === 'purchases' && window.location.hash !== '#/purchases') window.history.pushState(null, '', '#/purchases');
    if (v === 'duplicates' && window.location.hash !== '#/duplicates') window.history.pushState(null, '', '#/duplicates');
    setView(v);
    setSearchQuery('');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, height: '100vh', overflow: 'hidden' }}>
      <Header query={searchQuery} setQuery={setSearchQuery} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar
          filter={filter}
          setFilter={handleSetFilter}
          view={view}
          setView={handleSetView}
        />
        {view === 'integrations' ? (
          <IntegrationsPage />
        ) : view === 'purchases' && !isSearching ? (
          <PurchasesPage onNavigate={browse} onOpenModel={openModel} integrationStatus={integrationStatus} />
        ) : view === 'duplicates' && !isSearching ? (
          <DuplicatesPage onNavigate={browse} />
        ) : isSearching ? (
          <SearchResults query={searchQuery} onSelect={setSelectedId} />
        ) : filter.view === 'library' ? (
          <LibraryBrowser path={filter.path} onNavigate={browse} onOpenModel={openModel} />
        ) : filter.view === 'model' ? (
          <ModelView path={filter.path} onNavigate={browse} onSelect={setSelectedId} />
        ) : (
          <FileGrid filter={filter} onSelect={setSelectedId} />
        )}
      </div>
      {selectedId && (
        <FileDetail
          fileId={selectedId}
          onClose={() => setSelectedId(null)}
          allTags={allTags}
          refreshTags={refreshTags}
          integrationStatus={integrationStatus}
        />
      )}
    </div>
  );
}
