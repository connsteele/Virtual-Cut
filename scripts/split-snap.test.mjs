import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseSnap, onFrame, readBlacks, snapArgs, snapWindow } from '../electron/split-snap.ts';

const lines = (...pairs) => pairs.map(([k, v]) => `lavfi.black_${k}=${v}`);

test('black screens are read from metadata lines, in recording time', () => {
  const read = readBlacks(
    [
      'frame:0    pts:15450   pts_time:15.45',
      ...lines(['start', 15.45], ['end', 18.583333], ['start', 19.9]),
    ],
    0.25,
  );
  assert.deepEqual(read, [{ start: 15.2, end: 18.333333 }, { start: 19.65 }]);
  assert.deepEqual(readBlacks(['lavfi.black_end=3']), [{ start: -Infinity, end: 3 }]);
  assert.deepEqual(readBlacks(['lavfi.black_start=x', 'something else']), []);
});

test('a black of 0.3 s or more ending in the 5 s before the word snaps the Split to its end', () => {
  // Battle Split 1: said 19.667, black 15.45-18.58, Connor's target inside the black.
  assert.deepEqual(chooseSnap(19.667, [{ start: 15.45, end: 18.583 }], 14.267), {
    spoken: 19.667,
    time: 18.583,
    blackStart: 15.45,
    blackEnd: 18.583,
  });
  // The latest qualifying black wins.
  const two = [
    { start: 10, end: 11 },
    { start: 13, end: 13.5 },
  ];
  assert.equal(chooseSnap(15, two, 9.6).time, 13.5);
});

test('the spoken time stands without a qualifying black screen', () => {
  // Nothing in the window: "exactly where I'd want it".
  assert.equal(chooseSnap(589.433, [], 584.033), null);
  // Too short: 0.2 s of black.
  assert.equal(chooseSnap(20, [{ start: 17, end: 17.2 }], 14.6), null);
  // Ended more than 5 s before the word.
  assert.equal(chooseSnap(20, [{ start: 13, end: 14.9 }], 14.6), null);
  // Ends more than 1 s after the word, and isn't on screen at the word.
  assert.equal(chooseSnap(20, [{ start: 20.5, end: 21.5 }], 14.6), null);
  // Still running when decoding stopped, with no end found.
  assert.equal(chooseSnap(20, [{ start: 19 }], 14.6, null), null);
});

test('edges: on screen at the word, followed past the window, and cut by the pre-roll', () => {
  assert.equal(chooseSnap(20, [{ start: 19.5, end: 20.8 }], 14.6).time, 20.8);
  assert.equal(chooseSnap(20, [{ start: 19.5 }], 14.6, 24).time, 24);
  // Exactly 5 s back and exactly 1 s ahead both count.
  assert.equal(chooseSnap(20, [{ start: 14.6, end: 15 }], 14.6).time, 15);
  assert.equal(chooseSnap(20, [{ start: 20.6, end: 21 }], 14.6).time, 21);
  // A black that started before decoding is measured from where decoding began.
  assert.equal(chooseSnap(20, [{ start: 14.6, end: 14.85 }], 14.6), null);
  assert.equal(chooseSnap(20, [{ start: -Infinity, end: 15.2 }], 14.6).blackStart, 14.6);
});

test('the window decodes 5.4 s back and 1 s ahead, inside the recording', () => {
  assert.deepEqual(snapWindow(20, 100), { start: 14.6, end: 21 });
  assert.deepEqual(snapWindow(2, 2.5), { start: 0, end: 2.5 });
  const args = snapArgs('C:\\a b.mp4', 14.6, 6.4);
  assert.deepEqual(args.slice(args.indexOf('-ss'), args.indexOf('-i') + 2), [
    '-ss',
    '14.600000',
    '-t',
    '6.400000',
    '-i',
    'C:\\a b.mp4',
  ]);
  assert.match(
    args[args.indexOf('-vf') + 1],
    /blackdetect=d=0\.1:pic_th=0\.92,metadata=mode=print:file='pipe\\:1'$/,
  );
});

test('snapped times land on an inspected frame when one is within half a frame', () => {
  const frames = [18.55, 18.566667, 18.583333, 18.6];
  assert.equal(onFrame(18.583, frames), 18.583333);
  assert.equal(onFrame(18.7, frames), 18.7);
  assert.equal(onFrame(18.5, frames), 18.5);
  assert.equal(onFrame(18.583), 18.583);
});
