import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zoomViewport, fitViewport } from '../src/workflow/timelineViewport.ts';
test('Cursor stays at the same fraction of the visible source time', () => {
  const v = zoomViewport({ start: 0, end: 3600 }, 2, 900, 0, 3600, 0.2);
  assert.deepEqual(v, { start: 450, end: 2250 });
  assert.equal((900 - v.start) / (v.end - v.start), 0.25);
});
test('Zoom and pan stay within source or Review bounds and preserve the minimum span', () => {
  assert.deepEqual(zoomViewport({ start: 20, end: 40 }, 0.5, 30, 20, 40, 0.2), {
    start: 20,
    end: 40,
  });
  assert.deepEqual(fitViewport({ start: 39, end: 49 }, 20, 40, 0.2), { start: 30, end: 40 });
  const v = zoomViewport({ start: 20, end: 20.2 }, 2, 20, 20, 40, 0.2);
  assert(Math.abs(v.end - v.start - 0.2) < 1e-8);
  assert.deepEqual(fitViewport({ start: -10, end: 1 }, 0, 8, 0.2), { start: 0, end: 8 });
});
