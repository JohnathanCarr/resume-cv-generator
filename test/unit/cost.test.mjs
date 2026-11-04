// node --test 'test/unit/*.test.mjs'
// What a document costs (test/eval/cost.mjs), from the usage OpenAI reports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callCost, documentCost, summariseCosts, watch } from '../eval/cost.mjs';

const MODEL = 'gpt-5.6-terra';
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('chat completions: cached input is cheaper, reasoning is already in output', () => {
  const c = callCost(MODEL, 'resume_composition', { usage: {
    prompt_tokens: 10000, prompt_tokens_details: { cached_tokens: 4000 },
    completion_tokens: 3000, completion_tokens_details: { reasoning_tokens: 2000 }
  } });
  // 6000 × $2 + 4000 × $0.20 + 3000 × $12, per 1M.
  near(c.usd, (12000 + 800 + 36000) / 1e6);
  assert.equal(c.reasoning, 2000);
});

test('responses API: search calls are billed per call, search content as input', () => {
  const c = callCost(MODEL, 'company_brief', {
    usage: { input_tokens: 13000, output_tokens: 500 },
    output: [{ type: 'web_search_call' }, { type: 'web_search_call' }, { type: 'message' }]
  });
  near(c.usd, (13000 * 2 + 500 * 12) / 1e6 + 0.02);
  assert.equal(c.searches, 2);
});

test('a model with no price stops the run instead of reporting a wrong cost', () => {
  assert.throws(() => callCost('gpt-9', 'x', { usage: {} }), /No price for model gpt-9/);
  assert.doesNotThrow(() => callCost(`${MODEL}-2026-05-01`, 'x', { usage: {} }));
});

test('a document adds up its calls; a saved brief removes only the research call', () => {
  const d = documentCost([{ step: 'match_analysis', usd: 0.01 }, { step: 'company_brief', usd: 0.04 }, { step: 'resume_composition', usd: 0.02 }]);
  assert.equal(d.usd, 0.07);
  assert.equal(d.noSearchUsd, 0.03);
});

test('the summary gives typical and worst case', () => {
  const doc = (usd, r) => documentCost([{ step: 'resume_composition', usd }, { step: 'company_brief', usd: r }]);
  const s = summariseCosts([doc(0.01, 0.04), doc(0.02, 0.04), doc(0.06, 0.04)]);
  assert.equal(s.medianUsd, 0.06);
  assert.equal(s.maxUsd, 0.1);
  assert.equal(s.medianNoSearchUsd, 0.02);
  assert.equal(s.medianByStep.company_brief, 0.04);
});

test('watch records OpenAI calls by step and leaves out the judge and other hosts', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ usage: { prompt_tokens: 1000, completion_tokens: 100 } }), { status: 200 });
  try {
    const meter = watch();
    const call = (name, url = 'https://api.openai.com/v1/chat/completions') => fetch(url, { body: JSON.stringify({ model: MODEL, response_format: { json_schema: { name } } }) });
    const res = await call('match_analysis');
    assert.equal((await res.json()).usage.completion_tokens, 100, 'the caller can still read the response');
    await call('recruiter_judge');
    await call('match_analysis', 'https://example.com/');
    const calls = meter.take();
    assert.deepEqual(calls.map(c => c.step), ['match_analysis']);
    assert.deepEqual(meter.take(), [], 'take() empties the list');
  } finally { globalThis.fetch = real; }
});
