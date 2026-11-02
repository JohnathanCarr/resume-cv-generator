// Page model for the one-page limit. The composer has to know, before it
// writes, how much room the page has (composePrompt.js pageBudget) and how
// tall the result is (compose.js fitComposition), so the limit is planned
// for rather than repaired afterwards.
//
// A layout describes how formatResume() in the extension sets text: for each
// kind of line, its font, usable width, line height and the gap after it,
// plus a textWidth(text, font) function. The extension measures a real
// render of the uploaded resume (and passes a canvas-backed textWidth); under
// Node (evals, tests) the defaults below approximate the same CSS.
//
// Pure functions, no DOM.

import { TEMPLATE as T, pt, CONTENT_WIDTH_PX as CONTENT_WIDTH } from '../preview/template.js';

const body = pt(T.bodyPt);
const entry = pt(T.entryPt);
const face = (size, bold = false) => `${bold ? 'bold ' : ''}${size}px Arial`;
const indent = T.bulletIndentEm * body;

// Line kinds and the CSS they come from in formatResume() (template.js).
const DEFAULT_KINDS = {
  bullet:        { font: face(body), width: CONTENT_WIDTH - indent, lineHeight: body * T.lineHeight, gap: pt(T.bulletGapPt) },
  summary:       { font: face(body), width: CONTENT_WIDTH, lineHeight: body * T.lineHeight, gap: 0 },
  skills:        { font: face(body), width: CONTENT_WIDTH, lineHeight: body * T.lineHeight, gap: pt(1) },
  coursework:    { font: face(body), width: CONTENT_WIDTH - indent, lineHeight: body * T.lineHeight, gap: pt(T.bulletGapPt), prefix: 'Coursework: ' },
  extra:         { font: face(body), width: CONTENT_WIDTH - indent, lineHeight: body * T.lineHeight, gap: pt(T.bulletGapPt) },
  projectHeader: { font: face(entry, true), width: CONTENT_WIDTH, lineHeight: entry * T.lineHeight, gap: 0 }
};

// Arial averages about half an em per character.
function approxTextWidth(text, font) {
  const size = Number((String(font).match(/([\d.]+)px/) || [])[1]) || body;
  const bold = /bold/.test(font) ? 1.06 : 1;
  return String(text).length * size * 0.5 * bold;
}

// measured: { capacityPx, usedPx, kinds: { <kind>: { font, width, lineHeight, gap } },
// entryGap, textWidth } — any part may be missing.
function makeLayout(measured = {}) {
  const kinds = {};
  for (const [k, d] of Object.entries(DEFAULT_KINDS)) kinds[k] = { ...d, ...((measured.kinds || {})[k] || {}) };
  return {
    capacityPx: measured.capacityPx || 11 * 96,   // one US Letter page
    usedPx: Number.isFinite(measured.usedPx) ? measured.usedPx : null,
    entryGap: Number.isFinite(measured.entryGap) ? measured.entryGap : pt(T.entryGapPt),
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
// (evals). Mirrors formatResume() with template.js's sizes: page padding,
// header block, ruled section headings, two header rows per job and school.
function estimateDocHeight(layout, doc, extraText) {
  const R = entry * T.lineHeight;                                                     // one entry header row
  const section = pt(T.headingPt) * T.lineHeight + pt(1.75) + pt(T.headingGapPt) + pt(T.sectionGapPt);
  let h = 2 * T.marginIn * 96 + pt(T.namePt) * T.lineHeight + pt(2) + pt(T.contactPt) * T.lineHeight + pt(T.sectionGapPt);
  if (doc.summary) h += section + itemHeight(layout, 'summary', doc.summary);
  const groups = doc.skillGroups || [];
  if (groups.length) h += section + groups.reduce((a, g) => a + itemHeight(layout, 'skills', `${g.label ? `${g.label}: ` : 'Skills: '}${g.items.join(', ')}`), 0);
  if ((doc.education || []).length) {
    h += section;
    for (const e of doc.education) {
      h += R + layout.entryGap;
      if (e.degreeType || e.major || e.location) h += R;
      if (e.gpa) h += itemHeight(layout, 'extra', `GPA: ${e.gpa}`);
      if (e.honors) h += itemHeight(layout, 'extra', `Honors: ${e.honors}`);
      if (e.coursework) h += itemHeight(layout, 'coursework', e.coursework);
    }
  }
  if ((doc.experiences || []).length) {
    h += section;
    for (const e of doc.experiences) h += 2 * R + layout.entryGap + (e.bullets || []).reduce((a, b) => a + itemHeight(layout, 'bullet', b), 0);
  }
  if ((doc.projects || []).length) h += section + doc.projects.reduce((a, p) => a + projectHeight(layout, p), 0);
  if ((doc.extras || []).length) h += section + doc.extras.reduce((a, x) => a + itemHeight(layout, 'extra', extraText(x)), 0);
  return h;
}

export { makeLayout, lineCount, itemHeight, projectHeight, estimateDocHeight, approxTextWidth };
