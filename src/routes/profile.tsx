import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import type { z } from 'zod';
import { Loader2, RefreshCw } from 'lucide-react';
import { Shell } from '@/components/Shell';
import { Button } from '@/components/Button';
import { LanguagesEditor } from '@/components/LanguagesEditor';
import { supabase } from '@/integrations/supabase/client';
import { generateProfile, profileHistory, type Assessment } from '@/lib/profile.functions';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/profile')({
  head: () => pageHead({ title: 'My profile — Grinder', description: 'An honest outside view of you as a candidate, built up over time.', path: '/profile' }),
  component: ProfilePage,
});

type A = z.infer<typeof Assessment>;
const parse = (s: unknown): A | null => { try { return s ? (JSON.parse(String(s)) as A) : null; } catch { return null; } };

function ProfilePage() {
  const gen = useServerFn(generateProfile);
  const hist = useServerFn(profileHistory);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [a, setA] = useState<A | null>(null);
  const [at, setAt] = useState('');
  const [history, setHistory] = useState<{ label: string; at: string; assessment: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSignedIn(!!data.session);
      if (!data.session) return;
      const p = await supabase.from('profiles').select('assessment,updated_at').maybeSingle();
      setA(parse(p.data?.['assessment'])); setAt(String(p.data?.['updated_at'] ?? ''));
      hist().then(setHistory).catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    setBusy(true); setError('');
    const r = await gen();
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setA(r.assessment); setAt(r.at);
    hist().then(setHistory).catch(() => {});
  }

  return (
    <Shell>
      <div className="py-8">
        <h1 className="font-display text-5xl">My profile</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">An outside view of you as a candidate, written from your resumes, cover letters, quiz answers and applications. Each new version reads the earlier ones, so it builds a longer-term opinion over time.</p>
      </div>
      {signedIn === false ? <Link to="/resume" className="underline">Sign in to see your profile</Link> : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={refresh} disabled={busy} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{a ? 'Update my profile' : 'Write my profile'}</Button>
              {at && <span className="text-xs text-muted-foreground">Last written {new Date(at).toLocaleString()}</span>}
            </div>
            {busy && <p className="text-sm text-muted-foreground">Reading your resumes, letters and applications. This takes about a minute.</p>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {a ? <AssessmentView a={a} /> : !busy && <p className="rounded-lg glass p-5 text-sm text-muted-foreground">No profile yet. Add a resume and a few applications first, then write your profile.</p>}
          </div>
          <aside className="space-y-4">
            <LanguagesEditor />
            {history.length > 0 && (
              <div className="rounded-lg glass p-5">
                <h3 className="text-lg font-semibold">Earlier versions</h3>
                <ul className="mt-2 space-y-2 text-sm">
                  {history.map((h) => (
                    <li key={h.at}><button type="button" onClick={() => { setA(parse(h.assessment)); setAt(h.at); }} className="text-left hover:underline"><span className="block text-xs text-muted-foreground">{new Date(h.at).toLocaleDateString()}</span>{h.label}</button></li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      )}
    </Shell>
  );
}

function AssessmentView({ a }: { a: A }) {
  const block = 'rounded-lg glass p-5';
  return (
    <div className="space-y-4">
      <div className={block}><p className="font-display text-2xl">{a.headline}</p></div>
      <div className={block}><h2 className="font-semibold">Character</h2><p className="mt-1 text-sm">{a.character}</p></div>
      <div className={block}><h2 className="font-semibold">Motivations</h2><p className="mt-1 text-sm">{a.motivations}</p></div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className={block}><h2 className="font-semibold">Strengths</h2><ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{a.strengths.map((s) => <li key={s}>{s}</li>)}</ul></div>
        <div className={block}><h2 className="font-semibold">Honest concerns</h2><ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{a.concerns.map((s) => <li key={s}>{s}</li>)}</ul></div>
      </div>
      <div className={block}><h2 className="font-semibold">Over time</h2><p className="mt-1 text-sm">{a.over_time}</p></div>
      <div className={block}>
        <h2 className="font-semibold">Places you may not have looked</h2>
        <ul className="mt-2 space-y-3 text-sm">{a.adjacent_paths.map((p) => <li key={p.field}><span className="font-medium">{p.field}.</span> {p.why} <span className="text-muted-foreground">First step: {p.first_step}</span></li>)}</ul>
      </div>
      <div className={block}><h2 className="font-semibold">Verdict</h2><p className="mt-1 text-sm">{a.verdict}</p></div>
    </div>
  );
}
