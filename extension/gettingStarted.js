// First run and the Getting Started checklist. The tour starts on its own
// until it has been seen once (app.onboarding.seen; background.js seeds
// { seen: false } on install) and replays from the header's ? button. The
// checklist on the Profile tab ticks itself from live state and hides once
// everything is done or the user dismisses it. State lives in app.onboarding
// and chrome.storage.local.
import { OnboardingTour, TOUR_STEPS } from './onboarding.js';

export class GettingStarted {
    constructor(app) {
        this.app = app;
    }

    // Wires the tour button and the checklist's dismiss. Call once.
    setup() {
        document.getElementById('help-tour')?.addEventListener('click', () => {
            this.startTour();
        });
        document.getElementById('checklist-dismiss')?.addEventListener('click', () => {
            this.saveOnboarding({ checklistDismissed: true });
            this.render();
        });
    }

    // First run = no onboarding record yet (installed before this feature) or
    // the background script seeded { seen: false } on install.
    maybeStartTour() {
        const seen = this.app.onboarding && this.app.onboarding.seen;
        if (!seen) this.startTour();
    }

    async saveOnboarding(patch) {
        this.app.onboarding = { ...(this.app.onboarding || {}), ...patch };
        try {
            await chrome.storage.local.set({ onboarding: this.app.onboarding });
        } catch (error) {
            console.error('Error saving onboarding state:', error);
        }
    }

    markOnboardingSeen(skipped) {
        return this.saveOnboarding({ seen: true, completedAt: new Date().toISOString(), skipped: !!skipped });
    }

    // Getting Started checklist: ticks itself from live state and hides once
    // everything is done or the user dismisses it.
    checklistState() {
        return {
            resume: !!this.app.uploadedResume,
            name: !!(this.app.profile.name && this.app.profile.name.trim()),
            key: !!(this.app.apiKey && this.app.apiKey.value),
            generated: !!(this.app.onboarding && this.app.onboarding.firstGeneratedAt)
        };
    }

    render() {
        const card = document.getElementById('getting-started');
        if (!card) return;
        const state = this.checklistState();
        const allDone = Object.values(state).every(Boolean);
        const dismissed = !!(this.app.onboarding && this.app.onboarding.checklistDismissed);

        if (allDone || dismissed) {
            card.classList.add('hidden');
            return;
        }

        card.querySelectorAll('li[data-item]').forEach(li => {
            li.classList.toggle('done', !!state[li.dataset.item]);
        });

        const hint = document.getElementById('checklist-key-hint');
        if (hint) {
            if (this.app.apiKey && this.app.apiKey.verifyError) hint.textContent = `— ${this.app.apiKey.verifyError}`;
            else if (this.app.apiKey && !this.app.apiKey.verifiedAt) hint.textContent = '— saved, not verified yet';
            else hint.textContent = '';
        }
        card.classList.remove('hidden');
    }

    recordFirstGeneration() {
        if (this.app.onboarding && this.app.onboarding.firstGeneratedAt) return;
        this.saveOnboarding({ firstGeneratedAt: new Date().toISOString() });
        this.render();
    }

    startTour() {
        this.app.hideError();
        OnboardingTour.start(TOUR_STEPS, {
            switchTab: (tab) => this.app.switchTab(tab),
            onFinish: ({ skipped }) => {
                this.markOnboardingSeen(skipped);
                this.app.switchTab('profile');
                window.scrollTo({ top: 0 });
            }
        });
    }
}
