// node --test 'test/unit/*.test.mjs'
// The match report beside the resume preview (extension/preview/matchHtml.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMatchReport, evidenceName } from '../../extension/preview/matchHtml.js';

const EVIL = '<img src=x onerror=alert(1)>';
const profile = {
  location: 'Austin, TX',
  skills: ['Go', 'PostgreSQL', 'Docker'],
  experiences: [{ id: '3', title: 'Engineer', company: 'Harbor', bullets: ['Built Go services'] }],
  projects: [{ id: '5', name: 'tidepool', bullets: [] }],
  education: [{ id: '1', degreeType: 'BS', institution: 'State University' }],
  extras: [{ id: '2', title: 'AWS Developer', type: 'certification' }]
};
const match = {
  keywords: [
    { term: 'Go', importance: 'core', alias: '' },
    { term: 'Docker', importance: 'core', alias: '' },
    { term: 'Kubernetes', importance: 'core', alias: '' },
    { term: 'teamwork', importance: 'supporting', alias: '' }
  ],
  requirements: [
    { text: 'Go services', kind: 'required', strength: 'strong', evidence: ['exp:3', 'skill:Go'] },
    { text: 'Kubernetes', kind: 'required', strength: 'none', evidence: [] },
    { text: 'AWS', kind: 'preferred', strength: 'partial', evidence: ['[extra:2]'] }
  ],
  hard_requirements: [
    { type: 'location', text: 'Austin, TX', kind: 'required', met: 'yes', evidence: ['profile:location'] },
    { type: 'clearance', text: 'Secret clearance', kind: 'required', met: 'unknown', evidence: [] }
  ]
};
const coverage = { before: { found: 1, total: 3 }, after: { found: 1, total: 3, missing: ['Docker', 'Kubernetes'] } };

test('evidence ids read as names', () => {
  assert.equal(evidenceName('exp:3', profile), 'Engineer, Harbor');
  assert.equal(evidenceName('[extra:2]', profile), 'AWS Developer');
  assert.equal(evidenceName('edu:1', profile), 'BS, State University');
  assert.equal(evidenceName('profile:workAuthorization', profile), 'Work authorization');
  assert.equal(evidenceName('exp:99', profile), '');
});

test('the report lists requirements, screening questions and keywords', () => {
  const html = formatMatchReport(match, profile, coverage);
  assert.match(html, /1 of 2 required qualifications shown · 1 of 3 key keywords · 1 screening question to check/);
  assert.match(html, /Go services<\/span><span class="match-evidence">Engineer, Harbor · Go<\/span>/);
  assert.match(html, /<h3>Preferred<\/h3>.*AWS Developer/s);
  assert.match(html, /add it in your profile \(Security clearance\)/);
  assert.match(html, /In your profile, not on this page:<\/span> <span class="match-chip match-partial">Docker/);
  assert.match(html, /Not in your profile:<\/span> <span class="match-chip match-no">Kubernetes/);
  assert.ok(!html.includes('teamwork'), 'supporting keywords are not listed');
  assert.ok(!/score|pass/i.test(html.replace(/class="[^"]*"/g, '')), 'no ATS score or pass claims');
});

test('posting and model text is escaped; nothing to report gives nothing', () => {
  const html = formatMatchReport({ requirements: [{ text: EVIL, kind: 'required', strength: 'none', evidence: [] }], keywords: [EVIL] }, profile, null);
  assert.ok(!html.includes('<img'));
  assert.equal(formatMatchReport(null, profile), '');
  assert.equal(formatMatchReport({ requirements: [], keywords: [] }, profile), '');
});
