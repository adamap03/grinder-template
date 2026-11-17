// Adds firms read from one directory (a JSON file of { name, profile, website, phone, specialisms, town, size,
// postcode, description, address?, country? }) to the Notion "Directory firms" table, and the directory to
// "Discover sources".
//   node --experimental-strip-types import-source.ts <firms.json> "<source name>" "<source page url>" <sector> ["<description>"] [--relocate]
// <sector> is a key or label from src/lib/sectors.ts (the one list). country (England, Scotland, Wales, Northern
// Ireland, or anything else such as "Republic of Ireland") is a hint: places are only accepted in that UK nation, and
// firms outside the UK are kept but not placed on the (UK) map. Rules, so a run is always safe to repeat:
//  - a firm already listed (by any source or earlier in this file, same name or website) is skipped;
//  - a firm this source added before is not duplicated: its blank fields are filled, filled ones are never blanked;
//    --relocate also replaces the location of this source's firms (to repair a bad placement);
//  - every firm is located (postcode, outcode, each place named in its town e.g. "London and Portsmouth", else
//    OpenStreetMap for counties), only within its country, and the run lists any it could not place;
//  - careers pages are found afterwards by Discover's "Refresh ticked sectors" (or the sector's Sources pop-up).
import fs from 'node:fs';
import { sectorKeyOf, SECTORS } from '../../src/lib/sectors.ts';
import { firmKey as key, hostOf as host } from '../../src/lib/firm-key.ts';
import { locate, UK_NATIONS as UK } from '../../src/lib/locate.ts';
import { notion as n, queryAll as all, database, text, chunks } from '../lib/notion.ts';

type In = { name: string; profile?: string; website?: string; phone?: string; specialisms?: string; town?: string; size?: string; postcode?: string; description?: string; address?: string; country?: string };
const relocate = process.argv.includes('--relocate');
const [file, sourceName, sourceUrl, sectorArg, sourceDesc = ''] = process.argv.slice(2).filter((a) => a !== '--relocate');
const sector = sectorKeyOf(sectorArg ?? '');
if (!file || !sourceName || !sourceUrl || !sector) {
  console.error(`usage: node --experimental-strip-types import-source.ts <firms.json> "<name>" "<url>" <sector> ["<description>"] [--relocate]\nsectors: ${Object.keys(SECTORS).join(', ')}`);
  process.exit(1);
}
const FIRMS_DB = await database('Directory firms');
const SOURCES_DB = await database('Discover sources');
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);


const existing = await all(FIRMS_DB);
const byId = new Map(existing.map((p) => [text(p.properties.id), p]));
const firms = JSON.parse(fs.readFileSync(file, 'utf8')) as In[];
let added = 0, filled = 0;
const skipped: string[] = [], unplaced: string[] = [];
const LOCATION = ['town', 'postcode', 'nation', 'lat', 'lng'];
const prop = (k: string, v: string | number | null) => (k === 'name' ? { title: chunks(String(v ?? '')) } : k === 'listing_url' || k === 'website' ? { url: v || null } : k === 'lat' || k === 'lng' ? { number: v } : { rich_text: chunks(String(v ?? '')) });
for (const f of firms) {
  const id = `${slug(sourceName).slice(0, 30)}--${slug(f.name)}`;
  const mine = byId.get(id) ?? existing.find((p) => text(p.properties.source) === sourceName && key(text(p.properties.name)) === key(f.name));
  const others = existing.filter((p) => p !== mine);
  if (!mine && others.some((p) => key(text(p.properties.name)) === key(f.name) || (host(f.website ?? '') && host(p.properties.website?.url ?? '') === host(f.website ?? '')))) { skipped.push(f.name); continue; }
  const loc = await locate(f);
  if (loc.lat == null) unplaced.push(f.name);
  const values: Record<string, string | number | null> = {
    name: f.name, id, source: sourceName, listing_url: f.profile || sourceUrl, website: f.website || null, email: '', phone: f.phone ?? '', contact: '',
    description: f.description ?? '', address: f.address ?? '', ...loc, size: f.size ?? '', specialisms: f.specialisms ?? '', work_type: '', sector, crawled_at: new Date().toISOString(),
  };
  if (!mine) {
    await n('pages', { parent: { database_id: FIRMS_DB }, properties: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, prop(k, v)])) });
    existing.push({ properties: { id: { rich_text: chunks(id) }, name: { title: chunks(f.name) }, source: { rich_text: chunks(sourceName) }, website: { url: f.website || null } } });
    added++;
    continue;
  }
  // Already added by this source: fill only what is blank (and, with --relocate, replace the location).
  const blank = (k: string) => { const p = mine.properties[k]; return !p || (p.type === 'number' ? p.number == null : p.type === 'url' ? !p.url : !text(p)); };
  const patch = Object.fromEntries(Object.entries(values)
    .filter(([k, v]) => k !== 'crawled_at' && k !== 'id' && ((relocate && LOCATION.includes(k)) || (v !== '' && v != null && blank(k))))
    .map(([k, v]) => [k, prop(k, v)]));
  if (Object.keys(patch).length) { await n(`pages/${mine.id}`, { properties: patch }, 'PATCH'); filled++; }
}
const sources = await all(SOURCES_DB);
if (!sources.some((p) => p.properties.url?.url === sourceUrl)) {
  await n('pages', { parent: { database_id: SOURCES_DB }, properties: { name: { title: chunks(sourceName) }, id: { rich_text: chunks(crypto.randomUUID()) }, user_id: { rich_text: [] }, url: { url: sourceUrl }, description: { rich_text: chunks(sourceDesc) }, sector: { rich_text: chunks(sector) }, created_at: { rich_text: chunks(new Date().toISOString()) } } });
}
console.log(`sector: ${SECTORS[sector]} · read ${firms.length} · added ${added} · ${relocate ? 'updated' : 'blanks filled on'} ${filled} · skipped as already listed (same name or website) ${skipped.length}${skipped.length ? ` (${skipped.join(', ')})` : ''}`);
const abroad = firms.filter((f) => f.country && !UK.includes(f.country)).map((f) => f.name);
if (abroad.length) console.log(`outside the UK (kept, not on the UK map): ${abroad.join(', ')}`);
const lost = unplaced.filter((x) => !abroad.includes(x));
if (lost.length) console.log(`NOT PLACED ON THE MAP (no place found in its country): ${lost.join(', ')}`);
