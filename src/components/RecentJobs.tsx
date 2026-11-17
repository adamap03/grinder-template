import { useEffect, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { Clock, ExternalLink, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/Button';
import { findRecentJobs } from '@/lib/firms.functions';

type Job = Extract<Awaited<ReturnType<typeof findRecentJobs>>, { ok: true }>['jobs'][number];
const DAYS = [1, 3, 7, 14] as const;
type Days = (typeof DAYS)[number];

// Each job site's own "posted within" filter, so its results are already the freshest.
const enc = encodeURIComponent;
const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const BOARDS: { name: string; url: (q: string, l: string, d: Days) => string; note?: string }[] = [
  { name: 'LinkedIn jobs', url: (q, l, d) => `https://www.linkedin.com/jobs/search/?keywords=${enc(q)}&location=${enc(l || 'United Kingdom')}&f_TPR=r${d * 86400}&sortBy=DD` },
  { name: 'LinkedIn hiring posts', url: (q, _l, d) => `https://www.linkedin.com/search/results/content/?keywords=${enc(`hiring ${q}`)}&datePosted=${enc(d === 1 ? '"past-24h"' : '"past-week"')}&sortBy=${enc('"date_posted"')}`, note: 'LinkedIn only offers 24 hours, a week or a month here' },
  { name: 'Indeed', url: (q, l, d) => `https://uk.indeed.com/jobs?q=${enc(q)}&l=${enc(l)}&fromage=${d}&sort=date` },
  { name: 'Reed', url: (q, l, d) => `https://www.reed.co.uk/jobs/${slug(q)}-jobs${l ? `-in-${slug(l)}` : ''}?dateCreatedOffSet=${{ 1: 'today', 3: 'lastthreedays', 7: 'lastweek', 14: 'lasttwoweeks' }[d]}` },
  { name: 'Totaljobs', url: (q, l, d) => `https://www.totaljobs.com/jobs/${slug(q)}${l ? `/in-${slug(l)}` : ''}?postedWithin=${d}` },
  { name: 'CV-Library', url: (q, l, d) => `https://www.cv-library.co.uk/${slug(q)}-jobs${l ? `-in-${slug(l)}` : ''}?posted=${d}` },
];

/** "Just posted": vacancies and hiring posts from the last few days, while few people have applied. */
export function RecentJobs({ signedIn, defaultQuery, defaultPlace }: { signedIn: boolean; defaultQuery: string; defaultPlace: string }) {
  const find = useServerFn(findRecentJobs);
  const [query, setQuery] = useState(defaultQuery);
  const [place, setPlace] = useState(defaultPlace);
  const [days, setDays] = useState<Days>(3);
  const [max, setMax] = useState('');
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (!query) setQuery(defaultQuery); }, [defaultQuery]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setPlace(defaultPlace), [defaultPlace]);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setBusy(true); setError('');
    const r = await find({ data: { query: query.trim(), place: place.trim(), days, maxCount: max ? Number(max) : null } });
    setBusy(false);
    if (r.ok) setJobs(r.jobs); else setError(r.error);
  }

  const q = query.trim() || 'structural engineer';
  const ctl = 'h-9 rounded-md border bg-background/70 px-2 text-sm';
  return (
    <details className="mt-2 rounded-lg glass px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium"><Clock className="mr-1 inline h-4 w-4" />Just posted jobs</summary>
      <p className="mt-2 text-xs text-muted-foreground">Applying in the first few days, before many others have, gives you a better chance.</p>
      <form onSubmit={search} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="grid flex-[2] gap-1 text-xs text-muted-foreground">Role<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. graduate structural engineer" className={`${ctl} min-w-[180px] text-foreground`} /></label>
        <label className="grid flex-1 gap-1 text-xs text-muted-foreground">Where<input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="UK" className={`${ctl} min-w-[110px] text-foreground`} /></label>
        <label className="grid gap-1 text-xs text-muted-foreground">Posted within
          <select value={days} onChange={(e) => setDays(Number(e.target.value) as Days)} className={`${ctl} text-foreground`}>{DAYS.map((d) => <option key={d} value={d}>{d === 1 ? '24 hours' : `${d} days`}</option>)}</select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">Fewer than (applicants or likes)
          <input type="number" min={1} value={max} onChange={(e) => setMax(e.target.value)} placeholder="any" className={`${ctl} w-28 text-foreground`} />
        </label>
        {signedIn && <Button type="submit" disabled={busy} className="flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-60">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}Search the web</Button>}
      </form>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className="text-muted-foreground">Open on job sites, newest first:</span>
        {BOARDS.map((b) => <a key={b.name} href={b.url(q, place.trim(), days)} target="_blank" rel="noreferrer" title={b.note} className="flex items-center gap-1 rounded-md border px-2 py-0.5 hover:bg-muted">{b.name}<ExternalLink className="h-3 w-3" /></a>)}
      </div>
      {!signedIn && <p className="mt-2 text-xs text-muted-foreground">Sign in to search the web for recent posts and filter by applicants or likes.</p>}
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
      {jobs && (
        jobs.length === 0 ? <p className="mt-3 text-xs text-muted-foreground">Nothing found from the last {days === 1 ? '24 hours' : `${days} days`}. Try the job site links above.</p> : (
          <ul className="mt-3 space-y-2">
            {jobs.map((j) => (
              <li key={j.url} className="rounded-md border p-2">
                <a href={j.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">{j.title}</a>
                <div className="text-xs text-muted-foreground">{[j.company, j.location, j.kind === 'post' ? 'Hiring post' : 'Job advert',
                  j.posted_days_ago == null ? 'date not shown' : j.posted_days_ago === 0 ? 'today' : `${j.posted_days_ago} day${j.posted_days_ago > 1 ? 's' : ''} ago`,
                  j.applicants_or_likes == null ? '' : `${j.applicants_or_likes} ${j.kind === 'post' ? 'likes' : 'applicants'}`].filter(Boolean).join(' · ')}</div>
                {j.summary && <p className="mt-1 text-xs">{j.summary}</p>}
              </li>
            ))}
          </ul>
        )
      )}
    </details>
  );
}
