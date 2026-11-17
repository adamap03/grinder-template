// Small in-memory rate limiter (fixed window per key). Used by src/server.ts for every request and by /api/db for
// sign-in attempts. ponytail: per process and reset on restart; move to a shared store if the app runs on several
// servers.
const windows = new Map<string, { start: number; count: number }>();

/** Counts one hit for `key`; false when it is over `limit` hits within `windowMs`. */
export function hit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start > windowMs) { windows.set(key, { start: now, count: 1 }); return true; }
  w.count++;
  return w.count <= limit;
}

/** Clears a key (e.g. after a successful sign-in). */
export const reset = (key: string) => void windows.delete(key);

// Drop old windows now and then so the map can't grow without end.
setInterval(() => { const cutoff = Date.now() - 60 * 60 * 1000; for (const [k, w] of windows) if (w.start < cutoff) windows.delete(k); }, 10 * 60 * 1000).unref?.();

/** The caller's address as seen through a reverse proxy, else one shared bucket (local use). */
export function clientKey(request: Request): string {
  return (request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0] || 'local').trim();
}
