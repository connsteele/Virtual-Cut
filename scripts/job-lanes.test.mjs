import assert from 'node:assert/strict';
import test from 'node:test';
import { heldBy, isUserJob, jobLanes, laneOf, nextJob } from '../dist-electron/job-lanes.js';

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
  for (const kind of ['inspect', 'audio', 'export']) assert.equal(laneOf(kind), 'media');
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
