import { parentPort } from 'worker_threads';
import { renderStlToJpeg } from './stlRender.js';

// Renders run here so parsing/rasterizing large STLs never blocks the API's event loop
parentPort.on('message', async ({ jobId, stlPath, outPath }) => {
  try {
    const ok = await renderStlToJpeg(stlPath, outPath);
    parentPort.postMessage({ jobId, ok });
  } catch (err) {
    parentPort.postMessage({ jobId, error: err.message });
  }
});
