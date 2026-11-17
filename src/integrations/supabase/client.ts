// Browser client with the supabase-js surface this app uses (from/rpc/storage/auth). Data lives in Notion and every
// call goes through POST /api/db (src/routes/api/db.ts), which applies the per-user access rules.
import { fromTable, type DbResult, type Query, type Session, type User } from './query';

export type { Session, User } from './query';

const KEY = 'grinder.session.v1';
type Listener = (event: string, session: Session | null) => void;
const listeners = new Set<Listener>();

function stored(): Session | null {
  if (typeof window === 'undefined') return null;
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null') as Session | null;
    return s && s.expires_at * 1000 > Date.now() ? s : null;
  } catch {
    return null;
  }
}
function setSession(s: Session | null, event: string) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch { /* storage blocked: the session lasts for this page only */ }
  memory = s;
  for (const l of [...listeners]) l(event, s);
}
let memory: Session | null | undefined;
const current = () => (memory === undefined ? (memory = stored()) : memory);

async function call(body: Record<string, unknown>): Promise<DbResult> {
  const token = current()?.access_token;
  const res = await fetch('/api/db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const out = (await res.json().catch(() => null)) as DbResult | null;
  if (res.status === 401 && current()) setSession(null, 'SIGNED_OUT'); // expired or removed account
  return out ?? { data: null, error: { message: `Request failed (${res.status})` } };
}

async function authCall(action: string, args: Record<string, unknown>, event?: string) {
  const r = await call({ op: 'auth', action, ...args });
  const s = (r.data as { session?: Session } | null)?.session;
  if (!r.error && s && event) setSession(s, event);
  return r as DbResult<{ session: Session | null; user: User | null }>;
}

const toBase64 = (buf: ArrayBuffer) => {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export const supabase = {
  from: fromTable((q: Query) => call({ op: 'query', q })),
  rpc: (fn: string, args?: Record<string, unknown>) => call({ op: 'rpc', fn, args: args ?? {} }),
  storage: {
    from: (_bucket: string) => ({
      upload: async (path: string, file: File | Blob, opts?: { contentType?: string }) =>
        call({ op: 'upload', path, name: (file as File).name || path.split('/').pop(), type: opts?.contentType || file.type || 'application/octet-stream', data: toBase64(await file.arrayBuffer()) }),
      download: async (path: string): Promise<DbResult<Blob>> => {
        const r = await call({ op: 'download', path });
        if (r.error) return r;
        const { type, data } = r.data as { type: string; data: string };
        return { data: new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type }), error: null };
      },
      remove: (paths: string[]) => call({ op: 'remove', paths }),
    }),
  },
  auth: {
    getSession: async () => ({ data: { session: current() }, error: null }),
    getUser: async (_token?: string) => ({ data: { user: current()?.user ?? null }, error: null }),
    getClaims: async () => ({ data: current() ? { claims: { sub: current()!.user.id } } : null, error: null }),
    onAuthStateChange(cb: Listener) {
      listeners.add(cb);
      queueMicrotask(() => cb('INITIAL_SESSION', current()));
      return { data: { subscription: { unsubscribe: () => { listeners.delete(cb); } } } };
    },
    signUp: (c: { email: string; password: string; options?: unknown }) => authCall('signup', { email: c.email, password: c.password }, 'SIGNED_IN'),
    signInWithPassword: (c: { email: string; password: string }) => authCall('signin', { email: c.email, password: c.password }, 'SIGNED_IN'),
    signOut: async (_opts?: unknown) => { setSession(null, 'SIGNED_OUT'); return { error: null }; },
    updateUser: async (attrs: { password?: string }) => {
      const r = await authCall('password', { password: attrs.password });
      if (!r.error) for (const l of [...listeners]) l('USER_UPDATED', current());
      return r;
    },
    resetPasswordForEmail: async (_email: string, _opts?: unknown) => ({
      data: null,
      error: { message: "Password reset by email isn't available. Ask the site owner to reset your account." },
    }),
    setSession: async (_tokens: unknown) => ({ data: { session: current() }, error: null }),
  },
};
