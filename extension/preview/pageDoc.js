// The one document a resume page is laid out in. The print view (print.html),
// the preview and the one-page measurement all put formatResume()'s page in
// this document, so the preview shows exactly what prints: same width, same
// inherited styles, same line breaks. Pure, no DOM.

// US Letter at CSS 96dpi.
export const PAGE_WIDTH_PX = 8.5 * 96;
export const PAGE_PX = 11 * 96;

// The page host is exactly the sheet's width; .resume-page (7.5in, 0.5in
// padding, centred) sits inside it. Zero @page margins: the markup carries
// its own, and Chrome omits its header/footer text when there is no margin.
export const PAGE_CSS = `
@page { size: letter; margin: 0; }
html, body { margin: 0; padding: 0; background: white; }
.page-host { width: 8.5in; font-size: 16px; line-height: normal; color: #000; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
`;

// Preview only: the composer's new words (generation/highlight.js), and the
// line where the page ends when the content runs past it. The page is white
// in both themes, so the colours are fixed.
export const PREVIEW_CSS = `
body { position: relative; }
.rs-added {
    background: #E7F0E1;
    color: inherit;
    text-decoration: underline;
    text-decoration-color: #5E8C4A;
    text-decoration-thickness: 2px;
    text-underline-offset: 2px;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
}
.rs-reworded {
    background: #EEF4E9;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
}
.page-end {
    position: absolute; left: 0; right: 0; top: 11in;
    border-top: 2px dashed #B3261E;
    font: 600 12px system-ui, sans-serif; color: #B3261E;
    padding: 4px 0.5in; background: rgba(255, 255, 255, 0.85);
}
`;

// A full HTML document holding one resume page (formatResume() output).
export function resumeDocument(pageHtml, { preview = false, title = 'Resume' } = {}) {
    const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PAGE_CSS}${preview ? PREVIEW_CSS : ''}</style></head><body><div class="page-host">${pageHtml}</div></body></html>`;
}
