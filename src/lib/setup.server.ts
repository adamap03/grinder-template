// First-run setup. Settings come from the environment (.env.napi) or, for a fresh copy, from DATA_DIR/settings.json,
// which the setup page writes. Environment values always win. Until Notion is connected every page shows the setup
// page; once connected, the setup endpoint refuses changes (to reconnect, edit the settings file and restart).
import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { clientKey, hit } from './rate-limit';
import { SETUP_PAGE } from './setup-page';

const DIR = process.env['DATA_DIR'] || path.resolve('data');
const FILE = path.join(DIR, 'settings.json');
const KEYS = ['NOTION_TOKEN', 'NOTION_PAGE_ID', 'ANTHROPIC_API_KEY', 'AUTH_SECRET'] as const;
type Saved = Partial<Record<(typeof KEYS)[number], string>>;

function readSaved(): Saved {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) as Saved; } catch { return {}; }
}
function writeSaved(s: Saved) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
}

// Load saved settings into process.env at startup (the rest of the app reads process.env).
const saved = readSaved();
if (!process.env['AUTH_SECRET'] && !saved.AUTH_SECRET) {
  saved.AUTH_SECRET = randomBytes(32).toString('hex'); // signs sign-in tokens; kept so sessions survive restarts
  try { writeSaved(saved); } catch (e) { console.warn(`[setup] could not save settings in ${DIR}: ${(e as Error).message}`); }
}
for (const k of KEYS) if (!process.env[k] && saved[k]) process.env[k] = saved[k];

export const configured = () => !!(process.env['NOTION_TOKEN'] && process.env['NOTION_PAGE_ID']);

// One-time code shown in the server log, so only whoever runs the server can connect it (matters when a fresh copy
// is reachable by others before it is set up). A new code on every start.
const CODE = randomBytes(4).toString('hex').toUpperCase();
if (!configured()) console.log(`\n[setup] Notion is not connected yet. Open the app in your browser and enter this setup code: ${CODE}\n`);

const state = { ready: false, error: '' };

/** The 32-character page id from a Notion page link (or a bare id, with or without dashes). */
export function pageIdOf(input: string): string | null {
  const m = input.trim().split(/[?#]/)[0]!.replace(/-/g, '').match(/[0-9a-f]{32}$/i);
  return m ? m[0].toLowerCase() : null;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

async function connect(request: Request): Promise<Response> {
  if (configured()) return json({ error: `Already connected. To use a different Notion page, change NOTION_TOKEN and NOTION_PAGE_ID (in .env.napi or ${FILE}) and restart.` }, 409);
  if (!hit(`setup:${clientKey(request)}`, 10, 15 * 60_000)) return json({ error: 'Too many attempts. Please wait 15 minutes and try again.' }, 429);
  const b = (await request.json().catch(() => null)) as { code?: unknown; token?: unknown; page?: unknown; anthropic?: unknown } | null;
  const code = String(b?.code ?? '').trim().toUpperCase();
  if (code.length !== CODE.length || !timingSafeEqual(Buffer.from(code), Buffer.from(CODE)))
    return json({ error: 'That setup code is not right. It is in the server log, and changes each time the server restarts.' }, 403);
  const token = String(b?.token ?? '').trim();
  if (!/^(ntn_|secret_)[A-Za-z0-9]{20,}$/.test(token)) return json({ error: 'That does not look like a Notion integration secret (it starts with ntn_).' }, 400);
  const page = pageIdOf(String(b?.page ?? ''));
  if (!page) return json({ error: 'Paste the link of the Notion page (Share, then Copy link).' }, 400);
  const anthropic = String(b?.anthropic ?? '').trim();
  if (anthropic && !/^sk-ant-[\w-]{20,}$/.test(anthropic)) return json({ error: 'That does not look like a Claude API key (it starts with sk-ant-).' }, 400);

  const r = await fetch(`https://api.notion.com/v1/pages/${page}`, {
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' }, signal: AbortSignal.timeout(20000),
  }).catch(() => null);
  if (!r) return json({ error: 'Could not reach Notion. Check the internet connection and try again.' }, 502);
  if (r.status === 401) return json({ error: 'Notion did not accept that secret. Copy it again from the integration page.' }, 400);
  if (r.status === 404 || r.status === 400) return json({ error: 'Notion cannot see that page yet. Open the page in Notion, choose ••• then Connections, add your integration, and try again.' }, 400);
  if (!r.ok) return json({ error: `Notion answered ${r.status}. Try again in a minute.` }, 502);
  if (anthropic) {
    const a = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': anthropic, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(20000),
    }).catch(() => null);
    if (a?.status === 401) return json({ error: 'Anthropic did not accept that Claude API key.' }, 400);
  }

  const next = { ...readSaved(), NOTION_TOKEN: token, NOTION_PAGE_ID: page, ...(anthropic ? { ANTHROPIC_API_KEY: anthropic } : {}) };
  try { writeSaved(next); } catch (e) { return json({ error: `Could not save the settings in ${DIR}: ${(e as Error).message}` }, 500); }
  process.env['NOTION_TOKEN'] = token;
  process.env['NOTION_PAGE_ID'] = page;
  if (anthropic && !process.env['ANTHROPIC_API_KEY']) process.env['ANTHROPIC_API_KEY'] = anthropic;
  // Create the tables in the background (about a minute); the setup page polls GET /api/setup.
  state.ready = false; state.error = '';
  import('./notion-db.server').then((m) => m.warmUp()).then(() => { state.ready = true; }, (e: Error) => { state.error = e.message.slice(0, 300); });
  return json({ ok: true });
}

/** Answers setup requests and, while Notion is not connected, every page. null = carry on with the app. */
export async function setupResponse(request: Request): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (pathname === '/api/setup') {
    if (request.method === 'GET') return json({ configured: configured(), ready: state.ready, error: state.error });
    if (request.method === 'POST') return connect(request);
    return json({ error: 'Method not allowed' }, 405);
  }
  if (configured()) return null;
  if (pathname.startsWith('/api/') || pathname.startsWith('/_serverFn'))
    return json({ data: null, error: { message: 'Grinder is not connected to Notion yet. Open the app to set it up.' } }, 503);
  if (request.method === 'GET' && (request.headers.get('accept') ?? '').includes('text/html'))
    return new Response(SETUP_PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  return null; // scripts, styles, icons
}
