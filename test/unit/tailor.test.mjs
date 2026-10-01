// node --test test/unit/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBaseline } from '../../extension/generation/baseline.js';
import { buildPool, validateEdits, applyEdits, keywordCoverage, editableLines } from '../../extension/generation/tailor.js';

const parsed = {
  name: 'Dana Reyes', summary: 'Backend engineer with 3 years in Go',
  skills: ['Go', 'Postgres', 'Docker'],
  skillGroups: [{ label: 'Languages', items: ['Go'] }, { label: 'Tools', items: ['Postgres', 'Docker'] }],
  education: [{ institution: 'UT Austin', degreeType: 'B.S.', major: 'CS', coursework: 'Databases, Algorithms' }],
  experiences: [
    { title: 'Backend Engineer', company: 'Acme', start: '2022', end: 'Present', bullets: ['Built billing API serving 2M requests a day', 'Ran weekly demos'] },
    { title: 'Intern', company: 'Initech', end: '2021', bullets: ['Wrote tests'] }
  ],
  projects: [{ name: 'Pantry', description: 'Rust CLI', bullets: ['Parsed 30 unit formats'] }],
  extras: [{ type: 'award', title: 'Hackathon winner', end: '2020' }]
};
const baseline = createBaseline(parsed);
const doc = baseline.resume;

// The profile has everything on the resume plus more.
const profile = {
  ...parsed,
  skills: ['Go', 'Postgres', 'Docker', 'Kubernetes', 'Terraform'],
  education: [{ institution: 'UT Austin', coursework: 'Databases, Algorithms, Distributed Systems' }],
  experiences: [
    { title: 'Backend Engineer', company: 'Acme', bullets: ['Built billing API serving 2M requests a day', 'Ran weekly demos', 'Deployed services to Kubernetes with Terraform'] },
    { title: 'Intern', company: 'Initech', bullets: ['Wrote tests'] }
  ],
  projects: [
    { name: 'Pantry', bullets: ['Parsed 30 unit formats'] },
    { name: 'Tracer', description: 'Go tracing tool', bullets: ['Cut trace render time from 4s to 300ms'] }
  ],
  extras: [{ type: 'award', title: 'Hackathon winner', end: '2020' }, { type: 'certification', title: 'CKA', organization: 'CNCF', end: '2023' }]
};
const pool = buildPool(doc, profile);
const match = { keywords: [
  { term: 'Kubernetes', importance: 'core' }, { term: 'Terraform', importance: 'core' },
  { term: 'Go', importance: 'core' }, { term: 'teamwork', importance: 'supporting' }
] };

test('pool holds only profile material that is not on the resume', () => {
  assert.deepEqual(pool.bullets, { 'more:exp:1.1': { owner: 'exp:1', text: 'Deployed services to Kubernetes with Terraform' } });
  assert.deepEqual(pool.projects.map(p => [p.id, p.name]), [['pool:proj:1', 'Tracer']]);
  assert.deepEqual(pool.extras.map(x => [x.id, x.title]), [['pool:extra:1', 'CKA']]);
  assert.deepEqual(pool.skills, ['Kubernetes', 'Terraform']);
  assert.deepEqual(pool.courses, { 'edu:1': ['Distributed Systems'] });
});

test('jobs, education and headers are not editable; the summary is', () => {
  const ids = Object.keys(editableLines(doc));
  assert.ok(ids.includes('summary') && ids.includes('exp:1.b2') && ids.includes('skills:2') && ids.includes('edu:1.coursework'));
  assert.ok(!ids.includes('exp:1') && !ids.includes('edu:1'));
  const noSummary = createBaseline({ ...parsed, summary: '' }).resume;
  assert.ok(!('summary' in editableLines(noSummary)));
});

const good = [
  { op: 'swap', target: 'exp:1.b2', with: 'more:exp:1.1', text: null, items: null, reason: 'Kubernetes, Terraform' },
  { op: 'rewrite', target: 'exp:1.b1', with: null, text: 'Built a Go billing API serving 2M requests a day', items: null, reason: 'Go' },
  { op: 'skills', target: 'skills:2', with: null, text: null, items: ['Kubernetes', 'Terraform', 'PostgreSQL (Postgres)', 'Docker'], items2: null, reason: 'core tools' },
  { op: 'swap', target: 'proj:1', with: 'pool:proj:1', text: null, items: null, reason: 'Go' },
  { op: 'swap', target: 'extra:1', with: 'pool:extra:1', text: null, items: null, reason: 'Kubernetes' },
  { op: 'rewrite', target: 'edu:1.coursework', with: null, text: 'Distributed Systems, Databases', items: null, reason: 'distributed systems' }
];

test('valid edits pass', () => {
  const { valid, errors } = validateEdits(good, doc, pool);
  assert.deepEqual(errors, []);
  assert.equal(valid.length, good.length);
});

test('invalid edits are rejected with a reason', () => {
  const bad = [
    { op: 'rewrite', target: 'exp:1', text: 'New title', reason: '' },                                     // header
    { op: 'rewrite', target: 'exp:1.b1', text: 'Built billing API serving 5M requests a day', reason: '' }, // new number
    { op: 'rewrite', target: 'summary', text: 'Backend engineer with 3 years in TypeScript', reason: '' },   // drops Go
    { op: 'swap', target: 'exp:2.b1', with: 'more:exp:1.1', reason: '' },                                  // other job's bullet
    { op: 'skills', target: 'skills:2', items: ['Docker', 'Kubernetes'], reason: '' },                      // drops Postgres
    { op: 'skills', target: 'skills:1', items: ['Go', 'Rust'], reason: '' },                                // not in profile
    { op: 'rewrite', target: 'edu:1.coursework', text: 'Databases, Compilers', reason: '' },               // course not in profile
    { op: 'rewrite', target: 'proj:1.b1', text: 'Parsed 30 unit formats fast', reason: '' },
    { op: 'swap', target: 'proj:1', with: 'pool:proj:1', reason: '' }                                      // makes the line above invalid
  ];
  const { valid, errors } = validateEdits(bad, doc, pool);
  assert.deepEqual(valid.map(e => e.target), ['proj:1']);
  assert.equal(errors.length, 8);
  assert.match(errors[1], /numbers not in the original/);
  assert.match(errors[2], /drops terms from the original line \(go\)/);
  assert.match(errors[7], /swapped out/);
});

test('a target is edited at most once and a pool item used once', () => {
  const { errors } = validateEdits([
    { op: 'rewrite', target: 'exp:1.b1', text: 'Built a Go billing API serving 2M requests a day', reason: '' },
    { op: 'swap', target: 'exp:1.b1', with: 'more:exp:1.1', reason: '' },
    { op: 'swap', target: 'exp:1.b2', with: 'more:exp:1.1', reason: '' },
    { op: 'swap', target: 'exp:1.b1', with: 'more:exp:1.1', reason: '' }
  ], doc, pool);
  assert.equal(errors.length, 2);
});

test('applying edits changes only the edited lines and records each change', () => {
  const { valid } = validateEdits(good, doc, pool);
  const { doc: out, changes } = applyEdits(doc, pool, valid);
  assert.deepEqual(out.experiences[0].bullets, ['Built a Go billing API serving 2M requests a day', 'Deployed services to Kubernetes with Terraform']);
  assert.deepEqual(out.experiences[1], doc.experiences[1]);
  assert.equal(out.summary, doc.summary);
  assert.equal(out.projects[0].name, 'Tracer');
  assert.equal(out.projects[0].id, 'proj:1');
  assert.equal(out.extras[0].title, 'CKA');
  assert.equal(out.education[0].coursework, 'Distributed Systems, Databases');
  const skills = changes.find(c => c.id === 'skills:2');
  assert.deepEqual(skills.added, ['Kubernetes', 'Terraform']);
  assert.deepEqual(changes.map(c => c.id).sort(), ['edu:1.coursework', 'exp:1.b1', 'exp:1.b2', 'extra:1', 'proj:1', 'skills:2']);
  // The baseline is not mutated.
  assert.equal(doc.experiences[0].bullets[1], 'Ran weekly demos');
});

test('keyword coverage counts core terms in the document', () => {
  const { valid } = validateEdits(good, doc, pool);
  const { doc: out } = applyEdits(doc, pool, valid);
  assert.deepEqual(keywordCoverage(doc, match), { found: 1, total: 3, missing: ['Kubernetes', 'Terraform'] });
  assert.deepEqual(keywordCoverage(out, match), { found: 3, total: 3, missing: [] });
});
