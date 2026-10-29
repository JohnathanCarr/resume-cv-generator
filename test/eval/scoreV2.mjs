// Resume rubric v2 (design/tailoring-v2.md, design/research/ats-research.md).
//
// Scores any generated resume in formatResume()'s shape against the profile,
// the posting and the match analysis, so the same rubric measures today's
// edit-list tailoring and the v2 composer. Checks fall in four groups:
//   truth   nothing on the page the profile does not support
//   match   the posting's must-haves present, in its words, with proof
//   page    one page, filled
//   never   no stuffing, no filler, parse-safe markup
// Every check is deterministic and 0–1; `fails` lists the misses worth reading.
// An optional recruiter judge (judge.mjs) adds a model's reading score.

import { createRequire } from 'node:module';
import { normalizeTerm, corpusHas } from '../../extension/generation/keywords.js';
import { formatResume, escapeResume } from '../../extension/preview/resumeHtml.js';
import { textProblems, STANDARD_HEADINGS } from '../../extension/preview/parseSafety.js';

const require = createRequire(import.meta.url);
const { fabricatedNumbers } = require('./score.js');

const lower = (s) => String(s || '').toLowerCase();
const norm = (s) => ` ${normalizeTerm(s)} `;
const has = (corpus, term) => !!normalizeTerm(term) && corpusHas(corpus, normalizeTerm(term));

// Everything the profile says, for "is this supported?" checks.
export function profileCorpus(profile) {
  const parts = [profile.summary, profile.location, ...(profile.skills || [])];
  for (const e of profile.education || []) parts.push(...Object.values(e));
  for (const x of [...(profile.experiences || []), ...(profile.projects || [])]) {
    parts.push(x.title, x.company, x.name, x.location, x.description, ...(x.bullets || []));
  }
  for (const x of profile.extras || []) parts.push(x.title, x.organization, x.description);
  return norm(parts.filter(Boolean).join(' '));
}

// The resume as plain text, section by section.
export function resumeParts(resume) {
  const r = resume || {};
  const bullets = [...(r.experience || []), ...(r.projects || [])].flatMap(e => e.bullets || []);
  return {
    summary: String(r.summary || ''),
    skills: (r.skills || []).join('\n'),
    bullets,
    headers: [...(r.experience || []).map(e => [e.title, e.company, e.location, e.dates].join(' ')), ...(r.projects || []).map(p => [p.name, p.link].join(' '))],
    education: (r.education || []).map(e => Object.values(e).filter(v => typeof v === 'string').join(' ')),
    extras: [...(r.programs || []), ...(r.certifications || [])],
    all() { return [this.summary, this.skills, ...this.headers, ...this.bullets, ...this.education, ...this.extras].join('\n'); }
  };
}

// Skill items from "Label: a, b, c" lines (or a plain list).
function skillItems(resume) {
  return (resume.skills || []).flatMap(line => {
    const at = String(line).indexOf(':');
    return (at >= 0 ? String(line).slice(at + 1) : String(line)).split(/\s*,\s*/);
  }).map(s => s.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
}

// Capitalised tool-like tokens (TypeScript, CI/CD, Node.js, AWS) in text.
const TOOL_RE = /\b(?:[A-Z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+|[A-Z][a-z]+[A-Z][a-zA-Z0-9]*|[A-Z]{2,}[a-z0-9]*s?|[A-Za-z]+\/[A-Za-z]+|[A-Z][a-z]*[+#]+)/g;
const COMMON_CAPS = new Set(['API', 'APIs', 'UI', 'UX', 'ID', 'IDs', 'US', 'USA', 'PM', 'PMs', 'KPI', 'KPIs', 'GPA', 'MS', 'BS', 'BA', 'MBA', 'PhD', 'CEO', 'CTO', 'VP', 'HR', 'QA', 'OK', 'ETA', 'ROI', 'B2B', 'B2C', 'SaaS', 'R&D']);
function toolTokens(text) {
  return [...new Set([...String(text).matchAll(TOOL_RE)].map(m => m[0]).filter(t => !COMMON_CAPS.has(t)))];
}

// Does evidence item `id` (from the match analysis) show on the resume?
function evidenceOnResume(id, resume, profile, text) {
  // Older saved matches carry the profile's brackets ("[proj:5]").
  const [kind, ...rest] = String(id).trim().replace(/^\[\s*|\s*\]$/g, '').split(':');
  const ref = rest.join(':');
  const find = (list) => (list || []).find(x => String(x.id) === ref);
  if (kind === 'skill') return has(text, ref);
  if (kind === 'profile') return true; // location: always in the contact line
  if (kind === 'exp') {
    const x = find(profile.experiences);
    return !!x && (resume.experience || []).some(e => lower(e.company) === lower(x.company) && lower(e.title) === lower(x.title));
  }
  if (kind === 'proj') {
    const x = find(profile.projects);
    const name = lower(String(x?.name || '').split(/[(:|–—]/)[0].trim());
    return !!name && (resume.projects || []).some(p => lower(p.name).includes(name));
  }
  if (kind === 'edu') {
    const x = find(profile.education);
    return !!x && (resume.education || []).some(e => lower(e.school || e.institution) === lower(x.institution));
  }
  if (kind === 'extra') {
    const x = find(profile.extras);
    return !!x && [...(resume.programs || []), ...(resume.certifications || [])].some(l => lower(l).includes(lower(x.title)));
  }
  return false;
}

// Phrases recruiters read as filler (and AI tells); none should appear.
export const FILLER = [
  'results-driven', 'results driven', 'detail-oriented', 'detail oriented', 'proven track record', 'track record of success',
  'responsible for', 'duties included', 'team player', 'self-starter', 'go-getter', 'hard-working', 'hardworking',
  'passionate', 'synergy', 'synergies', 'leverage', 'leveraged', 'leveraging', 'spearheaded', 'cutting-edge',
  'best-in-class', 'world-class', 'seamless', 'seamlessly', 'utilize', 'utilized', 'robust', 'impactful',
  'think outside the box', 'go above and beyond', 'wide range of', 'excellent communication skills'
];

// Scores a resume. resume: formatResume's shape (result.resumeContent).
export function scoreResumeV2({ resume, profile, jobText, match, page }) {
  const checks = {};
  const fails = [];
  const info = {};
  const r = resume || {};
  const parts = resumeParts(r);
  const text = parts.all();
  const textN = norm(text);
  const corpus = profileCorpus(profile);

  // ── truth ──
  const fab = fabricatedNumbers(text, profile, jobText);
  checks.noFabricatedNumbers = fab.length ? 0 : 1;
  if (fab.length) fails.push(`numbers not in the profile: ${fab.join(', ')}`);

  // A tool is supported when the profile has it or, for a posting keyword,
  // its other form (SEO for "Search Engine Optimization"). Posting keywords
  // are checked by name too, since plain words (Kubernetes, Rust) escape the
  // token pattern and copying the posting's tools is the main risk.
  const keywordList = ((match && match.keywords) || []).map(k => (typeof k === 'string' ? { term: k, alias: '' } : k));
  const supportedViaAlias = new Set(keywordList
    .filter(k => k.alias && (has(corpus, k.term) || has(corpus, k.alias)))
    .flatMap(k => [normalizeTerm(k.term), normalizeTerm(k.alias)]));
  const supportedTool = (t) => has(corpus, t) || supportedViaAlias.has(normalizeTerm(t));
  const unsupported = [...new Set([
    ...toolTokens(text),
    // Tool-like names only (one word, or a capital, digit or symbol in it):
    // descriptive phrases such as "data analysis" are not tool claims.
    ...keywordList.filter(k => has(textN, k.term) && (/^\S+$/.test(k.term.trim()) || /[A-Z0-9+#./]/.test(k.term))).map(k => k.term)
  ])].filter(t => !supportedTool(t));
  info.unsupportedTools = unsupported;
  checks.noUnsupportedTools = unsupported.length === 0 ? 1 : unsupported.length === 1 ? 0.5 : 0;
  if (unsupported.length) fails.push(`tools not in the profile: ${unsupported.join(', ')}`);

  const jobs = (r.experience || []).map(e => (profile.experiences || []).findIndex(x => lower(x.company) === lower(e.company) && lower(x.title) === lower(e.title)));
  const schools = (r.education || []).map(e => (profile.education || []).some(x => lower(x.institution) === lower(e.school || e.institution)));
  const historyOk = jobs.every(i => i >= 0) && jobs.every((v, i) => i === 0 || v > jobs[i - 1]) && schools.every(Boolean);
  checks.historyTruthful = historyOk ? 1 : 0;
  if (!historyOk) fails.push('a job or school is not exactly as in the profile, or jobs are out of order');

  const items = skillItems(r);
  // "Posting wording (profile wording)" respellings pass if either form is in
  // the profile; claims the respelling adds (JavaScript in "JavaScript/
  // TypeScript (TypeScript)") are caught by the tools check above.
  const foreign = items.filter(s => {
    const m = s.match(/^(.*?)\s*\((.*)\)$/);
    return m ? !has(corpus, m[1]) && !has(corpus, m[2]) : !has(corpus, s);
  });
  checks.skillsFromProfile = foreign.length ? 0 : 1;
  if (foreign.length) fails.push(`skills not in the profile: ${foreign.join(', ')}`);

  // ── match ──
  const keywords = ((match && match.keywords) || []).map(k => (typeof k === 'string' ? { term: k, importance: 'core', alias: '' } : k));
  const core = keywords.filter(k => k.importance === 'core');
  const supported = core.filter(k => has(corpus, k.term) || (k.alias && has(corpus, k.alias)));
  const covered = supported.filter(k => has(textN, k.term));
  checks.coreCoverage = supported.length ? +(covered.length / supported.length).toFixed(2) : 1;
  info.coverage = `${covered.length}/${supported.length} supported core (${core.length} core)`;
  const uncovered = supported.filter(k => !covered.includes(k)).map(k => k.term);
  if (uncovered.length) fails.push(`supported core keywords missing: ${uncovered.join(', ')}`);

  const required = ((match && match.requirements) || []).filter(q => q.kind === 'required' && q.strength !== 'none' && (q.evidence || []).length);
  const proven = required.filter(q => q.evidence.some(id => evidenceOnResume(id, r, profile, textN)));
  checks.requirementEvidence = required.length ? +(proven.length / required.length).toFixed(2) : 1;
  info.requirements = `${proven.length}/${required.length} supported required`;
  const unproven = required.filter(q => !proven.includes(q)).map(q => q.text);
  if (unproven.length) fails.push(`required qualifications without a line: ${unproven.join(' | ')}`);

  const pairs = supported.filter(k => k.alias);
  const bothForms = pairs.filter(k => has(textN, k.term) && has(textN, k.alias));
  checks.acronymPairs = pairs.length ? +(bothForms.length / pairs.length).toFixed(2) : 1;

  const bulletText = norm(parts.bullets.join(' '));
  const inContext = covered.filter(k => has(bulletText, k.term) || (k.alias && has(bulletText, k.alias)));
  checks.skillsInContext = covered.length ? +Math.min(1, inContext.length / covered.length / 0.7).toFixed(2) : 1;

  const hard = ((match && match.hard_requirements) || []).filter(h => h.met === 'yes');
  const stated = hard.filter(h => (h.evidence || []).some(id => evidenceOnResume(id, r, profile, textN)));
  checks.hardRequirementsStated = hard.length ? +(stated.length / hard.length).toFixed(2) : 1;

  checks.summaryPresent = parts.summary.trim() ? 1 : 0;

  // ── page ──
  if (page) {
    checks.fitsOnePage = page.fits ? 1 : 0;
    if (!page.fits) fails.push(`over one page: ${page.afterPx}/${page.limitPx}px`);
    const fill = page.afterPx / page.limitPx;
    checks.pageFill = fill >= 0.9 ? 1 : fill >= 0.8 ? 0.5 : 0;
    info.pageFill = `${Math.round(fill * 100)}%`;
  }

  // ── never ──
  const counts = core.map(k => ({ term: k.term, n: (textN.match(new RegExp(`(?<![a-z0-9+#])${normalizeTerm(k.term).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?![a-z0-9+#])`, 'g')) || []).length }));
  const stuffed = counts.filter(c => c.n > 3).map(c => `${c.term}×${c.n}`);
  checks.noStuffing = stuffed.length ? 0 : 1;
  if (stuffed.length) fails.push(`keyword stuffing: ${stuffed.join(', ')}`);

  const filler = FILLER.filter(f => lower(text).includes(f));
  checks.noFiller = filler.length === 0 ? 1 : filler.length === 1 ? 0.5 : 0;
  if (filler.length) fails.push(`filler: ${filler.join(', ')}`);

  const html = formatResume(escapeResume(r), profile);
  const headings = [...html.matchAll(/>([^<>]+)<\/h2>/g)].map(m => m[1].trim());
  const parseIssues = [
    ...headings.filter(h => !STANDARD_HEADINGS.includes(h)).map(h => `heading "${h}"`),
    ...textProblems(html.replace(/<[^>]+>/g, ' ')),
    ...(/<(table|img|svg|canvas)\b/i.test(html) ? ['non-text elements'] : [])
  ];
  checks.parseSafe = parseIssues.length ? 0 : 1;
  if (parseIssues.length) fails.push(`parse safety: ${parseIssues.join('; ')}`);

  const score = Object.values(checks).reduce((a, b) => a + b, 0) / Object.keys(checks).length;
  return { score: +score.toFixed(3), checks, fails, info };
}
