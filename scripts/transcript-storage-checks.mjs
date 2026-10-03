import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { require } from './shared.mjs';
const { ProjectService } = require('../dist-electron/project-service.cjs');
const base = path.join(
  process.env.VIRTUAL_CUT_TEST_ROOT || 'G:/GPT/Work/virtual-cut/m3-storage-validation',
  'transcripts',
);
await mkdir(base, { recursive: true });
const dir = await mkdtemp(path.join(base, 'run-'));
const source = path.join(dir, 'synthetic-speech-container.mp4'),
  cache = path.join(dir, 'cache');
await mkdir(cache);
await new Promise((resolve, reject) => {
  const p = spawn(
    process.env.VIRTUAL_CUT_FFMPEG || 'ffmpeg',
    [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x183c36:size=640x360:rate=30',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=48000:cl=stereo',
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-map',
      '1:a',
      '-t',
      '15',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-c:a',
      'aac',
      '-y',
      source,
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let error = '';
  p.stderr.on('data', (d) => (error += d));
  p.on('error', reject);
  p.on('close', (code) => (code ? reject(Error(error)) : resolve()));
});
const file = path.join(dir, 'transcript-storage.vcut'),
  service = new ProjectService(path.join(dir, 'profile'), '');
const wait = async () => {
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    const s = await service.snapshot();
    if (!s.jobs.some((j) => ['queued', 'running'].includes(j.state))) return s;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('Queue timed out');
};
try {
  let snap = await service.open(file, { name: 'Synthetic transcript QA', destination: dir, cache });
  const id = snap.project.id,
    batch = snap.activeBatchId;
  assert.equal(service.transcriptSession().sourceId, '');
  await service.importFiles(id, batch, [source], { game: 1, mic: 2 });
  snap = await wait();
  assert.equal(
    snap.jobs.filter((j) => j.kind === 'transcribe').length,
    0,
    'Import without opt-in never starts ASR.',
  );
  const rid = snap.model.recordings[0].id;
  assert.throws(
    () =>
      service.requestTranscription(id, rid, batch, {
        roles: ['mic'],
        language: 'en',
        vocabulary: false,
      }),
    /runtime/,
  );
  // Deterministic worker boundary for persistence/lifecycle tests; real recognition is measured separately.
  const libraries = path.join(dir, 'libraries'),
    model = path.join(dir, 'model');
  await mkdir(path.join(libraries, 'faster_whisper'), { recursive: true });
  await mkdir(model);
  await writeFile(path.join(model, 'model.bin'), 'fixture');
  service.transcription.settings = {
    python: process.execPath,
    libraries,
    model,
    device: 'cpu',
    threads: 4,
  };
  let aborted = false,
    shouldPause = true,
    frozenVocabulary = '';
  service.transcription.run = async (request, signal, receive) => {
    frozenVocabulary = request.vocabulary;
    if (shouldPause)
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 10000);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            aborted = true;
            reject(Error('cancelled'));
          },
          { once: true },
        );
      });
    signal.throwIfAborted();
    receive({
      type: 'info',
      device: 'cpu',
      message: 'GPU unavailable in synthetic fixture',
      language: 'en',
      duration: 15,
      engine: 'fixture',
      runtime: 'fixture',
    });
    receive({
      type: 'segment',
      segment: {
        id: 0,
        start: 1,
        end: 8,
        text: 'This sample has several timed words for review.',
        words: 'This sample has several timed words for review.'.split(' ').map((text, i) => ({
          text: (i ? ' ' : '') + text,
          start: 1 + i * 0.8,
          end: 1.7 + i * 0.8,
          probability: 0.9,
        })),
        noSpeechProbability: 0,
        averageLogProbability: -0.1,
      },
    });
    receive({
      type: 'segment',
      segment: {
        id: 1,
        start: 9,
        end: 11,
        text: 'Note remember this.',
        words: [
          { text: 'Note', start: 9, end: 9.4, probability: 0.9 },
          { text: ' remember', start: 9.5, end: 10, probability: 0.9 },
          { text: ' this.', start: 10, end: 11, probability: 0.9 },
        ],
        noSpeechProbability: 0,
        averageLogProbability: -0.1,
      },
    });
    receive({ type: 'complete', peakMemoryBytes: 0 });
  };
  const opts = { roles: ['mic'], language: 'en', vocabulary: false };
  service.requestTranscription(id, rid, batch, opts);
  const job = service.store.jobs().find((j) => j.kind === 'transcribe');
  while (service.store.jobs().find((j) => j.id === job.id).state !== 'running')
    await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 100));
  await service.pauseTranscription(id, job.id);
  assert.equal(aborted, true);
  assert.equal(service.store.jobs().find((j) => j.id === job.id).state, 'interrupted');
  shouldPause = false;
  await service.job(id, job.id, 'retry');
  await wait();
  const transcript = service.store.transcripts.get(job.id);
  assert.equal(transcript.state, 'complete');
  assert.equal(transcript.wordCount, 11);
  assert.equal(transcript.device, 'cpu');
  const finishedJob = service.store.jobs().find((j) => j.id === job.id);
  assert.equal(finishedJob.device, 'cpu');
  assert.equal(finishedJob.deviceMessage, 'GPU unavailable in synthetic fixture');
  assert.equal(
    service.transcriptSession(rid).jobs.find((j) => j.id === job.id).deviceMessage,
    finishedJob.deviceMessage,
  );
  const { TranscriptionRuntime } = require('../dist-electron/transcription-runtime.cjs');
  const readiness = new TranscriptionRuntime(path.join(dir, 'readiness'));
  readiness.settings = { ...service.transcription.settings };
  let checks = 0,
    release;
  readiness.execute = async (_config, _signal, receive) => {
    checks++;
    await new Promise((resolve) => {
      release = resolve;
    });
    receive({ type: 'gpu', available: checks > 1, message: checks > 1 ? 'Ready' : 'Unavailable' });
  };
  const firstCheck = readiness.inspectGpu(),
    concurrentCheck = readiness.inspectGpu(true);
  assert.equal(firstCheck, concurrentCheck, 'Concurrent checks reuse the in-flight probe');
  assert.equal(checks, 1);
  release();
  assert.equal((await firstCheck).available, false);
  assert.equal((await readiness.inspectGpu()).available, false);
  assert.equal(checks, 1, 'Opening another view reuses the completed readiness result');
  const recheck = readiness.inspectGpu(true);
  assert.equal(checks, 2);
  release();
  assert.equal((await recheck).available, true);
  assert.equal(frozenVocabulary, '');
  assert.equal(
    service.store.transcripts.segment(job.id, 1).start,
    9,
    'Silence offset survives storage.',
  );
  service.requestTranscription(id, rid, batch, opts);
  await wait();
  assert.equal(service.store.jobs().filter((j) => j.kind === 'transcribe').length, 1);
  await assert.rejects(
    service.job(id, job.id, 'retry'),
    /unavailable/,
    'Completed originals cannot be overwritten by Retry.',
  );
  await service.store.checkpoint('manual');
  const save = (await service.store.snapshot()).saves.find((s) => s.kind === 'manual');
  service.store.transcripts.removeSource(rid);
  assert.equal(service.store.transcripts.list().length, 0);
  await service.store.restore(save.id);
  assert.equal(service.store.transcripts.get(job.id).wordCount, 11);
  assert.equal(service.store.transcripts.segment(job.id, 1).text, 'Note remember this.');
  await service.store.restore(save.id);
  assert.equal(
    [...service.store.transcripts.segments(job.id)].length,
    2,
    'Restoring an existing transcript never duplicates segments',
  );
  const exportPlan = await service.exportPlan(id, service.store.data.model.clips[0].id, 'mp4');
  await service.startExport(id, exportPlan.id, path.join(dir, 'completed.mp4'), true);
  await wait();
  const completed = service.transcriptSession(rid).outputs[0];
  assert.equal(
    completed.id,
    exportPlan.id,
    'Transcript scope exposes only verified completed outputs',
  );
  assert(completed.end > completed.start);
  const beforeContext = service.store.data.model;
  service.store.save(beforeContext, {
    ...beforeContext,
    contexts: [
      {
        id: 'project',
        gameMode: 'set',
        briefMode: 'replace',
        game: { id: 'game-one', name: 'First game', vocabulary: 'Cai' },
        brief: 'First brief',
      },
    ],
  });
  service.requestTranscription(id, rid, batch, { ...opts, vocabulary: true });
  const frozenJob = service.store.jobs().find((j) => j.kind === 'transcribe' && j.id !== job.id);
  const beforeSwitch = service.store.data.model;
  service.store.save(beforeSwitch, {
    ...beforeSwitch,
    contexts: [
      {
        ...beforeSwitch.contexts[0],
        game: { id: 'game-two', name: 'Second game', vocabulary: 'Different name' },
      },
    ],
  });
  await wait();
  assert.equal(service.store.transcripts.get(frozenJob.id).context.gameId, 'game-one');
  assert.equal(frozenVocabulary, 'Cai', 'Queued jobs retain the context approved when requested');
  assert.throws(() => service.requestTranscription(id, rid, 'other-batch', opts), /batch/);
  const currentRecord = service.store.data.model.recordings[0];
  const micTrack = currentRecord.micTrack;
  currentRecord.micTrack = undefined;
  assert.throws(() => service.requestTranscription(id, rid, batch, opts), /microphone/);
  currentRecord.micTrack = micTrack;
  currentRecord.gameTrack = undefined;
  assert.throws(
    () => service.requestTranscription(id, rid, batch, { ...opts, roles: ['game'] }),
    /game audio/,
  );
  currentRecord.gameTrack = 1;
  await assert.rejects(service.pauseTranscription(id, job.id), /active transcription/);
  service.transcription.run = async () => {
    throw Error('Injected decoder failure');
  };
  service.requestTranscription(id, rid, batch, { ...opts, language: 'fr' });
  await wait();
  assert(service.store.jobs().some((j) => j.kind === 'transcribe' && j.state === 'failed'));
  assert(service.store.transcripts.list().some((t) => t.state === 'failed'));
  const native = service.store.sources()[0],
    interruptedId = crypto.randomUUID();
  service.store.putJob({ ...job, id: interruptedId, state: 'running' });
  service.store.transcripts.put({ ...transcript, id: interruptedId, state: 'running' });
  const owned = path.join(
    service.store.data.project.cache,
    `${native.id}-${native.fingerprint}-asr-${interruptedId}.partial.wav`,
  );
  const unrelated = path.join(service.store.data.project.cache, 'keep-this.wav');
  await writeFile(owned, 'abandoned PCM');
  await writeFile(unrelated, 'user data');
  await service.close();
  snap = await service.open(file);
  assert.equal(service.store.jobs().find((j) => j.id === interruptedId).state, 'interrupted');
  assert.equal(service.store.transcripts.get(interruptedId).state, 'interrupted');
  await assert.rejects(stat(owned), { code: 'ENOENT' });
  assert.equal(await readFile(unrelated, 'utf8'), 'user data');
  assert.equal(service.store.transcripts.get(job.id).wordCount, 11);
  assert.equal(snap.canUndo, false);
  await service.close();
  assert.equal(service.transcriptSession(), null);
  await writeFile(
    path.join(base, 'latest.json'),
    JSON.stringify({ dir, file, source, id, rid, transcriptId: job.id, synthetic: true }, null, 2),
  );
  console.log(
    `Transcript pause/resume, opt-out, deduplication, checkpoint recovery, interrupted PCM cleanup and reopen passed: ${dir}`,
  );
} finally {
  await service.close();
}
