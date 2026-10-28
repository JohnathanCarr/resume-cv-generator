// Runs test/smoke/smoke.html in headless Chrome and reports its checks.
// Serves the repository itself and talks to Chrome over the DevTools
// protocol with Node's built-in WebSocket, so there is nothing to install.
// Usage: node test/smoke/run.mjs [--update]   (scripts/smoke.sh wraps it)

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXPECTED = join(ROOT, 'test', 'smoke', 'expected.json');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 120000);
const UPDATE = process.argv.includes('--update');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.pdf': 'application/pdf', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };

// ── Static server for the repository ─────────────────────────────────────────
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/test/smoke/smoke.html`;

// ── Headless Chrome with the DevTools protocol on a random port ──────────────
const profileDir = await mkdtemp(join(tmpdir(), 'rs-smoke-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profileDir}`, '--remote-debugging-port=0', '--window-size=1400,950', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let err = '';
  chrome.stderr.on('data', d => {
    err += d;
    const m = err.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) resolve(m[1]);
  });
  chrome.on('exit', code => reject(new Error(`Chrome exited (${code}) before DevTools was ready`)));
});

async function cleanup() {
  chrome.kill();
  server.close();
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}

let report;
try {
  const port = new URL(wsUrl).port;
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('DevTools connection failed')); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise(r => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });

  const start = Date.now();
  while (!report) {
    if (Date.now() - start > TIMEOUT_MS) throw new Error(`the harness did not finish within ${TIMEOUT_MS / 1000}s`);
    await new Promise(r => setTimeout(r, 500));
    const res = await send('Runtime.evaluate', { expression: "document.getElementById('smoke-result')?.textContent || ''", returnByValue: true });
    const text = res.result?.result?.value || '';
    const m = text.match(/SMOKE_RESULT_BEGIN([\s\S]*)SMOKE_RESULT_END/);
    if (m) report = JSON.parse(m[1]);
  }
  ws.close();
} catch (e) {
  console.error(`smoke: ${e.message}`);
  await cleanup();
  process.exit(1);
}
await cleanup();

// ── Report ───────────────────────────────────────────────────────────────────
if (report.fatal) {
  console.error(`smoke: harness crashed:\n${report.fatal}`);
  process.exit(1);
}
for (const c of report.results) {
  console.log(`${c.ok ? '  ok    ' : '  FAIL  '}${c.name}${c.ok ? '' : `\n        ${c.error}`}`);
}
for (const line of report.timing || []) console.log(`  ${line}`);

let ok = report.ok;
const height = report.pageHeight;
if (UPDATE) {
  await writeFile(EXPECTED, `${JSON.stringify({ resumePageHeight: height }, null, 2)}\n`);
  console.log(`  recorded resume page height ${height}px`);
} else {
  const want = await readFile(EXPECTED, 'utf8').then(t => JSON.parse(t).resumePageHeight).catch(() => null);
  if (want == null) {
    console.log('  no expected page height yet: run ./scripts/smoke.sh --update');
    ok = false;
  } else if (height == null || Math.abs(height - want) > 0.5) {
    console.log(`  FAIL  resume page height ${height}px, expected ${want}px (layout drift; --update only if the change is intended)`);
    ok = false;
  } else {
    console.log(`  ok    resume page height ${height}px`);
  }
}
console.log(`smoke: ${report.passed} passed, ${report.failed} failed${ok ? '' : ' — FAILED'}`);
process.exit(ok ? 0 : 1);
