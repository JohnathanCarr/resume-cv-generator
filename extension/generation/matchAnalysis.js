// Match analysis: reads the job posting against the candidate's profile and
// returns a structured comparison that both generators consume. This is the
// only place the company, role and requirements are extracted — never by regex.
//
// Every requirement carries `evidence`: ids of profile items that support it
// (exp:<id>, proj:<id>, edu:<id>, extra:<id>, skill:<name>). A requirement
// with strength "none" has no evidence and must not be claimed downstream.
// Hard requirements (work authorization, clearance, license, degree,
// location, years) are listed separately: recruiters filter on them and
// knockout questions mirror them. Each keyword carries its other form
// (acronym ↔ full name) when it has one. cleanMatch() checks the model's
// answer in code: keywords must be in the posting, evidence must exist.

import { CONFIG } from './config.js';
import { keywordTerms, normalizeTerm, corpusHas } from './keywords.js';
const { GENERATION_MODEL, REASONING } = CONFIG;

// Renders the profile with stable ids so the model can cite items.
function renderProfileWithIds(profile) {
  const lines = [];
  lines.push(`Name: ${profile.name || 'Unknown'}`);
  if (profile.location) lines.push(`[profile:location] Location: ${profile.location}`);
  if (profile.workAuthorization) lines.push(`[profile:workAuthorization] Work authorization: ${profile.workAuthorization}`);
  if (profile.clearance) lines.push(`[profile:clearance] Security clearance: ${profile.clearance}`);
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
    keywords: {
      type: 'array',
      description: 'Skills, tools and phrases from the posting that an applicant tracking system would match on, in the posting\'s exact wording, whether or not the candidate has them.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          term: { type: 'string', description: 'The posting\'s exact wording.' },
          importance: { type: 'string', enum: ['core', 'supporting'] },
          alias: { type: 'string', description: 'The term\'s other standard form if it has one: the full name for an acronym ("Search Engine Optimization" for "SEO") or the acronym for a full name. Empty string if none.' }
        },
        required: ['term', 'importance', 'alias']
      }
    },
    hard_requirements: {
      type: 'array',
      description: 'Requirements a recruiter or a knockout question screens on directly. Empty if the posting has none.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['work_authorization', 'sponsorship', 'clearance', 'license', 'certification', 'degree', 'location', 'years_experience', 'other'] },
          text: { type: 'string', description: 'The requirement in the posting\'s own words.' },
          kind: { type: 'string', enum: ['required', 'preferred'] },
          met: { type: 'string', enum: ['yes', 'no', 'unknown'], description: 'yes only when the profile shows it; no when the profile shows otherwise; unknown when the profile does not say.' },
          evidence: { type: 'array', items: { type: 'string' }, description: 'Profile item ids showing it is met. Empty unless met is yes.' }
        },
        required: ['type', 'text', 'kind', 'met', 'evidence']
      }
    }
  },
  required: ['company', 'role', 'seniority', 'location', 'about_company', 'requirements', 'keywords', 'hard_requirements']
};

const SYSTEM = `You compare a job posting with a candidate's profile. Be literal and careful.

Rules:
- company and role come only from the posting. If the posting does not name the company, return an empty string; never guess.
- List every requirement and qualification in the posting, one per entry, marking each as required or preferred. Keep the posting's wording.
- For each requirement, cite the profile ids that genuinely support it. Cite an item only if it demonstrates the requirement, not merely mentions a related word. strength is "strong" when the evidence clearly meets it, "partial" when it is adjacent or below the stated bar (for example fewer years, related tool, coursework only), and "none" when nothing in the profile supports it — in which case evidence must be empty.
- keywords are the posting's exact terms an applicant tracking system would look for: languages, tools, frameworks, methodologies, certifications, and short phrases like "incident response". Do not paraphrase them.
- Mark a keyword "core" only if a recruiter would plausibly filter candidates on it: a concrete, nameable hard skill, tool, language, platform, methodology or certification (usually 1–3 words, e.g. "PyTorch", "A/B testing", "HIPAA") that is in a required qualification or named more than once. Usually 3–8 per posting. Everything else is "supporting": the job title itself, descriptions of experience ("reliable APIs at scale", "applied ML in production"), categories where the posting also names the specific tools ("data visualization tool" when it lists Tableau), preferred or nice-to-have items mentioned once, soft skills ("communication", "ownership"), and generic phrases ("fast-paced environment", "problem solving").
- alias: for each keyword that is an acronym or has a standard acronym, give the other form ("SEO" ↔ "Search Engine Optimization", "CI/CD" ↔ "Continuous Integration/Continuous Delivery", "GCP" ↔ "Google Cloud Platform"). Only an acronym and its full name; never a plural, tense or spelling variant ("A/B tests" is not an alias of "A/B testing") and never a related but different skill. Otherwise an empty string.
- hard_requirements: the things the posting screens on directly — work authorization, visa sponsorship, security clearance, licenses, required certifications, degree level, on-site location, and minimum years of experience. One entry each, in the posting's words. met is "yes" only when the profile shows it (cite the ids; the candidate's location, work authorization and clearance are [profile:location], [profile:workAuthorization] and [profile:clearance]), "no" when the profile shows otherwise, and "unknown" when the profile does not say; never assume.
- about_company contains only what the posting says. Do not add outside knowledge.`;

async function analyzeMatch(openai, { profile, jobText }) {
  const completion = await openai.chat.completions.create({
    model: GENERATION_MODEL,
    reasoning_effort: REASONING.extract,
    max_completion_tokens: 4000,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `JOB POSTING:\n${jobText}\n\nCANDIDATE PROFILE:\n${renderProfileWithIds(profile)}` }
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'match_analysis', strict: true, schema: MATCH_SCHEMA } }
  });

  return cleanMatch(JSON.parse(completion.choices[0].message.content), { jobText, profile });
}

// Every id renderProfileWithIds() gives the model, lower-cased.
function profileIds(profile) {
  const ids = new Set();
  if (profile.location) ids.add('profile:location');
  if (profile.workAuthorization) ids.add('profile:workauthorization');
  if (profile.clearance) ids.add('profile:clearance');
  for (const e of profile.education || []) ids.add(`edu:${e.id}`);
  for (const x of profile.experiences || []) ids.add(`exp:${x.id}`);
  for (const p of profile.projects || []) ids.add(`proj:${p.id}`);
  for (const x of profile.extras || []) ids.add(`extra:${x.id}`);
  for (const s of profile.skills || []) ids.add(`skill:${s}`);
  return new Set([...ids].map(id => id.toLowerCase()));
}

// Checks the model's answer in code and returns it corrected:
// - evidence must name ids the profile has; a requirement left without
//   evidence is "none", and a hard requirement left without it is not "yes";
// - keywords must be in the posting: when only the alias is, the two swap
//   (the posting's wording is the term); otherwise the keyword is dropped.
//   Duplicates and an alias equal to its term are removed.
// What was removed is listed in match.checks. Pure; the input is not mutated.
function cleanMatch(match, { jobText, profile }) {
  const ids = profileIds(profile || {});
  const droppedEvidence = [];
  // The model sometimes copies the brackets the profile shows ("[exp:3]").
  const realIds = (evidence) => (evidence || [])
    .map(id => String(id).trim().replace(/^\[\s*|\s*\]$/g, ''))
    .filter(id => {
      const ok = ids.has(id.toLowerCase());
      if (!ok) droppedEvidence.push(id);
      return ok;
    });
  const requirements = (match.requirements || []).map(r => {
    const evidence = realIds(r.evidence);
    return { ...r, evidence, strength: evidence.length ? r.strength : 'none' };
  });
  const hardRequirements = (match.hard_requirements || []).map(h => {
    const evidence = realIds(h.evidence);
    return { ...h, evidence, met: h.met === 'yes' && !evidence.length ? 'unknown' : h.met };
  });

  const posting = ` ${normalizeTerm(jobText)} `;
  const inPosting = (t) => !!normalizeTerm(t) && corpusHas(posting, normalizeTerm(t));
  const droppedKeywords = [];
  const seen = new Set();
  const keywords = [];
  for (const k of match.keywords || []) {
    let term = String(k.term || '').trim();
    let alias = String(k.alias || '').trim();
    if (!inPosting(term)) {
      if (alias && inPosting(alias)) [term, alias] = [alias, term];
      else { droppedKeywords.push(term); continue; }
    }
    if (normalizeTerm(alias) === normalizeTerm(term)) alias = '';
    const key = normalizeTerm(term);
    if (seen.has(key)) continue;
    seen.add(key);
    keywords.push({ ...k, term, alias });
  }

  return {
    ...match,
    requirements,
    hard_requirements: hardRequirements,
    keywords,
    checks: { droppedKeywords, droppedEvidence }
  };
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
  const core = keywordTerms(match, { coreOnly: true });
  const supporting = keywordTerms(match).filter(t => !core.includes(t));
  lines.push('', `Core ATS keywords (mirror these first): ${core.join(', ') || 'none'}`);
  if (supporting.length) lines.push(`Supporting ATS keywords: ${supporting.join(', ')}`);
  return lines.join('\n');
}

export { analyzeMatch, cleanMatch, profileIds, renderProfileWithIds, renderMatchForPrompt, MATCH_SCHEMA };
