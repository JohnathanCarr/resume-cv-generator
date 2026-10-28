// node --test 'test/unit/*.test.mjs'
// The profile data helpers, the checklist state and the API key status text:
// the parts of the Profile tab, Getting Started and Settings that run without
// a page. Their UI is covered by scripts/smoke.sh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXTRA_TYPES, migrateEducation } from '../../extension/profile/profileData.js';
import { GettingStarted } from '../../extension/gettingStarted.js';
import { Settings } from '../../extension/settings.js';
import { TOUR_STEPS } from '../../extension/onboarding.js';

test('extras types: eight, each with a value and a label', () => {
  assert.equal(EXTRA_TYPES.length, 8);
  assert.deepEqual(EXTRA_TYPES.map(([value]) => value), ['research', 'program', 'certification', 'award', 'publication', 'leadership', 'volunteer', 'other']);
  assert.ok(EXTRA_TYPES.every(([, label]) => label && label[0] === label[0].toUpperCase()));
});

test('migrateEducation keeps arrays, converts the old single object, drops empty ones', () => {
  const list = [{ institution: 'State' }];
  assert.equal(migrateEducation(list), list);
  assert.deepEqual(migrateEducation(null), []);
  assert.deepEqual(migrateEducation({ university: '', major: '  ' }), []);
  const [entry] = migrateEducation({ university: 'State University', major: 'CS', gpa: '3.8' });
  assert.equal(entry.institution, 'State University');
  assert.equal(entry.major, 'CS');
  assert.equal(entry.gpa, '3.8');
  assert.equal(entry.degreeType, '');
  assert.match(entry.id, /^\d+$/);
});

test('checklist state comes from the live app', () => {
  const app = { uploadedResume: null, profile: { name: '  ' }, apiKey: null, onboarding: null };
  const gs = new GettingStarted(app);
  assert.deepEqual(gs.checklistState(), { resume: false, name: false, key: false, generated: false });
  Object.assign(app, { uploadedResume: { name: 'r.pdf' }, profile: { name: 'Dana' }, apiKey: { value: 'sk-x' }, onboarding: { firstGeneratedAt: '2026-10-28' } });
  assert.deepEqual(gs.checklistState(), { resume: true, name: true, key: true, generated: true });
});

test('API key status text: verified, rejected, unverified note, or just saved', () => {
  const app = { apiKey: null };
  const settings = new Settings(app);
  assert.deepEqual(settings.describeApiKeyStatus(), { text: '', kind: '' });
  app.apiKey = { value: 'sk-x', savedAt: '2026-10-01T12:00:00Z', verifiedAt: '2026-10-02T12:00:00Z' };
  assert.equal(settings.describeApiKeyStatus().kind, 'ok');
  assert.match(settings.describeApiKeyStatus().text, /^Verified /);
  app.apiKey = { value: 'sk-x', savedAt: '2026-10-01T12:00:00Z', verifyError: 'OpenAI rejected this key.' };
  assert.deepEqual(settings.describeApiKeyStatus(), { text: 'OpenAI rejected this key.', kind: 'error' });
  app.apiKey = { value: 'sk-x', savedAt: '2026-10-01T12:00:00Z', verifyNote: 'Saved, not verified: offline' };
  assert.deepEqual(settings.describeApiKeyStatus(), { text: 'Saved, not verified: offline', kind: '' });
  app.apiKey = { value: 'sk-x', savedAt: '2026-10-01T12:00:00Z' };
  assert.match(settings.describeApiKeyStatus().text, /· not verified yet$/);
});

test('the tour has seven steps; each targeted step names an element', () => {
  assert.equal(TOUR_STEPS.length, 7);
  assert.equal(TOUR_STEPS[0].target, null);
  for (const step of TOUR_STEPS.slice(1)) {
    assert.ok(typeof step.target === 'string' && step.target.length, `step "${step.title}" has no target`);
    assert.ok(step.title && step.body, 'step without title or body');
  }
});
