// node --test 'test/unit/*.test.mjs'
// Measures on a resume document (extension/generation/resumeDoc.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keywordCoverage, docWords, extraText } from '../../extension/generation/resumeDoc.js';

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
