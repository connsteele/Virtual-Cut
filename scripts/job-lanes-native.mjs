import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { require, withWholeClips } from './shared.mjs';
import { testPath } from './test-paths.mjs';
const { ProjectService } = require('../dist-electron/project-service.cjs');

// VC-145: transcription runs in its own lane. While one runs, an import's inspection and an
// export start at once; media work for the recording being transcribed waits for it; cancel,
// pause, retry and restart recovery work in each lane. The speech worker is a held stand-in
// (real recognition is measured by job-lanes-study.mjs); inspection, audio and export are real.
await mkdir(testPath('job-lanes'), { recursive: true });
const dir = await mkdtemp(path.join(testPath('job-lanes'), 'run-'));
const ffmpeg = process.env.VIRTUAL_CUT_FFMPEG || 'ffmpeg';
const make = (file, color) =>
  new Promise((resolve, reject) => {
    const p = spawn(
      ffmpeg,
      [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        `color=c=${color}:size=640x360:rate=30`,
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=660:sample_rate=48000',
        '-map',
        '0:v',
        '-map',
        '1:a',
        '-map',
        '2:a',
        '-t',
        '12',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-g',
        '30',
        '-c:a',
        'aac',
        '-y',
        file,
      ],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let error = '';
    p.stderr.on('data', (d) => (error += d));
    p.on('error', reject);
    p.on('close', (code) => (code ? reject(Error(error)) : resolve()));
  });
const first = path.join(dir, 'first-session.mp4'),
  second = path.join(dir, 'second-session.mp4'),
  third = path.join(dir, 'third-session.mp4');
await Promise.all([make(first, '0x183c36'), make(second, '0x3c1836'), make(third, '0x36183c')]);

const file = path.join(dir, 'job-lanes.vcut'),
  cache = path.join(dir, 'cache'),
  destination = path.join(dir, 'outputs');
await mkdir(cache);
await mkdir(destination);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let service = new ProjectService(path.join(dir, 'profile'), '');
const jobs = () => service.store.jobs();
const find = (id) => jobs().find((j) => j.id === id);
const idle = async () => {
  for (const end = Date.now() + 60000; Date.now() < end; await sleep(50))
    if (!jobs().some((j) => ['queued', 'running'].includes(j.state))) return;
  throw Error('Jobs did not finish: ' + JSON.stringify(jobs()));
};
/** Milliseconds until the job leaves the queue (starts or has already finished). */
const startsWithin = async (pick, limit = 2000) => {
  const began = performance.now();
  for (const end = began + limit; performance.now() < end; await sleep(20)) {
    const job = pick();
    if (job && job.state !== 'queued') return Math.round(performance.now() - began);
  }
  throw Error(`Not started within ${limit} ms: ${JSON.stringify(pick())}`);
};
const until = async (test, what, limit = 30000) => {
  for (const end = Date.now() + limit; Date.now() < end; await sleep(25)) if (test()) return;
  throw Error(`Timed out waiting for ${what}: ${JSON.stringify(jobs())}`);
};

// Held stand-in for the speech worker: it runs until released or cancelled and records
// whether any inspection or audio preparation for its recording was queued or running.
const libraries = path.join(dir, 'libraries'),
  model = path.join(dir, 'model');
await mkdir(path.join(libraries, 'faster_whisper'), { recursive: true });
await mkdir(model);
await writeFile(path.join(model, 'model.bin'), 'fixture');
const holds = [],
  overlaps = [];
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
      const source = s.store.sources().find((x) => x.file === request.source);
      const busy = s.store
        .jobs()
        .filter(
          (j) =>
            j.sourceId === source.id &&
            ['inspect', 'audio'].includes(j.kind) &&
            ['queued', 'running'].includes(j.state),
        );
      if (busy.length) overlaps.push(busy.map((j) => `${j.kind}:${j.state}`));
      receive({
        type: 'info',
        device: 'cpu',
        language: 'en',
        engine: 'fixture',
        runtime: 'fixture',
      });
      const hold = {
        sourceId: source.id,
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
      };
      holds.push(hold);
      // Like the real runtime, a stop that came before the worker started still stops it.
      if (signal.aborted) reject(Error('cancelled'));
      signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true });
    });
};
standIn(service);
const results = {};
try {
  let snap = await service.open(file, { name: 'Job lanes', destination, cache });
  const project = snap.project.id,
    batch = snap.activeBatchId;
  await service.importFiles(project, batch, [first], { game: 1, mic: 2 });
  await idle();
  const a = service.store.data.model.recordings[0].id;
  const opts = { roles: ['mic'], language: 'en', vocabulary: false };

  // 1. A transcription runs in the speech lane.
  service.requestTranscription(project, a, batch, opts);
  const speech = () => jobs().find((j) => j.kind === 'transcribe' && j.sourceId === a);
  await until(() => holds.length === 1 && speech()?.state === 'running', 'the transcription');
  assert.equal(speech().origin, 'user', 'Transcribe from the window is user work');

  // 2. An import's inspection starts at once beside it.
  await service.importFiles(project, batch, [second], { game: 1, mic: 2 });
  const b = service.store.data.model.recordings.find((r) => r.id !== a).id;
  results.inspectStartMs = await startsWithin(() =>
    jobs().find((j) => j.kind === 'inspect' && j.sourceId === b),
  );
  assert.equal(jobs().find((j) => j.kind === 'inspect' && j.sourceId === b).origin, 'user');
  await until(
    () => !jobs().some((j) => j.sourceId === b && ['queued', 'running'].includes(j.state)),
    'the second recording to be ready',
  );
  assert.equal(speech().state, 'running', 'The transcription kept running');
  // Audio preparation the app queued by itself counts as background work.
  assert(jobs().some((j) => j.sourceId === b && j.kind === 'audio' && j.origin === 'background'));

  // 3. An export of the recording being transcribed starts at once and verifies.
  const before = structuredClone(service.store.data.model),
    after = withWholeClips(before),
    clip = after.clips.find((c) => c.rid === a);
  Object.assign(clip, { start: 2, end: 6, name: 'During transcription' });
  await service.save(project, before, after);
  const plan = await service.exportPlan(project, clip.id, 'mkv');
  await service.startExport(project, plan.id, path.join(destination, 'during.mkv'), true);
  results.exportStartMs = await startsWithin(() => find(plan.id));
  await until(() => ['succeeded', 'failed'].includes(find(plan.id).state), 'the export');
  assert.equal(service.store.exports().find((e) => e.plan.id === plan.id).state, 'verified');
  assert.equal(find(plan.id).origin, 'user');
  assert.equal(speech().state, 'running', 'The transcription kept running during the export');

  // 4. Media work that writes the transcribed recording waits for it; other work does not.
  const source = service.store.sources().find((x) => x.id === a);
  const micTrack = service.store.data.model.recordings.find((r) => r.id === a).micTrack;
  await rm(service.audioFile(source, micTrack));
  await service.prepareAudio(project, a);
  const held = () => jobs().find((j) => j.kind === 'audio' && j.sourceId === a);
  assert.equal(held().origin, 'user', 'Prepare audio is user work');
  await service.importFiles(project, batch, [third], { game: 1, mic: 2 });
  const c = service.store.data.model.recordings.find((r) => ![a, b].includes(r.id)).id;
  results.inspectBesideHeldMs = await startsWithin(() =>
    jobs().find((j) => j.kind === 'inspect' && j.sourceId === c),
  );
  await sleep(300);
  assert.equal(held().state, 'queued', 'Audio for the recording being transcribed waits');
  // A transcription of a recording whose audio is still being prepared waits too.
  holds[0].release();
  await until(() => speech().state === 'succeeded', 'the first transcription to finish');
  await until(() => held().state === 'succeeded', 'the held audio preparation');
  await idle();

  // 5. Cancel in one lane leaves the other lane running.
  service.requestTranscription(project, b, batch, opts);
  const retried = () => jobs().find((j) => j.kind === 'transcribe' && j.sourceId === b);
  await until(() => holds.length === 2, 'the second transcription');
  const plan2 = await service.exportPlan(project, clip.id, 'mkv');
  await service.startExport(project, plan2.id, path.join(destination, 'cancel-beside.mkv'), true);
  await until(() => find(plan2.id).state === 'running', 'the second export');
  await service.job(project, retried().id, 'cancel');
  assert.equal(retried().state, 'cancelled');
  await until(() => find(plan2.id).state === 'succeeded', 'the export after the cancel');

  // 6. Pause and resume a transcription while the media lane works.
  await service.job(project, retried().id, 'retry');
  assert.equal(retried().origin, 'user', 'Retry is user work');
  await until(() => holds.length === 3, 'the retried transcription');
  await service.pauseTranscription(project, retried().id);
  assert.equal(retried().state, 'interrupted');
  await service.job(project, retried().id, 'retry');
  await until(() => holds.length === 4, 'the resumed transcription');

  // 7. Restart recovery: both lanes running, then the app closes.
  const plan3 = await service.exportPlan(project, clip.id, 'mkv');
  await service.startExport(project, plan3.id, path.join(destination, 'restart.mkv'), true);
  await until(() => find(plan3.id).state === 'running', 'the export before closing');
  const runningIds = [retried().id, plan3.id];
  await service.close();
  service = new ProjectService(path.join(dir, 'profile'), '');
  standIn(service);
  snap = await service.open(file);
  for (const id of runningIds)
    assert.equal(
      snap.jobs.find((j) => j.id === id).state,
      'interrupted',
      'Both lanes recover as interrupted after a restart',
    );
  // History keeps every job from both lanes.
  for (const kind of ['inspect', 'audio', 'export', 'transcribe'])
    assert(
      snap.jobs.some((j) => j.kind === kind),
      `History keeps ${kind} jobs`,
    );
  assert.deepEqual(overlaps, [], 'No transcription started while its audio was prepared');
  console.log(JSON.stringify({ status: 'passed', ...results }, null, 2));
} finally {
  await service.close();
}
