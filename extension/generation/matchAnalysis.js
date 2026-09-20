// Match analysis: reads the job posting against the candidate's profile and
// returns a structured comparison that both generators consume. This is the
// only place the company, role and requirements are extracted — never by regex.
//
// Every requirement carries `evidence`: ids of profile items that support it
// (exp:<id>, proj:<id>, edu:<id>, extra:<id>, skill:<name>). A requirement
// with strength "none" has no evidence and must not be claimed downstream.

import { CONFIG } from './config.js';
const { GENERATION_MODEL, REASONING } = CONFIG;

// Renders the profile with stable ids so the model can cite items.
function renderProfileWithIds(profile) {
  const lines = [];
  lines.push(`Name: ${profile.name || 'Unknown'}`);
  if (profile.location) lines.push(`Location: ${profile.location}`);
  if (profile.summary) lines.push(`Summary: ${profile.summary}`);

  const edu = Array.isArray(profile.education) ? profile.education : [];
  if (edu.length) {
    lines.push('', 'EDUCATION');
    for (const e of edu) {
      const degree = [e.degreeType, e.major ? `in ${e.major}` : ''].filter(Boolean).join(' ');
      let s = `[edu:${e.id}] ${degree || 'Degree'} — ${e.institution || ''}`;
      if (e.end) s += ` (${e.start ? `${e.start} – ` : ''}${e.end})`;
      if (e.minor) s += `; Minor: ${e.minor}`;
      if (e.gpa) s += `; GPA ${e.gpa}`;
      if (e.honors) s += `; Honors: ${e.honors}`;
      if (e.coursework) s += `; Coursework: ${e.coursework}`;
      lines.push(s);
    }
  }

  const skills = Array.isArray(profile.skills) ? profile.skills : [];
  if (skills.length) {
    lines.push('', 'SKILLS');
    lines.push(skills.map(s => `[skill:${s}]`).join(' '));
  }

  const exps = Array.isArray(profile.experiences) ? profile.experiences : [];
  if (exps.length) {
    lines.push('', 'EXPERIENCE');
    for (const x of exps) {
      lines.push(`[exp:${x.id}] ${x.title || ''} — ${x.company || ''}${x.location ? `, ${x.location}` : ''}${x.start || x.end ? ` (${x.start || ''} – ${x.end || ''})` : ''}${x.mustInclude ? ' [MUST INCLUDE]' : ''}`);
      if (x.description) lines.push(`  ${x.description}`);
      for (const b of x.bullets || []) lines.push(`  • ${b}`);
    }
  }

  const projects = Array.isArray(profile.projects) ? profile.projects : [];
  if (projects.length) {
    lines.push('', 'PROJECTS');
    for (const p of projects) {
      lines.push(`[proj:${p.id}] ${p.name || ''}${p.description ? ` — ${p.description}` : ''}${p.mustInclude ? ' [MUST INCLUDE]' : ''}`);
      for (const b of p.bullets || []) lines.push(`  • ${b}`);
    }
  }

  const extras = Array.isArray(profile.extras) ? profile.extras : [];
  if (extras.length) {
    lines.push('', 'CERTIFICATIONS & ACHIEVEMENTS');
    for (const x of extras) {
      lines.push(`[extra:${x.id}] (${x.type || 'other'}) ${x.title || ''}${x.organization ? ` — ${x.organization}` : ''}${x.end ? ` (${x.start ? `${x.start} – ` : ''}${x.end})` : ''}${x.description ? `: ${x.description}` : ''}`);
    }
  }

  return lines.join('\n');
}

const MATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    company: { type: 'string', description: 'Company name exactly as written in the posting; empty string if the posting does not say.' },
    role: { type: 'string', description: 'Job title exactly as written in the posting.' },
    seniority: { type: 'string', enum: ['intern', 'entry', 'mid', 'senior', 'lead', 'unknown'] },
    location: { type: 'string', description: 'Location or work arrangement from the posting; empty if absent.' },
    about_company: { type: 'string', description: 'What the posting itself says about the company, team, product or mission, in at most 60 words. Only facts stated in the posting. Empty if it says nothing.' },
    requirements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', description: 'The requirement, close to the posting\'s own wording.' },
          kind: { type: 'string', enum: ['required', 'preferred'] },
          evidence: { type: 'array', items: { type: 'string' }, description: 'Profile item ids that genuinely support this requirement. Empty if none.' },
          strength: { type: 'string', enum: ['strong', 'partial', 'none'] }
        },
        required: ['text', 'kind', 'evidence', 'strength']
      }
    },
    keywords: { type: 'array', items: { type: 'string' }, description: 'Skills, tools and phrases from the posting that an applicant tracking system would match on, in the posting\'s exact wording. Include all of them, whether or not the candidate has them.' }
  },
  required: ['company', 'role', 'seniority', 'location', 'about_company', 'requirements', 'keywords']
};

const SYSTEM = `You compare a job posting with a candidate's profile. Be literal and careful.

Rules:
- company and role come only from the posting. If the posting does not name the company, return an empty string; never guess.
- List every requirement and qualification in the posting, one per entry, marking each as required or preferred. Keep the posting's wording.
- For each requirement, cite the profile ids that genuinely support it. Cite an item only if it demonstrates the requirement, not merely mentions a related word. strength is "strong" when the evidence clearly meets it, "partial" when it is adjacent or below the stated bar (for example fewer years, related tool, coursework only), and "none" when nothing in the profile supports it — in which case evidence must be empty.
- keywords are the posting's exact terms an applicant tracking system would look for: languages, tools, frameworks, methodologies, certifications, and short phrases like "incident response". Do not paraphrase them.
- about_company contains only what the posting says. Do not add outside knowledge.`;

async function analyzeMatch(openai, { profile, jobText }) {
  const completion = await openai.chat.completions.create({
    model: GENERATION_MODEL,
    reasoning_effort: REASONING.extract,
    max_completion_tokens: 3000,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `JOB POSTING:\n${jobText}\n\nCANDIDATE PROFILE:\n${renderProfileWithIds(profile)}` }
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'match_analysis', strict: true, schema: MATCH_SCHEMA } }
  });

  const match = JSON.parse(completion.choices[0].message.content);
  // Belt and braces: a requirement with no evidence cannot be strong/partial.
  for (const r of match.requirements) if (!r.evidence.length) r.strength = 'none';
  return match;
}

// Text block the generators receive. Keeps the ids so prompts can refer back.
function renderMatchForPrompt(match) {
  const company = match.company || 'the company (not named in the posting)';
  const lines = [`Company: ${company}`, `Role: ${match.role || 'the role'}`, `Seniority: ${match.seniority}`];
  if (match.location) lines.push(`Location: ${match.location}`);
  if (match.about_company) lines.push(`About the company (from the posting only): ${match.about_company}`);
  lines.push('', 'Requirements and how the candidate matches:');
  for (const r of match.requirements) {
    lines.push(`- [${r.kind}] ${r.text} → ${r.strength.toUpperCase()}${r.evidence.length ? ` (evidence: ${r.evidence.join(', ')})` : ''}`);
  }
  lines.push('', `ATS keywords from the posting: ${match.keywords.join(', ')}`);
  return lines.join('\n');
}

export { analyzeMatch, renderProfileWithIds, renderMatchForPrompt, MATCH_SCHEMA };
