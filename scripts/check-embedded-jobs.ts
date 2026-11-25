// Self-check for src/lib/embedded-jobs.ts (job listings carried as data in a careers page's HTML).
// Run: node --experimental-strip-types scripts/check-embedded-jobs.ts [saved-page.html]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { embeddedJobs } from '../src/lib/embedded-jobs.ts';

const ld = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"JobPosting","title":"Graduate Engineer","url":"/jobs/12","validThrough":"2026-12-31T00:00","jobLocation":{"@type":"Place","address":{"addressLocality":"Glasgow"}}}]}</script>`;
assert.deepEqual(embeddedJobs(ld, 'https://firm.example/careers'), [{ title: 'Graduate Engineer', location: 'Glasgow', url: 'https://firm.example/jobs/12', closing_date: '2026-12-31', summary: '' }]);

const dayforce = `{"Title": "GIS Analyst \u0026 Developer", "Description": "\u003Cp\u003ELong text\u003C/p\u003E", "JobDetailsUrl": "https://jobs.dayforcehcm.com/en-GB/x/Y/jobs/1", "City": "Aylesbury", "State": "England"},
{"Title": "Account Manager", "Description": "", "JobDetailsUrl": "https://jobs.dayforcehcm.com/en-GB/x/Y/jobs/2", "City": "Edinburgh"},
{"Title": "Account Manager", "Description": "", "JobDetailsUrl": "https://jobs.dayforcehcm.com/en-GB/x/Y/jobs/2"}`;
const d = embeddedJobs(dayforce, 'https://firm.example');
assert.deepEqual(d.map((j) => [j.title, j.location, j.url.slice(-6)]), [['GIS Analyst & Developer', 'Aylesbury, England', 'jobs/1'], ['Account Manager', 'Edinburgh', 'jobs/2']]);
assert.deepEqual(embeddedJobs('<p>No data here</p>', 'https://firm.example'), []);

// Optional: a saved real page, e.g. Esri UK's vacancies page.
if (process.argv[2]) { const j = embeddedJobs(fs.readFileSync(process.argv[2], 'utf8'), 'https://www.esriuk.com/'); console.log(j.length, 'jobs:', j.slice(0, 5).map((x) => `${x.title} (${x.location})`).join('; ')); }
console.log('embedded jobs: ok');
