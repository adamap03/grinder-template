// Fallback for when ice.org.uk blocks the app (403): turns the ICE CARE register PDF into firms JSON for import-source.ts.
// node scripts/directory-import/care-register.mjs <care.pdf> <firms.json>   (run from the repo root, needs pdfjs-dist)
// Region codes give each firm's country (RIre = Republic of Ireland: kept, not on the UK map).
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'node:fs';
const [pdfPath, outPath] = process.argv.slice(2);
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)) }).promise;
const col = (x) => (x < 120 ? 'surname' : x < 190 ? 'first' : x < 320 ? 'quals' : x < 465 ? 'company' : x < 555 ? 'base' : x < 590 ? 'region' : 'email');
const people = [];
for (let n = 1; n <= doc.numPages; n++) {
  const all = (await (await doc.getPage(n)).getTextContent()).items.filter((i) => i.str.trim());
  if (!all.some((i) => i.str.trim() === 'SURNAME')) continue;
  const items = all.filter((i) => i.transform[5] < 470 && i.transform[5] > 60);
  const hasFirst = (y) => items.some((j) => col(j.transform[4]) === 'first' && Math.abs(j.transform[5] - y) <= 3);
  const starts = [...new Set(items.filter((i) => col(i.transform[4]) === 'surname' && /^[A-Z]{2,}/.test(i.str.trim()) && hasFirst(i.transform[5])).map((i) => Math.round(i.transform[5])))].sort((a, b) => b - a);
  const rows = starts.map(() => ({ surname: [], first: [], quals: [], company: [], base: [], region: [], email: [] }));
  for (const it of items.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4])) {
    const y = it.transform[5];
    const r = starts.findIndex((s, i) => y <= s + 6 && (i === starts.length - 1 || y > starts[i + 1] + 6));
    if (r >= 0) rows[r][col(it.transform[4])].push(it.str.trim());
  }
  for (const r of rows) people.push(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === 'email' ? v.join('') : v.join(' ').replace(/- /g, '-')])));
}
const WEBMAIL = /@(gmail|googlemail|hotmail|outlook|live|yahoo|btinternet|icloud|me|aol|sky|talktalk|virginmedia|ntlworld|msn|mail)\./i;
const NOT_FIRM = /^(consultant|retired.*|self[- ]?employed|independent|freelance|sole trader|n\/?a|-)$/i;
const firms = new Map();
for (const p of people) {
  const company = p.company.replace(/(\s+\d+)+$/, '').replace(/\s+/g, ' ').replace(/\.$/, '').trim();
  if (!company || NOT_FIRM.test(company)) continue;
  const k = company.toLowerCase().replace(/\b(ltd|limited|llp)\b\.?/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const email = p.email.replace(/\s+/g, '');
  const domain = !WEBMAIL.test(email) && /@/.test(email) ? email.split('@')[1].toLowerCase() : '';
  const base = p.base.replace(/\.$/, '').trim();
  const f = firms.get(k) ?? { name: company, website: '', town: base, region: p.region, bases: new Set(), count: 0 };
  if (!f.website && domain) f.website = `https://${domain}`;
  if (base) f.bases.add(base);
  if (!f.town) f.town = base;
  f.count++;
  firms.set(k, f);
}
const out = [...firms.values()].map((f) => ({
  name: f.name, profile: '', website: f.website, phone: '', town: f.town, postcode: '', size: '', region: f.region,
  country: /^RIre/i.test(f.region) ? 'Republic of Ireland' : /^NIre/i.test(f.region) ? 'Northern Ireland' : /^Sco/i.test(f.region) ? 'Scotland' : /^Wal/i.test(f.region) ? 'Wales' : f.region ? 'England' : '',
  specialisms: 'Conservation accredited engineering (CARE)',
  description: `${f.count} Conservation Accredited Engineer${f.count > 1 ? 's' : ''} on the ICE CARE register${f.bases.size > 1 ? `, based in ${[...f.bases].join(', ')}` : ''}.`,
}));
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(`people ${people.length}, companies ${out.length}`);
console.log(out.map((f) => `${f.name} | ${f.town} | ${f.region} | ${f.website || '-'}`).join('\n'));
