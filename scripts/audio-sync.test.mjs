import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioSyncStep } from '../src/workflow/audioSync.ts';

const step = (values) =>
  audioSyncStep({ drift: 0, rate: 1, stalled: false, holding: false, spaced: true, ...values });

test('in sync, the track plays', () => {
  assert.equal(step({}), 'play');
  assert.equal(step({ rate: 2, drift: 0.2 }), 'play');
});

test('a stalled video holds the audio instead of rewinding it (VC-29 note 28)', () => {
  // The old sync rewound any track more than 0.12 x rate ahead: a replayed slice, an echo.
  for (const rate of [1, 2, 3, 4, 6])
    for (const drift of [0, 0.05, 0.12 * rate + 0.01, 0.4 * rate])
      assert.equal(step({ rate, drift, stalled: true }), 'hold', `${rate}x ${drift}`);
});

test('audio ahead of a moving picture waits for it, then plays on', () => {
  assert.equal(step({ rate: 2, drift: 0.3 }), 'hold');
  assert.equal(step({ rate: 2, drift: 0.2, holding: true }), 'hold');
  assert.equal(step({ rate: 2, drift: 0.09, holding: true }), 'release');
  assert.equal(step({ rate: 2, drift: -0.1, holding: true }), 'release');
});

test('audio behind the picture skips forward, never back', () => {
  assert.equal(step({ rate: 2, drift: -0.3 }), 'seek');
  assert.equal(step({ rate: 2, drift: -0.3, spaced: false }), 'play');
});

test('only a large drift seeks a track that is ahead', () => {
  assert.equal(step({ rate: 1, drift: 1.5 }), 'seek');
  assert.equal(step({ rate: 1, drift: 1.5, spaced: false }), 'hold');
  assert.equal(step({ rate: 6, drift: 2.5 }), 'hold');
  assert.equal(step({ rate: 6, drift: 3 }), 'seek');
});

test('a simulated stall at 2x never moves the audio backward', () => {
  // 50 ms ticks; the picture freezes for 0.3 s out of every 0.36 s, as in Connor's diagnostics.
  const rate = 2;
  let picture = 0,
    audio = 0,
    held = false,
    last = -Infinity,
    backward = 0;
  for (let tick = 0; tick < 400; tick++) {
    const now = tick * 50;
    const stalled = now % 360 < 300 && tick > 4;
    if (!stalled) picture += 0.05 * rate;
    const action = audioSyncStep({
      drift: audio - picture,
      rate,
      stalled,
      holding: held,
      spaced: now - last > 350,
    });
    if (action === 'seek') {
      if (picture < audio) backward++;
      audio = picture;
      last = now;
      held = false;
    } else if (action === 'hold') held = true;
    else if (action === 'release') held = false;
    if (!held) audio += 0.05 * rate;
  }
  assert.equal(backward, 0);
  assert(Math.abs(audio - picture) < 0.5, `${audio} vs ${picture}`);
});
