import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markerTime } from '../src/workflow/markerTiming.ts';
test('marker movement snaps, clamps and steps across irregular frame timestamps', () => {
  const r = { duration: 2, fps: 30, frameTimes: [0, 0.04, 0.09, 0.13, 1.95] };
  assert.equal(markerTime(r, 0.08), 0.09);
  assert.equal(markerTime(r, 0.09, 1), 0.13);
  assert.equal(markerTime(r, 0.09, -1), 0.04);
  assert.equal(markerTime(r, -50), 0);
  assert.equal(markerTime(r, 50), 1.95);
  assert(Math.abs(markerTime({ duration: 2, fps: 30 }, 1, 1) - (1 + 1 / 30)) < 1e-9);
});
