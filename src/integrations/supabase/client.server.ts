// Server-side database client with full access (the old Supabase service role). Data lives in Notion.
// Load inside server handlers: const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
import { fromTable } from './query';
import { execute, rpc, verifyToken, type Scope } from '@/lib/notion-db.server';

const ADMIN: Scope = { admin: true };

/** A client limited to one user's rows, like a signed-in Supabase client under row-level security. */
export function userClient(uid: string) {
  const scope: Scope = { uid };
  return {
    from: fromTable((q) => execute(q, scope)),
    rpc: (fn: string, args?: Record<string, unknown>) => rpc(fn, args ?? {}, scope),
  };
}

export const supabaseAdmin = {
  from: fromTable((q) => execute(q, ADMIN)),
  rpc: (fn: string, args?: Record<string, unknown>) => rpc(fn, args ?? {}, ADMIN),
  auth: {
    getUser: async (token: string) => {
      const user = await verifyToken(token).catch(() => null);
      return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'Invalid token' } };
    },
  },
};
