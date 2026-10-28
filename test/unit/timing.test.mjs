// node --test 'test/unit/*.test.mjs'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTimer, formatTimings } from '../../extension/generation/timing.js';

// A clock the test moves by hand.
function fakeClock() {
  let t = 0;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('steps record their duration, including steps that throw', async () => {
  const clock = fakeClock();
  const timer = createTimer(clock.now);
  assert.equal(await timer.step('read posting', async () => { clock.advance(3200); return 'match'; }), 'match');
  await assert.rejects(timer.step('tailor', async () => { clock.advance(900); throw new Error('cut'); }), /cut/);
  assert.deepEqual(timer.steps, [{ step: 'read posting', ms: 3200 }, { step: 'tailor', ms: 900 }]);
  assert.equal(timer.totalMs(), 4100);
});

test('detail attaches a breakdown to the latest step of that name', async () => {
  const clock = fakeClock();
  const timer = createTimer(clock.now);
  await timer.step('measure page', async () => clock.advance(10));
  await timer.step('measure page', async () => clock.advance(20));
  timer.detail('measure page', [{ step: 'x', ms: 5 }]);
  assert.equal(timer.steps[0].parts, undefined);
  assert.deepEqual(timer.steps[1].parts, [{ step: 'x', ms: 5 }]);
  timer.detail('missing', [{ step: 'y', ms: 1 }]);   // no such step: ignored
  timer.detail('measure page', []);                   // empty breakdown: ignored
  assert.deepEqual(timer.steps[1].parts, [{ step: 'x', ms: 5 }]);
});

test('formatTimings prints one readable line', () => {
  const line = formatTimings([
    { step: 'read posting', ms: 3200 },
    { step: 'tailor', ms: 14200, parts: [{ step: 'request', ms: 8100 }, { step: 'repair 1', ms: 6100 }] }
  ], 18400);
  assert.equal(line, 'read posting 3.2s · tailor 14.2s (request 8.1s, repair 1 6.1s) · total 18.4s');
});
