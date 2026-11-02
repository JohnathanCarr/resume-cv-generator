// Page measurement for the one-page limit: lays the resume out in a hidden
// frame holding the same document print.html prints (pageFrame.js), and
// reads the browser's own layout. Needs the DOM.
import { formatResume, escapeResume } from './resumeHtml.js';
import { withHiddenPage } from './pageFrame.js';
import { PAGE_PX } from './pageDoc.js';

// One US Letter page at CSS 96dpi; the resume's hard limit.
export { PAGE_PX };

// Lays resume data out at print size (min-height dropped so the content
// height shows) and hands the page element to fn.
export function withOffscreenResume(resumeContent, profile, fn) {
    return withHiddenPage(formatResume(escapeResume(resumeContent), profile), fn);
}

export async function measureResumeHeight(resumeContent, profile) {
    return withOffscreenResume(resumeContent, profile, page => page.getBoundingClientRect().height);
}

// The layout for generation/layout.js: the upload's measured height plus,
// per kind of line (data-kind in formatResume), its font, usable width, line
// height and gap, and a canvas-backed textWidth. Kinds the upload does not
// have fall back to layout.js defaults. resumeContent is the upload in
// formatResume's shape (resumeDocToSchema of the baseline).
export async function measureLayout(resumeContent, profile) {
    const ctx = document.createElement('canvas').getContext('2d');
    const textWidth = (text, font) => { ctx.font = font; return ctx.measureText(text).width; };
    return withOffscreenResume(resumeContent, profile, page => {
        const view = page.ownerDocument.defaultView;
        const kinds = {};
        for (const kind of ['bullet', 'summary', 'skills', 'coursework', 'extra', 'projectHeader']) {
            const el = page.querySelector(`[data-kind="${kind}"]`);
            if (!el) continue;
            const cs = view.getComputedStyle(el);
            kinds[kind] = {
                font: `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
                width: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
                lineHeight: parseFloat(cs.lineHeight),
                gap: parseFloat(cs.marginBottom) + parseFloat(cs.marginTop)
            };
        }
        const entry = page.querySelector('.project-entry, .experience-entry');
        return {
            capacityPx: PAGE_PX,
            usedPx: page.getBoundingClientRect().height,
            entryGap: entry ? parseFloat(view.getComputedStyle(entry).marginBottom) : undefined,
            kinds,
            textWidth
        };
    });
}
