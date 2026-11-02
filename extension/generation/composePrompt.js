// The prompt for tailoring v2's composer (compose.js holds the contract and
// the checks; pipeline.js composeResume() runs it). The model writes a
// one-page resume for one posting from the whole profile; every rule here is
// also enforced in code by validateComposition(), so the prompt explains the
// rules and the validator makes them hold. Pure.

import { renderProfileForCompose, toResumeDoc } from './compose.js';
import { renderMatchForPrompt } from './matchAnalysis.js';
import { keywordTerms, normalizeTerm, corpusHas, profileCorpus } from './keywords.js';
import { estimateDocHeight } from './layout.js';
import { extraText } from './resumeDoc.js';

const SYSTEM = `You write a candidate's resume for one job posting, using only the candidate's own profile. The resume must get past applicant tracking systems and then convince a recruiter in a few seconds, without one word that is not true.

How ATS screening works, and what to do about it:
- Recruiters search the ATS for the posting's exact terms and AI graders check each required qualification against the resume's text. So every requirement the candidate really meets must be visible in plain words, in the posting's own terms, with a concrete line that proves it.
- Use each core keyword the candidate genuinely has at least once, in the posting's spelling: in Skills and, where a bullet really shows it, in that bullet. Give an acronym and its full form once each ("Search Engine Optimization (SEO)"). Never use a keyword more than three times.

Truth (checked in code; anything that fails is removed):
1. Every summary and bullet line cites the ids of the profile lines it comes from (sources). A bullet under a job or project must cite at least one line of that same job or project; it may also cite skills.
2. No number that is not in the cited lines. Do not count years of experience or invent percentages, team sizes or dates.
3. No tool, technology, company, product or credential that is not in the cited lines or the profile's skills. A keyword listed under "Gaps" is something the candidate does not have: never claim it.
4. Every claim must be what the sources say or directly imply. Do not inflate scope, seniority or results.
5. Job titles, employers, dates and education are filled in from the profile by code; you only choose which jobs, projects, education and extras appear, by id.

Content:
- Summary (always; it sits under a "Summary" heading at the top): 2–3 lines that align the candidate with this exact job: what they are in the posting's terms, their strongest evidence for its main requirements, and its top core keywords. Concrete, not generic ("Full-stack engineer who built and shipped a production RAG pipeline…", not "AI engineer passionate about…"). It may use the posting's job title only if the candidate's experience truly matches it. Do not name the hiring company.
- Skills: only skills from the profile, grouped under short labels ("Languages", "Data", "Cloud & DevOps"), most relevant to the posting first. Each item is a skill's name, never a description. If the posting spells a skill differently, write the posting's spelling with the profile's own name in parentheses ("PostgreSQL (Postgres)"), or use the listed alias; nothing else goes in brackets.
- Experience: every job from the last five years (code puts them newest first by date). The most recent and most relevant jobs get the most room: 3–6 bullets, the most relevant first; less relevant jobs 1–2. Older jobs that do nothing for this posting may be left out.
- Bullets: the candidate's own bullets are usually strong; keep a strong bullet nearly word for word, with its specifics (tools, numbers, scope). Reword only to use the posting's term for something the bullet already shows, to put the most relevant part first, or to fix a weak or vague line. Never shorten a bullet by dropping its concrete details, and never merge two strong bullets into a vaguer one. Each starts with a past-tense verb and fits one or two lines. No filler ("responsible for", "results-driven", "leveraged", "passionate", "spearheaded", "robust", "seamless", "utilize").
- Projects: when the profile has any, include the one or two most relevant, with 2–3 bullets each; they carry posting skills a job may not show. Extras (certifications, awards, …): include the ones that strengthen this application.
- State any hard requirement the candidate meets (license, clearance, certification, degree) where it belongs. Work authorization and clearance go only at the end of the summary, and only when the posting screens on them, as a short plain clause in the candidate's own terms ("U.S. citizen." or "Active Secret clearance."), citing [profile:workAuthorization] or [profile:clearance]. Do not add legal boilerplate ("legally eligible to work … on an ongoing basis") and never list them under Skills.
- section_order: the order of experience, projects, education and extras after the summary and skills. Usually experience first; education first for students and new graduates with little work history; projects before experience when they are clearly more relevant than the jobs.
- Use the company brief only to decide which of the candidate's experience is closest to the company's product and technology, and lead with that.

One page is a hard limit; the page budget below says how much fits. Fill it with the most relevant material rather than leaving space, and stay within it.`;

// Body-text lines and characters per line the page leaves once the fixed
// parts (header, section headings, every job's title line, education) are
// set. A guide for the model; fitComposition() enforces the real limit.
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
  const lines = Math.max(10, Math.floor((limit - fixed) / line));
  const k = layout.kinds.bullet;
  const charsPerLine = Math.floor(k.width / (layout.textWidth('abcdefghijklmnopqrstuvwxyz', k.font) / 26));
  return { lines, charsPerLine };
}

function renderAnalysis(match, profile) {
  const corpus = profileCorpus(profile);
  const parts = [renderMatchForPrompt(match)];
  const aliases = ((match && match.keywords) || []).filter(k => k && k.alias);
  if (aliases.length) parts.push('', `Other forms of keywords (acronym ↔ full name): ${aliases.map(k => `${k.term} ↔ ${k.alias}`).join('; ')}`);
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

PAGE BUDGET: about ${budget.lines} lines of body text in total for the summary, skills lines, bullets, project names and extras (each line holds about ${budget.charsPerLine} characters; a bullet over that wraps to a second line). Job titles, education and section headings are already accounted for.`;
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
}

// The repair message: what the validator rejected, for one more pass.
export function repairMessage(errors) {
  return `Some of the resume cannot be used as written:\n${errors.map(e => `- ${e.target}: ${e.message}`).join('\n')}\n\nReturn the complete resume again with these fixed. Keep everything that was fine.`;
}
