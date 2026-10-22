// node --test 'test/unit/*.test.mjs'
// The cover-letter pipeline over a stubbed fetch: no network, no key.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateCoverLetter, retryTruncated, isResearchedBrief } from '../../extension/generation/pipeline.js';

const profile = { name: 'Dana Diaz', skills: ['Go'], experiences: [], projects: [], education: [], extras: [] };
const match = { company: 'Acme', role: 'Engineer', seniority: 'mid', requirements: [], keywords: [] };
const jobText = 'Acme is hiring an Engineer.';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

// Each fetch takes the next queued completion: a letter, or 'truncated'.
function stubCompletions(queue) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body));
    const next = queue.shift();
    if (next === undefined) throw new Error('unexpected extra call');
    const choice = next === 'truncated'
      ? { finish_reason: 'length', message: { content: '' } }
      : { finish_reason: 'stop', message: { content: JSON.stringify(next) } };
    return { ok: true, status: 200, json: async () => ({ choices: [choice], usage: {} }) };
  };
  return calls;
}

const sourced = { coverLetter: 'Sourced letter.', claims: [{ sentence: 'Acme is hiring.', source: 'job posting' }] };
const unsourced = { coverLetter: 'First draft.', claims: [{ sentence: 'I led a team of 40.', source: 'exp:99' }] };

test('retryTruncated retries once on truncation and passes other errors through', async () => {
  let n = 0;
  assert.equal(await retryTruncated(async () => { if (n++ === 0) throw Object.assign(new Error('cut'), { code: 'output_truncated' }); return 'ok'; }), 'ok');
  assert.equal(n, 2);

  n = 0;
  await assert.rejects(retryTruncated(async () => { n++; throw Object.assign(new Error('cut'), { code: 'output_truncated' }); }), /cut/);
  assert.equal(n, 2);

  n = 0;
  await assert.rejects(retryTruncated(async () => { n++; throw Object.assign(new Error('down'), { code: 'network' }); }), /down/);
  assert.equal(n, 1);
});

test('a truncated cover letter is requested again', async () => {
  const calls = stubCompletions(['truncated', sourced]);
  const result = await generateCoverLetter('sk-test', { profile, jobText, match, research: false });
  assert.equal(result.coverLetter, 'Sourced letter.');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].max_completion_tokens, 6000);
});

test('a failed repair keeps the first draft and reports its unsourced claims', async () => {
  stubCompletions([unsourced, 'truncated', 'truncated']);
  const result = await generateCoverLetter('sk-test', { profile, jobText, match, research: false });
  assert.equal(result.coverLetter, 'First draft.');
  assert.equal(result.unsourcedClaims.length, 1);
  assert.equal(result.metadata.repairFailed, true);
  assert.equal(result.metadata.repaired, false);
});

test('only researched briefs are reused from the cache', async () => {
  const postingOnly = { company: 'Acme', found: false, searches: 0, tokens: null, researchedAt: new Date().toISOString() };
  stubCompletions([sourced]);
  let result = await generateCoverLetter('sk-test', { profile, jobText, match, research: false, briefCache: { acme: postingOnly } });
  assert.equal(result.metadata.briefSource, 'posting');

  const researched = { ...postingOnly, source: 'research', found: true, searches: 2 };
  stubCompletions([sourced]);
  result = await generateCoverLetter('sk-test', { profile, jobText, match, research: false, briefCache: { acme: researched } });
  assert.equal(result.metadata.briefSource, 'cache');
});

test('isResearchedBrief reads the source tag, or the shape of older briefs', () => {
  assert.equal(isResearchedBrief({ source: 'research', searches: 0 }), true);
  assert.equal(isResearchedBrief({ source: 'posting' }), false);
  assert.equal(isResearchedBrief({ searches: 0, tokens: null }), false);
  assert.equal(isResearchedBrief({ searches: 2, tokens: { input: 1, output: 1 } }), true);
  assert.equal(isResearchedBrief(undefined), false);
});
