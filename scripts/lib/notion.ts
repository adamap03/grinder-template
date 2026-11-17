// Notion access for the scripts in scripts/ (run with `node --experimental-strip-types`). Reads NOTION_TOKEN and
// NOTION_PAGE_ID from .env.napi at the repo root and finds tables by their title under that page and its section
// sub-pages, the same way the app does (src/lib/notion-db.server.ts), so no database ids are written into scripts.
import fs from 'node:fs';

const env = fs.readFileSync(new URL('../../.env.napi', import.meta.url), 'utf8');
const read = (k: string) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim() ?? '';
const TOKEN = read('NOTION_TOKEN');
const PAGE = read('NOTION_PAGE_ID');
if (!TOKEN || !PAGE) throw new Error('.env.napi needs NOTION_TOKEN and NOTION_PAGE_ID');

/** One Notion API call, paced and retried on rate limits and server errors. */
export async function notion(path: string, body?: unknown, method = body ? 'POST' : 'GET'): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    await new Promise((r) => setTimeout(r, 400));
    const r = await fetch(`https://api.notion.com/v1/${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (r.ok) return r.json();
    if (attempt < 30 && (r.status === 429 || r.status >= 500)) { await new Promise((x) => setTimeout(x, 4000)); continue; }
    throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
  }
}

/** Every row of a database. */
export async function queryAll(databaseId: string, filter?: unknown): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined;
  do {
    const r = await notion(`databases/${databaseId}/query`, { page_size: 100, ...(filter ? { filter } : {}), ...(cursor ? { start_cursor: cursor } : {}) });
    out.push(...r.results);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return out;
}

let found: Record<string, string> | null = null;
/** The id of the table with this title (e.g. "Directory firms"), under NOTION_PAGE_ID or one of its section pages. */
export async function database(title: string): Promise<string> {
  if (!found) {
    found = {};
    const scan = async (parent: string, depth: number) => {
      let cursor: string | undefined;
      do {
        const r = await notion(`blocks/${parent}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
        for (const b of r.results) {
          if (b.type === 'child_database' && !found![b.child_database.title]) found![b.child_database.title] = b.id;
          if (b.type === 'child_page' && depth < 1) await scan(b.id, depth + 1);
        }
        cursor = r.has_more ? r.next_cursor : undefined;
      } while (cursor);
    };
    await scan(PAGE, 0);
  }
  const id = found[title];
  if (!id) throw new Error(`No "${title}" table under NOTION_PAGE_ID (open the app once so it creates its tables).`);
  return id;
}

/** Plain text of a title or rich-text property. */
export const text = (p: any): string => (p?.title ?? p?.rich_text ?? []).map((x: any) => x.plain_text).join('');
/** Rich-text value in Notion's 2,000-character pieces. */
export const chunks = (s: string) => { const out = []; for (let i = 0; i < s.length && out.length < 50; i += 1900) out.push({ type: 'text', text: { content: s.slice(i, i + 1900) } }); return out; };
