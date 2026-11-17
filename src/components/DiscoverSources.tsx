import { useEffect, useRef, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { ExternalLink, Library, Loader2, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/Button';
import { crawlDirectories } from '@/lib/firms.functions';

type Crawl = Extract<Awaited<ReturnType<typeof crawlDirectories>>, { ok: true }>['status'];
type Source = { id: string; name: string; url: string; description: string; sector?: string };
const BUILT_IN: Source = { id: 'istructe', name: 'IStructE Find an Engineer', url: 'https://www.findanengineer.com/listings/', description: 'Structural engineering firms registered with the Institution of Structural Engineers: offices, size and the kinds of work they do.' };

/** "Sources" button and pop-up for one sector: the directories Discover reads that sector's firms from. Rows live in
 *  the Notion "Discover sources" table (sector column = sector key). */
/** One line describing a sector read (used by the Sources pop-up and Discover's "Refresh ticked sectors"). */
export function describeCrawl(s: Crawl): string {
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`;
  if (s.running) return `Working · ${s.step || 'starting'}`;
  if (!s.finished_at) return '';
  const problems = s.errors.length ? ` · ${n(s.errors.length, 'problem')}: ${s.errors.at(-1)}` : '';
  return `Last read ${new Date(s.finished_at).toLocaleString()} · ${n(s.added, 'new firm')} · ${n(s.careers, 'careers page')} found${problems}`;
}

export function DiscoverSources({ signedIn, sector, label, istructe = false }: { signedIn: boolean; sector: string; label: string; istructe?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState<Source[]>([]);
  const [form, setForm] = useState({ name: '', url: '', description: '' });
  const [error, setError] = useState('');
  const crawl = useServerFn(crawlDirectories);
  const [status, setStatus] = useState<Crawl | null>(null); // null = not an admin (or not checked yet)

  async function poll(start = false) {
    const r = await crawl({ data: { start, sectors: [sector] } }).catch(() => null);
    setStatus(r?.ok ? r.status : null);
    return r?.ok ? r.status : null;
  }
  // While a crawl runs, show its progress every few seconds.
  useEffect(() => {
    if (!status?.running) return;
    const t = setInterval(() => void poll(), 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.running]);

  async function load() {
    const r = await supabase.from('discover_sources').select('id,name,url,description,sector').order('created_at', { ascending: true });
    setRows(((r.data ?? []) as Source[]).filter((s) => (s.sector || 'engineering') === sector));
  }
  // Loaded when the pop-up opens, so eight sector buttons don't each query on page load.

  async function add(e: React.FormEvent) {
    e.preventDefault(); setError('');
    let url: URL;
    try { url = new URL(form.url.trim()); if (!/^https?:$/.test(url.protocol)) throw new Error(); } catch { setError('Enter a full web address starting with https://'); return; }
    const r = await supabase.from('discover_sources').insert({ name: form.name.trim(), url: url.href, description: form.description.trim(), sector });
    if (r.error) { setError(r.error.message); return; }
    setForm({ name: '', url: '', description: '' });
    await load();
  }
  async function drop(s: Source) {
    if (!confirm(`Remove ${s.name}? It is moved to the Notion trash.`)) return;
    setRows((old) => old.filter((x) => x.id !== s.id));
    await supabase.from('discover_sources').delete().eq('id', s.id);
  }

  const input = 'rounded-md border bg-background/70 px-2 py-1.5 text-sm';
  return (
    <>
      <Button type="button" aria-label={`Sources for ${label}`} onClick={() => { dialog.current?.showModal(); if (signedIn) { void load(); void poll(); } }} className="flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]"><Library className="h-3 w-3" />Sources</Button>
      <dialog ref={dialog} aria-labelledby={`sources-title-${sector}`} className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-xl border bg-background p-0 text-foreground backdrop:bg-black/40">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 id={`sources-title-${sector}`} className="font-semibold">Sources: {label}</h2>
          <Button type="button" aria-label="Close" onClick={() => dialog.current?.close()} className="p-1 text-muted-foreground"><X className="h-4 w-4" /></Button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4 text-sm">
          <p className="text-muted-foreground">Directories Discover reads {label.toLowerCase()} firms from.</p>
          <ul className="mt-3 space-y-2">
            {rows.length === 0 && !(sector === 'engineering' && istructe) && <li className="text-xs text-muted-foreground">No sources yet. Add a directory below.</li>}
            {[...(sector === 'engineering' && istructe ? [BUILT_IN] : []), ...rows].map((s) => (
              <li key={s.id} className="rounded-lg border p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{s.name}{s === BUILT_IN && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-normal">built in</span>}</div>
                    <a href={s.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 truncate text-xs text-primary hover:underline">{s.url}<ExternalLink className="h-3 w-3 shrink-0" /></a>
                    {s.description && <p className="mt-1 text-xs text-muted-foreground">{s.description}</p>}
                  </div>
                  {s !== BUILT_IN && <Button type="button" aria-label={`Remove ${s.name}`} onClick={() => drop(s)} className="p-1 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>}
                </div>
              </li>
            ))}
          </ul>
          {signedIn ? (
            <form onSubmit={add} className="mt-4 grid gap-2 rounded-lg border border-dashed p-3">
              <input required maxLength={120} placeholder="Source name" aria-label="Source name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} />
              <input required type="url" maxLength={500} placeholder="https://…" aria-label="Source URL" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} className={input} />
              <textarea maxLength={1000} rows={2} placeholder="What it lists (optional)" aria-label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={input} />
              {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
              <Button type="submit" className="flex items-center justify-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"><Plus className="h-4 w-4" />Add source</Button>
            </form>
          ) : <p className="mt-4 text-xs text-muted-foreground">Sign in to add sources.</p>}
          {status && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
              <Button type="button" disabled={status.running} onClick={() => void poll(true)} className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-foreground disabled:opacity-60">
                {status.running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Read {label.toLowerCase()} sources now
              </Button>
              <span aria-live="polite">{describeCrawl(status) || 'Admin: reads this sector\'s sources again (only new firms are added) and finds their careers pages.'}</span>
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}
