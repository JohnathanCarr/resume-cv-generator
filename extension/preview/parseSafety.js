// Parse-safety checks for the resume page: what makes an ATS parser read the
// text in the right order with the right section names (see
// design/research/ats-research.md, checklist items 1–10). Each returns a list
// of problems; empty means safe. The smoke test runs them on every generated
// resume, and textProblems() also on the text extracted from the real PDF.

// Headings parsers recognise. formatResume() only ever writes these.
export const STANDARD_HEADINGS = [
    'Summary', 'Skills', 'Experience', 'Work Experience', 'Projects', 'Education',
    'Certifications', 'Awards', 'Publications', 'Research', 'Leadership',
    'Volunteer Experience', 'Programs', 'Additional Information'
];

// Ligatures (ﬁ, ﬂ, …) and private-use glyphs extract as junk or nothing.
export function textProblems(text) {
    const problems = [];
    const ligatures = String(text).match(/[ﬀ-ﬆ]/g);
    if (ligatures) problems.push(`ligature characters in the text: ${[...new Set(ligatures)].join(' ')}`);
    const privateUse = String(text).match(/[-]/g);
    if (privateUse) problems.push(`${privateUse.length} private-use character(s) in the text`);
    return problems;
}

// Needs the DOM: the rendered .resume-page.
export function pageProblems(page) {
    const problems = [];
    const style = (el) => getComputedStyle(el);

    const banned = page.querySelectorAll('table, img, svg, canvas, iframe, object, embed');
    if (banned.length) problems.push(`non-text elements: ${[...new Set([...banned].map(el => el.tagName.toLowerCase()))].join(', ')}`);

    const known = new Set(STANDARD_HEADINGS.map(h => h.toLowerCase()));
    for (const h of page.querySelectorAll('h2')) {
        if (!known.has(h.textContent.trim().toLowerCase())) problems.push(`non-standard heading "${h.textContent.trim()}"`);
    }

    if (style(page).fontVariantLigatures !== 'none') problems.push('ligatures are not turned off');

    for (const el of page.querySelectorAll('*')) {
        const cs = style(el);
        if (cs.position === 'absolute' || cs.position === 'fixed') problems.push(`${el.tagName.toLowerCase()} is positioned ${cs.position}`);
        if (cs.float !== 'none') problems.push(`${el.tagName.toLowerCase()} floats`);
        if (parseInt(cs.columnCount, 10) > 1) problems.push(`${el.tagName.toLowerCase()} has ${cs.columnCount} columns`);
        if (cs.display.includes('grid') && cs.gridTemplateColumns.trim().split(/\s+/).length > 1) problems.push(`${el.tagName.toLowerCase()} is a multi-column grid`);
        const ownText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
        if (ownText && (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.fontSize) < 6 || parseFloat(cs.opacity) < 0.5)) {
            problems.push(`hidden or tiny text: "${el.textContent.trim().slice(0, 40)}"`);
        }
    }

    for (const a of page.querySelectorAll('a[href]')) {
        let host = '';
        try { host = new URL(a.href).host.replace(/^www\./, ''); } catch { /* relative link */ }
        if (host && !a.textContent.includes(host)) problems.push(`link text "${a.textContent.trim()}" hides ${host}`);
    }

    // Reading order: blocks that hold text must not climb back up the page in
    // DOM order (a parser reads the DOM's order; people read top to bottom).
    const blocks = [...page.querySelectorAll('h1, h2, p, li, div')]
        .filter(el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
        .filter(el => el.getClientRects().length);
    let lastTop = -Infinity;
    for (const el of blocks) {
        const top = el.getBoundingClientRect().top;
        if (top < lastTop - 2) {
            problems.push(`"${el.textContent.trim().slice(0, 40)}" sits above text that comes before it`);
            break;
        }
        lastTop = Math.max(lastTop, top);
    }
    return problems;
}
