// Preview highlights for a composed resume. From the resume document and its
// change records (compose.js composeChanges) this builds two renderable
// resumes in the shape formatResume() takes:
//   marked  the words of each summary or bullet line that are new relative
//           to its profile sources, wrapped in <span class="rs-added">;
//           hover shows the source lines.
//   clean   the same resume with no marks, for the PDF.
// Every string is HTML-escaped in both, so resume text can never inject
// markup into the page.
//
// Pure functions, no DOM.

import { resumeDocToSchema } from './baseline.js';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const mark = (html, title) =>
  `<span class="rs-added"${title ? ` title="${escapeHtml(title)}"` : ''}>${html}</span>`;

// Word-level diff: the words of `after` that are not part of the longest
// common word sequence with `before` are marked; runs of marked words (and
// the spaces between them) share one span.
function diffWords(before, after, title = '') {
  const a = String(before || '').split(/\s+/).filter(Boolean);
  const b = String(after || '').split(/\s+/).filter(Boolean);
  // Words match ignoring surrounding punctuation, so "Postgres" kept as
  // "(Postgres)" or "API" as "API," is not counted as new.
  const key = (w) => w.replace(/^[^\w+#]+|[^\w+#]+$/g, '') || w;
  const ka = a.map(key), kb = b.map(key);
  const lcs = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = ka[i] === kb[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const added = new Array(b.length).fill(true);
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (ka[i] === kb[j]) { added[j] = false; i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
    else j++;
  }
  const out = [];
  for (let j = 0; j < b.length;) {
    if (!added[j]) { out.push(escapeHtml(b[j])); j++; continue; }
    const run = [];
    while (j < b.length && added[j]) run.push(escapeHtml(b[j++]));
    out.push(mark(run.join(' '), title));
  }
  return out.join(' ');
}

// Hover text: the profile lines a composed line came from (composeChanges);
// resumes saved by the old edit-list engine carry the line they replaced.
const why = (c) => `${c.from ? 'From your profile' : 'Was'}: ${c.before}`;

// A copy of the document whose text fields hold escaped HTML, with the new
// words of each changed summary or bullet marked. Field structure stays as
// resumeDocToSchema() expects.
function markDoc(doc, changes, { withMarks }) {
  const byId = new Map((changes || []).filter(c => c.op === 'rewrite' && typeof c.before === 'string').map(c => [c.id, c]));
  const out = JSON.parse(JSON.stringify(doc || {}));
  const esc = (v) => (typeof v === 'string' ? escapeHtml(v) : v);
  const line = (id, text) => {
    const c = withMarks && byId.get(id);
    return c ? diffWords(c.before, text, why(c)) : esc(text);
  };

  out.summary = line('summary', doc.summary);
  for (const k of ['name', 'contact', 'location']) out[k] = esc(doc[k]);
  out.skillGroups = (doc.skillGroups || []).map(g => ({ ...g, label: esc(g.label), items: g.items.map(escapeHtml) }));
  out.education = (doc.education || []).map(e => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, esc(v)])));
  const entries = (list) => (list || []).map(e => {
    const o = Object.fromEntries(Object.entries(e).map(([k, v]) => [k, Array.isArray(v) ? v : esc(v)]));
    o.bullets = (e.bullets || []).map((b, i) => line((e.bulletIds || [])[i], b));
    return o;
  });
  out.experiences = entries(doc.experiences);
  out.projects = entries(doc.projects);
  out.extras = (doc.extras || []).map(x => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, esc(v)])));
  return out;
}

// { marked, clean } in formatResume()'s shape.
function previewResumes(doc, changes) {
  return {
    clean: resumeDocToSchema(markDoc(doc, changes, { withMarks: false })),
    marked: resumeDocToSchema(markDoc(doc, changes, { withMarks: true }))
  };
}

export { escapeHtml, diffWords, previewResumes };
