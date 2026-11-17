// Lists firms that appear under more than one source (same name key or website) in the Notion "Directory firms"
// table; offices of one firm within one source are expected and not listed. Should print 0.
// Run: node --experimental-strip-types scripts/check-directory-duplicates.ts
import { firmKey, hostOf } from '../src/lib/firm-key.ts';
import { database, queryAll, text } from './lib/notion.ts';

const rows = await queryAll(await database('Directory firms'));
const firms = rows.map((p) => ({ name: text(p.properties.name), source: text(p.properties.source), site: hostOf(p.properties.website?.url ?? '') }));
const groups = new Map<string, typeof firms>();
for (const f of firms) for (const k of [`n:${firmKey(f.name)}`, f.site ? `s:${f.site}` : '']) if (k) groups.set(k, [...(groups.get(k) ?? []), f]);
const dup = [...groups.entries()].filter(([, g]) => new Set(g.map((f) => f.source)).size > 1);
console.log(`${rows.length} rows, ${dup.length} cross-source duplicates`);
for (const [k, g] of dup) console.log(`  ${k}: ${g.map((f) => `${f.name} [${f.source}]`).join(' | ')}`);
