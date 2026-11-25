// Notion as the app's database (replaces Supabase): one Notion database per table under NOTION_PAGE_ID, created on
// first use. Rows are cached in memory (this server is the only writer) and re-read from Notion every minute so edits
// made in Notion show up. Also: accounts (Users database, scrypt hashes, signed tokens), the old Postgres functions
// (rpc) and resume file storage. Server-only.
//
// ponytail: whole tables are loaded and filtered in memory, fine up to a few thousand rows per table; past that,
// push eq-filters into Notion database queries.
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DbResult, Filter, Query, Session, User } from '@/integrations/supabase/query';

// t text, n number, b checkbox, j JSON (as text), f file, d date (shows in Notion Calendar), s select, u url
type Col = 't' | 't?' | 'n' | 'n?' | 'b' | 'j' | 'f' | 'd' | 's' | 'u';
type Spec = { title: string; cols: Record<string, Col>; key: string[]; owner?: boolean; defaults?: Record<string, unknown>; options?: Record<string, [string, string][]> };
type Row = Record<string, unknown> & { __page: string };
export type Scope = { admin: true } | { admin?: false; uid: string | null };

// The first column of each table is the Notion title property. Timestamps are ISO text (exact, sortable).
const TABLES: Record<string, Spec> = {
  users: { title: 'Users', cols: { email: 't', id: 't', role: 't', password_hash: 't', created_at: 't', last_sign_in_at: 't?' }, key: ['id'], defaults: { role: 'user' } },
  resumes: { title: 'Resumes', cols: { title: 't', id: 't', user_id: 't', data: 'j', original_path: 't?', extracted_text: 't', created_at: 't', updated_at: 't' }, key: ['id'], owner: true, defaults: { title: 'My resume', data: {}, extracted_text: '' } },
  resume_versions: { title: 'Resume versions', cols: { label: 't', id: 't', resume_id: 't', user_id: 't', data: 'j', created_at: 't' }, key: ['id'], owner: true, defaults: { label: 'Saved version' } },
  saved_roles: { title: 'Saved roles', cols: { title: 't', id: 't', user_id: 't', company: 't', url: 't', status: 't', deadline: 'd', created_at: 't' }, key: ['user_id', 'url'], owner: true, defaults: { status: 'Saved' } },
  application_research: { title: 'Application research', cols: { cache_key: 't', id: 't', user_id: 't', data: 'j', checked_at: 't' }, key: ['user_id', 'cache_key'], owner: true, defaults: { data: {} } },
  company_sharing: { title: 'Company sharing', cols: { user_id: 't', share: 'b', updated_at: 't' }, key: ['user_id'], owner: true, defaults: { share: false } },
  shared_companies: { title: 'Shared companies', cols: { display_name: 't', user_id: 't', name_key: 't', website: 't?', logo_url: 't', one_liner: 't', industry: 't', location: 't', confirmed_at: 't?', created_at: 't' }, key: ['user_id', 'name_key'], owner: true, defaults: { logo_url: '', one_liner: '', industry: '', location: '' } },
  user_api_keys: { title: 'User API keys', cols: { user_id: 't', tavily: 't', nebius: 't', model: 't', updated_at: 't' }, key: ['user_id'], owner: true, defaults: { tavily: '', nebius: '', model: '' } },
  role_assessments: { title: 'Role assessments', cols: { role: 't', id: 't', user_id: 't', company: 't', job_url: 't', resume_id: 't?', questions: 'j', answers: 'j', score: 'n?', feedback: 'j', submitted_at: 't?', created_at: 't' }, key: ['id'], owner: true, defaults: { company: '', role: '', job_url: '', questions: [], answers: [], feedback: {} } },
  search_history: { title: 'Search history', cols: { query: 't', id: 't', user_id: 't', kind: 't', company: 't', urls: 'j', created_at: 't' }, key: ['id'], owner: true, defaults: { kind: 'chat', company: '', urls: [] } },
  chat_interactions: { title: 'Chat interactions', cols: { company: 't', id: 't', user_id: 't', kind: 't', model: 't', context: 't', messages: 'j', created_at: 't' }, key: ['id'], owner: true, defaults: { kind: 'chat', company: '', model: '', context: '', messages: [] } },
  demo_usage: { title: 'Daily usage', cols: { bucket: 't', day: 't', kind: 't', used: 'n' }, key: ['bucket', 'day', 'kind'], defaults: { used: 0 } },
  feature_allowance_usage: { title: 'Feature allowances', cols: { resource: 't', user_id: 't', kind: 't', period: 't', created_at: 't', own_key: 'b', processing_claimed: 'b' }, key: ['user_id', 'kind', 'period', 'resource'], owner: true, defaults: { own_key: false, processing_claimed: false } },
  resume_files: { title: 'Resume files', cols: { path: 't', user_id: 't', file: 'f' }, key: ['path'] },
  // Old CVs (Resume page, "Resume history") and old cover letters (Preparation, "Past cover letters"), uploaded by hand.
  resume_history: { title: 'Resume history', cols: { name: 't', id: 't', user_id: 't', date: 'd', file: 'f', notes: 't', created_at: 't' }, key: ['id'], owner: true, defaults: { notes: '' } },
  // Cover letters made in the app (Preparation > Create new cover letter) have data (the letter) and no file; text = the
  // letter as plain text, also read once from uploaded files so new drafts can draw on similar past letters.
  cover_letters: { title: 'Past cover letters', cols: { name: 't', id: 't', user_id: 't', date: 'd', file: 'f', notes: 't', text: 't', data: 'j', parsed: 'j', created_at: 't', updated_at: 't' }, key: ['id'], owner: true, defaults: { notes: '', text: '' } },
  // Engineering job search (Scotland first): shortlist from Discover, applications, preparation, contacts, profile.
  shortlist: { title: 'Shortlist', cols: { name: 't', id: 't', user_id: 't', company_number: 't', town: 't', postcode: 't', website: 'u', careers_url: 'u', summary: 't', sic: 't', size: 't', notes: 't', tags: 't', vacancy_count: 'n?', vacancies: 'j', vacancy_note: 't', checked_at: 't?', embeddable: 't', created_at: 't' }, key: ['user_id', 'company_number'], owner: true, defaults: { town: '', postcode: '', summary: '', sic: '', size: '', notes: '', tags: '', vacancies: [], vacancy_note: '', embeddable: '' } },
  firm_fit: { title: 'Firm fit', cols: { name: 't', id: 't', user_id: 't', company_number: 't', tier: 'n?', score: 'n?', reason: 't', scored_at: 't' }, key: ['user_id', 'company_number'], owner: true, defaults: { reason: '' } },
  // Discover search, editable in Notion: each row maps words in the search box to sectors and name filters.
  // Footer links (GitHub, YouTube, LinkedIn): paste a URL into a row to make its icon a link. Read by site.functions.ts.
  site_links: { title: 'Site links', cols: { label: 't', url: 'u' }, key: ['label'] },
  search_terms: { title: 'Search terms', cols: { term: 't', id: 't', sectors: 't', name_words: 't', also_words: 't', exclude_words: 't', notes: 't' }, key: ['term'], defaults: { sectors: '', name_words: '', also_words: '', exclude_words: '', notes: '' } },
  // Directories the Discover crawler reads firms from (Sources pop-up). The built-in IStructE directory is not stored.
  discover_sources: { title: 'Discover sources', cols: { name: 't', id: 't', user_id: 't', url: 'u', description: 't', sector: 't', created_at: 't' }, key: ['id'], owner: true, defaults: { description: '', sector: 'engineering' } },
  // Firms read from the IStructE directory and the Sources pop-up (src/lib/directory.server.ts). Id = listing slug.
  directory_firms: { title: 'Directory firms', cols: { name: 't', id: 't', source: 't', listing_url: 'u', website: 'u', careers_url: 'u', careers_checked: 't', email: 't', phone: 't', contact: 't', description: 't', address: 't', town: 't', postcode: 't', nation: 't', lat: 'n?', lng: 'n?', size: 't', specialisms: 't', work_type: 't', sector: 't', crawled_at: 't' }, key: ['id'], defaults: { sector: 'engineering' } },
  firm_lookups: { title: 'Firm lookups', cols: { name: 't', company_number: 't', website: 'u', careers_url: 'u', summary: 't', page_text: 't', checked_at: 't' }, key: ['company_number'], defaults: { summary: '', page_text: '' } },
  applications: {
    title: 'Applications',
    cols: { Company: 't', Position: 'u', Location: 't', date: 'd', 'Closing Date': 'd', Status: 's', 'Salary Range': 't', 'Link(s)': 't', 'Interview Date': 'd', id: 't', user_id: 't', created_at: 't' },
    key: ['id'], owner: true, defaults: { Location: '', 'Salary Range': '', 'Link(s)': '' },
    options: { Status: [['Applying', 'purple'], ['Applied', 'yellow'], ['Interviewing', 'blue'], ['No Response', 'default'], ['Accepted', 'green'], ['Rejected', 'gray'], ['Rejected (unanswered)', 'brown'], ['Pass', 'orange']] },
  },
  answers: { title: 'Repeatable answers', cols: { title: 't', id: 't', user_id: 't', answer: 't', created_at: 't', updated_at: 't' }, key: ['id'], owner: true, defaults: { answer: '' } },
  interview_questions: { title: 'Interview questions', cols: { question: 't', id: 't', user_id: 't', answer: 't', guidance: 't', created_at: 't', updated_at: 't' }, key: ['id'], owner: true, defaults: { answer: '', guidance: '' } },
  contacts: { title: 'Contacts', cols: { text: 't', id: 't', user_id: 't', link: 'u', created_at: 't' }, key: ['id'], owner: true },
  recruiters: { title: 'Recruiters', cols: { name: 't', id: 't', user_id: 't', agency: 't', email: 't', phone: 't', location_range: 't', opportunities: 't', notes: 't', last_contact: 'd', created_at: 't' }, key: ['id'], owner: true, defaults: { agency: '', email: '', phone: '', location_range: '', opportunities: '', notes: '' } },
  // My profile > Manifests: career plan and goals written now and then; only the latest can be edited (see execute).
  manifests: { title: 'Manifests', cols: { title: 't', id: 't', user_id: 't', now: 't', one_year: 't', five_years: 't', plan: 't', non_negotiables: 't', created_at: 't', updated_at: 't' }, key: ['id'], owner: true, defaults: { now: '', one_year: '', five_years: '', plan: '', non_negotiables: '' } },
  profiles: { title: 'Profiles', cols: { user_id: 't', languages: 'j', assessment: 't', discover: 'j', updated_at: 't' }, key: ['user_id'], owner: true, defaults: { languages: [], assessment: '' } },
  profile_history: { title: 'Profile history', cols: { label: 't', id: 't', user_id: 't', assessment: 't', created_at: 't' }, key: ['id'], owner: true },
};
const SERVER_ONLY = new Set(['site_links', 'users', 'demo_usage', 'resume_files', 'firm_lookups', 'directory_firms', 'profile_history', 'search_terms']); // never readable or writable from the browser
const READ_ONLY = new Set(['feature_allowance_usage']);

// ---------- Notion API (paced ~2.9 requests/s, retried on 429/5xx) ----------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let last = 0;
let queue: Promise<unknown> = Promise.resolve();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function notion(path: string, body?: unknown, method = 'POST'): Promise<any> {
  const go = async () => {
    for (let attempt = 0; ; attempt++) {
      const wait = last + 350 - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      const res = await fetch(`https://api.notion.com/v1/${path}`, {
        method,
        headers: { Authorization: `Bearer ${process.env['NOTION_TOKEN']}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
        body: body === undefined ? null : JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      }).catch(() => null);
      if (res?.ok) return res.json();
      if (attempt < 6 && (!res || res.status === 429 || res.status === 409 || res.status >= 500)) {
        await sleep(Number(res?.headers.get('retry-after') || 0) * 1000 || 2 ** attempt * 500);
        continue;
      }
      throw new Error(`Notion ${res?.status}: ${(await res?.text())?.slice(0, 300)}`);
    }
  };
  const p = queue.then(go, go);
  queue = p.catch(() => {});
  return p;
}

let ids: Promise<Record<string, string>> | null = null;
function dbIds() {
  ids ??= (async () => {
    const page = process.env['NOTION_PAGE_ID'];
    if (!process.env['NOTION_TOKEN'] || !page) throw new Error('The database is not configured (NOTION_TOKEN, NOTION_PAGE_ID).');
    // Databases may sit directly on the backend page or one level down in section pages (Discover, Shortlist, ...),
    // so the owner can organise them in Notion without the app creating duplicates.
    const found: Record<string, string> = {};
    const scan = async (parent: string, depth: number) => {
      let cursor: string | undefined;
      do {
        const r = await notion(`blocks/${parent}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`, undefined, 'GET');
        for (const b of r.results) {
          if (b.type === 'child_database' && !found[b.child_database.title]) found[b.child_database.title] = b.id;
          if (b.type === 'child_page' && depth < 1) await scan(b.id, depth + 1);
        }
        cursor = r.has_more ? r.next_cursor : undefined;
      } while (cursor);
    };
    await scan(page, 0);
    const out: Record<string, string> = {};
    for (const [name, s] of Object.entries(TABLES)) {
      const first = Object.keys(s.cols)[0]!;
      const props = Object.fromEntries(Object.entries(s.cols).map(([c, t]) => [c,
        c === first ? { title: {} } : t.startsWith('n') ? { number: {} } : t === 'b' ? { checkbox: {} } : t === 'f' ? { files: {} }
          : t === 'd' ? { date: {} } : t === 'u' ? { url: {} } : t === 's' ? { select: { options: (s.options?.[c] ?? []).map(([name, color]) => ({ name, color })) } } : { rich_text: {} }]));
      let id = found[s.title];
      if (!id) id = (await notion('databases', { parent: { type: 'page_id', page_id: page }, title: [{ type: 'text', text: { content: s.title } }], properties: props })).id as string;
      else {
        const db = await notion(`databases/${id}`, undefined, 'GET');
        const missing = Object.fromEntries(Object.entries(props).filter(([c]) => c !== first && !db.properties[c]));
        if (Object.keys(missing).length) await notion(`databases/${id}`, { properties: missing }, 'PATCH');
      }
      out[name] = id;
    }
    return out;
  })().catch((e) => { ids = null; throw e; });
  return ids;
}
/** Finds or creates every table now (used right after first-run setup). */
export const warmUp = () => dbIds().then(() => undefined);

// ---------- Row encoding ----------
function richText(s: string) {
  if (s.length > 190000) throw new Error('This is too large to save (Notion keeps up to 190,000 characters per field).');
  const out: { type: 'text'; text: { content: string } }[] = [];
  for (let i = 0; i < s.length;) {
    let end = Math.min(i + 2000, s.length);
    if (end < s.length && /[\uD800-\uDBFF]/.test(s[end - 1]!)) end--; // never split a surrogate pair
    out.push({ type: 'text', text: { content: s.slice(i, end) } });
    i = end;
  }
  return out;
}
function encode(spec: Spec, values: Record<string, unknown>) {
  const first = Object.keys(spec.cols)[0];
  const props: Record<string, unknown> = {};
  for (const [c, v] of Object.entries(values)) {
    const t = spec.cols[c];
    if (!t) continue;
    if (t === 'f') props[c] = { files: v ? [{ type: 'file_upload', file_upload: { id: (v as { upload: string }).upload }, name: (v as { name: string }).name.slice(0, 100) }] : [] };
    else if (t.startsWith('n')) props[c] = { number: v == null || v === '' ? null : Number(v) };
    else if (t === 'd') props[c] = { date: v ? { start: String(v) } : null };
    else if (t === 'u') props[c] = { url: v ? String(v).slice(0, 2000) : null };
    else if (t === 's') props[c] = { select: v ? { name: String(v).replace(/,/g, ' ').slice(0, 100) } : null };
    else if (t === 'b') props[c] = { checkbox: Boolean(v) };
    else {
      const rt = richText(t === 'j' ? JSON.stringify(v ?? null) : v == null ? '' : String(v));
      props[c] = c === first ? { title: rt } : { rich_text: rt };
    }
  }
  return props;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function decode(spec: Spec, page: any): Row {
  const row: Row = { __page: page.id };
  for (const [c, t] of Object.entries(spec.cols)) {
    const p = page.properties[c];
    if (!p) { row[c] = null; continue; }
    if (t === 'f') row[c] = p.files?.[0]?.file?.url ?? null;
    else if (t.startsWith('n')) row[c] = p.number ?? (t === 'n' ? 0 : null);
    else if (t === 'd') row[c] = p.date?.start ?? null;
    else if (t === 'u') row[c] = p.url ?? null;
    else if (t === 's') row[c] = p.select?.name ?? null;
    else if (t === 'b') row[c] = Boolean(p.checkbox);
    else {
      const s = ((p.title ?? p.rich_text ?? []) as { plain_text: string }[]).map((x) => x.plain_text).join('');
      if (t === 'j') { try { row[c] = s ? JSON.parse(s) : null; } catch { row[c] = null; } }
      else row[c] = t === 't?' && !s ? null : s;
    }
  }
  if ('id' in spec.cols && !row['id']) row['id'] = page.id;
  return row;
}

// ---------- Cache ----------
const TTL = 60_000;
const cache = new Map<string, { at: number; rows: Row[] }>();
const loading = new Map<string, Promise<Row[]>>();
// Notion's database query can lag a few seconds behind writes; recent writes are replayed over each reload.
const recent = new Map<string, Map<string, { row: Row | null; at: number }>>();

async function rows(table: string): Promise<Row[]> {
  const c = cache.get(table);
  if (c && Date.now() - c.at < TTL) return c.rows;
  let p = loading.get(table);
  if (!p) {
    p = (async () => {
      const id = (await dbIds())[table]!;
      const spec = TABLES[table]!;
      const out: Row[] = [];
      let cursor: string | undefined;
      do {
        const r = await notion(`databases/${id}/query`, { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
        for (const page of r.results) out.push(decode(spec, page));
        cursor = r.has_more ? r.next_cursor : undefined;
      } while (cursor);
      for (const [page, w] of recent.get(table) ?? []) {
        if (Date.now() - w.at > 120_000) { recent.get(table)!.delete(page); continue; }
        const i = out.findIndex((r) => r.__page === page);
        if (w.row && i >= 0) out[i] = w.row;
        else if (w.row) out.push(w.row);
        else if (i >= 0) out.splice(i, 1);
      }
      cache.set(table, { at: Date.now(), rows: out });
      return out;
    })().finally(() => loading.delete(table));
    loading.set(table, p);
  }
  return p;
}
function remember(table: string, page: string, row: Row | null) {
  if (!recent.has(table)) recent.set(table, new Map());
  recent.get(table)!.set(page, { row, at: Date.now() });
}

const now = () => new Date().toISOString();
function clean(spec: Spec, values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).filter(([c]) => Object.hasOwn(spec.cols, c)));
}
async function createRow(table: string, values: Record<string, unknown>): Promise<Row> {
  const spec = TABLES[table]!;
  const v: Record<string, unknown> = { ...spec.defaults, ...clean(spec, values) };
  for (const c of Object.keys(spec.cols)) if (v[c] === undefined) v[c] = null;
  if ('id' in spec.cols && !v['id']) v['id'] = randomUUID();
  for (const c of ['created_at', 'updated_at', 'checked_at']) if (c in spec.cols && !v[c]) v[c] = now();
  const all = await rows(table);
  const page = await notion('pages', { parent: { database_id: (await dbIds())[table] }, properties: encode(spec, v) });
  const row = { ...v, __page: page.id as string } as Row;
  if (spec.cols['file']) row['file'] = null;
  all.push(row);
  remember(table, row.__page, row);
  return row;
}
async function updateRow(table: string, row: Row, patch: Record<string, unknown>) {
  const spec = TABLES[table]!;
  const p = clean(spec, patch);
  if (!Object.keys(p).length) return;
  await notion(`pages/${row.__page}`, { properties: encode(spec, p) }, 'PATCH');
  Object.assign(row, p);
  remember(table, row.__page, row);
}
async function deleteRow(table: string, row: Row) {
  await notion(`pages/${row.__page}`, { archived: true }, 'PATCH');
  const all = await rows(table);
  const i = all.indexOf(row);
  if (i >= 0) all.splice(i, 1);
  remember(table, row.__page, null);
}

// One writer at a time, so read-check-write sequences (unique keys, quotas, upload claims) can't race.
let writing: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = writing.then(fn, fn);
  writing = p.catch(() => {});
  return p;
}

// ---------- Queries (the supabase-js subset in src/integrations/supabase/query.ts) ----------
const same = (a: unknown, b: unknown) => a === b || (a != null && b != null && String(a) === String(b));
function test(row: Row, f: Filter): boolean {
  const v = row[f.col];
  switch (f.op) {
    case 'eq': return same(v, f.val);
    case 'neq': return !same(v, f.val);
    case 'in': return Array.isArray(f.val) && f.val.some((x) => same(v, x));
    case 'is': return f.val === null ? v == null : v === f.val;
    default: {
      if (v == null || f.val == null) return false;
      const [a, b] = typeof v === 'number' ? [v, Number(f.val)] : [String(v), String(f.val)];
      return f.op === 'gt' ? a > b : f.op === 'gte' ? a >= b : f.op === 'lt' ? a < b : a <= b;
    }
  }
}
function pick(spec: Spec, row: Row, columns: string) {
  const cols = columns.trim() === '*' ? Object.keys(spec.cols) : columns.split(',').map((c) => c.trim()).filter(Boolean);
  return Object.fromEntries(cols.filter((c) => Object.hasOwn(spec.cols, c)).map((c) => [c, row[c] ?? null]));
}
const fail = (message: string, code?: string): DbResult => ({ data: null, error: { message, code } });
const uidOf = (s: Scope) => (s.admin ? null : s.uid);

export async function execute(q: Query, scope: Scope): Promise<DbResult> {
  const spec = Object.hasOwn(TABLES, q.table) ? TABLES[q.table]! : null;
  if (!spec) return fail(`relation "${q.table}" does not exist`, '42P01');
  const filters = [...(q.filters || [])];
  let values = (Array.isArray(q.values) ? q.values : q.values ? [q.values] : []).map((v) => clean(spec, v));
  if (!scope.admin) {
    if (SERVER_ONLY.has(q.table)) return fail(`permission denied for table ${q.table}`, '42501');
    const uid = scope.uid;
    if (q.action !== 'select' && (!uid || READ_ONLY.has(q.table))) return fail('new row violates row-level security policy', '42501');
    if (!uid) return { data: q.single ? null : [], error: null };
    if (spec.owner) {
      // Rows typed straight into Notion have no user_id yet; they belong to the admin (the owner of this deployment).
      filters.push(await isAdmin(uid) ? { col: 'user_id', op: 'in', val: [uid, null, ''] } : { col: 'user_id', op: 'eq', val: uid });
      values = values.map((v) => ({ ...v, user_id: uid }));
    }
    if (q.table === 'resume_versions' && q.action === 'insert') {
      const own = await rows('resumes');
      if (values.some((v) => !own.some((r) => r['id'] === v['resume_id'] && r['user_id'] === uid))) return fail('new row violates row-level security policy', '42501');
    }
  }

  const run = async (): Promise<DbResult> => {
    let out: Row[] = [];
    const all = await rows(q.table);
    const matched = () => all.filter((r) => filters.every((f) => test(r, f)));
    if (q.action === 'select') {
      out = matched();
      for (const o of [...(q.order || [])].reverse())
        out = [...out].sort((a, b) => {
          const x = a[o.col], y = b[o.col];
          if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
          const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0;
          return o.ascending ? c : -c;
        });
      if (q.limit != null) out = out.slice(0, q.limit);
    } else if (q.action === 'insert') {
      for (const v of values) {
        if (spec.key.every((k) => v[k] != null) && all.some((r) => spec.key.every((k) => same(r[k], v[k]))))
          return fail(`duplicate key value violates unique constraint "${q.table}_pkey"`, '23505');
        out.push(await createRow(q.table, v));
      }
    } else if (q.action === 'upsert') {
      if (q.table === 'manifests') return fail('Use insert or update for manifests', '42501');
      const keys = q.onConflict ? q.onConflict.split(',').map((k) => k.trim()) : spec.key;
      for (const v of values) {
        const hit = all.find((r) => keys.every((k) => same(r[k], v[k])) && (scope.admin || !spec.owner || r['user_id'] === v['user_id']));
        if (hit) { if (!q.ignoreDuplicates) await updateRow(q.table, hit, v); out.push(hit); }
        else out.push(await createRow(q.table, v));
      }
    } else if (q.action === 'update') {
      const patch = { ...(values[0] || {}) };
      if (!scope.admin) delete patch['user_id'];
      if (q.table === 'manifests') {
        // Earlier manifests are a record of what you thought then: only each person's latest one can change.
        const latest = (uid: unknown) => all.filter((x) => x['user_id'] === uid).reduce<Row | null>((m, x) => (!m || String(x['created_at']) > String(m['created_at']) ? x : m), null);
        if (matched().some((r) => latest(r['user_id']) !== r)) return fail('Earlier manifests are locked. Start a new one instead.', '42501');
      }
      for (const r of matched()) { await updateRow(q.table, r, patch); out.push(r); }
    } else if (q.action === 'delete') {
      for (const r of matched()) { await deleteRow(q.table, r); out.push(r); }
    }
    const data = q.columns ? out.map((r) => pick(spec, r, q.columns!)) : null;
    if (q.single && data) {
      if (data.length > 1 || (q.single === 'one' && data.length === 0))
        return fail('JSON object requested, multiple (or no) rows returned', 'PGRST116');
      return { data: data[0] ?? null, error: null };
    }
    return { data, error: null };
  };
  return q.action === 'select' ? run() : serial(run);
}

// ---------- The old Postgres functions ----------
const isAdmin = async (uid: string | null) => !!uid && (await rows('users')).some((u) => u['id'] === uid && u['role'] === 'admin');
const today = () => now().slice(0, 10);
const CAPS: Record<string, number> = { company: 5, upload: 1 };

export async function rpc(fn: string, args: Record<string, unknown> = {}, scope: Scope): Promise<DbResult> {
  const uid = uidOf(scope);
  const admin = scope.admin || (await isAdmin(uid));
  const serverOnly = ['demo_used', 'demo_consume', 'consume_feature_allowance'];
  if (serverOnly.includes(fn) && !scope.admin) return fail(`permission denied for function ${fn}`, '42501');
  if (fn.startsWith('admin_') && !admin) return fail('Forbidden', '42501');
  switch (fn) {
    case 'has_role': {
      if (!scope.admin && args['_user_id'] !== uid) return { data: false, error: null };
      return { data: (await rows('users')).some((u) => u['id'] === args['_user_id'] && u['role'] === args['_role']), error: null };
    }
    case 'community_catalog':
    case 'community_companies': {
      const sharing = new Set((await rows('company_sharing')).filter((s) => s['share']).map((s) => s['user_id']));
      const confirmed = (await rows('shared_companies')).filter((c) => sharing.has(c['user_id']) && c['confirmed_at'] && c['website']);
      const by = new Map<string, Row[]>();
      for (const c of confirmed) by.set(String(c['website']), [...(by.get(String(c['website'])) || []), c]);
      const list = [...by.values()].map((cs) => {
        const d = [...cs].sort((a, b) => String(b['confirmed_at']).localeCompare(String(a['confirmed_at'])))[0]!;
        return { name: d['display_name'], people: new Set(cs.map((c) => c['user_id'])).size, website: d['website'], logo_url: d['logo_url'], one_liner: d['one_liner'], industry: d['industry'], location: d['location'] };
      }).sort((a, b) => b.people - a.people || String(a.name).localeCompare(String(b.name))).slice(0, 500);
      return { data: fn === 'community_catalog' ? list : list.map(({ name, people }) => ({ name, people })), error: null };
    }
    case 'resume_upload_authorized':
      return { data: (await rows('feature_allowance_usage')).some((r) => r['user_id'] === uid && r['kind'] === 'upload' && r['resource'] === args['_path']), error: null };
    case 'demo_used':
      return { data: Number((await rows('demo_usage')).find((r) => r['bucket'] === args['_bucket'] && r['day'] === today() && r['kind'] === args['_kind'])?.['used'] ?? 0), error: null };
    case 'demo_consume':
      return serial(async () => {
        const limit = Number(args['_limit']);
        const bucket = String(args['_bucket']);
        if (await isAdmin(bucket.replace(/^v:/, ''))) return { data: limit, error: null }; // admins are never limited
        const all = await rows('demo_usage');
        const hit = all.find((r) => r['bucket'] === bucket && r['day'] === today() && r['kind'] === args['_kind']);
        const used = Number(hit?.['used'] ?? 0);
        if (used >= limit) return { data: -1, error: null };
        if (hit) await updateRow('demo_usage', hit, { used: used + 1 });
        else await createRow('demo_usage', { bucket, day: today(), kind: args['_kind'], used: 1 });
        return { data: limit - used - 1, error: null };
      });
    case 'consume_feature_allowance':
      return serial(async () => {
        const [user, kind, resource] = [String(args['_user']), String(args['_kind']), String(args['_resource'])];
        const cap = CAPS[kind];
        if (cap === undefined) return fail('Invalid allowance');
        const mine = (await rows('feature_allowance_usage')).filter((r) => r['user_id'] === user && r['kind'] === kind && r['period'] === '1970-01-01');
        if (mine.some((r) => r['resource'] === resource)) return { data: Math.max(0, cap - mine.length), error: null };
        const unlimited = await isAdmin(user);
        if (mine.length >= cap && !unlimited) return { data: -1, error: null };
        await createRow('feature_allowance_usage', { user_id: user, kind, period: '1970-01-01', resource, own_key: false });
        return { data: Math.max(0, cap - mine.length - 1), error: null };
      });
    case 'admin_stats': {
      const [users, chats, searches, quizzes, resumes, saved] = await Promise.all(['users', 'chat_interactions', 'search_history', 'role_assessments', 'resumes', 'saved_roles'].map(rows));
      const desc = (rs: Row[]) => [...rs].sort((a, b) => String(b['created_at']).localeCompare(String(a['created_at']))).slice(0, 50);
      const strip = (r: Row) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== '__page' && k !== 'password_hash'));
      return {
        data: {
          users: users!.length, chats: chats!.length, searches: searches!.length, quizzes: quizzes!.length,
          quizzes_submitted: quizzes!.filter((q) => q['submitted_at']).length, resumes: resumes!.length, saved_roles: saved!.length,
          recent_users: desc(users!).map((u) => ({ email: u['email'], created_at: u['created_at'], last_sign_in_at: u['last_sign_in_at'] })),
          recent_chats: desc(chats!).map(strip), recent_searches: desc(searches!).map(strip), recent_quizzes: desc(quizzes!).map(strip),
        },
        error: null,
      };
    }
    case 'admin_dataset': {
      const [chats, quizzes] = await Promise.all([rows('chat_interactions'), rows('role_assessments')]);
      return {
        data: {
          chats: [...chats].sort((a, b) => String(a['created_at']).localeCompare(String(b['created_at']))).map((c) => ({ context: c['context'], messages: c['messages'] })),
          quizzes: quizzes.filter((q) => q['submitted_at']).map((q) => ({ company: q['company'], role: q['role'], questions: q['questions'], answers: q['answers'], score: q['score'], feedback: q['feedback'] })),
        },
        error: null,
      };
    }
    case 'admin_storage': {
      const names = ['chat_interactions', 'search_history', 'role_assessments', 'resumes', 'resume_versions', 'saved_roles', 'application_research', 'shared_companies', 'user_api_keys'];
      const tables = await Promise.all(names.map(async (name) => ({ name, bytes: Buffer.byteLength(JSON.stringify(await rows(name))) })));
      return { data: { tables, files_bytes: 0, files_count: (await rows('resume_files')).length }, error: null };
    }
    default:
      return fail(`function ${fn} does not exist`, '42883');
  }
}

// ---------- Resume file storage ----------
export async function uploadFile(scope: Scope, path: string, name: string, type: string, base64: string): Promise<DbResult> {
  const uid = uidOf(scope);
  if (!scope.admin && (!uid || !path.startsWith(`${uid}/`) || path.includes('..'))) return fail('new row violates row-level security policy', '42501');
  if (!scope.admin && !(await rpc('resume_upload_authorized', { _path: path }, scope)).data) return fail('new row violates row-level security policy', '42501');
  const buf = Buffer.from(base64, 'base64');
  if (buf.length > 5 * 1024 * 1024) return fail('The file is larger than 5 MB, the most Notion stores per file. Save a smaller PDF and try again.');
  const up = await storeInNotion(buf, name, type);
  if (typeof up === 'string') return fail(up);
  await serial(() => createRow('resume_files', { path, user_id: uid ?? path.split('/')[0], file: { upload: up.id, name } }));
  return { data: { path }, error: null };
}

/** Sends a file to Notion's file upload API; returns the upload id, or an error message. */
async function storeInNotion(buf: Buffer, name: string, type: string): Promise<{ id: string } | string> {
  const up = await notion('file_uploads', { mode: 'single_part', filename: name.slice(0, 100), content_type: type });
  // Retried: a pooled connection Notion has already closed fails with "other side closed" on the first try.
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3 && !res?.ok; attempt++) {
    if (attempt) await sleep(1000 * attempt);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buf)], { type }), name.slice(0, 100));
    res = await fetch(up.upload_url, { method: 'POST', headers: { Authorization: `Bearer ${process.env['NOTION_TOKEN']}`, 'Notion-Version': '2022-06-28' }, body: form, signal: AbortSignal.timeout(60000) })
      .catch((e: unknown) => { console.error('notion file upload:', (e as Error).message); return null; });
    if (res && !res.ok && res.status < 500 && res.status !== 429) break; // a real rejection: retrying won't help
  }
  if (!res?.ok) return `The file could not be stored in Notion${res ? ` (${res.status}: ${(await res.text()).slice(0, 160)})` : ''}.`;
  return { id: up.id as string };
}

/** Stores an old CV (Resume history) or cover letter (Past cover letters) for the signed-in user. */
export async function uploadDocument(uid: string, name: string, type: string, base64: string, table: 'resume_history' | 'cover_letters', date: string | null): Promise<DbResult> {
  const buf = Buffer.from(base64, 'base64');
  if (buf.length > 5 * 1024 * 1024) return fail('The file is larger than 5 MB, the most Notion stores per file.');
  const up = await storeInNotion(buf, name, type);
  if (typeof up === 'string') return fail(up);
  const row = await serial(() => createRow(table, { name, user_id: uid, date, file: { upload: up.id, name } }));
  return { data: { id: row['id'], name, date }, error: null };
}
/** A fresh link (Notion file links expire after an hour) to the file on one of the user's rows, or null. */
export async function freshFileUrl(table: 'resume_history' | 'cover_letters', uid: string, id: string): Promise<string | null> {
  const row = (await rows(table)).find((r) => r['id'] === id && r['user_id'] === uid);
  if (!row) return null;
  const page = await notion(`pages/${row.__page}`, undefined, 'GET');
  return (page.properties?.file?.files?.[0]?.file?.url as string | undefined) ?? null;
}
export async function downloadFile(scope: Scope, path: string): Promise<DbResult> {
  const uid = uidOf(scope);
  const row = (await rows('resume_files')).find((r) => r['path'] === path && (scope.admin || r['user_id'] === uid));
  if (!row) return fail('Object not found', '404');
  // Notion file links expire after an hour, so read a fresh one.
  const page = await notion(`pages/${row.__page}`, undefined, 'GET');
  const url = page.properties?.file?.files?.[0]?.file?.url as string | undefined;
  if (!url) return fail('Object not found', '404');
  const res = await fetch(url);
  if (!res.ok) return fail(`The file could not be read (${res.status}).`);
  return { data: { type: res.headers.get('content-type') || 'application/octet-stream', data: Buffer.from(await res.arrayBuffer()).toString('base64') }, error: null };
}
export async function removeFiles(scope: Scope, paths: string[]): Promise<DbResult> {
  const uid = uidOf(scope);
  return serial(async () => {
    for (const r of (await rows('resume_files')).filter((r) => paths.includes(String(r['path'])) && (scope.admin || r['user_id'] === uid)))
      await deleteRow('resume_files', r);
    return { data: paths.map((p) => ({ name: p })), error: null };
  });
}

// ---------- Accounts ----------
function secret() {
  const s = process.env['AUTH_SECRET'];
  if (!s || s.length < 32) throw new Error('AUTH_SECRET is not set.');
  return s;
}
const publicUser = (u: Row): User => ({ id: String(u['id']), email: String(u['email']), created_at: String(u['created_at']), role: String(u['role']) });
function session(u: Row): Session {
  const exp = Math.floor(Date.now() / 1000) + 30 * 86400;
  const body = Buffer.from(JSON.stringify({ sub: u['id'], exp })).toString('base64url');
  const sig = createHmac('sha256', secret()).update(body).digest('base64url');
  return { access_token: `${body}.${sig}`, token_type: 'bearer', expires_at: exp, user: publicUser(u) };
}
const hash = (pw: string) => {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${scryptSync(pw, salt, 64).toString('base64')}`;
};
function passwordOk(pw: string, stored: unknown) {
  const [kind, salt, h] = String(stored).split('$');
  if (kind !== 'scrypt' || !salt || !h) return false;
  const a = scryptSync(pw, Buffer.from(salt, 'base64'), 64);
  const b = Buffer.from(h, 'base64');
  return a.length === b.length && timingSafeEqual(a, b);
}
const findEmail = async (email: string) => (await rows('users')).find((u) => String(u['email']).toLowerCase() === email);

/** Verifies a token from `Authorization: Bearer …` and returns the account, or null. */
export async function verifyToken(token?: string | null): Promise<User | null> {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const good = createHmac('sha256', secret()).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== good.length || !timingSafeEqual(given, good)) return null;
  let claims: { sub?: string; exp?: number };
  try { claims = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  if (!claims.sub || !claims.exp || claims.exp * 1000 < Date.now()) return null;
  const u = (await rows('users')).find((r) => r['id'] === claims.sub);
  return u ? publicUser(u) : null;
}

type AuthResult = { data: { session: Session | null; user: User | null }; error: { message: string } | null };
const authFail = (message: string): AuthResult => ({ data: { session: null, user: null }, error: { message } });

// ponytail: no sign-in rate limit; add one (per email + IP) before exposing this beyond a trusted audience.
export function signUp(emailRaw: string, password: string): Promise<AuthResult> {
  const email = String(emailRaw || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return Promise.resolve(authFail('Enter a valid email address.'));
  if (String(password || '').length < 8 || password.length > 200) return Promise.resolve(authFail('Password should be at least 8 characters.'));
  return serial(async () => {
    if (await findEmail(email)) return authFail('User already registered');
    const first = (await rows('users')).length === 0; // the first account (the owner) becomes the admin
    const u = await createRow('users', { email, password_hash: hash(password), role: first ? 'admin' : 'user', last_sign_in_at: now() });
    const s = session(u);
    return { data: { session: s, user: s.user }, error: null };
  });
}
export async function signIn(emailRaw: string, password: string): Promise<AuthResult> {
  const u = await findEmail(String(emailRaw || '').trim().toLowerCase());
  if (!u || !passwordOk(String(password || ''), u['password_hash'])) return authFail('Invalid login credentials');
  await serial(() => updateRow('users', u, { last_sign_in_at: now() }));
  const s = session(u);
  return { data: { session: s, user: s.user }, error: null };
}
export async function changePassword(uid: string, password: string): Promise<AuthResult> {
  if (String(password || '').length < 8 || password.length > 200) return authFail('Password should be at least 8 characters.');
  const u = (await rows('users')).find((r) => r['id'] === uid);
  if (!u) return authFail('User not found');
  await serial(() => updateRow('users', u, { password_hash: hash(password) }));
  return { data: { session: null, user: publicUser(u) }, error: null };
}
