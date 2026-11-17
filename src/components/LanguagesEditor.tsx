import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/Button';

export type Language = { language: string; level: string };
// CEFR levels plus native, as used in Europass CVs.
const NOT_STATED = 'Level not stated';
const LEVELS = ['Native', 'C2 – Proficient', 'C1 – Advanced', 'B2 – Upper intermediate', 'B1 – Intermediate', 'A2 – Elementary', 'A1 – Beginner', NOT_STATED];

// A level written next to a language in the resume ("German (B2)", "Spanish – fluent", "native English").
function levelIn(text: string): string | null {
  const cefr = text.match(/\b([ABC][12])\b/i)?.[1]?.toUpperCase();
  if (cefr) return LEVELS.find((l) => l.startsWith(cefr)) ?? null;
  if (/native|mother tongue|first language/i.test(text)) return 'Native';
  if (/fluent|proficient/i.test(text)) return 'C1 – Advanced';
  if (/advanced/i.test(text)) return 'C1 – Advanced';
  if (/intermediate|conversational|working/i.test(text)) return 'B1 – Intermediate';
  if (/basic|beginner|elementary/i.test(text)) return 'A2 – Elementary';
  return null;
}

type Entry = { title?: string; subtitle?: string; details?: string; bullets?: string[] };
type Sec = { heading?: string; entries?: Entry[] };
/** Languages listed in a resume (a section or entry headed "Languages"), in the resume's order. */
export function languagesFromResume(data: { sections?: Sec[] } | null): Language[] {
  const texts: string[] = [];
  for (const sec of data?.sections ?? []) {
    const all = /language/i.test(sec.heading ?? '');
    for (const e of sec.entries ?? []) if (all || /language/i.test(e.title ?? '')) texts.push([all ? e.title : '', e.subtitle, e.details, ...(e.bullets ?? [])].filter(Boolean).join('\n'));
  }
  const out: Language[] = [];
  for (const t of texts) {
    const body = t.replace(/^[^\n:]*(best to worst|in order|order of)[^\n:]*:?/i, '');
    for (const raw of body.split(/[,;\n•·|]+/)) {
      const item = raw.trim();
      const name = item.replace(/\(.*?\)/g, ' ').replace(/[-–—:].*$/, ' ').replace(/\b([ABC][12]|native|fluent|proficient|advanced|intermediate|conversational|working|basic|beginner|elementary|mother tongue|first language|proficiency|level)\b/gi, ' ').replace(/\s+/g, ' ').trim();
      if (!name || name.length > 40 || /\d/.test(name)) continue;
      const level = levelIn(item);
      const seen = out.find((l) => l.language.toLowerCase() === name.toLowerCase());
      if (seen) { if (level && seen.level === NOT_STATED) seen.level = level; continue; }
      out.push({ language: name, level: level ?? NOT_STATED });
    }
  }
  return out;
}

/** Languages you speak, saved to your profile (Notion "Profiles" database). Used on Resume and My profile. Kept in
 *  step with your latest resume: its languages, in its order; levels from the resume or the ones you set here. */
export function LanguagesEditor({ compact = false }: { compact?: boolean }) {
  const [langs, setLangs] = useState<Language[] | null>(null);
  const [saved, setSaved] = useState('');

  const [fromResume, setFromResume] = useState('');
  useEffect(() => {
    (async () => {
      const [{ data: p }, { data: rs }] = await Promise.all([
        supabase.from('profiles').select('languages').maybeSingle(),
        supabase.from('resumes').select('title,data,updated_at').order('updated_at', { ascending: false }).limit(1),
      ]);
      const current = ((p?.['languages'] as Language[] | null) || []).filter((l) => l.language.trim());
      const latest = (rs as { title: string; data: { sections?: Sec[] } | null }[] | null)?.[0];
      const listed = languagesFromResume(latest?.data ?? null);
      if (!listed.length) { setLangs(current); return; }
      const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
      // Resume languages first, in its order; your own level wins over "not stated"; extra ones you added stay at the end.
      const next = [
        ...listed.map((l) => { const mine = current.find((c) => same(c.language, l.language)); return mine && l.level === NOT_STATED ? { ...l, level: mine.level } : l; }),
        ...current.filter((c) => !listed.some((l) => same(l.language, c.language))),
      ];
      setFromResume(latest?.title ?? 'your resume');
      if (JSON.stringify(next) !== JSON.stringify(current)) await persist(next); else setLangs(current);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function persist(next: Language[]) {
    setLangs(next);
    const { data: s } = await supabase.auth.getSession();
    if (!s.session) return;
    const { error } = await supabase.from('profiles').upsert({ user_id: s.session.user.id, languages: next.filter((l) => l.language.trim()), updated_at: new Date().toISOString() });
    setSaved(error ? 'Not saved, retry' : 'Saved');
    setTimeout(() => setSaved(''), 1500);
  }
  if (!langs) return null;
  const field = 'rounded-md border bg-background/60 px-2 py-1 text-sm outline-none';
  return (
    <div className={compact ? '' : 'rounded-lg glass p-5'}>
      <div className="flex items-center justify-between gap-2">
        <h3 className={compact ? 'text-sm font-medium' : 'text-lg font-semibold'}>Languages</h3>
        <span className="text-xs text-muted-foreground">{saved}</span>
        <Button onClick={() => setLangs([...langs, { language: '', level: 'B2 – Upper intermediate' }])} className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs"><Plus className="h-3.5 w-3.5" />Add</Button>
      </div>
      {!compact && <p className="mt-1 text-xs text-muted-foreground">Shown on your profile and used when matching roles in Europe that need a local language.{fromResume ? ` Updated automatically from ${fromResume}.` : ''}</p>}
      <ul className="mt-2 space-y-2">
        {langs.map((l, i) => (
          <li key={i} className="flex gap-2">
            <input aria-label="Language" value={l.language} placeholder="e.g. German" onChange={(e) => setLangs(langs.map((x, j) => (j === i ? { ...x, language: e.target.value } : x)))} onBlur={() => persist(langs)} className={`${field} min-w-0 flex-1`} />
            <select aria-label="Level" value={l.level} onChange={(e) => persist(langs.map((x, j) => (j === i ? { ...x, level: e.target.value } : x)))} className={field}>{LEVELS.map((v) => <option key={v}>{v}</option>)}</select>
            <Button aria-label={`Remove ${l.language || 'language'}`} onClick={() => persist(langs.filter((_, j) => j !== i))} className="p-1 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
          </li>
        ))}
        {!langs.length && <li className="text-xs text-muted-foreground">No languages added yet.</li>}
      </ul>
    </div>
  );
}
