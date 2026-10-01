// node --test test/unit/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBaseline, isCurrentBaseline, hasSummary, baselineToResume, BASELINE_VERSION } from '../../extension/generation/baseline.js';

// Shaped like ResumeParser.parse().profile
const parsed = {
  name: 'Dana Reyes', contact: 'dana@example.com', location: 'Austin, TX', summary: '',
  skills: ['Go', ' PostgreSQL ', ''],
  skillGroups: [{ label: 'Languages', items: ['Go'] }, { label: 'Data', items: ['PostgreSQL'] }],
  education: [{ institution: 'UT Austin', degreeType: 'B.S.', major: 'Computer Science', start: '2018', end: '2022', gpa: '3.8' }],
  experiences: [
    { title: 'Backend Engineer', company: 'Acme', start: 'Jun 2022', end: 'Present', location: 'Remote', bullets: ['Built billing API', ''] },
    { title: 'Intern', company: 'Initech', start: '', end: '2021', location: '', bullets: ['Wrote tests'] }
  ],
  projects: [{ name: 'Rate limiter', description: 'Go', bullets: ['Handled 10k rps'] }],
  extras: [{ type: 'certification', title: 'AWS Certified Developer', organization: 'Amazon', start: '', end: '2023', description: '' }]
};

test('snapshot gets positional ids and clean bullets', () => {
  const b = createBaseline(parsed, { name: 'resume.pdf', uploadedAt: '2026-10-01T00:00:00Z' });
  assert.equal(b.version, BASELINE_VERSION);
  assert.equal(b.source.name, 'resume.pdf');
  assert.deepEqual(b.resume.experiences.map(e => e.id), ['exp:1', 'exp:2']);
  assert.equal(b.resume.projects[0].id, 'proj:1');
  assert.equal(b.resume.education[0].id, 'edu:1');
  assert.equal(b.resume.extras[0].id, 'extra:1');
  assert.deepEqual(b.resume.experiences[0].bullets, ['Built billing API']);
  assert.deepEqual(b.resume.skills, ['Go', 'PostgreSQL']);
  assert.deepEqual(b.resume.skillGroups, [{ id: 'skills:1', label: 'Languages', items: ['Go'] }, { id: 'skills:2', label: 'Data', items: ['PostgreSQL'] }]);
  assert.ok(isCurrentBaseline(b));
});

test('older or missing snapshots are not current', () => {
  assert.equal(isCurrentBaseline(null), false);
  assert.equal(isCurrentBaseline({ version: BASELINE_VERSION - 1, resume: {} }), false);
});

test('converts to the generator resume shape', () => {
  const r = baselineToResume(createBaseline(parsed));
  assert.equal(r.summary, null);
  assert.deepEqual(r.skills, ['Languages: Go', 'Data: PostgreSQL']);
  assert.deepEqual(r.education[0], { school: 'UT Austin', degree: 'B.S.', major: 'Computer Science', minor: null, location: null, dates: '2018 - 2022', gpa: '3.8', honors: null, coursework: null });
  assert.deepEqual(r.experience[1], { title: 'Intern', company: 'Initech', dates: '2021', location: null, bullets: ['Wrote tests'] });
  assert.deepEqual(r.projects[0], { name: 'Rate limiter | Go', link: null, bullets: ['Handled 10k rps'] });
  assert.deepEqual(r.programs, ['AWS Certified Developer – Amazon (2023)']);
});

test('a resume without skill labels gets one unlabelled line', () => {
  const b = createBaseline({ ...parsed, skillGroups: [] });
  assert.deepEqual(b.resume.skillGroups, [{ id: 'skills:1', label: '', items: ['Go', 'PostgreSQL'] }]);
  assert.deepEqual(baselineToResume(b).skills, ['Skills: Go, PostgreSQL']);
});

test('summary is null when the upload has none', () => {
  assert.equal(hasSummary(createBaseline(parsed)), false);
  assert.equal(baselineToResume(createBaseline(parsed)).summary, null);
  assert.equal(baselineToResume(createBaseline({ ...parsed, summary: 'Backend engineer' })).summary, 'Backend engineer');
});
