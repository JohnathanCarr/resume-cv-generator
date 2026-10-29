// node --test 'test/unit/*.test.mjs'
// Tailoring v2's contract (extension/generation/compose.js): source ids, the
// schema, the validator's rules, and the conversion to a resume document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceIndex, renderProfileForCompose, COMPOSE_SCHEMA, validateComposition, toResumeDoc, namedTerms, numbersIn } from '../../extension/generation/compose.js';
import { resumeDocToSchema } from '../../extension/generation/baseline.js';
import { scoreResumeV2 } from '../eval/scoreV2.mjs';

const profile = {
  name: 'Dana Diaz',
  location: 'Austin, TX',
  contact: 'dana@example.com',
  summary: 'Backend engineer.',
  skills: ['Go', 'PostgreSQL', 'Search Engine Optimization', 'Docker'],
  experiences: [
    { id: '3', title: 'Engineer', company: 'Harbor', start: '2022', end: 'Present', location: 'Remote', description: 'Platform team.', bullets: ['Built Go services handling 2M requests a day', 'Ran Search Engine Optimization for the store'] },
    { id: '4', title: 'Intern', company: 'Pine', start: '2021', end: '2021', bullets: ['Wrote PostgreSQL reports for 40 stores'] }
  ],
  projects: [{ id: '5', name: 'tidepool', description: 'Job queue', bullets: ['A Docker job queue'] }],
  education: [{ id: '1', institution: 'State University', degreeType: 'BS', major: 'CS', start: '2017', end: '2021' }],
  extras: [{ id: '2', title: 'AWS Developer', type: 'certification' }]
};
const match = {
  role: 'Backend Engineer',
  keywords: [
    { term: 'Go', importance: 'core', alias: '' },
    { term: 'PostgreSQL', importance: 'core', alias: '' },
    { term: 'SEO', importance: 'core', alias: 'Search Engine Optimization' },
    { term: 'Kubernetes', importance: 'core', alias: '' }
  ],
  requirements: [
    { text: 'Go services', kind: 'required', strength: 'strong', evidence: ['exp:3'] },
    { text: 'PostgreSQL', kind: 'required', strength: 'partial', evidence: ['exp:4'] },
    { text: 'Kubernetes', kind: 'required', strength: 'none', evidence: [] }
  ],
  hard_requirements: [{ type: 'location', text: 'Austin, TX', kind: 'required', met: 'yes', evidence: ['profile:location'] }]
};
const good = () => ({
  summary: { text: 'Backend Engineer building Go and PostgreSQL services, with Search Engine Optimization (SEO) work.', sources: ['profile:summary', 'exp:3.b1', 'exp:4.b1', 'exp:3.b2'] },
  skill_groups: [{ label: 'Languages', items: ['Go', 'PostgreSQL'] }, { label: 'Other', items: ['SEO (Search Engine Optimization)', 'Docker'] }],
  experience: [
    { id: 'exp:4', bullets: [{ text: 'Wrote PostgreSQL reports for 40 stores', sources: ['exp:4.b1'] }] },
    { id: 'exp:3', bullets: [
      { text: 'Built Go services handling 2M requests a day on Docker', sources: ['exp:3.b1'] },
      { text: 'Led SEO for the store', sources: ['exp:3.b2'] }
    ] }
  ],
  projects: [{ id: 'proj:5', bullets: [{ text: 'Built a Docker job queue', sources: ['proj:5.b1'] }] }],
  education: [{ id: 'edu:1' }],
  extras: [{ id: 'extra:2' }]
});
const codes = (r) => r.errors.map(e => e.code);

test('every profile line has an id, and lines know their entry', () => {
  const index = sourceIndex(profile);
  assert.equal(index.get('exp:3.b2').text, 'Ran Search Engine Optimization for the store');
  assert.equal(index.get('exp:3.b2').entry, 'exp:3');
  assert.equal(index.get('exp:3.d').text, 'Platform team.');
  assert.equal(index.get('skill:Go').entry, null);
  assert.ok(index.has('profile:location') && index.has('edu:1') && index.has('extra:2') && index.has('proj:5.b1'));
  const text = renderProfileForCompose(profile);
  for (const id of ['[profile:summary]', '[exp:3]', '[exp:3.d]', '[exp:3.b2]', '[proj:5.b1]', '[edu:1]', '[extra:2]', '[skill:Docker]']) assert.ok(text.includes(id), id);
});

test('the schema is strict', () => {
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false, path);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), path);
    }
    for (const [k, v] of Object.entries(node.properties || {})) walk(v, `${path}.${k}`);
    if (node.items) walk(node.items, `${path}[]`);
  };
  walk(COMPOSE_SCHEMA, 'compose');
});

test('facts: named terms and numbers', () => {
  assert.deepEqual(namedTerms('Built Go services on Kubernetes with Node.js and CI/CD. Shipped at Stripe.'), ['Go', 'Kubernetes', 'Node.js', 'CI/CD', 'Stripe']);
  assert.deepEqual(namedTerms('Served 10K+ users and 2M requests'), [], 'number units are not names');
  assert.deepEqual([...numbersIn('Cut 40% for 2,000 stores, $1.2M saved, 3x faster')], ['40%', '2000', '1200000', '3x']);
});

test('a truthful, tailored composition passes, and converts with history from the profile', () => {
  const result = validateComposition(good(), profile, match);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  const doc = toResumeDoc(good(), profile);
  assert.deepEqual(doc.experiences.map(e => e.id), ['exp:3', 'exp:4'], 'jobs newest first, as in the profile');
  assert.equal(doc.experiences[0].title, 'Engineer');
  assert.equal(doc.experiences[0].start, '2022');
  assert.deepEqual(doc.experiences[0].bulletSources, [['exp:3.b1'], ['exp:3.b2']]);
  assert.equal(doc.education[0].institution, 'State University');
});

test('the rubric agrees: a valid composition passes rubric v2\'s truth checks', () => {
  const resume = resumeDocToSchema(toResumeDoc(good(), profile));
  const s = scoreResumeV2({ resume, profile, jobText: 'Backend Engineer. Go, PostgreSQL, SEO, Kubernetes.', match, page: { fits: true, afterPx: 960, limitPx: 1048 } });
  for (const check of ['noFabricatedNumbers', 'noUnsupportedTools', 'historyTruthful', 'skillsFromProfile', 'coreCoverage', 'requirementEvidence', 'summaryPresent', 'parseSafe']) {
    assert.equal(s.checks[check], 1, `${check}: ${s.fails.join('; ')}`);
  }
});

test('truth: sources, entries, numbers and terms', () => {
  const c = good();
  c.experience[1].bullets = [
    { text: 'Built Go services', sources: [] },                                     // unsourced
    { text: 'Built Go services', sources: ['exp:3.b9'] },                           // unknown source
    { text: 'Wrote PostgreSQL reports', sources: ['exp:4.b1'] },                    // wrong entry
    { text: 'Built Go services handling 5M requests', sources: ['exp:3.b1'] },      // number
    { text: 'Built Go services on Kubernetes', sources: ['exp:3.b1'] }              // posting tool, not in profile
  ];
  const got = codes(validateComposition(c, profile, match));
  for (const code of ['unsourced', 'unknown_source', 'wrong_entry', 'number', 'term']) assert.ok(got.includes(code), code);
});

test('aliases and the posting\'s title are allowed where the profile supports them', () => {
  const c = good();
  c.experience[1].bullets[1] = { text: 'Led Search Engine Optimization (SEO) for the store', sources: ['exp:3.b2'] };
  assert.deepEqual(codes(validateComposition(c, profile, match)), []);
  // The posting's title is fine in the summary but not as a claim in a bullet.
  c.experience[1].bullets[1] = { text: 'Promoted to Backend Engineer', sources: ['exp:3.b2'] };
  assert.ok(codes(validateComposition(c, profile, match)).includes('term'));
});

test('skills and entries', () => {
  const c = good();
  c.skill_groups = [{ label: 'Languages', items: ['Go', 'Rust', 'go'] }];
  c.experience.push({ id: 'exp:99', bullets: [] }, { id: 'exp:3', bullets: [{ text: 'Built Go services handling 2M requests a day', sources: ['exp:3.b1'] }] });
  c.projects[0].bullets = [];
  c.education = [];
  const got = codes(validateComposition(c, profile, match));
  for (const code of ['skill', 'duplicate_skill', 'unknown_entry', 'duplicate_entry', 'no_bullets', 'no_education']) assert.ok(got.includes(code), code);
});

test('match: keywords, requirements, stuffing and filler', () => {
  const c = good();
  c.summary = { text: 'Results-driven engineer.', sources: ['profile:summary'] };
  c.skill_groups = [{ label: 'Languages', items: ['Go', 'Docker'] }];
  c.experience = [{ id: 'exp:3', bullets: [{ text: 'Built Go services handling 2M requests a day in Go, Go and Go', sources: ['exp:3.b1'] }] }];
  const got = codes(validateComposition(c, profile, match));
  for (const code of ['keyword', 'requirement', 'stuffing', 'filler']) assert.ok(got.includes(code), code);
  assert.ok(!got.includes('requirement') || validateComposition(c, profile, match).errors.find(e => e.code === 'requirement').message.includes('PostgreSQL'));
});

test('warnings: acronym pairs, skills in bullets, hard requirements', () => {
  const c = good();
  c.summary = { text: 'Backend Engineer building services.', sources: ['profile:summary'] };
  c.skill_groups = [{ label: 'Languages', items: ['Go', 'PostgreSQL'] }, { label: 'Other', items: ['SEO', 'Docker'] }];
  c.experience[1].bullets = [{ text: 'Built services handling 2M requests a day', sources: ['exp:3.b1'] }, { text: 'Led SEO for the store', sources: ['exp:3.b2'] }];
  c.experience[0].bullets = [{ text: 'Wrote reports for 40 stores', sources: ['exp:4.b1'] }];
  const { errors, warnings } = validateComposition(c, profile, { ...match, hard_requirements: [{ type: 'license', text: 'AWS', kind: 'required', met: 'yes', evidence: ['extra:9'] }] });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings.map(w => w.code).sort(), ['acronym', 'hard_requirement', 'skills_in_context']);
});
