// node --test 'test/unit/*.test.mjs'
// Preview highlights (extension/generation/highlight.js): the new words of
// each composed line, with its profile source on hover; a clean copy for the PDF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffWords, escapeHtml, previewResumes } from '../../extension/generation/highlight.js';

test('diffWords marks only the inserted words, in one span per run', () => {
  assert.equal(
    diffWords('Led migration of 12 services', 'Led Kubernetes upgrade and migration of 12 services'),
    'Led <span class="rs-added">Kubernetes upgrade and</span> migration of 12 services'
  );
  assert.equal(diffWords('Same line', 'Same line'), 'Same line');
});

test('everything is escaped, marked or not', () => {
  assert.equal(escapeHtml('<b>"R&D"</b>'), '&lt;b&gt;&quot;R&amp;D&quot;&lt;/b&gt;');
  assert.equal(diffWords('a', 'a <img>'), 'a <span class="rs-added">&lt;img&gt;</span>');
});

const doc = {
  name: 'Dana', summary: 'Backend engineer building Go services',
  skillGroups: [{ id: 'skills:1', label: 'Tools', items: ['Postgres', '<Docker>'] }],
  education: [{ id: 'edu:1', institution: 'UT', degreeType: 'B.S.' }],
  experiences: [{ id: 'exp:1', title: 'Engineer', company: 'Acme', bullets: ['Built billing API in Go on Kubernetes', 'Wrote <script> docs'], bulletIds: ['exp:1.c1', 'exp:1.c2'] }],
  projects: [{ id: 'proj:1', name: 'Pantry', bullets: ['Parsed units'], bulletIds: ['proj:1.c1'] }],
  extras: [{ id: 'extra:1', title: 'Hackathon winner' }]
};
const changes = [
  { id: 'summary', op: 'rewrite', before: 'Backend engineer.', after: doc.summary, from: true },
  { id: 'exp:1.c1', op: 'rewrite', before: 'Built billing API in Go', after: doc.experiences[0].bullets[0], from: true }
];

test('marked shows the new words with their source; clean has no marks', () => {
  const { marked, clean } = previewResumes(doc, changes);
  assert.equal(marked.experience[0].bullets[0], 'Built billing API in Go <span class="rs-added" title="From your profile: Built billing API in Go">on Kubernetes</span>');
  assert.match(marked.summary, /Backend engineer <span class="rs-added" title="From your profile: Backend engineer.">building Go services<\/span>/);
  assert.equal(marked.experience[0].bullets[1], 'Wrote &lt;script&gt; docs', 'unchanged lines are escaped, not marked');
  assert.ok(!JSON.stringify(clean).includes('rs-added'));
  assert.equal(clean.experience[0].bullets[0], 'Built billing API in Go on Kubernetes');
  assert.ok(JSON.stringify(marked).includes('&lt;Docker&gt;'), 'skills are escaped');
});

test('resumes saved by the old edit-list engine still render', () => {
  const old = [
    { id: 'exp:1.c1', op: 'rewrite', before: 'Built billing API in Go', reason: 'Kubernetes' },
    { id: 'proj:1', op: 'swap', before: null }, { id: 'skills:1', op: 'skills', before: ['Postgres'] }, { id: 'exp:1.b2', op: 'remove' }
  ];
  const { marked } = previewResumes(doc, old);
  assert.match(marked.experience[0].bullets[0], /title="Was: Built billing API in Go">on Kubernetes/);
  assert.equal(marked.projects[0].bullets[0], 'Parsed units', 'other kinds of old change are shown unmarked');
});
