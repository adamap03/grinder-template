// Self-check for the shared sector list: run with `node --experimental-strip-types scripts/check-sectors.ts`.
import assert from 'node:assert/strict';
import { SECTOR_LIST, SECTOR_KEYS, sectorKeyOf } from '../src/lib/sectors.ts';

assert.equal(new Set(SECTOR_KEYS).size, SECTOR_KEYS.length, 'sector keys must be unique');
assert.equal(new Set(SECTOR_LIST.map((s) => s.label)).size, SECTOR_LIST.length, 'sector labels must be unique');
// Older Shortlist tag names and every key/label resolve to a sector.
for (const [tag, key] of [['Engineering', 'engineering'], ['GIS & LiDAR', 'gis'], ['Town/urban planning', 'planning'], ['Landscape architecture', 'planning'],
  ['Humanitarian', 'humanitarian'], ['Conservation', 'conservation'], ['Forestry', 'forestry'], ['Surveyors', 'surveyor'], ['misc', 'misc']] as const) assert.equal(sectorKeyOf(tag), key, tag);
for (const s of SECTOR_LIST) { assert.equal(sectorKeyOf(s.key), s.key); assert.equal(sectorKeyOf(s.label), s.key); }
assert.equal(sectorKeyOf('Unknown thing'), null);
console.log(`sectors ok (${SECTOR_KEYS.length})`);
