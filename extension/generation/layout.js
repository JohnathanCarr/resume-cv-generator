// Page model for the one-page limit. Tailoring has to know, before it edits,
// how much room the page has and how much each edit costs, so the limit is
// planned for rather than repaired afterwards.
//
// A layout describes how formatResume() in the extension sets text: for each
// kind of line, its font, usable width, line height and the gap after it,
// plus a textWidth(text, font) function. The extension measures a real
// render of the uploaded resume (and passes a canvas-backed textWidth); under
// Node (evals, tests) the defaults below approximate the same CSS.
//
// Pure functions, no DOM.

const PX_PER_PT = 96 / 72;
const body = 10 * PX_PER_PT;      // bodyFontSize 10pt
const large = 11 * PX_PER_PT;     // contactFontSize / sectionHeaderSize 11pt
const CONTENT_WIDTH = 6.5 * 96;   // 7.5in page box minus 0.5in padding each side

// Line kinds and the CSS they come from in formatResume().
const DEFAULT_KINDS = {
  bullet:        { font: `${body}px Times New Roman`, width: CONTENT_WIDTH - 1.2 * body, lineHeight: body * 1.25, gap: 0.1 * body },
  summary:       { font: `bold ${large}px Times New Roman`, width: CONTENT_WIDTH, lineHeight: large * 1.25, gap: 0 },
  skills:        { font: `${body}px Times New Roman`, width: CONTENT_WIDTH, lineHeight: body * 1.3, gap: 0.2 * body },
  coursework:    { font: `${body}px Times New Roman`, width: CONTENT_WIDTH, lineHeight: body * 1.25, gap: 0, prefix: '• Relevant Coursework: ' },
  extra:         { font: `${body}px Times New Roman`, width: CONTENT_WIDTH, lineHeight: body * 1.3, gap: 0.2 * body },
  projectHeader: { font: `bold ${large}px Times New Roman`, width: CONTENT_WIDTH, lineHeight: large * 1.25, gap: 0.1 * large }
};

// Times New Roman averages a little under half an em per character.
function approxTextWidth(text, font) {
  const size = Number((String(font).match(/([\d.]+)px/) || [])[1]) || body;
  const bold = /bold/.test(font) ? 1.06 : 1;
  return String(text).length * size * 0.45 * bold;
}

// measured: { capacityPx, usedPx, kinds: { <kind>: { font, width, lineHeight, gap } },
// entryGap, textWidth } — any part may be missing.
function makeLayout(measured = {}) {
  const kinds = {};
  for (const [k, d] of Object.entries(DEFAULT_KINDS)) kinds[k] = { ...d, ...((measured.kinds || {})[k] || {}) };
  return {
    capacityPx: measured.capacityPx || 11 * 96,   // one US Letter page
    usedPx: Number.isFinite(measured.usedPx) ? measured.usedPx : null,
    entryGap: Number.isFinite(measured.entryGap) ? measured.entryGap : 0.6 * 16,
    textWidth: typeof measured.textWidth === 'function' ? measured.textWidth : approxTextWidth,
    kinds,
    measured: Boolean(measured.textWidth)
  };
}

// Greedy word wrap, the way the browser sets a paragraph.
function lineCount(layout, kind, text) {
  const k = layout.kinds[kind];
  const t = `${k.prefix || ''}${String(text || '').trim()}`;
  if (!t.trim()) return 0;
  const space = layout.textWidth(' ', k.font);
  let lines = 1, x = 0;
  for (const w of t.split(/\s+/).filter(Boolean)) {
    const ww = layout.textWidth(w, k.font);
    if (x > 0 && x + space + ww > k.width) { lines++; x = ww; }
    else x += (x > 0 ? space : 0) + ww;
  }
  return lines;
}

// Characters that still fit on the text's last line before it wraps again.
function spareChars(layout, kind, text) {
  const k = layout.kinds[kind];
  const t = `${k.prefix || ''}${String(text || '').trim()}`;
  const space = layout.textWidth(' ', k.font);
  let x = 0;
  for (const w of t.split(/\s+/).filter(Boolean)) {
    const ww = layout.textWidth(w, k.font);
    x = (x > 0 && x + space + ww > k.width) ? ww : x + (x > 0 ? space : 0) + ww;
  }
  const avg = layout.textWidth('abcdefghijklmnopqrstuvwxyz', k.font) / 26;
  return Math.max(0, Math.floor((k.width - x - space) / avg));
}

// Height of one line item (bullet, skills line, extra…) including its gap.
function itemHeight(layout, kind, text) {
  const k = layout.kinds[kind];
  const n = lineCount(layout, kind, text);
  return n ? n * k.lineHeight + k.gap : 0;
}

function projectHeight(layout, project) {
  const header = [project.name, project.description].filter(Boolean).join(' | ');
  return itemHeight(layout, 'projectHeader', header)
    + (project.bullets || []).reduce((a, b) => a + itemHeight(layout, 'bullet', b), 0)
    + layout.entryGap;
}

// Whole-document estimate, used when the extension has not measured a render
// (evals). Mirrors formatResume(): page padding, header block, section headers
// and entry headers at their CSS sizes.
function estimateDocHeight(layout, doc, extraText) {
  const L = large * 1.3, S = 0.8 * 16;               // entry header line, section spacing
  const section = large * 1.25 + 0.4 * large + 4 + S; // heading, its margin and rule, spacing after
  let h = 96 + 18 * PX_PER_PT * 1.25 + L + S;       // padding, name, contact line
  if (doc.summary) h += itemHeight(layout, 'summary', doc.summary);
  const groups = doc.skillGroups || [];
  if (groups.length) h += section + groups.reduce((a, g) => a + itemHeight(layout, 'skills', `${g.label ? `${g.label}: ` : 'Skills: '}${g.items.join(', ')}`), 0);
  if ((doc.education || []).length) {
    h += section;
    for (const e of doc.education) {
      h += L + layout.entryGap;
      for (const f of ['degreeType', 'major', 'minor', 'gpa']) if (e[f]) h += L;
      if (e.honors) h += itemHeight(layout, 'extra', e.honors);
      if (e.coursework) h += itemHeight(layout, 'coursework', e.coursework);
    }
  }
  if ((doc.experiences || []).length) {
    h += section;
    for (const e of doc.experiences) h += 2 * L + layout.entryGap + (e.bullets || []).reduce((a, b) => a + itemHeight(layout, 'bullet', b), 0);
  }
  if ((doc.projects || []).length) h += section + doc.projects.reduce((a, p) => a + projectHeight(layout, p), 0);
  if ((doc.extras || []).length) h += section + doc.extras.reduce((a, x) => a + itemHeight(layout, 'extra', extraText(x)), 0);
  return h;
}

export { makeLayout, lineCount, spareChars, itemHeight, projectHeight, estimateDocHeight, approxTextWidth };
