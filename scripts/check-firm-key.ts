// Self-check for firm matching: node --experimental-strip-types scripts/check-firm-key.ts
import assert from 'node:assert/strict';
import { firmKey, hostOf } from '../src/lib/firm-key.ts';
const same = [['G GC Robertson & Associates', 'GC Robertson & Associates'], ['Anthony P Davies Associates', 'Anthony Davies Associates'], ['B Bayne Stevenson Associates', 'Bayne Stevenson Associates'],
  ['Tweddell & Slater', 'Tweddell and Slater Ltd'], ['Alan Baxter Partnership LLP', 'alan baxter partnership'], ['CRA (Edinburgh)', 'CRA Edinburgh']];
for (const [a, b] of same) assert.equal(firmKey(a!), firmKey(b!), `${a} = ${b}`);
assert.notEqual(firmKey('Doran Consulting'), firmKey('Goodson Associates'));
assert.equal(hostOf('https://www.willrudd.com/'), 'willrudd.com');
console.log('firm-key ok');
import { sameFirm } from '../src/lib/firm-key.ts';
assert.ok(sameFirm('Narro', 'Narro Associates'));
assert.ok(sameFirm('price and myers', 'Price & Myers LLP'));
assert.ok(!sameFirm('Arup', 'Arupa Design'));
assert.ok(!sameFirm('AB', 'AB Design Solutions'), 'too short to match by prefix');
console.log('sameFirm ok');
