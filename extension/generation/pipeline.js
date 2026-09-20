// Document generation pipelines: match analysis → (research) → generate →
// one repair pass. Ported from the local proxy's /generateResume and
// /generateCoverLetter routes; the return values keep the same shape the
// extension already consumes.

import { CONFIG } from './config.js';
import { createClient, generateStructured, safeErrorMessage } from './openai.js';
import { analyzeMatch, renderMatchForPrompt } from './matchAnalysis.js';
import { buildResumeMessages, RESUME_SCHEMA, resumeBudget } from './resume.js';
import { buildCoverLetterMessages, COVER_LETTER_SCHEMA, unsourcedClaims } from './coverLetter.js';
import { researchCompany, briefFromPostingOnly, renderBriefForPrompt } from './companyResearch.js';

const { MAX_COMPLETION_TOKENS } = CONFIG;

// Words in every string of a generated resume.
function resumeWordCount(resume) {
  let n = 0;
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    else if (typeof v === 'string') n += v.trim().split(/\s+/).filter(Boolean).length;
  };
  walk(resume);
  return n;
}

function bulletCount(resume) {
  return [...(resume.experience || []), ...(resume.projects || [])].reduce((a, e) => a + (e.bullets || []).length, 0);
}

function requireInputs(profile, jobText) {
  if (!profile || !jobText) throw new Error('Missing required fields: profile and jobText');
}

// The caller may pass budget.maxWords after measuring a rendered page that overflowed.
export async function generateResume(apiKey, { profile, jobText, budget: budgetOverride = {} }) {
  const startTime = Date.now();
  requireInputs(profile, jobText);
  const openai = createClient(apiKey);
  console.log(`[${new Date().toISOString()}] Resume generation started`);
  const budget = resumeBudget(profile, budgetOverride);

  // Structured read of the posting against the profile; replaces regex guessing.
  const match = await analyzeMatch(openai, { profile, jobText });
  const matchText = renderMatchForPrompt(match);
  console.log(`Match: ${match.company || '(unnamed company)'} — ${match.role || '(unnamed role)'}; ${match.requirements.length} requirements, ${match.requirements.filter(r => r.strength !== 'none').length} supported`);

  const messages = buildResumeMessages({ profile, jobText, match, matchText, budget });
  let { data: resume } = await generateStructured(openai, {
    messages, schema: RESUME_SCHEMA, schemaName: 'resume', maxTokens: MAX_COMPLETION_TOKENS.resume
  });

  // Over the ceiling: one pass asking for whole bullets to be dropped, not truncated.
  let words = resumeWordCount(resume);
  let trimmed = false;
  if (words > budget.maxWords) {
    console.log(`Resume is ${words} words (max ${budget.maxWords}); requesting a trim`);
    const repair = await generateStructured(openai, {
      messages: [
        ...messages,
        { role: 'assistant', content: JSON.stringify(resume) },
        { role: 'user', content: `That is ${words} words; the maximum is ${budget.maxWords}. Remove the least relevant whole bullets (and coursework if needed) until it is under ${budget.maxWords} words. Do not shorten bullets mid-sentence and do not change anything else.` }
      ],
      schema: RESUME_SCHEMA, schemaName: 'resume', maxTokens: MAX_COMPLETION_TOKENS.resume
    });
    resume = repair.data;
    words = resumeWordCount(resume);
    trimmed = true;
  }

  const availableBullets = [...(profile.experiences || []), ...(profile.projects || [])].reduce((a, e) => a + (e.bullets || []).length, 0);

  // Well under target with material left over: one pass asking for more of the profile.
  let expanded = false;
  if (!trimmed && words < budget.targetWords * 0.7 && bulletCount(resume) < availableBullets) {
    console.log(`Resume is ${words} words with ${bulletCount(resume)}/${availableBullets} bullets used (target ${budget.targetWords}); requesting an expansion`);
    const expand = await generateStructured(openai, {
      messages: [
        ...messages,
        { role: 'assistant', content: JSON.stringify(resume) },
        { role: 'user', content: `That is ${words} words and uses ${bulletCount(resume)} of the profile's ${availableBullets} bullets; the target is about ${budget.targetWords} words. Add the most relevant of the remaining profile bullets, roles, projects, coursework or certifications until you are near the target (never over ${budget.maxWords}). Only material from the profile; do not lengthen existing bullets with new detail.` }
      ],
      schema: RESUME_SCHEMA, schemaName: 'resume', maxTokens: MAX_COMPLETION_TOKENS.resume
    });
    resume = expand.data;
    words = resumeWordCount(resume);
    expanded = true;
  }

  // Never show certifications the profile does not have.
  if (!(Array.isArray(profile.extras) && profile.extras.length)) resume.programs = [];
  const endTime = Date.now();
  console.log(`[${new Date().toISOString()}] Resume generated in ${endTime - startTime}ms (${words} words, ${bulletCount(resume)}/${availableBullets} bullets)`);
  return {
    resumeContent: resume,
    matchAnalysis: match,
    metadata: {
      generatedAt: new Date().toISOString(),
      processingTime: endTime - startTime,
      words,
      budget,
      usedBullets: bulletCount(resume),
      availableBullets,
      trimmed,
      expanded
    }
  };
}

// briefCache maps lower-cased company name → brief; a cached brief for the
// matched company is reused instead of searching again.
export async function generateCoverLetter(apiKey, { profile, jobText, research = true, briefCache = {} }) {
  const startTime = Date.now();
  requireInputs(profile, jobText);
  const openai = createClient(apiKey);
  console.log(`[${new Date().toISOString()}] Cover letter generation started`);

  const match = await analyzeMatch(openai, { profile, jobText });
  const matchText = renderMatchForPrompt(match);
  console.log(`Match: ${match.company || '(unnamed company)'} — ${match.role || '(unnamed role)'}; ${match.requirements.length} requirements, ${match.requirements.filter(r => r.strength !== 'none').length} supported`);

  // Company brief: cached → researched → posting-only.
  let brief;
  let briefSource = 'posting';
  const cacheKey = (match.company || '').trim().toLowerCase();
  if (cacheKey && briefCache && briefCache[cacheKey]) {
    brief = briefCache[cacheKey];
    briefSource = 'cache';
  } else if (research && match.company) {
    try {
      brief = await researchCompany(openai, { company: match.company, role: match.role, aboutCompany: match.about_company, jobText });
      briefSource = 'research';
      console.log(`Research: ${match.company} — found=${brief.found}, searches=${brief.searches}`);
    } catch (error) {
      console.warn('Research failed, continuing with the posting only:', safeErrorMessage(error));
      brief = briefFromPostingOnly({ company: match.company, aboutCompany: match.about_company });
    }
  } else {
    brief = briefFromPostingOnly({ company: match.company, aboutCompany: match.about_company });
  }
  const briefText = renderBriefForPrompt(brief);

  const messages = buildCoverLetterMessages({ profile, jobText, match, matchText, briefText });
  let { data } = await generateStructured(openai, {
    messages, schema: COVER_LETTER_SCHEMA, schemaName: 'cover_letter', maxTokens: MAX_COMPLETION_TOKENS.coverLetter
  });

  // Every claim must trace to the profile, the posting, or the brief. One
  // repair pass; whatever is still unsourced is reported, not hidden.
  let bad = unsourcedClaims(data.claims, profile, brief);
  let repaired = false;
  if (bad.length) {
    console.log(`Cover letter: ${bad.length} unsourced claim(s); requesting a repair`);
    const repair = await generateStructured(openai, {
      messages: [
        ...messages,
        { role: 'assistant', content: JSON.stringify(data) },
        { role: 'user', content: `These sentences make claims that cannot be traced to the profile, the job posting, or the company brief:\n${bad.map(c => `- "${c.sentence}" (cited: ${c.source || 'nothing'})`).join('\n')}\n\nRewrite the letter so each of them is either removed or replaced with something you can source, keep everything else, and return the full letter and claims again.` }
      ],
      schema: COVER_LETTER_SCHEMA, schemaName: 'cover_letter', maxTokens: MAX_COMPLETION_TOKENS.coverLetter
    });
    data = repair.data;
    bad = unsourcedClaims(data.claims, profile, brief);
    repaired = true;
  }

  const endTime = Date.now();
  console.log(`[${new Date().toISOString()}] Cover letter generated in ${endTime - startTime}ms`);
  return {
    coverLetter: data.coverLetter,
    claims: data.claims,
    unsourcedClaims: bad,
    matchAnalysis: match,
    companyBrief: brief,
    metadata: {
      generatedAt: new Date().toISOString(),
      processingTime: endTime - startTime,
      briefSource,
      searches: briefSource === 'research' ? brief.searches : 0,
      repaired
    }
  };
}

export { verifyKey, safeErrorMessage } from './openai.js';
