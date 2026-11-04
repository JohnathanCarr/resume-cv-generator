// The prompt for tailoring v2's composer (compose.js holds the contract and
// the checks; pipeline.js composeResume() runs it). The model writes a
// one-page resume for one posting from the whole profile; every rule here is
// also enforced in code by validateComposition(), so the prompt explains the
// rules and the validator makes them hold. Pure.

import { renderProfileForCompose, toResumeDoc, entryRelevance, numberedRequirements } from './compose.js';
import { renderMatchForPrompt } from './matchAnalysis.js';
import { keywordTerms, normalizeTerm, corpusHas, profileCorpus } from './keywords.js';
import { estimateDocHeight } from './layout.js';
import { extraText } from './resumeDoc.js';

const SYSTEM = `You write a candidate's resume for one job posting, using only the candidate's own profile. The resume must get past applicant tracking systems and then convince a recruiter in a few seconds, without one word that is not true.

How ATS screening works, and what to do about it:
- Recruiters search the ATS for the posting's exact terms and AI graders check each required qualification against the resume's text. So every requirement the candidate really meets must be visible in plain words, in the posting's own terms, with a concrete line that proves it.
- Use each core keyword the candidate genuinely has at least once, in the posting's own wording. The posting's headline requirements (its required skills and main themes) go both in Skills and in a bullet or the summary that shows them; secondary tools may sit in Skills only. Do not force every keyword into a bullet: a bullet crammed with tool names reads worse and scores no better. Never use a keyword more than three times.
- Spell out an acronym only where the analysis says the posting uses both forms, once, in the summary or a bullet ("Search Engine Optimization (SEO)"); otherwise use the posting's form alone.

Truth (checked in code; anything that fails is removed):
1. Every summary and bullet line cites the ids of the profile lines it comes from (sources). A bullet under a job or project must cite at least one line of that same job or project; it may also cite skills.
2. No number that is not in the cited lines. Do not count years of experience or invent percentages, team sizes or dates.
3. No tool, technology, company, product or credential that is not in the cited lines or the profile's skills. A keyword listed under "Gaps" is something the candidate does not have: never claim it.
4. Every claim must be what the sources say or directly imply. Do not inflate scope, seniority or results.
5. Job titles, employers, dates and education are filled in from the profile by code; you only choose which jobs, projects, education and extras appear, by id.

Content:
- Summary (always; it sits under a "Summary" heading at the top): 2–3 lines that align the candidate with this exact job: what they are in the posting's terms, their strongest evidence for the posting's main theme and requirements, and its top core keywords. Do not repeat what the page already shows elsewhere (the degree, job titles, a list of employers). Concrete, not generic ("Backend engineer who built and shipped a high-traffic payments API…", not "Software engineer passionate about…"). It may use the posting's job title only if the candidate's experience truly matches it. Do not name the hiring company.
- Skills: this is the cheapest, highest-yield section, since recruiters search it and one line holds 8–10 items. List every skill the posting asks for that the profile has, plus the profile's real tools from the same stack, even ones the posting does not name (a full-stack role also wants the candidate's databases, testing and deployment tools). Usually 4–7 groups and 20–35 items when the profile has them; a long profile list is something to choose from, not to copy. Leave out tools unrelated to this job (a game engine on a web role, data-science libraries on a mobile role) and merge duplicates and near-duplicates into one name ("PostgreSQL" covers "psycopg"). Only skills from the profile, grouped under short labels ("Languages", "Frontend", "Databases", "Cloud & DevOps"). Every item must fit its group's label: databases go together, and no catch-all groups. Groups and the items in each go in the order the posting stresses them, and the posting's framing decides what leads: a posting that wants AI tools used to work faster leads that group with those tools, while one that wants AI systems built leads with the models and infrastructure. When the profile has a skill in the posting's exact words ("REST APIs", "CI/CD"), keep those words. Each item is one skill's name in the posting's wording (the listed alias when the posting uses the other form): never a description ("scalable systems", "fast learner"), never a near-duplicate of another item ("unit testing" and "unit tests"), never an acronym spelled out in brackets. Brackets only for a different name of the same thing, the posting's spelling with the profile's in brackets ("PostgreSQL (Postgres)").
- Room goes by relevance, job or project alike: the analysis below rates each job and project for this posting. A highly relevant entry gets 3–5 bullets whether it is a job or a project; a weakly relevant one 1 (a short contract or side role usually needs one bullet, merging similar bullets). Every job from the last five years appears (code puts them newest first by date) with at least one bullet, the most recent with at least two; older jobs that do nothing for this posting may be left out. When the profile has projects, include the most relevant one or two.
- An entry marked [MUST INCLUDE] always appears, with at least 2 bullets when the profile has them, however relevant it looks to this posting: the candidate chose it.
- Within each entry, the bullet that best proves the posting's main requirements comes first. For every bullet, list in proves the numbers of the requirements it really proves (see "Requirements by number"), or none; code keeps the bullets that prove the most, so an honest list is what keeps a good bullet on the page.
- Write a little more than fits: code cuts the bullets that add least, so offer the strongest material from both jobs and projects rather than stopping early. A relevant project should offer 3 or more bullets when the profile has them.
- Bullets: reword them as needed for this posting, keeping them true to their sources. Lead with what was built or achieved and why it matters to this role; keep the specifics that prove it (numbers, scale, the tools this posting cares about) and drop tool lists the posting does not care about. Use the posting's terms for what the source shows, without overselling (a cron job is not "platform engineering"). Similar bullets of one entry may be merged; never merge two strong, different bullets into a vaguer one. Each starts with a past-tense verb and fits one or two lines. No filler ("responsible for", "results-driven", "leveraged", "passionate", "spearheaded", "robust", "seamless", "utilize").
- Extras (certifications, awards, …): include the ones that strengthen this application.
- State any hard requirement the candidate meets (license, clearance, certification, degree) where it belongs. Work authorization and clearance go only at the end of the summary, and only when the posting screens on them, as a short plain clause in the candidate's own terms ("U.S. citizen." or "Active Secret clearance."), citing [profile:workAuthorization] or [profile:clearance]. Do not add legal boilerplate ("legally eligible to work … on an ongoing basis") and never list them under Skills.
- section_order: the order of experience, projects, education and extras after the summary and skills. Usually experience first; education first for students and new graduates with little work history; projects before experience when they are clearly more relevant than the jobs.
- Use the company brief only to decide which of the candidate's experience is closest to the company's product and technology, and lead with that.

One page is a hard limit, enforced in code. The page budget below is how much to write; it runs slightly over what fits so the best lines can be chosen. Use all of it.`;

// Body-text lines and characters per line the page leaves once the fixed
// parts (header, section headings, every job's title line, education) are
// set. A guide for the model; fitComposition() enforces the real limit.
const OVERWRITE_LINES = 5;

function pageBudget(profile, layout) {
  // Every job, school and heading the resume will have, with no body text:
  // one stand-in skills line, project and extra carry their headings (and are
  // subtracted again) when the profile has any.
  const skeleton = {
    summary: { text: '', sources: [] },
    skill_groups: [{ label: '', items: ['x'] }],
    experience: (profile.experiences || []).map(x => ({ id: `exp:${x.id}`, bullets: [] })),
    projects: (profile.projects || []).slice(0, 1).map(x => ({ id: `proj:${x.id}`, bullets: [] })),
    education: (profile.education || []).map(e => ({ id: `edu:${e.id}` })),
    extras: (profile.extras || []).slice(0, 1).map(x => ({ id: `extra:${x.id}` }))
  };
  const doc = toResumeDoc(skeleton, profile);
  const line = layout.kinds.bullet.lineHeight;
  const standIns = [doc.skillGroups, doc.projects, doc.extras].filter(l => (l || []).length).length;
  const fixed = estimateDocHeight(layout, doc, extraText) - standIns * line;
  const limit = layout.capacityPx - line * 0.5;
  // Deliberately over: fitComposition() cuts what adds least, locally.
  const lines = Math.max(10, Math.floor((limit - fixed) / line)) + OVERWRITE_LINES;
  const k = layout.kinds.bullet;
  const charsPerLine = Math.floor(k.width / (layout.textWidth('abcdefghijklmnopqrstuvwxyz', k.font) / 26));
  return { lines, charsPerLine };
}

function renderAnalysis(match, profile) {
  const corpus = profileCorpus(profile);
  const parts = [renderMatchForPrompt(match)];
  const aliases = ((match && match.keywords) || []).filter(k => k && k.alias);
  if (aliases.length) parts.push('', `Other forms of keywords (acronym ↔ full name; "both" = the posting uses both forms): ${aliases.map(k => `${k.term} ↔ ${k.alias}${k.bothForms ? ' (both)' : ''}`).join('; ')}`);
  const numbered = numberedRequirements(match);
  if (numbered.length) parts.push('', 'Requirements by number (for proves):', ...numbered.map(q => `- ${q.id} [${q.kind}] ${q.text}`));
  // How much room each job and project earns for this posting (entryRelevance).
  const rel = [...entryRelevance(profile, match)].sort((a, b) => b[1] - a[1]);
  if (rel.length) {
    const top = rel[0][1];
    const tier = (v) => (v >= top * 0.6 ? 'high' : v >= top * 0.3 ? 'medium' : 'low');
    parts.push('', `Relevance to this posting (room follows it, job or project alike): ${rel.map(([id, v]) => `${id} ${tier(v)}`).join(', ')}`);
  }
  const hard = (match && match.hard_requirements) || [];
  if (hard.length) {
    parts.push('', 'Hard requirements (recruiters and knockout questions screen on these):');
    for (const h of hard) parts.push(`- [${h.kind}] ${h.text} → ${h.met.toUpperCase()}${h.evidence.length ? ` (evidence: ${h.evidence.join(', ')})` : ''}`);
  }
  const gaps = keywordTerms(match, { coreOnly: true }).filter(t => {
    const k = (match.keywords || []).find(x => x && x.term === t);
    return !corpusHas(corpus, normalizeTerm(t)) && !(k && k.alias && corpusHas(corpus, normalizeTerm(k.alias)));
  });
  parts.push('', `Gaps (core keywords the candidate does NOT have; never claim them): ${gaps.join(', ') || 'none'}`);
  return parts.join('\n');
}

// brief: the company brief text (renderBriefForPrompt), or null.
export function buildComposeMessages({ profile, jobText, match, briefText = null, layout }) {
  const budget = pageBudget(profile, layout);
  const user = `JOB POSTING:
${jobText}

ANALYSIS OF THE POSTING AGAINST THE PROFILE:
${renderAnalysis(match, profile)}
${briefText ? `
COMPANY BRIEF (product and technology; use only to decide emphasis):
${briefText}
` : ''}
CANDIDATE PROFILE (cite these ids as sources):
${renderProfileForCompose(profile)}

PAGE BUDGET: write about ${budget.lines} lines of body text in total for the summary, skills lines, bullets, project names and extras (each line holds about ${budget.charsPerLine} characters; a bullet over that wraps to a second line). Job titles, education and section headings are already accounted for.`;
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
}

// The repair message: what the validator rejected, for one more pass.
export function repairMessage(errors) {
  return `Some of the resume cannot be used as written:\n${errors.map(e => `- ${e.target}: ${e.message}`).join('\n')}\n\nReturn the complete resume again with these fixed. Keep everything that was fine.`;
}
