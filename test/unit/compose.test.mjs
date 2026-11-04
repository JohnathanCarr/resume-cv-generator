// node --test 'test/unit/*.test.mjs'
// Tailoring v2's contract (extension/generation/compose.js): source ids, the
// schema, the validator's rules, and the conversion to a resume document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceIndex, renderProfileForCompose, COMPOSE_SCHEMA, validateComposition, toResumeDoc, namedTerms, numbersIn, normalizeSectionOrder, sanitizeComposition, fitComposition, DEFAULT_SECTION_ORDER, composeChanges, entryRelevance, isScreeningSkill, minSkillItems, numberedRequirements } from '../../extension/generation/compose.js';
import { makeLayout, estimateDocHeight } from '../../extension/generation/layout.js';
import { extraText } from '../../extension/generation/resumeDoc.js';
import { previewResumes } from '../../extension/generation/highlight.js';
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
  skill_groups: [{ label: 'Languages', items: ['Go', 'PostgreSQL'] }, { label: 'Other', items: ['SEO', 'Docker'] }],
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
  assert.deepEqual(namedTerms('ML-focused engineer, well-tested code'), ['ML']);
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

test('section order: known sections once each, the rest in the default order', () => {
  assert.deepEqual(normalizeSectionOrder(null), DEFAULT_SECTION_ORDER);
  assert.deepEqual(normalizeSectionOrder(['education', 'bogus', 'education']), ['education', 'experience', 'projects', 'extras']);
  assert.deepEqual(toResumeDoc({ ...good(), section_order: ['projects'] }, profile).sectionOrder, ['projects', 'experience', 'education', 'extras']);
});

test('sanitize: what still fails after repairs is removed, never shown', () => {
  const c = good();
  c.summary = { text: 'Engineer with 9 years', sources: ['profile:summary'] };
  c.skill_groups = [{ label: 'Languages', items: ['Go', 'Rust', 'go'] }];
  c.experience[1].bullets.push({ text: 'Built Go services on Kubernetes', sources: ['exp:3.b1'] });
  c.projects[0].bullets = [{ text: 'Ran 99 queues', sources: ['proj:5.b1'] }];
  c.education = [];
  const { errors } = validateComposition(c, profile, match);
  const { comp, dropped } = sanitizeComposition(c, errors, profile);
  assert.equal(comp.summary.text, '');
  assert.deepEqual(comp.skill_groups[0].items, ['Go']);
  assert.equal(comp.experience[1].bullets.length, 2, 'the Kubernetes bullet is gone');
  assert.deepEqual(comp.projects, [], 'a project with no usable bullet goes');
  assert.deepEqual(comp.education, [{ id: 'edu:1' }], 'education is restored');
  assert.ok(dropped.length >= 4);
  assert.deepEqual(validateComposition(comp, profile, match).errors.filter(e => ['number', 'term', 'skill', 'duplicate_skill', 'no_education'].includes(e.code)), []);
});

test('fit: trims extras, projects, then old jobs\' bullets, keeping proof of requirements', () => {
  const layout = makeLayout({});
  const long = 'Built Go services handling 2M requests a day for the platform team across many regions and stores';
  const c = good();
  c.experience[1].bullets = Array.from({ length: 30 }, () => ({ text: long, sources: ['exp:3.b1'] }));
  c.experience[0].bullets = Array.from({ length: 6 }, () => ({ text: 'Wrote PostgreSQL reports for 40 stores', sources: ['exp:4.b1'] }));
  const fit = fitComposition(c, profile, match, layout);
  assert.ok(fit.page.fits, `${fit.page.afterPx} > ${fit.page.limitPx}`);
  assert.ok(fit.trimmed[0].startsWith('extra'), 'extras go first');
  assert.deepEqual(fit.comp.experience.map(e => e.id), ['exp:4', 'exp:3'], 'no job is removed');
  assert.ok(fit.comp.experience.every(e => e.bullets.length >= 1));
  // A page that already fits is left alone.
  const ok = fitComposition(good(), profile, match, layout);
  assert.deepEqual(ok.trimmed, []);
  // The extension's measured offset makes it trim more.
  assert.ok(fitComposition(good(), profile, match, layout, { offsetPx: 10000 }).trimmed.length > 0);
});

test('work authorization and clearance are citable profile lines', () => {
  const p = { ...profile, workAuthorization: 'US citizen', clearance: 'Active TS/SCI clearance' };
  const index = sourceIndex(p);
  assert.equal(index.get('profile:clearance').text, 'Active TS/SCI clearance');
  assert.ok(renderProfileForCompose(p).includes('[profile:workAuthorization] Work authorization: US citizen'));
  const c = good();
  c.summary = { text: 'Backend Engineer building Go and PostgreSQL services, with Search Engine Optimization (SEO) work. Holds an active TS/SCI clearance.', sources: ['profile:summary', 'exp:3.b1', 'exp:4.b1', 'exp:3.b2', 'profile:clearance'] };
  assert.deepEqual(validateComposition(c, p, match).errors, []);
  c.summary.sources = c.summary.sources.slice(0, 4);
  assert.ok(codes(validateComposition(c, p, match)).includes('term'), 'TS/SCI needs its source');
});

test('preview: rewritten lines mark their new words and hover shows the source', () => {
  const doc = toResumeDoc(good(), profile);
  const changes = composeChanges(doc, profile);
  const ids = changes.map(c => c.id);
  assert.ok(ids.includes('summary'));
  assert.ok(ids.includes('exp:3.c1'), 'the reworded Go bullet');
  assert.ok(!ids.includes('exp:4.c1'), 'a line copied as written is not a change');
  const { marked, clean } = previewResumes(doc, changes);
  const harbor = marked.experience.find(e => e.company === 'Harbor').bullets[0];
  assert.match(harbor, /<span class="rs-added" title="From your profile: Built Go services handling 2M requests a day">on Docker<\/span>/);
  assert.ok(!JSON.stringify(clean).includes('rs-added'));
});

test('jobs come out newest first by date, and the oldest is trimmed first', () => {
  const p2 = { ...profile, experiences: [profile.experiences[1], profile.experiences[0]] };   // the intern job listed first
  assert.deepEqual(toResumeDoc(good(), p2).experiences.map(e => e.id), ['exp:3', 'exp:4']);
  const c = good();
  c.experience[1].bullets = [1, 2, 3].map(() => ({ text: 'Built Go services handling 2M requests a day', sources: ['exp:3.b1'] }));
  c.experience[0].bullets = [1, 2, 3].map(() => ({ text: 'Wrote PostgreSQL reports for 40 stores', sources: ['exp:4.b1'] }));
  c.extras = []; c.projects = [];
  const fit = fitComposition(c, p2, { ...match, requirements: [] }, makeLayout({}), { offsetPx: 760 });
  const jobTrims = fit.trimmed.filter(t => t.startsWith('exp:')).map(t => t.slice(0, 5));
  assert.deepEqual(jobTrims.slice(0, 2), ['exp:4', 'exp:4'], `the 2021 job loses bullets before the current one: ${fit.trimmed.join('; ')}`);
  assert.ok(fit.comp.experience.find(e => e.id === 'exp:3').bullets.length >= fit.comp.experience.find(e => e.id === 'exp:4').bullets.length);
});

test('skill brackets hold the profile\'s name only; a misuse keeps the plain skill', () => {
  const c = good();
  c.skill_groups = [{ label: 'Tools', items: ['Docker (container platform tool)', 'Go', 'PostgreSQL'] }];
  const { errors } = validateComposition(c, profile, match);
  const e = errors.find(x => x.code === 'skill_form');
  assert.ok(e && e.keep === 'Docker', JSON.stringify(errors));
  assert.deepEqual(sanitizeComposition(c, errors, profile).comp.skill_groups[0].items, ['Docker', 'Go', 'PostgreSQL']);
  c.skill_groups = [{ label: 'Tools', items: ['Golang (Go)', 'SEO', 'PostgreSQL', 'Docker'] }];
  assert.ok(!validateComposition(c, profile, match).errors.some(x => x.code === 'skill_form'), 'posting term (profile name) is fine');
  // An acronym spelled out, or the same name twice, is one skill listed once.
  for (const [item, keep] of [['SEO (Search Engine Optimization)', 'SEO'], ['Postgresql (PostgreSQL)', 'Postgresql']]) {
    c.skill_groups = [{ label: 'Tools', items: [item, 'Go', 'Docker'] }];
    const e = validateComposition(c, profile, match).errors.find(x => x.code === 'skill_form');
    assert.equal(e && e.keep, keep, item);
  }
});

test('keyword uses are counted over written text, labels included, not fixed headers', () => {
  const c = good();
  c.skill_groups = [{ label: 'Go & Data', items: ['Go', 'PostgreSQL'] }, { label: 'Other', items: ['SEO', 'Docker'] }];
  c.experience[1].bullets = [
    { text: 'Built Go services handling 2M requests a day', sources: ['exp:3.b1'] },
    { text: 'Ran Go tooling for Search Engine Optimization (SEO)', sources: ['exp:3.b1', 'exp:3.b2'] }
  ];
  c.summary = { text: 'Backend Engineer writing Go and PostgreSQL services.', sources: ['profile:summary', 'exp:3.b1', 'exp:4.b1'] };
  assert.ok(codes(validateComposition(c, profile, match)).includes('stuffing'), 'Go in a label, the skills, the summary and two bullets is five');
});

test('work authorization is never a skill, and its legal boilerplate is filler', () => {
  const p = { ...profile, workAuthorization: 'U.S. Citizenship; legally eligible to work in the U.S. on an ongoing basis' };
  const c = good();
  c.skill_groups = [...c.skill_groups, { label: 'Work Authorization', items: ['U.S. Citizenship'] }];
  const { errors } = validateComposition(c, p, match);
  assert.ok(errors.some(e => e.code === 'skill' && e.item === 'U.S. Citizenship'));
  assert.ok(!sanitizeComposition(c, errors, p).comp.skill_groups.some(g => g.label === 'Work Authorization'), 'the emptied group goes');
  const s = good();
  s.summary = { text: `${s.summary.text} Legally eligible to work in the U.S. on an ongoing basis.`, sources: [...s.summary.sources, 'profile:workAuthorization'] };
  assert.ok(codes(validateComposition(s, p, match)).includes('filler'));
});

test('a profile with projects gets a project, and trimming keeps the first one longest', () => {
  const c = good();
  c.projects = [];
  assert.ok(codes(validateComposition(c, profile, match)).includes('no_projects'));
  const p = { ...profile, projects: [...profile.projects, { id: '6', name: 'gull', bullets: ['A Go log shipper', 'Ships 2M lines a day'] }] };
  const full = good();
  full.experience[1].bullets = Array.from({ length: 6 }, () => ({ text: 'Built Go services handling 2M requests a day', sources: ['exp:3.b1'] }));
  full.projects = [
    { id: 'proj:5', bullets: [{ text: 'Built a Docker job queue', sources: ['proj:5.b1'] }] },
    { id: 'proj:6', bullets: [{ text: 'Built a Go log shipper', sources: ['proj:6.b1'] }, { text: 'Shipped 2M lines a day', sources: ['proj:6.b2'] }] }
  ];
  const fit = fitComposition(full, p, { ...match, requirements: [] }, makeLayout({}), { offsetPx: 600 });
  const projectGone = fit.trimmed.findIndex(t => t.startsWith('project'));
  const newestTo3 = fit.trimmed.filter(t => t.startsWith('exp:3')).length >= 3;
  assert.ok(projectGone < 0 || newestTo3, `a project went before the newest job was down to 3 bullets: ${fit.trimmed.join('; ')}`);
  assert.ok(fit.comp.projects.length >= 1 || fit.comp.experience.find(e => e.id === 'exp:3').bullets.length <= 2, 'the first project outlasts the newest job\'s third bullet');
});

test('relevance, not entry type, decides who keeps bullets', () => {
  const p = {
    ...profile,
    experiences: [
      { id: '3', title: 'Engineer', company: 'Harbor', start: '2022', end: 'Present', bullets: ['Built Go services handling 2M requests a day', 'Ran Search Engine Optimization for the store'] },
      { id: '7', title: 'Rater', company: 'Gig', start: '2020', end: '2021', bullets: ['Rated search results', 'Wrote rating notes'] }
    ],
    projects: [{ id: '5', name: 'tidepool', description: 'Go, PostgreSQL, Docker', bullets: ['Built a Go job queue on PostgreSQL', 'Ran it in Docker', 'Shipped Go workers', 'Wrote PostgreSQL migrations'] }]
  };
  const m = { ...match, requirements: [{ text: 'Go services', kind: 'required', strength: 'strong', evidence: ['exp:3', 'proj:5'] }] };
  const rel = entryRelevance(p, m);
  assert.ok(rel.get('proj:5') > rel.get('exp:7'), JSON.stringify([...rel]));
  const b = (t, s) => ({ text: t, sources: [s] });
  const c = { ...good(), extras: [],
    experience: [{ id: 'exp:3', bullets: [b('Built Go services handling 2M requests a day', 'exp:3.b1'), b('Ran SEO for the store', 'exp:3.b2')] }, { id: 'exp:7', bullets: [b('Rated search results', 'exp:7.b1'), b('Wrote rating notes', 'exp:7.b2')] }],
    projects: [{ id: 'proj:5', bullets: [1, 2, 3, 4].map(i => b('Built a Go job queue on PostgreSQL', `proj:5.b${i}`)) }] };
  const fit = fitComposition(c, p, { ...m, requirements: [] }, makeLayout({}), { offsetPx: 700 });
  assert.ok(fit.trimmed.length, 'something was trimmed');
  assert.ok(fit.trimmed[0].startsWith('exp:7'), `the low-relevance job goes first: ${fit.trimmed.join('; ')}`);
  assert.equal(fit.comp.experience.find(e => e.id === 'exp:3').bullets.length >= 1, true);
});

test('acronym pairs are asked for only when the posting uses both forms', () => {
  const c = good();
  c.summary = { text: 'Backend Engineer building Go and PostgreSQL services, with SEO work.', sources: ['profile:summary', 'exp:3.b1', 'exp:4.b1', 'exp:3.b2'] };
  c.experience[1].bullets[1] = { text: 'Led SEO for the store', sources: ['exp:3.b2'] };
  const one = { ...match, keywords: match.keywords.map(k => (k.term === 'SEO' ? { ...k, bothForms: false } : k)) };
  assert.ok(!validateComposition(c, profile, one).warnings.some(w => w.code === 'acronym'));
  const both = { ...match, keywords: match.keywords.map(k => (k.term === 'SEO' ? { ...k, bothForms: true } : k)) };
  assert.ok(validateComposition(c, profile, both).warnings.some(w => w.code === 'acronym'));
});

test('work authorization listed as a skill is hidden and rejected', () => {
  const p = { ...profile, skills: [...profile.skills, 'U.S. Citizenship'], clearance: 'Active Secret' };
  assert.ok(isScreeningSkill('U.S. Citizenship', p) && isScreeningSkill('Active Secret', p));
  assert.ok(!isScreeningSkill('Docker', p) && !isScreeningSkill('Security', { skills: [] }));
  assert.ok(!renderProfileForCompose(p).includes('U.S. Citizenship'), 'the model does not see it as a skill');
  const c = good();
  c.skill_groups.push({ label: 'Work Authorization', items: ['U.S. Citizenship'] });
  const { errors } = validateComposition(c, p, match);
  assert.ok(errors.some(e => e.code === 'skill' && e.item === 'U.S. Citizenship'), 'rejected even though it is in the skills list');
  assert.ok(!sanitizeComposition(c, errors, p).comp.skill_groups.some(g => g.label === 'Work Authorization'));
});

test('a thin Skills section goes back for repair, scaled to the profile', () => {
  const many = { ...profile, skills: Array.from({ length: 40 }, (_, i) => `Tool${i}`) };
  assert.equal(minSkillItems(many), 12, 'capped');
  assert.equal(minSkillItems(profile), 2, 'a short list is not padded');
  assert.equal(minSkillItems({ skills: ['U.S. Citizenship'] }), 0);
  const c = good();
  c.skill_groups = [{ label: 'Tools', items: ['Tool1', 'Tool2', 'Tool3'] }];
  assert.ok(codes(validateComposition(c, many, { ...match, keywords: [], requirements: [] })).includes('thin_skills'));
  c.skill_groups = [{ label: 'Tools', items: Array.from({ length: 12 }, (_, i) => `Tool${i}`) }];
  assert.ok(!codes(validateComposition(c, many, { ...match, keywords: [], requirements: [] })).includes('thin_skills'));
});

test('a Skills section far past the target goes back for repair', () => {
  const many = { ...profile, skills: Array.from({ length: 70 }, (_, i) => `Tool${i}`) };
  const m = { ...match, keywords: [], requirements: [] };
  const c = good();
  c.skill_groups = [{ label: 'Tools', items: Array.from({ length: 41 }, (_, i) => `Tool${i}`) }];
  assert.ok(codes(validateComposition(c, many, m)).includes('too_many_skills'));
  c.skill_groups = [{ label: 'Tools', items: Array.from({ length: 40 }, (_, i) => `Tool${i}`) }];
  assert.ok(!codes(validateComposition(c, many, m)).includes('too_many_skills'));
});

// A job with repetitive bullets and a project proving something new.
const pickerProfile = {
  ...profile,
  experiences: [
    { id: '3', title: 'Engineer', company: 'Harbor', start: '2022', end: 'Present', bullets: ['a', 'b', 'c', 'd', 'e'] },
    { id: '4', title: 'Intern', company: 'Pine', start: '2021', end: '2021', bullets: ['f', 'g'] }
  ],
  projects: [{ id: '5', name: 'tidepool', bullets: ['h', 'i', 'j'] }, { id: '6', name: 'gull', bullets: ['k', 'l'] }],
  extras: []
};
const pickerMatch = {
  keywords: [{ term: 'Go', importance: 'core', alias: '' }, { term: 'Docker', importance: 'core', alias: '' }],
  requirements: [
    { text: 'Go services', kind: 'required', strength: 'strong', evidence: ['exp:3', 'proj:5'] },
    { text: 'Containers', kind: 'required', strength: 'strong', evidence: ['proj:5'] },
    { text: 'Kubernetes', kind: 'required', strength: 'none', evidence: [] }
  ]
};
const bl = (text, id, proves = []) => ({ text, sources: [id], proves });
const pickerComp = () => ({
  ...good(),
  extras: [],
  experience: [
    { id: 'exp:3', bullets: [bl('Built Go services', 'exp:3.b1', ['R1']), bl('Built more Go services', 'exp:3.b2', ['R1']), bl('Built other Go services', 'exp:3.b3', ['R1']), bl('Kept Go services running', 'exp:3.b4', ['R1'])] },
    { id: 'exp:4', bullets: [bl('Wrote reports', 'exp:4.b1'), bl('Filed tickets', 'exp:4.b2')] }
  ],
  projects: [{ id: 'proj:5', bullets: [bl('Ran the queue in Docker containers', 'proj:5.b1', ['R2']), bl('Shipped workers', 'proj:5.b2'), bl('Wrote migrations', 'proj:5.b3')] }]
});
const overBy = (lines) => { const L = makeLayout({}); return { L, offset: L.capacityPx - estimateDocHeight(L, toResumeDoc(pickerComp(), pickerProfile), extraText) + lines * L.kinds.bullet.lineHeight }; };

test('requirements are numbered by their place, only the ones the candidate can show', () => {
  assert.deepEqual(numberedRequirements(pickerMatch).map(q => q.id), ['R1', 'R2']);
  const p = numberedRequirements({ requirements: [{ text: 'x', kind: 'required', strength: 'none' }, { text: 'y', kind: 'preferred', strength: 'partial' }] });
  assert.deepEqual(p, [{ id: 'R2', kind: 'preferred', text: 'y' }]);
});

test('the bullet that adds least goes first; a project proving something new outlasts a repetitive job', () => {
  const { L, offset } = overBy(3);
  const fit = fitComposition(pickerComp(), pickerProfile, pickerMatch, L, { offsetPx: offset });
  assert.ok(fit.trimmed.length, 'something was trimmed');
  const job = fit.comp.experience.find(e => e.id === 'exp:3').bullets.map(b => b.text);
  assert.ok(fit.comp.projects[0].bullets.some(b => b.text.includes('Docker')), 'the only proof of R2 stays');
  assert.ok(job.length < 4 || fit.trimmed.some(t => t.startsWith('proj:5')), 'bullets repeat R1 or add nothing, so they go');
  assert.ok(fit.comp.experience.every(e => e.bullets.length >= 1), 'every job keeps a bullet');
});

test('floors hold: newest job 2, the relevant top project 2, other jobs 1; past them only as a last resort', () => {
  const counts = (fit) => [...fit.comp.experience, ...fit.comp.projects].map(e => e.bullets.length);
  const near = overBy(3);
  assert.deepEqual(counts(fitComposition(pickerComp(), pickerProfile, pickerMatch, near.L, { offsetPx: near.offset })), [2, 1, 2]);
  const far = overBy(9);
  const fit = fitComposition(pickerComp(), pickerProfile, pickerMatch, far.L, { offsetPx: far.offset });
  assert.ok(fit.comp.experience.length === 2 && counts(fit).every(n => n >= 1), 'a job and its last bullet are never removed');
  assert.ok(fit.comp.projects[0].bullets[0].text.includes('Docker'), 'the only proof of a requirement is what stays');
});

test('a bullet with no proves list, or one naming unknown requirements, still works', () => {
  const c = pickerComp();
  for (const e of [...c.experience, ...c.projects]) for (const b of e.bullets) delete b.proves;
  c.experience[0].bullets[0].proves = ['R9', 'nonsense', 'R3'];   // R3 is the requirement the candidate cannot show
  const { L, offset } = overBy(2);
  assert.ok(fitComposition(c, pickerProfile, pickerMatch, L, { offsetPx: offset }).trimmed.length);
});

test('the prompt numbers the requirements and asks for more than fits', async () => {
  const { buildComposeMessages } = await import('../../extension/generation/composePrompt.js');
  const [sys, user] = buildComposeMessages({ profile: pickerProfile, jobText: 'x', match: { ...pickerMatch, company: '', role: '', seniority: 'mid', hard_requirements: [] }, layout: makeLayout({}) });
  assert.match(user.content, /- R1 \[required\] Go services/);
  assert.match(user.content, /- R2 \[required\] Containers/);
  assert.ok(!/- R3 /.test(user.content), 'a requirement the candidate cannot show has no number');
  assert.match(sys.content, /list in proves/);
  assert.equal(user.content.match(/write about (\d+) lines/) !== null, true);
});

// Must include: the tick is a guarantee, in the validator, the clean-up and the trimmer.
const tickedProfile = { ...pickerProfile, projects: [{ ...pickerProfile.projects[1], mustInclude: true }, pickerProfile.projects[0]] };

test('must include: a missing or short ticked entry goes back for repair', () => {
  const c = pickerComp();
  assert.ok(validateComposition(c, tickedProfile, pickerMatch).errors.some(e => e.code === 'must_include' && e.message.includes('proj:6')));
  c.projects.push({ id: 'proj:6', bullets: [bl('Shipped k', 'proj:6.b1')] });
  assert.ok(validateComposition(c, tickedProfile, pickerMatch).errors.some(e => e.code === 'must_include' && e.message.includes('at least 2')));
  c.projects[1].bullets.push(bl('Shipped l', 'proj:6.b2'));
  assert.ok(!validateComposition(c, tickedProfile, pickerMatch).errors.some(e => e.code === 'must_include'));
});

test('must include: after the repairs, the profile\'s own lines fill the gap', () => {
  const c = pickerComp();
  const { errors } = validateComposition(c, tickedProfile, pickerMatch);
  const { comp, restored } = sanitizeComposition(c, errors, tickedProfile);
  const entry = comp.projects.find(p => p.id === 'proj:6');
  assert.deepEqual(entry.bullets.map(b => b.text), ['k', 'l']);
  assert.deepEqual(entry.bullets[0].sources, ['proj:6.b1']);
  assert.equal(restored.length, 2);
  // Nothing to do when the model complied, and no repeats when it half complied.
  const half = pickerComp();
  half.projects.push({ id: 'proj:6', bullets: [bl('Reworded k', 'proj:6.b1')] });
  const r = sanitizeComposition(half, [], tickedProfile);
  assert.deepEqual(r.comp.projects.find(p => p.id === 'proj:6').bullets.map(b => b.text), ['Reworded k', 'l']);
  assert.deepEqual(sanitizeComposition(pickerComp(), [], pickerProfile).restored, []);
});

test('must include: the trimmer keeps a ticked project and two of its bullets', () => {
  const c = pickerComp();
  c.projects.push({ id: 'proj:6', bullets: [bl('Shipped k', 'proj:6.b1'), bl('Shipped l', 'proj:6.b2'), bl('Shipped more', 'proj:6.b2')] });
  const L = makeLayout({});
  const offset = L.capacityPx - estimateDocHeight(L, toResumeDoc(c, tickedProfile), extraText) + 5 * L.kinds.bullet.lineHeight;
  const fit = fitComposition(c, tickedProfile, pickerMatch, L, { offsetPx: offset });
  assert.ok(fit.trimmed.length);
  assert.equal(fit.comp.projects.find(p => p.id === 'proj:6').bullets.length, 2, fit.trimmed.join('; '));
  // Untick it and the same page can drop it: the tick is what protects it.
  const free = fitComposition(c, pickerProfile, pickerMatch, L, { offsetPx: offset + 6 * L.kinds.bullet.lineHeight });
  assert.ok(!free.comp.projects.some(p => p.id === 'proj:6'), free.trimmed.join('; '));
});
