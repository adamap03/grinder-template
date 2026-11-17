# Adding a directory's firms (run by hand)

Discover is a compiled list of firms, not a live scrape. Each **source** belongs to one **sector** (`src/lib/sectors.ts`).
The app reads ordinary web pages and PDFs itself: add the source in that sector's Sources pop-up and press
*Read … sources now* (or *Refresh ticked sectors*). Use the steps below only when the app can't read a source:
the site blocks automated readers (403), or it builds its list in the browser (e.g. RICS). Never use services that
defeat a site's bot protection.

All scripts read `NOTION_TOKEN` and `NOTION_PAGE_ID` from `.env.napi` and find tables by name (`scripts/lib/notion.ts`).

## 1. Read the firms in a normal browser tab

Read the source page and every numbered page after it ("1 of 3" means all 3), plus each firm's own profile page
when the website or postcode is only there. Produce a JSON array of:

    { name, website, town, postcode, phone, description, specialisms, size, profile, address?, country? }

`country` (England, Scotland, Wales, Northern Ireland, or e.g. "Republic of Ireland") stops a place being matched in
the wrong country. Ready-made readers:

- `rics-page.js`: paste into the console on each RICS Find a Surveyor results page (`&page=1`, `2`, ...).
- `care-register.mjs`: turns the ICE CARE register PDF into firms JSON (`node scripts/directory-import/care-register.mjs <pdf> <out.json>`).

To get the JSON out of the browser: run `node receive.mjs` in an empty folder with a `fae/` subfolder, set
`window.name = JSON.stringify(firms)` in the tab, then open http://127.0.0.1:8798/ in that tab; it saves `fae/part-0.json`.

## 2. Import

    node --experimental-strip-types scripts/directory-import/import-source.ts firms.json "<source name>" "<page url>" <sector> ["<description>"] [--relocate]

It skips firms already listed (same name via `src/lib/firm-key.ts`, or same website), fills blanks but never blanks
saved fields on firms this source added before, locates every firm with `src/lib/locate.ts` and prints any it could
not place, and adds the page to Discover sources. Safe to re-run; `--relocate` replaces this source's locations.

## 3. Careers pages

Press *Refresh ticked sectors* in Discover (or the sector's Read button): it finds each new firm's careers page.

Check afterwards: `node --experimental-strip-types scripts/check-directory-duplicates.ts` should print 0 duplicates.
