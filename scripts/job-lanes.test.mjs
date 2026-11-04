import assert from 'node:assert/strict';
import test from 'node:test';
import {
  heldBy,
  isUserJob,
  jobLanes,
  laneOf,
  nextJob,
  pictureHold,
  pictureUse,
  pictureYields,
  rank,
  readyJobs,
} from '../dist-electron/job-lanes.js';

// VC-145: a speech lane and a media lane, user work first in each, and a per-recording lock
// so two jobs never write the same recording's files at once.
let n = 0;
const job = (kind, sourceId, extra = {}) => ({
  id: `${kind}-${++n}`,
  sourceId,
  kind,
  state: 'queued',
  progress: 0,
  message: '',
  updated: '',
  ...extra,
});
const ids = (jobs) => jobs.map((j) => j?.id);

test('transcription runs in the speech lane and everything else in the media lane', () => {
  assert.deepEqual(jobLanes, ['speech', 'media']);
  assert.equal(laneOf('transcribe'), 'speech');
  for (const kind of ['inspect', 'audio', 'export', 'visual']) assert.equal(laneOf(kind), 'media');
});

test('a running transcription does not hold up an import, an inspection or an export', () => {
  const transcribing = job('transcribe', 'a', { state: 'running' });
  const inspect = job('inspect', 'b', { origin: 'user' });
  const exporting = job('export', 'a', { origin: 'user' });
  for (const queued of [inspect, exporting]) {
    const jobs = [transcribing, queued];
    assert.equal(nextJob('media', jobs, [transcribing]), queued);
    assert.equal(nextJob('speech', jobs, [transcribing]), undefined);
  }
});

test('each lane runs one job at a time', () => {
  const running = job('export', 'a', { state: 'running' });
  const queued = job('inspect', 'b');
  assert.equal(nextJob('media', [running, queued], [running]), undefined);
  const speaking = job('transcribe', 'c', { state: 'running' });
  const waiting = job('transcribe', 'd');
  assert.equal(nextJob('speech', [speaking, waiting], [speaking]), undefined);
  assert.equal(nextJob('speech', [waiting], []), waiting);
});

test('user-started work goes ahead of background work, oldest first within each', () => {
  const auto1 = job('audio', 'a', { origin: 'background', track: 0 });
  const auto2 = job('audio', 'b', { origin: 'background', track: 0 });
  const user1 = job('export', 'c', { origin: 'user' });
  const user2 = job('inspect', 'd', { origin: 'user' });
  const media = [auto1, auto2, user1, user2];
  assert.equal(nextJob('media', media, []), user1);
  assert.equal(nextJob('media', [auto1, auto2, user2], []), user2);
  assert.equal(nextJob('media', [auto1, auto2], []), auto1);
  // Jobs saved before VC-145 have no origin; they count as user work, as before.
  const legacy = job('inspect', 'e');
  assert.equal(isUserJob(legacy), true);
  assert.equal(nextJob('media', [auto1, legacy], []), legacy);
  const importDefault = job('transcribe', 'f', { origin: 'background' });
  const clicked = job('transcribe', 'g', { origin: 'user' });
  assert.equal(nextJob('speech', [importDefault, clicked], []), clicked);
});

test('a transcription waits for its own recording’s inspection and audio preparation', () => {
  const audio = job('audio', 'a', { origin: 'background', track: 1 });
  const transcribe = job('transcribe', 'a', { origin: 'user' });
  const other = job('transcribe', 'b', { origin: 'background' });
  // Queued audio work for the same recording holds the transcription, even behind an export.
  const exporting = job('export', 'z', { state: 'running' });
  const jobs = [exporting, audio, transcribe, other];
  assert.equal(heldBy(transcribe, jobs, [exporting]), audio);
  assert.equal(nextJob('speech', jobs, [exporting]), other);
  // Running audio work too.
  const preparing = { ...audio, state: 'running' };
  assert.equal(nextJob('speech', [preparing, transcribe], [preparing]), undefined);
  // Finished or failed preparation no longer holds it.
  for (const state of ['succeeded', 'failed', 'cancelled', 'interrupted'])
    assert.equal(nextJob('speech', [{ ...audio, state }, transcribe], []), transcribe);
  const inspecting = job('inspect', 'a', { state: 'running' });
  assert.equal(heldBy(transcribe, [inspecting, transcribe], [inspecting]), inspecting);
});

test('media work never writes a recording while its transcription is running', () => {
  const transcribing = job('transcribe', 'a', { state: 'running' });
  const audio = job('audio', 'a', { origin: 'user', track: 0 });
  const inspect = job('inspect', 'a', { origin: 'user' });
  const otherAudio = job('audio', 'b', { origin: 'background', track: 0 });
  const exporting = job('export', 'a', { origin: 'background' });
  const jobs = [transcribing, audio, inspect, otherAudio, exporting];
  // The held user jobs are skipped; the next free one starts instead of blocking the lane.
  assert.equal(heldBy(audio, jobs, [transcribing]), transcribing);
  assert.equal(heldBy(inspect, jobs, [transcribing]), transcribing);
  assert.equal(heldBy(exporting, jobs, [transcribing]), undefined);
  assert.equal(nextJob('media', jobs, [transcribing]), otherAudio);
  assert.deepEqual(
    ids(jobs.filter((j) => j.state === 'queued' && !heldBy(j, jobs, [transcribing]))),
    ids([otherAudio, exporting]),
  );
  // Once the transcription ends, the user's audio preparation goes first.
  const done = { ...transcribing, state: 'succeeded' };
  assert.equal(nextJob('media', [done, audio, inspect, otherAudio, exporting], []), audio);
});

test('no deadlock between a queued transcription and its queued preparation', () => {
  const audio = job('audio', 'a', { origin: 'background', track: 0 });
  const transcribe = job('transcribe', 'a', { origin: 'user' });
  const jobs = [transcribe, audio];
  assert.equal(nextJob('speech', jobs, []), undefined);
  assert.equal(nextJob('media', jobs, []), audio);
});

// VC-180: the picture pass is background work in the media lane with its own pause rules.
const working = { previewPlaying: false, idle: false, gpu: () => true };
const idlePc = { previewPlaying: false, idle: true, gpu: () => true };

test('a picture pass you ask for goes ahead of background work, behind work you started', () => {
  const asked = job('visual', 'a', { origin: 'user' });
  const auto = job('visual', 'b', { origin: 'background' });
  const audio = job('audio', 'c', { origin: 'background', track: 1 });
  const exporting = job('export', 'd', { origin: 'user' });
  assert.deepEqual([exporting, asked, audio, auto].map(rank), [0, 1, 2, 3]);
  assert.deepEqual(ids(readyJobs('media', [auto, audio, asked, exporting], [], working)), [
    exporting.id,
    asked.id,
    audio.id,
    auto.id,
  ]);
  assert.equal(nextJob('media', [auto, audio], [], working), audio);
  assert.equal(nextJob('speech', [auto], [], working), undefined);
});

test('a picture pass waits for its recording, transcriptions and preview playback', () => {
  const pass = job('visual', 'a', { origin: 'background' });
  const transcript = job('transcribe', 'a', { origin: 'background' });
  const inspect = job('inspect', 'a', { state: 'running' });
  assert.equal(
    pictureHold(pass, [pass, transcript], [], working),
    'Waiting for this recording’s transcript',
  );
  assert.equal(
    pictureHold(pass, [pass, inspect], [inspect], working),
    'Waiting for this recording’s inspection',
  );
  assert.equal(nextJob('media', [pass, transcript], [], working), undefined);
  const other = job('transcribe', 'b', { state: 'running' });
  assert.equal(pictureHold(pass, [pass, other], [other], working), 'Paused: transcription running');
  assert.equal(
    pictureHold(pass, [pass], [], { ...working, previewPlaying: true }),
    'Paused: preview playing',
  );
  // With no NVIDIA decoder it only runs when the PC is idle.
  const noGpu = { ...working, gpu: () => false };
  assert.match(pictureHold(pass, [pass], [], noGpu), /idle/);
  assert.equal(pictureHold(pass, [pass], [], { ...noGpu, idle: true }), undefined);
  // A decoder not tried yet counts as there, so the pass can start and try it.
  assert.equal(pictureHold(pass, [pass], [], { ...working, gpu: () => undefined }), undefined);
  assert.equal(pictureHold(pass, [pass], [], working), undefined);
  // An export of the same recording doesn't hold it up.
  const exporting = job('export', 'a', { state: 'succeeded' });
  assert.equal(pictureHold(pass, [pass, exporting], [], working), undefined);
});

test('NVDEC alone while you work, NVDEC and CPU when idle, CPU alone only when idle', () => {
  const pass = job('visual', 'a');
  assert.equal(pictureUse(pass, working), 'gpu');
  assert.equal(pictureUse(pass, idlePc), 'gpu+cpu');
  assert.equal(pictureUse(pass, { ...idlePc, gpu: () => false }), 'cpu');
  assert.equal(pictureUse(pass, { ...working, gpu: () => false }), undefined);
  assert.equal(pictureUse(pass, { previewPlaying: false, idle: false }), 'gpu');
});

test('a running picture pass gives way to its holds and to work ranked ahead of it', () => {
  const pass = job('visual', 'a', { state: 'running', origin: 'background' });
  assert.equal(pictureYields(pass, [pass], [pass], working), undefined);
  const speaking = job('transcribe', 'b', { state: 'running' });
  assert.equal(
    pictureYields(pass, [pass, speaking], [pass, speaking], working),
    'Paused: transcription running',
  );
  assert.equal(
    pictureYields(pass, [pass], [pass], { ...working, previewPlaying: true }),
    'Paused: preview playing',
  );
  assert.match(pictureYields(pass, [pass], [pass], { ...working, gpu: () => false }), /idle/);
  const audio = job('audio', 'c', { origin: 'background', track: 1 });
  assert.equal(pictureYields(pass, [pass, audio], [pass], working), 'Waiting for other media work');
  // A pass you asked for keeps going past background work, not past work you started.
  const asked = { ...pass, origin: 'user' };
  assert.equal(pictureYields(asked, [asked, audio], [asked], working), undefined);
  const exporting = job('export', 'd', { origin: 'user' });
  assert.equal(
    pictureYields(asked, [asked, exporting], [asked], working),
    'Waiting for other media work',
  );
  // Another queued pass never displaces the running one.
  const next = job('visual', 'e', { origin: 'background' });
  assert.equal(pictureYields(pass, [pass, next], [pass], working), undefined);
});
