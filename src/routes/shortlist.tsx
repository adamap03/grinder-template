import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { ChevronDown, ExternalLink, Loader2, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { Shell } from '@/components/Shell';
import { Button } from '@/components/Button';
import { pdfEmbedUrl } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { companyLink } from '@/lib/company-slug';
import { cleanDomain, logoFor } from '@/lib/companies';
import { addShortlistToDirectory, checkEmbed, checkJobBoardsNow, checkShortlistFirm, findCareersPage, jobUpdates } from '@/lib/firms.functions';
import { pageHead } from '@/lib/seo';
import { SECTOR_LIST, SECTORS as SECTOR_LABEL, sectorKeyOf } from '@/lib/sectors';
import { sameFirm } from '@/lib/firm-key';

export const Route = createFileRoute('/shortlist')({
  head: () => pageHead({ title: 'Shortlist — Grinder', description: 'Your shortlisted firms and their job boards.', path: '/shortlist' }),
  component: ShortlistPage,
});

type Vacancy = { title: string; location: string; url: string; closing_date: string; summary: string; first_seen?: string; baseline?: boolean };
// A posting first seen on the job board in the last week (set by the weekly check, see src/lib/job-updates.server.ts).
const isNew = (v: Vacancy) => !v.baseline && !!v.first_seen && Date.now() - Date.parse(v.first_seen) < 7 * 24 * 3600_000;
type Firm = {
  id: string; name: string; company_number: string; town: string; website: string | null; careers_url: string | null; summary: string; sic: string; size: string; notes: string; tags: string;
  vacancies: Vacancy[] | null; vacancy_note: string; checked_at: string | null; embeddable: string;
};
// Sector tags come from the one list in src/lib/sectors.ts (same as Discover); tags store the sector label.
const SECTORS = SECTOR_LIST.map((s) => s.label);
const labelOf = (tag: string) => { const k = sectorKeyOf(tag); return k ? SECTOR_LABEL[k] : tag; };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
// A firm's sectors: its tags, shown as the current sector names (older names like "GIS & LiDAR" map across).
const sectorsOf = (f: Firm) => [...new Set(f.tags.split(',').map((s) => s.trim()).filter(Boolean).map(labelOf))];

function ShortlistPage() {
  const [rows, setRows] = useState<Firm[] | null>(null);
  // Application tracker rows, to show on each card whether that firm has been applied to (matched by firm name).
  const [apps, setApps] = useState<{ Company: string; Status: string | null; date: string | null }[]>([]);
  const appsFor = (f: Firm) => apps.filter((a) => sameFirm(a.Company, f.name)).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [q, setQ] = useState('');
  const [sector, setSector] = useState('');
  const [place, setPlace] = useState('');
  const [open, setOpen] = useState<Firm | null>(null);
  const [adding, setAdding] = useState(false);
  const careers = useServerFn(findCareersPage);
  const toDirectory = useServerFn(addShortlistToDirectory);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSignedIn(!!data.session);
      if (!data.session) return;
      const [r, ap] = await Promise.all([
        supabase.from('shortlist').select('*').order('created_at', { ascending: false }),
        supabase.from('applications').select('Company,Status,date'),
      ]);
      setApps((ap.data as unknown as { Company: string; Status: string | null; date: string | null }[]) || []);
      const list = (r.data as unknown as Firm[]) || [];
      setRows(list);
      // Firms shortlisted from Discover often have only a website: find their careers / vacancies page so the card
      // opens that instead of the homepage. One at a time; saved on the row.
      const home = (u: string | null) => { try { return !u || new URL(u).pathname.replace(/\/$/, '') === ''; } catch { return true; } };
      for (const f of list) {
        if (!f.website || !home(f.careers_url)) continue;
        const got = await careers({ data: { id: f.id } }).catch(() => null);
        if (got?.careers_url) patch(f.id, { careers_url: got.careers_url, embeddable: '', checked_at: null });
      }
      // Firms added by hand also belong in Discover (skipped there when already listed).
      for (const f of list) if (f.company_number.startsWith('manual-')) await toDirectory({ data: { id: f.id } }).catch(() => null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const places = useMemo(() => [...new Set((rows || []).map((f) => f.town.trim()).filter(Boolean))].sort(), [rows]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (rows || []).filter((f) => (!t || `${f.name} ${f.town} ${f.notes}`.toLowerCase().includes(t)) && (!sector || sectorsOf(f).includes(sector)) && (!place || f.town.trim() === place));
  }, [rows, q, sector, place]);
  const patch = (id: string, p: Partial<Firm>) => {
    setRows((old) => old?.map((x) => (x.id === id ? { ...x, ...p } : x)) ?? old);
    setOpen((o) => (o && o.id === id ? { ...o, ...p } : o));
  };
  const ctl = 'h-11 max-w-full rounded-lg bg-glass-strong px-3 text-sm outline-none';

  return (
    <Shell>
      <section className="pt-4 text-center">
        <h1 className="font-display text-5xl sm:text-6xl">Your shortlisted firms</h1>
        <p className="mt-2 text-muted-foreground">Open a firm to check its job board.</p>
      </section>
      {signedIn === false ? <p className="mt-8 text-center"><Link to="/resume" className="underline">Sign in to see your shortlist</Link></p> : (
        <>
          <Updates onOpen={(id) => { const f = rows?.find((x) => x.id === id); if (f) setOpen(f); }} onChecked={async () => { const r = await supabase.from('shortlist').select('*').order('created_at', { ascending: false }); if (r.data) setRows(r.data as unknown as Firm[]); }} />
          <div className="mx-auto mt-4 flex max-w-4xl flex-wrap gap-2 rounded-lg glass p-3">
            <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg bg-glass-strong px-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input aria-label="Search shortlist" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, place or notes…" className="h-11 flex-1 bg-transparent text-sm outline-none" />
            </div>
            <select aria-label="Sector" value={sector} onChange={(e) => setSector(e.target.value)} className={ctl}>
              <option value="">All sectors</option>{SECTORS.map((s) => <option key={s}>{s}</option>)}
            </select>
            <select aria-label="Location" value={place} onChange={(e) => setPlace(e.target.value)} className={ctl}>
              <option value="">All locations</option>{places.map((p) => <option key={p}>{p}</option>)}
            </select>
            <Button onClick={() => setAdding(true)} className="flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"><Plus className="h-4 w-4" />Add firm</Button>
          </div>
          <p className="mt-4 text-center text-xs text-muted-foreground">{!rows ? 'Loading…' : rows.length ? `${shown.length} of ${rows.length} firms` : 'No firms yet. Add one, or shortlist firms from Discover.'}</p>
          {!rows && <div className="mt-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((c) => {
              const domain = cleanDomain(c.website || c.careers_url || '');
              return (
                <button type="button" key={c.id} onClick={() => setOpen(c)} className="group rounded-lg glass p-4 text-left transition hover:-translate-y-0.5 hover:bg-glass-strong">
                  <div className="flex items-center gap-3">
                    {domain ? <img src={logoFor(domain)} alt="" className="h-11 w-11 rounded-lg bg-glass-strong object-contain p-1.5" loading="lazy" /> : <div className="h-11 w-11 rounded-lg bg-glass-strong" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{c.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{sectorsOf(c).join(' · ') || domain}</div>
                    </div>
                    {c.size && <span className="shrink-0 self-start text-xs text-muted-foreground">{c.size.split(' (')[0]}</span>}
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{c.notes || domain}</p>
                  <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{c.town || '—'}</span>
                    {(() => {
                      const a = appsFor(c);
                      return a.length
                        ? <span title={a.map((x) => `${x.Status ?? 'Applied'}${x.date ? ` (${x.date.slice(0, 10)})` : ''}`).join(', ')} className="shrink-0 rounded-full bg-primary px-2 py-0.5 font-medium text-primary-foreground">{a[0]!.Status || 'Applied'}{a.length > 1 ? ` · ${a.length} applications` : ''}</span>
                        : <span className="shrink-0 rounded-full border px-2 py-0.5">Not applied</span>;
                    })()}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
      {open && <FirmView firm={open} onClose={() => setOpen(null)} onPatch={patch} onRemove={(id) => { setRows((old) => old?.filter((x) => x.id !== id) ?? old); setOpen(null); }} />}
      {adding && <AddFirm onClose={() => setAdding(false)} onAdded={(f) => { setRows((old) => [f, ...(old || [])]); setAdding(false); setOpen(f); }} />}
    </Shell>
  );
}

/** Top of the Shortlist: postings that appeared on shortlisted firms' job boards in the last week. Every board is read
 *  once a week by the server; "Check now" reads them all straight away. */
function Updates({ onOpen, onChecked }: { onOpen: (firmId: string) => void; onChecked: () => void }) {
  const get = useServerFn(jobUpdates);
  const start = useServerFn(checkJobBoardsNow);
  const [u, setU] = useState<Awaited<ReturnType<typeof jobUpdates>> | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('grinder.updates.open') !== '0'; } catch { return true; } });
  const toggle = () => setOpen((o) => { try { localStorage.setItem('grinder.updates.open', o ? '0' : '1'); } catch { /* private mode */ } return !o; });
  const load = async () => { const r = await get().catch(() => null); if (r) setU(r); return r; };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // While a check runs, show its progress and refresh the cards when it ends.
  useEffect(() => {
    if (!u?.status.running) return;
    const t = setInterval(async () => { const r = await load(); if (r && !r.status.running) { clearInterval(t); onChecked(); } }, 5000);
    return () => clearInterval(t);
  }, [u?.status.running]); // eslint-disable-line react-hooks/exhaustive-deps
  async function now() {
    setError('');
    const r = await start();
    if (!r.ok) { setError(r.error); return; }
    await load();
  }
  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const added = (u?.postings ?? []).filter((p) => !p.baseline).length;
  const based = (u?.postings ?? []).length - added;
  const byFirm = [...new Map((u?.postings ?? []).map((p) => [p.firm_id, { firm: p.firm, firm_id: p.firm_id, list: (u?.postings ?? []).filter((x) => x.firm_id === p.firm_id) }])).values()];
  return (
    <section aria-label="Updates" className="mx-auto mt-8 max-w-4xl rounded-lg glass p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2><Button aria-expanded={open} onClick={toggle} className="flex items-center gap-2 font-semibold"><ChevronDown className={`h-4 w-4 transition ${open ? '' : '-rotate-90'}`} />Updates{!!added && <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">{added} new</span>}{!!based && <span className="rounded-full border px-2 py-0.5 text-xs font-normal">{based} current</span>}</Button></h2>
          {open && <p className="text-xs text-muted-foreground">
            {u?.status.running ? `Reading job boards… ${u.status.done} of ${u.status.total}`
              : u?.checked_at ? `Job boards read ${day(u.checked_at)}; next check ${u.next_at ? day(u.next_at) : 'soon'}. New postings from the last 7 days.`
              : "Every shortlisted firm's job board is read once a week, and new postings are listed here."}
          </p>}
        </div>
        <Button disabled={!u || u.status.running} onClick={() => void now()} className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm disabled:opacity-60">
          {u?.status.running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Check now
        </Button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
      {open && <>
      {u && !u.status.running && u.checked_at && !u.postings.length && <p className="mt-3 text-sm text-muted-foreground">No new postings on your shortlisted firms' job boards this week.</p>}
      {based > 0 && <p className="mt-3 text-xs text-muted-foreground">First check: <b>Current</b> postings are everything open now, your baseline. They show for this week; from the next check only <b>New</b> additions are listed.</p>}
      {byFirm.length > 0 && (
        <ul className="mt-3 space-y-3">
          {byFirm.map((g) => (
            <li key={g.firm_id} className="rounded-md bg-background/60 p-3">
              <Button onClick={() => onOpen(g.firm_id)} className="text-sm font-semibold hover:underline">{g.firm}</Button>
              <ul className="mt-1 space-y-1">
                {g.list.map((p, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    {p.baseline ? <span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase">Current</span> : <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase text-primary-foreground">New</span>}
                    {/^https?:/.test(p.url) ? <a href={p.url} target="_blank" rel="noreferrer" className="font-medium underline">{p.title}</a> : <span className="font-medium">{p.title}</span>}
                    <span className="text-xs text-muted-foreground">{[p.location, p.closing_date && `closes ${p.closing_date}`, p.first_seen && `seen ${day(p.first_seen)}`].filter(Boolean).join(' · ')}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {u && !u.status.running && u.unread.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Read {u.boards - u.unread.length} of {u.boards} job boards. These only show their listings in a browser, so check them yourself:{' '}
          {u.unread.map((f, i) => <span key={f.id}>{i ? ', ' : ''}<Button onClick={() => onOpen(f.id)} className="underline">{f.name}</Button></span>)}.
        </p>
      )}
      </>}
    </section>
  );
}

function FirmView({ firm, onClose, onPatch, onRemove }: { firm: Firm; onClose: () => void; onPatch: (id: string, p: Partial<Firm>) => void; onRemove: (id: string) => void }) {
  const embedCheck = useServerFn(checkEmbed);
  const read = useServerFn(checkShortlistFirm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const url = firm.careers_url || firm.website || '';

  // Boards that refuse to be framed get their listings read instead, so they are still checkable here.
  async function readList() {
    setBusy(true); setError('');
    const r = await read({ data: { id: firm.id } });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    onPatch(firm.id, { vacancies: r.vacancies, vacancy_note: r.vacancy_note, embeddable: r.embeddable, checked_at: r.checked_at });
  }
  useEffect(() => {
    if (!url) return;
    if (!firm.embeddable) embedCheck({ data: { id: firm.id, url } }).then((r) => { onPatch(firm.id, r); if (r.embeddable === 'no') void readList(); }).catch(() => {});
    else if (firm.embeddable === 'no' && !firm.checked_at) void readList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firm.id, url]);
  async function save(p: Partial<Firm>) {
    onPatch(firm.id, p);
    await supabase.from('shortlist').update(p).eq('id', firm.id);
  }
  async function remove() {
    if (!confirm(`Remove ${firm.name} from your shortlist?`)) return;
    await supabase.from('shortlist').delete().eq('id', firm.id);
    onRemove(firm.id);
  }
  const tags = sectorsOf(firm);
  const field = 'w-full rounded-md border bg-background/70 px-2 py-1.5 text-sm outline-none';
  return (
    <div className="fixed inset-0 z-50 flex bg-foreground/30 p-2 sm:p-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={firm.name} className="flex w-full flex-col overflow-hidden rounded-xl bg-background shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex flex-wrap items-center gap-3 border-b p-3">
          {cleanDomain(url) && <img src={logoFor(cleanDomain(firm.website || url))} alt="" className="h-8 w-8 rounded bg-glass-strong p-1" />}
          <div className="min-w-0 flex-1"><div className="truncate font-semibold">{firm.name}</div><div className="truncate text-xs text-muted-foreground">{[firm.town, tags.join(' · ')].filter(Boolean).join(' · ')}</div></div>
          {url && <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs">Open job board<ExternalLink className="h-3 w-3" /></a>}
          <Link {...companyLink(firm.name, cleanDomain(firm.website || url) || undefined)} className="rounded-md border px-3 py-1.5 text-xs">Research roles</Link>
          <Button aria-label="Close" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full border"><X className="h-4 w-4" /></Button>
        </header>
        <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_300px]">
          <div className="relative min-h-[50vh] overflow-y-auto bg-muted/30">
            {!url ? <p className="p-6 text-sm text-muted-foreground">Add a careers page link on the right to see the job board here.</p>
              : firm.embeddable === 'no' ? (
                <div className="mx-auto max-w-2xl p-6">
                  <p className="text-sm">{cleanDomain(url)} doesn't allow its page to be shown inside other sites, so here are its listings as read from the job board. <a href={url} target="_blank" rel="noreferrer" className="underline">Open the job board</a> to apply.</p>
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Reading the job board…</> : firm.checked_at && `Read ${new Date(firm.checked_at).toLocaleString()}`}
                    {!busy && <Button onClick={readList} className="flex items-center gap-1 rounded-md border px-2 py-1"><RefreshCw className="h-3 w-3" />Read again</Button>}
                  </div>
                  {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
                  {firm.vacancy_note && <p className="mt-3 text-sm text-muted-foreground">{firm.vacancy_note}</p>}
                  <ul className="mt-3 space-y-2">
                    {(firm.vacancies || []).map((v, i) => (
                      <li key={i} className="rounded-md border bg-background p-3 text-sm">
                        <div className="font-medium">{isNew(v) && <span className="mr-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase text-primary-foreground">New</span>}{/^https?:/.test(v.url) ? <a href={v.url} target="_blank" rel="noreferrer" className="underline">{v.title}</a> : v.title}</div>
                        <div className="text-xs text-muted-foreground">{[v.location, v.closing_date && `closes ${v.closing_date}`].filter(Boolean).join(' · ')}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : <iframe title={`${firm.name} job board`} src={/\.pdf($|[?#])/i.test(url) ? pdfEmbedUrl(url) : url} className="absolute inset-0 h-full w-full border-0 bg-white" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" />}
          </div>
          <aside className="space-y-3 overflow-y-auto border-l p-4">
            <h2 className="font-semibold">Details</h2>
            <label className="block text-xs text-muted-foreground">Job board link<input defaultValue={firm.careers_url ?? ''} onBlur={(e) => e.target.value !== (firm.careers_url ?? '') && save({ careers_url: e.target.value || null, checked_at: null, embeddable: '', vacancies: [], vacancy_note: '' })} className={`${field} mt-1`} /></label>
            <label className="block text-xs text-muted-foreground">Website<input defaultValue={firm.website ?? ''} onBlur={(e) => e.target.value !== (firm.website ?? '') && save({ website: e.target.value || null })} className={`${field} mt-1`} /></label>
            <label className="block text-xs text-muted-foreground">Location<input defaultValue={firm.town} onBlur={(e) => e.target.value !== firm.town && save({ town: e.target.value })} className={`${field} mt-1`} /></label>
            <fieldset className="text-xs text-muted-foreground">
              <legend>Sectors</legend>
              <div className="mt-1 grid gap-1">
                {SECTORS.map((s) => <label key={s} className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={tags.includes(s)} onChange={() => save({ tags: (tags.includes(s) ? tags.filter((x) => x !== s) : [...tags, s]).join(', ') })} />{s}</label>)}
              </div>
            </fieldset>
            <label className="block text-xs text-muted-foreground">Notes<textarea defaultValue={firm.notes} rows={3} onBlur={(e) => e.target.value !== firm.notes && save({ notes: e.target.value })} className={`${field} mt-1`} /></label>
            <ApplyBox firm={firm} url={url} />
            <Button onClick={remove} className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs text-destructive"><Trash2 className="h-3.5 w-3.5" />Remove from shortlist</Button>
          </aside>
        </div>
      </div>
    </div>
  );
}

const APPLY_STATUSES = ['Applying', 'Applied', 'Interviewing', 'No Response', 'Accepted', 'Rejected', 'Pass'];
type AppRow = { id: string; Position: string | null; Status: string | null; 'Closing Date': string | null; date: string | null };

/** Adds a row to the Application tracker for this firm, and lists the ones already there. */
function ApplyBox({ firm, url }: { firm: Firm; url: string }) {
  const [apps, setApps] = useState<AppRow[]>([]);
  const [role, setRole] = useState('');
  const [closing, setClosing] = useState('');
  const [status, setStatus] = useState('Applying');
  const [applied, setApplied] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    supabase.from('applications').select('id,Position,Status,Closing Date,date').eq('Company', firm.name).then(({ data }) => setApps((data as unknown as AppRow[]) || []));
  }, [firm.name]);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase.from('applications').insert({
      Company: firm.name, Position: role.trim(), Location: firm.town, Status: status, 'Link(s)': url,
      'Closing Date': closing || null, date: applied || (status === 'Applying' ? null : today),
    }).select('id,Position,Status,Closing Date,date').single();
    if (error || !data) { setMsg('Could not add. Please retry.'); return; }
    setApps((a) => [...a, data as unknown as AppRow]);
    setRole(''); setClosing(''); setApplied(''); setStatus('Applying');
    setMsg('Added to your application tracker.');
    setTimeout(() => setMsg(''), 2500);
  }
  async function update(id: string, p: Partial<AppRow>) {
    setApps((a) => a.map((x) => (x.id === id ? { ...x, ...p } : x)));
    await supabase.from('applications').update(p).eq('id', id);
  }
  const field = 'w-full rounded-md border bg-background/70 px-2 py-1.5 text-sm outline-none';
  return (
    <section className="rounded-lg border p-3">
      <h3 className="text-sm font-semibold">Apply for position</h3>
      {apps.length > 0 && (
        <ul className="mt-2 space-y-1">
          {apps.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate" title={a.Position ?? ''}>{a.Position || 'Untitled role'}{a['Closing Date'] && <span className="text-muted-foreground"> · closes {a['Closing Date'].slice(0, 10)}</span>}</span>
              <select aria-label={`Status for ${a.Position ?? 'role'}`} value={a.Status ?? ''} onChange={(e) => update(a.id, { Status: e.target.value, ...(e.target.value === 'Applied' && !a.date ? { date: new Date().toISOString().slice(0, 10) } : {}) })} className="rounded border bg-background px-1 py-0.5">{APPLY_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="mt-2 space-y-2">
        <input required aria-label="Role name" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role name" className={field} />
        <label className="block text-xs text-muted-foreground">Application deadline<input type="date" value={closing} onChange={(e) => setClosing(e.target.value)} className={`${field} mt-1`} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs text-muted-foreground">Status<select value={status} onChange={(e) => setStatus(e.target.value)} className={`${field} mt-1`}>{APPLY_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="block text-xs text-muted-foreground">Date applied<input type="date" value={applied} onChange={(e) => setApplied(e.target.value)} className={`${field} mt-1`} /></label>
        </div>
        <Button type="submit" className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">Add to tracker</Button>
        {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
      </form>
    </section>
  );
}

function AddFirm({ onClose, onAdded }: { onClose: () => void; onAdded: (f: Firm) => void }) {
  const [name, setName] = useState('');
  const [careers, setCareers] = useState('');
  const [town, setTown] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState('');
  const toDirectory = useServerFn(addShortlistToDirectory);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!/^https?:\/\//.test(careers)) { setError('Paste the full job board link, starting with https://'); return; }
    const website = (() => { try { return new URL(careers).origin; } catch { return null; } })();
    const { data, error: err } = await supabase.from('shortlist').insert({ name: name.trim(), company_number: `manual-${slug(name)}`, careers_url: careers.trim(), website, town: town.trim(), tags: tags.join(', ') }).select('*').single();
    if (err || !data) { setError(err?.code === '23505' ? 'That firm is already on your shortlist.' : 'Could not add. Please retry.'); return; }
    onAdded(data as unknown as Firm);
    void toDirectory({ data: { id: String((data as { id: string }).id) } }).catch(() => null); // also into Discover
  }
  const field = 'w-full rounded-md border bg-background/70 px-3 py-2 text-sm outline-none';
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4" onClick={onClose}>
      <form role="dialog" aria-modal="true" aria-label="Add a firm" onSubmit={add} onClick={(e) => e.stopPropagation()} className="w-full max-w-md space-y-3 rounded-xl bg-background p-5 shadow-2xl">
        <h2 className="text-lg font-semibold">Add a firm</h2>
        <input required aria-label="Firm name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Firm or organisation name" className={field} />
        <input required aria-label="Job board link" value={careers} onChange={(e) => setCareers(e.target.value)} placeholder="Job board / vacancies page link (https://…)" className={field} />
        <input aria-label="Location" value={town} onChange={(e) => setTown(e.target.value)} placeholder="Location" className={field} />
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">{SECTORS.map((s) => <label key={s} className="flex items-center gap-1"><input type="checkbox" checked={tags.includes(s)} onChange={() => setTags(tags.includes(s) ? tags.filter((x) => x !== s) : [...tags, s])} />{s}</label>)}</div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2"><Button type="submit" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Add</Button><Button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">Cancel</Button></div>
      </form>
    </div>
  );
}
