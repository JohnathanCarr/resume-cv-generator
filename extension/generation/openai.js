// Minimal OpenAI client over fetch. Replaces the `openai` npm SDK so the same
// code runs in the extension page and under Node (evals). The client mirrors
// the SDK's call shape (`chat.completions.create`, `responses.create`) so the
// prompt modules are unaware of the swap.
//
// The key lives in memory for the life of the client and goes only to
// api.openai.com as a bearer token; it is never logged or echoed in errors.

import { CONFIG } from './config.js';

const API_BASE = 'https://api.openai.com/v1';
// The proxy used a 2-minute request timeout; keep the same ceiling per call.
const CALL_TIMEOUT_MS = 120000;

// OpenAI errors can carry the key in some messages' request details; strip anything key-shaped.
export function safeErrorMessage(error) {
  return String(error && error.message || 'Unknown error').replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-***');
}

export class OpenAIError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = 'OpenAIError';
    this.status = status;
    this.code = code;
  }
}

async function post(apiKey, path, body) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS)
    });
  } catch (error) {
    const timedOut = error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new OpenAIError(timedOut ? 'OpenAI took too long to respond. Try again.' : `Could not reach OpenAI: ${safeErrorMessage(error)}`, { code: timedOut ? 'timeout' : 'network' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data && data.error && data.error.message;
    throw new OpenAIError(safeErrorMessage({ message: detail || `OpenAI returned HTTP ${res.status}` }), { status: res.status, code: data && data.error && data.error.code });
  }
  return data;
}

export function createClient(apiKey) {
  if (!apiKey) throw new OpenAIError('Missing API key. Add your OpenAI key in Settings.', { status: 401 });
  return {
    chat: { completions: { create: (body) => post(apiKey, '/chat/completions', body) } },
    responses: {
      create: async (body) => {
        const response = await post(apiKey, '/responses', body);
        // The SDK synthesises output_text from the message items; do the same.
        if (response.output_text === undefined) {
          response.output_text = (response.output || [])
            .filter(o => o.type === 'message')
            .flatMap(o => o.content || [])
            .filter(c => c.type === 'output_text')
            .map(c => c.text)
            .join('');
        }
        return response;
      }
    }
  };
}

// Runs one generation call with a strict schema and returns the parsed object.
export async function generateStructured(openai, { messages, schema, schemaName, maxTokens }) {
  const completion = await openai.chat.completions.create({
    model: CONFIG.GENERATION_MODEL,
    reasoning_effort: CONFIG.REASONING.generate,
    max_completion_tokens: maxTokens,
    messages,
    response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } }
  });
  const choice = completion.choices[0];
  if (choice.finish_reason === 'length') {
    throw new OpenAIError('The model ran out of room before finishing. Try again or shorten the job posting.', { code: 'output_truncated' });
  }
  return { data: JSON.parse(choice.message.content), usage: completion.usage };
}

// Confirms a key works with one minimal request. Returns the model that answered.
export async function verifyKey(apiKey) {
  const openai = createClient(apiKey);
  try {
    const completion = await openai.chat.completions.create({
      model: CONFIG.VERIFY_MODEL,
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      max_completion_tokens: CONFIG.MAX_COMPLETION_TOKENS.verify,
      reasoning_effort: CONFIG.REASONING.verify
    });
    return { ok: true, model: completion.model };
  } catch (error) {
    if (error.status === 401) throw new OpenAIError('OpenAI rejected this key. Check it and try again.', { status: 401 });
    throw error;
  }
}
