import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { isSectorKey } from './sectors';

const SettingsInput = z.object({
  nationwide: z.boolean().optional(), sizes: z.array(z.string()).optional(), sectors: z.array(z.string()).optional(),
  focus: z.string().optional(), region: z.string().optional(), keywords: z.array(z.string()).optional(), also: z.array(z.string()).optional(), exclude: z.array(z.string()).optional(),
});
// Firm ids are directory listing slugs (e.g. "fairhurst", "my-source--some-firm").
const FirmId = z.string().regex(/^[a-z0-9-]{1,140}$/);

export const findFirms = createServerFn({ method: 'POST' })
  .inputValidator((d) => z.object({
    settings: SettingsInput, only: z.array(z.string().max(140)).max(20000).optional(), except: z.array(z.string().max(140)).max(20000).optional(),
    sort: z.enum(['notable', 'size', 'name']).optional(), page: z.number().int().min(1).max(5000).optional(),
  }).parse(d))
  .handler(async ({ data }) => {
    const f = await import('./firms.server');
    const settings = f.Settings.parse(data.settings);
    return f.searchFirms({ ...data, settings });
  });

export const discoverOptions = createServerFn({ method: 'GET' }).handler(async () => {
  const f = await import('./firms.server');
  const { sectors, sizes } = await f.filterCounts();
  return {
    sectors, sizes,
    regions: Object.entries(f.REGIONS).map(([key, label]) => ({ key, label })),
    // The built-in IStructE source shows only when this deployment has IStructE's permission (ISTRUCTE_DIRECTORY=on).
    istructe: (await import('./directory.server')).istructeEnabled(),
    defaults: f.Settings.parse({}),
  };
});

// Admin: read the IStructE directory and every saved source again (runs in the background, about 10 minutes).
export const crawlDirectories = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  // Always for named sectors: a read and its status belong to those sectors only.
  .inputValidator((d) => z.object({ start: z.boolean(), sectors: z.array(z.string().refine(isSectorKey, 'Unknown sector')).min(1).max(20) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: admin } = await context.supabase.rpc('has_role', { _user_id: context.userId, _role: 'admin' });
    if (admin !== true) return { ok: false as const, error: 'Only an admin can read the directories again.' };
    const d = await import('./directory.server');
    const sectors = data.sectors.filter(isSectorKey);
    return { ok: true as const, status: data.start ? d.startCrawl(sectors) : d.crawlStatus(sectors) };
  });

// Website lookups and fit tiers use Claude web search, so they need an account and count against the daily allowance.
export const lookupFirmSite = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ number: FirmId, refresh: z.boolean().optional() }).parse(d))
  .handler(async ({ data }) => {
    try {
      const { allowDemo } = await import('./demo.server');
      const f = await import('./firms.server');
      await allowDemo('research');
      return { ok: true as const, lookup: await f.lookupFirm(data.number, data.refresh) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });

// Search box -> sectors + name words via the Notion "Search terms" table (no AI, no sign-in needed).
export const searchFromFocus = createServerFn({ method: 'POST' })
  .inputValidator((d) => z.object({ focus: z.string().min(2).max(3000) }).parse(d))
  .handler(async ({ data }) => {
    try {
      const f = await import('./firms.server');
      return { ok: true as const, ...(await f.termsToSearch(data.focus)) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });

export const scoreFirmFit = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ number: FirmId, focus: z.string().max(3000) }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { allowDemo } = await import('./demo.server');
      const f = await import('./firms.server');
      await allowDemo('research');
      return { ok: true as const, fit: await f.scoreFirm(context.userId, data.number, data.focus) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });

// Shortlist: can this job board be shown in a frame? Cheap header check, saved on the row.
export const checkEmbed = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().max(40), url: z.string().url().max(2000) }).parse(d))
  .handler(async ({ data, context }) => {
    const f = await import('./firms.server');
    const frame = await f.embeddable(data.url);
    const embeddable = frame === null ? '' : frame ? 'yes' : 'no';
    const { userClient } = await import('@/integrations/supabase/client.server');
    await userClient(context.userId).from('shortlist').update({ embeddable }).eq('id', data.id);
    return { embeddable };
  });

// Shortlist: read a firm's job board with Claude and check whether it can be shown in a frame. Results saved on the row.
export const checkShortlistFirm = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().max(40) }).parse(d))
  .handler(async ({ data, context }) => {
    try {
      const { userClient } = await import('@/integrations/supabase/client.server');
      const db = userClient(context.userId);
      const { data: row } = await db.from('shortlist').select('*').eq('id', data.id).maybeSingle();
      if (!row) return { ok: false as const, error: 'Firm not found on your shortlist.' };
      const url = String(row['careers_url'] || row['website'] || '');
      if (!/^https?:\/\//.test(url)) return { ok: false as const, error: 'Add a careers page link first.' };
      const { allowDemo } = await import('./demo.server');
      await allowDemo('research');
      const f = await import('./firms.server');
      const [v, frame] = await Promise.all([f.readVacancies(String(row['name']), url), f.embeddable(url)]);
      const { isBaseline, mergePostings } = await import('./job-updates.server');
      const patch = { vacancies: v.readable ? mergePostings(row['vacancies'] as never, v.vacancies, isBaseline(row['vacancy_count'], row['vacancies'] as never)) : v.vacancies, vacancy_count: v.readable ? v.vacancies.length : null, vacancy_note: v.note, embeddable: frame === null ? '' : frame ? 'yes' : 'no', checked_at: new Date().toISOString() };
      await db.from('shortlist').update(patch).eq('id', data.id);
      return { ok: true as const, ...patch };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });

// Application tracker: which UK map area each typed location is in (e.g. "aberdeen" -> North Scotland).
export const locationAreas = createServerFn({ method: 'POST' })
  .inputValidator((d) => z.object({ locations: z.array(z.string().max(200)).max(300) }).parse(d))
  .handler(async ({ data }) => {
    const f = await import('./firms.server');
    return { areas: await f.regionsFor(data.locations), labels: f.REGIONS as Record<string, string> };
  });

// Discover "Just posted": recent vacancies and hiring posts (Claude web search, counts against the daily allowance).
export const findRecentJobs = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ query: z.string().trim().min(2).max(200), place: z.string().max(100), days: z.union([z.literal(1), z.literal(3), z.literal(7), z.literal(14)]), maxCount: z.number().int().min(1).max(100000).nullable() }).parse(d))
  .handler(async ({ data }) => {
    try {
      const { allowDemo } = await import('./demo.server');
      await allowDemo('research');
      const f = await import('./firms.server');
      return { ok: true as const, jobs: await f.recentJobs(data) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });

// Shortlist: find a shortlisted firm's careers / vacancies page from its website and save it on the row.
export const findCareersPage = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().max(40) }).parse(d))
  .handler(async ({ data, context }) => {
    const { userClient } = await import('@/integrations/supabase/client.server');
    const db = userClient(context.userId);
    const { data: row } = await db.from('shortlist').select('*').eq('id', data.id).maybeSingle();
    const website = String(row?.['website'] ?? '');
    if (!row || !/^https?:\/\//.test(website)) return { careers_url: null as string | null };
    const f = await import('./firms.server');
    const careers_url = await f.careersPageOf(website).catch(() => null);
    if (careers_url) await db.from('shortlist').update({ careers_url, embeddable: '', checked_at: null }).eq('id', data.id);
    return { careers_url };
  });

// Shortlist: a firm added by hand is also put into Discover (in the sector its tags point to).
export const addShortlistToDirectory = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().max(40) }).parse(d))
  .handler(async ({ data, context }) => {
    const { userClient } = await import('@/integrations/supabase/client.server');
    const { data: row } = await userClient(context.userId).from('shortlist').select('*').eq('id', data.id).maybeSingle();
    if (!row) return { added: false };
    const d = await import('./directory.server');
    return { added: await d.addFromShortlist({ name: String(row['name']), website: (row['website'] as string | null) ?? null, careers_url: (row['careers_url'] as string | null) ?? null, town: String(row['town'] ?? ''), tags: String(row['tags'] ?? '') }) };
  });

// Shortlist "Updates" card: postings new in the last week, when the job boards were last read, and a running check.
export const jobUpdates = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await import('./job-updates.server')).newPostings(context.userId));

// "Check now": read every shortlisted firm's job board in the background (counts once against the daily allowance).
export const checkJobBoardsNow = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const u = await import('./job-updates.server');
      if (u.runStatus(context.userId).running) return { ok: true as const };
      const { allowDemo } = await import('./demo.server');
      await allowDemo('research');
      void u.checkJobBoards(context.userId).catch((e: Error) => console.error('job boards:', e.message));
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  });
