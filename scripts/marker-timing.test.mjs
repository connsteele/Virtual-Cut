import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markerTime, adjustMarker, layoutMarkers } from '../src/workflow/markerTiming.ts';
import { playheadSnap, scrubSnap, editTargets, editSnap } from '../src/workflow/playheadSnap.ts';

test('edit magnets exclude self, choose nearest valid peer and align either range endpoint', () => {
  const markers = [
    { id: 'self', time: 2, end: 3 },
    { id: 'peer', time: 5, end: 6 },
    { id: 'point', time: 7 },
  ];
  const clips = [{ id: 'clip', start: 1, end: 4 }];
  const frozen = editTargets(0, markers, clips, { marker: 'self' });
  assert.deepEqual(frozen, [0, 5, 6, 7, 1, 4]);
  markers[1].time = 9;
  assert(frozen.includes(5));
  assert.deepEqual(editTargets(0, [], clips, { clip: 'clip' }), [0]);
  const snap = (value, offsets, targets, valid = () => true) =>
    editSnap(value, offsets, targets, 0, 10, 1000, valid);
  assert.equal(snap(3.06, [0, 2], [3, 5.05]).target, 5.05);
  assert.equal(snap(3.06, [0, 2], [3, 5.05]).value, 3.05);
  assert.equal(snap(3.06, [0], [3.07, 3], (_v, _o, t) => t === 3).target, 3);
  assert.equal(snap(3.11, [0], [3]), null);
  assert.equal(snap(3, [0], []), null);
  assert.equal(
    snap(3, [0], [3], () => false),
    null,
  );
});

test('scrub magnet chooses nearest visible boundary with deterministic ties at any zoom', () => {
  assert.equal(scrubSnap(5.05, [5.1, 5], 0, 10, 1000), 5);
  assert.equal(scrubSnap(5.08, [5, 5.1], 0, 10, 1000), 5.1);
  assert.equal(scrubSnap(5.15, [5], 0, 10, 1000), null);
  assert.equal(scrubSnap(5.015, [5], 4, 6, 1000), 5);
  assert.equal(scrubSnap(5.03, [5], 4, 6, 1000), null);
  assert.equal(scrubSnap(4, [3.99, NaN, Infinity], 4, 6, 1000), null);
  assert.equal(scrubSnap(6, [6], 4, 6, 1000), 6);
  assert.equal(scrubSnap(5, [5], 4, 6, 0), null);
});

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
