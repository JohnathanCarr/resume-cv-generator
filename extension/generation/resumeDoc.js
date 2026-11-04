// Measures on a resume document (baseline.js / compose.js toResumeDoc shape):
// its text, word count and which posting keywords it contains. Pure.

import { normalizeTerm, keywordTerms } from './keywords.js';

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const dates = (e) => [str(e.start), str(e.end)].filter(Boolean).join(' – ');

// An extra's one line as the template prints it.
export function extraText(x) {
  return [str(x.title), str(x.organization)].filter(Boolean).join(' – ')
    + (dates(x) ? ` (${dates(x)})` : '') + (str(x.description) ? `: ${str(x.description)}` : '');
}

export function docText(doc) {
  return [
    doc.summary,
    ...(doc.skillGroups || []).flatMap(g => g.items),
    ...(doc.experiences || []).flatMap(e => [e.title, ...(e.bullets || [])]),
    ...(doc.projects || []).flatMap(p => [p.name, p.description, ...(p.bullets || [])]),
    ...(doc.education || []).flatMap(e => [e.degreeType, e.major, e.coursework]),
    ...(doc.extras || []).map(extraText)
  ].filter(Boolean).join(' ');
}

export function docWords(doc) {
  return docText(doc).trim().split(/\s+/).filter(Boolean).length;
}

// Which of the posting's keywords (core only, or all) appear in the document.
export function keywordCoverage(doc, match, { coreOnly = true } = {}) {
  const terms = [...new Set(keywordTerms(match, { coreOnly }))];
  const text = ` ${normalizeTerm(docText(doc))} `;
  const found = terms.filter(t => {
    const n = normalizeTerm(t);
    return n && new RegExp(`(^|[^a-z0-9+#])${n.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}([^a-z0-9+#]|$)`).test(text);
  });
  return { found: found.length, total: terms.length, missing: terms.filter(t => !found.includes(t)) };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const SEASONS = { winter: 0, spring: 3, summer: 6, fall: 9, autumn: 9 };

// A date as months since year 0, for ordering: "Feb 2026", "02/2026",
// "Spring 2025", "2025" (December, as an end), "Present" (now, so last).
// null when it cannot be read.
export function dateValue(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  if (/^(present|current|now|ongoing)$/.test(t)) return Infinity;
  let m = t.match(/^([a-z]+)\.?,?\s+(\d{4})$/);
  if (m) {
    const i = MONTHS.findIndex(x => m[1].startsWith(x));
    const s = SEASONS[m[1]];
    if (i >= 0) return +m[2] * 12 + i;
    if (s !== undefined) return +m[2] * 12 + s;
  }
  if ((m = t.match(/^(\d{1,2})\/(\d{4})$/))) return +m[2] * 12 + (+m[1] - 1);
  if ((m = t.match(/^(\d{4})$/))) return +m[1] * 12 + 11;
  return null;
}

// Entries (jobs, projects) newest first: by end date, then start date. An
// entry whose dates cannot be read keeps its place relative to its
// neighbours as far as a stable sort allows. Returns a new array.
export function newestFirst(list) {
  const key = (x) => [dateValue(x.end) ?? (x.end ? null : dateValue(x.start)), dateValue(x.start)];
  return [...(list || [])].map((x, i) => ({ x, i, k: key(x) })).sort((a, b) => {
    for (let j = 0; j < 2; j++) {
      const p = a.k[j], q = b.k[j];
      if (p == null || q == null) { if (j === 0) return a.i - b.i; continue; }
      if (p !== q) return q - p;
    }
    return a.i - b.i;
  }).map(o => o.x);
}
