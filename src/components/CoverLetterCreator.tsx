import { useEffect, useRef, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { useNavigate } from '@tanstack/react-router';
import { ArrowDown, ArrowLeft, ArrowUp, Check, Download, FileText, Loader2, Minus, Plus, Sparkles, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/Button';
import { draftCoverLetter } from '@/lib/cover-letter.functions';
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
const nameOf = (l: Letter) => `Cover letter – ${[l.company, l.role].filter(Boolean).join(' – ') || 'draft'}`;

export function CoverLetterCreator({ letterId }: { letterId?: string | undefined }) {
  const navigate = useNavigate();
  const draft = useServerFn(draftCoverLetter);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [form, setForm] = useState({ type: LETTER_TYPES[0].id as LetterType, company: '', role: '', jobUrl: '', job: '' });
  const [rowId, setRowId] = useState(letterId ?? '');
  const [letter, setLetter] = useState<Letter | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

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
      .insert({ name: nameOf(l), date: new Date().toISOString().slice(0, 10), data: l, text: letterText(l) }).select('id').single();
    if (e || !data) throw new Error(e?.message ?? 'The letter could not be saved.');
    setRowId(String(data['id'])); setLetter(l); setSaved('Saved');
    void navigate({ to: '/preparation', search: { tab: 'create', letter: String(data['id']) }, replace: true });
  }
  async function start(withClaude: boolean) {
    setError('');
    if (!form.company.trim()) { setError('Enter the firm first.'); return; }
    setBusy(withClaude ? 'Claude is reading the advert, your CV and your past letters (about a minute)…' : 'Starting…');
    try {
      const l = { ...blankLetter(form.type, await senderFromCV()), company: form.company.trim(), role: form.role.trim() };
      if (withClaude) {
        const r = await draft({ data: { type: form.type, company: l.company, role: l.role, job: form.job, jobUrl: form.jobUrl.trim() } });
        if (!r.ok) throw new Error(r.error);
        Object.assign(l, { recipient: r.draft.recipient, salutation: r.draft.salutation, paragraphs: r.draft.paragraphs, signOff: r.draft.sign_off, inspiredBy: r.draft.inspired_by, check: r.draft.check });
      }
      await create(l);
    } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }

  function change(next: Letter) {
    setLetter(next); setSaved('Unsaved changes');
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSaved('Saving…');
      const { error: e } = await supabase.from('cover_letters').update({ name: nameOf(next), data: next, text: letterText(next) }).eq('id', rowId);
      setSaved(e ? 'Save failed — edit again to retry' : 'Saved');
    }, 800);
  }

  if (signedIn === false) return <p className="text-sm text-muted-foreground">Sign in (on the Resume page) to create cover letters.</p>;

  if (!letter) return (
    <div className="max-w-3xl space-y-5">
      <p className="text-muted-foreground">Choose the kind of letter, tell Claude the firm and the role, and paste the advert or its link. Claude drafts it from your latest CV and your past cover letters for similar roles; you then edit it beside a live preview. It is saved in Past cover letters.</p>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Type of letter</legend>
        {LETTER_TYPES.map((t) => (
          <label key={t.id} className={`cursor-pointer rounded-lg glass p-4 ${form.type === t.id ? 'ring-2 ring-ring' : ''}`}>
            <input type="radio" name="letter-type" value={t.id} checked={form.type === t.id} onChange={() => setForm({ ...form, type: t.id })} className="sr-only" />
            <span className="block font-medium">{t.name}</span><span className="text-sm text-muted-foreground">{t.blurb}</span>
          </label>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-medium text-muted-foreground">Firm<input required maxLength={200} value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} className={input} /></label>
        <label className="space-y-1 text-xs font-medium text-muted-foreground">Role or scheme<input maxLength={200} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={input} /></label>
      </div>
      <label className="block space-y-1 text-xs font-medium text-muted-foreground">Link to the advert (optional)<input type="url" maxLength={2000} placeholder="https://…" value={form.jobUrl} onChange={(e) => setForm({ ...form, jobUrl: e.target.value })} className={input} /></label>
      <label className="block space-y-1 text-xs font-medium text-muted-foreground">Or paste the advert (optional)<textarea rows={6} maxLength={20000} value={form.job} onChange={(e) => setForm({ ...form, job: e.target.value })} className={input} /></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!!busy} onClick={() => void start(true)} className={primary}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Draft with Claude</Button>
        <Button disabled={!!busy} onClick={() => void start(false)} className={secondary}><FileText className="h-4 w-4" />Start blank</Button>
      </div>
      {busy && <p role="status" className="text-sm text-muted-foreground">{busy}</p>}
    </div>
  );

  const l = letter;
  const set = (patch: Partial<Letter>) => change({ ...l, ...patch });
  const setPara = (i: number, v: string) => set({ paragraphs: l.paragraphs.map((p, n) => (n === i ? v : p)) });
  const move = (i: number, d: number) => { const ps = [...l.paragraphs]; const a = ps[i], b = ps[i + d]; if (a === undefined || b === undefined) return; ps[i] = b; ps[i + d] = a; set({ paragraphs: ps }); };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button aria-label="New letter" title="New letter" onClick={() => { setLetter(null); setRowId(''); void navigate({ to: '/preparation', search: { tab: 'create' } }); }} className="grid h-8 w-8 place-items-center rounded-md hover:bg-muted"><ArrowLeft className="h-4 w-4" /></Button>
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
function LetterPreview({ letter: l }: { letter: Letter }) {
  const [zoom, setZoom] = useState(70);
  const mm = (v: number) => `${v * 3.78 * zoom / 100}px`;
  const pt = (v: number) => `${v * 1.333 * zoom / 100}px`;
  const [r, g, b] = ACCENT_RGB[l.format.accent];
  const gap = pt(l.format.fontSize * 0.9);
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex h-12 items-center justify-between border-b px-4">
        <span className="text-xs font-semibold">LIVE PREVIEW</span>
        <div className="flex items-center gap-1">
          <IconButton label="Zoom out" disabled={zoom <= 40} onClick={() => setZoom(zoom - 5)}><Minus /></IconButton>
          <span className="w-9 text-center text-xs">{zoom}%</span>
          <IconButton label="Zoom in" disabled={zoom >= 110} onClick={() => setZoom(zoom + 5)}><Plus /></IconButton>
        </div>
      </div>
      <div className="flex-1 overflow-auto bg-muted/40 p-5 lg:max-h-[80vh]">
        <div className="mx-auto bg-white text-[#2a2a2a] shadow" style={{ width: mm(210), minHeight: mm(297), padding: mm(l.format.margin), fontFamily: l.format.font, fontSize: pt(l.format.fontSize), lineHeight: 1.45 }}>
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
