// node --test 'test/unit/*.test.mjs'
// Measures on a resume document (extension/generation/resumeDoc.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keywordCoverage, docWords, extraText, dateValue, newestFirst } from '../../extension/generation/resumeDoc.js';

const doc = {
  summary: 'Backend engineer',
  skillGroups: [{ label: 'Tools', items: ['Go', 'Docker'] }],
  experiences: [{ title: 'Engineer', bullets: ['Deployed services to Kubernetes'] }],
  projects: [], education: [], extras: [{ title: 'CKA', organization: 'CNCF', end: '2023' }]
};
const match = { keywords: [
  { term: 'Kubernetes', importance: 'core' }, { term: 'Terraform', importance: 'core' },
  { term: 'Go', importance: 'core' }, { term: 'teamwork', importance: 'supporting' }
] };

test('keyword coverage counts whole core terms in the document', () => {
  assert.deepEqual(keywordCoverage(doc, match), { found: 2, total: 3, missing: ['Terraform'] });
  assert.equal(keywordCoverage({ ...doc, skillGroups: [{ items: ['Google'] }] }, { keywords: ['Go'] }).found, 0, '"Go" is not in "Google"');
});

test('extras read as one line; words are counted', () => {
  assert.equal(extraText(doc.extras[0]), 'CKA – CNCF (2023)');
  assert.equal(docWords(doc), 13);
});

test('dates order jobs newest first, whatever the profile order', () => {
  assert.equal(dateValue('Present'), Infinity);
  assert.ok(dateValue('Feb 2026') > dateValue('Jan 2026') && dateValue('02/2026') === dateValue('Feb 2026'));
  assert.ok(dateValue('2025') > dateValue('Mar 2025'), 'a bare year ends in December');
  assert.equal(dateValue('sometime'), null);
  const jobs = [
    { id: 'outlier', start: 'Oct 2024', end: 'Mar 2025' },
    { id: 'bear', start: 'Feb 2026', end: 'Jul 2026' },
    { id: 'now', start: 'Aug 2026', end: 'Present' },
    { id: 'old', start: '2019', end: '2021' }
  ];
  assert.deepEqual(newestFirst(jobs).map(j => j.id), ['now', 'bear', 'outlier', 'old']);
  assert.deepEqual(newestFirst([{ id: 'a', end: '?' }, { id: 'b', end: '?' }]).map(j => j.id), ['a', 'b'], 'unreadable dates keep their order');
});
