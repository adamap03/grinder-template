import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { Building2, ExternalLink, Globe, Loader2, Search, Sparkles, Star } from 'lucide-react';
import { Shell } from '@/components/Shell';
import { Button } from '@/components/Button';
import { RegionMap } from '@/components/RegionMap';
import { DiscoverSources, describeCrawl } from '@/components/DiscoverSources';
import { RecentJobs } from '@/components/RecentJobs';
import { firmKey, hostOf } from '@/lib/firm-key';
// Map area -> a place name job sites understand.
const AREA_PLACE: Record<string, string> = { scot_north: 'Aberdeen', scot_central: 'Scotland', scot_south: 'Scotland', eng_north: 'North West England', eng_mid: 'Midlands', eng_sw: 'South West England', eng_se: 'London', wales: 'Wales', ni: 'Northern Ireland' };
import { supabase } from '@/integrations/supabase/client';
import { crawlDirectories, discoverOptions, findFirms, lookupFirmSite, scoreFirmFit, searchFromFocus } from '@/lib/firms.functions';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/')({
  head: () => pageHead({ title: 'Discover firms — Grinder', description: 'Get to know which firms work where and on what, then rate them against where you want your career to go.', path: '/' }),
  component: DiscoverPage,
});

type Settings = { nationwide?: boolean; sizes: string[]; sectors: string[]; focus: string; region: string; keywords: string[]; also?: string[]; exclude?: string[]; summary?: string };
type Res = Awaited<ReturnType<typeof findFirms>>;
type FirmRow = Res['firms'][number];
type Lookup = { website: string | null; careers_url: string | null; summary: string };
type Fit = { tier: number; score: number | null; reason: string };
const BANDS: Record<number, { name: string; key: string; style: string }> = {
  1: { name: 'Strong match', key: 'score 70–100: does the kind of work you described', style: 'bg-emerald-600 text-white' },
  2: { name: 'Possible', key: 'score 40–69: related or adjacent work, worth a look', style: 'bg-amber-500 text-white' },
  3: { name: 'Unlikely', key: 'score 0–39: mostly a different field', style: 'bg-muted text-muted-foreground' },
  4: { name: 'Not enough info', key: 'no website, or it says too little to judge', style: 'border border-dashed text-muted-foreground' },
};
type Opts = Awaited<ReturnType<typeof discoverOptions>>;



function DiscoverPage() {
  const search = useServerFn(findFirms);
  const options = useServerFn(discoverOptions);
  const lookup = useServerFn(lookupFirmSite);
  const score = useServerFn(scoreFirmFit);
  const interpret = useServerFn(searchFromFocus);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [opts, setOpts] = useState<Opts | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [focusDraft, setFocusDraft] = useState('');
  const [tier, setTier] = useState<'' | '1' | '2' | '3' | '4' | 'none'>('');
  const [sort, setSort] = useState<'notable' | 'size' | 'name'>('notable');
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<Res | null>(null);
  const [loading, setLoading] = useState(true);
  const [uid, setUid] = useState<string | null>(null);
  type SavedRow = { id: string; company_number: string; name: string; website: string | null };
  const [savedRows, setSavedRows] = useState<SavedRow[]>([]);
  const savedRowOf = (f: { number: string; name: string; website: string }) => savedRows.find((r) => r.company_number === f.number || firmKey(r.name) === firmKey(f.name) || (!!hostOf(f.website) && hostOf(r.website ?? '') === hostOf(f.website)));
  const [fits, setFits] = useState<Record<string, Fit>>({});
  const [info, setInfo] = useState<Record<string, Lookup | 'loading' | string>>({});
  const [rating, setRating] = useState<{ done: number; total: number } | null>(null);
  const [openOffices, setOpenOffices] = useState<string | null>(null);
  // "Refresh ticked sectors": read again the sources of the ticked sectors, then reload the list.
  const crawl = useServerFn(crawlDirectories);
  const [refresh, setRefresh] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  async function refreshSectors() {
    if (!settings) return;
    const fail = (e: Error) => ({ ok: false as const, error: e.message });
    const sectors = settings.sectors;
    setRefreshing(true);
    let r = await crawl({ data: { start: true, sectors } }).catch(fail);
    while (r.ok && r.status.running) {
      setRefresh(describeCrawl(r.status));
      await new Promise((x) => setTimeout(x, 4000));
      r = await crawl({ data: { start: false, sectors } }).catch(fail); // same sectors: only their progress and problems
    }
    setRefreshing(false);
    if (!r.ok) { setRefresh(r.error); return; }
    setRefresh(describeCrawl(r.status));
    setOpts(await options());
    setSettings({ ...settings });
  }
  const stop = useRef(false);

  useEffect(() => {
    (async () => {
      const o = await options();
      setOpts(o);
      const { data } = await supabase.auth.getSession();
      let s: Settings = { sizes: o.defaults.sizes, sectors: o.defaults.sectors, focus: o.defaults.focus, region: '', keywords: [] };
      if (data.session) {
        setUid(data.session.user.id);
        const [p, sl, ff] = await Promise.all([
          supabase.from('profiles').select('discover').maybeSingle(),
          supabase.from('shortlist').select('id,company_number,name,website'),
          supabase.from('firm_fit').select('company_number,tier,score,reason'),
        ]);
        const d = p.data?.['discover'] as Partial<Settings> | undefined;
        const has = (list: { key: string }[], v: string[] | undefined) => (v ?? []).filter((x) => list.some((o2) => o2.key === x));
        if (d) s = { nationwide: !!d.nationwide, sizes: has(o.sizes, d.sizes), sectors: has(o.sectors, d.sectors), focus: d.focus ?? '', region: d.region ?? '', keywords: d.keywords ?? [], also: d.also ?? [], exclude: d.exclude ?? [], ...(d.summary ? { summary: d.summary } : {}) };
        if (sl.data) setSavedRows(sl.data as unknown as SavedRow[]);
        if (ff.data) setFits(Object.fromEntries(ff.data.map((x) => [String(x['company_number']), { tier: Number(x['tier']), score: x['score'] == null ? null : Number(x['score']), reason: String(x['reason'] ?? '') }])));
      }
      // Each visit starts with an empty search box and every firm listed; area, size and sector choices are kept.
      s = { ...s, focus: '', keywords: [], also: [], exclude: [], summary: '' };
      setSettings(s); setFocusDraft('');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tierFilter = useMemo(() => {
    if (!tier) return {};
    const rated = Object.keys(fits);
    return tier === 'none' ? { except: rated } : { only: rated.filter((n) => String(fits[n]!.tier) === tier) };
  }, [tier, fits]);

  useEffect(() => setPage(1), [tier, sort, settings]);
  useEffect(() => {
    if (!settings) return;
    setLoading(true);
    const t = setTimeout(() => search({ data: { settings, sort, page, ...tierFilter } }).then((r) => { setRes(r); setLoading(false); }), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, sort, page, tierFilter]);

  function update(patch: Partial<Settings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    if (uid) supabase.from('profiles').upsert({ user_id: uid, discover: next, updated_at: new Date().toISOString() }).then(() => {});
  }
  // "Search with this": the text decides which firms are listed (sectors + name keywords), then they can be rated.
  async function searchFocus() {
    // An empty search box clears the search words and lists every firm (UK-wide firms first).
    if (!focusDraft.trim()) { setTier(''); update({ focus: '', keywords: [], also: [], exclude: [], summary: '' }); return; }
    setSearching(true); setSearchError('');
    const r = await interpret({ data: { focus: focusDraft } });
    setSearching(false);
    if (!r.ok) { setSearchError(r.error); return; }
    setTier('');
    update({ focus: focusDraft, sectors: r.sectors.length ? r.sectors : settings!.sectors, keywords: r.keywords, also: r.also, exclude: r.exclude, summary: r.summary });
  }
  async function find(f: FirmRow) {
    setInfo((m) => ({ ...m, [f.number]: 'loading' }));
    const r = await lookup({ data: { number: f.number } });
    setInfo((m) => ({ ...m, [f.number]: r.ok ? r.lookup : r.error }));
  }
  async function rate(list: FirmRow[], again = false, focus = settings?.focus ?? '') {
    const todo = again ? list : list.filter((f) => !fits[f.number]);
    stop.current = false;
    setRating({ done: 0, total: todo.length });
    // Three firms at a time: each needs a web search and a page read (about 20 seconds).
    let done = 0, next = 0, halt = false;
    const worker = async () => {
      while (!stop.current && !halt && next < todo.length) {
        const f = todo[next++]!;
        setInfo((m) => ({ ...m, [f.number]: m[f.number] && typeof m[f.number] === 'object' ? m[f.number]! : 'loading' }));
        const r = await score({ data: { number: f.number, focus } });
        if (r.ok) {
          setFits((m) => ({ ...m, [f.number]: { tier: r.fit.tier, score: r.fit.score, reason: r.fit.reason } }));
          setInfo((m) => ({ ...m, [f.number]: r.fit.lookup }));
        } else {
          setInfo((m) => ({ ...m, [f.number]: r.error }));
          if (/allowance|used up|free/i.test(r.error)) halt = true;
        }
        setRating({ done: ++done, total: todo.length });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setRating(null);
  }
  async function toggleSave(f: FirmRow) {
    const l = info[f.number];
    const existing = savedRowOf(f);
    if (existing) {
      await supabase.from('shortlist').delete().eq('id', existing.id);
      setSavedRows((rows) => rows.filter((r) => r.id !== existing.id));
      return;
    }
    const { data: added, error } = await supabase.from('shortlist').upsert({
      name: f.name, company_number: f.number, town: f.town, postcode: f.postcode, sic: f.sectors.join(', '), size: f.size, website: f.website || null,
      tags: f.sector, careers_url: f.careers_url || null,
      ...(l && typeof l === 'object' ? { website: l.website ?? (f.website || null), careers_url: l.careers_url ?? (f.careers_url || null), summary: l.summary } : {}),
    }, { onConflict: 'user_id,company_number' }).select('id,company_number,name,website').single();
    if (!error && added) setSavedRows((rows) => [...rows, added as unknown as SavedRow]);
  }

  const pages = res ? Math.max(1, Math.ceil(res.total / 50)) : 1;
  const ctl = 'h-10 rounded-lg bg-glass-strong px-3 text-sm outline-none';
  const tierCounts = useMemo(() => [1, 2, 3, 4].map((t) => Object.values(fits).filter((f) => f.tier === t).length), [fits]);
  const regionLabel = opts?.regions.find((r) => r.key === settings?.region)?.label;
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <Shell>
      <section className="pt-4">
        <h1 className="font-display text-5xl sm:text-6xl">Discover firms</h1>
        <p className="mt-2 text-muted-foreground">Get to know who works where and on what: practices listed in their relevant sector's directory from any sources you add. Type what you are looking for, pick an area on the map, then let Claude read each firm's own website and rate how well it fits.</p>
      </section>

      {settings && opts && (
        <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,380px)_1fr]">
          <div className="space-y-4">
            <div className="relative rounded-lg glass p-4">
              <Button type="button" aria-pressed={!!settings.nationwide} onClick={() => update({ nationwide: !settings.nationwide })} title="Show only firms with offices across the UK (UK-wide)" className={`absolute left-3 top-3 z-10 rounded-full px-3 py-1 text-xs font-medium ${settings.nationwide ? 'bg-primary text-primary-foreground' : 'border bg-background/80'}`}>Nationwide companies</Button>
              <RegionMap regions={opts.regions} counts={res?.counts ?? {}} selected={settings.region} onSelect={(region) => update({ region })} />
              <p className="mt-1 text-center text-xs text-muted-foreground">{settings.region ? `Showing ${regionLabel}. Click it again for the whole UK.` : 'Click an area to explore it.'}</p>
              <p className="mt-3 border-t border-border/50 pt-3 text-xs text-muted-foreground">Firms come from the directories added under each sector's Sources{opts.istructe ? <>, including <a href="https://www.findanengineer.com/" target="_blank" rel="noreferrer" className="underline">IStructE Find an Engineer</a> (used with permission)</> : ''}.</p>
            </div>
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap gap-2 rounded-lg glass p-3">
              {/* The search box is the focus: Claude turns it into sectors + name keywords, and ratings judge firms against it. */}
              <form onSubmit={(e) => { e.preventDefault(); void searchFocus(); }} className="flex min-w-[260px] flex-[2] items-center gap-2 rounded-lg bg-glass-strong px-3">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input autoFocus aria-label="What are you looking for?" value={focusDraft} onChange={(e) => setFocusDraft(e.target.value)} placeholder="What are you looking for?" className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none" />
                <Button type="submit" disabled={searching || !!rating || focusDraft.trim().length === 1} className="flex shrink-0 items-center gap-1 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50">
                  {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Search
                </Button>
              </form>
              <select aria-label="Fit tier" value={tier} onChange={(e) => setTier(e.target.value as typeof tier)} className={ctl}>
                <option value="">All ratings</option>
                {[1, 2, 3, 4].map((t) => <option key={t} value={String(t)}>{BANDS[t]!.name} ({tierCounts[t - 1]})</option>)}
                <option value="none">Not rated yet</option>
              </select>
              <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={ctl}>
                <option value="notable">Notable first</option><option value="size">Biggest first</option><option value="name">A–Z</option>
              </select>
              {uid && res && res.firms.some((f) => !fits[f.number]) && !rating && <Button onClick={() => rate(res.firms)} className="flex items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"><Sparkles className="h-4 w-4" />Rate these</Button>}
              {rating && <Button onClick={() => { stop.current = true; }} className="flex items-center gap-2 rounded-lg border px-4 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Rating {rating.done}/{rating.total} · stop</Button>}
            </div>
              <details className="mt-2 rounded-lg glass px-3 py-2 text-sm">
                <summary className="cursor-pointer font-medium">Size and sector</summary>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div className="grid content-start gap-1">{opts.sizes.map((s) => <label key={s.key} className="flex items-center gap-2"><input type="checkbox" checked={settings.sizes.includes(s.key)} onChange={() => update({ sizes: toggle(settings.sizes, s.key) })} />{s.label}</label>)}</div>
                  <div className="grid content-start gap-1">{opts.sectors.map((s) => (
                    <div key={s.key} className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2"><input type="checkbox" checked={settings.sectors.includes(s.key)} onChange={() => update({ sectors: toggle(settings.sectors, s.key) })} />{s.label}</label>
                      <DiscoverSources signedIn={!!uid} sector={s.key} label={s.label} istructe={opts.istructe} />
                    </div>
                  ))}
                  {uid && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <Button type="button" onClick={() => void refreshSectors()} disabled={refreshing || !settings.sectors.length} className="flex items-center gap-1 rounded-md border px-2 py-1 disabled:opacity-60">{refreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : null}Refresh ticked sectors</Button>
                    <span aria-live="polite" className="text-muted-foreground">{refresh || (settings.sectors.length ? '' : 'Tick a sector first.')}</span>
                  </div>}</div>
                </div>
              </details>
              <RecentJobs signedIn={!!uid} defaultQuery={settings.focus} defaultPlace={AREA_PLACE[settings.region] ?? ''} />
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">{[1, 2, 3, 4].map((t) => <span key={t} className="flex items-center gap-1.5"><span className={`inline-block h-3 w-3 rounded-full ${BANDS[t]!.style}`} /><b className="font-medium text-foreground">{BANDS[t]!.name}</b> {BANDS[t]!.key}</span>)}</p>
            {searchError && <p role="alert" className="mt-2 text-xs text-destructive">{searchError}</p>}
            {!uid && <p className="mt-2 text-xs text-muted-foreground">Sign in to rate and shortlist firms.</p>}
            {settings.summary && (
              <p className="mt-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Searching:</span> {settings.summary}{settings.sectors.length ? ` · ${settings.sectors.map((k) => opts.sectors.find((x) => x.key === k)?.label ?? k).join(', ')}` : ''}{settings.keywords.length ? ` · mentioning ${settings.keywords.join(', ')}` : ''}
                {settings.keywords.length > 0 && <> · <button type="button" onClick={() => update({ keywords: [] })} className="underline">drop the search words</button></>}
              </p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">{loading ? 'Loading…' : res?.error ?? `${(res?.total ?? 0).toLocaleString()} firms${regionLabel ? ` in ${regionLabel}` : ' across the UK'}${(res?.total ?? 0) > 50 ? ` · ${(page - 1) * 50 + 1}–${Math.min(page * 50, res?.total ?? 0)}` : ''}`}{!uid && ' · sign in to rate and shortlist firms'}</p>
            <ul className="mt-3 space-y-2">
              {res?.firms.map((f) => {
                const l = info[f.number];
                const fit = fits[f.number];
                return (
                  <li key={f.number} className="rounded-lg glass p-4">
                    <div className="flex items-start gap-3">
                      {fit ? <span title={BANDS[fit.tier]?.name} className={`mt-0.5 grid h-7 min-w-7 shrink-0 place-items-center rounded-full px-1 text-xs font-semibold ${BANDS[fit.tier]?.style ?? ''}`}>{fit.score ?? '?'}</span> : <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />}
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{f.name}</div>
                        <div className="text-xs text-muted-foreground">{[f.town, f.size, f.source !== 'IStructE Find an Engineer' ? f.source : ''].filter(Boolean).join(' · ')}</div>
                        <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
                          {f.offices > 1 && <button type="button" aria-expanded={openOffices === f.number} onClick={() => setOpenOffices((o) => (o === f.number ? null : f.number))} className="whitespace-nowrap rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary hover:bg-primary/20">UK-wide · {f.offices} offices {openOffices === f.number ? '▴' : '▾'}</button>}
                        </div>
                        {openOffices === f.number && (
                          <ul className="mt-2 grid gap-1 rounded-md border p-2 text-xs sm:grid-cols-2">
                            {f.officeList.map((o) => (
                              <li key={o.listing_url}><a href={o.listing_url} target="_blank" rel="noreferrer" className="hover:underline"><span className="font-medium">{o.town || 'Town not given'}</span>{o.postcode ? ` ${o.postcode}` : ''}</a><span className="text-muted-foreground">{o.region ? ` · ${o.region}` : ''}</span></li>
                            ))}
                          </ul>
                        )}
                      </div>
                      {/* Buttons stay top right; the Careers page link, when found, sits on its own line under them. */}
                      <div className="flex max-w-[65%] shrink-0 flex-col items-end gap-2">
                      <div className="flex flex-wrap justify-end gap-2">
                        {uid && !l && !f.website && <Button onClick={() => find(f)} className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs"><Globe className="h-3.5 w-3.5" />Find website</Button>}
                        {uid && !fit && (!!f.website || (l && typeof l === 'object')) && l !== 'loading' && <Button onClick={() => rate([f])} disabled={!!rating} className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs"><Sparkles className="h-3.5 w-3.5" />Rate fit</Button>}
                        {/* The firm's own site; for an IStructE listing without one saved, its Visit Website redirect gets there. */}
                        {(f.website || /findanengineer\.com\/listings\//.test(f.listing_url)) && <a href={f.website || `${f.listing_url}/visit-website`} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"><Globe className="h-3.5 w-3.5" />Visit website</a>}
                        <a href={f.listing_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs">Directory listing<ExternalLink className="h-3 w-3" /></a>
                        {uid && (() => { const on = !!savedRowOf(f); return <Button onClick={() => toggleSave(f)} aria-pressed={on} title={on ? 'Already on your Shortlist (click to remove)' : 'Add to your Shortlist'} className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-xs ${on ? 'bg-primary text-primary-foreground' : 'border'}`}><Star className={`h-3.5 w-3.5 ${on ? 'fill-current' : ''}`} />{on ? 'Shortlisted' : 'Shortlist'}</Button>; })()}
                      </div>
                      {f.careers_url && <a href={f.careers_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs">Careers page<ExternalLink className="h-3 w-3" /></a>}
                      </div>
                    </div>
                    {f.sectors.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{f.sectors.join(' · ')}</p>}
                    {fit && <p className="mt-2 text-sm"><span className="font-medium">{BANDS[fit.tier]?.name}{fit.score != null ? ` · ${fit.score}/100` : ''}:</span> {fit.reason}</p>}
                    {l === 'loading' && <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Reading this firm's website…</p>}
                    {typeof l === 'string' && l !== 'loading' && <p className="mt-3 text-xs text-destructive">{l}</p>}
                    {l && typeof l === 'object' && (
                      <div className="mt-3 space-y-1 border-t border-border/50 pt-3 text-sm">
                        <div className="flex flex-wrap gap-3 text-xs">
                          {l.website && !f.website && <a href={l.website} target="_blank" rel="noreferrer" className="underline">{new URL(l.website).hostname.replace(/^www\./, '')}</a>}
                          {l.careers_url && <a href={l.careers_url} target="_blank" rel="noreferrer" className="underline">Careers page</a>}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {pages > 1 && (
              <nav aria-label="Pages" className="mt-6 flex items-center justify-center gap-3 text-sm">
                <Button disabled={page <= 1 || loading} onClick={() => { setPage(page - 1); window.scrollTo({ top: 0 }); }}>Previous</Button>
                <span className="text-muted-foreground">Page {page} of {pages}</span>
                <Button disabled={page >= pages || loading} onClick={() => { setPage(page + 1); window.scrollTo({ top: 0 }); }}>Next</Button>
              </nav>
            )}
          </div>
        </section>
      )}
      <p className="mt-8 text-center text-xs text-muted-foreground">Firm listings come from the sources added to each sector. <Link to="/shortlist" className="underline">Your shortlist →</Link></p>
    </Shell>
  );
}
