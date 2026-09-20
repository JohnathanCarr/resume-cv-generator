// Print view for the generated resume. app.js stores the rendered
// .resume-page markup under chrome.storage.session.printJob and opens this
// page; it renders the markup and hands it to Chrome's print dialog, where
// "Save as PDF" produces a text-based (ATS-readable) PDF from the same
// layout engine the preview uses.

(async () => {
    const page = document.getElementById('page');
    const session = globalThis.chrome?.storage?.session;
    const { printJob } = session ? await session.get('printJob') : {};
    if (!printJob || !printJob.html) {
        page.innerHTML = '<p style="font-family: system-ui, sans-serif; padding: 24px;">Nothing to print. Generate a resume first, then click Resume PDF.</p>';
        return;
    }
    // One-shot: the job is consumed on open so a stale resume cannot reappear later.
    session.remove('printJob');

    page.innerHTML = printJob.html;
    // Chrome's Save-as-PDF dialog proposes the document title as the filename.
    document.title = printJob.title || 'Resume';

    const print = () => window.print();
    document.getElementById('print-again').addEventListener('click', print);
    document.getElementById('close').addEventListener('click', () => window.close());
    // afterprint fires whether the dialog was saved or cancelled; either way
    // the tab has done its job. Clicking Resume PDF in the app opens a new one.
    window.addEventListener('afterprint', () => setTimeout(() => window.close(), 300));

    await document.fonts.ready;
    print();
})();
