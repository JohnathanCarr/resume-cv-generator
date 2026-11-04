// Lays a resume page out in its own frame, in the same document print.html
// prints (pageDoc.js), so nothing from the app's stylesheet reaches it. The
// one-page measurement uses a hidden frame; the preview shows the page at
// true size scaled down to the panel, the way the Original view shows the
// uploaded PDF. Needs the DOM.
import { resumeDocument, PAGE_WIDTH_PX, PAGE_PX } from './pageDoc.js';

// Loads pageHtml into iframe (already in the document) and resolves with its
// document once fonts are ready, so widths are measured in the real face.
export function loadPage(iframe, pageHtml, opts) {
    return new Promise((resolve) => {
        iframe.addEventListener('load', async () => {
            const doc = iframe.contentDocument;
            if (doc.fonts?.ready) await doc.fonts.ready;
            resolve(doc);
        }, { once: true });
        iframe.srcdoc = resumeDocument(pageHtml, opts);
    });
}

// A hidden, page-wide frame for measuring; fn(page) gets the .resume-page
// element with its min-height dropped so its height is the content's.
export async function withHiddenPage(pageHtml, fn) {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    iframe.style.cssText = `position:absolute;left:-10000px;top:0;width:${PAGE_WIDTH_PX}px;height:${PAGE_PX}px;border:0;visibility:hidden;pointer-events:none;`;
    document.body.appendChild(iframe);
    try {
        const doc = await loadPage(iframe, pageHtml);
        const page = doc.querySelector('.resume-page');
        page.style.minHeight = '0';
        return await fn(page);
    } finally {
        iframe.remove();
    }
}

// The preview: container gets a sheet holding the page at its real size
// (8.5in wide, at least 11in tall), scaled to the container's width. When
// the content runs past one page, a dashed line marks where the page ends.
// Rescales when the container resizes. Resolves with the frame's document.
export async function showPage(container, pageHtml, { title = 'Resume preview' } = {}) {
    container.replaceChildren();
    const sheet = document.createElement('div');
    sheet.className = 'resume-sheet';
    const iframe = document.createElement('iframe');
    iframe.className = 'resume-frame';
    iframe.title = title;
    sheet.appendChild(iframe);
    container.appendChild(sheet);

    const doc = await loadPage(iframe, pageHtml, { preview: true, title });
    const page = doc.querySelector('.resume-page');
    page.style.minHeight = '0';
    const contentPx = page.getBoundingClientRect().height;
    page.style.minHeight = '';
    if (contentPx > PAGE_PX + 0.5) {
        const end = doc.createElement('div');
        end.className = 'page-end';
        end.textContent = 'Page 1 ends here. The PDF is one page, so anything below is cut.';
        doc.body.appendChild(end);
    }
    const heightPx = Math.max(PAGE_PX, Math.ceil(doc.documentElement.scrollHeight));
    iframe.style.height = `${heightPx}px`;

    const fit = () => {
        const scale = sheet.clientWidth / PAGE_WIDTH_PX;
        if (!scale) return;
        iframe.style.transform = `scale(${scale})`;
        sheet.style.height = `${heightPx * scale}px`;
    };
    fit();
    // fit() changes the sheet's height, which reports back here: only a new
    // width matters, and the next frame applies it, or Chrome logs a
    // ResizeObserver loop. The watcher lives on the container, so the next
    // preview replaces it.
    let width = sheet.clientWidth;
    container._resize?.disconnect();
    container._resize = new ResizeObserver(() => {
        if (sheet.clientWidth === width) return;
        width = sheet.clientWidth;
        requestAnimationFrame(fit);
    });
    container._resize.observe(sheet);
    return doc;
}

// Where each line of text on the page starts, in px from the page's top, so
// two layouts of the same page can be compared line for line (the smoke test
// checks the preview against the print view).
export function pageLineTops(page) {
    const doc = page.ownerDocument;
    const top = page.getBoundingClientRect().top;
    const tops = new Set();
    const walker = doc.createTreeWalker(page, NodeFilter.SHOW_TEXT);
    const range = doc.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim()) continue;
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top - top));
    }
    return [...tops].sort((a, b) => a - b);
}
