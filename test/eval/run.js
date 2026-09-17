#!/usr/bin/env node
// Runs the generation endpoints over profiles × job postings and scores the
// output with score.js. Requires the proxy to be running on :8787.
//
//   OPENAI_API_KEY=sk-... node test/eval/run.js [--profiles a,b] [--jobs 01,03] [--only resume|cover] [--label name] [--no-research]
//
// The key may also be read from proxy/.env (OPENAI_API_KEY=...) for local
// convenience. Outputs go to test/eval/runs/<timestamp>-<label>/ (gitignored);
// a summary is printed and, with --baseline, copied to test/eval/baselines/.

'use strict';

const fs = require('fs');
const path = require('path');
const { scoreResume, scoreCoverLetter } = require('./score');

const ROOT = path.resolve(__dirname);
const PROXY = process.env.PROXY_URL || 'http://localhost:8787';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return (!v || v.startsWith('--')) ? true : v;
}

function readKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const envPath = path.resolve(ROOT, '../../proxy/.env');
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, 'utf8').match(/^OPENAI_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  console.error('No API key. Set OPENAI_API_KEY or put it in proxy/.env');
  process.exit(1);
}

function listProfiles(filter) {
  const dirs = [path.join(ROOT, 'profiles'), path.join(ROOT, 'profiles', 'local')];
  const out = [];
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith('.json')) continue;
      const id = f.replace(/\.json$/, '');
      if (filter && !filter.split(',').some(x => id.includes(x))) continue;
      out.push({ id, profile: JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')) });
    }
  }
  return out;
}

function listJobs(filter) {
  const d = path.join(ROOT, 'jobs');
  return fs.readdirSync(d).filter(f => f.endsWith('.txt')).filter(f => !filter || filter.split(',').some(x => f.startsWith(x))).map(f => {
    const text = fs.readFileSync(path.join(d, f), 'utf8');
    // Second line is "Company · Location" by convention in our fixtures.
    const company = (text.split('\n')[1] || '').split('·')[0].trim();
    return { id: f.replace(/\.txt$/, ''), text, company };
  });
}

async function call(endpoint, key, body) {
  const t0 = Date.now();
  const res = await fetch(`${PROXY}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({ error: `non-JSON response (${res.status})` }));
  return { ok: res.ok, status: res.status, ms: Date.now() - t0, data };
}

function fmt(n) { return (n * 100).toFixed(0).padStart(3) + '%'; }

// Re-apply the current rubric to a saved run without calling the API.
function rescore(runDir) {
  const files = fs.readdirSync(runDir).filter(f => /__(resume|cover)\.json$/.test(f));
  const results = [];
  for (const f of files) {
    const saved = JSON.parse(fs.readFileSync(path.join(runDir, f), 'utf8'));
    const [profile, job, kind] = f.replace(/\.json$/, '').split('__');
    const company = (saved.request.jobText.split('\n')[1] || '').split('·')[0].trim();
    const scored = kind === 'resume'
      ? scoreResume({ resumeContent: saved.response.resumeContent, profile: saved.request.profile, jobText: saved.request.jobText, company })
      : scoreCoverLetter({ coverLetter: saved.response.coverLetter, profile: saved.request.profile, jobText: saved.request.jobText, company, unsourcedClaims: saved.response.unsourcedClaims });
    results.push({ kind, profile, job, ms: 0, ...scored });
    console.log(`${kind.padEnd(7)} ${fmt(scored.score)}  ${profile} × ${job}${scored.fails.length ? '  ✗ ' + scored.fails.join('; ') : ''}`);
  }
  return results;
}

function summarise(results, label) {
  const summary = { label, kinds: {} };
  for (const kind of ['resume', 'cover']) {
    const rows = results.filter(r => r.kind === kind);
    if (!rows.length) continue;
    const checks = {};
    for (const r of rows) for (const [k, v] of Object.entries(r.checks)) (checks[k] ||= []).push(v);
    summary.kinds[kind] = {
      n: rows.length,
      meanScore: +(rows.reduce((a, r) => a + r.score, 0) / rows.length).toFixed(3),
      meanMs: Math.round(rows.reduce((a, r) => a + r.ms, 0) / rows.length),
      failures: rows.filter(r => r.fails.length).length,
      checks: Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)]))
    };
  }
  console.log('\n── Summary ──');
  for (const [kind, s] of Object.entries(summary.kinds)) {
    console.log(`${kind.padEnd(7)} n=${s.n}  score=${fmt(s.meanScore)}  failures=${s.failures}  mean=${s.meanMs}ms`);
    for (const [k, v] of Object.entries(s.checks)) console.log(`   ${k.padEnd(24)} ${fmt(v)}`);
  }
  return summary;
}

async function main() {
  const rescoreDir = arg('rescore', null);
  if (rescoreDir) {
    const dir = path.isAbsolute(rescoreDir) ? rescoreDir : path.resolve(process.cwd(), rescoreDir);
    const results = rescore(dir);
    const summary = summarise(results, `rescore:${path.basename(dir)}`);
    fs.writeFileSync(path.join(dir, 'summary.rescored.json'), JSON.stringify({ summary, results }, null, 2));
    return;
  }

  const key = readKey();
  const only = arg('only', null);
  const research = !arg('no-research', false);
  const label = arg('label', 'run');
  const profiles = listProfiles(arg('profiles', null));
  const jobs = listJobs(arg('jobs', null));
  if (!profiles.length || !jobs.length) { console.error('Nothing to run.'); process.exit(1); }

  try {
    const h = await fetch(`${PROXY}/health`);
    if (!h.ok) throw new Error();
  } catch { console.error(`Proxy not reachable at ${PROXY}. Start it with ./start-proxy.sh`); process.exit(1); }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(ROOT, 'runs', `${stamp}-${label}`);
  fs.mkdirSync(outDir, { recursive: true });

  const results = [];
  console.log(`Running ${profiles.length} profile(s) × ${jobs.length} job(s)${only ? ` (${only} only)` : ''} → ${path.relative(process.cwd(), outDir)}\n`);

  for (const p of profiles) {
    for (const j of jobs) {
      const body = { profile: p.profile, jobText: j.text, research };
      const tag = `${p.id} × ${j.id}`;

      if (!only || only === 'resume') {
        const r = await call('generateResume', key, body);
        const scored = r.ok ? scoreResume({ resumeContent: r.data.resumeContent, profile: p.profile, jobText: j.text, company: j.company }) : { score: 0, checks: {}, fails: [r.data.error || `HTTP ${r.status}`], info: {} };
        results.push({ kind: 'resume', profile: p.id, job: j.id, ms: r.ms, ...scored });
        fs.writeFileSync(path.join(outDir, `${p.id}__${j.id}__resume.json`), JSON.stringify({ request: body, response: r.data, scored }, null, 2));
        console.log(`resume  ${fmt(scored.score)}  ${String(r.ms).padStart(6)}ms  ${tag}${scored.fails.length ? '  ✗ ' + scored.fails.join('; ') : ''}`);
      }

      if (!only || only === 'cover') {
        const r = await call('generateCoverLetter', key, body);
        const scored = r.ok ? scoreCoverLetter({ coverLetter: r.data.coverLetter, profile: p.profile, jobText: j.text, company: j.company, unsourcedClaims: r.data.unsourcedClaims }) : { score: 0, checks: {}, fails: [r.data.error || `HTTP ${r.status}`], info: {} };
        if (r.ok && r.data.metadata) scored.info.searches = r.data.metadata.searches;
        results.push({ kind: 'cover', profile: p.id, job: j.id, ms: r.ms, ...scored });
        fs.writeFileSync(path.join(outDir, `${p.id}__${j.id}__cover.json`), JSON.stringify({ request: body, response: r.data, scored }, null, 2));
        console.log(`cover   ${fmt(scored.score)}  ${String(r.ms).padStart(6)}ms  ${tag}${scored.fails.length ? '  ✗ ' + scored.fails.join('; ') : ''}`);
      }
    }
  }

  const summary = { ...summarise(results, label), stamp, profiles: profiles.map(p => p.id), jobs: jobs.map(j => j.id) };

  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ summary, results }, null, 2));
  if (arg('baseline', false)) {
    const dest = path.join(ROOT, 'baselines', `${stamp.slice(0, 10)}-${label}.json`);
    fs.writeFileSync(dest, JSON.stringify(summary, null, 2));
    console.log(`\nBaseline written to ${path.relative(process.cwd(), dest)}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
