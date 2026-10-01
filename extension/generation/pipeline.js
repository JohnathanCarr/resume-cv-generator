// Document generation pipelines: match analysis → (research) → generate →
// one repair pass. Resumes are tailored as an edit list (tailor.js). Ported from the local proxy's /generateResume and
// /generateCoverLetter routes; the return values keep the same shape the
// extension already consumes.

import { CONFIG } from './config.js';
import { createClient, generateStructured, safeErrorMessage } from './openai.js';
import { analyzeMatch, renderMatchForPrompt } from './matchAnalysis.js';
import { EDITS_SCHEMA, buildPool, buildTailorMessages, validateEdits, applyEdits, keywordCoverage, docWords } from './tailor.js';
import { resumeDocToSchema } from './baseline.js';
import { buildCoverLetterMessages, COVER_LETTER_SCHEMA, unsourcedClaims } from './coverLetter.js';
import { researchCompany, briefFromPostingOnly, renderBriefForPrompt } from './companyResearch.js';
export { missingKeywords, applyKeywords } from './keywords.js';
export { createBaseline, isCurrentBaseline, baselineToResume } from './baseline.js';

const { MAX_COMPLETION_TOKENS } = CONFIG;

function requireInputs(profile, jobText) {
  if (!profile || !jobText) throw new Error('Missing required fields: profile and jobText');
}

// Match analysis on its own, so the extension can pause between reading the
// posting and generating (the ATS keyword check) and then pass the match back
// in to either generator instead of paying for the analysis twice.
export async function analyzeJob(apiKey, { profile, jobText }) {
  requireInputs(profile, jobText);
  const openai = createClient(apiKey);
  const match = await analyzeMatch(openai, { profile, jobText });
  console.log(`Match: ${match.company || '(unnamed company)'} — ${match.role || '(unnamed role)'}; ${match.requirements.length} requirements, ${match.requirements.filter(r => r.strength !== 'none').length} supported`);
  return match;
}

// Tailors the user's own resume (a baseline from baseline.js) to a posting:
// the model returns an edit list (tailor.js), which is validated, repaired
// once if any edit is invalid, and applied. Invalid edits that survive the
// repair are dropped, never applied. `match` from analyzeJob() skips the
// analysis; `maxNetWords` (set by the extension after a page overflow) caps
// how much the edits may lengthen the resume.
export async function tailorResume(apiKey, { profile, jobText, baseline, match = null, maxNetWords = null }) {
  const startTime = Date.now();
  requireInputs(profile, jobText);
  if (!baseline?.resume) throw new Error('Missing the uploaded resume to tailor.');
  const openai = createClient(apiKey);
  if (!match) match = await analyzeJob(apiKey, { profile, jobText });

  const base = baseline.resume;
  const pool = buildPool(base, profile);
  const messages = buildTailorMessages({ doc: base, pool, jobText, matchText: renderMatchForPrompt(match), match, maxNetWords });
  const request = (msgs) => generateStructured(openai, { messages: msgs, schema: EDITS_SCHEMA, schemaName: 'resume_edits', maxTokens: MAX_COMPLETION_TOKENS.resume });

  let { data } = await request(messages);
  let { valid, errors } = validateEdits(data.edits, base, pool);
  let repaired = false;
  if (errors.length) {
    console.log(`Tailoring: ${errors.length} invalid edit(s), requesting a repair`, errors);
    ({ data } = await request([
      ...messages,
      { role: 'assistant', content: JSON.stringify(data) },
      { role: 'user', content: `These edits cannot be applied:\n${errors.map(e => `- ${e}`).join('\n')}\nReturn the complete edit list again with those fixed or removed. Keep the valid edits as they were.` }
    ]));
    ({ valid, errors } = validateEdits(data.edits, base, pool));
    repaired = true;
  }

  const { doc, changes } = applyEdits(base, pool, valid);
  const coverage = { before: keywordCoverage(base, match), after: keywordCoverage(doc, match) };
  const endTime = Date.now();
  console.log(`[${new Date().toISOString()}] Resume tailored in ${endTime - startTime}ms: ${changes.length} edits, core keywords ${coverage.before.found}/${coverage.before.total} → ${coverage.after.found}/${coverage.after.total}${errors.length ? `, ${errors.length} rejected` : ''}`);
  return {
    resumeContent: resumeDocToSchema(doc),
    tailored: doc,
    changes,
    matchAnalysis: match,
    metadata: {
      generatedAt: new Date().toISOString(),
      processingTime: endTime - startTime,
      edits: changes.length,
      rejected: errors,
      repaired,
      coverage,
      wordsBefore: docWords(base),
      wordsAfter: docWords(doc)
    }
  };
}

// briefCache maps lower-cased company name → brief; a cached brief for the
// matched company is reused instead of searching again.
export async function generateCoverLetter(apiKey, { profile, jobText, research = true, briefCache = {}, match = null }) {
  const startTime = Date.now();
  requireInputs(profile, jobText);
  const openai = createClient(apiKey);
  console.log(`[${new Date().toISOString()}] Cover letter generation started`);

  if (!match) match = await analyzeJob(apiKey, { profile, jobText });
  const matchText = renderMatchForPrompt(match);

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
