// Company research: a short, sourced brief about the employer, built with the
// hosted web-search tool. Every fact carries the URL it came from (or "job
// posting"); if nothing credible is found the brief says so and the letter
// falls back to what the posting itself says. Nothing here may be invented.

import { CONFIG } from './config.js';
const { GENERATION_MODEL, REASONING, RESEARCH } = CONFIG;

const fact = {
  type: 'object',
  additionalProperties: false,
  properties: {
    fact: { type: 'string', description: 'One specific, checkable statement in plain words.' },
    source_url: { type: 'string', description: 'The page this came from, or "job posting".' }
  },
  required: ['fact', 'source_url']
};

const BRIEF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    found: { type: 'boolean', description: 'True only if credible pages about this specific company were found.' },
    what_they_build: { type: 'string', description: 'What the company makes and for whom, in one or two sentences. Empty if not found.' },
    what_they_care_about: { type: 'array', items: fact, description: 'Stated values, engineering or product principles, how they describe their culture.' },
    current_priorities: { type: 'array', items: fact, description: 'What they are building, launching, expanding or hiring for right now.' },
    challenges_or_context: { type: 'array', items: fact, description: 'Stage, scale, market pressure, recent changes — anything that frames why this role exists.' },
    notes: { type: 'string', description: 'Anything the writer should know, e.g. "small company, only the posting and a LinkedIn page found". Empty if none.' }
  },
  required: ['found', 'what_they_build', 'what_they_care_about', 'current_priorities', 'challenges_or_context', 'notes']
};

const INSTRUCTIONS = `You research an employer for someone writing a cover letter. Your job is to find what the company works on, what matters to them, and what they are focused on right now, so the applicant can speak to it honestly.

Method:
- Run at most ${'${MAX_SEARCHES}'} web searches. Good targets: the company's own site (about, careers, engineering or product blog), recent announcements, and coverage from the last two years.
- Prefer the company's own words. Values and priorities are usually stated outright on about/careers pages and in blog posts.
- Every fact must come from a page you actually read; put its URL in source_url. Facts taken from the job posting use "job posting" as the source.
- If the company is small or obscure and you find nothing credible, set found=false, leave the lists empty and say so in notes. Do not fill gaps with guesses, generic statements, or facts about a different company with a similar name.
- Keep each list to at most 4 items. Plain language, no marketing adjectives.`;

// Counts web_search_call items so the UI can show what the research cost.
function countSearches(response) {
  return (response.output || []).filter(o => o.type === 'web_search_call').length;
}

async function researchCompany(openai, { company, role, aboutCompany, jobText }) {
  const input = `Company: ${company}
Role being applied for: ${role || 'unknown'}
What the job posting says about the company: ${aboutCompany || '(nothing beyond the role itself)'}

Job posting excerpt (for disambiguation only):
${String(jobText || '').slice(0, 1500)}`;

  const response = await openai.responses.create({
    model: GENERATION_MODEL,
    reasoning: { effort: REASONING.extract },
    max_output_tokens: 2500,
    tools: [{ type: 'web_search', search_context_size: RESEARCH.searchContextSize }],
    instructions: INSTRUCTIONS.replace('${MAX_SEARCHES}', String(RESEARCH.maxSearches)),
    input,
    text: { format: { type: 'json_schema', name: 'company_brief', strict: true, schema: BRIEF_SCHEMA } }
  });

  const brief = JSON.parse(response.output_text);
  brief.company = company;
  brief.researchedAt = new Date().toISOString();
  brief.searches = countSearches(response);
  brief.tokens = response.usage ? { input: response.usage.input_tokens, output: response.usage.output_tokens } : null;
  return brief;
}

// A brief built only from the posting, used when research is off or the
// company is unnamed. Same shape, so the writer prompt does not care.
function briefFromPostingOnly({ company, aboutCompany }) {
  return {
    company: company || '',
    found: false,
    what_they_build: aboutCompany || '',
    what_they_care_about: [],
    current_priorities: [],
    challenges_or_context: [],
    notes: 'No web research; only the job posting was used.',
    researchedAt: new Date().toISOString(),
    searches: 0,
    tokens: null
  };
}

function renderBriefForPrompt(brief) {
  const lines = [];
  if (!brief || (!brief.found && !brief.what_they_build)) {
    return 'Nothing is known about the company beyond the job posting. Do not describe the company in any way the posting does not support.';
  }
  lines.push(`What they build: ${brief.what_they_build || '(not found)'}`);
  const section = (title, items) => {
    if (!items || !items.length) return;
    lines.push('', `${title}:`);
    for (const it of items) lines.push(`- ${it.fact} [source: ${it.source_url}]`);
  };
  section('What they care about', brief.what_they_care_about);
  section('Current priorities', brief.current_priorities);
  section('Context and challenges', brief.challenges_or_context);
  if (brief.notes) lines.push('', `Researcher's note: ${brief.notes}`);
  lines.push('', 'Only these facts (and the job posting) may be used to describe the company. Anything else about the company is off limits.');
  return lines.join('\n');
}

export { researchCompany, briefFromPostingOnly, renderBriefForPrompt, BRIEF_SCHEMA };
