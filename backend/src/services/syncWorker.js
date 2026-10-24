// Fetches a platform's purchases in a child process. In the API process,
// thumbnail rendering keeps the event loop and libuv thread pool busy, and a
// sync's fetches there stalled indefinitely; a separate process has its own.

import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import * as cults from './cults.js';

const FETCHERS = {
  cults3d: cults.getAllPurchases,
};

export const SYNC_PLATFORMS = Object.keys(FETCHERS);

const TIMEOUT_MS = 5 * 60_000;

// Resolves with the purchase list; onProgress(done, total) as pages arrive
export function runSync(platform, username, apiKey, onProgress) {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), ['--child'], { stdio: 'inherit' });
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('Sync timed out after 5 minutes')), TIMEOUT_MS);

    child.on('message', (msg) => {
      if (msg.progress) onProgress?.(msg.progress.done, msg.progress.total);
      else if (msg.error) finish(reject, Object.assign(new Error(msg.error), { status: msg.status }));
      else if (msg.list) finish(resolve, msg.list);
    });
    child.on('error', (e) => finish(reject, e));
    child.on('exit', (code) => finish(reject, new Error(`Sync process exited (${code})`)));
    // Credentials go over IPC, not argv, so they don't show up in ps
    child.send({ platform, username, apiKey });
  });
}

if (process.argv[2] === '--child') {
  process.once('message', async ({ platform, username, apiKey }) => {
    try {
      const list = await FETCHERS[platform](username, apiKey, {
        onProgress: (done, total) => process.send({ progress: { done, total } }),
      });
      process.send({ list });
    } catch (e) {
      process.send({ error: e.message, status: e.status });
    }
  });
}
