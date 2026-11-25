// Shortlist "Updates": every shortlisted firm's job board is read once a week (and on "Check now"); postings not seen
// before are marked with first_seen, so the Updates card can highlight new ones. A firm's very first read only sets
// the baseline (nothing in it counts as new), and so does a list read before Updates existed (no first_seen at all),
// so the card shows only changes, never a backlog. Server-only.
//
// ponytail: an hourly timer in this server process starts the weekly runs; one server is assumed (like the rate limiter).

const WEEK = 7 * 24 * 3600_000;
export type Posting = { title: string; location: string; url: string; closing_date: string; summary: string; first_seen?: string };
type Status = { running: boolean; done: number; total: number; started_at: string | null };
const runs = new Map<string, Status>(); // per user

const keyOf = (v: Posting) => (v.url && /^https?:/.test(v.url) ? v.url.replace(/[?#].*$/, '').replace(/\/$/, '') : `${v.title}|${v.location}`).toLowerCase().trim();

/** Whether this read only sets a firm's baseline: its first successful read (vacancy_count still empty), or a list
 *  saved before Updates existed (postings without first_seen). */
export const isBaseline = (vacancyCount: unknown, before: Posting[] | null) => vacancyCount == null || (!!before?.length && !before.some((v) => 'first_seen' in v));

/** A fresh read merged with the previous list: postings seen before keep their first_seen; new ones get now, except
 *  on a baseline read (see isBaseline). */
export function mergePostings(before: Posting[] | null, read: Omit<Posting, 'first_seen'>[], firstRead: boolean, now = new Date().toISOString()): Posting[] {
  const seen = new Map((before ?? []).map((v) => [keyOf(v), v.first_seen ?? '']));
  return read.map((v) => ({ ...v, first_seen: seen.get(keyOf(v)) ?? (firstRead ? '' : now) }));
}

export const runStatus = (uid: string): Status => runs.get(uid) ?? { running: false, done: 0, total: 0, started_at: null };

/** Reads every shortlisted firm's job board for one user, one firm at a time. */
export async function checkJobBoards(uid: string): Promise<void> {
  if (runStatus(uid).running) return;
  const { userClient } = await import('@/integrations/supabase/client.server');
  const { readVacancies } = await import('./firms.server');
  const db = userClient(uid);
  const firms = ((await db.from('shortlist').select('*')).data ?? []).filter((f) => /^https?:\/\//.test(String(f['careers_url'] || f['website'] || '')));
  const status: Status = { running: true, done: 0, total: firms.length, started_at: new Date().toISOString() };
  const unread: { id: string; name: string }[] = []; // boards that only show listings in a browser, or failed
  runs.set(uid, status);
  try {
    for (const f of firms) {
      const now = new Date().toISOString();
      try {
        const read = await readVacancies(String(f['name']), String(f['careers_url'] || f['website']));
        if (read.readable) {
          const vacancies = mergePostings(f['vacancies'] as Posting[] | null, read.vacancies, isBaseline(f['vacancy_count'], f['vacancies'] as Posting[] | null), now);
          await db.from('shortlist').update({ vacancies, vacancy_count: vacancies.length, vacancy_note: read.note, checked_at: now }).eq('id', String(f['id']));
        } else { unread.push({ id: String(f['id']), name: String(f['name']) }); await db.from('shortlist').update({ vacancy_note: read.note, checked_at: now }).eq('id', String(f['id'])); }
      } catch (e) { unread.push({ id: String(f['id']), name: String(f['name']) }); console.error('job board', f['name'], (e as Error).message); }
      status.done++;
    }
    await db.from('profiles').upsert({ user_id: uid, jobs_checked_at: new Date().toISOString(), jobs_unread: { firms: unread, total: firms.length }, updated_at: new Date().toISOString() });
  } finally { status.running = false; }
}

/** New postings (first seen in the last `days` days) for the Updates card, newest first. */
export async function newPostings(uid: string, days = 7) {
  const { userClient } = await import('@/integrations/supabase/client.server');
  const db = userClient(uid);
  const since = new Date(Date.now() - days * 24 * 3600_000).toISOString();
  const [firms, profile] = await Promise.all([db.from('shortlist').select('id,name,vacancies,checked_at,vacancy_note'), db.from('profiles').select('jobs_checked_at,jobs_unread').maybeSingle()]);
  const list = (firms.data ?? []).flatMap((f) => ((f['vacancies'] as Posting[] | null) ?? []).filter((v) => v.first_seen && v.first_seen >= since)
    .map((v) => ({ firm: String(f['name']), firm_id: String(f['id']), ...v })))
    .sort((a, b) => (b.first_seen ?? '').localeCompare(a.first_seen ?? ''));
  const checked = (profile.data?.['jobs_checked_at'] as string | null) ?? null;
  const unread = (profile.data?.['jobs_unread'] as { firms?: { id: string; name: string }[]; total?: number } | null) ?? null;
  return { postings: list, unread: unread?.firms ?? [], boards: unread?.total ?? 0, checked_at: checked, next_at: checked ? new Date(Date.parse(checked) + WEEK).toISOString() : null, status: runStatus(uid) };
}

/** Starts the hourly timer that runs each user's weekly check when it is due (users with a shortlist only). */
let timer: ReturnType<typeof setInterval> | null = null;
export function startWeeklyChecks() {
  if (timer) return;
  const tick = async () => {
    try {
      const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
      const [lists, profiles] = await Promise.all([supabaseAdmin.from('shortlist').select('user_id'), supabaseAdmin.from('profiles').select('user_id,jobs_checked_at')]);
      const last = new Map((profiles.data ?? []).map((p) => [String(p['user_id']), String(p['jobs_checked_at'] ?? '')]));
      for (const uid of new Set((lists.data ?? []).map((r) => String(r['user_id'] ?? '')).filter(Boolean)))
        if (!last.get(uid) || Date.now() - Date.parse(last.get(uid)!) >= WEEK) await checkJobBoards(uid);
    } catch (e) { console.error('weekly job board check:', (e as Error).message); }
  };
  timer = setInterval(() => void tick(), 3600_000);
  setTimeout(() => void tick(), 5 * 60_000); // first look a few minutes after start, once the tables are warm
}
