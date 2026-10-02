import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markerTime, adjustMarker, layoutMarkers } from '../src/workflow/markerTiming.ts';
import { playheadSnap } from '../src/workflow/playheadSnap.ts';

test('playhead magnet has a pixel-sized threshold, respects zoom and can be disabled', () => {
  assert.equal(playheadSnap(5.09, 5, 10, 1000), 5);
  assert.equal(playheadSnap(5.11, 5, 10, 1000), 5.11);
  assert.equal(playheadSnap(5.018, 5, 2, 1000), 5);
  assert.equal(playheadSnap(5.09, 5, 2, 1000), 5.09);
  assert.equal(playheadSnap(5.09, null, 10, 1000), 5.09);
  assert.equal(playheadSnap(5.09, 5, 10, 0), 5.09);
});
test('marker movement snaps, clamps and steps across irregular frame timestamps', () => {
  const r = { duration: 2, fps: 30, frameTimes: [0, 0.04, 0.09, 0.13, 1.95] };
  assert.equal(markerTime(r, 0.08), 0.09);
  assert.equal(markerTime(r, 0.09, 1), 0.13);
  assert.equal(markerTime(r, 0.09, -1), 0.04);
  assert.equal(markerTime(r, -50), 0);
  assert.equal(markerTime(r, 50), 1.95);
  assert(Math.abs(markerTime({ duration: 2, fps: 30 }, 1, 1) - (1 + 1 / 30)) < 1e-9);
});

test('range moves retain duration, edges cannot cross, and source boundaries clamp', () => {
  const r = { duration: 10, fps: 30 };
  const m = { id: 'range', time: 2, end: 5 };
  assert.deepEqual(adjustMarker(r, m, 'move', 9), { time: 7, end: 10 });
  assert.deepEqual(adjustMarker(r, m, 'move', -4), { time: 0, end: 3 });
  assert(adjustMarker(r, m, 'start', 9).time < m.end);
  assert(adjustMarker(r, m, 'end', 0).end > m.time);
  assert.equal(adjustMarker(r, m, 'end', 99).end, 10);
  assert.deepEqual(adjustMarker(r, { id: 'point', time: 4 }, 'extend', 2), { time: 2, end: 4 });
  const last = adjustMarker(r, { id: 'legacy-end', time: 10 }, 'extend', 11);
  assert(last.time < last.end && last.end === 10);
  const tiny = adjustMarker(r, { id: 'tiny', time: 0, end: 0.001 }, 'start', 9);
  assert(tiny.time >= 0 && tiny.time < tiny.end);
});
test('overlapping and same-position markers receive independent lanes even through a zoom', () => {
  const markers = [
    { id: 'a', time: 1, end: 8 },
    { id: 'b', time: 2, end: 6 },
    { id: 'c', time: 2 },
    { id: 'd', time: 9 },
  ];
  const all = layoutMarkers(markers, 0, 10, 1000);
  assert.equal(all.lanes, 3);
  const zoom = layoutMarkers(markers, 4, 5, 1000);
  assert.equal(zoom.items.length, 2);
  assert.equal(zoom.lanes, 2);
});
