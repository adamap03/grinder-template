// A firm's careers / vacancies page, found without AI. Used when a source is read (Discover), when a firm is
// shortlisted, and by the company research page.
import { fetchPage } from './claude.server';

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; Grinder/1.0)' };
const CAREER_TEXT = /career|vacanc|\bjobs?\b|join (us|our team)|recruit|work (with|for) us|opportunit/i;

// Many small-firm sites build their menu in JavaScript, so the homepage shows no careers link; try the usual addresses.
export async function guessCareers(home: string): Promise<string | null> {
  const paths = ['/careers', '/vacancies', '/jobs', '/join-us', '/careers/', '/vacancies/', '/work-with-us', '/about/careers'];
  const hits = await Promise.all(paths.map(async (p) => {
    const r = await fetchPage(home + p, { headers: UA }, 10000).catch(() => null);
    return r?.ok && new URL(r.url).pathname.replace(/\/$/, '') !== '' ? r.url : null;
  }));
  return hits.find(Boolean) ?? null;
}

/** The firm's careers / vacancies page: a link on its homepage that says so, else the usual addresses (/careers...). */
export async function careersPageOf(website: string): Promise<string | null> {
  let home: URL;
  try { home = new URL(website); } catch { return null; }
  const res = await fetchPage(home.href, { headers: UA }, 15000).catch(() => null);
  if (res?.ok) {
    const html = await res.text();
    const base = new URL(res.url);
    const hits = [...html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)].flatMap((m) => {
      try {
        const u = new URL(m[1]!, base);
        const label = m[2]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!/^https?:$/.test(u.protocol) || !(CAREER_TEXT.test(label) || /career|vacanc|jobs|join-us|recruit/i.test(u.pathname))) return [];
        // The firm's own pages, or a job board it links to (e.g. Workable, Teamtailor).
        const own = u.hostname.replace(/^www\./, '') === base.hostname.replace(/^www\./, '');
        if (!own && !/workable|teamtailor|greenhouse|lever\.co|ashbyhq|recruitee|bamboohr|peoplehr|jobs\.|careers\./i.test(u.hostname)) return [];
        return [{ url: u.href, score: (/vacanc|current.?(jobs|opportunities)/i.test(label + u.pathname) ? 2 : 0) + (own ? 0 : 1) }];
      } catch { return []; }
    });
    const best = hits.sort((a, b) => b.score - a.score)[0];
    if (best) return best.url;
  }
  return guessCareers(home.origin);
}
