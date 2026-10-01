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
// Jobs, education entries and headers are never edited or removed.
//
// Pure functions, no DOM, no API calls.

import { normalizeTerm, keywordTerms } from './keywords.js';

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

function renderDocForPrompt(doc) {
  const out = [];
  if (str(doc.summary)) out.push('SUMMARY', `[summary] ${doc.summary}`, '');
  if ((doc.skillGroups || []).length) {
    out.push('SKILLS');
    for (const g of doc.skillGroups) out.push(`[${g.id}] ${g.label ? `${g.label}: ` : ''}${g.items.join(', ')}`);
    out.push('');
  }
  if ((doc.experiences || []).length) {
    out.push('EXPERIENCE (job headers are fixed)');
    for (const e of doc.experiences) {
      out.push(`${e.id}: ${e.title} — ${e.company}${dates(e) ? ` (${dates(e)})` : ''}`);
      (e.bullets || []).forEach((b, i) => out.push(`  [${e.id}.b${i + 1}] ${b}`));
    }
    out.push('');
  }
  if ((doc.education || []).length) {
    out.push('EDUCATION (fixed except coursework)');
    for (const e of doc.education) {
      out.push(`${e.id}: ${[e.degreeType, e.major].filter(Boolean).join(' in ')} — ${e.institution}`);
      if (str(e.coursework)) out.push(`  [${e.id}.coursework] ${e.coursework}`);
    }
    out.push('');
  }
  if ((doc.projects || []).length) {
    out.push('PROJECTS');
    for (const p of doc.projects) {
      out.push(`[${p.id}] ${p.name}${p.description ? ` — ${p.description}` : ''}`);
      (p.bullets || []).forEach((b, i) => out.push(`  [${p.id}.b${i + 1}] ${b}`));
    }
    out.push('');
  }
  if ((doc.extras || []).length) {
    out.push('CERTIFICATIONS, AWARDS & OTHER');
    for (const x of doc.extras) out.push(`[${x.id}] ${extraText(x)}`);
  }
  return out.join('\n').trim();
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
          op: { type: 'string', enum: ['rewrite', 'swap', 'skills'] },
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
- skills: give the complete new item list for one skill line: every item it has now, most posting-relevant first, plus any skills from "Skills in the profile but not on the resume" that the posting asks for, each placed on the line where it fits best. You may write an existing item in the posting's spelling while keeping the original in parentheses ("PostgreSQL (Postgres)"). Never add a skill that is not in the profile.

Rules:
1. Nothing the candidate does not have. No new tools, metrics, employers, responsibilities or outcomes; the profile and resume are the only sources.
2. Fewer, better edits. Typically 3–10. Do not touch lines that already serve the posting, and do not reword for style.
3. Keyword placement, best ATS practice: each core keyword the candidate has should appear in the skills section and, where a bullet genuinely demonstrates it, in that bullet. No keyword more than three times in the whole resume.
4. Never remove or reorder jobs or education, never change headers, titles, dates or employers. Each target is edited at most once, and each unused item is used at most once.
5. Only edit the summary if the resume has one (target "summary"). Never add a summary.
6. Coursework lines may only list courses already on that line or listed as "Other courses" for that school.
7. Give each edit a reason naming the posting term or requirement it serves.`;

function buildTailorMessages({ doc, pool, jobText, matchText, match, maxNetWords = null }) {
  const core = keywordTerms(match, { coreOnly: true });
  const user = `Tailor this resume to the posting with as few edits as achieve a strong ATS match.

JOB POSTING:
${jobText}

MATCH ANALYSIS (which requirements the candidate meets, and the posting's ATS keywords):
${matchText}

Core keywords to place where the candidate genuinely has them: ${core.join(', ') || 'none'}

CURRENT RESUME (ids in brackets):
${doc ? renderDocForPrompt(doc) : ''}

UNUSED PROFILE MATERIAL (may be swapped in):
${renderPoolForPrompt(pool)}${maxNetWords !== null ? `

LENGTH: the last edits pushed the resume past its page. This time the edits together must change the word count by at most ${maxNetWords} words (negative means shorter): prefer swaps for shorter items and rewrites no longer than the line they replace.` : ''}`;
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
function validateEdits(edits, doc, pool) {
  const lines = editableLines(doc);
  const used = new Set();
  const usedPool = new Set();
  const valid = [];
  const errors = [];
  const otherSkillItems = (groupId) => new Set((doc.skillGroups || []).filter(g => g.id !== groupId).flatMap(g => g.items).map(normalizeTerm));
  const allowedSkills = new Set([...allSkillItems(doc), ...pool.skills].map(normalizeTerm));
  // A project being swapped out takes its bullets with it.
  const swappedProjects = new Set((Array.isArray(edits) ? edits : []).filter(e => e.op === 'swap' && /^proj:\d+$/.test(e.target)).map(e => e.target));

  for (const e of Array.isArray(edits) ? edits : []) {
    const fail = (msg) => errors.push(`${e.op} ${e.target}: ${msg}`);
    const line = lines[e.target];
    if (!line) { fail('no such editable line'); continue; }
    if (used.has(e.target)) { fail('target edited more than once'); continue; }
    if (line.kind === 'bullet' && swappedProjects.has(line.owner)) { fail(`${line.owner} is swapped out, so its bullets cannot be edited`); continue; }

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
    } else { fail('unknown op'); continue; }

    used.add(e.target);
    valid.push(e);
  }
  return { valid, errors };
}

// ── Applying ─────────────────────────────────────────────────────────────────

// Returns { doc, changes }: a tailored copy of the resume document (same
// shape and ids as the baseline, swapped-in items keep the id of the item
// they replaced) and one change record per edit, keyed by that id:
//   { id, op, before, after, added?, reason }
// before/after are line text (skills: the item lists). Edits must be valid.
function applyEdits(baseDoc, pool, edits) {
  const doc = JSON.parse(JSON.stringify(baseDoc));
  const changes = [];
  const findEntry = (id) => [...(doc.experiences || []), ...(doc.projects || [])].find(x => x.id === id);

  for (const e of edits) {
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
      const added = after.filter(i => !had.has(normalizeTerm(i)) && !before.some(b => i.toLowerCase().includes(b.toLowerCase())));
      g.items = after;
      changes.push({ id: e.target, op: 'skills', before, after, added, reason });
    } else if (/^proj:/.test(e.target)) {
      const idx = doc.projects.findIndex(x => x.id === e.target);
      const incoming = pool.projects.find(p => p.id === e.with);
      changes.push({ id: e.target, op: 'swap', before: doc.projects[idx].name, after: incoming.name, reason });
      doc.projects[idx] = { ...incoming, id: e.target };
    } else if (/^extra:/.test(e.target)) {
      const idx = doc.extras.findIndex(x => x.id === e.target);
      const incoming = pool.extras.find(x => x.id === e.with);
      changes.push({ id: e.target, op: 'swap', before: extraText(doc.extras[idx]), after: extraText(incoming), reason });
      doc.extras[idx] = { ...incoming, id: e.target };
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
  EDITS_SCHEMA, buildPool, buildTailorMessages, validateEdits, applyEdits,
  editableLines, renderDocForPrompt, renderPoolForPrompt, keywordCoverage, docWords
};
