// A small stand-in for the supabase-js query builder, so the app's existing `.from(...).select().eq()...` calls keep
// working while the data lives in Notion (src/lib/notion-db.server.ts). Isomorphic: the browser sends the built
// query to /api/db, server code runs it directly. Only the calls this app makes are supported.
import type { Database } from './types';

export type Filter = { col: string; op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'is'; val: unknown };
export type Query = {
  table: string;
  action: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
  columns?: string | undefined; // select list; also set by .select() after a write
  filters: Filter[];
  order?: { col: string; ascending: boolean }[] | undefined;
  limit?: number | undefined;
  single?: 'one' | 'maybe' | undefined;
  values?: Record<string, unknown> | Record<string, unknown>[] | undefined;
  onConflict?: string | undefined;
  ignoreDuplicates?: boolean | undefined;
};
export type DbError = { message: string; code?: string | undefined };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DbResult<T = any> = { data: T; error: null } | { data: null; error: DbError };
export type Executor = (q: Query) => Promise<DbResult>;

type Tables = Database['public']['Tables'];
type Values = Record<string, unknown>;

export class QueryBuilder<R, Out = R[]> implements PromiseLike<DbResult<Out>> {
  constructor(private run: Executor, private q: Query) {}
  private with<O = Out>(patch: Partial<Query>) { return new QueryBuilder<R, O>(this.run, { ...this.q, ...patch }); }
  private filter(col: string, op: Filter['op'], val: unknown) { return this.with({ filters: [...this.q.filters, { col, op, val }] }); }

  select(columns = '*') { return this.with({ columns }); }
  insert(values: Values | Values[]) { return this.with({ action: 'insert', values, columns: undefined }); }
  update(values: Values) { return this.with({ action: 'update', values, columns: undefined }); }
  upsert(values: Values | Values[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    return this.with({ action: 'upsert', values, onConflict: opts?.onConflict, ignoreDuplicates: opts?.ignoreDuplicates, columns: undefined });
  }
  delete() { return this.with({ action: 'delete', columns: undefined }); }
  eq(col: string, val: unknown) { return this.filter(col, 'eq', val); }
  neq(col: string, val: unknown) { return this.filter(col, 'neq', val); }
  gt(col: string, val: unknown) { return this.filter(col, 'gt', val); }
  gte(col: string, val: unknown) { return this.filter(col, 'gte', val); }
  lt(col: string, val: unknown) { return this.filter(col, 'lt', val); }
  lte(col: string, val: unknown) { return this.filter(col, 'lte', val); }
  in(col: string, val: unknown[]) { return this.filter(col, 'in', val); }
  is(col: string, val: unknown) { return this.filter(col, 'is', val); }
  match(obj: Values) { return this.with({ filters: [...this.q.filters, ...Object.entries(obj).map(([col, val]) => ({ col, op: 'eq' as const, val }))] }); }
  order(col: string, opts?: { ascending?: boolean }) { return this.with({ order: [...(this.q.order || []), { col, ascending: opts?.ascending ?? true }] }); }
  limit(n: number) { return this.with({ limit: n }); }
  single() { return this.with<R>({ single: 'one' }); }
  maybeSingle() { return this.with<R | null>({ single: 'maybe' }); }

  then<A = DbResult<Out>, B = never>(ok?: ((v: DbResult<Out>) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.run(this.q)
      .catch((e: unknown): DbResult => ({ data: null, error: { message: e instanceof Error ? e.message : String(e) } }))
      .then((r) => r as DbResult<Out>)
      .then(ok, fail);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RowOf<T extends string> = T extends keyof Tables ? Tables[T]['Row'] : Record<string, any>;
export const fromTable = (run: Executor) => <T extends string>(table: T) =>
  new QueryBuilder<RowOf<T>>(run, { table, action: 'select', columns: '*', filters: [] });

export type User = { id: string; email: string; created_at: string; role?: string; user_metadata?: Record<string, unknown> };
export type Session = { access_token: string; token_type: 'bearer'; expires_at: number; user: User };
