import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import {
  applyTranscriptCommand,
  correctionId,
  cueCandidate,
  correctedText,
} from '../dist-electron/transcript-edits.js';
const require = createRequire(import.meta.url);
const { ProjectService } = require('../dist-electron/project-service.cjs');
const { ProjectStore } = require('../dist-electron/project-store.cjs');
const { PROJECT_VERSION } = require('../dist-electron/project-recovery.cjs');
const root =
  process.env.VIRTUAL_CUT_ASR_TEST_OUTPUT || 'G:/GPT/Work/virtual-cut/m3-native-validation';
await mkdir(root, { recursive: true });
const dir = await mkdtemp(path.join(root, 'run-'));
const mic = path.join(dir, 'mic.wav');
await copyFile(
  process.env.VIRTUAL_CUT_ASR_TEST_AUDIO ||
    'G:/GPT/Work/virtual-cut/dji-mic-20260929/microphone.wav',
  mic,
);
const source = path.join(dir, 'dji-two-tracks.mp4');
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
      '-i',
      mic,
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-map',
      '2:a',
      '-t',
      '60.576',
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
  p.on('exit', (c) => (c ? reject(Error(error)) : resolve()));
});
const cache = path.join(dir, 'cache');
await mkdir(cache);
const service = new ProjectService(path.join(dir, 'profile'), '');
const file = path.join(dir, 'M3 validation.vcut');
let snapshot = await service.open(file, { name: 'M3 speech validation', destination: dir, cache });
const id = snapshot.project.id,
  batch = snapshot.activeBatchId;
const wait = async () => {
  const until = Date.now() + 300000;
  while (Date.now() < until) {
    const p = await service.snapshot();
    if (!p.jobs.some((j) => ['queued', 'running'].includes(j.state))) return p;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error('Jobs did not finish within five minutes.');
};
try {
  await service.importFiles(id, batch, [source], { game: 1, mic: 2 });
  snapshot = await wait();
  assert.ok(
    snapshot.jobs.every((j) => j.state === 'succeeded'),
    JSON.stringify(snapshot.jobs),
  );
  const rid = snapshot.model.recordings[0].id;
  const options = { roles: ['mic'], language: 'en', vocabulary: false };
  service.requestTranscription(id, rid, batch, options);
  service.requestTranscription(id, rid, batch, options);
  snapshot = await wait();
  const jobs = snapshot.jobs.filter((j) => j.kind === 'transcribe');
  assert.equal(jobs.length, 1, 'Repeat clicks reuse the queued job.');
  assert.equal(jobs[0].state, 'succeeded', jobs[0].message);
  const store = service.store,
    transcript = store.transcripts.list(rid)[0];
  assert.equal(transcript.role, 'mic');
  assert.ok(transcript.wordCount > 20);
  const segments = [...store.transcripts.segments(transcript.id)];
  const first = segments[0];
  let model = store.data.model;
  const c = {
    projectId: id,
    sourceId: rid,
    transcriptId: transcript.id,
    segmentId: first.id,
    wordIndex: 0,
    text: ' Corrected',
    action: 'correct',
    expected: 'null',
  };
  const corrected = applyTranscriptCommand(model, transcript, first, c, () => crypto.randomUUID());
  store.save(model, corrected);
  assert.equal(
    store.transcripts.segment(transcript.id, first.id).text,
    first.text,
    'Raw text is immutable.',
  );
  assert.ok(correctedText(corrected, transcript.id, first).includes('Corrected'));
  assert.throws(
    () => applyTranscriptCommand(corrected, transcript, first, c, () => 'bad'),
    /changed elsewhere/,
  );
  assert.throws(
    () =>
      applyTranscriptCommand(model, transcript, first, { ...c, text: 'two words' }, () => 'bad'),
    /Edit phrase/,
  );
  store.history('undo');
  assert.equal(store.data.model.transcriptEdits?.length || 0, 0);
  store.history('redo');
  assert.equal(store.data.model.transcriptEdits[0].id, correctionId(transcript.id, first.id, 0));
  const cue = {
    ...first,
    id: 100,
    text: 'Mark: remember this moment',
    start: 2,
    end: 3,
    words: [{ text: 'Mark', start: 2, end: 2.2, probability: 0.9 }],
  };
  assert.equal(cueCandidate({ ...transcript, role: 'game' }, cue), null);
  assert.equal(cueCandidate(transcript, { ...cue, text: 'Mark is the character name' }), null);
  const cueCommand = {
    ...c,
    segmentId: 100,
    wordIndex: undefined,
    action: 'accept-cue',
    text: 'Keep this note',
  };
  model = store.data.model;
  store.save(
    model,
    applyTranscriptCommand(model, transcript, cue, cueCommand, () => crypto.randomUUID()),
  );
  assert.equal(store.data.model.markers[rid].at(-1).note, 'Keep this note');
  store.history('undo');
  assert.equal(store.data.model.markers[rid].length, model.markers[rid].length);
  await store.checkpoint('manual');
  await service.close();
  snapshot = await service.open(file);
  assert.equal(service.store.transcripts.get(transcript.id).wordCount, transcript.wordCount);
  assert.equal(service.store.data.model.transcriptEdits[0].text, ' Corrected');
  assert.equal(snapshot.canUndo, false);
  await service.close();
  const old = new ProjectStore(file);
  old.db.exec('PRAGMA user_version=3');
  old.close();
  snapshot = await service.open(file);
  assert.equal(service.store.db.prepare('PRAGMA user_version').get().user_version, PROJECT_VERSION);
  assert.ok((await service.store.snapshot()).saves !== undefined);
  await service.close();
  await writeFile(
    path.join(root, 'latest.json'),
    JSON.stringify(
      {
        dir,
        file,
        source,
        id,
        rid,
        transcriptId: transcript.id,
        words: transcript.wordCount,
        segments: segments.length,
        elapsedMs: transcript.elapsedMs,
      },
      null,
      2,
    ),
  );
  console.log(
    `Real import, local ASR, deduplication, immutable correction, Undo, persistence and migration passed: ${dir}`,
  );
} finally {
  await service.close();
}
