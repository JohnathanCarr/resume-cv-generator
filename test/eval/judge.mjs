// Recruiter judge for rubric v2: a model reads the posting and the resume's
// text the way a recruiter screening for this job would, and scores it. It
// covers what the deterministic checks cannot: whether the resume reads as
// written for this job, puts the most relevant material first, and is
// specific and credible. Opt in with --judge (one extra model call per resume).

import { createClient, generateStructured } from '../../extension/generation/openai.js';
import { resumeParts } from './scoreV2.mjs';

const DIMENSIONS = ['relevance', 'tailoring', 'specificity', 'readability', 'credibility'];

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: Object.fromEntries([
    ...DIMENSIONS.map(d => [d, { type: 'integer', enum: [1, 2, 3, 4, 5] }]),
    ['notes', { type: 'string', description: 'One or two sentences: the biggest weakness for this posting.' }]
  ]),
  required: [...DIMENSIONS, 'notes']
};

const SYSTEM = `You are an experienced technical recruiter screening resumes for one job posting. Score the resume from 1 to 5 on each dimension, strictly; a 5 is rare.

- relevance: the experience, projects and skills most relevant to this posting are on the page and come first. 1 = mostly irrelevant material leads; 5 = every section opens with what this job needs.
- tailoring: it reads as written for this posting (its terms, its priorities, a summary aimed at this role), not a generic resume with a few keywords added. 1 = generic; 5 = clearly aimed at this job.
- specificity: bullets name concrete work, tools and results rather than duties or vague claims. 1 = vague duties; 5 = concrete and quantified where the facts allow.
- readability: easy to scan in seconds, clear structure, concise bullets, no filler. 1 = dense or muddled; 5 = instantly scannable.
- credibility: claims are plausible and consistent with the roles, dates and level shown; nothing reads inflated. 1 = inflated or inconsistent; 5 = fully believable.

Judge only what is on the page against the posting.`;

function resumeText(resume, profile) {
  const r = resume || {};
  const lines = [profile.name || '', profile.location || ''];
  if (r.summary) lines.push('', 'SUMMARY', r.summary);
  if ((r.skills || []).length) lines.push('', 'SKILLS', ...r.skills);
  for (const [title, list, head] of [['EXPERIENCE', r.experience, e => `${e.title} — ${e.company}${e.dates ? ` (${e.dates})` : ''}`], ['PROJECTS', r.projects, p => p.name]]) {
    if (!(list || []).length) continue;
    lines.push('', title);
    for (const e of list) lines.push(head(e), ...(e.bullets || []).map(b => `• ${b}`));
  }
  const parts = resumeParts(r);
  if (parts.education.length) lines.push('', 'EDUCATION', ...parts.education);
  if (parts.extras.length) lines.push('', 'OTHER', ...parts.extras);
  // Preview highlight markup must not reach the judge.
  return lines.join('\n').replace(/<[^>]+>/g, '');
}

// Returns { score 0–1, dims, notes }.
export async function judgeResume(apiKey, { resume, profile, jobText }) {
  const openai = createClient(apiKey);
  const { data } = await generateStructured(openai, {
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `JOB POSTING:\n${jobText}\n\nRESUME:\n${resumeText(resume, profile)}` }
    ],
    schema: JUDGE_SCHEMA,
    schemaName: 'recruiter_judge',
    maxTokens: 3000
  });
  const dims = Object.fromEntries(DIMENSIONS.map(d => [d, data[d]]));
  const mean = DIMENSIONS.reduce((a, d) => a + data[d], 0) / DIMENSIONS.length;
  return { score: +((mean - 1) / 4).toFixed(3), dims, notes: data.notes };
}
