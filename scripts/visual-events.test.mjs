import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ChunkReader,
  STRONG_CUT,
  VISUAL_FILTER,
  buildEvents,
  chunkArgs,
  chunkPlan,
  eventLine,
  gpuDecoder,
  joinFrames,
  joinStills,
  summarize,
  visualHeight,
} from '../electron/visual-events.ts';
import { chooseSnap, snapFromBlacks, snapWindow } from '../electron/split-snap.ts';

// VC-180: picture events for a whole recording, read in chunks by any decoder.
const fps = 60;
/** Frames for `seconds` of picture from a function of time: [brightness, pblack, cut]. */
const frames = (seconds, at) => {
  const out = { times: [], brightness: [], black: [], cut: [] };
  for (let i = 0; i < seconds * fps; i++) {
    const t = i / fps;
    const [y, black, cut] = at(t);
    out.times.push(t);
    out.brightness.push(y);
    out.black.push(black);
    out.cut.push(cut);
  }
  return out;
};

test('a recording is read in 30 s chunks; the last runs to the end', () => {
  assert.deepEqual(
    chunkPlan(65).map((c) => [c.index, c.start, c.end]),
    [
      [0, 0, 30],
      [1, 30, 60],
      [2, 60, Infinity],
    ],
  );
  assert.equal(chunkPlan(60).length, 2);
  assert.equal(chunkPlan(0).length, 1);
  assert.equal(chunkPlan(5, 2).length, 3);
});

test('pictures are measured 480 px wide, keeping their shape', () => {
  assert.equal(visualHeight(3840, 2160), 270);
  assert.equal(visualHeight(1440, 1080), 360);
  assert.equal(visualHeight(), 270);
  assert.equal(gpuDecoder('av1'), 'av1_cuvid');
  assert.equal(gpuDecoder('H264'), 'h264_cuvid');
  assert.equal(gpuDecoder('prores'), undefined);
  assert.equal(gpuDecoder(), undefined);
});

test('NVDEC scales inside the decoder; CPU chunks scale with area averaging', () => {
  const base = { file: 'x.mp4', offset: 0.5, duration: 100, height: 270 };
  const gpu = chunkArgs({
    ...base,
    chunk: { index: 1, start: 30, end: 60 },
    decoder: 'gpu',
    gpu: 'av1_cuvid',
  });
  assert.deepEqual(gpu.slice(gpu.indexOf('-c:v'), gpu.indexOf('-c:v') + 4), [
    '-c:v',
    'av1_cuvid',
    '-resize',
    '480x270',
  ]);
  // Half a second of pre-roll and a second of post-roll, in file time.
  assert.equal(gpu[gpu.indexOf('-ss') + 1], '30.000000');
  assert.equal(gpu[gpu.indexOf('-t') + 1], '31.500000');
  assert.equal(gpu[gpu.indexOf('-vf') + 1], VISUAL_FILTER);
  assert(!gpu.includes('-threads'));
  const cpu = chunkArgs({
    ...base,
    chunk: { index: 0, start: 0, end: Infinity },
    decoder: 'cpu',
    threads: 8,
  });
  assert.equal(cpu[cpu.indexOf('-threads') + 1], '8');
  assert.equal(cpu[cpu.indexOf('-ss') + 1], '0.500000');
  assert.equal(cpu[cpu.indexOf('-t') + 1], '101.000000');
  assert(cpu[cpu.indexOf('-vf') + 1].startsWith('scale=480:270:flags=area,format=yuv420p'));
  assert(!cpu.includes('-resize'));
});

test('a chunk keeps its own frames and the still pictures FFmpeg reported', () => {
  const reader = new ChunkReader({ index: 1, start: 2, end: 4 }, 1);
  const frame = (t, y, black = 0, cut = 0) => [
    `frame:${t}    pts:${t}  pts_time:${t + 1}`,
    `lavfi.signalstats.YAVG=${y}`,
    `lavfi.blackframe.pblack=${black}`,
    'lavfi.scd.mafd=0.000',
    `lavfi.scd.score=${cut}`,
  ];
  const lines = [
    ...frame(1.5, 10),
    'lavfi.freezedetect.freeze_start=2.5',
    ...frame(2, 20, 95),
    ...frame(2, 21),
    ...frame(3, 30, 0, 18),
    'lavfi.freezedetect.freeze_duration=1.5',
    'lavfi.freezedetect.freeze_end=4',
    'not a value',
    ...frame(4, 40),
    'lavfi.freezedetect.freeze_start=5',
  ];
  for (const line of lines) reader.line(line);
  assert.equal(reader.last, 4);
  const stats = reader.finish();
  assert.deepEqual(stats.times, [2, 3]);
  assert.deepEqual(stats.brightness, [20, 30]);
  assert.deepEqual(stats.black, [95, 0]);
  assert.deepEqual(stats.cut, [0, 18]);
  assert.deepEqual(stats.stills, [{ start: 1.5, end: 3 }, { start: 4 }]);
  assert.equal(stats.decodedFrom, 1.5);
  assert.equal(stats.decodedTo, 4);
  const broken = new ChunkReader({ index: 0, start: 0, end: 1 }, 0);
  broken.line('frame:0 pts:0 pts_time:0');
  broken.line('lavfi.signalstats.YAVG=1');
  assert.throws(() => broken.finish(), /incomplete/);
  assert.throws(() => broken.line('frame:1 pts:1'), /without a time/);
});

const chunk = (index, start, end, stills, decodedFrom = start - 0.5) => ({
  index,
  start,
  end,
  times: [],
  brightness: [],
  black: [],
  cut: [],
  stills,
  decodedFrom,
  decodedTo: end + 1,
});

test('a still picture across chunk edges is one still, ended by the chunk it runs into', () => {
  const chunks = [
    chunk(0, 0, 10, [{ start: 2, end: 3 }, { start: 8 }]),
    // Decoding started inside the still: its first still continues the open one.
    chunk(1, 10, 20, [{ start: 9.5 }, { start: 15, end: 16 }]),
    chunk(2, 20, 30, [{ start: 19.5, end: 24 }, { start: 29.8 }]),
    // Decoding started before a still that began in the previous chunk's own span.
    chunk(3, 30, Infinity, [{ start: 29.8, end: 31 }, { start: 39.6 }]),
  ];
  assert.deepEqual(joinStills(chunks, 40), [
    { start: 2, end: 3 },
    { start: 8, end: 24 },
    { start: 15, end: 16 },
    { start: 29.8, end: 31 },
    { start: 39.6, end: 40, toEnd: true },
  ]);
  // A still open at a chunk's end whose next chunk has not been read yet runs to the end.
  assert.deepEqual(joinStills([chunk(0, 0, 10, [{ start: 8 }])], 20), [
    { start: 8, end: 20, toEnd: true },
  ]);
});

test('frames from every chunk join in time order, each once', () => {
  const a = {
    ...chunk(0, 0, 1, []),
    times: [0, 0.5],
    brightness: [1, 2],
    black: [0, 0],
    cut: [0, 0],
  };
  const b = {
    ...chunk(1, 1, 2, []),
    times: [0.5, 1, 1.5],
    brightness: [2, 3, 4],
    black: [0, 0, 0],
    cut: [0, 9, 0],
  };
  assert.deepEqual(joinFrames([b, a]), {
    times: [0, 0.5, 1, 1.5],
    brightness: [1, 2, 3, 4],
    black: [0, 0, 0, 0],
    cut: [0, 0, 9, 0],
  });
});

test('black screens follow blackdetect: 92% dark for 0.1 s, ending at the first lit frame', () => {
  const f = frames(6, (t) => {
    if (t >= 1 && t < 2) return [16, 100, 0];
    if (t >= 3 && t < 3 + 5 / fps) return [16, 95, 0]; // 0.083 s: too short
    if (t >= 4 && t < 4.1) return [16, 92, 0]; // exactly 0.1 s at the threshold
    if (t >= 5.5) return [16, 99, 0]; // still black at the end
    return [120, 91, 0];
  });
  const events = buildEvents(f, [], 6);
  assert.deepEqual(
    events.filter((e) => e.kind === 'black'),
    [
      { kind: 'black', start: 1, end: 2 },
      { kind: 'black', start: 4, end: 4.1 },
      { kind: 'black', start: 5.5, end: 6, toEnd: true },
    ],
  );
});

test('stills keep their brightness; a still that is a black screen adds nothing', () => {
  const f = frames(6, (t) => (t >= 1 && t < 2 ? [16, 100, 0] : [80 + (t > 3 ? 20 : 0), 0, 0]));
  const events = buildEvents(
    f,
    [
      { start: 1, end: 2 },
      { start: 3.5, end: 5 },
      { start: 5.5, end: 6, toEnd: true },
    ],
    6,
  );
  assert.deepEqual(
    events.filter((e) => e.kind === 'still'),
    [
      { kind: 'still', start: 3.5, end: 5, brightness: 100 },
      { kind: 'still', start: 5.5, end: 6, brightness: 100, toEnd: true },
    ],
  );
});

test('strong cuts score 15 or more, except where a black screen starts or ends', () => {
  const f = frames(5, (t) => {
    if (t >= 2 && t < 3) return [16, 100, t === 2 ? 40 : 0];
    if (Math.abs(t - 1) < 1e-9) return [100, 0, STRONG_CUT];
    if (Math.abs(t - 1.5) < 1e-9) return [100, 0, 14.9];
    if (Math.abs(t - 3) < 1e-9) return [100, 0, 30];
    if (Math.abs(t - 4) < 1e-9) return [100, 0, 22.25];
    return [100, 0, 0];
  });
  assert.deepEqual(
    buildEvents(f, [], 5).filter((e) => e.kind === 'cut'),
    [
      { kind: 'cut', start: 1, score: 15 },
      { kind: 'cut', start: 4, score: 22.3 },
    ],
  );
});

test('fades: brightness moving 40 or more within 1 s, not at a cut or a black screen', () => {
  // Bright 200 fading to 60 over 0.5 s from 1 s; a flash at 4 s comes with a hard cut.
  const f = frames(7, (t) => {
    if (t < 1) return [200, 0, 0];
    if (t < 1.5) return [200 - (t - 1) * 280, 0, 0];
    if (t < 4) return [60, 0, 0];
    if (t < 5) return [220, 0, Math.abs(t - 4) < 1e-9 ? 40 : 0];
    if (t < 5.6) return [220 - (t - 5) * 340, 0, 0];
    return [16, 100, 0];
  });
  const fades = buildEvents(f, [], 7).filter((e) => e.kind === 'fade');
  assert.equal(fades.length, 1);
  assert.equal(fades[0].from, 200);
  assert(fades[0].start >= 1 && fades[0].start < 1.05, JSON.stringify(fades[0]));
  assert(fades[0].end >= 1.45 && fades[0].end <= 1.55, JSON.stringify(fades[0]));
  assert(fades[0].to <= 65, JSON.stringify(fades[0]));
  assert.equal(eventLine(fades[0]).includes('darker  brightness 200 ->'), true);
});

test('a brightness step at a weaker cut (score 8 to 15) is neither a fade nor a strong cut', () => {
  const f = frames(4, (t) => (t < 2 ? [60, 0, 0] : [200, 0, Math.abs(t - 2) < 1e-9 ? 10 : 0]));
  assert.deepEqual(
    buildEvents(f, [], 4).filter((e) => e.kind === 'fade' || e.kind === 'cut'),
    [],
  );
  // The same step with no cut at all reads as a change of brightness.
  const g = frames(4, (t) => (t < 2 ? [60, 0, 0] : [200, 0, 0]));
  assert.equal(buildEvents(g, [], 4).filter((e) => e.kind === 'fade').length, 1);
});

test('events read as text lines and summarize by kind', () => {
  const events = [
    { kind: 'black', start: 1, end: 2.5 },
    { kind: 'still', start: 3, end: 4, brightness: 90 },
    { kind: 'cut', start: 5, score: 20 },
    { kind: 'fade', start: 6, end: 6.5, from: 40, to: 200 },
  ];
  assert.deepEqual(events.map(eventLine), [
    '1.00-2.50  black  1.5s',
    '3.00-4.00  still picture  1.0s  brightness 90',
    '5.00  cut  score 20.0',
    '6.00-6.50  brighter  brightness 40 -> 200',
  ]);
  const summary = summarize({
    events,
    use: 'gpu',
    elapsedMs: 1200,
    frames: { times: new Float32Array(3), brightness: new Uint8Array(3), cut: new Uint8Array(3) },
  });
  assert.deepEqual(summary, {
    use: 'gpu',
    elapsedMs: 1200,
    frames: 3,
    counts: { black: 1, still: 1, cut: 1, fade: 1 },
  });
});

test('the Split snap from stored blacks matches what its window decode would see', () => {
  const duration = 120;
  const blacks = [
    { start: 10, end: 12.5 }, // ends 2 s before a word at 14.5: snaps
    { start: 30, end: 30.2 }, // too short
    { start: 50, end: 70 }, // on screen at a word at 52, ends beyond the 10 s follow-up
    { start: 80, end: 85 }, // on screen at a word at 81, ends within the follow-up
    { start: 110, end: 120, toEnd: true }, // runs to the end of the recording
  ];
  const window = (spoken) => {
    // What a window decode reports: blacks clipped to the window, open past its end, and the
    // follow-up decode's end when it finds one.
    const w = snapWindow(spoken, duration);
    const horizon = Math.min(duration, w.end + 10);
    const seen = blacks
      .filter((b) => b.end > w.start && b.start < w.end)
      .map((b) => ({ start: b.start, end: b.end > w.end ? undefined : b.end }));
    const open =
      seen.at(-1)?.end == null ? blacks.find((b) => b.start === seen.at(-1)?.start) : null;
    const follow = open && !open.toEnd && open.end <= horizon ? open.end : null;
    return chooseSnap(spoken, seen, w.start, follow);
  };
  for (const spoken of [14.5, 30.5, 52, 81, 111, 100, 0.2])
    assert.deepEqual(snapFromBlacks(spoken, duration, blacks), window(spoken), `word at ${spoken}`);
  assert.equal(snapFromBlacks(14.5, duration, blacks).time, 12.5);
  assert.equal(snapFromBlacks(81, duration, blacks).time, 85);
  assert.equal(snapFromBlacks(52, duration, blacks), null);
});
