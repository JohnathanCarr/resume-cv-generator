// What a generated document costs the user, measured in the eval from the usage
// OpenAI reports on each response. Prices are per 1M tokens, Standard tier, from
// developers.openai.com/api/docs/pricing, read 2026-11-03; update them with the
// model. Search content tokens arrive in the input tokens, so they are priced
// there. Pure, apart from watch(), which observes fetch for one run.

export const PRICES = {
  'gpt-5.6-terra': { input: 2.0, cachedInput: 0.2, output: 12.0 }
};
export const WEB_SEARCH_PER_CALL = 10 / 1000;

// One response's cost: { step, input, cached, output, reasoning, searches, usd }.
// Handles both APIs: chat completions (prompt_tokens) and responses (input_tokens).
// Output tokens already include reasoning. Throws on a model with no price, so a
// model change cannot silently report the wrong cost.
export function callCost(model, step, response) {
  const price = PRICES[model] || PRICES[String(model).replace(/-\d{4}-\d{2}-\d{2}$/, '')];
  if (!price) throw new Error(`No price for model ${model}: add it to test/eval/cost.mjs`);
  const u = (response && response.usage) || {};
  const total = u.prompt_tokens ?? u.input_tokens ?? 0;
  const cached = (u.prompt_tokens_details || u.input_tokens_details || {}).cached_tokens || 0;
  const output = u.completion_tokens ?? u.output_tokens ?? 0;
  const reasoning = (u.completion_tokens_details || u.output_tokens_details || {}).reasoning_tokens || 0;
  const searches = (response && response.output || []).filter(o => o.type === 'web_search_call').length;
  const usd = ((total - cached) * price.input + cached * price.cachedInput + output * price.output) / 1e6 + searches * WEB_SEARCH_PER_CALL;
  return { step, input: total, cached, output, reasoning, searches, usd };
}

// A document's calls added up. noSearchUsd is the same document with a saved
// company brief: everything but the research call.
export function documentCost(calls) {
  const usd = calls.reduce((a, c) => a + c.usd, 0);
  const research = calls.filter(c => c.step === 'company_brief').reduce((a, c) => a + c.usd, 0);
  return { usd: +usd.toFixed(5), noSearchUsd: +(usd - research).toFixed(5), calls };
}

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return 0;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// Typical and worst case across documents of one kind, and each step's median.
export function summariseCosts(costs) {
  const steps = {};
  for (const c of costs) {
    const perStep = {};
    for (const x of c.calls) perStep[x.step] = (perStep[x.step] || 0) + x.usd;
    for (const [k, v] of Object.entries(perStep)) (steps[k] ||= []).push(v);
  }
  const round = (n) => +n.toFixed(4);
  return {
    n: costs.length,
    medianUsd: round(median(costs.map(c => c.usd))),
    maxUsd: round(Math.max(0, ...costs.map(c => c.usd))),
    medianNoSearchUsd: round(median(costs.map(c => c.noSearchUsd))),
    maxNoSearchUsd: round(Math.max(0, ...costs.map(c => c.noSearchUsd))),
    medianByStep: Object.fromEntries(Object.entries(steps).map(([k, v]) => [k, round(median(v))]))
  };
}

// Records every OpenAI call made through fetch, without touching the extension's
// code. take() returns the calls since the last take(). The recruiter judge is an
// eval tool, not something a user pays for, so it is left out.
export function watch() {
  const real = globalThis.fetch;
  let calls = [];
  globalThis.fetch = async (url, init) => {
    const res = await real(url, init);
    if (!String(url).startsWith('https://api.openai.com/') || !res.ok) return res;
    try {
      const body = JSON.parse(init.body);
      const step = body.response_format?.json_schema?.name || body.text?.format?.name || 'other';
      if (step !== 'recruiter_judge') calls.push(callCost(body.model, step, await res.clone().json()));
    } catch (error) {
      if (/No price/.test(error.message)) throw error;
    }
    return res;
  };
  return { take() { const out = calls; calls = []; return out; } };
}
