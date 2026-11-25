// Self-check for the Shortlist "Updates" rule (src/lib/job-updates.server.ts): what counts as a new posting.
// Run: node --experimental-strip-types scripts/check-job-updates.ts
import assert from 'node:assert/strict';
import { isBaseline, mergePostings } from '../src/lib/job-updates.server.ts';

const p = (title: string, url = '') => ({ title, location: 'Edinburgh', url, closing_date: '', summary: '' });
const NOW = '2026-11-25T10:00:00.000Z';

// A firm's first successful read only sets the baseline: nothing is new.
assert.deepEqual(mergePostings(null, [p('Trainee')], true, NOW).map((v) => v.first_seen), ['']);
// Later reads: a posting not seen before is new; known ones keep their first_seen (matched by link, then title).
const before = [{ ...p('Site engineer', 'https://jobs.example/1?ref=x'), first_seen: '' }, { ...p('Planner'), first_seen: '2026-11-20T00:00:00.000Z' }];
const after = mergePostings(before, [p('Site engineer', 'https://jobs.example/1/'), p('Planner'), p('Digital documentation trainee', 'https://jobs.example/9')], false, NOW);
assert.deepEqual(after.map((v) => v.first_seen), ['', '2026-11-20T00:00:00.000Z', NOW]);
// A board that had no vacancies before (read, empty) still reports its first new posting.
assert.equal(mergePostings([], [p('Trainee')], false, NOW)[0]!.first_seen, NOW);
// Baseline reads: never read before, or a list saved before Updates existed (no first_seen at all).
assert.equal(isBaseline(null, null), true);
assert.equal(isBaseline(3, [p('Old')]), true);
assert.equal(isBaseline(3, before), false);
assert.equal(isBaseline(0, []), false); // read before and empty: its first posting is news
console.log('job updates: ok');
