// Per-step timing for one generation run, so it is clear where the seconds
// go (model calls, repairs, re-fits, the user's own time in the keyword
// dialog). The pipeline returns its steps in metadata.timings; app.js wraps
// the outer steps and prints one line per run, which Save logs also keeps.

export function createTimer(now = () => performance.now()) {
  const t0 = now();
  const steps = [];
  return {
    steps,
    // Runs fn and records how long it took, even if it throws.
    async step(name, fn) {
      const start = now();
      try {
        return await fn();
      } finally {
        steps.push({ step: name, ms: Math.round(now() - start) });
      }
    },
    // Attaches a finished step's own breakdown (a pipeline's metadata.timings).
    detail(name, parts) {
      const entry = [...steps].reverse().find(s => s.step === name);
      if (entry && Array.isArray(parts) && parts.length) entry.parts = parts;
    },
    totalMs() {
      return Math.round(now() - t0);
    }
  };
}

const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

// "read posting 3.2s · tailor 14.2s (request 8.1s, repair 1 6.1s) · total 18.4s"
export function formatTimings(steps, totalMs) {
  const parts = steps.map(s => {
    const inner = s.parts?.length ? ` (${s.parts.map(p => `${p.step} ${secs(p.ms)}`).join(', ')})` : '';
    return `${s.step} ${secs(s.ms)}${inner}`;
  });
  if (totalMs != null) parts.push(`total ${secs(totalMs)}`);
  return parts.join(' · ');
}
