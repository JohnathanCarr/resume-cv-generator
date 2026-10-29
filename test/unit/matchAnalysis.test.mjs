// node --test 'test/unit/*.test.mjs'
// Posting analysis v2: the schema, and cleanMatch()'s checks on the model's answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanMatch, profileIds, MATCH_SCHEMA } from '../../extension/generation/matchAnalysis.js';
import { missingKeywords } from '../../extension/generation/keywords.js';

const profile = {
  location: 'Austin, TX',
  education: [{ id: '1', institution: 'State' }],
  experiences: [{ id: '3', title: 'Engineer', bullets: ['Ran Search Engine Optimization for the store'] }],
  projects: [{ id: '5', name: 'tidepool' }],
  extras: [{ id: '2', title: 'AWS Developer' }],
  skills: ['Go', 'PostgreSQL']
};
const jobText = 'Backend Engineer. Required: Go, PostgreSQL and SEO experience. US work authorization. Nice to have: Kubernetes.';

test('the schema is strict: every object lists all its properties as required', () => {
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false, `${path} allows extra properties`);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), `${path} required list`);
    }
    for (const [k, v] of Object.entries(node.properties || {})) walk(v, `${path}.${k}`);
    if (node.items) walk(node.items, `${path}[]`);
  };
  walk(MATCH_SCHEMA, 'match');
  assert.ok(MATCH_SCHEMA.properties.hard_requirements);
  assert.ok(MATCH_SCHEMA.properties.keywords.items.properties.alias);
});

test('profileIds lists every id the profile shows the model, lower-cased', () => {
  assert.deepEqual([...profileIds(profile)].sort(), ['edu:1', 'exp:3', 'extra:2', 'profile:location', 'proj:5', 'skill:go', 'skill:postgresql']);
});

test('evidence must exist in the profile; a requirement left without any becomes none', () => {
  const match = {
    requirements: [
      { text: 'Go services', kind: 'required', evidence: ['skill:go', 'exp:99'], strength: 'strong' },
      { text: 'Kubernetes', kind: 'preferred', evidence: ['proj:42'], strength: 'partial' }
    ],
    keywords: [],
    hard_requirements: [{ type: 'work_authorization', text: 'US work authorization', kind: 'required', met: 'yes', evidence: ['extra:77'] }]
  };
  const out = cleanMatch(match, { jobText, profile });
  assert.deepEqual(out.requirements[0].evidence, ['skill:go']);
  assert.equal(out.requirements[0].strength, 'strong');
  assert.deepEqual(out.requirements[1], { text: 'Kubernetes', kind: 'preferred', evidence: [], strength: 'none' });
  assert.equal(out.hard_requirements[0].met, 'unknown', 'met without evidence must not stay yes');
  assert.deepEqual(out.checks.droppedEvidence, ['exp:99', 'proj:42', 'extra:77']);
  assert.equal(match.requirements[1].strength, 'partial', 'input was mutated');
});

test('evidence copied with the profile\'s brackets still counts', () => {
  const match = { requirements: [{ text: 'Go', kind: 'required', evidence: ['[exp:3]', ' [skill:Go] ', '[profile:summary]'], strength: 'strong' }], keywords: [], hard_requirements: [
    { type: 'location', text: 'Austin, TX', kind: 'required', met: 'yes', evidence: ['[profile:location]'] }
  ] };
  const out = cleanMatch(match, { jobText, profile });
  assert.deepEqual(out.requirements[0].evidence, ['exp:3', 'skill:Go']);
  assert.equal(out.requirements[0].strength, 'strong');
  assert.equal(out.hard_requirements[0].met, 'yes');
  assert.deepEqual(out.checks.droppedEvidence, ['profile:summary']);
});

test('keywords must be in the posting; the posting\'s wording wins over the alias', () => {
  const match = {
    requirements: [],
    hard_requirements: [],
    keywords: [
      { term: 'Go', importance: 'core', alias: 'Go' },
      { term: 'Search Engine Optimization', importance: 'core', alias: 'SEO' },
      { term: 'Terraform', importance: 'core', alias: '' },
      { term: 'go', importance: 'supporting', alias: '' },
      { term: 'Kubernetes', importance: 'supporting', alias: 'K8s' }
    ]
  };
  const out = cleanMatch(match, { jobText, profile });
  assert.deepEqual(out.keywords.map(k => [k.term, k.alias]), [['Go', ''], ['SEO', 'Search Engine Optimization'], ['Kubernetes', 'K8s']]);
  assert.deepEqual(out.checks.droppedKeywords, ['Terraform']);
});

test('the keyword check counts a skill as present in either form', () => {
  const match = { keywords: [
    { term: 'SEO', importance: 'core', alias: 'Search Engine Optimization' },
    { term: 'Kubernetes', importance: 'core', alias: 'K8s' },
    { term: 'Go', importance: 'core', alias: '' }
  ] };
  assert.deepEqual(missingKeywords(match, profile), ['Kubernetes']);
  // Older matches without aliases still work.
  assert.deepEqual(missingKeywords({ keywords: ['SEO', 'Go'] }, profile), ['SEO']);
});
