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
const STOP = new Set(['I', 'A', 'The', 'We', 'You', 'Our', 'Your', 'And', 'For', 'With', 'In', 'On', 'At', 'To', 'Of', 'As', 'By', 'Or', 'If', 'It', 'Is', 'Be', 'This', 'That', 'What', 'Who', 'How', 'Why', 'When', 'Where', 'Requirements', 'Responsibilities', 'Qualifications', 'About', 'Nice', 'Bonus', 'Summer', 'Fall', 'Spring', 'Winter', 'Remote', 'Hybrid', 'Series', 'North', 'America', 'US', 'USA', 'UK', 'EU', 'CA', 'NY', 'TX', 'WA', 'AL', 'PM', 'PMs', 'VP', 'CEO', 'CTO', 'KPI', 'KPIs', 'GPA', 'MS', 'BS', 'B.S.', 'M.S.',
  // Sentence-initial verbs and generic nouns that look capitalised but are not skills.
  'Build', 'Design', 'Run', 'Write', 'Support', 'Clean', 'Own', 'Work', 'Define', 'Investigate', 'Partner', 'Lead', 'Manage', 'Help', 'Ship', 'Learn', 'Track', 'Experience', 'Strong', 'Solid', 'Expert', 'Clear', 'Comfort', 'Comfortable', 'Familiarity', 'Proficiency', 'Understanding', 'Currently', 'Prior', 'Track record', 'You', 'Senior', 'Junior', 'Intern', 'Data', 'Product', 'Growth', 'Infrastructure', 'Merchant', 'Analyst', 'Engineer', 'Backend', 'Frontend', 'Full', 'Stack', 'Machine', 'Learning', 'Open', 'Bachelor', 'Master', 'Statistics', 'Informatics', 'Computer', 'Science', 'Economics']);

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

// Scores a tailored resume (pipeline tailorResume() result) against the
// baseline it edited. Tailoring keeps the user's resume, so length and page
// fill are the user's own; the rubric measures what the edits did and whether
// they stayed honest.
function scoreResume({ result, baseline, profile, jobText }) {
  const checks = {};
  const fails = [];
  const r = result?.resumeContent || {};
  const doc = result?.tailored || {};
  const base = baseline?.resume || {};
  const meta = result?.metadata || {};
  const changes = result?.changes || [];

  checks.validShape = typeof r === 'object' && Array.isArray(r.experience) && Array.isArray(changes) ? 1 : 0;
  if (!checks.validShape) fails.push('invalid shape');

  // Jobs and education are never touched: same entries, same headers, same order.
  const header = (e) => [e.title, e.company, e.start, e.end].join('|');
  const jobsSame = (doc.experiences || []).map(header).join('\n') === (base.experiences || []).map(header).join('\n');
  const eduSame = (doc.education || []).map(e => e.institution).join('|') === (base.education || []).map(e => e.institution).join('|');
  checks.historyIntact = jobsSame && eduSame ? 1 : 0;
  if (!checks.historyIntact) fails.push('jobs or education changed');

  // A summary only when the upload had one.
  checks.summaryRule = Boolean((doc.summary || '').trim()) === Boolean((base.summary || '').trim()) ? 1 : 0;
  if (!checks.summaryRule) fails.push('summary added or removed');

  const flat = [];
  const pushAll = (v) => { if (Array.isArray(v)) v.forEach(pushAll); else if (v && typeof v === 'object') Object.values(v).forEach(pushAll); else if (v != null) flat.push(String(v)); };
  pushAll(r);
  const text = flat.join('\n');
  const fab = fabricatedNumbers(text, profile, jobText);
  checks.noFabricatedNumbers = fab.length ? 0 : 1;
  if (fab.length) fails.push(`fabricated numbers: ${fab.join(', ')}`);

  // Core keyword coverage after tailoring, as a share of what was reachable:
  // a keyword the candidate has nowhere in the profile cannot be added honestly.
  const cov = meta.coverage || { before: { found: 0, total: 0 }, after: { found: 0, total: 0, missing: [] } };
  const profileCorpus = lower(profileText(profile));
  const reachable = cov.after.total - (cov.after.missing || []).filter(k => !profileCorpus.includes(lower(k))).length;
  checks.coreKeywordCoverage = reachable ? +Math.min(1, cov.after.found / reachable).toFixed(2) : 1;

  // No keyword stuffing: no core keyword more than three times.
  const coreTerms = (result?.matchAnalysis?.keywords || []).filter(k => k.importance === 'core').map(k => k.term);
  const stuffed = coreTerms.filter(t => (lower(text).match(new RegExp(`\\b${lower(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')) || []).length > 3);
  checks.noStuffing = stuffed.length ? 0 : 1;
  if (stuffed.length) fails.push(`keyword used more than 3 times: ${stuffed.join(', ')}`);

  // Restraint: a handful of edits, none rejected after the repair pass.
  const n = changes.length;
  checks.editRestraint = n <= 12 ? 1 : 0.5;
  if (n > 12) fails.push(`${n} edits`);
  checks.noRejectedEdits = (meta.rejected || []).length ? 0.5 : 1;
  if ((meta.rejected || []).length) fails.push(`rejected: ${meta.rejected.join(' / ')}`);

  // Unchanged lines must be byte-identical (true by construction; guards applyEdits).
  // A bullet may only disappear if it was edited or its project was swapped out.
  const swapped = new Set(changes.filter(c => /^proj:\d+$/.test(c.id)).map(c => c.id));
  const edited = new Set(changes.map(c => c.id));
  const docBullets = new Set([...(doc.experiences || []), ...(doc.projects || [])].flatMap(e => e.bullets || []));
  const lostUnedited = [...(base.experiences || []), ...(base.projects || [])]
    .filter(e => !swapped.has(e.id))
    .flatMap(e => (e.bullets || []).map((b, i) => ({ id: `${e.id}.b${i + 1}`, b })))
    .filter(({ id, b }) => !edited.has(id) && !docBullets.has(b));
  checks.verbatimElsewhere = lostUnedited.length ? 0 : 1;
  if (lostUnedited.length) fails.push(`unedited lines changed: ${lostUnedited.map(x => x.id).join(', ')}`);
  const keptBullets = [...docBullets].filter(b => (base.experiences || []).concat(base.projects || []).some(e => (e.bullets || []).includes(b))).length;

  const score = Object.values(checks).reduce((a, b) => a + b, 0) / Object.keys(checks).length;
  return {
    score: +score.toFixed(3), checks, fails,
    info: {
      edits: n,
      byOp: changes.reduce((a, c) => ({ ...a, [c.op]: (a[c.op] || 0) + 1 }), {}),
      coverage: `${cov.before.found}/${cov.before.total} → ${cov.after.found}/${cov.after.total}`,
      missingCore: cov.after.missing,
      keptBullets,
      words: `${meta.wordsBefore} → ${meta.wordsAfter}`
    }
  };
}

function scoreCoverLetter({ coverLetter, profile, jobText, company, unsourcedClaims }) {
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

  // Full name is best practice (at least once); the distinctive first word
  // ("Lumen" for "Lumen Health") is how people actually write and gets partial credit.
  const firstWord = (company || '').split(/\s+/)[0] || '';
  checks.namesCompany = !company ? 1
    : lower(text).includes(lower(company)) ? 1
    : (firstWord.length >= 4 && new RegExp(`\\b${firstWord}\\b`, 'i').test(text)) ? 0.5
    : 0;
  if (company && checks.namesCompany === 0) fails.push('does not name the company');

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

  // Claim sourcing is reported by the proxy (present only once the prompt returns claims).
  if (Array.isArray(unsourcedClaims)) {
    checks.claimsSourced = unsourcedClaims.length === 0 ? 1 : unsourcedClaims.length === 1 ? 0.5 : 0;
    if (unsourcedClaims.length) fails.push(`${unsourcedClaims.length} unsourced claim(s)`);
  }

  // Referring to the profile as a document is a tell that the letter was assembled, not written.
  checks.noDocumentReferences = /\b(?:i list|my profile|my resume (?:shows|lists|includes)|as (?:listed|shown) (?:in|on) my)\b/i.test(text) ? 0 : 1;

  const score = Object.values(checks).reduce((a, b) => a + b, 0) / Object.keys(checks).length;
  return { score: +score.toFixed(3), checks, fails, info: { words: n, paragraphs: paras.length, buzzwords: buzz, aiTells: tells, anchors, sentences: st } };
}

module.exports = { scoreResume, scoreCoverLetter, relevantJdKeywords, fabricatedNumbers, buzzwordHits, aiTellHits };
