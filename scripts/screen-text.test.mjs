import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LineJoiner,
  MISSED_KEYFRAMES,
  keyframeArgs,
  overlap,
  readSize,
  sameText,
  summarizeText,
  unchangedSpans,
} from '../electron/screen-text.ts';

// VC-141: screen text as facts. Same text in the same place on consecutive keyframes is one line;
// nothing labels it.
const at = (text, box, score = 0.9) => ({ text, box, score });
const plate = [588, 714, 700, 750];
const dialogue = [495, 760, 1700, 800];

test('frames are read at 1080p, or their own size when smaller', () => {
  assert.deepEqual(readSize(3840, 2160), { width: 1920, height: 1080 });
  assert.deepEqual(readSize(2560, 1080), { width: 2560, height: 1080 });
  assert.deepEqual(readSize(1280, 720), { width: 1280, height: 720 });
  assert.deepEqual(readSize(3440, 1440), { width: 2580, height: 1080 });
  assert.deepEqual(readSize(), { width: 1920, height: 1080 });
});

test('keyframes only, in file time, raw frames on stdout, resumed with a seek', () => {
  const args = keyframeArgs({
    file: 'in.mp4',
    offset: 0.5,
    from: 0,
    size: { width: 1920, height: 1080 },
    sourceHeight: 2160,
  });
  const s = args.join(' ');
  assert.match(s, /-skip_frame nokey -copyts -i in\.mp4/);
  assert.match(s, /-vf showinfo,scale=1920:1080:flags=area -f rawvideo -pix_fmt bgr24 -$/);
  assert.match(s, /-fps_mode passthrough/);
  assert.ok(!args.includes('-ss'));
  const resumed = keyframeArgs({
    file: 'in.mp4',
    offset: 0.5,
    from: 61,
    size: { width: 1280, height: 720 },
    sourceHeight: 720,
  });
  assert.equal(resumed[resumed.indexOf('-ss') + 1], '61.500000');
  // A recording already at the read size is not scaled.
  assert.equal(resumed[resumed.indexOf('-vf') + 1], 'showinfo');
});

test('still pictures from the picture pass are the spans where nothing changes', () => {
  const events = [
    { kind: 'black', start: 1, end: 2 },
    { kind: 'still', start: 10, end: 14, brightness: 40 },
    { kind: 'cut', start: 20, score: 30 },
    { kind: 'still', start: 30, end: 31.5, brightness: 90 },
  ];
  assert.deepEqual(unchangedSpans(events, 0.25), [
    [10.25, 14.25],
    [30.25, 31.75],
  ]);
  assert.deepEqual(unchangedSpans(undefined, 0), []);
});

test('text compares with whitespace collapsed and boxes by overlap', () => {
  assert.equal(sameText('  Chin   Height '), 'Chin Height');
  assert.equal(overlap([0, 0, 10, 10], [0, 0, 10, 10]), 1);
  assert.equal(overlap([0, 0, 10, 10], [20, 20, 30, 30]), 0);
  assert.ok(Math.abs(overlap([0, 0, 10, 10], [5, 0, 15, 10]) - 1 / 3) < 1e-9);
});

test('the same text in the same place joins; elsewhere or changed it is a new line', () => {
  const j = new LineJoiner();
  j.frame(10, [at('Orchel', plate, 0.98), at('Got it.', dialogue, 0.9)]);
  j.frame(11, [at('Orchel', [590, 714, 702, 751], 0.96), at('Only...', dialogue, 0.8)]);
  j.frame(12, [at('Orchel', [1200, 100, 1312, 136], 0.97)]);
  const lines = j.lines();
  assert.deepEqual(
    lines.map((l) => [l.text, l.first, l.last, l.seen]),
    [
      ['Orchel', 10, 11, 2],
      ['Got it.', 10, 10, 1],
      ['Only...', 11, 11, 1],
      ['Orchel', 12, 12, 1],
    ],
  );
  assert.deepEqual(lines[0].box, [588, 714, 702, 751]);
  assert.equal(lines[0].score, 0.97);
  // Facts only: nothing else is recorded about a line.
  assert.deepEqual(Object.keys(lines[0]).sort(), ['box', 'first', 'last', 'score', 'seen', 'text']);
  assert.equal(j.keyframes, 3);
  assert.equal(j.read, 3);
});

test('a line survives one missed keyframe; a longer absence starts a new line', () => {
  assert.equal(MISSED_KEYFRAMES, 1);
  const j = new LineJoiner();
  j.frame(1, [at('HP 42', plate)]);
  j.frame(2, []);
  j.frame(3, [at('HP 42', plate)]);
  j.frame(4, []);
  j.frame(5, []);
  j.frame(6, [at('HP 42', plate)]);
  assert.deepEqual(
    j.lines().map((l) => [l.first, l.last, l.seen]),
    [
      [1, 3, 2],
      [6, 6, 1],
    ],
  );
});

test('two copies of the same text side by side stay two lines', () => {
  const j = new LineJoiner();
  const left = [100, 100, 160, 120],
    right = [400, 100, 460, 120];
  j.frame(1, [at('12', left), at('12', right)]);
  j.frame(2, [at('12', right), at('12', left)]);
  assert.deepEqual(
    j.lines().map((l) => [l.box[0], l.seen]),
    [
      [100, 2],
      [400, 2],
    ],
  );
});

test('an unchanged keyframe keeps what was on screen without reading it', () => {
  const j = new LineJoiner();
  j.frame(1, [at('Paused', plate, 0.8)]);
  j.same(2);
  j.same(3);
  j.frame(4, [at('Paused', plate, 0.6)]);
  const [line] = j.lines();
  assert.deepEqual([line.first, line.last, line.seen, line.score], [1, 4, 4, 0.7]);
  assert.equal(j.keyframes, 4);
  assert.equal(j.read, 2);
  assert.throws(() => j.frame(4, []), /time order/);
  assert.deepEqual(
    summarizeText({ lines: j.lines(), keyframes: 4, read: 2, gpu: true, elapsedMs: 5 }),
    { lines: 1, keyframes: 4, read: 2, gpu: true, elapsedMs: 5 },
  );
});

test('empty readings are dropped', () => {
  const j = new LineJoiner();
  j.frame(1, [at('   ', plate)]);
  assert.deepEqual(j.lines(), []);
});
