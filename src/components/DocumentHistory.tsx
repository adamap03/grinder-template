import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { ExternalLink, Loader2, Trash2, Upload } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/Button';
import { editDocument, listDocuments, openDocument, removeDocument, uploadDocumentFn } from '@/lib/documents.functions';

type Doc = Awaited<ReturnType<typeof listDocuments>>[number];

const toBase64 = (buf: ArrayBuffer) => {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Uploaded old CVs or cover letters, newest first, so changes over time are easy to follow. */
/** onUse: adds a "Use" button to uploaded files (the cover letter creator opens an editable copy).
 *  onOpen: Open shows an uploaded file there (the creator's left panel) instead of in a new tab. */
export function DocumentHistory({ kind, title, intro, className = 'mt-8', onUse, onOpen }: { kind: 'CV' | 'Cover letter'; title: string; intro: string; className?: string; onUse?: (d: Doc) => void; onOpen?: (d: Doc) => void }) {
  const list = useServerFn(listDocuments);
  const upload = useServerFn(uploadDocumentFn);
  const remove = useServerFn(removeDocument);
  const open = useServerFn(openDocument);
  const edit = useServerFn(editDocument);
  const navigate = useNavigate();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState<{ id: string; url: string } | null>(null);

  async function load() {
    try { setDocs(await list({ data: { kind } })); } catch (e) { setDocs([]); setError((e as Error).message); }
  }
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSignedIn(!!data.session); if (data.session) void load(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  // Several files at once, one after another (Notion takes one upload at a time); dates come from the file name or
  // today and can be changed in the list afterwards.
  async function add(files: File[]) {
    setBusy(true); setError('');
    const failed: string[] = [];
    for (const [i, file] of files.entries()) {
      setProgress(files.length > 1 ? `${i + 1} of ${files.length}` : '');
      const r = await upload({ data: { kind, name: file.name, type: file.type || 'application/octet-stream', data: toBase64(await file.arrayBuffer()), date: null } }).catch((e: Error) => ({ ok: false as const, error: e.message }));
      if (!r.ok) failed.push(`${file.name}: ${r.error}`);
    }
    setBusy(false); setProgress('');
    if (failed.length) setError(`Not uploaded: ${failed.join('; ')}`);
    await load();
  }
  // Open a blank tab straight away (so it is not blocked as a pop-up), then point it at a fresh file link.
  async function view(d: Doc) {
    // Letters made in the app have no file: open them in the cover letter creator.
    if (d.created) { void navigate({ to: '/preparation', search: { tab: 'create', letter: d.id } }); return; }
    if (onOpen) { onOpen(d); return; }
    const w = window.open('about:blank', '_blank');
    const r = await open({ data: { kind, id: d.id } }).catch(() => ({ url: null }));
    if (r.url && w) w.location.href = r.url;
    else if (r.url) setReady({ id: d.id, url: r.url }); // pop-ups blocked: offer a link to click instead
    else { w?.close(); setError('That file could not be opened. Please retry in a moment.'); }
  }
  async function change(d: Doc, patch: { name?: string; date?: string | null }) {
    if (patch.name !== undefined && (!patch.name.trim() || patch.name === d.name)) return;
    if (patch.date !== undefined && patch.date === d.date) return;
    setDocs((old) => old?.map((x) => (x.id === d.id ? { ...x, ...patch } : x)).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')) ?? old);
    await edit({ data: { kind, id: d.id, ...patch } });
  }
  async function drop(d: Doc) {
    if (!confirm(`Remove ${d.name}? It is moved to the Notion trash.`)) return;
    setDocs((old) => old?.filter((x) => x.id !== d.id) ?? old);
    await remove({ data: { kind, id: d.id } });
  }

  if (signedIn === false) return null;
  return (
    <section aria-label={title} className={`${className} rounded-lg glass p-5`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">{intro}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2 text-xs">
          <label className={`flex cursor-pointer items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground ${busy ? 'opacity-60' : ''}`}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{busy && progress ? `Uploading ${progress}` : 'Upload files'}
            <input type="file" accept=".pdf,.doc,.docx,.odt,.txt" multiple className="sr-only" disabled={busy} onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) void add(fs); }} />
          </label>
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      {!docs ? <Loader2 className="mt-4 h-5 w-5 animate-spin text-muted-foreground" /> : !docs.length ? <p className="mt-4 text-sm text-muted-foreground">Nothing yet.</p> : (
        <ol className="mt-4 space-y-2 border-l pl-4">
          {docs.map((d) => (
            <li key={d.id} className="relative">
              <span aria-hidden className="absolute -left-[21px] top-2 h-2.5 w-2.5 rounded-full bg-primary" />
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <input type="month" aria-label={`Month of ${d.name}`} defaultValue={d.date?.slice(0, 7) ?? ''} onBlur={(e) => void change(d, { date: e.target.value ? `${e.target.value}-01` : null })} className="w-36 shrink-0 rounded border border-transparent bg-transparent px-1 text-xs text-muted-foreground hover:border-border focus:border-border" />
                <input aria-label={`Name of ${d.name}`} defaultValue={d.name} onBlur={(e) => void change(d, { name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 font-medium hover:border-border focus:border-border" />
                <Button aria-label={`Open ${d.name} in a new tab`} onClick={() => void view(d)} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs"><ExternalLink className="h-3.5 w-3.5" />{d.created ? 'Edit' : 'Open'}</Button>
                {onUse && !d.created && <Button aria-label={`Use ${d.name} as an editable letter`} onClick={() => onUse(d)} className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground">Use</Button>}
                {ready?.id === d.id && <a href={ready.url} target="_blank" rel="noreferrer" onClick={() => setReady(null)} className="text-xs text-primary underline">Your browser blocked the new tab: click to open</a>}
                {<Button aria-label={`Remove ${d.name}`} onClick={() => drop(d)} className="p-1 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
