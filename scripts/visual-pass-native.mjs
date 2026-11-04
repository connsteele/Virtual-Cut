import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { require } from './shared.mjs';
import { testPath } from './test-paths.mjs';
const { ProjectService } = require('../dist-electron/project-service.cjs');
const { runPass, gpuReads } = require('../dist-electron/visual-pass.cjs');
const visual = await import('../dist-electron/visual-events.js');
const { readBlacks, snapArgs } = await import('../dist-electron/split-snap.js');

// VC-180: the background picture pass. Every decoder path and chunk size finds the same
// events on a short test copy; the pass waits for the recording's transcript, pauses while a
// transcription runs or a preview plays, carries on from the chunks it read, runs on the CPU
// only when the PC is idle (no NVIDIA decoder), stores its events once per fingerprint
// outside the model, and the Split snap reads them. The speech worker is a held stand-in.
delete process.env.VIRTUAL_CUT_PICTURE_PASS; // this check wants passes after import
await mkdir(testPath('visual-pass'), { recursive: true });
const dir = await mkdtemp(path.join(testPath('visual-pass'), 'run-'));
const ffmpeg = process.env.VIRTUAL_CUT_FFMPEG || 'ffmpeg';
const tool = (args, quiet = true) =>
  new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, quiet ? ['-v', 'error', ...args] : args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '',
      error = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (error += d));
    p.on('error', reject);
    p.on('close', (code) => (code ? reject(Error(error)) : resolve(out)));
  });
// 14.2 s at 60 fps: moving picture, a 1 s black, a cut, a still that fades to dark grey,
// colour bars (still), a frozen frame, a 0.2 s black, moving picture, black to the end.
const short = path.join(dir, 'picture-events.mp4'),
  long = path.join(dir, 'picture-events-long.mp4');
const parts = [
  '[0:v]trim=duration=3[a]',
  '[1:v]trim=duration=1[b]',
  '[2:v]trim=duration=2[c]',
  '[3:v]trim=duration=2,fade=t=out:st=1:d=0.6:color=0x303030[d]',
  '[4:v]trim=duration=2[e]',
  '[0:v]trim=start=1:duration=0.0334,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=2[f]',
  '[1:v]trim=duration=0.2[g]',
  '[2:v]trim=duration=1.5[h]',
  '[1:v]trim=duration=0.5[i]',
  '[a][b][c][d][e][f][g][h][i]concat=n=9:v=1:a=0,format=yuv420p[v]',
];
await tool([
  ...['testsrc2', 'color=c=black', 'mandelbrot', 'color=c=0xd0d0d0', 'smptehdbars'].flatMap((s) => [
    '-f',
    'lavfi',
    '-i',
    `${s}${s.includes('=') ? ':' : '='}size=1280x720:rate=60`,
  ]),
  ...['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000'],
  ...['-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000'],
  '-filter_complex',
  parts.join(';'),
  ...['-map', '[v]', '-map', '5:a', '-map', '6:a', '-shortest'],
  ...['-c:v', 'libx264', '-preset', 'veryfast', '-g', '60', '-c:a', 'aac', '-y', short],
]);
// Three times as long, for pausing a pass part way.
await tool(['-stream_loop', '2', '-i', short, '-map', '0', '-c', 'copy', '-y', long]);
const probe = async (file) =>
  Number(
    await new Promise((resolve, reject) => {
      const p = spawn(
        process.env.VIRTUAL_CUT_FFPROBE || 'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
        { windowsHide: true },
      );
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.on('error', reject);
      p.on('close', () => resolve(out.trim()));
    }),
  );
const shortDuration = await probe(short);

const results = { paths: {} };
const read = async (file, duration, { chunk = 30, gpu = false, cpu = 1 } = {}) => {
  const done = { chunks: new Map(), elapsedMs: 0, used: new Set() };
  const began = performance.now();
  const chunks = await runPass(
    {
      ffmpeg,
      file,
      offset: 0,
      duration,
      height: 270,
      gpu: gpu ? 'h264_cuvid' : undefined,
      chunkSeconds: chunk,
      allowance: () => ({ gpu, cpu }),
      progress: () => {},
      gpuFailed: (e) => {
        throw e;
      },
      signal: new AbortController().signal,
    },
    done,
  );
  const frames = visual.joinFrames(chunks);
  return {
    ms: Math.round(performance.now() - began),
    used: [...done.used].sort().join('+'),
    frames: frames.times.length,
    events: visual.buildEvents(frames, visual.joinStills(chunks, duration), duration),
  };
};

// 1. Every path and chunk size finds the same events.
const reference = await read(short, shortDuration, { chunk: 100 });
results.paths['cpu, one chunk'] = reference.ms;
const kinds = (events) => events.map((e) => e.kind).join(',');
assert.equal(
  kinds(reference.events),
  'black,still,cut,fade,still,cut,cut,still,black,black',
  JSON.stringify(reference.events),
);
const fade = reference.events.find((e) => e.kind === 'fade');
assert.deepEqual([fade.start, fade.end], [7, 7.6], JSON.stringify(fade));
assert(fade.from - fade.to >= 100, JSON.stringify(fade));
const paths = [
  ['cpu, 3 workers, 2 s chunks', { chunk: 2, cpu: 3 }],
  ['cpu, 3 workers, 1.7 s chunks', { chunk: 1.7, cpu: 3 }],
  ['cpu, 2 workers, 0.6 s chunks', { chunk: 0.6, cpu: 2 }],
];
const gpu =
  process.env.VIRTUAL_CUT_PICTURE_GPU !== '0' &&
  (await gpuReads(ffmpeg, short, 'h264_cuvid', 0, new AbortController().signal));
results.nvdec = gpu;
if (gpu)
  paths.push(
    ['NVDEC alone, 2 s chunks', { chunk: 2, gpu: true, cpu: 0 }],
    ['NVDEC + 3 CPU workers, 1.7 s chunks', { chunk: 1.7, gpu: true, cpu: 3 }],
    ['NVDEC alone, one chunk', { chunk: 100, gpu: true, cpu: 0 }],
  );
// The CPU path is exact whatever the chunks. NVDEC scales inside the decoder, so a cut's score
// or a still's mean brightness may differ in the last place; the events and their times may not.
const measured = (events) =>
  // eslint-disable-next-line no-unused-vars
  events.map(({ score, brightness, from, to, ...e }) => e);
for (const [name, options] of paths) {
  const got = await read(short, shortDuration, options);
  results.paths[name] = got.ms;
  if (options.gpu) {
    assert.deepEqual(measured(got.events), measured(reference.events), `${name}: same events`);
    got.events.forEach((e, i) => {
      const r = reference.events[i];
      for (const key of ['score', 'brightness', 'from', 'to'])
        if (key in e)
          assert(Math.abs(e[key] - r[key]) <= 2, `${name}: ${key} ${e[key]} vs ${r[key]}`);
    });
  } else assert.deepEqual(got.events, reference.events, `${name} found the same events`);
  assert.equal(got.frames, reference.frames, `${name} read every frame once`);
  if (options.gpu && options.cpu) assert.equal(got.used, 'cpu+gpu', `${name} used both decoders`);
}
// Black screens are the ones the Split snap's own decode finds.
const lines = [];
await tool(snapArgs(short, 0, shortDuration + 1), false).then((out) =>
  lines.push(...out.split(/\r?\n/).filter((l) => l.startsWith('lavfi.black_'))),
);
const snapped = readBlacks(lines);
assert.deepEqual(
  reference.events
    .filter((e) => e.kind === 'black')
    .map((e) => [e.start, e.toEnd ? undefined : e.end]),
  snapped.map((b) => [Math.round(b.start * 1000) / 1000, b.end && Math.round(b.end * 1000) / 1000]),
  'Same black screens as blackdetect',
);
const longReference = await read(long, await probe(long), { chunk: 100 });

// 2. In the app: the scheduling rules, with a held speech stand-in and no NVIDIA decoder.
process.env.VIRTUAL_CUT_PICTURE_GPU = '0';
process.env.VIRTUAL_CUT_PICTURE_CHUNK = '0.5';
const file = path.join(dir, 'visual-pass.vcut'),
  cache = path.join(dir, 'cache'),
  destination = path.join(dir, 'outputs');
await mkdir(cache);
await mkdir(destination);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let service = new ProjectService(path.join(dir, 'profile'), '');
const jobs = () => service.store.jobs();
const pass = (sourceId) => jobs().find((j) => j.kind === 'visual' && j.sourceId === sourceId);
const until = async (test, what, limit = 30000) => {
  for (const end = Date.now() + limit; Date.now() < end; await sleep(25)) if (test()) return;
  throw Error(`Timed out waiting for ${what}: ${JSON.stringify(jobs())}`);
};
const libraries = path.join(dir, 'libraries'),
  model = path.join(dir, 'model');
await mkdir(path.join(libraries, 'faster_whisper'), { recursive: true });
await mkdir(model);
await writeFile(path.join(model, 'model.bin'), 'fixture');
const holds = [];
const standIn = (s) => {
  s.transcription.settings = {
    python: process.execPath,
    libraries,
    model,
    device: 'cpu',
    threads: 4,
  };
  s.transcription.run = (request, signal, receive) =>
    new Promise((resolve, reject) => {
      receive({
        type: 'info',
        device: 'cpu',
        language: 'en',
        engine: 'fixture',
        runtime: 'fixture',
      });
      holds.push({
        release() {
          receive({
            type: 'segment',
            segment: {
              id: 0,
              start: 1,
              end: 2,
              text: 'Held line.',
              words: [{ text: 'Held line.', start: 1, end: 2, probability: 0.9 }],
              noSpeechProbability: 0,
              averageLogProbability: -0.1,
            },
          });
          receive({ type: 'complete', peakMemoryBytes: 0 });
          resolve();
        },
      });
      if (signal.aborted) reject(Error('cancelled'));
      signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true });
    });
};
standIn(service);
let idleFor = 0;
service.idleSeconds = () => idleFor;
const opts = { roles: ['mic'], language: 'en', vocabulary: false };
try {
  let snap = await service.open(file, { name: 'Picture pass', destination, cache });
  const project = snap.project.id,
    batch = snap.activeBatchId;
  // An import that transcribes: the pass waits for the transcript.
  await service.importFiles(project, batch, [long], { game: 1, mic: 2, transcription: opts });
  const a = service.store.data.model.recordings[0].id;
  await until(() => pass(a) && holds.length === 1, 'the pass queued behind the transcript');
  assert.equal(pass(a).origin, 'background', 'The pass after import is background work');
  await until(() => pass(a).message === 'Waiting for this recording’s transcript', 'its wait');
  holds[0].release();
  // No NVIDIA decoder and you are working: it waits for the PC to be idle.
  await until(
    () => pass(a).message === 'Waiting for the PC to be idle (no NVIDIA decoder)',
    'the idle wait',
  );
  await sleep(500);
  assert.equal(pass(a).state, 'queued');
  // Analyse picture now on a queued pass makes it yours; it still follows the rules.
  snap = await service.analysePicture(project, [a]);
  assert.equal(pass(a).origin, 'user');
  assert.equal(pass(a).state, 'queued');
  // Idle: CPU workers read it. A preview playing part way pauses it.
  idleFor = 600;
  await until(
    () => pass(a).state === 'running' && pass(a).progress > 0.15,
    'the pass to run',
    20000,
  );
  assert.equal(pass(a).use, 'cpu');
  service.previewPlaying(true);
  await until(() => pass(a).state === 'queued', 'the pause for playback', 5000);
  assert.equal(pass(a).message, 'Paused: preview playing');
  const pausedAt = pass(a).progress;
  assert(pausedAt > 0.15 && pausedAt < 1, `It kept its progress (${pausedAt})`);
  await sleep(2500);
  assert.equal(pass(a).state, 'queued', 'It stays paused while the preview plays');
  // A transcription of the recording starting while it runs pauses it too.
  service.previewPlaying(false);
  await until(() => pass(a).state === 'running', 'the pass to carry on');
  assert(pass(a).progress >= pausedAt, 'It carried on from the chunks it had read');
  service.requestTranscription(project, a, batch, { ...opts, roles: ['game'] });
  await until(
    () => pass(a).message === 'Waiting for this recording’s transcript',
    'the transcription pause',
    8000,
  );
  assert.equal(pass(a).state, 'queued');
  holds[1].release();
  await until(() => pass(a).state === 'succeeded', 'the pass to finish', 60000);
  results.appPass = { elapsedMs: pass(a).elapsedMs, use: pass(a).use, message: pass(a).message };
  assert.match(pass(a).message, /^Picture events ready/);
  const stored = service.store.pictureEvents(a);
  assert.deepEqual(stored.events, longReference.events, 'Paused and resumed, the same events');
  assert.equal(stored.use, 'cpu');
  assert.equal(stored.frames.times.length, longReference.frames);
  assert.equal(stored.frames.brightness.length, longReference.frames);
  snap = await service.snapshot();
  assert.deepEqual(snap.pictures[a].counts, visual.summarize({ ...stored }).counts);
  assert.equal(snap.pictures[a].use, 'cpu');
  // Outside the editable model and Undo.
  assert(!JSON.stringify(service.store.data.model).includes('"still"'));
  // Stored once: asking again makes no new pass.
  const count = jobs().filter((j) => j.kind === 'visual').length;
  await service.analysePicture(project, [a]);
  assert.equal(jobs().filter((j) => j.kind === 'visual').length, count);

  // The Split snap reads the stored blacks, with the same answer as its own decode.
  idleFor = 0;
  const b =
    (await service.importFiles(project, batch, [short], { game: 1, mic: 2 })) &&
    service.store.data.model.recordings.find((r) => r.id !== a).id;
  await until(
    () =>
      pass(b)?.state === 'queued' &&
      !jobs().some(
        (j) => j.sourceId === b && j.kind !== 'visual' && ['queued', 'running'].includes(j.state),
      ),
    'the second recording',
  );
  const words = [4.5, 8.2, 12.4, 13.9];
  const decoded = [];
  for (const word of words) decoded.push(await service.splitSnap(project, b, word));
  // A transcription of another recording pauses it as well.
  service.requestTranscription(project, a, batch, { ...opts, language: 'de' });
  await until(() => holds.length === 3, 'a third transcription');
  idleFor = 600;
  await until(() => pass(b).message === 'Paused: transcription running', 'the pause beside it');
  await sleep(1500);
  assert.equal(pass(b).state, 'queued', 'Paused while the transcription runs');
  holds[2].release();
  await until(() => pass(b).state === 'succeeded', 'the second pass', 30000);
  await service.close();
  service = new ProjectService(path.join(dir, 'profile'), '');
  standIn(service);
  snap = await service.open(file);
  assert.equal(snap.pictures[a].use, 'cpu', 'Picture events survive reopening');
  for (const [i, word] of words.entries())
    assert.deepEqual(await service.splitSnap(project, b, word), decoded[i], `Snap at ${word}`);
  assert.equal(decoded[0]?.time, 4, 'The snap after the 1 s black ends at 4 s');
  results.snaps = decoded.map((d) => d?.time ?? null);
  // Removing the recording removes its events.
  await service.removeRecording(project, batch, b);
  assert.equal(service.store.pictureEvents(b), null);
  console.log(JSON.stringify({ status: 'passed', ...results }, null, 2));
} finally {
  await service.close();
}
