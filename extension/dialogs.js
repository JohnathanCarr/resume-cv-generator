// Dialogs and the page lock. Every .modal in app.html is a dialog: Escape and
// a click on the backdrop cancel the top one, Tab stays inside it, and focus
// goes back to what opened it. While generating, the page is locked (inert)
// so a second generation cannot start underneath; dialogs opened then return
// focus to the control that started the run.
//
// Owns the error dialog (with Retry), the keyword check and the file-name
// prompt, and wires their buttons. Settings is opened and closed by the app;
// its cancel action is passed in.

export function focusableIn(el) {
    return [...el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter(n => !n.disabled && n.getClientRects().length);
}

export class Dialogs {
    // cancelActions: extra { modalId: () => void } for dialogs the app owns.
    // sanitizeFilename: cleans the typed file name.
    constructor({ cancelActions = {}, sanitizeFilename = (s) => s } = {}) {
        this.stack = [];
        this.inertFocus = null;
        this.retryAction = null;
        this.keywordResolve = null;
        this.keywordOptions = [];
        this.filenameResolve = null;
        this.filenameFallback = '';
        this.sanitizeFilename = sanitizeFilename;
        this.cancelActions = {
            'keywords-modal': () => this.resolveKeywords(null),
            'filename-modal': () => this.resolveFilename(false),
            'error-modal': () => this.hideError(),
            ...cancelActions
        };
    }

    // Wires the dialogs' own buttons, backdrop clicks and keys. Call once.
    setup() {
        const on = (id, type, fn) => document.getElementById(id)?.addEventListener(type, fn);

        // Keyword check: resolved by promptForKeywords()
        on('keywords-close', 'click', () => this.resolveKeywords(null));
        on('keywords-cancel', 'click', () => this.resolveKeywords(null));
        on('keywords-continue', 'click', () => this.resolveKeywords(this.readKeywordChoices()));

        // File name before either download: resolved by promptForFilename()
        on('filename-save', 'click', () => this.resolveFilename(true));
        on('filename-cancel', 'click', () => this.resolveFilename(false));
        on('filename-close', 'click', () => this.resolveFilename(false));
        on('filename-input', 'keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this.resolveFilename(true); }
        });

        // Error dialog
        on('retry-btn', 'click', () => this.retry());
        on('error-close', 'click', () => this.hideError());

        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.cancelActions[modal.id]?.();
            });
        });
        document.addEventListener('keydown', (e) => {
            const top = this.stack.at(-1);
            const modal = top && document.getElementById(top.id);
            if (!modal || modal.classList.contains('hidden')) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                this.cancelActions[top.id]?.();
            } else if (e.key === 'Tab') {
                const items = focusableIn(modal);
                if (!items.length) return;
                const first = items[0];
                const last = items[items.length - 1];
                if (!modal.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
                else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            }
        });
    }

    open(id) {
        const modal = document.getElementById(id);
        if (!modal) return;
        this.stack = this.stack.filter(m => m.id !== id);
        // During generation focus sits on <body> (the page is inert); return
        // to the control that started it instead.
        const opener = document.activeElement === document.body && this.inertFocus ? this.inertFocus : document.activeElement;
        this.stack.push({ id, returnFocus: opener });
        modal.classList.remove('hidden');
        const first = focusableIn(modal)[0];
        if (first && !modal.contains(document.activeElement)) first.focus();
    }

    close(id) {
        const modal = document.getElementById(id);
        if (!modal || modal.classList.contains('hidden')) return;
        modal.classList.add('hidden');
        const entry = this.stack.find(m => m.id === id);
        this.stack = this.stack.filter(m => m.id !== id);
        if (entry?.returnFocus?.isConnected) entry.returnFocus.focus();
    }

    // Making the focused button inert drops focus to <body>; put it back
    // afterwards unless something else (a dialog) has taken it meanwhile.
    // The progress strip stays out of the lock so screen readers can read it.
    lockPage(on) {
        if (on && !this.inertFocus) this.inertFocus = document.activeElement;
        document.querySelectorAll('.app-header, #profile-tab, .generate-layout > :not(.gen-progress)').forEach(el => { el.inert = on; });
        if (!on) {
            const back = this.inertFocus;
            this.inertFocus = null;
            if (back?.isConnected && (document.activeElement === document.body || !document.activeElement)) back.focus();
        }
    }

    // ---- Error ---------------------------------------------------------------

    // retry: the action the Retry button repeats, or false to hide it.
    showError(message, retry = false) {
        const errorMessage = document.getElementById('error-message');
        const retryBtn = document.getElementById('retry-btn');

        if (errorMessage) errorMessage.textContent = message;
        this.retryAction = typeof retry === 'function' ? retry : null;
        if (retryBtn) retryBtn.style.display = this.retryAction ? 'inline-flex' : 'none';
        this.open('error-modal');
    }

    hideError() {
        this.close('error-modal');
    }

    retry() {
        const retry = this.retryAction;
        this.hideError();
        if (retry) retry();
    }

    // ---- ATS keyword check ---------------------------------------------------

    // Lists the posting's missing terms as checkboxes. Resolves to
    // { accepted: [terms] }, or null if the user cancelled.
    promptForKeywords(keywords) {
        const list = document.getElementById('keywords-list');
        const modal = document.getElementById('keywords-modal');
        if (!list || !modal) return Promise.resolve({ accepted: [] });
        list.innerHTML = '';
        keywords.forEach((kw, i) => {
            const label = document.createElement('label');
            label.className = 'keyword-chip';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.dataset.index = String(i);
            label.appendChild(input);
            label.appendChild(document.createTextNode(kw));
            list.appendChild(label);
        });
        this.keywordOptions = keywords;
        this.open('keywords-modal');
        list.querySelector('input')?.focus();
        return new Promise((resolve) => { this.keywordResolve = resolve; });
    }

    readKeywordChoices() {
        const accepted = [...document.querySelectorAll('#keywords-list input:checked')]
            .map(el => this.keywordOptions[Number(el.dataset.index)]).filter(Boolean);
        return { accepted };
    }

    resolveKeywords(choice) {
        this.close('keywords-modal');
        const resolve = this.keywordResolve;
        this.keywordResolve = null;
        if (resolve) resolve(choice);
    }

    // ---- File name before download -------------------------------------------

    // Asks for the file name (without .pdf), prefilled with suggested.
    // Resolves to the cleaned name, or null if the user cancelled.
    promptForFilename(kind, suggested) {
        const modal = document.getElementById('filename-modal');
        const input = document.getElementById('filename-input');
        if (!modal || !input) return Promise.resolve(suggested);
        input.value = suggested;
        const help = document.getElementById('filename-help');
        if (help) {
            help.textContent = kind === 'resume'
                ? 'Chrome\'s print window opens next with this name. Choose "Save as PDF" as the destination.'
                : 'Saved to your Downloads folder.';
        }
        this.open('filename-modal');
        input.focus();
        input.select();
        return new Promise((resolve) => { this.filenameResolve = resolve; this.filenameFallback = suggested; });
    }

    resolveFilename(ok) {
        this.close('filename-modal');
        const resolve = this.filenameResolve;
        this.filenameResolve = null;
        if (!resolve) return;
        if (!ok) return resolve(null);
        const name = this.sanitizeFilename(document.getElementById('filename-input')?.value);
        resolve(name || this.filenameFallback || 'Resume');
    }
}
