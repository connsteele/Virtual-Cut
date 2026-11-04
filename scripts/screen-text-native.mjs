import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { require, root } from './shared.mjs';
import { testPath } from './test-paths.mjs';
const { ProjectService } = require('../dist-electron/project-service.cjs');
const { readKeyframes } = require('../dist-electron/screen-text-pass.cjs');
const {
  screenTextLayout,
  SCREEN_TEXT_MODELS,
} = require('../dist-electron/screen-text-runtime.cjs');
const { keyframeArgs, readSize } = await import('../dist-electron/screen-text.js');

// VC-141: the background screen text pass. It waits for the recording's picture pass, reads one
// keyframe a second through the real worker, its guard and FFmpeg, skips keyframes inside a
// still picture, joins the same text in the same place, pauses while a preview plays and
// carries on after the last keyframe, stores lines once per fingerprint outside the model, and
// leaves nothing running when the app goes away. Without the engine nothing is queued. The OCR
// itself is a stand-in (scripts/screen-text-stub) so this runs on any PC with Python.
delete process.env.VIRTUAL_CUT_PICTURE_PASS;
process.env.VIRTUAL_CUT_PICTURE_GPU = '0';
await mkdir(testPath('screen-text'), { recursive: true });
const dir = await mkdtemp(path.join(testPath('screen-text'), 'run-'));
const ffmpeg = process.env.VIRTUAL_CUT_FFMPEG || 'ffmpeg';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tool = (args) =>
  new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-v', 'error', ...args], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let error = '';
    p.stderr.on('data', (d) => (error += d));
    p.on('error', reject);
    p.on('close', (code) => (code ? reject(Error(error)) : resolve()));
  });

// A stand-in engine: this PC's Python (linked as the engine's python folder) and the stub OCR.
const system =
  process.env.VIRTUAL_CUT_STUB_PYTHON ||
  spawnSync('python', ['-c', 'import sys; print(sys.executable)'], {
    encoding: 'utf8',
  }).stdout?.trim();
assert(system, 'Python 3 is needed on PATH (or VIRTUAL_CUT_STUB_PYTHON) for this check.');
const engine = path.join(dir, 'engine'),
  layout = screenTextLayout(engine);
await mkdir(engine, { recursive: true });
await symlink(path.dirname(system), path.join(engine, 'python'), 'junction');
await cp(path.join(root, 'scripts', 'screen-text-stub'), layout.libraries, { recursive: true });
await mkdir(path.join(layout.libraries, 'rapidocr', 'models'), { recursive: true });
for (const name of SCREEN_TEXT_MODELS)
  await writeFile(path.join(layout.libraries, 'rapidocr', 'models', name), 'stub');
process.env.VIRTUAL_CUT_OCR_RUNTIME = engine;

// 20 s at 30 fps, a keyframe every second: moving picture, a 6 s frozen frame, black, moving.
const clip = path.join(dir, 'screen-text.mp4');
await tool([
  ...['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30'],
  ...['-f', 'lavfi', '-i', 'color=c=black:size=1280x720:rate=30'],
  ...['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000'],
  '-filter_complex',
  [
    '[0:v]trim=duration=6[a]',
    '[0:v]trim=start=6:duration=0.0334,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=6[b]',
    '[1:v]trim=duration=2[c]',
    '[0:v]trim=start=14:duration=6,setpts=PTS-STARTPTS[d]',
    '[a][b][c][d]concat=n=4:v=1:a=0,format=yuv420p[v]',
  ].join(';'),
  ...['-map', '[v]', '-map', '2:a', '-map', '2:a', '-t', '20'],
  ...['-c:v', 'libx264', '-preset', 'ultrafast', '-g', '30', '-keyint_min', '30'],
  ...['-sc_threshold', '0', '-c:a', 'aac', '-y', clip],
]);
const results = {};

// The worker and its guard: frames in time order, unchanged spans skipped, and a parent that
// dies takes the reader and FFmpeg with it.
{
  const size = readSize(1280, 720);
  const frames = [];
  const result = await readKeyframes(
    layout,
    {
      ffmpeg,
      args: keyframeArgs({ file: clip, offset: 0, from: 0, size, sourceHeight: 720 }),
      ...size,
      same: [[7, 11]],
    },
    (f) => frames.push(f),
    new AbortController().signal,
  );
  assert.equal(result.frames, 20);
  assert.equal(frames.length, 20);
  assert.deepEqual(
    frames.map((f) => f.time),
    Array.from({ length: 20 }, (_, i) => i),
  );
  // 7 is read (the last frame read before it is outside the span); 8 to 11 are not.
  assert.deepEqual(
    frames.filter((f) => f.same).map((f) => f.time),
    [8, 9, 10, 11],
  );
  assert.equal(result.read, 16);
  assert.equal(result.gpu, false);
  assert.deepEqual(frames[0].lines[0], { text: 'Score 100', box: [20, 20, 160, 48], score: 0.98 });
  results.worker = { frames: result.frames, read: result.read };

  // Resuming after a keyframe starts there.
  const later = [];
  await readKeyframes(
    layout,
    {
      ffmpeg,
      args: keyframeArgs({ file: clip, offset: 0, from: 15, size, sourceHeight: 720 }),
      ...size,
      same: [],
      after: 15,
    },
    (f) => later.push(f.time),
    new AbortController().signal,
  );
  assert.deepEqual(later, [16, 17, 18, 19]);

  // Abort ends the guard, the reader and FFmpeg.
  process.env.VIRTUAL_CUT_STUB_OCR_MS = '400';
  const controller = new AbortController();
  let pids;
  const aborted = readKeyframes(
    layout,
    {
      ffmpeg,
      args: keyframeArgs({ file: clip, offset: 0, from: 0, size, sourceHeight: 720 }),
      ...size,
      same: [],
    },
    () => controller.abort(new Error('stop')),
    controller.signal,
    (p) => (pids = p),
  );
  await assert.rejects(aborted, /stop/);
  assert(pids?.worker && pids.guard, 'The guard reports the reader it started');
  await gone([pids.worker, pids.guard], 'the reader after abort');

  // A parent that is killed outright: the job object ends the reader.
  const parent = spawn(
    process.execPath,
    [
      '-e',
      `const {readKeyframes}=require(${JSON.stringify(path.join(root, 'dist-electron', 'screen-text-pass.cjs'))});
readKeyframes(${JSON.stringify(layout)}, ${JSON.stringify({
        ffmpeg,
        args: keyframeArgs({ file: clip, offset: 0, from: 0, size, sourceHeight: 720 }),
        ...size,
        same: [],
      })}, () => {}, new AbortController().signal, (p) => console.log(JSON.stringify(p)));`,
    ],
    { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true },
  );
  const started = await new Promise((resolve, reject) => {
    parent.stdout.once('data', (d) => resolve(JSON.parse(String(d))));
    parent.once('close', () => reject(Error('The parent stopped first.')));
  });
  await sleep(500);
  parent.kill('SIGKILL');
  await gone([started.worker, started.guard], 'the reader after its parent was killed');
  results.guard = 'reader and guard ended with abort and with a killed parent';
  delete process.env.VIRTUAL_CUT_STUB_OCR_MS;
}

const file = path.join(dir, 'screen-text.vcut'),
  cache = path.join(dir, 'cache'),
  destination = path.join(dir, 'outputs');
await mkdir(cache);
await mkdir(destination);
let service = new ProjectService(path.join(dir, 'profile'), '');
const jobs = () => service.store.jobs();
const find = (kind, sourceId) => jobs().find((j) => j.kind === kind && j.sourceId === sourceId);
const until = async (test, what, limit = 30000) => {
  for (const end = Date.now() + limit; Date.now() < end; await sleep(25)) if (test()) return;
  throw Error(`Timed out waiting for ${what}: ${JSON.stringify(jobs())}`);
};
service.idleSeconds = () => 600;
try {
  let snap = await service.open(file, { name: 'Screen text', destination, cache });
  const project = snap.project.id,
    batch = snap.activeBatchId;
  assert.equal(snap.screenTextEngine, '');
  // The import queues the picture pass and then screen text, which waits for it.
  process.env.VIRTUAL_CUT_STUB_OCR_MS = '150';
  await service.importFiles(project, batch, [clip], { game: 1, mic: 2 });
  const a = service.store.data.model.recordings[0].id;
  await until(() => find('text', a), 'screen text to queue');
  assert.equal(find('text', a).origin, 'background');
  await until(
    () => find('text', a).message === 'Waiting for this recording’s picture events',
    'the wait for picture events',
  );
  await until(() => find('visual', a).state === 'succeeded', 'the picture pass', 60000);
  await until(
    () => find('text', a).state === 'running' && find('text', a).progress > 0.2,
    'screen text to read',
  );
  // A preview playing pauses it; it keeps the lines it read and carries on after them.
  service.previewPlaying(true);
  await until(() => find('text', a).state === 'queued', 'the pause for playback', 5000);
  assert.equal(find('text', a).message, 'Paused: preview playing');
  const pausedAt = find('text', a).progress;
  assert(pausedAt > 0.2 && pausedAt < 1, `It kept its progress (${pausedAt})`);
  service.previewPlaying(false);
  await until(() => find('text', a).state === 'succeeded', 'screen text to finish');
  delete process.env.VIRTUAL_CUT_STUB_OCR_MS;
  const stored = service.store.screenText(a);
  assert.equal(stored.version, 1);
  assert.deepEqual([stored.width, stored.height], [1280, 720]);
  assert.equal(stored.keyframes, 20, 'Every keyframe counted once across the pause');
  assert(stored.read < 20, `Keyframes in the still picture are not read (${stored.read} read)`);
  const score = stored.lines.filter((l) => l.text === 'Score 100');
  assert.equal(score.length, 1, 'A line on every keyframe is one line');
  assert.deepEqual([score[0].first, score[0].last, score[0].seen], [0, 19, 20]);
  assert(
    stored.lines.some((l) => /^Brightness 0$/.test(l.text)),
    'The black reads as its own line',
  );
  for (const l of stored.lines)
    assert.deepEqual(Object.keys(l).sort(), ['box', 'first', 'last', 'score', 'seen', 'text']);
  assert.match(
    find('text', a).message,
    /^Screen text ready · \d+ lines from 20 keyframes \(\d+ unchanged\) · read on the CPU$/,
  );
  snap = await service.snapshot();
  assert.deepEqual(snap.screenText[a], {
    lines: stored.lines.length,
    keyframes: 20,
    read: stored.read,
    gpu: false,
    elapsedMs: stored.elapsedMs,
  });
  assert(!JSON.stringify(service.store.data.model).includes('Score 100'), 'Outside the model');
  results.pass = { lines: stored.lines.length, read: stored.read, pausedAt };
  // Analyse picture now with both stored queues nothing more.
  await service.analysePicture(project, [a]);
  assert.equal(jobs().filter((j) => j.kind === 'text').length, 1);
  // Cancel and retry a running pass.
  process.env.VIRTUAL_CUT_STUB_OCR_MS = '300';
  const second = path.join(dir, 'second.mp4');
  await tool(['-i', clip, '-c', 'copy', '-map', '0', '-y', second]);
  await service.importFiles(project, batch, [second], { game: 1, mic: 2 });
  const b = service.store.data.model.recordings.find((r) => r.id !== a).id;
  await until(() => find('text', b)?.state === 'running', 'the second recording to read', 60000);
  await service.job(project, find('text', b).id, 'cancel');
  assert.equal(find('text', b).state, 'cancelled');
  await service.job(project, find('text', b).id, 'retry');
  await until(() => find('text', b)?.state === 'running', 'the retried pass');
  // Closing while it reads: it waits again when the project reopens.
  await service.close();
  service = new ProjectService(path.join(dir, 'profile'), '');
  service.idleSeconds = () => 600;
  service.previewPlaying(true);
  snap = await service.open(file);
  assert.equal(find('text', b).state, 'queued', 'A pass running at close waits again');
  await until(() => find('text', b).message === 'Paused: preview playing', 'its wait on reopen');
  service.previewPlaying(false);
  await until(() => find('text', b).state === 'succeeded', 'the pass after reopening', 60000);
  delete process.env.VIRTUAL_CUT_STUB_OCR_MS;
  // Removing a recording removes its screen text.
  await service.removeRecording(project, batch, b);
  assert.equal(service.store.screenText(b), null);
  await service.close();

  // Without the engine: nothing is queued, and the snapshot says why.
  delete process.env.VIRTUAL_CUT_OCR_RUNTIME;
  service = new ProjectService(path.join(dir, 'profile-without'), path.join(dir, 'no-tools'));
  service.idleSeconds = () => 600;
  snap = await service.open(file);
  assert.equal(snap.screenTextEngine, 'Screen text engine not installed.');
  const third = path.join(dir, 'third.mp4');
  await tool(['-i', clip, '-c', 'copy', '-map', '0', '-y', third]);
  await service.importFiles(project, batch, [third], { game: 1, mic: 2 });
  const c = service.store.data.model.recordings.find((r) => r.id !== a).id;
  await until(() => find('visual', c)?.state === 'succeeded', 'the third picture pass', 60000);
  await sleep(300);
  assert.equal(find('text', c), undefined, 'No screen text job without the engine');
  await service.analysePicture(project, [c]);
  assert.equal(find('text', c), undefined);
  // A job queued before the engine went missing fails with the reason.
  service.store.putJob({
    id: 'text-missing',
    sourceId: c,
    kind: 'text',
    origin: 'user',
    state: 'queued',
    progress: 0,
    message: 'Waiting',
    updated: new Date().toISOString(),
  });
  service.previewPlaying(true);
  service.previewPlaying(false);
  await until(() => find('text', c)?.state === 'failed', 'the pass without its engine');
  assert.equal(find('text', c).message, 'Screen text engine not installed.');
  results.missing = snap.screenTextEngine;
  console.log(JSON.stringify({ status: 'passed', ...results }, null, 2));
} finally {
  await service.close();
}

async function gone(pids, what) {
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  for (const end = Date.now() + 10000; Date.now() < end; await sleep(50))
    if (!pids.some(alive)) return;
  throw Error(`Still running: ${what} (${pids.filter(alive).join(', ')})`);
}
