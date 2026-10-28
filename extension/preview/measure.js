// Page measurement for the one-page limit: lays the resume out off-screen at
// print width and reads the browser's own layout. Needs the DOM.
import { formatResume, escapeResume } from './resumeHtml.js';

// One US Letter page at CSS 96dpi; the resume's hard limit.
export const PAGE_PX = 11 * 96;

// Lays resume data out off-screen at print width (the page box is 7.5in wide
// either way; min-height dropped so the content height shows) and hands the
// page element to fn. Fonts must be loaded first or widths come out in the
// fallback face. The host goes into <body>, so the page's em-based spacing
// follows body's font size: keep body at 16px (styles.css Section 2).
export async function withOffscreenResume(resumeContent, profile, fn) {
    if (document.fonts?.ready) await document.fonts.ready;
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:absolute;left:-10000px;top:0;width:8.5in;visibility:hidden;pointer-events:none;';
    host.innerHTML = formatResume(escapeResume(resumeContent), profile);
    document.body.appendChild(host);
    try {
        const page = host.querySelector('.resume-page');
        page.style.minHeight = '0';
        return fn(page);
    } finally {
        host.remove();
    }
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
        const kinds = {};
        for (const kind of ['bullet', 'summary', 'skills', 'coursework', 'extra', 'projectHeader']) {
            const el = page.querySelector(`[data-kind="${kind}"]`);
            if (!el) continue;
            const cs = getComputedStyle(el);
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
            entryGap: entry ? parseFloat(getComputedStyle(entry).marginBottom) : undefined,
            kinds,
            textWidth
        };
    });
}
