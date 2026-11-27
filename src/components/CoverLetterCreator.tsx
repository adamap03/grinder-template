import { useEffect, useRef, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import { ArrowDown, ArrowLeft, ArrowUp, Check, Download, FileText, Loader2, Minus, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import { DocumentHistory } from '@/components/DocumentHistory';
import { uploadDocumentFn } from '@/lib/documents.functions';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/Button';
import { draftCoverLetter, pastLetterParts } from '@/lib/cover-letter.functions';
import { viewDocument } from '@/lib/documents.functions';
import { DocumentViewer, type Viewed } from '@/components/DocumentViewer';
import { ACCENT_RGB, LETTER_TYPES, blankLetter, letterDOCX, letterPDF, letterText, readLetter, todayLong, type Letter, type LetterType } from '@/lib/cover-letter-model';

// Preparation > Create new cover letter: pick a letter type, give the firm, role and advert, and Claude drafts a letter
// from your latest CV and your most similar past letters. Edit it beside a live preview; it saves itself into
// "Past cover letters" and downloads as PDF or Word.
const input = 'w-full rounded-md border bg-glass-strong px-3 py-2 text-sm outline-none';
const primary = 'inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50';
const secondary = 'inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50';

async function senderFromCV(): Promise<Letter['sender']> {
  const r = await supabase.from('resumes').select('data').order('updated_at', { ascending: false }).limit(1).maybeSingle();
  const p = ((r.data?.['data'] as { personal?: Record<string, string> } | null)?.personal) ?? {};
  return { name: p['name'] ?? '', contact: [p['email'], p['phone'], p['location'], p['linkedin']].filter(Boolean).join(' · ') };
}
type Made = { id: string; name: string; at: string; letter: Letter };
const toBase64 = (buf: ArrayBuffer) => { let s = ''; const bytes = new Uint8Array(buf); for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const nameOf = (l: Letter) => `Cover letter – ${[l.company, l.role].filter(Boolean).join(' – ') || 'draft'}`;

export function CoverLetterCreator({ letterId }: { letterId?: string | undefined }) {
  const navigate = useNavigate();
  const draft = useServerFn(draftCoverLetter);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [form, setForm] = useState({ type: LETTER_TYPES[0].id as LetterType, jobUrl: '', job: '', facts: '' });
  const [rowId, setRowId] = useState(letterId ?? '');
  const [letter, setLetter] = useState<Letter | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const parts = useServerFn(pastLetterParts);
  const uploadFile = useServerFn(uploadDocumentFn);
  const [view, setView] = useState<'list' | 'draft'>('list');
  const [mine, setMine] = useState<Made[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const viewDoc = useServerFn(viewDocument);
  // An uploaded past letter shown in the left panel (Open): PDFs in a viewer, other files as their text.
  const [viewing, setViewing] = useState<Viewed | null>(null);
  const [shownId, setShownId] = useState(''); // which letter made here is shown on the left ('' = the latest)
  // A dot in Past cover letters: an uploaded file shows as the file, a letter made here as its preview.
  const select = (d: { id: string; name: string; created: boolean }) => { if (d.created) { setViewing(null); setShownId(d.id); } else void showPast(d); };
  async function showPast(d: { id: string; name: string }) {
    setViewing({ id: d.id, name: d.name, url: null, text: '', pdf: true });
    const r = await viewDoc({ data: { kind: 'Cover letter', id: d.id } }).catch(() => null);
    if (!r?.url) { setViewing(null); setError('That file could not be opened. Please retry in a moment.'); return; }
    setViewing({ id: d.id, name: d.name, url: r.url, text: r.text, pdf: r.pdf });
  }

  // Letters made in the app (they have data), most recently edited first.
  async function loadMine() {
    const r = await supabase.from('cover_letters').select('id,name,data,updated_at,created_at');
    setMine((r.data ?? []).flatMap((d) => { const l = readLetter(d['data']); return l ? [{ id: String(d['id']), name: String(d['name']), at: String(d['updated_at'] || d['created_at'] || ''), letter: l }] : []; })
      .sort((x, y) => y.at.localeCompare(x.at)));
  }
  useEffect(() => { if (signedIn && !letter) void loadMine(); }, [signedIn, letter]);
  const openMade = (id: string) => void navigate({ to: '/preparation', search: { tab: 'create', letter: id } });

  // A past letter as a starting point: one made here opens as it is; an uploaded file is split into editable parts
  // (word for word) and opened as a new letter, leaving the file untouched.
  async function pickPast(id: string) {
    setError(''); setBusy('Reading the letter and splitting it into editable parts…');
    try {
      const r = await parts({ data: { id } });
      if (!r.ok) throw new Error(r.error);
      if (r.letter) { openMade(id); return; }
      const x = r.parts!;
      const cv = await senderFromCV();
      await create({ ...blankLetter('graduate', { name: x.sender_name || cv.name, contact: x.sender_contact || cv.contact }),
        company: x.company, role: x.role, date: x.date || todayLong(), recipient: x.recipient || 'Hiring Manager', salutation: x.salutation || 'Dear Hiring Manager,',
        paragraphs: x.paragraphs.length ? x.paragraphs : [''], signOff: x.sign_off || 'Yours sincerely,', inspiredBy: [r.from] });
    } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  async function upload(file: File) {
    setError('');
    if (file.size > 5 * 1024 * 1024) { setError('The file is larger than 5 MB.'); return; }
    setBusy('Uploading…');
    const r = await uploadFile({ data: { kind: 'Cover letter', name: file.name, type: file.type || 'application/octet-stream', data: toBase64(await file.arrayBuffer()), date: null } }).catch((e: Error) => ({ ok: false as const, error: e.message }));
    setHistoryKey((k) => k + 1);
    if (!r.ok || !r.id) { setBusy(''); setError(r.ok ? 'Uploaded, but it could not be opened. Choose it under Past cover letters.' : r.error); return; }
    await pickPast(r.id);
  }
  async function scratch() {
    setBusy('Starting…');
    try { await create(blankLetter('graduate', await senderFromCV())); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }

  useEffect(() => { supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session)); }, []);
  // Opening a saved letter (from Past cover letters).
  useEffect(() => {
    if (!letterId || !signedIn || (letterId === rowId && letter)) return; // just created here: already open
    supabase.from('cover_letters').select('id,data').eq('id', letterId).maybeSingle().then(({ data }) => {
      const l = readLetter(data?.['data']);
      if (l) { setRowId(letterId); setLetter(l); } else setError('That cover letter could not be opened.');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [letterId, signedIn]);

  async function create(l: Letter) {
    const { data, error: e } = await supabase.from('cover_letters')
      .insert({ name: nameOf(l), date: new Date().toISOString().slice(0, 10), data: l, text: letterText(l), updated_at: new Date().toISOString() }).select('id').single();
    if (e || !data) throw new Error(e?.message ?? 'The letter could not be saved.');
    setRowId(String(data['id'])); setLetter(l); setSaved('Saved');
    void navigate({ to: '/preparation', search: { tab: 'create', letter: String(data['id']) }, replace: true });
  }
  async function start(withClaude: boolean) {
    setError('');
    if (!form.jobUrl.trim() && form.job.trim().length < 30) { setError('Paste the link to the advert, or the advert itself.'); return; }
    if (!withClaude) return;
    setBusy('Claude is reading the advert, your CV and your past letters (about a minute)…');
    try {
      const l = blankLetter(form.type, await senderFromCV());
      if (withClaude) {
        const r = await draft({ data: { type: form.type, job: form.job, jobUrl: form.jobUrl.trim(), facts: form.facts } });
        if (!r.ok) throw new Error(r.error);
        Object.assign(l, { company: r.draft.company, role: r.draft.role, recipient: r.draft.recipient, salutation: r.draft.salutation, paragraphs: r.draft.paragraphs, signOff: r.draft.sign_off, inspiredBy: r.draft.inspired_by, check: r.draft.check });
      }
      await create(l);
    } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }

  function change(next: Letter) {
    setLetter(next); setSaved('Unsaved changes');
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSaved('Saving…');
      const { error: e } = await supabase.from('cover_letters').update({ name: nameOf(next), data: next, text: letterText(next), updated_at: new Date().toISOString() }).eq('id', rowId);
      setSaved(e ? 'Save failed — edit again to retry' : 'Saved');
    }, 800);
  }

  if (signedIn === false) return <p className="text-sm text-muted-foreground">Sign in (on the Resume page) to create cover letters.</p>;

  if (!letter && view === 'draft') return (
    <div className="max-w-3xl space-y-5">
      <Button onClick={() => setView('list')} className="flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" />Back to your cover letters</Button>
      <p className="text-muted-foreground">Choose the kind of letter and give the advert (its link, or the text if there is no link). Claude works out the firm and the role, and drafts the letter from your latest CV, your past cover letters for similar roles and anything you add below; you then edit it beside a live preview.</p>
      <div role="radiogroup" aria-label="Type of letter">
        <p className="mb-2 text-sm font-semibold">Type of letter</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {LETTER_TYPES.map((t) => (
            <Button key={t.id} role="radio" aria-checked={form.type === t.id} onClick={() => setForm((f) => ({ ...f, type: t.id }))}
              className={`relative rounded-lg glass p-4 pr-9 text-left transition ${form.type === t.id ? 'bg-primary/10 outline-2 -outline-offset-1 outline-primary' : 'opacity-75 hover:opacity-100'}`}>
              {form.type === t.id && <Check aria-hidden className="absolute right-3 top-3 h-4 w-4 text-primary" />}
              <span className="block font-medium">{t.name}</span><span className="text-sm text-muted-foreground">{t.blurb}</span>
            </Button>
          ))}
        </div>
      </div>
      <label className="block space-y-1 text-xs font-medium text-muted-foreground">Link to the advert<input type="url" maxLength={2000} placeholder="https://…" value={form.jobUrl} onChange={(e) => setForm({ ...form, jobUrl: e.target.value })} className={input} /></label>
      <label className="block space-y-1 text-xs font-medium text-muted-foreground">No link? Paste the advert here<textarea rows={6} maxLength={20000} value={form.job} onChange={(e) => setForm({ ...form, job: e.target.value })} className={input} /></label>
      <label className="block space-y-1 text-xs font-medium text-muted-foreground">Experience or facts to include (optional)<textarea rows={4} maxLength={4000} placeholder="e.g. I have scanned buildings with my phone's LiDAR to make 3D models, and 3D-printed some of them." value={form.facts} onChange={(e) => setForm({ ...form, facts: e.target.value })} className={input} /></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button disabled={!!busy} onClick={() => void start(true)} className={primary}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Draft with Claude</Button>
      {busy && <p role="status" className="text-sm text-muted-foreground">{busy}</p>}
    </div>
  );

  // Like the Resume page: upload row, the current letter as it prints on the left, past letters to pick from on the right.
  if (!letter) {
    const latest = (mine ?? []).find((m) => m.id === shownId) ?? mine?.[0];
    const others = (mine ?? []).filter((m) => m !== latest);
    return (
      <>
        <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f && !busy) void upload(f); }} className={`resume-upload my-5 flex flex-wrap items-center gap-4 rounded-lg border-2 border-dashed glass px-5 py-4 ${dragging ? 'ring-2 ring-ring' : ''}`}>
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-sage/35"><Upload className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1"><h2 className="text-lg font-semibold">Start with a cover letter</h2><p className="text-sm text-muted-foreground">Drop your PDF or DOCX here · up to 5 MB. It is kept in Past cover letters and opened as an editable letter.</p></div>
          <label className={`${primary} cursor-pointer ${busy ? 'pointer-events-none opacity-50' : ''}`}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Upload cover letter<input type="file" accept=".pdf,.doc,.docx,.odt,.txt" className="sr-only" disabled={!!busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} /></label>
        </div>
        {busy && <p role="status" className="mb-3 flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />{busy}</p>}
        {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b py-5">
              <h2 className="text-lg font-semibold">Your current cover letter</h2>
              <div className="flex gap-3">
                <Button disabled={!!busy} className="flex items-center gap-2 text-sm" onClick={() => void scratch()}>+ Create from scratch</Button>
                <Button disabled={!!busy} className="flex items-center gap-1 text-sm" onClick={() => { setError(''); setView('draft'); }}><Sparkles className="h-4 w-4 text-amber-500" />Draft with Claude</Button>
              </div>
            </div>
            {viewing ? (
              <div className="space-y-3 py-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0"><p className="truncate font-medium">{viewing.name}</p><p className="text-xs text-muted-foreground">Past cover letter (uploaded file)</p></div>
                  <div className="flex gap-2">
                    <Button onClick={() => setViewing(null)} className={secondary}><ArrowLeft className="h-4 w-4" />Current letter</Button>
                    <Button disabled={!!busy} onClick={() => void pickPast(viewing.id)} className={primary}><FileText className="h-4 w-4" />Use</Button>
                  </div>
                </div>
                <div className="h-[78vh] overflow-hidden rounded-lg border bg-glass-strong">
                  <DocumentViewer doc={viewing} />
                </div>
              </div>
            ) : mine === null ? <p className="py-8 text-sm text-muted-foreground">Loading cover letters…</p> : !latest ? <p className="py-8 text-sm text-muted-foreground">No cover letters made here yet. Upload one, pick one from Past cover letters, or create one.</p> : (
              <div className="space-y-3 py-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0"><p className="truncate font-medium">{latest.name}</p><p className="text-xs text-muted-foreground">Edited {new Date(latest.at).toLocaleDateString()}</p></div>
                  <Button onClick={() => openMade(latest.id)} className={primary}><FileText className="h-4 w-4" />Edit</Button>
                </div>
                <div className="h-[78vh] overflow-hidden rounded-lg border bg-glass-strong"><LetterPreview letter={latest.letter} fit onClick={() => openMade(latest.id)} /></div>
                {others.length > 0 && <div><p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Other cover letters</p><div className="grid gap-2 sm:grid-cols-2">{others.map((m) => <Button key={m.id} onClick={() => setShownId(m.id)} className="flex items-center gap-3 rounded-lg glass p-3 text-left"><FileText className="h-6 w-6 shrink-0 text-muted-foreground" /><div className="min-w-0"><div className="truncate text-sm font-medium">{m.name}</div><div className="text-xs text-muted-foreground">Edited {new Date(m.at).toLocaleDateString()}</div></div></Button>)}</div></div>}
              </div>
            )}
          </div>
          <div className="min-w-0 lg:pt-5">
            <DocumentHistory key={historyKey} kind="Cover letter" title="Past cover letters" className="mt-0" onUse={(d) => void pickPast(d.id)} onOpen={(d) => void showPast(d)} onSelect={select} selectedId={viewing?.id ?? latest?.id}
              intro="Your uploaded and created cover letters, newest first. Click a dot to show that letter on the left. Use opens an editable copy of an uploaded one (the file stays as it is)." />
          </div>
        </div>
      </>
    );
  }

  const l = letter;
  const set = (patch: Partial<Letter>) => change({ ...l, ...patch });
  const setPara = (i: number, v: string) => set({ paragraphs: l.paragraphs.map((p, n) => (n === i ? v : p)) });
  const move = (i: number, d: number) => { const ps = [...l.paragraphs]; const a = ps[i], b = ps[i + d]; if (a === undefined || b === undefined) return; ps[i] = b; ps[i + d] = a; set({ paragraphs: ps }); };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button aria-label="Back to your cover letters" title="Back to your cover letters" onClick={() => { clearTimeout(timer.current); setLetter(null); setRowId(''); setView('list'); void navigate({ to: '/preparation', search: { tab: 'create' } }); }} className="grid h-8 w-8 place-items-center rounded-md hover:bg-muted"><ArrowLeft className="h-4 w-4" /></Button>
          <div><p className="font-semibold">{nameOf(l)}</p><p role="status" className="flex items-center gap-1 text-xs text-muted-foreground"><Check className="h-3 w-3" />{saved || 'Saved'}</p></div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => void letterPDF(l)} className={secondary}><Download className="h-4 w-4" />PDF</Button>
          <Button onClick={() => void letterDOCX(l)} className={secondary}><Download className="h-4 w-4" />Word</Button>
        </div>
      </div>
      {(l.inspiredBy.length > 0 || l.check.length > 0) && (
        <div className="grid gap-3 md:grid-cols-2">
          {l.inspiredBy.length > 0 && <div className="rounded-lg glass p-4 text-sm"><p className="font-semibold">Drew on your past letters</p><ul className="mt-1 list-disc pl-5 text-muted-foreground">{l.inspiredBy.map((n) => <li key={n}>{n}</li>)}</ul></div>}
          {l.check.length > 0 && <div className="rounded-lg bg-peach/25 p-4 text-sm"><p className="font-semibold">Fill in or check</p><ul className="mt-1 list-disc pl-5">{l.check.map((c) => <li key={c}>{c}</li>)}</ul></div>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-y py-3 text-xs">
        <label className="flex items-center gap-2">Font<select value={l.format.font} onChange={(e) => set({ format: { ...l.format, font: e.target.value as Letter['format']['font'] } })} className="rounded border bg-glass-strong px-2 py-1">{['Arial', 'Georgia', 'Helvetica', 'Times New Roman'].map((f) => <option key={f}>{f}</option>)}</select></label>
        <label className="flex items-center gap-2">Size<input type="number" min={9} max={13} value={l.format.fontSize} onChange={(e) => set({ format: { ...l.format, fontSize: Math.max(9, Math.min(13, Number(e.target.value))) } })} className="w-12 rounded border bg-glass-strong p-1" /></label>
        <label className="flex items-center gap-2">Margins<input type="number" min={15} max={30} value={l.format.margin} onChange={(e) => set({ format: { ...l.format, margin: Math.max(15, Math.min(30, Number(e.target.value))) } })} className="w-12 rounded border bg-glass-strong p-1" />mm</label>
        <div className="flex items-center gap-2">Accent{(['charcoal', 'green', 'blue'] as const).map((a) => <Button key={a} aria-label={`${a} accent`} title={`${a} accent`} onClick={() => set({ format: { ...l.format, accent: a } })} className={`resume-swatch swatch-${a} ${l.format.accent === a ? 'ring-2 ring-ring ring-offset-2' : ''}`} />)}</div>
      </div>
      <div className="grid overflow-hidden rounded-lg border bg-glass-strong lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="min-w-0 space-y-3 border-r p-5 lg:max-h-[85vh] lg:overflow-y-auto">
          <p className="text-xs font-semibold">LETTER EDITOR</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Firm" value={l.company} onChange={(company) => set({ company })} />
            <Field label="Role or scheme" value={l.role} onChange={(role) => set({ role })} />
            <Field label="Your name" value={l.sender.name} onChange={(name) => set({ sender: { ...l.sender, name } })} />
            <Field label="Date" value={l.date} onChange={(date) => set({ date })} />
          </div>
          <Field label="Your contact line" value={l.sender.contact} onChange={(contact) => set({ sender: { ...l.sender, contact } })} />
          <Field label="Recipient (one line each)" value={l.recipient} onChange={(recipient) => set({ recipient })} rows={3} />
          <Field label="Greeting" value={l.salutation} onChange={(salutation) => set({ salutation })} />
          {l.paragraphs.map((p, i) => (
            <div key={i} className="flex items-start gap-1">
              <div className="flex-1"><Field label={`Paragraph ${i + 1}`} value={p} onChange={(v) => setPara(i, v)} rows={5} /></div>
              <div className="flex flex-col pt-5">
                <IconButton label="Move paragraph up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></IconButton>
                <IconButton label="Move paragraph down" disabled={i === l.paragraphs.length - 1} onClick={() => move(i, 1)}><ArrowDown /></IconButton>
                <IconButton label="Remove paragraph" onClick={() => set({ paragraphs: l.paragraphs.filter((_, n) => n !== i) })}><Trash2 /></IconButton>
              </div>
            </div>
          ))}
          <Button onClick={() => set({ paragraphs: [...l.paragraphs, ''] })} className="flex items-center gap-2 text-sm font-medium"><Plus className="h-4 w-4" />Add paragraph</Button>
          <Field label="Sign-off" value={l.signOff} onChange={(signOff) => set({ signOff })} />
          <Button onClick={() => set({ date: todayLong() })} className="text-xs text-muted-foreground underline">Set the date to today</Button>
        </div>
        <LetterPreview letter={l} />
      </div>
    </div>
  );
}

function Field({ label, value, onChange, rows }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return <label className="block space-y-1"><span className="text-xs font-medium text-muted-foreground">{label}</span>{rows ? <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} className={input} /> : <input value={value} onChange={(e) => onChange(e.target.value)} className={input} />}</label>;
}
function IconButton({ label, children, ...props }: { label: string; children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <Button {...props} aria-label={label} title={label} className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-30 [&_svg]:h-3.5 [&_svg]:w-3.5">{children}</Button>;
}

/** The letter on an A4 page, sized like the download (mm and pt scaled by the zoom). */
function LetterPreview({ letter: l, fit = false, onClick }: { letter: Letter; fit?: boolean; onClick?: () => void }) {
  const [zoom, setZoom] = useState(70);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const w = box.current?.clientWidth; if (fit && w) setZoom(Math.max(40, Math.min(110, Math.floor((w - 40) / (210 * 3.78) * 20) * 5))); }, [fit]);
  const mm = (v: number) => `${v * 3.78 * zoom / 100}px`;
  const pt = (v: number) => `${v * 1.333 * zoom / 100}px`;
  const [r, g, b] = ACCENT_RGB[l.format.accent];
  const gap = pt(l.format.fontSize * 0.9);
  return (
    <div className={`flex min-w-0 flex-col ${fit ? 'h-full' : ''}`}>
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <span className="text-xs font-semibold">LIVE PREVIEW</span>
        <div className="flex items-center gap-1">
          <IconButton label="Zoom out" disabled={zoom <= 40} onClick={() => setZoom(zoom - 5)}><Minus /></IconButton>
          <span className="w-9 text-center text-xs">{zoom}%</span>
          <IconButton label="Zoom in" disabled={zoom >= 110} onClick={() => setZoom(zoom + 5)}><Plus /></IconButton>
        </div>
      </div>
      <div ref={box} className={`min-h-0 flex-1 overflow-auto bg-muted/40 p-5 ${fit ? '' : 'lg:max-h-[80vh]'}`}>
        <div onClick={onClick} title={onClick ? 'Edit this letter' : undefined} className={`mx-auto bg-white text-[#2a2a2a] shadow ${onClick ? 'cursor-pointer' : ''}`} style={{ width: mm(210), minHeight: mm(297), padding: mm(l.format.margin), fontFamily: l.format.font, fontSize: pt(l.format.fontSize), lineHeight: 1.45 }}>
          <p style={{ fontSize: pt(l.format.fontSize + 5), fontWeight: 700, color: `rgb(${r},${g},${b})` }}>{l.sender.name || 'Your name'}</p>
          <p style={{ fontSize: pt(l.format.fontSize - 1), marginBottom: gap }}>{l.sender.contact}</p>
          <p style={{ marginBottom: gap }}>{l.date}</p>
          <p style={{ whiteSpace: 'pre-line', marginBottom: gap }}>{l.recipient}</p>
          {l.role && <p style={{ fontWeight: 700, marginBottom: gap }}>Re: {l.role}</p>}
          <p style={{ marginBottom: gap }}>{l.salutation}</p>
          {l.paragraphs.filter((p) => p.trim()).map((p, i) => <p key={i} style={{ whiteSpace: 'pre-line', marginBottom: gap }}>{p}</p>)}
          <p style={{ marginBottom: pt(l.format.fontSize * 2.4) }}>{l.signOff}</p>
          <p style={{ fontWeight: 700 }}>{l.sender.name}</p>
        </div>
      </div>
    </div>
  );
}
