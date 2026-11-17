// The one way a firm gets a place on the map, used by source reads, firms added on the Shortlist and the import script
// (scripts/directory-import/import-source.ts). Postcode first, then each place named in the town text ("London and
// Portsmouth", "Glasgow/ Edinburgh", "SS17", "London SE1"), then OpenStreetMap for counties ("Essex"). A nation name
// on its own ("Scotland") gives the nation, never a same-named village. A country hint limits matches to that UK
// nation; anything outside the UK is kept but not placed on the (UK) map.
export type Loc = { town: string; postcode: string; nation: string; lat: number | null; lng: number | null };
export const UK_NATIONS = ['England', 'Scotland', 'Wales', 'Northern Ireland'];

const get = async (url: string, headers: Record<string, string> = {}) => fetch(url, { headers, signal: AbortSignal.timeout(15000) }).then((r) => r.json()).catch(() => null);
const OSM_UA = { 'User-Agent': 'Grinder-locate/1.0 (personal job-search app)' };
const nationOf = (text: string) => UK_NATIONS.find((n) => n.toLowerCase() === text.trim().toLowerCase().replace(/^the\s+/, '').replace(/,?\s*uk$/, '')) ?? null;

export async function locate(input: { town?: string | null; postcode?: string | null; country?: string | null }): Promise<Loc> {
  const town = (input.town ?? '').trim();
  const country = (input.country ?? '').trim() || nationOf(town) || '';
  // Outside the UK: keep the firm, but never guess a UK place with the same name (Dublin, Suffolk).
  if (country && !UK_NATIONS.includes(country)) return { town, postcode: '', nation: country, lat: null, lng: null };
  // Only a nation ("Scotland"): the nation is the location; the map area comes from it.
  if (nationOf(town)) return { town, postcode: '', nation: country, lat: null, lng: null };
  const ok = (nation: string) => !country || nation === country;
  const pc = (input.postcode ?? '').trim().toUpperCase();
  if (pc) {
    const r = (await get(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`))?.result;
    if (r && ok(r.country)) return { town: r.admin_district || town, postcode: r.postcode, nation: r.country, lat: r.latitude, lng: r.longitude };
  }
  const tries = [town, ...town.split(/\/|&|,|\band\b/i).map((x) => x.trim()).filter((x) => x.length > 1 && x !== town)];
  for (const place of tries) {
    if (nationOf(place)) continue;
    // An outcode on its own ("SS17") or at the end ("London SE1").
    const oc = place.match(/\b([A-Z]{1,2}\d[A-Z\d]?)$/i)?.[1];
    if (oc) {
      const r = (await get(`https://api.postcodes.io/outcodes/${encodeURIComponent(oc)}`))?.result;
      if (r && ok(r.country?.[0] ?? '')) return { town: /^[A-Z]{1,2}\d/i.test(place) ? (r.admin_district?.[0] ?? place) : place, postcode: r.outcode, nation: r.country?.[0] ?? '', lat: r.latitude, lng: r.longitude };
    }
    const hits = ((await get(`https://api.postcodes.io/places?q=${encodeURIComponent(place)}&limit=10`))?.result ?? []) as { name_1: string; country: string; outcode?: string; latitude: number; longitude: number }[];
    const hit = hits.find((h) => ok(h.country) && h.name_1.toLowerCase() === place.toLowerCase()) ?? hits.find((h) => ok(h.country));
    if (hit) return { town, postcode: hit.outcode ?? '', nation: hit.country, lat: hit.latitude, lng: hit.longitude };
    // Counties and other areas postcodes.io doesn't know: OpenStreetMap's geocoder (about 1 request a second).
    await new Promise((r) => setTimeout(r, 1100));
    const osm = (await get(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=gb&q=${encodeURIComponent(country ? `${place}, ${country}` : place)}`, OSM_UA))?.[0];
    const nation = osm ? (String(osm.display_name).match(/England|Scotland|Wales|Northern Ireland/) ?? [''])[0]! : '';
    if (osm && ok(nation)) return { town, postcode: '', nation, lat: Number(osm.lat), lng: Number(osm.lon) };
  }
  return { town, postcode: pc, nation: country, lat: null, lng: null };
}
