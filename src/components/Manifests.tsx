import { useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/Button';

// My profile > Manifests: your career plan and goals, written now and then under the same headings. Only the latest
// can be edited (the server enforces it); earlier ones are shown beside it to see whether you are on track or drifting.
const HEADINGS = [
  ['now', 'Where I am now', 'Role, skills, situation, how you feel about it.'],
  ['one_year', 'Where I want to be in 1 year', 'The job, the place, what you will have learned.'],
  ['five_years', 'Where I want to be in 5 years', 'The career you are building towards.'],
  ['plan', 'How I will get there', 'Concrete steps: applications, qualifications, people, habits.'],
  ['non_negotiables', 'What I will not compromise on', 'Values, location, balance, the kind of work.'],
] as const;
type Key = (typeof HEADINGS)[number][0];
type Manifest = { id: string; title: string; created_at: string; updated_at: string } & Record<Key, string>;

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function Manifests() {
  const [rows, setRows] = useState<Manifest[] | null>(null);
  const [compareId, setCompareId] = useState('');
  const [saving, setSaving] = useState<'' | 'saving' | 'saved'>('');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pending = useRef<Partial<Manifest>>({});

  async function load() {
    const r = await supabase.from('manifests').select('*').order('created_at', { ascending: false });
    if (r.error) { setError(r.error.message); return; }
    const list = (r.data ?? []) as Manifest[];
    setRows(list);
    setCompareId((c) => (list.some((m, i) => i > 0 && m.id === c) ? c : list[1]?.id ?? ''));
  }
  useEffect(() => { void load(); }, []);

  const latest = rows?.[0];
  const earlier = rows?.slice(1) ?? [];
  const compare = earlier.find((m) => m.id === compareId);

  function edit(patch: Partial<Manifest>) {
    if (!latest) return;
    const next = { ...latest, ...patch };
    setRows((old) => (old ? [next, ...old.slice(1)] : old));
    setSaving('saving');
    pending.current = { ...pending.current, ...patch }; // edits to several boxes within the delay are saved together
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(latest.id), 800);
  }
  // Saves typed-but-unsaved edits now (also before starting a new manifest, which locks this one).
  async function flush(id = latest?.id) {
    clearTimeout(timer.current);
    const all = pending.current;
    pending.current = {};
    if (!id || !Object.keys(all).length) return;
    const { error: e } = await supabase.from('manifests').update({ ...all, updated_at: new Date().toISOString() }).eq('id', id);
    setSaving(e ? '' : 'saved');
    setError(e ? e.message : '');
  }

  async function startNew() {
    await flush();
    if (latest && !confirm('Start a new manifest? Your current one is kept but locked, so it stays a record of what you thought then.')) return;
    setStarting(true);
    const { error: e } = await supabase.from('manifests').insert({ title: `Manifest, ${day(new Date().toISOString())}` });
    if (!e) { setCompareId(latest?.id ?? ''); await load(); }
    setError(e ? e.message : '');
    setStarting(false);
  }

  async function remove(m: Manifest) {
    if (!confirm(`Delete "${m.title}"? It is moved to the Notion trash.`)) return;
    const { error: e } = await supabase.from('manifests').delete().eq('id', m.id);
    if (e) { setError(e.message); return; }
    await load();
  }

  if (rows === null) return error ? <p role="alert" className="text-sm text-destructive">{error}</p> : <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  const box = 'rounded-lg glass p-4';
  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-muted-foreground">Write down your career plan and goals under the same headings each time. Every now and then start a new one: the earlier ones stay as they were, next to the new one, so you can see whether you are on track or drifting.</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={startNew} disabled={starting} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">{starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{latest ? 'Start a new manifest' : 'Write my first manifest'}</Button>
        {earlier.length > 0 && (
          <label className="flex items-center gap-2 text-sm">Compare with
            <select value={compareId} onChange={(e) => setCompareId(e.target.value)} className="rounded-md border bg-background/70 px-2 py-1.5 text-sm">
              <option value="">Nothing</option>
              {earlier.map((m) => <option key={m.id} value={m.id}>{m.title} ({day(m.created_at)})</option>)}
            </select>
          </label>
        )}
        <span aria-live="polite" className="text-xs text-muted-foreground">{saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved' : ''}</span>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!latest ? <p className={`${box} text-sm text-muted-foreground`}>No manifests yet.</p> : (
        <div className="space-y-4">
          <div className={`grid gap-4 ${compare ? 'md:grid-cols-2' : ''}`}>
            {compare && (
              <div className={`${box} flex items-start justify-between gap-2 opacity-90`}>
                <div><p className="font-semibold">{compare.title}</p><p className="text-xs text-muted-foreground">Written {day(compare.created_at)} · locked</p></div>
                <Button aria-label={`Delete ${compare.title}`} onClick={() => remove(compare)} className="p-1 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
              </div>
            )}
            <div className={`${box} flex items-start justify-between gap-2`}>
              <div className="min-w-0 flex-1">
                <input aria-label="Manifest title" value={latest.title} maxLength={120} onChange={(e) => edit({ title: e.target.value })} className="w-full bg-transparent font-semibold outline-none" />
                <p className="text-xs text-muted-foreground">Started {day(latest.created_at)} · current</p>
              </div>
              <Button aria-label={`Delete ${latest.title}`} onClick={() => remove(latest)} className="p-1 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
          {HEADINGS.map(([key, label, hint]) => (
            <section key={key} aria-labelledby={`m-${key}`}>
              <h2 id={`m-${key}`} className="font-semibold">{label}</h2>
              <div className={`mt-2 grid gap-4 ${compare ? 'md:grid-cols-2' : ''}`}>
                {compare && <p className={`${box} whitespace-pre-wrap text-sm text-muted-foreground`}>{compare[key] || <em>Nothing written.</em>}</p>}
                <textarea aria-label={label} placeholder={hint} value={latest[key] ?? ''} rows={5} maxLength={8000} onChange={(e) => edit({ [key]: e.target.value } as Partial<Manifest>)} className={`${box} w-full resize-y bg-transparent text-sm outline-none`} />
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
