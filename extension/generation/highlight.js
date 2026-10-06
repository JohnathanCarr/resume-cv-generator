// Preview highlights for a tailored resume. From the tailored document and
// its change records (tailor.js applyEdits) this builds two renderable
// resumes in the shape formatResume() takes:
//   marked  every change wrapped in <span class="rs-added">: the new words of
//           a rewritten line, an added skill, a whole swapped-in line or
//           project; removed items are simply absent. Hover shows what the
//           line said before and why it changed.
//   clean   the same resume with no marks, for the PDF.
// Every string is HTML-escaped in both, so resume text can never inject
// markup into the page.
//
// Pure functions, no DOM.

import { resumeDocToSchema } from './baseline.js';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const mark = (html, title, line = false) =>
  `<span class="rs-added${line ? ' rs-line' : ''}"${title ? ` title="${escapeHtml(title)}"` : ''}>${html}</span>`;

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

const why = (c) => [c.before && typeof c.before === 'string' ? `Was: ${c.before}` : '', c.reason ? `Why: ${c.reason}` : ''].filter(Boolean).join('\n');
const isNew = (c) => c && (c.op === 'swap');

// A copy of the document whose text fields hold escaped HTML, with marks
// where changes are. Field structure stays as resumeDocToSchema() expects.
function markDoc(doc, changes, { withMarks }) {
  const byId = new Map((changes || []).map(c => [c.id, c]));
  const out = JSON.parse(JSON.stringify(doc || {}));
  const esc = (v) => (typeof v === 'string' ? escapeHtml(v) : v);
  const line = (id, text) => {
    const c = withMarks && byId.get(id);
    if (!c) return esc(text);
    if (isNew(c)) return mark(escapeHtml(text), why(c), true);
    if (c.op === 'rewrite') return diffWords(c.before, text, why(c));
    return esc(text);
  };

  out.summary = line('summary', doc.summary);
  for (const k of ['name', 'contact', 'location']) out[k] = esc(doc[k]);

  out.skillGroups = (doc.skillGroups || []).map(g => {
    const c = withMarks && byId.get(g.id);
    const before = c ? c.before : g.items;
    return {
      ...g,
      label: esc(g.label),
      items: g.items.map(item => {
        if (!c || before.includes(item)) return escapeHtml(item);
        // A respelling replaces its original; otherwise the item is new.
        const orig = before.find(b => !g.items.includes(b) && item.toLowerCase().includes(b.toLowerCase()));
        return orig ? diffWords(orig, item, `Was: ${orig}`) : mark(escapeHtml(item), c.reason ? `Added: ${c.reason}` : 'Added for this posting');
      })
    };
  });

  out.education = (doc.education || []).map(e => {
    const o = Object.fromEntries(Object.entries(e).map(([k, v]) => [k, esc(v)]));
    if (e.coursework) o.coursework = line(`${e.id}.coursework`, e.coursework);
    return o;
  });

  const entries = (list) => (list || []).map(e => {
    const swapped = withMarks && byId.get(e.id);
    const o = Object.fromEntries(Object.entries(e).map(([k, v]) => [k, Array.isArray(v) ? v : esc(v)]));
    if (swapped && isNew(swapped)) {
      const title = why(swapped);
      o.name = mark(escapeHtml(e.name), title, true);
      if (e.description) o.description = mark(escapeHtml(e.description), title, true);
      o.bullets = (e.bullets || []).map(b => mark(escapeHtml(b), title, true));
    } else {
      o.bullets = (e.bullets || []).map((b, i) => line((e.bulletIds || [])[i], b));
    }
    return o;
  });
  out.experiences = entries(doc.experiences);
  out.projects = entries(doc.projects);
  out.extras = (doc.extras || []).map(x => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, esc(v)])));
  return out;
}

// { marked, clean } in formatResume()'s shape. A swapped-in certification /
// award line is marked as a whole once it is assembled into its line.
function previewResumes(doc, changes) {
  const clean = resumeDocToSchema(markDoc(doc, changes, { withMarks: false }));
  const marked = resumeDocToSchema(markDoc(doc, changes, { withMarks: true }));
  const byId = new Map((changes || []).map(c => [c.id, c]));
  (doc.extras || []).forEach((x, i) => {
    const c = byId.get(x.id);
    if (c && isNew(c) && marked.programs[i]) marked.programs[i] = mark(marked.programs[i], why(c), true);
  });
  return { marked, clean };
}

// How many changes the preview shows, by kind, for the summary chip.
function changeCounts(changes) {
  const n = { reworded: 0, swapped: 0, skills: 0, removed: 0 };
  for (const c of changes || []) {
    if (c.op === 'rewrite') n.reworded++;
    else if (c.op === 'swap') n.swapped++;
    else if (c.op === 'skills') n.skills += (c.added || []).length;
    else if (c.op === 'remove') n.removed++;
  }
  return n;
}

export { escapeHtml, diffWords, previewResumes, changeCounts };
