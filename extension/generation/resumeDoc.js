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
