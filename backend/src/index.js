import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import { getDb } from './db/schema.js';
import filesRouter from './routes/files.js';
import tagsRouter from './routes/tags.js';
import collectionsRouter from './routes/collections.js';
import originsRouter from './routes/origins.js';
import searchRouter       from './routes/search.js';
import integrationsRouter from './routes/integrations.js';
import libraryRouter      from './routes/library.js';
import reconcileRouter    from './routes/reconcile.js';
import linksRouter        from './routes/links.js';
import { startWatcher, getWatcherStatus, reconcile } from './services/scanner.js';
import { queueAll, getPendingCount } from './services/thumbnailer.js';
import { folderTree } from './services/library.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use('/api/files', filesRouter);
app.use('/api/tags', tagsRouter);
app.use('/api/collections', collectionsRouter);
app.use('/api/origins', originsRouter);
app.use('/api/search',       searchRouter);
app.use('/api/integrations', integrationsRouter);
app.use('/api/library',      libraryRouter);
app.use('/api/reconcile',    reconcileRouter);
app.use('/api/links',        linksRouter);

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/status', (req, res) => res.json({ ...getWatcherStatus(), thumbPending: getPendingCount() }));

// Manual reconcile: removes DB rows whose files no longer exist on disk.
// The watcher handles new/changed files automatically; this cleans up edge cases
// like files deleted while the container was stopped.
app.post('/api/reconcile', (req, res) => {
  const result = reconcile();
  res.json(result);
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`STL Manager API running on port ${PORT}`);
  getDb();
  startWatcher((count) => {
    console.log(`Initial index complete: ${count} files`);
    const queued = queueAll();
    if (queued) console.log(`Queued ${queued} thumbnail(s) for generation`);
    folderTree('');  // build the library index now rather than on the first visit
  });
});
