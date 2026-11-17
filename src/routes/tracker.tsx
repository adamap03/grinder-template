import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { Shell } from '@/components/Shell';
import { Button } from '@/components/Button';
import { supabase } from '@/integrations/supabase/client';
import { pageHead } from '@/lib/seo';
import { useServerFn } from '@tanstack/react-start';
import { locationAreas } from '@/lib/firms.functions';

export const Route = createFileRoute('/tracker')({
  head: () => pageHead({ title: 'Application Tracker — Grinder', description: 'Every application, its status and outcome.', path: '/tracker' }),
  component: TrackerPage,
});

// Same columns and order as the Notion "Applications" database (copied from the Job Tracker).
type App = { id: string; Company: string; Position: string | null; Location: string; date: string | null; 'Closing Date': string | null; Status: string | null; 'Salary Range': string; 'Link(s)': string; 'Interview Date': string | null };
const STATUSES = ['Applying', 'Applied', 'Interviewing', 'No Response', 'Accepted', 'Rejected', 'Rejected (unanswered)', 'Pass'];
// "Applied" with no other status 15 days after the date applied counts as an unanswered rejection.
const UNANSWERED_DAYS = 15;
const unanswered = (r: App) => r.Status === 'Applied' && !!r.date && Date.now() - new Date(`${r.date.slice(0, 10)}T00:00:00`).getTime() >= UNANSWERED_DAYS * 864e5;
// Outcome groups for the chart; colors are the first categorical slots of the dataviz palette, in fixed order.
const OUTCOMES = [
  { key: 'Accepted', match: ['Accepted'], v: '--o-1' },
  { key: 'Interviewing', match: ['Interviewing'], v: '--o-2' },
  { key: 'Rejected', match: ['Rejected', 'Rejected (unanswered)'], v: '--o-3' },
  { key: 'No answer', match: ['Applied', 'No Response', null, ''], v: '--o-4' },
  { key: 'Passed', match: ['Pass'], v: '--o-5' },
] as const;
const VARS = `.tracker-viz{--o-1:#2a78d6;--o-2:#eb6834;--o-3:#1baf7a;--o-4:#eda100;--o-5:#e87ba4}
@media (prefers-color-scheme: dark){:root:where(:not([data-theme="light"])) .tracker-viz{--o-1:#3987e5;--o-2:#d95926;--o-3:#199e70;--o-4:#c98500;--o-5:#d55181}}
:root[data-theme="dark"] .tracker-viz,.dark .tracker-viz{--o-1:#3987e5;--o-2:#d95926;--o-3:#199e70;--o-4:#c98500;--o-5:#d55181}`;

function TrackerPage() {
  const [rows, setRows] = useState<App[] | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [place, setPlace] = useState('');
  // Typed location -> UK map area (same nine areas as the Discover map), looked up on the server.
  const areas = useServerFn(locationAreas);
  const [areaOf, setAreaOf] = useState<Record<string, string | null>>({});
  const [areaLabels, setAreaLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    const locs = [...new Set((rows || []).map((r) => (r.Location || '').trim()).filter((l) => l && !(l in areaOf)))];
    if (!locs.length) return;
    areas({ data: { locations: locs } }).then((r) => { setAreaOf((m) => ({ ...m, ...r.areas })); setAreaLabels(r.labels); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);
  const areaKey = (r: App) => { const l = (r.Location || '').trim(); return !l ? 'none' : areaOf[l] ?? 'other'; };
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSignedIn(!!data.session);
      if (!data.session) return;
      const r = await supabase.from('applications').select('*').order('created_at', { ascending: false }).order('date', { ascending: false });
      if (r.error) setError('Applications could not load. Please retry.');
      else {
        // ponytail: applied when the tracker opens; a scheduled job would also catch rows while nobody visits.
        const list = (r.data as App[]).map((a) => (unanswered(a) ? { ...a, Status: 'Rejected (unanswered)' } : a));
        setRows(list);
        for (const a of list) if (a.Status === 'Rejected (unanswered)' && (r.data as App[]).find((o) => o.id === a.id)?.Status === 'Applied') await supabase.from('applications').update({ Status: a.Status }).eq('id', a.id);
      }
    });
  }, []);

  const counts = useMemo(() => OUTCOMES.map((o) => ({ name: o.key, v: o.v, value: (rows || []).filter((r) => r.Status !== 'Applying' && (o.match as readonly (string | null)[]).includes(r.Status)).length })), [rows]);
  const sent = (rows || []).filter((r) => r.Status !== 'Applying');
  const applying = (rows?.length ?? 0) - sent.length;
  const total = sent.length;
  // A real answer from the firm; "Rejected (unanswered)" is silence, so it does not count as a response.
  const answered = sent.filter((r) => ['Accepted', 'Interviewing', 'Rejected', 'Pass'].includes(r.Status ?? '')).length;
  const rejected = sent.filter((r) => r.Status === 'Rejected' || r.Status === 'Rejected (unanswered)').length;
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (rows || []).filter((r) => (!status || r.Status === status) && (!place || areaKey(r) === place) && (!t || `${r.Company} ${r.Position} ${r.Location}`.toLowerCase().includes(t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, status, place, areaOf]);
  // Map areas in map order with counts, then rows whose place was not found or is blank.
  const places = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows || []) { const k = areaKey(r); c.set(k, (c.get(k) || 0) + 1); }
    return [...Object.entries(areaLabels), ['other', 'Elsewhere / not recognised'], ['none', 'No location']].filter(([k]) => k && c.get(k)).map(([k, label]) => [k!, label!, c.get(k!)!] as const);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, areaOf, areaLabels]);

  async function save(id: string, patch: Partial<App>) {
    setRows((old) => old?.map((r) => (r.id === id ? { ...r, ...patch } : r)) ?? old);
    const { error: e } = await supabase.from('applications').update(patch).eq('id', id);
    if (e) setError('That change was not saved. Please retry.');
  }
  async function add() {
    const { data, error: e } = await supabase.from('applications').insert({ Company: 'New application', Status: 'Applied', date: new Date().toISOString().slice(0, 10) }).select('*').single();
    if (e || !data) { setError('Could not add. Please retry.'); return; }
    setRows((old) => [data as App, ...(old || [])]);
  }
  async function remove(r: App) {
    if (!confirm(`Delete ${r.Company}? It is moved to the Notion trash.`)) return;
    setRows((old) => old?.filter((x) => x.id !== r.id) ?? old);
    await supabase.from('applications').delete().eq('id', r.id);
  }

  const cell = 'w-full min-w-[7rem] rounded border border-transparent bg-transparent px-1.5 py-1 text-sm outline-none hover:border-border focus:border-border focus:bg-background';
  return (
    <Shell>
      <style>{VARS}</style>
      <div className="py-8"><h1 className="font-display text-5xl">Application tracker</h1><p className="mt-2 max-w-2xl text-muted-foreground">Every application in one place. Edits here and in the Notion "Applications" database stay in sync.</p></div>
      {signedIn === false ? <Link to="/resume" className="underline">Sign in to see your applications</Link> : !rows ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /> : (
        <>
          <section aria-label="Summary" className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[['Applications sent', total], ['Applying now', applying], ['Interviews', counts[1]!.value], ['Accepted', counts[0]!.value], ['Rejected', counts[2]!.value], ['No answer yet', counts[3]!.value], ['Response rate', total ? `${Math.round((answered / total) * 100)}%` : '—'], ['Rejection rate', total ? `${Math.round((rejected / total) * 100)}%` : '—']].map(([label, value]) => (
                <div key={label} className="rounded-lg glass p-4"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div></div>
              ))}
            </div>
            <div className="tracker-viz flex items-center gap-4 rounded-lg glass p-4">
              <div className="h-40 w-40 shrink-0" role="img" aria-label={`Outcomes: ${counts.map((c) => `${c.name} ${c.value}`).join(', ')}`}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={counts.filter((c) => c.value)} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="100%" paddingAngle={0} stroke="var(--background, #fff)" strokeWidth={2} isAnimationActive={false}>
                      {counts.filter((c) => c.value).map((c) => <Cell key={c.name} fill={`var(${c.v})`} />)}
                    </Pie>
                    <Tooltip formatter={(v: number, n: string) => [`${v} (${Math.round((v / Math.max(1, total)) * 100)}%)`, n]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-1.5 text-sm">
                {counts.map((c) => (
                  <li key={c.name} className="flex items-center gap-2"><span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: `var(${c.v})` }} /><span className="text-muted-foreground">{c.name}</span><span className="ml-auto pl-3 font-medium tabular-nums">{c.value}</span></li>
                ))}
              </ul>
            </div>
          </section>

          <div className="mt-6 flex flex-wrap gap-2">
            <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg glass px-3"><Search className="h-4 w-4 text-muted-foreground" /><input aria-label="Search applications" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company, position, location…" className="h-10 flex-1 bg-transparent text-sm outline-none" /></label>
            <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 rounded-lg glass px-3 text-sm"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
            <select aria-label="Filter by location" value={place} onChange={(e) => setPlace(e.target.value)} className="h-10 rounded-lg glass px-3 text-sm"><option value="">All locations</option>{places.map(([k, label, n]) => <option key={k} value={k}>{label} ({n})</option>)}</select>
            <Button onClick={add} className="flex items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"><Plus className="h-4 w-4" />Add</Button>
          </div>
          {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
          <div className="mt-3 overflow-x-auto rounded-lg glass">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground"><tr>{['Company', 'Position', 'Location', 'Date applied', 'Closing date', 'Status', 'Salary Range', 'Link(s)', 'Interview Date', ''].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-t border-border/50 align-top">
                    <td className="px-1"><input aria-label="Company" defaultValue={r.Company} onBlur={(e) => e.target.value !== r.Company && save(r.id, { Company: e.target.value })} className={`${cell} font-medium`} /></td>
                    <td className="px-1"><input aria-label="Position" defaultValue={r.Position ?? ''} onBlur={(e) => e.target.value !== (r.Position ?? '') && save(r.id, { Position: e.target.value || null })} className={cell} /></td>
                    <td className="px-1"><input aria-label="Location" defaultValue={r.Location} onBlur={(e) => e.target.value !== r.Location && save(r.id, { Location: e.target.value })} className={cell} /></td>
                    <td className="px-1"><input aria-label="Date" type="date" defaultValue={r.date?.slice(0, 10) ?? ''} onChange={(e) => save(r.id, { date: e.target.value || null })} className={cell} /></td>
                    <td className="px-1"><input aria-label="Closing date" type="date" defaultValue={r['Closing Date']?.slice(0, 10) ?? ''} onChange={(e) => save(r.id, { 'Closing Date': e.target.value || null })} className={cell} /></td>
                    <td className="px-1"><select aria-label="Status" value={r.Status ?? ''} onChange={(e) => save(r.id, { Status: e.target.value || null })} className={cell}><option value="">—</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></td>
                    <td className="px-1"><input aria-label="Salary range" defaultValue={r['Salary Range']} onBlur={(e) => e.target.value !== r['Salary Range'] && save(r.id, { 'Salary Range': e.target.value })} className={cell} /></td>
                    <td className="px-1">
                      <input aria-label="Links" defaultValue={r['Link(s)']} onBlur={(e) => e.target.value !== r['Link(s)'] && save(r.id, { 'Link(s)': e.target.value })} className={cell} />
                      {/^https?:\/\//.test(r['Link(s)']) && <a href={r['Link(s)'].split(/\s/)[0]} target="_blank" rel="noreferrer" className="px-1.5 text-xs underline">open</a>}
                    </td>
                    <td className="px-1">{r.Status === 'Interviewing' ? <input aria-label="Interview date" type="date" defaultValue={r['Interview Date']?.slice(0, 10) ?? ''} onChange={(e) => save(r.id, { 'Interview Date': e.target.value || null })} className={cell} /> : null}</td>
                    <td className="px-1 py-1"><Button aria-label={`Delete ${r.Company}`} onClick={() => remove(r)} className="rounded p-1.5 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!shown.length && <p className="p-4 text-sm text-muted-foreground">No applications match.</p>}
          </div>
        </>
      )}
    </Shell>
  );
}
