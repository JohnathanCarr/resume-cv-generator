// node --test test/unit/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingKeywords, applyKeywords, keywordTerms, MAX_ASKED } from '../../extension/generation/keywords.js';

const profile = {
  summary: 'Backend engineer',
  skills: ['Go', 'PostgreSQL', 'CI/CD (GitHub Actions)', 'C++'],
  education: [{ coursework: 'Distributed Systems, Operating Systems' }],
  experiences: [{ title: 'Engineer', bullets: ['Built React Native app', 'Ran incident response rotations'] }],
  projects: [{ name: 'Rate limiter', description: 'In Node.js', bullets: [] }],
  extras: [{ title: 'AWS Certified Solutions Architect' }]
};

test('finds keywords the profile never mentions, in posting order', () => {
  const match = { keywords: ['Kubernetes', 'Go', 'Terraform', 'PostgreSQL'] };
  assert.deepEqual(missingKeywords(match, profile), ['Kubernetes', 'Terraform']);
});

test('matches whole terms only, case-insensitively, through punctuation', () => {
  const match = { keywords: ['go', 'Google Cloud', 'React', 'C++', 'C', 'CI/CD', 'Node.js', 'incident response', 'AWS', 'distributed systems'] };
  assert.deepEqual(missingKeywords(match, profile), ['Google Cloud', 'C']);
});

test('drops duplicates', () => {
  const match = { keywords: ['Kubernetes', 'kubernetes', 'Terraform', 'Docker'] };
  assert.deepEqual(missingKeywords(match, profile), ['Kubernetes', 'Terraform', 'Docker']);
});

test('asks only about core keywords', () => {
  const match = { keywords: [
    { term: 'Kubernetes', importance: 'core' },
    { term: 'communication', importance: 'supporting' },
    { term: 'Terraform', importance: 'core' },
    { term: 'fast-paced environment', importance: 'supporting' }
  ] };
  assert.deepEqual(missingKeywords(match, profile), ['Kubernetes', 'Terraform']);
  assert.deepEqual(keywordTerms(match), ['Kubernetes', 'communication', 'Terraform', 'fast-paced environment']);
  assert.deepEqual(keywordTerms(match, { coreOnly: true }), ['Kubernetes', 'Terraform']);
});

test('caps the list at MAX_ASKED, keeping posting order', () => {
  const terms = Array.from({ length: MAX_ASKED + 4 }, (_, i) => `Tool${i}`);
  const match = { keywords: terms.map(term => ({ term, importance: 'core' })) };
  assert.deepEqual(missingKeywords(match, profile), terms.slice(0, MAX_ASKED));
});

test('applyKeywords appends new skills and patches requirement evidence without mutating inputs', () => {
  const match = {
    keywords: ['Kubernetes', 'Terraform'],
    requirements: [
      { text: 'Experience deploying to Kubernetes', kind: 'required', evidence: [], strength: 'none' },
      { text: 'Go services', kind: 'required', evidence: ['skill:Go'], strength: 'strong' },
      { text: 'Terraform and Kubernetes at scale', kind: 'preferred', evidence: ['exp:1'], strength: 'partial' }
    ]
  };
  const { profile: p2, match: m2, added } = applyKeywords(match, profile, ['Kubernetes', 'go', 'Terraform', '']);
  assert.deepEqual(added, ['Kubernetes', 'Terraform']);
  assert.deepEqual(p2.skills.slice(-2), ['Kubernetes', 'Terraform']);
  assert.equal(profile.skills.length, 4);
  assert.deepEqual(m2.requirements[0], { text: 'Experience deploying to Kubernetes', kind: 'required', evidence: ['skill:Kubernetes'], strength: 'partial' });
  assert.deepEqual(m2.requirements[1], match.requirements[1]);
  assert.deepEqual(m2.requirements[2].evidence, ['exp:1', 'skill:Kubernetes', 'skill:Terraform']);
  assert.equal(m2.requirements[2].strength, 'partial');
  assert.equal(match.requirements[0].strength, 'none');
});

test('nothing is missing once accepted keywords are in the profile', () => {
  const match = { keywords: ['Kubernetes'] };
  const { profile: p2 } = applyKeywords(match, profile, ['Kubernetes']);
  assert.deepEqual(missingKeywords(match, p2), []);
});
