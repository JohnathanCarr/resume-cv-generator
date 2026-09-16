// Guided tour: a spotlight + tooltip sequence over real page elements.
//
// Each step is { target, title, body, tab?, placement? }. `target` is a CSS
// selector (null for a centred welcome card); `tab` switches the app tab
// before the step shows; `placement` is 'bottom' | 'top' | 'right' | 'left'
// (default 'bottom'). Skip and Escape always exit.
//
// Exposes window.OnboardingTour = { start(steps, { onFinish, switchTab }) }.

(function (global) {
    'use strict';

    const PAD = 8;          // spotlight padding around the target
    const GAP = 14;         // gap between target and tooltip
    const MARGIN = 12;      // keep tooltip this far from the viewport edge

    let state = null;       // { steps, index, opts, els }

    function el(tag, className, html) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (html !== undefined) node.innerHTML = html;
        return node;
    }

    function build() {
        const overlay = el('div', 'tour-overlay');
        const spotlight = el('div', 'tour-spotlight');
        const tooltip = el('div', 'tour-tooltip glass-floating');
        tooltip.setAttribute('role', 'dialog');
        tooltip.innerHTML = `
            <div class="tour-progress"></div>
            <h3 class="tour-title"></h3>
            <div class="tour-body"></div>
            <div class="tour-actions">
                <button class="btn btn-secondary btn-sm tour-skip">Skip tour</button>
                <span class="tour-spacer"></span>
                <button class="btn btn-secondary btn-sm tour-back">Back</button>
                <button class="btn btn-primary btn-sm tour-next">Next</button>
            </div>`;
        overlay.appendChild(spotlight);
        document.body.appendChild(overlay);
        document.body.appendChild(tooltip);

        tooltip.querySelector('.tour-skip').addEventListener('click', () => finish(true));
        tooltip.querySelector('.tour-back').addEventListener('click', () => go(state.index - 1));
        tooltip.querySelector('.tour-next').addEventListener('click', () => {
            if (state.index >= state.steps.length - 1) finish(false);
            else go(state.index + 1);
        });

        return { overlay, spotlight, tooltip };
    }

    function onKey(e) {
        if (!state) return;
        if (e.key === 'Escape') { e.preventDefault(); finish(true); }
        else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); state.els.tooltip.querySelector('.tour-next').click(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); go(state.index - 1); }
    }

    function position() {
        if (!state) return;
        const step = state.steps[state.index];
        const { spotlight, tooltip } = state.els;
        const target = step.target ? document.querySelector(step.target) : null;

        if (!target) {
            // Centred card, no spotlight.
            spotlight.style.display = 'none';
            state.els.overlay.classList.add('tour-overlay-dim');
            tooltip.classList.add('tour-tooltip-centered');
            tooltip.style.left = '';
            tooltip.style.top = '';
            return;
        }

        tooltip.classList.remove('tour-tooltip-centered');
        state.els.overlay.classList.remove('tour-overlay-dim');
        const r = target.getBoundingClientRect();
        spotlight.style.display = 'block';
        spotlight.style.left = `${r.left - PAD}px`;
        spotlight.style.top = `${r.top - PAD}px`;
        spotlight.style.width = `${r.width + PAD * 2}px`;
        spotlight.style.height = `${r.height + PAD * 2}px`;

        const tw = tooltip.offsetWidth;
        const th = tooltip.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let placement = step.placement || 'bottom';

        // Flip if there is no room on the requested side.
        if (placement === 'bottom' && r.bottom + GAP + th > vh - MARGIN) placement = 'top';
        if (placement === 'top' && r.top - GAP - th < MARGIN) placement = 'bottom';
        if (placement === 'right' && r.right + GAP + tw > vw - MARGIN) placement = 'left';
        if (placement === 'left' && r.left - GAP - tw < MARGIN) placement = 'right';

        let left, top;
        switch (placement) {
            case 'top':    left = r.left; top = r.top - GAP - th; break;
            case 'right':  left = r.right + GAP; top = r.top; break;
            case 'left':   left = r.left - GAP - tw; top = r.top; break;
            default:       left = r.left; top = r.bottom + GAP;
        }
        left = Math.max(MARGIN, Math.min(left, vw - tw - MARGIN));
        top = Math.max(MARGIN, Math.min(top, vh - th - MARGIN));
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    }

    async function go(index) {
        if (!state) return;
        if (index < 0 || index >= state.steps.length) return;
        state.index = index;
        const step = state.steps[index];
        const { tooltip } = state.els;

        if (step.tab && state.opts.switchTab) state.opts.switchTab(step.tab);

        const target = step.target ? document.querySelector(step.target) : null;
        if (target) {
            target.scrollIntoView({ block: 'center', behavior: 'instant' });
        } else {
            window.scrollTo({ top: 0, behavior: 'instant' });
        }

        tooltip.querySelector('.tour-progress').textContent = `${index + 1} / ${state.steps.length}`;
        tooltip.querySelector('.tour-title').textContent = step.title;
        tooltip.querySelector('.tour-body').innerHTML = step.body;
        tooltip.querySelector('.tour-back').classList.toggle('hidden', index === 0);
        tooltip.querySelector('.tour-next').textContent = index === state.steps.length - 1 ? 'Finish' : 'Next';

        // Let layout settle after a tab switch / scroll before measuring.
        await new Promise(r => requestAnimationFrame(r));
        position();
        tooltip.querySelector('.tour-next').focus({ preventScroll: true });
    }

    function finish(skipped) {
        if (!state) return;
        const { overlay, tooltip } = state.els;
        overlay.remove();
        tooltip.remove();
        window.removeEventListener('resize', position);
        window.removeEventListener('scroll', position, true);
        document.removeEventListener('keydown', onKey);
        const cb = state.opts.onFinish;
        state = null;
        if (cb) cb({ skipped });
    }

    function start(steps, opts = {}) {
        if (state) finish(true);
        if (!steps || !steps.length) return;
        state = { steps, index: 0, opts, els: build() };
        window.addEventListener('resize', position);
        window.addEventListener('scroll', position, true);
        document.addEventListener('keydown', onKey);
        go(0);
    }

    global.OnboardingTour = { start, stop: () => finish(true), isActive: () => !!state };
})(typeof window !== 'undefined' ? window : globalThis);
