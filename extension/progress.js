// Generation progress strip (#gen-progress in app.html). Milestone-driven,
// not a timer: app.js marks each pipeline step as it starts, and the bar
// eases toward that step's end without reaching it.
//   start()             show the strip at 0%, label "Generating"
//   mark(at, next, ms)  jump to `at`, then ease toward `next` over ~ms
//   pause() / resume()  freeze while a dialog (the keyword check) is open
//   done()              fill to 100%, green, "Done", hide after 1.2s
//   fail()              stop where it is, "Generation failed", stays visible
//   hide()              hide at once (a cancelled run)
class GenerationProgress {
    constructor(root) {
        this.root = root;
        this.card = root.querySelector('.progress-card');
        this.label = root.querySelector('.progress-label');
        this.track = root.querySelector('.progress-track');
        this.fill = root.querySelector('.progress-fill');
        this.p = 0; this.from = 0; this.to = 0; this.ms = 1; this.t0 = 0; this.raf = 0; this.paused = false;
        this.hideT = 0;
        this.loop = this.loop.bind(this);
    }

    draw() {
        this.fill.style.width = (this.p * 100).toFixed(1) + '%';
        this.track.setAttribute('aria-valuenow', String(Math.round(this.p * 100)));
    }

    loop(ts) {
        if (this.paused) return;
        const k = 1 - Math.exp(-(ts - this.t0) / (this.ms / 3));   // asymptotic toward `to`
        this.p = this.from + (this.to - this.from) * k * 0.98;
        this.draw();
        this.raf = requestAnimationFrame(this.loop);
    }

    setState(state, text) {
        this.card.dataset.state = state;
        this.label.textContent = text;
    }

    start() {
        cancelAnimationFrame(this.raf);
        clearTimeout(this.hideT);   // a pending auto-hide must not hide this run
        this.root.hidden = false;
        this.paused = false;
        this.p = 0;
        this.setState('running', 'Generating');
        this.draw();
    }

    mark(at, next, ms) {
        cancelAnimationFrame(this.raf);
        this.from = Math.max(this.p, at);
        this.to = next;
        this.ms = ms;
        this.t0 = performance.now();
        if (!this.paused) this.raf = requestAnimationFrame(this.loop);
    }

    pause() {
        this.paused = true;
        cancelAnimationFrame(this.raf);
    }

    resume() {
        this.paused = false;
        this.mark(this.p, this.to, this.ms);
    }

    done() {
        cancelAnimationFrame(this.raf);
        this.paused = false;
        this.p = 1;
        this.draw();
        this.setState('done', 'Done');
        this.hideT = setTimeout(() => { this.root.hidden = true; }, 1200);
    }

    fail() {
        cancelAnimationFrame(this.raf);
        this.paused = false;
        this.setState('error', 'Generation failed');
    }

    hide() {
        cancelAnimationFrame(this.raf);
        clearTimeout(this.hideT);
        this.paused = false;
        this.root.hidden = true;
    }
}

// A stand-in when the strip is missing from the page, so callers never check.
GenerationProgress.none = { start() {}, mark() {}, pause() {}, resume() {}, done() {}, fail() {}, hide() {} };
