// Settings: the OpenAI API key. The key lives in app.apiKey and
// chrome.storage.local, is shown masked (last four characters) and can be
// replaced or removed but never viewed. Saving verifies it with one tiny
// request (generation/openai.js verifyKey).

export class Settings {
    constructor(app) {
        this.app = app;
    }

    // Wires the dialog's controls. Call once.
    setup() {
        document.getElementById('open-settings')?.addEventListener('click', () => this.open());
        document.getElementById('settings-close')?.addEventListener('click', () => this.close());
        document.getElementById('api-key-save')?.addEventListener('click', () => this.saveApiKey());
        document.getElementById('api-key-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this.saveApiKey(); }
        });
        document.getElementById('api-key-replace')?.addEventListener('click', () => this.render({ replacing: true }));
        document.getElementById('api-key-cancel')?.addEventListener('click', () => this.render());
        document.getElementById('api-key-remove')?.addEventListener('click', () => this.removeApiKey());
    }

    // The key value lives in chrome.storage.local and is only ever read back
    // to send to OpenAI; the UI shows the last four characters.
    open() {
        this.render();
        this.app.dialogs.open('settings-modal');
        if (!this.app.apiKey) document.getElementById('api-key-input')?.focus();
    }

    close() {
        this.app.dialogs.close('settings-modal');
        const input = document.getElementById('api-key-input');
        if (input) input.value = '';
    }

    render({ replacing = false } = {}) {
        const saved = document.getElementById('api-key-saved');
        const entry = document.getElementById('api-key-entry');
        const cancel = document.getElementById('api-key-cancel');
        const input = document.getElementById('api-key-input');
        if (!saved || !entry) return;

        const hasKey = !!(this.app.apiKey && this.app.apiKey.value);
        saved.classList.toggle('hidden', !hasKey || replacing);
        entry.classList.toggle('hidden', hasKey && !replacing);
        cancel?.classList.toggle('hidden', !(hasKey && replacing));
        if (input) input.value = '';
        if (replacing) input?.focus();

        if (hasKey) {
            const masked = document.getElementById('api-key-masked');
            if (masked) masked.textContent = `sk-••••••••••••${this.app.apiKey.last4}`;
            this.renderApiKeyStatus();
        }
    }

    renderApiKeyStatus(override) {
        const el = document.getElementById('api-key-status');
        if (!el) return;
        const status = override || this.describeApiKeyStatus();
        el.textContent = status.text;
        el.className = `api-key-status${status.kind ? ` ${status.kind}` : ''}`;
    }

    describeApiKeyStatus() {
        if (!this.app.apiKey) return { text: '', kind: '' };
        if (this.app.apiKey.verifiedAt) {
            return { text: `Verified ${new Date(this.app.apiKey.verifiedAt).toLocaleDateString()}`, kind: 'ok' };
        }
        if (this.app.apiKey.verifyError) return { text: this.app.apiKey.verifyError, kind: 'error' };
        if (this.app.apiKey.verifyNote) return { text: this.app.apiKey.verifyNote, kind: '' };
        return { text: `Saved ${new Date(this.app.apiKey.savedAt).toLocaleDateString()} · not verified yet`, kind: '' };
    }

    async saveApiKey() {
        const input = document.getElementById('api-key-input');
        const value = (input?.value || '').trim();
        if (!value) { this.app.showError('Paste your API key first.', false); return; }
        if (!/^sk-[A-Za-z0-9_-]{10,}$/.test(value)) {
            this.app.showError('That does not look like an OpenAI API key (they start with "sk-").', false);
            return;
        }

        this.app.apiKey = { value, last4: value.slice(-4), savedAt: new Date().toISOString() };
        await this.persistApiKey();
        if (input) input.value = '';
        this.render();
        this.app.renderChecklist();

        this.renderApiKeyStatus({ text: 'Verifying…', kind: '' });
        await this.verifyApiKey();
        this.renderApiKeyStatus();
        this.app.renderChecklist();
    }

    async removeApiKey() {
        this.app.apiKey = null;
        try {
            await chrome.storage.local.remove('apiKey');
        } catch (error) {
            console.error('Error removing API key:', error);
        }
        this.render();
        this.app.renderChecklist();
    }

    async persistApiKey() {
        try {
            await chrome.storage.local.set({ apiKey: this.app.apiKey });
        } catch (error) {
            console.error('Error saving API key:', error);
        }
    }

    // Makes one tiny OpenAI request with the key. A network failure is
    // reported as such, not treated as an invalid key.
    async verifyApiKey() {
        if (!this.app.apiKey) return;
        try {
            const { verifyKey } = await this.app.generation();
            const data = await verifyKey(this.app.apiKey.value);
            this.app.apiKey = { ...this.app.apiKey, verifiedAt: new Date().toISOString(), verifyError: null, verifyNote: null, model: data.model || null };
        } catch (error) {
            if (error.status === 401) {
                this.app.apiKey = { ...this.app.apiKey, verifiedAt: null, verifyNote: null, verifyError: error.message };
            } else {
                this.app.apiKey = { ...this.app.apiKey, verifiedAt: null, verifyError: null, verifyNote: `Saved, not verified: ${error.message}` };
            }
        }
        await this.persistApiKey();
    }
}
