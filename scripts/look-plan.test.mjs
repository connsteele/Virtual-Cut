// The look tool's planner (VC-172): sizes on the 28 px grid, the per-call caps and how a request
// over them is fitted, crops, strip tiles from keyframes, the near-duplicate hash and the
// burned-in time.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LookError,
  burnTime,
  clock,
  cropRegion,
  fitInside,
  imageTokens,
  nearDuplicate,
  pictureHash,
  planLook,
  tileTimes,
} from '../dist-electron/look-plan.js';

const keys = Array.from({ length: 601 }, (_, i) => i);
const frameTimes = Array.from({ length: 36001 }, (_, i) => i / 60);
const uhd = {
  title: 'Battle',
  duration: 600,
  width: 3840,
  height: 2160,
  keys,
  frameTimes,
  screenTextFrame: { width: 1920, height: 1080 },
};
const tokens = (plan) => plan.images.reduce((n, i) => n + i.tokens, 0);

test('sizes fill whole 28 px cells and never enlarge a recording', () => {
  assert.equal(imageTokens(1280, 720), 46 * 26);
  assert.equal(imageTokens(1920, 1080), 69 * 39);
  const [p720, p1080] = ['720p', '1080p'].map(
    (size) => planLook(uhd, [{ kind: 'frames', times: [10], size }]).images[0],
  );
  assert.deepEqual([p720.width, p720.height, p720.tokens], [1288, 724, 1196]);
  assert.deepEqual([p1080.width, p1080.height, p1080.tokens], [1932, 1086, 2691]);
  const tile = planLook(uhd, [{ kind: 'strip', start_seconds: 0, end_seconds: 16 }]).images[0];
  assert.deepEqual([tile.width, tile.height, tile.tokens], [248, 140, 45]);
  // A 4:3 recording fits inside the same box; a small one keeps its own size.
  assert.deepEqual(fitInside(1440, 1080, 1288, 728), { width: 970, height: 728 });
  const small = planLook({ ...uhd, width: 1280, height: 720 }, [
    { kind: 'frames', times: [1], size: '1080p' },
  ]).images[0];
  assert.deepEqual([small.width, small.height], [1280, 720]);
  for (const i of planLook(uhd, [
    { kind: 'crop', at_seconds: 1, box: [0, 0, 1, 1], box_units: 'fraction' },
  ]).images)
    assert.ok(Math.max(i.width, i.height) <= 1988, 'no side over 1988 px');
});

test('frames snap to the recording frame and say which size they are', () => {
  const plan = planLook(uhd, [{ kind: 'frames', times: [10.004, 20] }]);
  assert.deepEqual(
    plan.images.map((i) => [i.kind, i.size, i.at, i.keyframe]),
    [
      ['frame', '720p', 10, false],
      ['frame', '720p', 20, false],
    ],
  );
  assert.deepEqual(plan.notes, []);
});

test('frames over a size cap step down a size and say so', () => {
  const big = planLook(uhd, [{ kind: 'frames', times: [1, 2, 3], size: '1080p' }]);
  assert.deepEqual(
    big.images.map((i) => i.size),
    ['1080p', '1080p', '720p'],
  );
  assert.match(
    big.notes[0],
    /3 frames at 1080p asked; 2 a call are sent at 1080p, the rest at 720p/,
  );
  const many = planLook(uhd, [{ kind: 'frames', times: [1, 2, 3, 4, 5, 6, 7, 8] }]);
  assert.deepEqual(
    many.images.map((i) => i.size),
    // 6 at 720p and 2 at 540p come to 8,576 tokens, so the last two 720p frames step down too.
    ['720p', '720p', '720p', '720p', '540p', '540p', '540p', '540p'],
  );
  assert.ok(tokens(many) <= 8000, `${tokens(many)} tokens`);
});

test('over 16 pictures, strips give up tiles first, then the last pictures are left out', () => {
  const one = planLook(uhd, [
    { kind: 'strip', start_seconds: 0, end_seconds: 120 },
    { kind: 'frames', times: [5, 6, 7, 8] },
  ]);
  assert.equal(one.images.length, 16);
  assert.equal(one.images.filter((i) => i.kind === 'tile').length, 12);
  assert.match(one.notes[0], /Strip of moment 1 fitted to 12 tiles \(16 asked\)/);
  const two = planLook(uhd, [
    { kind: 'strip', start_seconds: 0, end_seconds: 60 },
    { kind: 'strip', start_seconds: 60, end_seconds: 120, tiles: 10 },
  ]);
  assert.deepEqual(
    [0, 1].map((m) => two.images.filter((i) => i.moment === m).length),
    [8, 8],
  );
  const full = planLook(
    uhd,
    Array.from({ length: 8 }, (_, n) =>
      n < 7
        ? { kind: 'strip', start_seconds: n * 10, end_seconds: n * 10 + 10 }
        : { kind: 'frames', times: [100, 101, 102] },
    ),
  );
  assert.equal(full.images.length, 16);
  assert.equal(full.images.filter((i) => i.kind === 'frame').length, 2);
  assert.match(full.notes.at(-1), /Left out, ask again for them: frame at 1:42\.0 \(moment 8\)\./);
});

test('over about 8,000 image tokens, the largest frame or crop steps down until it fits', () => {
  const plan = planLook(uhd, [
    { kind: 'frames', times: [1, 2], size: '1080p' },
    { kind: 'frames', times: [3, 4, 5, 6, 7, 8] },
  ]);
  assert.ok(tokens(plan) <= 8000, `${tokens(plan)} tokens`);
  assert.equal(plan.images.length, 8);
  assert.match(plan.notes.at(-1), /^About 12,558 image tokens asked; about 8,000 a call, so /);
  assert.match(plan.notes.at(-1), /the frame at 0:02\.0 is sent at 720p/);
  const crops = planLook(
    uhd,
    Array.from({ length: 4 }, (_, n) => ({
      kind: 'crop',
      at_seconds: n,
      box: [0, 0, 1, 1],
      box_units: 'fraction',
    })),
  );
  assert.ok(tokens(crops) <= 8000);
  assert.ok(crops.images.every((i) => i.scaled));
  assert.match(crops.notes.join(' '), /Crops larger than 1988 px on a side are scaled down/);
});

test('crops: a screen text box padded and scaled, or a fraction box, grown to whole cells', () => {
  // A subtitle read at 1920x1080 on a 4K recording: padded by half its height each side.
  const text = cropRegion(
    uhd,
    { kind: 'crop', box: [600, 900, 1300, 940], box_units: 'screen_text' },
    0,
  );
  assert.deepEqual(text, { x: 1158, y: 1756, width: 1484, height: 168 });
  assert.equal(text.width % 28, 0);
  assert.equal(text.height % 28, 0);
  const fraction = cropRegion(
    uhd,
    { kind: 'crop', box: [0.5, 0.5, 0.6, 0.6], box_units: 'fraction' },
    0,
  );
  assert.deepEqual(fraction, { x: 1916, y: 1076, width: 392, height: 224 });
  // At the frame edge the region stays inside the frame.
  const corner = cropRegion(
    uhd,
    { kind: 'crop', box: [0.99, 0.99, 1, 1], box_units: 'fraction' },
    0,
  );
  assert.equal(corner.x + corner.width, 3840);
  assert.equal(corner.y + corner.height, 2160);
  const plan = planLook(uhd, [
    { kind: 'crop', at_seconds: 3, box: [0.5, 0.5, 0.6, 0.6], box_units: 'fraction' },
  ]);
  assert.deepEqual(
    [plan.images[0].width, plan.images[0].height, plan.images[0].scaled],
    [392, 224, false],
  );
  assert.throws(
    () =>
      planLook({ ...uhd, screenTextFrame: undefined }, [
        { kind: 'crop', at_seconds: 1, box: [1, 1, 9, 9], box_units: 'screen_text' },
      ]),
    /screen text has not been read, so give a fraction box/,
  );
  assert.throws(
    () =>
      planLook(uhd, [
        { kind: 'crop', at_seconds: 1, box: [0.5, 0.5, 2, 0.6], box_units: 'fraction' },
      ]),
    /fraction box uses values from 0 to 1/,
  );
  assert.throws(
    () =>
      planLook(uhd, [{ kind: 'crop', at_seconds: 1, box: [5, 5, 1, 1], box_units: 'fraction' }]),
    /x1 > x0/,
  );
  assert.throws(
    () => planLook(uhd, [{ kind: 'crop', at_seconds: 1, box: [0, 0, 1, 1] }]),
    /box_units/,
  );
});

test('strip tiles use the nearest keyframe when it is close enough, else the exact frame', () => {
  assert.deepEqual(tileTimes(0, 4, 4), [0.5, 1.5, 2.5, 3.5]);
  const wide = planLook(uhd, [{ kind: 'strip', start_seconds: 0, end_seconds: 16 }]);
  assert.ok(wide.images.every((i) => i.keyframe && Number.isInteger(i.at)));
  assert.deepEqual(
    wide.images.map((i) => i.tile.index),
    Array.from({ length: 16 }, (_, i) => i + 1),
  );
  // Tiles a quarter second apart: only a keyframe within an eighth of a second will do.
  const close = planLook(uhd, [{ kind: 'strip', start_seconds: 0, end_seconds: 4 }]).images;
  assert.deepEqual(
    close.slice(0, 4).map((i) => [i.requested, i.keyframe, i.at]),
    [
      [0.125, true, 0],
      [0.375, false, 0.36666666666666664],
      [0.625, false, 0.6166666666666667],
      [0.875, true, 1],
    ],
  );
  // Keyframes far apart (one every 10 s): never more than 2 s away.
  const sparse = planLook({ ...uhd, keys: [0, 10, 20, 30] }, [
    { kind: 'strip', start_seconds: 0, end_seconds: 30, tiles: 6 },
  ]).images;
  assert.deepEqual(
    sparse.map((i) => i.keyframe),
    [false, false, false, false, false, false],
  );
});

test('requests that cannot be read are refused, naming the moment', () => {
  assert.throws(() => planLook(uhd, []), LookError);
  assert.throws(
    () =>
      planLook(
        uhd,
        Array.from({ length: 9 }, () => ({ kind: 'frames', times: [1] })),
      ),
    /at most 8 moments/,
  );
  assert.throws(
    () => planLook(uhd, [{ kind: 'frames', times: [601] }]),
    /Moment 1: times must be a time/,
  );
  assert.throws(() => planLook(uhd, [{ kind: 'frames' }]), /give times/);
  assert.throws(
    () => planLook(uhd, [{ kind: 'strip', start_seconds: 9, end_seconds: 3 }]),
    /after start/,
  );
  assert.throws(() => planLook(uhd, [{ kind: 'strip', tiles: 40 }]), /tiles is a whole number/);
  assert.throws(() => planLook(uhd, [{ kind: 'frames', times: [1], size: '4k' }]), /720p/);
  assert.throws(() => planLook(uhd, [{ kind: 'zoom' }]), /kind is "strip", "frames" or "crop"/);
  assert.throws(
    () => planLook({ ...uhd, width: 0 }, [{ kind: 'frames', times: [1] }]),
    /size of this recording/,
  );
  // A strip's end past the recording is the recording's end.
  const tail = planLook(uhd, [{ kind: 'strip', start_seconds: 590, end_seconds: 900, tiles: 2 }]);
  assert.deepEqual(
    tail.images.map((i) => i.requested),
    [592.5, 597.5],
  );
});

test('near-duplicate pictures share a hash; a changed subtitle does not', () => {
  const w = 320,
    h = 180;
  const picture = (subtitle, noise = 0) => {
    const bgra = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        const v = 40 + ((x + y) % 50) + (noise ? (x * 7 + y * 13) % (noise + 1) : 0);
        bgra[p] = bgra[p + 1] = bgra[p + 2] = v;
        bgra[p + 3] = 255;
      }
    // A line of "text": bright blocks along the bottom, different per subtitle.
    for (let i = 0; i < subtitle.length; i++)
      if (subtitle[i] === '#')
        for (let y = 150; y < 162; y++)
          for (let x = 40 + i * 12; x < 48 + i * 12; x++) {
            const p = (y * w + x) * 4;
            bgra[p] = bgra[p + 1] = bgra[p + 2] = 250;
          }
    return pictureHash(bgra, w, h);
  };
  const a = picture('##.#.###.##.#');
  assert.equal(a.length, 64 * 36);
  assert.ok(nearDuplicate(a, picture('##.#.###.##.#')));
  assert.ok(
    nearDuplicate(a, picture('##.#.###.##.#', 2)),
    'encoder noise is still the same picture',
  );
  assert.ok(!nearDuplicate(a, picture('#.##.#.###.##')), 'another subtitle is a new picture');
  assert.ok(!nearDuplicate(a, new Uint8Array(10)));
});

test('the burned-in time is white figures on a dark box in the bottom-left corner', () => {
  const w = 248,
    h = 140;
  const bgra = new Uint8Array(w * h * 4).fill(200);
  burnTime(bgra, w, h, '12:03.5');
  const at = (x, y) => bgra[(y * w + x) * 4];
  assert.equal(at(0, h - 1), 50, 'darkened box');
  assert.equal(at(200, 10), 200, 'the rest of the picture is untouched');
  let white = 0;
  for (let y = h - 20; y < h; y++) for (let x = 0; x < 90; x++) if (at(x, y) === 255) white++;
  assert.ok(white > 100, `${white} lit pixels`);
});

test('times read as m:ss.s, with hours from an hour on', () => {
  assert.equal(clock(0), '0:00.0');
  assert.equal(clock(723.48), '12:03.5');
  assert.equal(clock(3725.04), '1:02:05.0');
  assert.equal(clock(59.96), '1:00.0');
});
