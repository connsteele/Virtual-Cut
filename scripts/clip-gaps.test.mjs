// Gaps inside a clip (VC-212, decision 0028): where joins land on keyframes, the pieces a clip
// exports, times on the exported clip's clock, and the edits the Cut page makes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  adjustGap,
  clipPieces,
  fitGaps,
  gapJoins,
  piecesLength,
  skipTarget,
  splitWithGaps,
  toPieceTime,
  withGap,
  withoutGap,
} from '../dist-electron/clip-gaps.js';
import { emptyModel, validateEdits } from '../dist-electron/project-edits.js';
import { reviewContent } from '../dist-electron/review-plan.js';
import { editTargets } from '../src/workflow/playheadSnap.ts';

// Keyframes every second, as on the Mass Effect footage (checked on 2026-11-10).
const keys = Array.from({ length: 986 }, (_, i) => i);
const clip = (gaps) => ({
  id: 'c',
  rid: 'r',
  name: 'Character creation',
  start: 120,
  end: 540,
  folder: '_Review',
  include: true,
  ...(gaps ? { gaps } : {}),
});

test('joins land on keyframes at both ends of a gap', () => {
  const [j] = gapJoins(clip([{ id: 'g', start: 205.4, end: 262.7 }]), keys);
  assert.equal(j.out, 206);
  assert.equal(j.back, 262);
  assert.equal(j.removed, 56);
  assert.equal(j.short, false);
  assert.equal(j.number, 1);
});

test('a gap needs two keyframes inside to remove anything', () => {
  const [one] = gapJoins(clip([{ id: 'g', start: 300.3, end: 301.8 }]), keys);
  assert.equal(one.short, true);
  assert.equal(one.removed, 0);
  const [exact] = gapJoins(clip([{ id: 'g', start: 300, end: 301 }]), keys);
  assert.equal(exact.short, false, 'keyframes exactly on both edges remove the whole span');
  assert.equal(exact.removed, 1);
});

test('without a keyframe index a gap is taken as marked', () => {
  const [j] = gapJoins(clip([{ id: 'g', start: 205.4, end: 262.7 }]));
  assert.equal(j.out, 205.4);
  assert.equal(j.back, 262.7);
});

test('pieces skip short gaps and map times to the exported clock', () => {
  const c = clip([
    { id: 'a', start: 205.4, end: 262.7 },
    { id: 'b', start: 300.3, end: 300.8 },
    { id: 'c', start: 371.2, end: 433.9 },
  ]);
  const pieces = clipPieces(c, keys, 985);
  assert.deepEqual(pieces, [
    { start: 120, end: 206 },
    { start: 262, end: 372 },
    { start: 433, end: 540 },
  ]);
  assert.equal(piecesLength(pieces), 420 - 56 - 61);
  assert.equal(toPieceTime(pieces, 150), 30);
  assert.equal(toPieceTime(pieces, 240), null, 'inside a gap is left out');
  assert.equal(toPieceTime(pieces, 262.5), 86.5);
  assert.equal(toPieceTime(pieces, 470.2).toFixed(1), '233.2');
  assert.equal(toPieceTime(pieces, 600), null);
});

test('clip bounds snap outward to keyframes like every export', () => {
  const pieces = clipPieces({ start: 120.4, end: 539.6 }, keys, 985);
  assert.deepEqual(pieces, [{ start: 120, end: 540 }]);
});

test('making gaps: add, merge, trim at an edge, refuse tiny or whole', () => {
  let r = withGap(clip(), 262.7, 205.4, 'g1');
  assert.equal(r.outcome, 'added');
  assert.deepEqual(r.clip.gaps, [{ id: 'g1', start: 205.4, end: 262.7 }]);
  r = withGap(r.clip, 250, 280, 'g2');
  assert.equal(r.outcome, 'merged');
  assert.deepEqual(r.clip.gaps, [{ id: 'g2', start: 205.4, end: 280 }]);
  assert.equal(withGap(clip(), 200, 200.05, 'x').outcome, 'too-short');
  assert.equal(withGap(clip(), 100, 600, 'x').outcome, 'whole');
  assert.equal(withGap(clip(), 10, 20, 'x').outcome, 'outside');
  const trimmed = withGap(clip([{ id: 'g', start: 140, end: 150 }]), 120, 145, 'x');
  assert.equal(trimmed.outcome, 'trimmed-start');
  assert.equal(trimmed.clip.start, 150, 'a gap the new edge lands in is swallowed');
  assert.equal(trimmed.clip.gaps, undefined);
  const end = withGap(clip(), 500, 540, 'x');
  assert.equal(end.outcome, 'trimmed-end');
  assert.equal(end.clip.end, 500);
});

test('removing, moving and splitting', () => {
  const c = clip([
    { id: 'a', start: 205.4, end: 262.7 },
    { id: 'b', start: 371.2, end: 433.9 },
  ]);
  assert.deepEqual(
    withoutGap(c, 'a').gaps.map((g) => g.id),
    ['b'],
  );
  assert.equal(withoutGap(withoutGap(c, 'a'), 'b').gaps, undefined);
  const moved = adjustGap(c, 'a', 'end', 500);
  assert.ok(moved.gaps[0].end < 371.2, 'an edge stops before the next gap');
  const shifted = adjustGap(c, 'a', 'move', 100);
  assert.ok(shifted.gaps[0].start > 120, 'a moved gap stays clear of the clip start');
  assert.equal(
    (shifted.gaps[0].end - shifted.gaps[0].start).toFixed(6),
    (262.7 - 205.4).toFixed(6),
  );
  const [x, y] = splitWithGaps(c, 240);
  assert.equal(x.end, 205.4, 'split inside a gap meets its edges');
  assert.equal(y.start, 262.7);
  assert.equal(x.gaps, undefined);
  assert.deepEqual(
    y.gaps.map((g) => g.id),
    ['b'],
  );
  const [p, q] = splitWithGaps(c, 300);
  assert.equal(p.end, 300);
  assert.deepEqual(
    p.gaps.map((g) => g.id),
    ['a'],
  );
  assert.equal(q.start, 300);
  assert.equal(splitWithGaps(c, 120.01), null);
});

const model = (gaps) => ({
  ...emptyModel(),
  recordings: [{ id: 'r', title: 'Source', context: '', duration: 985, position: 0 }],
  clips: [clip(gaps)],
});

test('saved gaps are checked and rounded like clip times', () => {
  const saved = validateEdits(model([{ id: 'g', start: 205.4000004, end: 262.7 }]));
  assert.deepEqual(saved.clips[0].gaps, [{ id: 'g', start: 205.4, end: 262.7 }]);
  assert.equal(validateEdits(model([])).clips[0].gaps, undefined);
  for (const gaps of [
    [{ id: 'g', start: 120, end: 130 }],
    [{ id: 'g', start: 530, end: 540 }],
    [{ id: 'g', start: 300, end: 290 }],
    [
      { id: 'g', start: 200, end: 300 },
      { id: 'h', start: 250, end: 320 },
    ],
    [{ id: '', start: 200, end: 300 }],
  ])
    assert.throws(() => validateEdits(model(gaps)), /gap/);
});

test('gaps change the review key; clips without gaps keep theirs', () => {
  const plain = model();
  const before = reviewContent(plain, plain.clips[0]);
  assert.ok(!before.includes('gaps'), 'existing acceptances stay valid');
  const gapped = model([{ id: 'g', start: 200, end: 300 }]);
  assert.notEqual(reviewContent(gapped, gapped.clips[0]), before);
});

test('a moved clip edge keeps its gaps valid', () => {
  const c = clip([
    { id: 'a', start: 205.4, end: 262.7 },
    { id: 'b', start: 371.2, end: 433.9 },
  ]);
  assert.equal(fitGaps(c), c, 'nothing to do');
  const inside = fitGaps({ ...c, start: 230 });
  assert.equal(inside.start, 262.7, 'Q inside a gap moves the start past it');
  assert.deepEqual(
    inside.gaps.map((g) => g.id),
    ['b'],
  );
  const past = fitGaps({ ...c, end: 300 });
  assert.equal(past.end, 300);
  assert.deepEqual(
    past.gaps.map((g) => g.id),
    ['a'],
  );
  const beside = fitGaps({ ...c, end: 371.22 });
  assert.equal(beside.end, 371.2, 'an edge just inside a gap moves to its start');
  assert.equal(fitGaps({ ...c, start: 100, end: 120 }).gaps, undefined);
  assert.doesNotThrow(() => validateEdits({ ...model(), clips: [fitGaps({ ...c, start: 230 })] }));
});

test('gap edges are snap targets like clip edges', () => {
  const targets = editTargets(
    0,
    [],
    [clip([{ id: 'a', start: 205.4, end: 262.7 }]), { id: 'x', start: 1, end: 2 }],
    { clip: 'x' },
  );
  assert.deepEqual(targets, [0, 120, 540, 205.4, 262.7]);
});

test('Skip gaps: a selected clip plays as it exports; otherwise the soonest gap end', () => {
  // Connor's 03:31 case: 02 and 03 overlap, and 03's gap starts first and ends first.
  const two = {
      id: '02',
      start: 300,
      end: 1300,
      spans: [{ out: 490, back: 820, number: 1, removed: 330 }],
    },
    three = {
      id: '03',
      start: 440,
      end: 920,
      spans: [{ out: 485, back: 730, number: 1, removed: 245 }],
    },
    clips = [two, three];
  assert.equal(skipTarget(clips, 480, undefined), null);
  // Nothing selected: the soonest end, then the gap it lands inside plays.
  const first = skipTarget(clips, 486, undefined);
  assert.equal(first.clipId, '03');
  assert.equal(first.back, 730);
  assert.deepEqual(first.landed, [two.spans[0]]);
  assert.equal(skipTarget(clips, 731, undefined, first.landed), null);
  assert.equal(skipTarget(clips, 731, undefined).back, 820, 'without the landing, 02 would skip');
  // 02 selected: only 02's gap counts, wherever playback is.
  assert.equal(skipTarget(clips, 486, '02'), null);
  assert.equal(skipTarget(clips, 600, '02').back, 820);
  // 03 selected: past 03's gap even when starting inside it, and never into 02's.
  assert.equal(skipTarget(clips, 600, '03').back, 730);
  assert.equal(skipTarget(clips, 750, '03'), null);
  // A selected clip the playhead isn't in counts as no selection.
  assert.equal(skipTarget(clips, 1000, '03'), null);
});

test('a stitched export puts markers on its own clock and lists what the gaps left out', () => {
  // require, not import: under --coverage the instrumented CommonJS module can't load its
  // ES module neighbours through Node's import-to-CommonJS bridge.
  const { annotation, exportedLength, exportedMarkers } = createRequire(import.meta.url)(
    '../dist-electron/clip-export.cjs',
  );
  const marker = (id, time, end) => ({
    id,
    time,
    ...(end != null ? { end } : {}),
    name: id,
    category: 'Context',
    topic: '',
  });
  // Pieces 1-5 and 10-20 on the recording are 0-4 and 4-14 on the exported clip.
  const pieces = [
    { start: 1, end: 5 },
    { start: 10, end: 20 },
  ];
  const record = {
    annotationVersion: 4,
    markerScope: 'clip',
    plan: {
      id: 'p',
      created: '2026-11-11T00:00:00.000Z',
      container: 'mov',
      requested: { start: 1, end: 20 },
      planned: { start: 1, end: 20 },
      name: 'A',
      pieces,
      gaps: [
        { id: 'g1', requested: { start: 5.2, end: 9.8 }, removed: { start: 5, end: 10 } },
        { id: 'g2', requested: { start: 15, end: 15.4 } },
      ],
    },
    input: {
      clip: { id: 'c', rid: 'r', name: 'A', start: 1, end: 20, folder: '_Review', include: true },
      markers: [
        marker('atStart', 1),
        marker('atIn', 0.5, 3),
        marker('before', 2),
        marker('inGap', 7),
        marker('after', 12),
        marker('across', 3, 12),
        marker('startsInGap', 7, 14),
        marker('endsInGap', 3, 8),
        marker('insideGap', 6, 9),
        marker('toJoin', 2, 5),
      ],
      context: '',
      gameTrack: 1,
      micTrack: null,
      sourceFile: 'source.mkv',
      sourceFingerprint: 'f',
      sourceBytes: 1,
      sourceModified: 0,
      sourceStart: 0,
      duration: 30,
    },
  };
  const v = {
    actual: { start: 1, end: 20 },
    timestampShift: 0,
    pieces,
    length: 14,
    constantFrameDuration: 1 / 60,
  };
  assert.deepEqual(
    exportedMarkers(record, v).map((m) => [m.marker.id, m.clipTime, m.clipEnd ?? null]),
    [
      ['atStart', 0, null],
      ['atIn', 0, 2],
      ['before', 1, null],
      ['after', 6, null],
      ['across', 2, 6],
      // A range starting in a gap starts at the join; one ending in a gap ends at the join.
      ['startsInGap', 4, 8],
      ['endsInGap', 2, 4],
      ['toJoin', 1, 4],
    ],
    'points inside a gap and ranges wholly inside one are left out',
  );
  assert.equal(exportedLength(v), 14);
  assert.equal(exportedLength({ actual: { start: 1, end: 20 } }), 19);
  const stitched = JSON.parse(annotation(record, v)).stitched;
  assert.equal(stitched.schema, 'virtual-cut-stitched');
  assert.equal(stitched.length, 14);
  assert.deepEqual(
    stitched.pieces.map((p) => [p.sourceStart, p.sourceEnd, p.clipStart, p.clipEnd]),
    [
      [1, 5, 0, 4],
      [10, 20, 4, 14],
    ],
  );
  assert.equal(stitched.gaps[0].joinAt, 4);
  assert.equal(stitched.gaps[1].removed, null, 'a gap too short to remove anything says so');
  assert.match(stitched.gaps[1].why, /Too short/);
  assert.deepEqual(stitched.leftOut, [
    { id: 'inGap', name: 'inGap', sourceTime: 7 },
    { id: 'insideGap', name: 'insideGap', sourceTime: 6, sourceEnd: 9 },
  ]);
});
