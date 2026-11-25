// Job listings that a careers page carries as data inside its HTML rather than as visible text (so the text reader
// misses them): schema.org JobPosting blocks (JSON-LD, used by many job sites for search engines) and the Dayforce
// job feed some sites embed (e.g. Esri UK: objects with "Title" and "JobDetailsUrl"). Pure functions; see
// scripts/check-embedded-jobs.ts.

export type EmbeddedJob = { title: string; location: string; url: string; closing_date: string; summary: string };

const str = (v: unknown) => (typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim();
const unescapeJson = (s: string) => { try { return JSON.parse(`"${s}"`) as string; } catch { return s; } };

function ldJobs(html: string, base: string): EmbeddedJob[] {
  const out: EmbeddedJob[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    const type = ([] as unknown[]).concat(o['@type'] ?? []);
    if (type.includes('JobPosting') && str(o['title'])) {
      const place = ([] as unknown[]).concat(o['jobLocation'] ?? [])[0] as { address?: Record<string, unknown> } | undefined;
      const a = place?.address ?? {};
      let url = str(o['url']);
      try { url = url ? new URL(url, base).href : ''; } catch { url = ''; }
      out.push({ title: str(o['title']), location: [str(a['addressLocality']), str(a['addressRegion'])].filter(Boolean).join(', '), url, closing_date: str(o['validThrough']).slice(0, 10), summary: '' });
    }
    if (o['@graph']) walk(o['@graph']);
    if (o['itemListElement']) walk(o['itemListElement']);
    if (o['item']) walk(o['item']);
  };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1]!)); } catch { /* not valid JSON: skip */ }
  }
  return out;
}

function dayforceJobs(html: string): EmbeddedJob[] {
  const out: EmbeddedJob[] = [];
  // Each job object: "Title": "...", ... "JobDetailsUrl": "https://jobs.dayforcehcm.com/..." (City follows later).
  for (const m of html.matchAll(/"Title":\s*"((?:[^"\\]|\\.){1,200})"([\s\S]{0,60000}?)"JobDetailsUrl":\s*"(https:\/\/jobs\.dayforcehcm\.com\/[^"]+)"([\s\S]{0,3000}?)(?="Title":|$)/g)) {
    const after = m[4] ?? '';
    const field = (k: string) => unescapeJson(after.match(new RegExp(`"${k}":\\s*"((?:[^"\\\\]|\\\\.)*)"`))?.[1] ?? '');
    out.push({ title: unescapeJson(m[1]!).trim(), location: [field('City'), field('State')].filter(Boolean).join(', '), url: m[3]!, closing_date: '', summary: '' });
  }
  return out;
}

/** Jobs embedded in a careers page's HTML, de-duplicated by link (else title). Empty when there are none. */
export function embeddedJobs(html: string, pageUrl: string): EmbeddedJob[] {
  const seen = new Set<string>();
  return [...ldJobs(html, pageUrl), ...dayforceJobs(html)].filter((j) => {
    const k = (j.url || j.title).toLowerCase();
    if (!j.title || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
