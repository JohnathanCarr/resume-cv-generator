// Tailoring v2 (design/tailoring-v2.md): the model composes a one-page resume
// from the whole profile, and code holds it to the truth. This module is the
// contract between the two, pure and DOM-free:
//
//   sourceIndex(profile)        an id for every line of the profile
//   renderProfileForCompose()   the profile as the model sees it, with those ids
//   COMPOSE_SCHEMA              what the model returns: a summary, skill groups,
//                               chosen jobs and projects with rewritten bullets
//                               (each citing its sources), chosen education and
//                               extras by id. Titles, employers and dates are not
//                               in it: code copies them from the profile.
//   validateComposition()       truth and match rules; errors go back for repair
//   toResumeDoc()               the result in the baseline document shape, so
//                               the existing renderer, layout and highlights work
//
// Source ids: exp:<id> (the job's header), exp:<id>.d (its description),
// exp:<id>.b<n> (its n-th bullet, from 1), the same for proj:, edu:<id>,
// extra:<id>, skill:<name>, profile:summary, profile:location,
// profile:workAuthorization and profile:clearance.

import { normalizeTerm, corpusHas, profileCorpus } from './keywords.js';
import { estimateDocHeight } from './layout.js';
import { extraText } from './resumeDoc.js';

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const words = (s) => str(s).split(/\s+/).filter(Boolean);

// ── Source index ──────────────────────────────────────────────────────────────

// Map id → { text, entry } where entry is the owning item's id (exp:3 for
// exp:3.b2) or null for profile-wide sources.
export function sourceIndex(profile) {
  const p = profile || {};
  const index = new Map();
  const add = (id, text, entry = null) => { if (str(text)) index.set(id, { text: str(text), entry }); };
  add('profile:summary', p.summary);
  add('profile:location', p.location);
  add('profile:workAuthorization', p.workAuthorization);
  add('profile:clearance', p.clearance);
  for (const s of p.skills || []) add(`skill:${str(s)}`, s);
  for (const x of p.experiences || []) {
    const id = `exp:${x.id}`;
    add(id, [x.title, x.company, x.location].filter(Boolean).join(' — '), id);
    add(`${id}.d`, x.description, id);
    (x.bullets || []).forEach((b, i) => add(`${id}.b${i + 1}`, b, id));
  }
  for (const x of p.projects || []) {
    const id = `proj:${x.id}`;
    add(id, x.name, id);
    add(`${id}.d`, x.description, id);
    (x.bullets || []).forEach((b, i) => add(`${id}.b${i + 1}`, b, id));
  }
  for (const e of p.education || []) {
    add(`edu:${e.id}`, [e.degreeType, e.major, e.minor, e.institution, e.honors, e.coursework].filter(Boolean).join(' — '), `edu:${e.id}`);
  }
  for (const x of p.extras || []) {
    add(`extra:${x.id}`, [x.title, x.organization, x.description].filter(Boolean).join(' — '), `extra:${x.id}`);
  }
  return index;
}

// The profile with every citable line tagged, for the compose prompt.
export function renderProfileForCompose(profile) {
  const p = profile || {};
  const lines = [];
  if (str(p.summary)) lines.push('SUMMARY', `[profile:summary] ${str(p.summary)}`, '');
  if (str(p.location)) lines.push(`[profile:location] Location: ${str(p.location)}`, '');
  if (str(p.workAuthorization)) lines.push(`[profile:workAuthorization] Work authorization: ${str(p.workAuthorization)}`, '');
  if (str(p.clearance)) lines.push(`[profile:clearance] Security clearance: ${str(p.clearance)}`, '');
  if ((p.skills || []).length) lines.push('SKILLS', (p.skills || []).map(s => `[skill:${str(s)}]`).join(' '), '');
  const dates = (x) => [str(x.start), str(x.end)].filter(Boolean).join(' – ');
  if ((p.experiences || []).length) {
    lines.push('EXPERIENCE (newest first)');
    for (const x of p.experiences) {
      const id = `exp:${x.id}`;
      lines.push(`[${id}] ${str(x.title)} — ${str(x.company)}${x.location ? `, ${str(x.location)}` : ''}${dates(x) ? ` (${dates(x)})` : ''}${x.mustInclude ? ' [MUST INCLUDE]' : ''}`);
      if (str(x.description)) lines.push(`  [${id}.d] ${str(x.description)}`);
      (x.bullets || []).forEach((b, i) => lines.push(`  [${id}.b${i + 1}] ${str(b)}`));
    }
    lines.push('');
  }
  if ((p.projects || []).length) {
    lines.push('PROJECTS');
    for (const x of p.projects) {
      const id = `proj:${x.id}`;
      lines.push(`[${id}] ${str(x.name)}${x.mustInclude ? ' [MUST INCLUDE]' : ''}`);
      if (str(x.description)) lines.push(`  [${id}.d] ${str(x.description)}`);
      (x.bullets || []).forEach((b, i) => lines.push(`  [${id}.b${i + 1}] ${str(b)}`));
    }
    lines.push('');
  }
  if ((p.education || []).length) {
    lines.push('EDUCATION');
    for (const e of p.education) lines.push(`[edu:${e.id}] ${[e.degreeType, e.major && `in ${e.major}`, e.institution].filter(Boolean).join(' ')}${dates(e) ? ` (${dates(e)})` : ''}`);
    lines.push('');
  }
  if ((p.extras || []).length) {
    lines.push('CERTIFICATIONS, AWARDS AND OTHER');
    for (const x of p.extras) lines.push(`[extra:${x.id}] (${x.type || 'other'}) ${[x.title, x.organization].filter(Boolean).join(' — ')}${x.description ? `: ${str(x.description)}` : ''}`);
  }
  return lines.join('\n').trim();
}

// ── Schema ────────────────────────────────────────────────────────────────────

const LINE = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text: { type: 'string', description: 'The line as it should appear on the resume.' },
    sources: { type: 'array', items: { type: 'string' }, description: 'Ids of the profile lines this text is drawn from.' }
  },
  required: ['text', 'sources']
};
const PICK = (desc) => ({ type: 'object', additionalProperties: false, properties: { id: { type: 'string', description: desc } }, required: ['id'] });
const ENTRY = (desc) => ({
  type: 'object',
  additionalProperties: false,
  properties: { id: { type: 'string', description: desc }, bullets: { type: 'array', items: LINE } },
  required: ['id', 'bullets']
});

export const COMPOSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: LINE,
    skill_groups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { label: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } },
        required: ['label', 'items']
      }
    },
    experience: { type: 'array', items: ENTRY('exp:<id> of a profile job') },
    projects: { type: 'array', items: ENTRY('proj:<id> of a profile project') },
    education: { type: 'array', items: PICK('edu:<id>') },
    extras: { type: 'array', items: PICK('extra:<id>') },
    section_order: {
      type: 'array',
      items: { type: 'string', enum: ['experience', 'projects', 'education', 'extras'] },
      description: 'Order of the sections after the summary and skills.'
    }
  },
  required: ['summary', 'skill_groups', 'experience', 'projects', 'education', 'extras', 'section_order']
};

// Sections after the summary and skills, in the order a resume shows them
// when nothing says otherwise.
export const DEFAULT_SECTION_ORDER = ['experience', 'projects', 'education', 'extras'];

// The model's order made valid: known sections, each once, missing ones
// appended in the default order.
export function normalizeSectionOrder(order) {
  const out = [];
  for (const s of order || []) if (DEFAULT_SECTION_ORDER.includes(s) && !out.includes(s)) out.push(s);
  for (const s of DEFAULT_SECTION_ORDER) if (!out.includes(s)) out.push(s);
  return out;
}

// ── Facts: numbers and named terms ────────────────────────────────────────────

// Numbers as written, canonicalised: "94%", "40M", "$1.2M" → "1200000", "2,000" → "2000".
export function numbersIn(text) {
  const out = new Set();
  const t = String(text || '').replace(/(\d[\d,.]*)\s*(thousand|million|billion)\b/gi, (_, n, w) => n + ({ thousand: 'k', million: 'm', billion: 'b' })[w.toLowerCase()]);
  for (const m of t.matchAll(/\$?(\d[\d,]*(?:\.\d+)?)\s?(%|[kmb]\b|x\b)?/gi)) {
    const n = parseFloat(m[1].replace(/,/g, ''));
    const unit = (m[2] || '').toLowerCase();
    const mult = { k: 1e3, m: 1e6, b: 1e9 }[unit] || 1;
    out.add(unit === '%' ? `${n}%` : unit === 'x' ? `${n}x` : String(Math.round(n * mult * 100) / 100));
  }
  return out;
}

const STOP = new Set(['i', 'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'from', 'as', 'via', 'into', 'per']);

// Tool-like terms a reader takes as claims: names with a digit or symbol
// (Node.js, CI/CD, C++), CamelCase (TypeScript), acronyms (AWS), and
// capitalised words that do not start a sentence (Kubernetes, Stripe).
export function namedTerms(text) {
  const out = [];
  const s = String(text || '');
  for (const m of s.matchAll(/[A-Za-z][A-Za-z0-9+#./-]*[A-Za-z0-9+#]|[A-Za-z]/g)) {
    const w = m[0].replace(/[./-]+$/, '');
    if (w.length < 2 || STOP.has(w.toLowerCase())) continue;
    if (/\d/.test(s[m.index - 1] || '')) continue;   // the unit of a number: 10K+, 2M
    const before = s.slice(0, m.index).trimEnd();
    const sentenceStart = !before || /[.!?:;•(]$/.test(before);
    // An acronym joined to a word is still a claim: "ML-focused".
    const head = w.split('-')[0];
    if (head !== w && /^[A-Z]{2,}s?$/.test(head)) { out.push(head); continue; }
    const toolish = /[0-9+#./]/.test(w) && /[A-Za-z]/.test(w);
    const camel = /[a-z][A-Z]/.test(w);
    const acronym = /^[A-Z]{2,}s?$/.test(w);
    const proper = /^[A-Z][a-z]/.test(w) && !sentenceStart;
    if (toolish || camel || acronym || proper) out.push(w);
  }
  return out;
}

// Posting keywords whose other form the profile has: both forms are fair to use.
function supportedAliases(match, corpus) {
  const ok = new Set();
  for (const k of (match && match.keywords) || []) {
    if (!k || typeof k !== 'object' || !k.alias) continue;
    if (corpusHas(corpus, normalizeTerm(k.term)) || corpusHas(corpus, normalizeTerm(k.alias))) {
      ok.add(normalizeTerm(k.term)); ok.add(normalizeTerm(k.alias));
    }
  }
  return ok;
}

const termCorpus = (texts) => ` ${normalizeTerm(texts.join(' '))} `;

// ── Validation ────────────────────────────────────────────────────────────────

export const FILLER = ['results-driven', 'results driven', 'detail-oriented', 'detail oriented', 'proven track record', 'responsible for',
  'duties included', 'team player', 'self-starter', 'go-getter', 'hard-working', 'passionate', 'synergy', 'leverage', 'leveraged',
  'leveraging', 'spearheaded', 'cutting-edge', 'best-in-class', 'world-class', 'seamless', 'utilize', 'utilized', 'robust',
  'impactful', 'think outside the box', 'wide range of', 'excellent communication skills'];

const MAX_SUMMARY_WORDS = 60;
const MAX_BULLET_WORDS = 40;
const MAX_KEYWORD_USES = 3;

// Checks a composition against the profile and the match analysis.
// errors: { code, target, message } the model must fix (repair pass);
// warnings: worth doing but not blocking. The input is not modified.
export function validateComposition(comp, profile, match = null) {
  const errors = [];
  const warnings = [];
  const fail = (code, target, message) => errors.push({ code, target, message });
  const warn = (code, target, message) => warnings.push({ code, target, message });
  const c = comp || {};
  const p = profile || {};
  const index = sourceIndex(p);
  const corpus = profileCorpus(p);
  const aliases = supportedAliases(match, corpus);
  const skillCorpus = termCorpus(p.skills || []);
  const role = termCorpus([match && match.role]);

  // Every line: real sources from its own entry (or profile-wide ones),
  // numbers and named terms only from those sources (or the skills list).
  const checkLine = (line, target, entry, { allowRole = false } = {}) => {
    const text = str(line && line.text);
    const sources = (line && line.sources) || [];
    if (!text) return fail('empty', target, 'Empty line.');
    if (!sources.length) return fail('unsourced', target, `"${text}" cites no sources.`);
    const unknown = sources.filter(id => !index.has(id));
    if (unknown.length) fail('unknown_source', target, `Unknown source ids: ${unknown.join(', ')}.`);
    const known = sources.filter(id => index.has(id));
    if (entry && known.length && !known.some(id => index.get(id).entry === entry)) {
      fail('wrong_entry', target, `A ${entry} bullet must cite at least one line of ${entry}.`);
    }
    const sourceText = known.map(id => index.get(id).text);
    const allowedNumbers = new Set(sourceText.flatMap(t => [...numbersIn(t)]));
    const extraNumbers = [...numbersIn(text)].filter(n => !allowedNumbers.has(n));
    if (extraNumbers.length) fail('number', target, `Numbers not in the cited sources: ${extraNumbers.join(', ')}.`);
    const allowedTerms = termCorpus(sourceText);
    const extraTerms = [...new Set(namedTerms(text))].filter(t => {
      const n = normalizeTerm(t);
      return n && !corpusHas(allowedTerms, n) && !corpusHas(skillCorpus, n) && !aliases.has(n) && !(allowRole && corpusHas(role, n));
    });
    if (extraTerms.length) fail('term', target, `Not in the cited sources or the profile's skills: ${extraTerms.join(', ')}.`);
    if (words(text).length > (entry ? MAX_BULLET_WORDS : MAX_SUMMARY_WORDS)) fail('too_long', target, `"${text.slice(0, 40)}…" is too long.`);
  };

  // Summary
  if (!str(c.summary && c.summary.text)) fail('no_summary', 'summary', 'Write a 2–3 line summary.');
  else checkLine(c.summary, 'summary', null, { allowRole: true });

  // Skills: only the profile's skills (or a supported alias), no duplicates.
  const seenSkills = new Set();
  for (const [gi, g] of (c.skill_groups || []).entries()) {
    for (const item of g.items || []) {
      const forms = (item.match(/^(.*?)\s*\((.*)\)$/) || [null, item]).slice(1).filter(Boolean).map(normalizeTerm);
      if (!forms.some(f => corpusHas(skillCorpus, f) || corpusHas(corpus, f) || aliases.has(f))) {
        errors.push({ code: 'skill', target: `skill_groups[${gi}]`, item, message: `"${item}" is not in the profile.` });
      }
      const key = forms[0];
      if (seenSkills.has(key)) errors.push({ code: 'duplicate_skill', target: `skill_groups[${gi}]`, item, message: `"${item}" is listed twice.` });
      seenSkills.add(key);
    }
  }

  // Entries: real ids, each once; jobs and projects carry bullets.
  const checkEntries = (list, kind, { needsBullets }) => {
    const seen = new Set();
    for (const [i, e] of (list || []).entries()) {
      const target = `${kind}[${i}]`;
      if (!index.has(e.id) || !String(e.id).startsWith(`${kind === 'experience' ? 'exp' : kind === 'projects' ? 'proj' : kind === 'education' ? 'edu' : 'extra'}:`)) {
        fail('unknown_entry', target, `Unknown ${kind} id "${e.id}".`);
        continue;
      }
      if (seen.has(e.id)) fail('duplicate_entry', target, `${e.id} appears twice.`);
      seen.add(e.id);
      if (!needsBullets) continue;
      if (!(e.bullets || []).length) fail('no_bullets', target, `${e.id} needs at least one bullet.`);
      (e.bullets || []).forEach((b, j) => checkLine(b, `${target}.bullets[${j}]`, e.id));
    }
  };
  checkEntries(c.experience, 'experience', { needsBullets: true });
  checkEntries(c.projects, 'projects', { needsBullets: true });
  checkEntries(c.education, 'education', { needsBullets: false });
  checkEntries(c.extras, 'extras', { needsBullets: false });
  if ((p.education || []).length && !(c.education || []).length) fail('no_education', 'education', 'Include the education.');

  // ── Match ──
  const doc = toResumeDoc(c, p);
  const text = ` ${normalizeTerm(docText(doc))} `;
  const bulletText = ` ${normalizeTerm([...doc.experiences, ...doc.projects].flatMap(e => e.bullets).join(' '))} `;
  const keywords = ((match && match.keywords) || []).map(k => (typeof k === 'string' ? { term: k, importance: 'core', alias: '' } : k));
  const core = keywords.filter(k => k.importance === 'core');
  const supported = core.filter(k => corpusHas(corpus, normalizeTerm(k.term)) || (k.alias && corpusHas(corpus, normalizeTerm(k.alias))));
  for (const k of supported) {
    if (!corpusHas(text, normalizeTerm(k.term))) fail('keyword', 'keywords', `Use the posting's term "${k.term}" where the profile supports it${k.alias ? ` (profile: ${k.alias})` : ''}.`);
    else if (k.alias && !corpusHas(text, normalizeTerm(k.alias))) warn('acronym', 'keywords', `Give "${k.term}" and "${k.alias}" once each.`);
  }
  for (const k of core) {
    const n = (text.match(new RegExp(`(?<![a-z0-9+#])${normalizeTerm(k.term).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?![a-z0-9+#])`, 'g')) || []).length;
    if (n > MAX_KEYWORD_USES) fail('stuffing', 'keywords', `"${k.term}" appears ${n} times; at most ${MAX_KEYWORD_USES}.`);
  }
  const covered = supported.filter(k => corpusHas(text, normalizeTerm(k.term)));
  const inBullets = covered.filter(k => corpusHas(bulletText, normalizeTerm(k.term)) || (k.alias && corpusHas(bulletText, normalizeTerm(k.alias))));
  if (covered.length && inBullets.length / covered.length < 0.7) {
    warn('skills_in_context', 'bullets', `Show more of the matched skills in bullets, not only in Skills: ${covered.filter(k => !inBullets.includes(k)).map(k => k.term).join(', ')}.`);
  }

  const chosen = new Set([...(c.experience || []), ...(c.projects || []), ...(c.education || []), ...(c.extras || [])].map(e => e.id));
  const evidenced = (id) => {
    const clean = String(id).trim().replace(/^\[\s*|\s*\]$/g, '');
    if (clean.startsWith('skill:')) return corpusHas(text, normalizeTerm(clean.slice(6)));
    if (clean.startsWith('profile:')) return true;
    return chosen.has(clean.replace(/\.(d|b\d+)$/, ''));
  };
  for (const q of ((match && match.requirements) || []).filter(q => q.kind === 'required' && q.strength !== 'none' && (q.evidence || []).length)) {
    if (!q.evidence.some(evidenced)) fail('requirement', 'requirements', `Show "${q.text}" (evidence: ${q.evidence.join(', ')}).`);
  }
  for (const h of ((match && match.hard_requirements) || []).filter(h => h.met === 'yes')) {
    if (!(h.evidence || []).some(evidenced)) warn('hard_requirement', 'requirements', `State "${h.text}" (evidence: ${h.evidence.join(', ')}).`);
  }

  const lowered = docText(doc).toLowerCase();
  const filler = FILLER.filter(f => lowered.includes(f));
  if (filler.length) fail('filler', 'text', `Remove filler: ${filler.join(', ')}.`);

  return { errors, warnings };
}

// ── Conversion ────────────────────────────────────────────────────────────────

// The composition as a resume document in the baseline shape (baseline.js):
// what resumeDocToSchema() and the layout code read. Titles, employers,
// dates, locations and education come from the profile; jobs are kept newest
// first in profile order whatever order the model chose. Unknown ids are
// skipped. Each bullet's sources ride along in `bulletSources`.
export function toResumeDoc(comp, profile) {
  const c = comp || {};
  const p = profile || {};
  const pick = (list, kind, prefix) => {
    const wanted = new Map((list || []).map(e => [String(e.id), e]));
    return (p[kind] || []).filter(x => wanted.has(`${prefix}:${x.id}`)).map(x => ({ x, e: wanted.get(`${prefix}:${x.id}`) }));
  };
  const withBullets = ({ x, e }, prefix) => ({
    id: `${prefix}:${x.id}`,
    bullets: (e.bullets || []).map(b => str(b.text)).filter(Boolean),
    bulletIds: (e.bullets || []).filter(b => str(b.text)).map((b, i) => `${prefix}:${x.id}.c${i + 1}`),
    bulletSources: (e.bullets || []).filter(b => str(b.text)).map(b => b.sources || [])
  });
  return {
    name: str(p.name),
    contact: str(p.contact),
    location: str(p.location),
    summary: str(c.summary && c.summary.text),
    summarySources: (c.summary && c.summary.sources) || [],
    skills: (c.skill_groups || []).flatMap(g => g.items || []),
    skillGroups: (c.skill_groups || []).filter(g => (g.items || []).length).map((g, i) => ({ id: `skills:${i + 1}`, label: str(g.label), items: g.items.map(str).filter(Boolean) })),
    experiences: pick(c.experience, 'experiences', 'exp').map(({ x, e }) => ({
      title: str(x.title), company: str(x.company), start: str(x.start), end: str(x.end), location: str(x.location),
      ...withBullets({ x, e }, 'exp')
    })),
    projects: pick(c.projects, 'projects', 'proj').map(({ x, e }) => ({
      name: str(x.name), description: str(x.description), link: str(x.link),
      ...withBullets({ x, e }, 'proj')
    })),
    education: pick(c.education, 'education', 'edu').map(({ x }) => ({ ...x, id: `edu:${x.id}` })),
    extras: pick(c.extras, 'extras', 'extra').map(({ x }) => ({ ...x, id: `extra:${x.id}` })),
    sectionOrder: normalizeSectionOrder(c.section_order)
  };
}

// Change records for the preview (highlight.js previewResumes): each summary
// or bullet line that differs from its sources, with the sources' text as
// `before`, so the new words are marked and hovering shows where the line
// came from. Lines copied as written get none. Pure.
export function composeChanges(doc, profile) {
  const index = sourceIndex(profile);
  const from = (ids) => (ids || []).filter(id => !id.startsWith('skill:')).map(id => index.get(id)?.text).filter(Boolean).join(' / ');
  const changes = [];
  const add = (id, text, sources) => {
    const before = from(sources);
    if (text && before && text !== before) changes.push({ id, op: 'rewrite', before, after: text, from: true });
  };
  add('summary', doc.summary, doc.summarySources);
  for (const e of [...(doc.experiences || []), ...(doc.projects || [])]) {
    (e.bullets || []).forEach((b, i) => add((e.bulletIds || [])[i], b, (e.bulletSources || [])[i]));
  }
  return changes;
}

// ── After the repair passes ───────────────────────────────────────────────────

// Truth errors that make a line unusable; such lines are dropped, never shown.
const DROP_LINE = new Set(['empty', 'unsourced', 'unknown_source', 'wrong_entry', 'number', 'term', 'too_long']);

// Removes whatever the validator still rejects after the repair passes:
// bad lines, skills and entries go; a job or project left without bullets
// goes; a bad summary is emptied; education is restored if it was dropped.
// Returns { comp, dropped } with a description of each removal. Pure.
export function sanitizeComposition(comp, errors, profile) {
  const c = JSON.parse(JSON.stringify(comp || {}));
  const dropped = [];
  const lineAt = (target) => target.match(/^(experience|projects)\[(\d+)\]\.bullets\[(\d+)\]$/);
  const badLines = new Set();
  const badEntries = new Set();
  for (const e of errors || []) {
    if (e.target === 'summary' && DROP_LINE.has(e.code)) {
      if (c.summary && c.summary.text) dropped.push(`summary: ${e.message}`);
      c.summary = { text: '', sources: [] };
    } else if (lineAt(e.target) && DROP_LINE.has(e.code)) {
      badLines.add(e.target);
    } else if (/^(experience|projects|education|extras)\[\d+\]$/.test(e.target) && ['unknown_entry', 'duplicate_entry'].includes(e.code)) {
      badEntries.add(e.target);
    }
  }
  for (const kind of ['experience', 'projects']) {
    c[kind] = (c[kind] || []).map((entry, i) => ({
      ...entry,
      bullets: (entry.bullets || []).filter((b, j) => {
        const bad = badLines.has(`${kind}[${i}].bullets[${j}]`);
        if (bad) dropped.push(`${entry.id} bullet: ${b.text}`);
        return !bad;
      })
    }));
  }
  for (const kind of ['experience', 'projects', 'education', 'extras']) {
    c[kind] = (c[kind] || []).filter((entry, i) => {
      if (badEntries.has(`${kind}[${i}]`)) { dropped.push(`${kind} entry ${entry.id}`); return false; }
      if ((kind === 'experience' || kind === 'projects') && !(entry.bullets || []).length) { dropped.push(`${entry.id}: no usable bullets`); return false; }
      return true;
    });
  }
  // Skills the profile lacks go, and so does every repeat of a skill.
  const notInProfile = new Set((errors || []).filter(e => e.code === 'skill').map(e => e.item));
  const seenSkills = new Set();
  c.skill_groups = (c.skill_groups || []).map(g => ({
    ...g,
    items: (g.items || []).filter(item => {
      const key = normalizeTerm(String(item).replace(/\s*\(.*\)$/, ''));
      const keep = !notInProfile.has(item) && !seenSkills.has(key);
      seenSkills.add(key);
      if (!keep) dropped.push(`skill: ${item}`);
      return keep;
    })
  })).filter(g => g.items.length);
  if ((profile.education || []).length && !(c.education || []).length) c.education = profile.education.map(e => ({ id: `edu:${e.id}` }));
  return { comp: c, dropped };
}

// ── One page ──────────────────────────────────────────────────────────────────

// Lines and entries that prove a supported required qualification: trimming
// never removes them.
function protectedProof(match) {
  const ids = new Set();
  for (const q of ((match && match.requirements) || []).filter(q => q.kind === 'required' && q.strength !== 'none')) {
    for (const id of q.evidence || []) ids.add(String(id).trim().replace(/^\[\s*|\s*\]$/g, ''));
  }
  return ids;
}

// Trims the composition to one page by the layout's estimate, least
// relevant first: extras from the end, then project bullets beyond the first,
// then whole projects from the end, then job bullets beyond two and then
// beyond one, oldest jobs first (the model lists bullets most relevant first,
// so the last bullet goes). Never removes a line or entry that is evidence for
// a supported required qualification, never a job. offsetPx corrects the
// estimate by what a real render measured (the extension's second pass).
// Returns { comp, trimmed, page: { afterPx, limitPx, fits } }. Pure.
export function fitComposition(comp, profile, match, layout, { offsetPx = 0 } = {}) {
  const c = JSON.parse(JSON.stringify(comp || {}));
  const keep = protectedProof(match);
  const limitPx = layout.capacityPx - layout.kinds.bullet.lineHeight * 0.5;
  const height = () => estimateDocHeight(layout, toResumeDoc(c, profile), extraText) + offsetPx;
  const isProof = (b) => (b.sources || []).some(id => keep.has(id));
  const entryProtected = (e) => keep.has(e.id) || (e.bullets || []).some(isProof);
  const trimmed = [];

  const dropLastBullet = (entry, min) => {
    const bullets = entry.bullets || [];
    if (bullets.length <= min) return false;
    for (let j = bullets.length - 1; j >= 0; j--) {
      if (isProof(bullets[j])) continue;
      trimmed.push(`${entry.id} bullet: ${bullets[j].text}`);
      bullets.splice(j, 1);
      return true;
    }
    return false;
  };
  const steps = [
    () => { const i = [...(c.extras || [])].reverse().findIndex(e => !keep.has(e.id)); if (i < 0) return false; const at = c.extras.length - 1 - i; trimmed.push(`extra ${c.extras[at].id}`); c.extras.splice(at, 1); return true; },
    () => [...(c.projects || [])].reverse().some(p => dropLastBullet(p, 1)),
    () => { const i = [...(c.projects || [])].reverse().findIndex(p => !entryProtected(p)); if (i < 0) return false; const at = c.projects.length - 1 - i; trimmed.push(`project ${c.projects[at].id}`); c.projects.splice(at, 1); return true; },
    () => oldestFirst().some(e => dropLastBullet(e, 2)),
    () => oldestFirst().some(e => dropLastBullet(e, 1))
  ];
  // Jobs in profile order are newest first; trim from the oldest.
  const order = (profile.experiences || []).map(x => `exp:${x.id}`);
  const oldestFirst = () => [...(c.experience || [])].sort((a, b) => order.indexOf(b.id) - order.indexOf(a.id));

  while (height() > limitPx) {
    if (!steps.some(step => step())) break;
  }
  const afterPx = Math.round(height());
  return { comp: c, trimmed, page: { afterPx, limitPx: Math.round(limitPx), fits: afterPx <= limitPx } };
}

// All visible text of a resume document.
function docText(doc) {
  return [doc.summary, ...(doc.skills || []),
    ...doc.experiences.flatMap(e => [e.title, e.company, ...e.bullets]),
    ...doc.projects.flatMap(e => [e.name, e.description, ...e.bullets]),
    ...doc.education.map(e => [e.degreeType, e.major, e.institution, e.coursework].join(' ')),
    ...doc.extras.map(x => [x.title, x.organization, x.description].join(' '))].filter(Boolean).join('\n');
}
