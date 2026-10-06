// node --test test/unit/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBaseline } from '../../extension/generation/baseline.js';
import { buildPool, validateEdits, applyEdits } from '../../extension/generation/tailor.js';
import { diffWords, escapeHtml, previewResumes, changeCounts } from '../../extension/generation/highlight.js';

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

const parsed = {
  name: 'Dana', summary: 'Backend engineer in Go',
  skillGroups: [{ label: 'Tools', items: ['Postgres', 'Docker'] }],
  skills: ['Postgres', 'Docker'],
  education: [{ institution: 'UT', degreeType: 'B.S.' }],
  experiences: [{ title: 'Engineer', company: 'Acme', bullets: ['Built billing API in Go', 'Ran demos', 'Wrote <script> docs'] }],
  projects: [{ name: 'Pantry', bullets: ['Parsed units'] }],
  extras: [{ title: 'Hackathon winner' }]
};
const profile = {
  ...parsed,
  skills: ['Postgres', 'Docker', 'Kubernetes'],
  experiences: [{ title: 'Engineer', company: 'Acme', bullets: [...parsed.experiences[0].bullets, 'Deployed to Kubernetes'] }],
  projects: [...parsed.projects, { name: 'Tracer', bullets: ['Traced spans'] }],
  extras: [...parsed.extras, { title: 'CKA', organization: 'CNCF' }]
};
const doc = createBaseline(parsed).resume;
const pool = buildPool(doc, profile);
const edits = [
  { op: 'rewrite', target: 'exp:1.b1', text: 'Built billing API in Go (Golang)', reason: 'Golang' },
  { op: 'remove', target: 'exp:1.b2', reason: 'fit' },
  { op: 'swap', target: 'proj:1', with: 'pool:proj:1', reason: 'tracing' },
  { op: 'swap', target: 'extra:1', with: 'pool:extra:1', reason: 'Kubernetes' },
  { op: 'skills', target: 'skills:1', items: ['Kubernetes', 'PostgreSQL (Postgres)', 'Docker'], reason: 'core tools' }
];
const { valid, errors } = validateEdits(edits, doc, pool);
const { doc: tailored, changes } = applyEdits(doc, pool, valid);

test('marked preview highlights each kind of change; clean has no marks', () => {
  assert.deepEqual(errors, []);
  const { marked, clean } = previewResumes(tailored, changes);
  const exp = marked.experience[0].bullets;
  assert.equal(exp.length, 2);                                   // removed bullet is gone
  assert.equal(exp[0], 'Built billing API in Go <span class="rs-added" title="Was: Built billing API in Go\nWhy: Golang">(Golang)</span>');
  assert.equal(exp[1], 'Wrote &lt;script&gt; docs');           // untouched, escaped
  assert.match(marked.projects[0].name, /^<span class="rs-added rs-line"[^>]*>Tracer<\/span>$/);
  assert.match(marked.projects[0].bullets[0], /rs-line[^>]*>Traced spans</);
  assert.match(marked.programs[0], /^<span class="rs-added rs-line"[^>]*>CKA – CNCF<\/span>$/);
  assert.equal(marked.skills[0], 'Tools: <span class="rs-added" title="Added: core tools">Kubernetes</span>, <span class="rs-added" title="Was: Postgres">PostgreSQL</span> (Postgres), Docker');
  assert.equal(marked.summary, 'Backend engineer in Go');

  const all = JSON.stringify(clean);
  assert.ok(!all.includes('rs-added'));
  assert.deepEqual(clean.experience[0].bullets, ['Built billing API in Go (Golang)', 'Wrote &lt;script&gt; docs']);
  assert.equal(clean.projects[0].name, 'Tracer');
  assert.equal(clean.skills[0], 'Tools: Kubernetes, PostgreSQL (Postgres), Docker');
});

test('an added skill containing an existing one is new, not a respelling', () => {
  const d = createBaseline({ ...parsed, skillGroups: [{ label: 'Tools', items: ['gRPC'] }], skills: ['gRPC'] }).resume;
  const p = buildPool(d, { ...profile, skills: ['gRPC', 'gRPC streaming'] });
  const { valid } = validateEdits([{ op: 'skills', target: 'skills:1', items: ['gRPC', 'gRPC streaming'], reason: 'streaming' }], d, p);
  const r = applyEdits(d, p, valid);
  assert.deepEqual(r.changes[0].added, ['gRPC streaming']);
  assert.equal(previewResumes(r.doc, r.changes).marked.skills[0], 'Tools: gRPC, <span class="rs-added" title="Added: streaming">gRPC streaming</span>');
});

test('changeCounts summarises the edits', () => {
  assert.deepEqual(changeCounts(changes), { reworded: 1, swapped: 2, skills: 1, removed: 1 });
});
