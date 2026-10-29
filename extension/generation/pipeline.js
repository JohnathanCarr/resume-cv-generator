// Document generation pipelines: match analysis → (research) → generate →
// repair. Resumes are composed from the whole profile (compose.js). The
// return values are the shapes app.js consumes.

import { CONFIG } from './config.js';
import { createClient, generateStructured, safeErrorMessage } from './openai.js';
import { analyzeMatch, renderMatchForPrompt } from './matchAnalysis.js';
import { keywordCoverage, docWords, extraText } from './resumeDoc.js';
import { makeLayout, estimateDocHeight } from './layout.js';
import { resumeDocToSchema } from './baseline.js';
import { buildCoverLetterMessages, COVER_LETTER_SCHEMA, unsourcedClaims } from './coverLetter.js';
import { researchCompany, briefFromPostingOnly, isResearchedBrief, renderBriefForPrompt } from './companyResearch.js';
import { COMPOSE_SCHEMA, validateComposition, sanitizeComposition, fitComposition, toResumeDoc, composeChanges } from './compose.js';
import { buildComposeMessages, repairMessage } from './composePrompt.js';
import { createTimer } from './timing.js';
export { missingKeywords, applyKeywords } from './keywords.js';
export { createBaseline, isCurrentBaseline, baselineToResume, resumeDocToSchema } from './baseline.js';
export { previewResumes } from './highlight.js';
export { isResearchedBrief } from './companyResearch.js';
export { createTimer, formatTimings } from './timing.js';

const { MAX_COMPLETION_TOKENS } = CONFIG;

// A truncated answer (the model spent the token cap reasoning) is
// transient: the same request almost always fits on a second try.
export async function retryTruncated(call) {
  try {
    return await call();
  } catch (error) {
    if (error?.code !== 'output_truncated') throw error;
    console.warn('Output truncated; retrying once');
    return call();
  }
}

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

// Tailoring v2 (design/tailoring-v2.md): composes a one-page resume for the
// posting from the whole profile. The model writes; compose.js holds it to
// the truth. Steps: analysis (unless `match` is passed), a company brief
// (cached research, else one web search when `research` is on, else what the
// posting says), the composition, up to two repair passes on the validator's
// errors, then whatever is still invalid is dropped and the result is fitted
// to one page by the layout. `baseline` (the uploaded resume) only provides
// the "before" keyword coverage. Returns { resumeContent, tailored,
// composition (for the extension's local refit), changes, matchAnalysis,
// metadata, companyBrief }.
export async function composeResume(apiKey, { profile, jobText, match = null, layout = null, baseline = null, research = false, briefCache = {} }) {
  const startTime = Date.now();
  requireInputs(profile, jobText);
  const openai = createClient(apiKey);
  const timer = createTimer();
  if (!match) match = await timer.step('analyze', () => analyzeJob(apiKey, { profile, jobText }));
  const L = makeLayout(layout || {});

  let brief = null;
  let briefSource = 'posting';
  const cacheKey = (match.company || '').trim().toLowerCase();
  if (cacheKey && isResearchedBrief(briefCache?.[cacheKey])) {
    brief = briefCache[cacheKey];
    briefSource = 'cache';
  } else if (research && match.company) {
    try {
      brief = await timer.step('research', () => researchCompany(openai, { company: match.company, role: match.role, aboutCompany: match.about_company, jobText, maxSearches: 1 }));
      briefSource = 'research';
    } catch (error) {
      console.warn('Research failed, composing from the posting only:', safeErrorMessage(error));
    }
  }
  const briefText = brief ? renderBriefForPrompt(brief) : (match.about_company ? `What the posting says about the company: ${match.about_company}` : null);

  const messages = buildComposeMessages({ profile, jobText, match, briefText, layout: L });
  const request = (msgs) => retryTruncated(() => generateStructured(openai, { messages: msgs, schema: COMPOSE_SCHEMA, schemaName: 'resume_composition', maxTokens: MAX_COMPLETION_TOKENS.compose }));
  let { data } = await timer.step('compose', () => request(messages));
  let check = validateComposition(data, profile, match);
  let repairs = 0;
  let convo = messages;
  while (check.errors.length && repairs < 2) {
    console.log(`Composition: ${check.errors.length} problem(s), requesting a repair`, check.errors.map(e => e.message));
    convo = [...convo, { role: 'assistant', content: JSON.stringify(data) }, { role: 'user', content: repairMessage(check.errors) }];
    ({ data } = await timer.step(`repair ${repairs + 1}`, () => request(convo)));
    check = validateComposition(data, profile, match);
    repairs++;
  }

  const { comp: clean, dropped } = sanitizeComposition(data, check.errors, profile);
  const result = composedResult({ comp: clean, profile, match, layout: L, baseline });
  const endTime = Date.now();
  Object.assign(result.metadata, {
    generatedAt: new Date().toISOString(),
    processingTime: endTime - startTime,
    repairs,
    rejected: dropped,
    briefSource,
    searches: briefSource === 'research' ? brief.searches : 0,
    timings: timer.steps
  });
  result.companyBrief = brief;
  console.log(`[${new Date().toISOString()}] Resume composed in ${endTime - startTime}ms: ${repairs} repair(s), ${dropped.length} dropped, core keywords ${result.metadata.coverage.after.found}/${result.metadata.coverage.after.total}, page ${result.metadata.page.afterPx}/${result.metadata.page.limitPx}px${result.metadata.page.trimmed.length ? `, trimmed ${result.metadata.page.trimmed.length}` : ''}`);
  return result;
}

// Fits a composition to one page and builds the result the extension renders.
function composedResult({ comp, profile, match, layout, baseline, offsetPx = 0 }) {
  const fit = fitComposition(comp, profile, match, layout, { offsetPx });
  const doc = toResumeDoc(fit.comp, profile);
  const final = validateComposition(fit.comp, profile, match);
  const after = keywordCoverage(doc, match);
  return {
    resumeContent: resumeDocToSchema(doc),
    tailored: doc,
    composition: fit.comp,
    changes: composeChanges(doc, profile),
    matchAnalysis: match,
    metadata: {
      engine: 'compose',
      coverage: { before: baseline?.resume ? keywordCoverage(baseline.resume, match) : after, after },
      page: { estimated: !layout.measured, afterPx: fit.page.afterPx, limitPx: fit.page.limitPx, fits: fit.page.fits, trimmed: fit.trimmed, undone: [] },
      warnings: final.warnings.map(w => w.message),
      unmet: final.errors.map(e => e.message),
      wordsAfter: docWords(doc)
    }
  };
}

// The extension's second pass: Chrome measured the composed resume at
// measuredPx; when that is over the page, trim again with the estimate
// corrected by the difference. No model call. Returns a new result.
export function refitComposedResume(result, { profile, layout = null, baseline = null, measuredPx }) {
  const L = makeLayout(layout || {});
  const estimated = estimateDocHeight(L, result.tailored, extraText);
  const next = composedResult({ comp: result.composition, profile, match: result.matchAnalysis, layout: L, baseline, offsetPx: measuredPx - estimated });
  next.metadata = { ...result.metadata, ...next.metadata, refitted: true };
  next.companyBrief = result.companyBrief;
  return next;
}

// briefCache maps lower-cased company name → brief; a cached brief for the
// matched company is reused instead of searching again.
export async function generateCoverLetter(apiKey, { profile, jobText, research = true, briefCache = {}, match = null }) {
  const startTime = Date.now();
  requireInputs(profile, jobText);
  const openai = createClient(apiKey);
  console.log(`[${new Date().toISOString()}] Cover letter generation started`);
  const timer = createTimer();

  if (!match) match = await timer.step('analyze', () => analyzeJob(apiKey, { profile, jobText }));
  const matchText = renderMatchForPrompt(match);

  // Company brief: cached → researched → posting-only.
  let brief;
  let briefSource = 'posting';
  const cacheKey = (match.company || '').trim().toLowerCase();
  // Posting-only briefs are never reused: older versions cached them, which
  // kept research off for that company for 30 days.
  if (cacheKey && isResearchedBrief(briefCache?.[cacheKey])) {
    brief = briefCache[cacheKey];
    briefSource = 'cache';
  } else if (research && match.company) {
    try {
      brief = await timer.step('research', () => researchCompany(openai, { company: match.company, role: match.role, aboutCompany: match.about_company, jobText }));
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
  const request = (msgs) => retryTruncated(() => generateStructured(openai, {
    messages: msgs, schema: COVER_LETTER_SCHEMA, schemaName: 'cover_letter', maxTokens: MAX_COMPLETION_TOKENS.coverLetter
  }));
  let { data } = await timer.step('letter', () => request(messages));

  // Every claim must trace to the profile, the posting, or the brief. One
  // repair pass; whatever is still unsourced is reported, not hidden. If
  // the repair itself fails, the first draft stands with its claims flagged.
  let bad = unsourcedClaims(data.claims, profile, brief);
  let repaired = false;
  let repairFailed = false;
  if (bad.length) {
    console.log(`Cover letter: ${bad.length} unsourced claim(s); requesting a repair`);
    try {
      const repair = await timer.step('repair', () => request([
        ...messages,
        { role: 'assistant', content: JSON.stringify(data) },
        { role: 'user', content: `These sentences make claims that cannot be traced to the profile, the job posting, or the company brief:\n${bad.map(c => `- "${c.sentence}" (cited: ${c.source || 'nothing'})`).join('\n')}\n\nRewrite the letter so each of them is either removed or replaced with something you can source, keep everything else, and return the full letter and claims again.` }
      ]));
      data = repair.data;
      bad = unsourcedClaims(data.claims, profile, brief);
      repaired = true;
    } catch (error) {
      console.warn('Cover letter repair failed; keeping the first draft:', safeErrorMessage(error));
      repairFailed = true;
    }
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
      repaired,
      repairFailed,
      timings: timer.steps
    }
  };
}

export { verifyKey, safeErrorMessage } from './openai.js';
