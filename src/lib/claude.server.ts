// Claude (Anthropic API) replaces Nebius (chat + structured output) and Tavily (web search, page extract, site map).
// Server-only. Needs ANTHROPIC_API_KEY; CLAUDE_MODEL / CLAUDE_SEARCH_MODEL override the models.
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { zodSchema } from 'ai';
import type { z } from 'zod';

export const CLAUDE_MODEL = process.env['CLAUDE_MODEL'] || 'claude-opus-5-5';
// Web search is many small reads, so it runs on the cheaper Haiku.
const SEARCH_MODEL = process.env['CLAUDE_SEARCH_MODEL'] || 'claude-haiku-5-5';
export const CLAUDE_MODELS = [CLAUDE_MODEL, SEARCH_MODEL].filter((m, i, a) => a.indexOf(m) === i);
// On a safety decline the API re-runs the request on a fallback model it picks (server-side, same call).
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const };

let _client: Anthropic | undefined;
function client() {
  if (!process.env['ANTHROPIC_API_KEY']) throw new Error('AI is not configured on this server (ANTHROPIC_API_KEY is missing).');
  return (_client ??= new Anthropic());
}
function declined(stop: string | null | undefined) {
  if (stop === 'refusal') throw new Error('Claude declined this request.');
}

/** Structured output (output_config.format) validated against the app's zod schema. */
export async function claudeObject<T>(schema: z.ZodType<T>, system: string, prompt: string, cheap = false): Promise<T> {
  const json = (await zodSchema(schema as never).jsonSchema) as Parameters<typeof jsonSchemaOutputFormat>[0];
  const res = await client().beta.messages.parse({
    // Haiku has no server-side refusal fallback, so the fallback beta is only sent for the main model.
    ...(cheap ? {} : FALLBACK),
    model: cheap ? SEARCH_MODEL : CLAUDE_MODEL,
    max_tokens: 16000,
    system,
    messages: [{ role: 'user', content: prompt }],
    output_config: { format: jsonSchemaOutputFormat(json) },
  });
  declined(res.stop_reason);
  if (res.stop_reason === 'max_tokens') throw new Error('The answer was too long and got cut off. Please retry with less text.');
  return schema.parse(res.parsed_output);
}

/** Streams a chat reply, re-emitted as OpenAI-style SSE (`data: {choices:[{delta:{content}}]}`) so the chat UI is unchanged. */
export async function claudeChatStream(system: string, msgs: { role: 'user' | 'assistant'; content: string }[], signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
  const stream = client().beta.messages.stream(
    { ...FALLBACK, model: CLAUDE_MODEL, max_tokens: 64000, output_config: { effort: 'low' }, system, messages: msgs },
    signal ? { signal } : undefined,
  );
  const enc = new TextEncoder();
  const send = (ctl: ReadableStreamDefaultController<Uint8Array>, text: string) =>
    ctl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
  return new ReadableStream<Uint8Array>({
    async start(ctl) {
      try {
        for await (const e of stream) if (e.type === 'content_block_delta' && e.delta.type === 'text_delta') send(ctl, e.delta.text);
        if ((await stream.finalMessage()).stop_reason === 'refusal') send(ctl, '\n\n_Claude declined to answer this._');
      } catch (e) {
        if (!signal?.aborted) send(ctl, `\n\n_The reply stopped: ${(e as Error).message.slice(0, 200)}_`);
      }
      ctl.enqueue(enc.encode('data: [DONE]\n\n'));
      ctl.close();
    },
    cancel() { stream.abort(); },
  });
}

export type WebResult = { title: string; url: string; content: string };

/** Web search through Claude's web_search tool. URLs and titles come from the search results themselves,
 * snippets from Claude's summary of each page, so no URL is invented. */
export async function webSearch(query: string, max = 5, domains?: string[]): Promise<WebResult[]> {
  // Haiku 5.5 takes the basic web search variant (the _20260209 one needs Sonnet/Opus 4.6+).
  const tool: Anthropic.WebSearchTool20250305 = { type: 'web_search_20250305', name: 'web_search', max_uses: 3, ...(domains?.length ? { allowed_domains: domains } : {}) };
  const msgs: Anthropic.MessageParam[] = [{
    role: 'user',
    content: `Search the web for: ${query}\n\nThen reply with only a JSON array (most relevant first, at most ${max} items) of {"url","title","content"} for result pages you found, where content is a factual 1-3 sentence snippet of what that page says. Use only URLs from your search results.`,
  }];
  const found: WebResult[] = [];
  let text = '';
  for (let turn = 0; turn < 4; turn++) {
    const res = await client().messages.create({ model: SEARCH_MODEL, max_tokens: 4000, messages: msgs, tools: [tool] });
    declined(res.stop_reason);
    for (const b of res.content) {
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content))
        for (const r of b.content) if (r.url && !found.some((f) => f.url === r.url)) found.push({ url: r.url, title: r.title || r.url, content: '' });
      if (b.type === 'text') text += b.text;
    }
    if (res.stop_reason !== 'pause_turn') break;
    msgs.push({ role: 'assistant', content: res.content }); // long search: the API resumes it
  }
  let picked: Partial<WebResult>[] = [];
  try { picked = JSON.parse((text.match(/\[[\s\S]*\]/) || ['[]'])[0]); } catch { /* fall back to raw results */ }
  const out: WebResult[] = [];
  for (const p of picked) {
    const hit = found.find((f) => f.url === p.url);
    if (hit && !out.some((o) => o.url === hit.url)) out.push({ ...hit, title: p.title || hit.title, content: String(p.content || '') });
  }
  for (const f of found) if (!out.some((o) => o.url === f.url)) out.push(f);
  return out.slice(0, max);
}

/** fetch for outside websites: retries network errors, because Node reuses pooled connections the site has already
 * closed ("fetch failed: other side closed"). Each try gets its own timeout. */
/** Whether a URL points inside this machine or network (localhost, Docker host, private or link-local IPs). */
export function isInternalUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return true; }
  if (!/^https?:$/.test(u.protocol)) return true;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local') || !h.includes('.') && !h.includes(':')) return true;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return true;
  if (h === '::1' || /^(fc|fd|fe80)/.test(h)) return true;
  return false;
}

export async function fetchPage(url: string, init: RequestInit = {}, timeoutMs = 20000): Promise<Response> {
  // ponytail: checks the address as written, not where its DNS points; a resolver check would also stop DNS tricks.
  if (isInternalUrl(url)) throw new Error('That address is not allowed.');
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, { redirect: 'follow', ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      if (attempt >= 2 || (e as Error).name === 'TimeoutError') throw e;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; Grinder/1.0)', Accept: 'text/html,application/xhtml+xml' };

/** Reads a page as plain text (job postings). Keeps JobPosting JSON-LD descriptions, which many boards render only there. */
/** Reads a page through Claude's web_fetch tool (Anthropic's fetcher, identified as Claude). Used when a site refuses this
 * server's own request, e.g. firewalls that drop unknown clients. */
async function readViaClaude(url: string): Promise<string> {
  const res = await client().messages.create({
    model: SEARCH_MODEL, max_tokens: 8000,
    tools: [{ type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 1 }],
    messages: [{ role: 'user', content: `Fetch ${url} and reply with the page's main text content as plain text (keep any job titles, locations, closing dates and links). No commentary.` }],
  });
  declined(res.stop_reason);
  const text = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n').trim();
  if (!text) throw new Error('The page could not be read.');
  return text.slice(0, 60000);
}

/** Text of a PDF (e.g. a register published as a PDF), page by page, with the same pdf.js the resume upload uses. */
async function pdfText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // On the server pdf.js runs its worker in-process; loading the worker module here (instead of letting pdf.js look
  // for the file at run time) makes the bundler include it.
  // @ts-expect-error -- the worker module ships without type declarations
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker ??= await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 200); i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((x) => ('str' in x ? x.str + (x.hasEOL ? '\n' : ' ') : '')).join(''));
  }
  return pages.join('\n\n');
}

export async function extractPage(url: string): Promise<string> {
  const res = await fetchPage(url, { headers: UA }).catch(() => null);
  if (!res) return readViaClaude(url);
  if (!res.ok) throw new Error(`The page answered ${res.status}.`);
  if (/application\/pdf/i.test(res.headers.get('content-type') ?? '') || /\.pdf($|\?)/i.test(new URL(res.url || url).pathname)) return (await pdfText(await res.arrayBuffer())).slice(0, 120000);
  const html = await res.text();
  const ld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');
  const strip = (s: string) => s
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  let posting = '';
  try {
    for (const m of ld.matchAll(/"description"\s*:\s*("(?:[^"\\]|\\.)*")/g)) posting += `${strip(JSON.parse(m[1]!))}\n`;
  } catch { /* malformed JSON-LD */ }
  const body = strip(html);
  return (body.length < 500 && posting ? `${posting}\n${body}` : body).slice(0, 60000);
}

const PAGE_PARAM = /^(sf_)?paged?$|^pg$|^p$|^page_?(num|number|no)?$|^start$|^offset$/i;
/** Numbered pages of a listing ("Page 1 of 3": ?page=2, ?paged=2, ?sf_paged=2, /page/2/ ...) linked from its HTML. */
export function paginationLinks(html: string, pageUrl: string): string[] {
  const base = new URL(pageUrl);
  const found = new Map<string, number>();
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    let u: URL;
    try { u = new URL(m[1]!.replace(/&amp;/g, '&'), base); } catch { continue; }
    if (u.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue;
    const byPath = u.pathname.match(/^(.*)\/page\/(\d+)\/?$/);
    const param = [...u.searchParams].find(([k, v]) => PAGE_PARAM.test(k) && /^\d+$/.test(v));
    if (byPath && byPath[1]!.replace(/\/$/, '') === base.pathname.replace(/\/page\/\d+\/?$/, '').replace(/\/$/, '')) found.set(u.href, Number(byPath[2]));
    else if (param && u.pathname.replace(/\/$/, '') === base.pathname.replace(/\/$/, '')) found.set(u.href, Number(param[1]));
  }
  return [...found].filter(([, n]) => n > 1).sort((a, b) => a[1] - b[1]).map(([u]) => u);
}

/** Reads a listing and every numbered page after it (up to maxPages), as one text with a marker per page. Pages
 *  linked only from later pages are followed too. ponytail: numbered links only; "load more" buttons that fetch in
 *  the browser are not followed. */
export async function extractAllPages(url: string, maxPages = 10): Promise<string> {
  const queue = [url];
  const seen = new Set<string>();
  const parts: string[] = [];
  while (queue.length && seen.size < maxPages) {
    const u = queue.shift()!;
    if (seen.has(u)) continue;
    seen.add(u);
    if (seen.size > 1) await new Promise((r) => setTimeout(r, 1000)); // polite: about one page a second
    const res = await fetchPage(u, { headers: UA }).catch(() => null);
    if (!res?.ok) { if (seen.size === 1) return extractPage(url); continue; }
    const html = await res.text();
    for (const next of paginationLinks(html, res.url || u)) if (!seen.has(next) && !queue.includes(next)) queue.push(next);
    const text = await extractPage(u).catch(() => '');
    parts.push(seen.size === 1 ? text : `\n--- page ${seen.size} (${u}) ---\n${text}`);
  }
  return parts.join('\n').slice(0, 120000);
}

/** Same-site links of a page (careers site map fallback). ponytail: one page deep, not a crawler. */
export async function mapSite(url: string, limit = 120): Promise<string[]> {
  const res = await fetchPage(url, { headers: UA });
  if (!res.ok) return [];
  const base = new URL(res.url || url);
  const out = new Set<string>();
  for (const m of (await res.text()).matchAll(/href=["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1]!, base);
      if (u.hostname === base.hostname && out.size < limit) out.add(u.href);
    } catch { /* bad href */ }
  }
  return [...out];
}

/** Drop-in for the Tavily REST calls the app made: same paths, same response shape. */
export async function tavilyCompat(path: string, body: Record<string, unknown>): Promise<{ results: unknown[] }> {
  if (path === 'search') return { results: await webSearch(String(body['query']), Number(body['max_results'] || 5), body['include_domains'] as string[] | undefined) };
  if (path === 'extract') {
    const urls = (body['urls'] as string[]) || [];
    const results = await Promise.all(urls.map(async (url) => ({ url, raw_content: await extractPage(url).catch(() => '') })));
    return { results: results.filter((r) => r.raw_content) };
  }
  if (path === 'map') return { results: await mapSite(String(body['url']), Number(body['limit'] || 120)) };
  throw new Error(`Unknown research call: ${path}`);
}
