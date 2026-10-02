import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zoomViewport, fitViewport } from '../src/workflow/timelineViewport.ts';
import { rulerTicks, parsePosition, positionText } from '../src/workflow/timelineRuler.ts';
import { framePosition, parseFramePosition } from '../src/workflow/framePosition.ts';

test('frame positions follow real VFR timestamps, reject invalid indices, and estimate only without an index', () => {
  const source = { frameTimes: [0, 0.04, 0.09, 0.13, 1.95], fps: 30, duration: 2 };
  assert.equal(framePosition(source, 0.089), 1);
  assert.equal(framePosition(source, 0.09), 2);
  assert.equal(framePosition(source, 2), 4);
  assert.equal(parseFramePosition(source, '3'), 0.13);
  for (const value of ['5', '-1', '1.5', '1:00', 'Infinity', ''])
    assert.equal(parseFramePosition(source, value), null);
  const nominal = { duration: 2, fps: 30 };
  assert.equal(framePosition(nominal, 0.1), 3);
  assert.equal(framePosition(nominal, 2), 59);
  assert.equal(parseFramePosition(nominal, '30'), 1);
  assert.equal(parseFramePosition(nominal, '60'), null);
});

test('Exact position input accepts elapsed times, rejects malformed components and rounds display', () => {
  for (const [text, expected] of [
    ['90.125', 90.125],
    ['01:30.125', 90.125],
    ['1:01:30.125', 3690.125],
    ['0', 0],
  ])
    assert.equal(parsePosition(text), expected);
  for (const text of [
    '',
    '-1',
    '1e3',
    'NaN',
    '1:60',
    '1:60:00',
    '1::2',
    '1:2:3:4',
    '1.5:20',
    '0.0001',
  ])
    assert.equal(parsePosition(text), null, text);
  assert.equal(positionText(59.9998), '00:01:00.000');
  assert.equal(parsePosition(positionText(3690.125)), 3690.125);
});

test('Ruler labels are bounded, chronological and spaced for zoom, compact and long recordings', () => {
  for (const [start, end, width] of [
    [0, 8, 1100],
    [115, 205, 600],
    [2.321, 2.521, 1000],
    [0, 86400, 1500],
  ]) {
    const ticks = rulerTicks(start, end, width);
    assert(ticks.length > 0 && ticks.length < 100);
    assert(ticks.every((tick) => tick.time >= start && tick.time <= end + 1e-8));
    const labels = ticks.filter((tick) => tick.label);
    assert(labels.length > 0);
    for (let i = 1; i < labels.length; i++)
      assert(((labels[i].time - labels[i - 1].time) / (end - start)) * width >= 100);
  }
  assert.deepEqual(rulerTicks(0, 8, 0), []);
  assert(
    rulerTicks(3600, 3600.2, 1000)
      .filter((tick) => tick.label)
      .every((tick) => tick.label.startsWith('01:00:00.')),
  );
});
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
