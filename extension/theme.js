/**
 * Light/dark theme: the saved choice, else the system preference, set as
 * data-theme on <html> (styles.css Section 1 defines both palettes). Also the
 * one entrance animation, skipped for prefers-reduced-motion.
 */

class LiquidGlassTheme {
    constructor() {
        // The key predates the redesign; renaming it would forget saved choices.
        this.STORAGE_KEY = 'liquid-glass-theme';

        this.init();
    }

    init() {
        this.applySavedTheme();

        const toggleBtn = document.getElementById('theme-toggle');
        if (toggleBtn) toggleBtn.addEventListener('click', () => this.toggleTheme());

        if (!this.reducedMotion()) this.animateSectionsOnLoad();

        this.watchSystemTheme();
    }

    // Read live, so a change in system settings applies without a reload.
    reducedMotion() {
        return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    }

    /**
     * Get current theme from storage or system preference
     */
    getSavedTheme() {
        try {
            const saved = localStorage.getItem(this.STORAGE_KEY);
            if (saved) return saved;
        } catch (e) {
            console.warn('LocalStorage not available, using system preference');
        }

        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        return 'light';
    }

    saveTheme(theme) {
        try {
            localStorage.setItem(this.STORAGE_KEY, theme);
        } catch (e) {
            console.warn('Could not save theme preference');
        }
    }

    applySavedTheme() {
        const theme = this.getSavedTheme();
        document.documentElement.setAttribute('data-theme', theme);
        document.getElementById('theme-toggle')?.setAttribute('aria-pressed', String(theme === 'dark'));
    }

    toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        this.setTheme(currentTheme === 'dark' ? 'light' : 'dark');
    }

    setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        document.getElementById('theme-toggle')?.setAttribute('aria-pressed', String(theme === 'dark'));
        this.saveTheme(theme);
    }

    /**
     * Follow system theme changes until the user picks one themselves
     */
    watchSystemTheme() {
        if (window.matchMedia) {
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
                try {
                    if (!localStorage.getItem(this.STORAGE_KEY)) {
                        this.setTheme(e.matches ? 'dark' : 'light');
                    }
                } catch (err) {
                    this.setTheme(e.matches ? 'dark' : 'light');
                }
            });
        }
    }

    /**
     * Fade the header and sections in, one after another, on load
     */
    animateSectionsOnLoad() {
        const sections = document.querySelectorAll('.section');

        sections.forEach((section, index) => {
            section.style.opacity = '0';
            section.style.transform = 'translateY(20px)';

            setTimeout(() => {
                section.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
                section.style.opacity = '1';
                section.style.transform = 'translateY(0)';
            }, 100 + (index * 80));
        });

        const header = document.querySelector('.app-header');
        if (header) {
            header.style.opacity = '0';
            header.style.transform = 'translateY(-20px)';

            setTimeout(() => {
                header.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
                header.style.opacity = '1';
                header.style.transform = 'translateY(0)';
            }, 50);
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.liquidGlassTheme = new LiquidGlassTheme();
    });
} else {
    window.liquidGlassTheme = new LiquidGlassTheme();
}
