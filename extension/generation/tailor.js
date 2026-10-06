// Tailoring as an edit list. The model never rewrites the resume; it returns
// a short list of edits against the user's own resume (the baseline snapshot,
// see baseline.js), and this module validates and applies them. Anything not
// edited stays exactly as the user wrote it, and every change is known
// precisely, so the preview can highlight it.
//
// Edits:
//   rewrite  target=<line id>, text           reword one line (same facts, posting's terms)
//   swap     target=<item id>, with=<pool id> replace a bullet/project/extra with unused
//                                             profile material of the same kind (bullets:
//                                             same job only); text optionally rewords it
//   skills   target=skills:<n>, items         the full, reordered item list for one skill
//                                             line, keeping every original item, adding
//                                             only skills from the profile
//   remove   target=<item id>                 drop a bullet (a job keeps at least one),
//                                             a project, an extra or a coursework line,
//                                             only to fit the page
// Jobs, education entries and headers are never edited or removed.
//
// The page is a hard limit, planned from the start: with a layout (layout.js)
// every line in the prompt carries its size and spare room, the page's free
// space is stated, validateEdits() totals the height every edit adds or saves,
// and fitToPage() is the last resort (undo growth, then drop whole items).
//
// Pure functions, no DOM, no API calls.

import { normalizeTerm, keywordTerms } from './keywords.js';
import { lineCount, spareChars, itemHeight, projectHeight, estimateDocHeight } from './layout.js';

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const norm = (s) => String(s || '').toLowerCase().replace(/[.,;:'"()]/g, '').replace(/\s+/g, ' ').trim();
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const dates = (e) => [str(e.start), str(e.end)].filter(Boolean).join(' – ');
const splitCourses = (s) => String(s || '').split(/\s*[,;]\s*/).map(str).filter(Boolean);

// ── Pool: profile material that is not on the resume ────────────────────────

const expKey = (e) => `${norm(e.company)}|${norm(e.title)}`;
const projKey = (p) => norm(p.name);
const extraKey = (x) => `${norm(x.title)}|${norm(x.organization)}`;
const eduKey = (e) => norm(e.institution);

// Everything a swap or skills edit may draw on. Ids:
//   more:exp:1.2   second unused profile bullet of baseline job exp:1
//   more:proj:1.1  first unused profile bullet of baseline project proj:1
//   pool:proj:3    third profile project that is not on the resume
//   pool:extra:2   second profile extra that is not on the resume
function buildPool(doc, profile) {
  const pool = { bullets: {}, projects: [], extras: [], skills: [], courses: {} };

  const moreBullets = (baseItems, profileItems, keyFn) => {
    for (const b of baseItems || []) {
      const match = (profileItems || []).find(p => keyFn(p) === keyFn(b));
      if (!match) continue;
      const have = new Set((b.bullets || []).map(norm));
      (match.bullets || []).map(str).filter(t => t && !have.has(norm(t))).forEach((text, i) => {
        pool.bullets[`more:${b.id}.${i + 1}`] = { owner: b.id, text };
      });
    }
  };
  moreBullets(doc.experiences, profile.experiences, expKey);
  moreBullets(doc.projects, profile.projects, projKey);

  const baseProjects = new Set((doc.projects || []).map(projKey));
  (profile.projects || []).filter(p => str(p.name) && !baseProjects.has(projKey(p))).forEach((p, i) => {
    pool.projects.push({ id: `pool:proj:${i + 1}`, name: str(p.name), description: str(p.description), link: str(p.link), bullets: (p.bullets || []).map(str).filter(Boolean) });
  });

  const baseExtras = new Set((doc.extras || []).map(extraKey));
  (profile.extras || []).filter(x => str(x.title) && !baseExtras.has(extraKey(x))).forEach((x, i) => {
    pool.extras.push({ id: `pool:extra:${i + 1}`, type: x.type, title: str(x.title), organization: str(x.organization), start: str(x.start), end: str(x.end), description: str(x.description) });
  });

  const baseSkills = new Set(allSkillItems(doc).map(normalizeTerm));
  pool.skills = [...new Set((profile.skills || []).map(str).filter(s => s && !baseSkills.has(normalizeTerm(s))))];

  for (const e of doc.education || []) {
    const match = (profile.education || []).find(p => eduKey(p) === eduKey(e));
    const have = new Set(splitCourses(e.coursework).map(norm));
    const extra = splitCourses(match?.coursework).filter(c => !have.has(norm(c)));
    if (extra.length) pool.courses[e.id] = extra;
  }
  return pool;
}

function allSkillItems(doc) {
  return (doc.skillGroups || []).flatMap(g => g.items);
}

// ── Rendering for the prompt ─────────────────────────────────────────────────

// Every editable line of the resume, by id, with what kind of edit it accepts.
function editableLines(doc) {
  const lines = {};
  if (str(doc.summary)) lines.summary = { kind: 'summary', text: str(doc.summary) };
  for (const g of doc.skillGroups || []) lines[g.id] = { kind: 'skills', group: g };
  for (const e of doc.experiences || []) {
    (e.bullets || []).forEach((b, i) => { lines[`${e.id}.b${i + 1}`] = { kind: 'bullet', owner: e.id, text: b }; });
  }
  for (const p of doc.projects || []) {
    lines[p.id] = { kind: 'project', project: p };
    (p.bullets || []).forEach((b, i) => { lines[`${p.id}.b${i + 1}`] = { kind: 'bullet', owner: p.id, text: b }; });
  }
  for (const e of doc.education || []) {
    if (str(e.coursework)) lines[`${e.id}.coursework`] = { kind: 'coursework', owner: e.id, text: str(e.coursework) };
  }
  for (const x of doc.extras || []) lines[x.id] = { kind: 'extra', extra: x, text: extraText(x) };
  return lines;
}

function extraText(x) {
  return [str(x.title), str(x.organization)].filter(Boolean).join(' – ')
    + (dates(x) ? ` (${dates(x)})` : '') + (str(x.description) ? `: ${str(x.description)}` : '');
}

const skillLineText = (g, items = g.items) => `${g.label || 'Skills'}: ${items.join(', ')}`;

// With a layout, each line's tag says how many rendered lines it takes and
// how many characters still fit before it wraps onto another.
function renderDocForPrompt(doc, layout = null) {
  const tag = (id, kind, text) => layout
    ? `[${id} · ${lineCount(layout, kind, text)} line${lineCount(layout, kind, text) === 1 ? '' : 's'}, ${spareChars(layout, kind, text)} spare]`
    : `[${id}]`;
  const out = [];
  if (str(doc.summary)) out.push('SUMMARY', `${tag('summary', 'summary', doc.summary)} ${doc.summary}`, '');
  if ((doc.skillGroups || []).length) {
    out.push('SKILLS');
    for (const g of doc.skillGroups) out.push(`${tag(g.id, 'skills', skillLineText(g))} ${g.label ? `${g.label}: ` : ''}${g.items.join(', ')}`);
    out.push('');
  }
  if ((doc.experiences || []).length) {
    out.push('EXPERIENCE (job headers are fixed)');
    for (const e of doc.experiences) {
      out.push(`${e.id}: ${e.title} — ${e.company}${dates(e) ? ` (${dates(e)})` : ''}`);
      (e.bullets || []).forEach((b, i) => out.push(`  ${tag(`${e.id}.b${i + 1}`, 'bullet', b)} ${b}`));
    }
    out.push('');
  }
  if ((doc.education || []).length) {
    out.push('EDUCATION (fixed except coursework)');
    for (const e of doc.education) {
      out.push(`${e.id}: ${[e.degreeType, e.major].filter(Boolean).join(' in ')} — ${e.institution}`);
      if (str(e.coursework)) out.push(`  ${tag(`${e.id}.coursework`, 'coursework', e.coursework)} ${e.coursework}`);
    }
    out.push('');
  }
  if ((doc.projects || []).length) {
    out.push('PROJECTS');
    for (const p of doc.projects) {
      out.push(`[${p.id}] ${p.name}${p.description ? ` — ${p.description}` : ''}`);
      (p.bullets || []).forEach((b, i) => out.push(`  ${tag(`${p.id}.b${i + 1}`, 'bullet', b)} ${b}`));
    }
    out.push('');
  }
  if ((doc.extras || []).length) {
    out.push('CERTIFICATIONS, AWARDS & OTHER');
    for (const x of doc.extras) out.push(`${tag(x.id, 'extra', extraText(x))} ${extraText(x)}`);
  }
  return out.join('\n').trim();
}

// ── Page budget ──────────────────────────────────────────────────────────────

// Height of the baseline as laid out: measured by the extension when it can,
// estimated from the layout otherwise. Space is what is left under one page,
// less half a line of safety for rounding in the estimate.
function pageBudget(doc, layout) {
  const usedPx = Number.isFinite(layout.usedPx) ? layout.usedPx : estimateDocHeight(layout, doc, extraText);
  const lineUnit = layout.kinds.bullet.lineHeight;
  const limitPx = layout.capacityPx - lineUnit * 0.5;
  return { usedPx, limitPx, lineUnit, spacePx: limitPx - usedPx, spareLines: Math.floor((limitPx - usedPx) / lineUnit) };
}

// Height an edit adds (positive) or saves (negative). Edits must be valid.
function editDelta(e, doc, pool, layout) {
  const line = editableLines(doc)[e.target];
  if (!line) return 0;
  if (e.op === 'remove') {
    if (line.kind === 'project') return -projectHeight(layout, line.project);
    return -itemHeight(layout, line.kind, line.text);
  }
  if (e.op === 'skills') {
    return itemHeight(layout, 'skills', skillLineText(line.group, e.items || [])) - itemHeight(layout, 'skills', skillLineText(line.group));
  }
  if (e.op === 'swap') {
    if (line.kind === 'bullet') return itemHeight(layout, 'bullet', str(e.text) || pool.bullets[e.with].text) - itemHeight(layout, 'bullet', line.text);
    if (line.kind === 'project') return projectHeight(layout, pool.projects.find(p => p.id === e.with)) - projectHeight(layout, line.project);
    if (line.kind === 'extra') return itemHeight(layout, 'extra', extraText(pool.extras.find(x => x.id === e.with))) - itemHeight(layout, 'extra', line.text);
  }
  if (e.op === 'rewrite') return itemHeight(layout, line.kind, str(e.text)) - itemHeight(layout, line.kind, line.text);
  return 0;
}

function pageCheck(edits, doc, pool, layout) {
  const budget = pageBudget(doc, layout);
  const deltaPx = edits.reduce((a, e) => a + editDelta(e, doc, pool, layout), 0);
  const afterPx = budget.usedPx + deltaPx;
  return { ...budget, deltaPx, afterPx, overPx: Math.max(0, afterPx - budget.limitPx), overLines: Math.ceil(Math.max(0, afterPx - budget.limitPx) / budget.lineUnit) };
}

function describeBudget(budget) {
  return budget.spareLines >= 0
    ? `The resume must fit on one page; this is a hard limit. Right now about ${budget.spareLines} line${budget.spareLines === 1 ? '' : 's'} of space are free.`
    : `The resume must fit on one page; this is a hard limit. Right now it is about ${-budget.spareLines} line${budget.spareLines === -1 ? '' : 's'} too long, so your edits must remove at least that much: drop the least relevant bullets, projects or certification lines.`;
}

// Last resort when the model's edits still do not fit: first undo the edits
// that grow the page, largest first; then remove whole items, least likely to
// matter first: certification/award/other lines from the end, project bullets
// and projects from the end, then the last bullets of the oldest jobs (every
// job keeps one), then coursework. Never shortens a line.
function fitToPage(edits, doc, pool, layout) {
  let kept = [...edits];
  const trimmed = [];
  let check = pageCheck(kept, doc, pool, layout);
  if (!check.overPx) return { edits: kept, trimmed, undone: [], page: check };

  const undone = [];
  const growth = kept.map(e => ({ e, d: editDelta(e, doc, pool, layout) })).filter(x => x.d > 0).sort((a, b) => b.d - a.d);
  for (const { e } of growth) {
    if (!check.overPx) break;
    kept = kept.filter(x => x !== e);
    undone.push(e);
    check = pageCheck(kept, doc, pool, layout);
  }

  const targeted = () => new Set(kept.map(e => e.target));
  const candidates = [];
  for (const x of [...(doc.extras || [])].reverse()) candidates.push(x.id);
  for (const p of [...(doc.projects || [])].reverse()) {
    (p.bullets || []).map((_, i) => `${p.id}.b${i + 1}`).reverse().forEach(id => candidates.push(id));
    candidates.push(p.id);
  }
  for (const j of [...(doc.experiences || [])].reverse()) {
    (j.bullets || []).slice(1).map((_, i) => `${j.id}.b${i + 2}`).reverse().forEach(id => candidates.push(id));
  }
  for (const e of doc.education || []) if (str(e.coursework)) candidates.push(`${e.id}.coursework`);

  for (const id of candidates) {
    if (!check.overPx) break;
    const t = targeted();
    if (t.has(id)) continue;
    const owner = id.replace(/\.b\d+$/, '');
    if (/^proj:\d+$/.test(id)) {
      // Removing a project replaces any removals of its bullets.
      kept = kept.filter(x => !(x.op === 'remove' && x.target.startsWith(`${id}.`)));
      if (kept.some(x => x.target.startsWith(`${id}.`))) continue;
    } else if (/^proj:\d+\.b\d+$/.test(id) && t.has(owner)) continue;
    const e = { op: 'remove', target: id, with: null, text: null, items: null, reason: 'Fit to one page' };
    kept.push(e);
    trimmed.push(id);
    check = pageCheck(kept, doc, pool, layout);
  }
  return { edits: kept, trimmed, undone, page: check };
}

function renderPoolForPrompt(pool) {
  const out = [];
  const bullets = Object.entries(pool.bullets);
  if (bullets.length) {
    out.push('Unused bullets (swap only into the item named in the id):');
    for (const [id, b] of bullets) out.push(`  [${id}] ${b.text}`);
  }
  if (pool.projects.length) {
    out.push('Projects not on the resume:');
    for (const p of pool.projects) {
      out.push(`  [${p.id}] ${p.name}${p.description ? ` — ${p.description}` : ''}`);
      for (const b of p.bullets) out.push(`      • ${b}`);
    }
  }
  if (pool.extras.length) {
    out.push('Certifications, awards & other items not on the resume:');
    for (const x of pool.extras) out.push(`  [${x.id}] ${extraText(x)}`);
  }
  if (pool.skills.length) out.push(`Skills in the profile but not on the resume: ${pool.skills.join(', ')}`);
  for (const [id, courses] of Object.entries(pool.courses)) out.push(`Other courses for ${id}: ${courses.join(', ')}`);
  return out.length ? out.join('\n') : 'None.';
}

// ── Schema and prompt ────────────────────────────────────────────────────────

const nullable = (t) => ({ type: [t, 'null'] });

const EDITS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    edits: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          op: { type: 'string', enum: ['rewrite', 'swap', 'skills', 'remove'] },
          target: { type: 'string', description: 'Id of the resume line or item being edited, e.g. exp:1.b2, proj:2, skills:1, summary.' },
          with: { ...nullable('string'), description: 'swap only: the unused item id that replaces the target.' },
          text: { ...nullable('string'), description: 'rewrite: the new line. swap: optional reworded version of an incoming bullet; null to use it as written.' },
          items: { type: ['array', 'null'], items: { type: 'string' }, description: 'skills only: the complete new item list for that skill line.' },
          reason: { type: 'string', description: 'The posting term or requirement this edit serves, in a few words.' }
        },
        required: ['op', 'target', 'with', 'text', 'items', 'reason']
      }
    }
  },
  required: ['edits']
};

const SYSTEM = `You tailor a candidate's existing resume to one job posting so applicant tracking systems (ATS) and recruiters see the match. You do not rewrite the resume. You return a short list of edits; everything you do not edit stays exactly as the candidate wrote it.

Edit types:
- rewrite: reword one line (a bullet, the summary, a coursework line) so it uses the posting's exact terms for things the line already shows. Keep every fact, number, tool and outcome; add none, and remove none. Add the posting's term alongside the candidate's wording; never trade a stronger or more specific claim for the posting's weaker one (keep "statistical modeling", do not turn it into "basic statistics"). An added term must name something the line already describes: the posting's name for it, its acronym or full form, or the category it belongs to ("Kubernetes upgrade" for a Kubernetes version migration). Do not add outcomes or qualities the line does not state (reliability, scalability, data quality), and never insert soft-skill words (written, communication, collaboration) into a bullet. Use parentheses only for an acronym and its full form, or the posting's spelling and the candidate's, and only when they differ. Use the posting's spelling, and where the posting uses an acronym or a full name, give both once ("Search Engine Optimization (SEO)"). Keep it about the same length. Only rewrite a line when it gains a posting term or requirement it lacks.
- swap: replace a resume bullet, project or certification/award line with unused profile material of the same kind that is clearly more relevant to the posting. A bullet may only be replaced by an unused bullet of the same job or project (the id says which). Projects swap with projects, certifications/awards/other lines with each other. You may reword an incoming bullet under the rewrite rules (text), or leave text null.
- remove: drop a bullet, a project, a certification/award/other line or a coursework line. Only to make the resume fit its page, and always the least relevant item for this posting. A job keeps at least one bullet.
- skills: give the complete new item list for one skill line: every item it has now, most posting-relevant first, plus any skills from "Skills in the profile but not on the resume" that the posting asks for, each placed on the line where it fits best. You may write an existing item in the posting's spelling while keeping the original in parentheses ("PostgreSQL (Postgres)"). Never add a skill that is not in the profile.

Rules:
1. Nothing the candidate does not have. No new tools, metrics, employers, responsibilities or outcomes; the profile and resume are the only sources.
2. Fewer, better edits. Typically 3–10. Do not touch lines that already serve the posting, and do not reword for style.
3. Keyword placement, best ATS practice: each core keyword the candidate has should appear in the skills section and, where a bullet genuinely demonstrates it, in that bullet. No keyword more than three times in the whole resume.
4. Never remove or reorder jobs or education, never change headers, titles, dates or employers. Each target is edited at most once, and each unused item is used at most once.
5. Only edit the summary if the resume has one (target "summary"). Never add a summary.
6. Coursework lines may only list courses already on that line or listed as "Other courses" for that school.
7. Give each edit a reason naming the posting term or requirement it serves.
8. One page, hard limit. Each line's tag shows how many rendered lines it takes and how many characters still fit on its last line ("2 lines, 14 spare"). A rewrite that adds no more than the spare characters costs no space; going past them adds a line. Swapped-in items take their own length. Plan the edits so the page budget given below is never exceeded; if the resume is already too long, remove the least relevant items first.`;

function buildTailorMessages({ doc, pool, jobText, matchText, match, layout = null }) {
  const core = keywordTerms(match, { coreOnly: true });
  const budget = layout ? pageBudget(doc, layout) : null;
  const user = `Tailor this resume to the posting with as few edits as achieve a strong ATS match.

JOB POSTING:
${jobText}

MATCH ANALYSIS (which requirements the candidate meets, and the posting's ATS keywords):
${matchText}

Core keywords to place where the candidate genuinely has them: ${core.join(', ') || 'none'}

CURRENT RESUME (ids in brackets${layout ? ', with each line\'s size' : ''}):
${doc ? renderDocForPrompt(doc, layout) : ''}

UNUSED PROFILE MATERIAL (may be swapped in):
${renderPoolForPrompt(pool)}${budget ? `

PAGE: ${describeBudget(budget)}` : ''}`;
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
}

// ── Validation ───────────────────────────────────────────────────────────────

// Named things in a line: tools, languages, acronyms, proper nouns (any word
// with a capital, digit or + # . / inside). The first word is skipped, since
// it is usually the bullet's verb. A rewrite must keep all of them.
function namedTerms(text) {
  return String(text || '').split(/\s+/).slice(1)
    .map(w => w.replace(/^[^\w+#.]+|[^\w+#]+$/g, ''))
    .filter(w => w && /[A-Z0-9+#]|\w[./]\w/.test(w))
    .map(w => w.toLowerCase());
}

function droppedTerms(text, source) {
  const have = ` ${String(text || '').toLowerCase().replace(/[^\w+#./ -]+/g, ' ')} `;
  return [...new Set(namedTerms(source))].filter(t => !have.includes(t.toLowerCase()));
}

const numbersIn = (s) => new Set((String(s || '').match(/\d[\d,.]*/g) || []).map(n => n.replace(/[,.]+$/, '').replace(/,/g, '')));

function newNumbers(text, source) {
  const have = numbersIn(source);
  return [...numbersIn(text)].filter(n => !have.has(n));
}

// Returns { valid, errors }: the edits that can be applied as given, and a
// message for each one that cannot (fed back to the model in a repair pass).
// With a layout, `page` reports the height the valid edits leave, and an
// over-the-page result adds a PAGE error (the edits themselves stay valid).
function validateEdits(edits, doc, pool, layout = null) {
  const lines = editableLines(doc);
  const used = new Set();
  const usedPool = new Set();
  const valid = [];
  const errors = [];
  const otherSkillItems = (groupId) => new Set((doc.skillGroups || []).filter(g => g.id !== groupId).flatMap(g => g.items).map(normalizeTerm));
  const allowedSkills = new Set([...allSkillItems(doc), ...pool.skills].map(normalizeTerm));
  // A project being swapped out takes its bullets with it.
  const swappedProjects = new Set((Array.isArray(edits) ? edits : []).filter(e => (e.op === 'swap' || e.op === 'remove') && /^proj:\d+$/.test(e.target)).map(e => e.target));
  const removedFrom = {};

  for (const e of Array.isArray(edits) ? edits : []) {
    const fail = (msg) => errors.push(`${e.op} ${e.target}: ${msg}`);
    const line = lines[e.target];
    if (!line) { fail('no such editable line'); continue; }
    if (used.has(e.target)) { fail('target edited more than once'); continue; }
    if (line.kind === 'bullet' && swappedProjects.has(line.owner)) { fail(`${line.owner} is swapped out or removed, so its bullets cannot be edited`); continue; }

    if (e.op === 'rewrite') {
      const text = str(e.text);
      if (!['summary', 'bullet', 'coursework'].includes(line.kind)) { fail(`a ${line.kind} line cannot be rewritten`); continue; }
      if (!text) { fail('empty text'); continue; }
      const nums = newNumbers(text, line.text);
      if (nums.length) { fail(`adds numbers not in the original (${nums.join(', ')})`); continue; }
      const dropped = line.kind === 'coursework' ? [] : droppedTerms(text, line.text);
      if (dropped.length) { fail(`drops terms from the original line (${dropped.join(', ')}); keep them and add the posting's term alongside`); continue; }
      if (words(text) > Math.ceil(words(line.text) * 1.4) + 4) { fail('much longer than the original line'); continue; }
      if (line.kind === 'coursework') {
        const allowed = new Set([...splitCourses(line.text), ...(pool.courses[line.owner] || [])].map(norm));
        const bad = splitCourses(text).filter(c => !allowed.has(norm(c)));
        if (bad.length) { fail(`courses not in the profile: ${bad.join(', ')}`); continue; }
      }
    } else if (e.op === 'swap') {
      const id = str(e.with);
      if (usedPool.has(id)) { fail(`${id} is already used`); continue; }
      if (line.kind === 'bullet') {
        const incoming = pool.bullets[id];
        if (!incoming) { fail(`${id} is not an unused bullet`); continue; }
        if (incoming.owner !== line.owner) { fail(`${id} belongs to ${incoming.owner}, not ${line.owner}`); continue; }
        if (str(e.text)) {
          const nums = newNumbers(e.text, incoming.text);
          if (nums.length) { fail(`reworded bullet adds numbers (${nums.join(', ')})`); continue; }
        }
      } else if (line.kind === 'project') {
        if (!pool.projects.some(p => p.id === id)) { fail(`${id} is not an unused project`); continue; }
      } else if (line.kind === 'extra') {
        if (!pool.extras.some(x => x.id === id)) { fail(`${id} is not an unused certification/award/other item`); continue; }
      } else { fail(`a ${line.kind} line cannot be swapped`); continue; }
      usedPool.add(id);
    } else if (e.op === 'skills') {
      if (line.kind !== 'skills') { fail('skills edits target a skills:<n> line'); continue; }
      const items = (Array.isArray(e.items) ? e.items : []).map(str).filter(Boolean);
      const lowered = items.map(i => i.toLowerCase());
      const missing = line.group.items.filter(orig => !lowered.some(i => i.includes(orig.toLowerCase())));
      if (missing.length) { fail(`drops existing skills: ${missing.join(', ')}`); continue; }
      // An item is allowed if it is an existing or profile skill, or an existing
      // item written as "Posting spelling (original)".
      const others = otherSkillItems(line.group.id);
      const bad = items.filter(i => {
        const t = normalizeTerm(i);
        if (allowedSkills.has(t)) return false;
        const inner = i.match(/\(([^)]+)\)\s*$/);
        return !(inner && allowedSkills.has(normalizeTerm(inner[1])));
      });
      if (bad.length) { fail(`not in the profile: ${bad.join(', ')}`); continue; }
      const dupes = items.filter(i => others.has(normalizeTerm(i)));
      if (dupes.length) { fail(`already on another skill line: ${dupes.join(', ')}`); continue; }
      if (new Set(items.map(normalizeTerm)).size !== items.length) { fail('duplicate items'); continue; }
    } else if (e.op === 'remove') {
      if (!['bullet', 'project', 'extra', 'coursework'].includes(line.kind)) { fail(`a ${line.kind} line cannot be removed`); continue; }
      if (line.kind === 'bullet' && /^exp:/.test(line.owner)) {
        const job = doc.experiences.find(x => x.id === line.owner);
        removedFrom[line.owner] = (removedFrom[line.owner] || 0) + 1;
        if (removedFrom[line.owner] >= (job.bullets || []).length) { removedFrom[line.owner]--; fail(`${line.owner} must keep at least one bullet`); continue; }
      }
    } else { fail('unknown op'); continue; }

    used.add(e.target);
    valid.push(e);
  }
  let page = null;
  if (layout) {
    page = pageCheck(valid, doc, pool, layout);
    if (page.overPx > 0) {
      errors.push(`PAGE: these edits leave the resume about ${page.overLines} line${page.overLines === 1 ? '' : 's'} over one page (${page.spareLines >= 0 ? `${page.spareLines} free before the edits` : `${-page.spareLines} over before the edits`}). Keep rewrites within their spare characters, swap in shorter items, or remove the least relevant bullets, projects or certification lines.`);
    }
  }
  return { valid, errors, page };
}

// ── Applying ─────────────────────────────────────────────────────────────────

// Returns { doc, changes }: a tailored copy of the resume document (same
// shape and ids as the baseline, swapped-in items keep the id of the item
// they replaced) and one change record per edit, keyed by that id:
//   { id, op, before, after, added?, reason }
// before/after are line text (skills: the item lists). Edits must be valid.
// Every experience and project in the result carries bulletIds, the baseline
// id of each remaining bullet (a swapped-in project's bullets get new ones),
// so the preview can match lines to changes after removals shift positions.
function applyEdits(baseDoc, pool, edits) {
  const doc = JSON.parse(JSON.stringify(baseDoc));
  const changes = [];
  const entries = () => [...(doc.experiences || []), ...(doc.projects || [])];
  const findEntry = (id) => entries().find(x => x.id === id);
  for (const x of entries()) x.bulletIds = (x.bullets || []).map((_, i) => `${x.id}.b${i + 1}`);

  for (const e of edits.filter(x => x.op !== 'remove')) {
    const reason = str(e.reason);
    const bullet = e.target.match(/^((?:exp|proj):\d+)\.b(\d+)$/);
    if (e.target === 'summary') {
      changes.push({ id: 'summary', op: 'rewrite', before: doc.summary, after: str(e.text), reason });
      doc.summary = str(e.text);
    } else if (bullet) {
      const entry = findEntry(bullet[1]);
      const i = Number(bullet[2]) - 1;
      const before = entry.bullets[i];
      const after = e.op === 'swap' ? (str(e.text) || pool.bullets[e.with].text) : str(e.text);
      entry.bullets[i] = after;
      changes.push({ id: e.target, op: e.op, before, after, reason });
    } else if (/\.coursework$/.test(e.target)) {
      const edu = doc.education.find(x => `${x.id}.coursework` === e.target);
      changes.push({ id: e.target, op: 'rewrite', before: edu.coursework, after: str(e.text), reason });
      edu.coursework = str(e.text);
    } else if (/^skills:/.test(e.target)) {
      const g = doc.skillGroups.find(x => x.id === e.target);
      const before = g.items;
      const after = e.items.map(str).filter(Boolean);
      const had = new Set(before.map(normalizeTerm));
      // A respelling ("PostgreSQL (Postgres)") replaces its original; an item
      // that merely contains another one still on the line ("gRPC streaming"
      // next to "gRPC") is new.
      const respelled = (i) => before.some(b => !after.includes(b) && i.toLowerCase().includes(b.toLowerCase()));
      const added = after.filter(i => !had.has(normalizeTerm(i)) && !respelled(i));
      g.items = after;
      changes.push({ id: e.target, op: 'skills', before, after, added, reason });
    } else if (/^proj:/.test(e.target)) {
      const idx = doc.projects.findIndex(x => x.id === e.target);
      const incoming = pool.projects.find(p => p.id === e.with);
      changes.push({ id: e.target, op: 'swap', before: doc.projects[idx].name, after: incoming.name, reason });
      doc.projects[idx] = { ...incoming, id: e.target, bulletIds: incoming.bullets.map((_, i) => `${e.target}.new${i + 1}`) };
    } else if (/^extra:/.test(e.target)) {
      const idx = doc.extras.findIndex(x => x.id === e.target);
      const incoming = pool.extras.find(x => x.id === e.with);
      changes.push({ id: e.target, op: 'swap', before: extraText(doc.extras[idx]), after: extraText(incoming), reason });
      doc.extras[idx] = { ...incoming, id: e.target };
    }
  }

  // Removals last, by id, so earlier positions do not shift under them.
  for (const e of edits.filter(x => x.op === 'remove')) {
    const reason = str(e.reason);
    const bullet = e.target.match(/^((?:exp|proj):\d+)\.b\d+$/);
    if (bullet) {
      const entry = findEntry(bullet[1]);
      const i = entry.bulletIds.indexOf(e.target);
      if (i === -1) continue;
      changes.push({ id: e.target, op: 'remove', before: entry.bullets[i], after: null, reason });
      entry.bullets.splice(i, 1);
      entry.bulletIds.splice(i, 1);
    } else if (/\.coursework$/.test(e.target)) {
      const edu = doc.education.find(x => `${x.id}.coursework` === e.target);
      changes.push({ id: e.target, op: 'remove', before: edu.coursework, after: null, reason });
      edu.coursework = '';
    } else if (/^proj:/.test(e.target)) {
      const p = doc.projects.find(x => x.id === e.target);
      changes.push({ id: e.target, op: 'remove', before: p.name, after: null, reason });
      doc.projects = doc.projects.filter(x => x !== p);
    } else if (/^extra:/.test(e.target)) {
      const x = doc.extras.find(y => y.id === e.target);
      changes.push({ id: e.target, op: 'remove', before: extraText(x), after: null, reason });
      doc.extras = doc.extras.filter(y => y !== x);
    }
  }
  doc.skills = allSkillItems(doc);
  return { doc, changes };
}

// ── Measures ─────────────────────────────────────────────────────────────────

function docText(doc) {
  return [
    doc.summary,
    ...allSkillItems(doc),
    ...(doc.experiences || []).flatMap(e => [e.title, ...(e.bullets || [])]),
    ...(doc.projects || []).flatMap(p => [p.name, p.description, ...(p.bullets || [])]),
    ...(doc.education || []).flatMap(e => [e.degreeType, e.major, e.coursework]),
    ...(doc.extras || []).map(extraText)
  ].filter(Boolean).join(' ');
}

function docWords(doc) {
  return words(docText(doc));
}

// Which of the posting's keywords (core only, or all) appear in the document.
function keywordCoverage(doc, match, { coreOnly = true } = {}) {
  const terms = [...new Set(keywordTerms(match, { coreOnly }))];
  const text = ` ${normalizeTerm(docText(doc))} `;
  const found = terms.filter(t => {
    const n = normalizeTerm(t);
    return n && new RegExp(`(^|[^a-z0-9+#])${n.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}([^a-z0-9+#]|$)`).test(text);
  });
  return { found: found.length, total: terms.length, missing: terms.filter(t => !found.includes(t)) };
}

export {
  EDITS_SCHEMA, buildPool, buildTailorMessages, validateEdits, applyEdits, fitToPage, pageCheck, pageBudget,
  editableLines, renderDocForPrompt, renderPoolForPrompt, keywordCoverage, docWords, extraText
};
