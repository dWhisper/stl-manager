import { useState, useEffect, useRef } from 'react';
import { api } from '../api/client.js';

// While thumbnails are generating, poll every 4s and call reload() when the
// view still has tiles waiting on one. Returns the server's pending count.
// `isWaiting` and `reload` are read through refs so they can change every render.
export function useThumbPolling(isWaiting, reload, deps) {
  const [pending, setPending] = useState(0);
  const waitingRef = useRef(isWaiting);
  const reloadRef  = useRef(reload);
  waitingRef.current = isWaiting;
  reloadRef.current  = reload;

  useEffect(() => {
    async function check() {
      try {
        const s = await api.watcher.status();
        setPending(s.thumbPending ?? 0);
        if ((s.thumbPending ?? 0) > 0 && waitingRef.current()) reloadRef.current();
      } catch { /* ignore */ }
    }
    const timer = setInterval(check, 4000);
    check();
    return () => clearInterval(timer);
  }, deps); // restart poll on navigation

  return pending;
}
