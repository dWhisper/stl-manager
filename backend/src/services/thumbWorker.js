import fs from 'fs';
import { parentPort } from 'worker_threads';
import { renderStlToJpeg } from './stlRender.js';
import { geoKeyFromStl } from './geoKey.js';

// Renders run here so parsing/rasterizing large STLs never blocks the API's event loop.
// mode 'geo' only fingerprints the mesh (no render, no outPath needed).
parentPort.on('message', async ({ jobId, stlPath, outPath, mode }) => {
  try {
    const ok = mode === 'geo'
      ? geoKeyFromStl(fs.readFileSync(stlPath))
      : await renderStlToJpeg(stlPath, outPath);
    parentPort.postMessage({ jobId, ok });
  } catch (err) {
    parentPort.postMessage({ jobId, error: err.message });
  }
});
