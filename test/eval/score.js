// Rubric checks for generated resumes and cover letters.
//
// Every check is heuristic and deterministic so runs are comparable across
// prompt changes. Scores are 0–1 per check; `fails` lists hard failures.
// Company-fact fabrication in cover letters cannot be checked here and
// needs a human read.

'use strict';

// ── Shared helpers ────────────────────────────────────────────────────────

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);
const wc = (s) => words(s).length;
const lower = (s) => String(s || '').toLowerCase();

// Everything in the profile that a claim could legitimately come from.
function profileText(profile) {
  const parts = [profile.name, profile.contact, profile.location, profile.summary];
  for (const e of profile.education || []) parts.push(Object.values(e).join(' '));
  parts.push((profile.skills || []).join(' '));
  for (const x of profile.experiences || []) parts.push(x.title, x.company, x.location, x.description, ...(x.bullets || []));
  for (const p of profile.projects || []) parts.push(p.name, p.description, ...(p.bullets || []));
  for (const x of profile.extras || []) parts.push(x.title, x.organization, x.description);
  return parts.filter(Boolean).join('\n');
}

// Numbers with their unit-ish suffix: "94%", "40M", "$180K", "12", "1.2K".
const NUMBER_RE = /\$?\d[\d,]*(?:\.\d+)?\s?(?:%|percent|[KMB]\b|k\b|x\b)?/gi;
function numbersIn(text) {
  const out = new Set();
  const normalised = String(text || '').replace(/(\d[\d,.]*)\s*(thousand|million|billion)\b/gi,
    (_, n, w) => n + ({ thousand: 'K', million: 'M', billion: 'B' })[w.toLowerCase()]);
  for (const m of normalised.matchAll(NUMBER_RE)) {
    const norm = m[0].toLowerCase().replace(/[\s,$]/g, '').replace(/percent/, '%');
    if (/\d/.test(norm)) out.add(norm);
  }
  return out;
}

// "90k", "90,000" and "90000" are the same number; "1.2m" is 1200000.
function canonical(n) {
  const m = String(n).match(/^\$?([\d.]+)([kmb])?/i);
  if (!m) return n;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1;
  return String(Math.round(parseFloat(m[1]) * mult));
}

// Years and small counts are not "metrics"; only flag numbers that look like results.
function isMetricLike(n) {
  if (/^(19|20)\d{2}$/.test(n)) return false;      // year
  if (/^\d{1,2}$/.test(n) && Number(n) <= 12) return false; // small counts, months, versions
  if (/^\d+\.\d+$/.test(n) && Number(n) < 20) return false; // version numbers, GPAs
  return true;
}

// Number fabrication: metric-like numbers in the output that never appear in the profile or JD.
function fabricatedNumbers(outputText, profile, jobText) {
  const allowed = new Set([...numbersIn(profileText(profile)), ...numbersIn(jobText)]);
  const found = [];
  for (const n of numbersIn(outputText)) {
    if (!isMetricLike(n)) continue;
    const ok = [...allowed].some(a => canonical(a) === canonical(n));
    if (!ok) found.push(n);
  }
  return found;
}

// Tech-looking tokens: CamelCase, dotted, slashed, or known-style names. Used for
// both JD keyword extraction and fabricated-tool detection.
const TECH_TOKEN_RE = /\b(?:[A-Z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+|[A-Z][a-z]+[A-Z][a-zA-Z0-9]*|[A-Z]{2,}[a-zA-Z0-9]*|[A-Za-z]+\/[A-Za-z]+|[A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)\b/g;
const STOP = new Set(['I', 'A', 'The', 'We', 'You', 'Our', 'Your', 'And', 'For', 'With', 'In', 'On', 'At', 'To', 'Of', 'As', 'By', 'Or', 'If', 'It', 'Is', 'Be', 'This', 'That', 'What', 'Who', 'How', 'Why', 'When', 'Where', 'Requirements', 'Responsibilities', 'Qualifications', 'About', 'Nice', 'Bonus', 'Summer', 'Fall', 'Spring', 'Winter', 'Remote', 'Hybrid', 'Series', 'North', 'America', 'US', 'USA', 'UK', 'EU', 'CA', 'NY', 'TX', 'WA', 'AL', 'PM', 'PMs', 'VP', 'CEO', 'CTO', 'KPI', 'KPIs', 'GPA', 'MS', 'BS', 'B.S.', 'M.S.']);

function techTokens(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(TECH_TOKEN_RE)) {
    const t = m[0].trim();
    if (STOP.has(t) || t.length < 2) continue;
    out.add(t);
  }
  return out;
}

// JD keywords the candidate actually has (case-insensitive containment either way).
function relevantJdKeywords(jobText, profile) {
  const prof = lower(profileText(profile));
  const out = [];
  for (const t of techTokens(jobText)) {
    const lt = lower(t);
    if (prof.includes(lt)) out.push(t);
  }
  return [...new Set(out)];
}

function coverage(outputText, keywords) {
  if (!keywords.length) return { ratio: 1, missing: [] };
  const out = lower(outputText);
  const missing = keywords.filter(k => !out.includes(lower(k)));
  return { ratio: (keywords.length - missing.length) / keywords.length, missing };
}

// ── Cover letter lints ────────────────────────────────────────────────────

const BUZZWORDS = [
  'passionate', 'synergy', 'synergies', 'leverage', 'leveraging', 'dynamic', 'results-driven', 'results driven',
  'spearheaded', 'cutting-edge', 'cutting edge', 'fast-paced', 'fast paced', 'thought leader', 'game-changer',
  'game changer', 'best-in-class', 'world-class', 'rockstar', 'ninja', 'guru', 'go-getter', 'self-starter',
  'team player', 'think outside the box', 'move the needle', 'low-hanging fruit', 'circle back', 'value-add',
  'paradigm', 'holistic', 'robust', 'seamless', 'seamlessly', 'utilize', 'utilizing', 'impactful', 'delve',
  'multiplier', 'unlock value', 'competitive advantage', 'strategic imperative', 'operating problem',
  'harder to replicate', 'rare chance', 'inflection point'
];

const AI_TELLS = [
  /\bin today's (?:fast-paced|rapidly|ever-changing|digital)\b/i,
  /\bi am (?:writing|reaching out) to (?:express|apply)\b/i,
  /\bi am (?:excited|thrilled|passionate) (?:to|about)\b/i,
  /\bi believe (?:that )?i (?:am|would)\b/i,
  /\bit(?:'s| is) worth noting\b/i,
  /\bin conclusion\b/i,
  /\bfurthermore\b|\bmoreover\b|\badditionally\b/i,
  /\bnot (?:just|only) [^.]{3,40}, but (?:also )?/i,       // "not just X, but Y" construction
  /\bmore than (?:a|an) [^.]{3,30}\.\s+it\b/i,             // "X is more than a Y. It ..."
  /\btestament to\b/i,
  /\bnavigate the (?:complexities|landscape)\b/i,
  /\bi would welcome the opportunity\b/i
];

function buzzwordHits(text) {
  const t = lower(text);
  return BUZZWORDS.filter(b => t.includes(b));
}

function aiTellHits(text) {
  return AI_TELLS.filter(re => re.test(text)).map(re => re.source.slice(0, 40));
}

// Sentence-length variance as a crude "human rhythm" signal.
function sentenceStats(text) {
  const sentences = String(text || '').split(/(?<=[.!?])\s+/).filter(s => wc(s) > 1);
  const lens = sentences.map(wc);
  const mean = lens.reduce((a, b) => a + b, 0) / (lens.length || 1);
  const variance = lens.reduce((a, b) => a + (b - mean) ** 2, 0) / (lens.length || 1);
  return { count: sentences.length, mean: +mean.toFixed(1), stdev: +Math.sqrt(variance).toFixed(1) };
}

// Does the letter draw on actual profile items? Count company/project names mentioned.
function profileAnchors(text, profile) {
  const t = lower(text);
  const names = [
    ...(profile.experiences || []).map(e => e.company),
    ...(profile.projects || []).map(p => p.name.split(/[(:|–—-]/)[0]),
    ...(profile.education || []).map(e => e.institution)
  ].filter(Boolean);
  return names.filter(n => t.includes(lower(n).trim()));
}

// ── Public scorers ────────────────────────────────────────────────────────

function scoreResume({ resumeContent, profile, jobText, company }) {
  const checks = {};
  const fails = [];
  const r = resumeContent || {};

  checks.validShape = typeof r === 'object' && Array.isArray(r.experience) ? 1 : 0;
  if (!checks.validShape) fails.push('invalid shape');

  const sections = ['summary', 'skills', 'education', 'experience', 'projects'].filter(k => r[k] && (Array.isArray(r[k]) ? r[k].length : true));
  checks.hasCoreSections = sections.length >= 4 ? 1 : sections.length / 5;

  const flat = [];
  const pushAll = (v) => { if (Array.isArray(v)) v.forEach(pushAll); else if (v && typeof v === 'object') Object.values(v).forEach(pushAll); else if (v != null) flat.push(String(v)); };
  pushAll(r);
  const text = flat.join('\n');
  const totalWords = wc(text);
  checks.wordBudget = totalWords <= 750 ? 1 : totalWords <= 850 ? 0.5 : 0;
  if (totalWords > 850) fails.push(`over budget: ${totalWords} words`);
  // A one-page resume should also *use* the page; a sparse one reads as thin.
  checks.pageFill = totalWords >= 450 ? 1 : totalWords >= 300 ? 0.5 : 0;

  const bullets = [...(r.experience || []), ...(r.projects || [])].flatMap(e => e.bullets || []);
  const longBullets = bullets.filter(b => wc(b) > 30);
  checks.bulletLength = bullets.length ? 1 - longBullets.length / bullets.length : 1;

  const eduExpected = (profile.education || []).length;
  const eduGot = Array.isArray(r.education) ? r.education.length : (r.education ? 1 : 0);
  checks.educationComplete = eduExpected ? Math.min(1, eduGot / eduExpected) : 1;

  const must = (profile.experiences || []).filter(e => e.mustInclude).map(e => lower(e.company));
  const gotCompanies = (r.experience || []).map(e => lower(e.company));
  const missingMust = must.filter(m => !gotCompanies.some(g => g.includes(m) || m.includes(g)));
  checks.mustIncludeHonored = must.length ? 1 - missingMust.length / must.length : 1;
  if (missingMust.length) fails.push(`mustInclude missing: ${missingMust.join(', ')}`);

  const fab = fabricatedNumbers(text, profile, jobText);
  checks.noFabricatedNumbers = fab.length ? 0 : 1;
  if (fab.length) fails.push(`fabricated numbers: ${fab.join(', ')}`);

  const kws = relevantJdKeywords(jobText, profile);
  const cov = coverage(text, kws);
  checks.jdKeywordCoverage = +cov.ratio.toFixed(2);

  const verbStart = bullets.filter(b => /^[A-Z][a-z]+(?:ed|t|ilt|ade|an|rew|ote|ook|ed)\b/.test(b) || /^(?:Led|Built|Designed|Shipped|Owned|Reduced|Cut|Improved|Automated|Migrated|Launched|Created|Developed|Implemented|Engineered|Analy[sz]ed|Trained|Mentored|Delivered|Increased|Optimi[sz]ed|Published|Authored|Diagnosed|Extracted|Performed|Cleaned|Co-authored|Identified|Visuali[sz]ed|Provided|Adapt(?:ed)?)\b/.test(b));
  checks.actionVerbBullets = bullets.length ? +(verbStart.length / bullets.length).toFixed(2) : 1;

  const score = Object.values(checks).reduce((a, b) => a + b, 0) / Object.keys(checks).length;
  return { score: +score.toFixed(3), checks, fails, info: { totalWords, bullets: bullets.length, jdKeywords: kws.length, missingKeywords: cov.missing.slice(0, 8) } };
}

function scoreCoverLetter({ coverLetter, profile, jobText, company }) {
  const checks = {};
  const fails = [];
  const text = String(coverLetter || '');

  checks.valid = text.length > 200 ? 1 : 0;
  if (!checks.valid) fails.push('empty or too short');

  const n = wc(text);
  checks.length = (n >= 250 && n <= 350) ? 1 : (n >= 200 && n <= 420) ? 0.5 : 0;
  if (n > 420 || n < 200) fails.push(`length ${n} words`);

  const paras = text.split(/\n\s*\n/).filter(p => p.trim());
  checks.paragraphs = (paras.length >= 3 && paras.length <= 4) ? 1 : 0.5;

  checks.namesCompany = company && lower(text).includes(lower(company)) ? 1 : 0;
  if (company && !checks.namesCompany) fails.push('does not name the company');

  const buzz = buzzwordHits(text);
  checks.noBuzzwords = buzz.length === 0 ? 1 : buzz.length <= 2 ? 0.5 : 0;

  const tells = aiTellHits(text);
  checks.noAiTells = tells.length === 0 ? 1 : tells.length <= 1 ? 0.5 : 0;

  const fab = fabricatedNumbers(text, profile, jobText);
  checks.noFabricatedNumbers = fab.length ? 0 : 1;
  if (fab.length) fails.push(`fabricated numbers: ${fab.join(', ')}`);

  const anchors = profileAnchors(text, profile);
  checks.groundedInProfile = anchors.length >= 2 ? 1 : anchors.length === 1 ? 0.5 : 0;
  if (!anchors.length) fails.push('no profile items referenced');

  const st = sentenceStats(text);
  checks.sentenceVariety = st.stdev >= 6 ? 1 : st.stdev >= 4 ? 0.5 : 0;

  const emDashes = (text.match(/—/g) || []).length;
  checks.punctuationRestraint = emDashes <= 1 ? 1 : emDashes <= 3 ? 0.5 : 0;

  const kws = relevantJdKeywords(jobText, profile);
  const cov = coverage(text, kws);
  checks.jdKeywordCoverage = +Math.min(1, cov.ratio * 2).toFixed(2); // a letter needn't hit all keywords; half is full marks

  const score = Object.values(checks).reduce((a, b) => a + b, 0) / Object.keys(checks).length;
  return { score: +score.toFixed(3), checks, fails, info: { words: n, paragraphs: paras.length, buzzwords: buzz, aiTells: tells, anchors, sentences: st } };
}

module.exports = { scoreResume, scoreCoverLetter, relevantJdKeywords, fabricatedNumbers, buzzwordHits, aiTellHits };
