import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Check, Copy, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/Button';

type Row = { id: string; answer: string; guidance?: string; updated_at?: string } & Record<string, string>;

/** A searchable list of prompt → answer pairs stored in a Notion database (repeatable answers, interview questions). */
export function NotesDatabase({ table, titleCol, titleLabel, intro }: { table: 'answers' | 'interview_questions'; titleCol: string; titleLabel: string; intro: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      setSignedIn(!!data.session);
      if (!data.session) return;
      const r = await supabase.from(table).select('*').order('created_at', { ascending: true });
      if (cancelled) return;
      if (r.error) setError('Could not load. Please retry.');
      else setRows(r.data as Row[]);
    });
    return () => { cancelled = true; };
  }, [table]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (rows || []).filter((r) => !t || `${r[titleCol]} ${r.answer} ${r.guidance ?? ''}`.toLowerCase().includes(t));
  }, [rows, q, titleCol]);

  async function save(id: string, patch: Record<string, string>) {
    setRows((old) => old?.map((r) => (r.id === id ? { ...r, ...patch } : r)) ?? old);
    const { error: e } = await supabase.from(table).update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (e) setError('That change was not saved. Please retry.');
  }
  async function add() {
    const { data, error: e } = await supabase.from(table).insert({ [titleCol]: 'New entry', answer: '' }).select('*').single();
    if (e || !data) { setError('Could not add. Please retry.'); return; }
    setRows((old) => [...(old || []), data as Row]);
    setOpen((data as Row).id);
  }
  async function remove(id: string) {
    if (!confirm('Delete this entry? It is moved to the Notion trash.')) return;
    setRows((old) => old?.filter((r) => r.id !== id) ?? old);
    await supabase.from(table).delete().eq('id', id);
  }

  if (signedIn === false) return <Link to="/resume" className="underline">Sign in to see your answers</Link>;
  const field = 'w-full rounded-lg border bg-background/70 p-2 text-sm outline-none';
  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-muted-foreground">{intro} Edits save to Notion when you click away.</p>
      <div className="flex flex-wrap gap-2">
        <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg glass px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search questions and answers…" className="h-10 flex-1 bg-transparent text-sm outline-none" />
        </label>
        <Button onClick={add} className="flex items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"><Plus className="h-4 w-4" />Add</Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!rows ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
        <>
          <p className="text-xs text-muted-foreground">{shown.length} of {rows.length}</p>
          <ul className="space-y-2">
            {shown.map((r) => (
              <li key={r.id} className="rounded-lg glass">
                <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full items-start justify-between gap-3 p-4 text-left">
                  <span className="font-medium">{r[titleCol] || 'Untitled'}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{open === r.id ? 'Close' : `${r.answer.split(/\s+/).filter(Boolean).length} words`}</span>
                </button>
                {open === r.id && (
                  <div className="space-y-2 px-4 pb-4">
                    <label className="block text-xs text-muted-foreground">{titleLabel}
                      <input defaultValue={r[titleCol]} onBlur={(e) => e.target.value !== r[titleCol] && save(r.id, { [titleCol]: e.target.value })} className={`${field} mt-1`} />
                    </label>
                    {r.guidance && <details className="rounded-md bg-background/50 p-2 text-xs text-muted-foreground"><summary className="cursor-pointer">What they want and how to respond</summary><p className="mt-2 whitespace-pre-wrap">{r.guidance}</p></details>}
                    <label className="block text-xs text-muted-foreground">Your answer
                      <textarea defaultValue={r.answer} rows={Math.min(18, Math.max(5, Math.ceil(r.answer.length / 90)))} onBlur={(e) => e.target.value !== r.answer && save(r.id, { answer: e.target.value })} className={`${field} mt-1`} />
                    </label>
                    <div className="flex gap-2">
                      <Button onClick={() => { void navigator.clipboard.writeText(r.answer); setCopied(r.id); setTimeout(() => setCopied(null), 1500); }} className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs">{copied === r.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied === r.id ? 'Copied' : 'Copy answer'}</Button>
                      <Button onClick={() => remove(r.id)} className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs text-destructive"><Trash2 className="h-3.5 w-3.5" />Delete</Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
