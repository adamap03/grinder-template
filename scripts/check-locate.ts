// Self-check for the shared locator (calls postcodes.io): node --experimental-strip-types scripts/check-locate.ts
import assert from 'node:assert/strict';
import { locate } from '../src/lib/locate.ts';
const sco = await locate({ town: 'Scotland' });
assert.equal(sco.nation, 'Scotland'); assert.equal(sco.lat, null, '"Scotland" is the nation, not a village in Leeds');
const dub = await locate({ town: 'Dublin', country: 'Republic of Ireland' });
assert.equal(dub.lat, null, 'outside the UK: not placed');
const hb = await locate({ town: 'Hillsborough', country: 'Northern Ireland' });
assert.equal(hb.nation, 'Northern Ireland');
const two = await locate({ town: 'London and Portsmouth' });
assert.ok(two.lat != null && two.nation === 'England');
const oc = await locate({ town: 'SS17' });
assert.equal(oc.postcode, 'SS17');
console.log('locate ok');
