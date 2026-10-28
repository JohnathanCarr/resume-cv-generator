// node --test 'test/unit/*.test.mjs'
// The shared generation flow (extension/generationFlow.js) over a fake app:
// what happens in what order for success, cancel and failure, and the
// resume's own checks. The real page is covered by scripts/smoke.sh.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { runGeneration, COVER_LETTER, RESUME } from '../../extension/generationFlow.js';
import { createTimer, formatTimings } from '../../extension/generation/timing.js';
import { missingKeywords, applyKeywords } from '../../extension/generation/keywords.js';

// Minimal document: the posting textarea and the download buttons.
let elements;
beforeEach(() => {
  elements = { 'job-text': { value: 'Backend Engineer at Northwind' }, 'download-pdf': { disabled: true }, 'download-resume-pdf': { disabled: true } };
  globalThis.document = { getElementById: (id) => elements[id] || null };
});

const match = { company: 'Northwind', role: 'Engineer', requirements: [], keywords: [{ term: 'Go', importance: 'core' }, { term: 'Quokka DB', importance: 'core' }] };

// Records every UI call in order; options shape the run.
function fakeApp({ choice = { accepted: [] }, letter = null, keyOk = true, uploaded = true, baselineOk = true } = {}) {
  const log = [];
  const say = (name) => (...args) => { log.push([name, ...args]); };
  const app = {
    log,
    profile: { name: 'Dana', skills: ['Go'], experiences: [], projects: [], education: [], extras: [] },
    apiKey: { value: 'sk-test' },
    researchEnabled: false,
    companyBriefs: {},
    uploadedResume: uploaded ? { name: 'r.pdf' } : null,
    lastApiCall: null,
    progress: { start: say('progress.start'), mark() {}, pause: say('progress.pause'), resume: say('progress.resume'), done: say('progress.done'), fail: say('progress.fail'), hide: say('progress.hide') },
    showError: say('showError'),
    showStatus: say('showStatus'),
    showLoading: say('showLoading'),
    hideLoading: say('hideLoading'),
    setPageInert: say('setPageInert'),
    renderSkills: say('renderSkills'),
    saveData: async () => { log.push(['saveData']); },
    recordFirstGeneration: say('recordFirstGeneration'),
    requireApiKeyForGeneration: () => keyOk,
    promptForKeywords: async (terms) => { log.push(['promptForKeywords', terms]); return choice; },
    ensureBaseline: async () => baselineOk,
    generation: async () => ({
      createTimer, formatTimings, missingKeywords, applyKeywords,
      analyzeJob: async () => match,
      generateCoverLetter: async () => { if (letter instanceof Error) throw letter; return letter; }
    }),
    displayCoverLetter: say('displayCoverLetter'),
    switchToCoverLetterView: say('switchToCoverLetterView'),
    cacheBrief: async () => { log.push(['cacheBrief']); },
    describeCoverLetterResult: () => 'Cover letter ready.',
    generateCoverLetter: () => log.push(['retry cover letter']),
    generateResume: () => log.push(['retry resume'])
  };
  return app;
}
const names = (log) => log.map(e => e[0]);
const quietly = async (fn) => {
  const { error, info } = console;
  console.error = () => {}; console.info = () => {};
  try { return await fn(); } finally { console.error = error; console.info = info; }
};
const okLetter = { coverLetter: 'Dear team…', claims: [], metadata: { briefSource: 'posting', timings: [{ step: 'letter', ms: 5 }] }, matchAnalysis: match };

test('missing input stops before anything is locked', async () => {
  for (const [setup, message] of [
    [() => { elements['job-text'].value = '  '; }, 'Please enter a job description.'],
    [(app) => { app.profile.name = ''; }, 'Please complete your profile first.']
  ]) {
    elements['job-text'].value = 'Backend Engineer at Northwind';
    const app = fakeApp();
    setup(app);
    await runGeneration(app, COVER_LETTER);
    assert.deepEqual(app.log, [['showError', message, false]]);
  }
  const noKey = fakeApp({ keyOk: false });
  await runGeneration(noKey, COVER_LETTER);
  assert.deepEqual(noKey.log, []);
});

test('the resume needs an uploaded resume', async () => {
  const app = fakeApp({ uploaded: false });
  await runGeneration(app, RESUME);
  assert.equal(app.log.length, 1);
  assert.match(app.log[0][1], /^Upload your current resume in the Profile tab first/);
});

test('cover letter: keywords, generate, then status, Done, first-run tick, download enabled', async () => {
  const app = fakeApp({ choice: { accepted: ['Quokka DB'] }, letter: okLetter });
  await quietly(() => runGeneration(app, COVER_LETTER));
  const seq = names(app.log);
  assert.deepEqual(seq.slice(0, 2), ['showLoading', 'showStatus']);
  assert.deepEqual(app.log.find(e => e[0] === 'promptForKeywords')[1], ['Quokka DB']);
  // The dialog unlocks the page and freezes the bar, then both come back.
  const i = seq.indexOf('promptForKeywords');
  assert.deepEqual(seq.slice(i - 2, i + 3), ['progress.pause', 'setPageInert', 'promptForKeywords', 'setPageInert', 'progress.resume']);
  assert.ok(app.profile.skills.includes('Quokka DB'), 'accepted keyword not added');
  const tail = seq.slice(seq.indexOf('displayCoverLetter'));
  assert.deepEqual(tail, ['displayCoverLetter', 'switchToCoverLetterView', 'saveData', 'showStatus', 'progress.done', 'recordFirstGeneration', 'hideLoading']);
  assert.deepEqual(app.log.at(-3), ['progress.done']);
  assert.equal(elements['download-pdf'].disabled, false);
  assert.deepEqual(app.lastApiCall.timings.steps.map(s => s.step), ['read posting', 'keyword check (you)', 'cover letter']);
  assert.deepEqual(app.lastApiCall.timings.steps[2].parts, [{ step: 'letter', ms: 5 }]);
});

test('cancel in the keyword dialog hides the bar and generates nothing', async () => {
  const app = fakeApp({ choice: null, letter: okLetter });
  await quietly(() => runGeneration(app, COVER_LETTER));
  const seq = names(app.log);
  assert.ok(!seq.includes('displayCoverLetter') && !seq.includes('progress.done'));
  assert.deepEqual(app.log.slice(-3), [['progress.hide'], ['showStatus', 'Cancelled.', 'error'], ['hideLoading']]);
  assert.equal(elements['download-pdf'].disabled, true);
});

test('a failure shows the error with Retry and unlocks the page', async () => {
  const app = fakeApp({ letter: new Error('OpenAI took too long to respond.') });
  await quietly(() => runGeneration(app, COVER_LETTER));
  const err = app.log.find(e => e[0] === 'showError');
  assert.equal(err[1], 'Failed to generate cover letter: OpenAI took too long to respond.');
  err[2]();   // the Retry button
  assert.deepEqual(app.log.at(-1), ['retry cover letter']);
  const seq = names(app.log);
  assert.ok(seq.indexOf('progress.fail') < seq.indexOf('showError'));
  assert.deepEqual(app.log.at(-3), ['showStatus', 'Generation failed', 'error']);
  assert.equal(seq.at(-2), 'hideLoading');
  assert.ok(!seq.includes('progress.done'));
});

test('resume: an unreadable stored resume fails before the keyword check, with resume wording', async () => {
  const app = fakeApp({ baselineOk: false });
  await quietly(() => runGeneration(app, RESUME));
  const seq = names(app.log);
  assert.ok(!seq.includes('promptForKeywords'));
  const err = app.log.find(e => e[0] === 'showError');
  assert.match(err[1], /^Failed to generate resume: your uploaded resume could not be read/);
  err[2]();
  assert.deepEqual(app.log.at(-1), ['retry resume']);
  assert.ok(app.log.some(e => e[0] === 'showStatus' && e[1] === 'Resume generation failed'));
});
