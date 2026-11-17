// RICS Find a Surveyor (ricsfirms.com): paste into the browser console on each results page (&page=1, 2, ...).
// RICS builds its list in the browser, so the app's reader sees nothing; this reads the drawn cards. Results add up
// in sessionStorage "rics" (one entry per firm name; offices of one firm are merged), tagged with sessionStorage
// "ricsTag" (e.g. "Planning process"). Then save JSON.parse(sessionStorage.rics) with receive.mjs and run
// import-source.ts with sector "surveyor".
(async () => {
  let last = -1, same = 0;
  for (let t = 0; t < 40 && same < 3; t++) { await new Promise((r) => setTimeout(r, 500)); const n = document.querySelectorAll('div.card-search h2').length; same = n === last && n > 0 ? same + 1 : 0; last = n; }
  const acc = JSON.parse(sessionStorage.getItem('rics') || '[]');
  const tag = sessionStorage.getItem('ricsTag') || '';
  for (const c of document.querySelectorAll('div.card-search')) {
    const addr = (c.querySelector('.search-item__address')?.textContent || '').replace(/\s+/g, ' ').trim();
    const pc = addr.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i)?.[1]?.toUpperCase() || '';
    const parts = addr.replace(/We serve [^.]+\.\s*/, '').split(',').map((s) => s.trim()).filter((s) => s && !/office$/i.test(s) && s !== pc);
    // Town: "Based in X", else from the address, else the area it says it serves ("We serve all of Worcestershire").
    const town = addr.match(/Based in ([^.]+)/)?.[1] || (pc ? parts.slice(-2, -1)[0] : parts.at(-1)) || addr.match(/We serve (?:all of )?([^.]+)/)?.[1] || '';
    const f = { name: c.querySelector('h2')?.textContent.trim(), profile: c.querySelector('a#office-page')?.href || '', website: c.querySelector('a.card-search__action--web')?.getAttribute('href') || '',
      phone: (c.querySelector('a[href^="tel:"]')?.getAttribute('href') || '').slice(4), town, postcode: pc, address: addr,
      description: (c.querySelector('.search-item__about')?.textContent || '').replace(/\s+/g, ' ').trim(), specialisms: tag, size: '', country: '' };
    if (!f.name) continue;
    const old = acc.find((x) => x.name === f.name);
    if (old) { if (tag && !old.specialisms.includes(tag)) old.specialisms += `, ${tag}`; continue; }
    acc.push(f);
  }
  sessionStorage.setItem('rics', JSON.stringify(acc));
  return `cards ${last}, total ${acc.length}`;
})();
