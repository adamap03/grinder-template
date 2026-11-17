import { supabase } from '@/integrations/supabase/client';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Plus, Trash2 } from 'lucide-react';
import { Shell } from '@/components/Shell';
import { Button } from '@/components/Button';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/calendar')({
  head: () => pageHead({ title: 'Calendar — Grinder', description: 'Application closing dates and interviews, contacts and recruiter correspondence.', path: '/calendar' }),
  component: CalendarPage,
});

type Contact = { id: string; text: string; link: string | null };
type Recruiter = { id: string; name: string; agency: string; email: string; phone: string; location_range: string; opportunities: string; notes: string; last_contact: string | null };
type App = { id: string; Company: string; Position: string | null; Status: string | null; 'Closing Date': string | null; 'Interview Date': string | null };

const field = 'w-full rounded-md border bg-background/60 px-2 py-1 text-sm outline-none';
const day = (d: Date) => d.toISOString().slice(0, 10);

function CalendarPage() {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [recruiters, setRecruiters] = useState<Recruiter[]>([]);
  const [apps, setApps] = useState<App[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSignedIn(!!data.session);
      if (data.session) {
        const [c, rc, a] = await Promise.all([
          supabase.from('contacts').select('*').order('created_at', { ascending: true }),
          supabase.from('recruiters').select('*').order('created_at', { ascending: false }),
          supabase.from('applications').select('id,Company,Position,Status,Closing Date,Interview Date'),
        ]);
        if (c.error || rc.error || a.error) setError('Some of this page could not load. Please retry.');
        setContacts((c.data as Contact[]) || []); setRecruiters((rc.data as Recruiter[]) || []); setApps((a.data as unknown as App[]) || []);
      }
      setReady(true);
    });
  }, []);

  async function update<T extends { id: string }>(table: string, set: (f: (old: T[]) => T[]) => void, id: string, patch: Partial<T>) {
    set((old) => old.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const { error: e } = await supabase.from(table).update(patch).eq('id', id);
    if (e) setError('A change was not saved. Please retry.');
  }
  async function remove<T extends { id: string }>(table: string, set: (f: (old: T[]) => T[]) => void, id: string) {
    set((old) => old.filter((x) => x.id !== id));
    await supabase.from(table).delete().eq('id', id);
  }
  async function add<T>(table: string, set: (f: (old: T[]) => T[]) => void, values: Record<string, unknown>, atEnd = true) {
    const { data, error: e } = await supabase.from(table).insert(values).select('*').single();
    if (e || !data) { setError('Could not add. Please retry.'); return; }
    set((old) => (atEnd ? [...old, data as T] : [data as T, ...old]));
  }

  // Next 30 days: application closing dates and interview dates from the Application tracker.
  const days = useMemo(() => {
    const start = new Date(); start.setHours(12, 0, 0, 0);
    return Array.from({ length: 30 }, (_, i) => {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const key = day(d);
      return {
        d, key,
        items: [
          ...apps.filter((a) => a['Closing Date']?.slice(0, 10) === key && !/Rejected|Pass|Accepted/.test(a.Status ?? '')).map((a) => ({ kind: 'Closes', text: [a.Position, a.Company].filter(Boolean).join(' · ') })),
          ...apps.filter((a) => a['Interview Date']?.slice(0, 10) === key).map((a) => ({ kind: 'Interview', text: [a.Position, a.Company].filter(Boolean).join(' · ') })),
        ],
      };
    });
  }, [apps]);

  if (!ready) return <Shell><p className="py-8">Loading…</p></Shell>;
  if (!signedIn) return <Shell><div className="py-8"><h1 className="font-display text-5xl">Calendar</h1><Link to="/resume" className="mt-4 inline-block underline">Sign in to view your calendar</Link></div></Shell>;
  return (
    <Shell>
      <div className="py-8"><h1 className="font-display text-5xl">Calendar</h1></div>
      {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <details className="group rounded-lg glass p-5">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-lg font-semibold"><ChevronRight className="h-4 w-4 transition group-open:rotate-90" />Contacts <span className="text-sm font-normal text-muted-foreground">({contacts.length})</span></summary>
          <div className="mt-2 flex justify-end"><Button onClick={() => add<Contact>('contacts', setContacts, { text: '' })} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs"><Plus className="h-3.5 w-3.5" />Add</Button></div>
          <p className="mt-1 text-xs text-muted-foreground">Mentors, people to reach out to and learn from, and careers to follow.</p>
          <ul className="mt-3 space-y-2">
            {contacts.map((c) => (
              <li key={c.id} className="flex items-start gap-2">
                <span aria-hidden className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/60" />
                <div className="flex-1 space-y-1">
                  <textarea aria-label="Contact note" defaultValue={c.text} rows={Math.max(1, Math.ceil(c.text.length / 70))} onBlur={(e) => e.target.value !== c.text && update<Contact>('contacts', setContacts, c.id, { text: e.target.value })} placeholder="Who they are, why they matter, how to follow their path…" className={field} />
                  <input aria-label="Contact link" defaultValue={c.link ?? ''} onBlur={(e) => e.target.value !== (c.link ?? '') && update<Contact>('contacts', setContacts, c.id, { link: e.target.value || null })} placeholder="Link (website, LinkedIn, Instagram)" className={`${field} text-xs`} />
                  {c.link && /^https?:\/\//.test(c.link) && <a href={c.link} target="_blank" rel="noreferrer" className="text-xs underline">open</a>}
                </div>
                <Button aria-label="Delete contact" onClick={() => remove<Contact>('contacts', setContacts, c.id)} className="p-1 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
              </li>
            ))}
            {!contacts.length && <li className="text-sm text-muted-foreground">No contacts yet.</li>}
          </ul>
        </details>

        <details className="group rounded-lg glass p-5">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-lg font-semibold"><ChevronRight className="h-4 w-4 transition group-open:rotate-90" />Recruiter correspondence <span className="text-sm font-normal text-muted-foreground">({recruiters.length})</span></summary>
          <div className="mt-2 flex justify-end"><Button onClick={() => add<Recruiter>('recruiters', setRecruiters, { name: 'New recruiter' }, false)} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs"><Plus className="h-3.5 w-3.5" />Add</Button></div>
          <p className="mt-1 text-xs text-muted-foreground">Recruiters, the areas they cover and what they have offered. Email sync from Outlook is not connected yet, so add them here.</p>
          <ul className="mt-3 space-y-3">
            {recruiters.map((r) => (
              <li key={r.id} className="rounded-md border border-border/60 p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  {([['name', 'Name'], ['agency', 'Agency'], ['email', 'Email'], ['phone', 'Phone'], ['location_range', 'Location range']] as const).map(([k, label]) => (
                    <input key={k} aria-label={label} placeholder={label} defaultValue={r[k]} onBlur={(e) => e.target.value !== r[k] && update<Recruiter>('recruiters', setRecruiters, r.id, { [k]: e.target.value })} className={field} />
                  ))}
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">Last contact<input type="date" aria-label="Last contact" defaultValue={r.last_contact?.slice(0, 10) ?? ''} onChange={(e) => update<Recruiter>('recruiters', setRecruiters, r.id, { last_contact: e.target.value || null })} className={field} /></label>
                </div>
                <textarea aria-label="Opportunities" placeholder="Opportunities they have put forward…" defaultValue={r.opportunities} rows={2} onBlur={(e) => e.target.value !== r.opportunities && update<Recruiter>('recruiters', setRecruiters, r.id, { opportunities: e.target.value })} className={`${field} mt-2`} />
                <textarea aria-label="Notes" placeholder="Notes" defaultValue={r.notes} rows={1} onBlur={(e) => e.target.value !== r.notes && update<Recruiter>('recruiters', setRecruiters, r.id, { notes: e.target.value })} className={`${field} mt-2`} />
                <div className="mt-2 flex items-center gap-3 text-xs">
                  {r.email && <a href={`mailto:${r.email}`} className="underline">Email</a>}
                  <Button aria-label={`Delete ${r.name}`} onClick={() => remove<Recruiter>('recruiters', setRecruiters, r.id)} className="ml-auto p-1 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
                </div>
              </li>
            ))}
            {!recruiters.length && <li className="text-sm text-muted-foreground">No recruiters yet.</li>}
          </ul>
        </details>
      </div>

      <section aria-labelledby="cal-h" className="mt-6">
        <h2 id="cal-h" className="text-lg font-semibold">Next 30 days</h2>
        <p className="text-xs text-muted-foreground">Closing dates and interview dates from your Application tracker. Both are Notion date fields, so they also show in Notion Calendar.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-7">
          {days.map(({ d, key, items }) => (
            <div key={key} className={`min-h-24 rounded-lg p-2 text-xs ${items.length ? 'glass' : 'border border-border/40'}`}>
              <div className={`font-medium ${d.getDay() === 0 || d.getDay() === 6 ? 'text-muted-foreground' : ''}`}>{d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</div>
              <ul className="mt-1 space-y-1">
                {items.map((it, i) => <li key={i} className="rounded bg-background/70 px-1.5 py-1"><span className="font-semibold">{it.kind}:</span> {it.text}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </section>

    </Shell>
  );
}
