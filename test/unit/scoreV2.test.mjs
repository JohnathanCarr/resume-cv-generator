// node --test 'test/unit/*.test.mjs'
// Resume rubric v2 (test/eval/scoreV2.mjs): each check catches what it should.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreResumeV2 } from '../eval/scoreV2.mjs';

const profile = {
  name: 'Dana Diaz',
  location: 'Austin, TX',
  contact: 'dana@example.com',
  skills: ['Go', 'PostgreSQL', 'Search Engine Optimization', 'Docker'],
  experiences: [
    { id: '3', title: 'Engineer', company: 'Harbor', start: '2022', end: 'Present', bullets: ['Built Go services handling 2M requests a day', 'Ran Search Engine Optimization for the store'] },
    { id: '4', title: 'Intern', company: 'Pine', start: '2021', end: '2021', bullets: ['Wrote PostgreSQL reports'] }
  ],
  projects: [{ id: '5', name: 'tidepool', bullets: ['A Docker job queue'] }],
  education: [{ id: '1', institution: 'State University', degreeType: 'BS', major: 'CS', start: '2017', end: '2021' }],
  extras: []
};
const jobText = 'Backend Engineer. Required: Go, PostgreSQL and SEO. Docker preferred. 2+ years.';
const match = {
  keywords: [
    { term: 'Go', importance: 'core', alias: '' },
    { term: 'PostgreSQL', importance: 'core', alias: '' },
    { term: 'SEO', importance: 'core', alias: 'Search Engine Optimization' },
    { term: 'Kubernetes', importance: 'core', alias: '' }
  ],
  requirements: [
    { text: 'Go', kind: 'required', strength: 'strong', evidence: ['exp:3'] },
    { text: 'PostgreSQL', kind: 'required', strength: 'partial', evidence: ['[exp:4]'] },
    { text: 'Kubernetes', kind: 'required', strength: 'none', evidence: [] }
  ],
  hard_requirements: [{ type: 'years_experience', text: '2+ years', kind: 'required', met: 'yes', evidence: ['exp:3'] }]
};
const good = {
  summary: 'Backend engineer building Go and PostgreSQL services.',
  skills: ['Languages: Go, PostgreSQL', 'Marketing: SEO (Search Engine Optimization)'],
  experience: [
    { title: 'Engineer', company: 'Harbor', dates: '2022 – Present', bullets: ['Built Go services handling 2M requests a day', 'Led Search Engine Optimization (SEO) for the store'] },
    { title: 'Intern', company: 'Pine', dates: '2021', bullets: ['Wrote PostgreSQL reports'] }
  ],
  projects: [{ name: 'tidepool', bullets: ['A Docker job queue'] }],
  education: [{ school: 'State University', degree: 'BS', major: 'CS', dates: '2017 – 2021' }],
  programs: []
};
const page = { fits: true, afterPx: 960, limitPx: 1048 };
const score = (resume, extra = {}) => scoreResumeV2({ resume, profile, jobText, match, page, ...extra });

test('a truthful, tailored resume scores full marks', () => {
  const s = score(good);
  assert.deepEqual(s.fails, []);
  assert.equal(s.score, 1);
  assert.equal(s.info.coverage, '3/3 supported core (4 core)');
  assert.equal(s.info.requirements, '2/2 supported required');
});

test('truth: invented numbers, tools, skills and changed history are caught', () => {
  const s = score({
    ...good,
    skills: ['Languages: Go, PostgreSQL, Rust'],
    experience: [good.experience[1], { ...good.experience[0], title: 'Senior Engineer', bullets: ['Built Go services handling 9M requests on Kubernetes'] }]
  });
  assert.equal(s.checks.noFabricatedNumbers, 0);
  assert.ok(s.info.unsupportedTools.includes('Kubernetes'), 'a posting tool copied into a bullet');
  assert.equal(s.checks.noUnsupportedTools, 0.5);
  assert.equal(s.checks.skillsFromProfile, 0);
  assert.equal(s.checks.historyTruthful, 0);
});

test('match: coverage, requirement proof, acronym pairs, skills in bullets', () => {
  const thin = { ...good, summary: '', skills: ['Languages: Go'], experience: [{ ...good.experience[0], bullets: ['Built services'] }] };
  const s = score(thin);
  assert.equal(s.checks.coreCoverage, +(1 / 3).toFixed(2));
  assert.equal(s.checks.requirementEvidence, 0.5, 'the Pine job (PostgreSQL evidence) is gone');
  assert.equal(s.checks.acronymPairs, 0);
  assert.equal(s.checks.skillsInContext, 0);
  assert.equal(s.checks.summaryPresent, 0);
});

test('page and never-do checks', () => {
  const stuffed = { ...good, summary: 'Go Go Go Go engineer, results-driven and detail-oriented.' };
  const s = score(stuffed, { page: { fits: false, afterPx: 1100, limitPx: 1048 } });
  assert.equal(s.checks.noStuffing, 0);
  assert.equal(s.checks.noFiller, 0);
  assert.equal(s.checks.fitsOnePage, 0);
  assert.equal(score(good, { page: { fits: true, afterPx: 860, limitPx: 1048 } }).checks.pageFill, 0.5);
});

test('skill group labels are headings, not tool claims', () => {
  const s = score({ ...good, skills: ['Cloud & DevOps: Docker', 'Languages: Go, PostgreSQL', 'Marketing: SEO (Search Engine Optimization)'] });
  assert.equal(s.checks.noUnsupportedTools, 1, s.fails.join('; '));
});

test('supported aliases, plain keywords and the posting title in the summary are not tool claims', () => {
  const m = { ...match, role: 'ML Engineer', keywords: [...match.keywords, { term: 'text', importance: 'supporting', alias: '' }, { term: 'CI/CD', importance: 'supporting', alias: 'Continuous Integration/Continuous Delivery' }] };
  const p = { ...profile, skills: [...profile.skills, 'CI/CD'] };
  const r = { ...good, summary: 'ML-focused backend engineer building Go services.', skills: [...good.skills, 'Delivery: CI/CD (Continuous Integration/Continuous Delivery)'], experience: [{ ...good.experience[0], bullets: [...good.experience[0].bullets, 'Cleaned text data'] }, good.experience[1]] };
  const s = scoreResumeV2({ resume: r, profile: p, jobText, match: m, page });
  assert.equal(s.checks.noUnsupportedTools, 1, s.fails.join('; '));
  // In a bullet, ML is still a claim.
  const b = scoreResumeV2({ resume: { ...r, experience: [{ ...good.experience[0], bullets: ['Built ML services'] }, good.experience[1]] }, profile: p, jobText, match: m, page });
  assert.ok(b.info.unsupportedTools.includes('ML'));
});
