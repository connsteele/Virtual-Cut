// VC-96: long projects must keep saving and reopening, and the per-tick project
// snapshot must not scale with footage length. Fixtures are 0.4.7-format (schema 4)
// projects whose recordings carry inspected per-frame and keyframe indexes, the
// shape existing installations already have on disk. No media is decoded.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, stat, writeFile, copyFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { require } from './shared.mjs';
import { testPath } from './test-paths.mjs';
const { DatabaseSync } = require('node:sqlite');
const { ProjectService } = require('../dist-electron/project-service.cjs');
const { ProjectStore } = require('../dist-electron/project-store.cjs');

const base = testPath('project-capacity');
await mkdir(base, { recursive: true });
const dir = await mkdtemp(path.join(base, 'run-'));
const media = path.join(dir, 'synthetic-source.mp4');
await writeFile(media, Buffer.alloc(64));
const mediaInfo = await stat(media);
const hours = (process.env.VIRTUAL_CUT_CAPACITY_HOURS || '1,10,16').split(',').map(Number);
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
// Inspection subtracts the stream start time, so stored timestamps are not round decimals.
const frameTimes = (offset) =>
  Array.from({ length: 216000 }, (_, i) => Number((i / 60 + offset).toFixed(6)) - offset);
const keyTimes = (frames) => frames.filter((_, i) => i % 120 === 0);

/** Write a schema 4 project exactly as 0.4.7 persisted inspected recordings. */
function legacyProject(file, count) {
  const created = new ProjectStore(file, {
    name: `Capacity ${count} h`,
    destination: dir,
    cache: path.join(dir, 'cache'),
  });
  const batch = created.data.activeBatchId;
  created.close();
  const db = new DatabaseSync(file);
  const data = JSON.parse(db.prepare('SELECT body FROM project WHERE id=1').get().body);
  const indexes = {};
  data.model.recordings = Array.from({ length: count }, (_, n) => {
    const frames = frameTimes(1.4 + n * 0.001);
    indexes[`r${n}`] = { frames, keys: keyTimes(frames) };
    return {
      id: `r${n}`,
      title: `Recording ${n}`,
      url: '',
      poster: '',
      frames: [],
      base: 0,
      duration: 3600,
      position: 0,
      sample: false,
      context: '',
      fps: 60,
      availability: 'ready',
      audioTracks: [],
      gameTrack: null,
      micTrack: null,
      batchIds: [batch],
      frameTimes: frames,
      keys: indexes[`r${n}`].keys,
    };
  });
  data.model.selectedRecordingId = 'r0';
  db.exec('BEGIN');
  db.prepare('UPDATE project SET body=? WHERE id=1').run(JSON.stringify(data));
  for (const r of data.model.recordings)
    db.prepare('INSERT OR REPLACE INTO sources (id, body) VALUES (?, ?)').run(
      r.id,
      JSON.stringify({
        id: r.id,
        file: media,
        bytes: mediaInfo.size,
        modified: mediaInfo.mtimeMs,
        fingerprint: `fingerprint-${r.id}`,
        importedAt: Date.now(),
      }),
    );
  db.exec('DROP TABLE IF EXISTS frame_indexes; PRAGMA user_version=4; COMMIT');
  db.close();
  return indexes;
}

function sameIndex(actual, expected, label) {
  assert.ok(actual, `${label}: frame index is available after migration`);
  assert.equal(actual.frameTimes.length, expected.frames.length, `${label}: frame count`);
  assert.equal(actual.keys.length, expected.keys.length, `${label}: keyframe count`);
  for (const i of [0, 1, 2, 59, 60, 1234, 107999, expected.frames.length - 1])
    assert.equal(actual.frameTimes[i], expected.frames[i], `${label}: exact frame ${i}`);
  assert.equal(actual.keys.at(-1), expected.keys.at(-1), `${label}: exact last keyframe`);
}

const results = [];
for (const count of hours) {
  const file = path.join(dir, `capacity-${count}h.vcut`);
  const indexes = legacyProject(file, count);
  const legacyBytes = (await stat(file)).size;
  // A schema 4 rolling save with the same contents exercises save-history compaction and restore.
  await mkdir(file + '.saves', { recursive: true });
  const legacySave = `manual-${Date.now() - 60000}-${randomUUID()}.vcut`;
  await copyFile(file, path.join(file + '.saves', legacySave));

  let store = new ProjectStore(file);
  const modelChars = JSON.stringify(store.data.model).length;
  assert.ok(
    modelChars < 1024 * 1024,
    `${count} h: project model is ${modelChars} characters; frame indexes must live outside it`,
  );
  assert.ok(
    store.data.model.recordings.every((r) => r.frameTimes === undefined && r.keys === undefined),
    `${count} h: recordings in the model carry no frame or keyframe arrays`,
  );
  assert.equal(store.data.model.recordings[0].frameCount, 216000, `${count} h: frame count kept`);
  assert.ok(
    (await readdir(file + '.saves')).some((name) => /^migration-v4-v\d+-/.test(name)),
    `${count} h: a verified pre-upgrade copy was made`,
  );
  sameIndex(store.frameIndex('r0'), indexes.r0, `${count} h r0`);
  sameIndex(store.frameIndex(`r${count - 1}`), indexes[`r${count - 1}`], `${count} h last`);

  const service = new ProjectService(path.join(dir, 'profile'));
  service.store = store;
  await service.snapshot();
  const snapshotMs = [];
  for (let sample = 0; sample < 5; sample++) {
    const started = performance.now();
    const snapshot = await service.snapshot();
    snapshotMs.push(performance.now() - started);
    assert.ok(
      snapshot.model.recordings.every((r) => r.frameTimes === undefined),
      'snapshots never carry per-frame arrays',
    );
  }

  // A small editorial change saves and the project reopens with the same indexes.
  const before = structuredClone(store.data.model);
  store.save(before, { ...structuredClone(before), scratchpad: `Edited at ${count} h` });
  await store.checkpoint('manual');
  store.close();
  store = new ProjectStore(file);
  assert.equal(store.data.model.scratchpad, `Edited at ${count} h`, `${count} h: edit survived`);
  sameIndex(store.frameIndex('r0'), indexes.r0, `${count} h reopened`);

  // Restoring the schema 4 save keeps working and keeps the indexes outside the model.
  await store.restore(legacySave);
  assert.equal(store.data.model.scratchpad, '', `${count} h: restored the older save`);
  assert.ok(store.data.model.recordings.every((r) => r.frameTimes === undefined));
  sameIndex(store.frameIndex('r0'), indexes.r0, `${count} h restored`);
  store.close();
  store = new ProjectStore(file);
  sameIndex(store.frameIndex('r0'), indexes.r0, `${count} h reopened after restore`);
  // The pre-upgrade copy is never compacted, so restoring it moves its inline indexes out.
  const preUpgrade = (await readdir(file + '.saves')).find((n) => /^migration-v4-v\d+-/.test(n));
  await store.restore(preUpgrade);
  assert.ok(store.data.model.recordings.every((r) => r.frameTimes === undefined));
  sameIndex(store.frameIndex('r0'), indexes.r0, `${count} h restored pre-upgrade copy`);
  store.close();

  results.push({ hours: count, legacyBytes, modelChars, snapshotMs, median: median(snapshotMs) });
}

// Snapshot work must not grow with footage: allow headroom for slower CI machines.
const first = results[0],
  last = results.at(-1);
assert.ok(last.median < 250, `snapshot median ${last.median.toFixed(1)} ms at ${last.hours} h`);
assert.ok(
  last.median < first.median * 4 + 50,
  `snapshot cost grew from ${first.median.toFixed(1)} ms to ${last.median.toFixed(1)} ms`,
);
await writeFile(
  path.join(dir, 'report.json'),
  JSON.stringify({ node: process.version, results }, null, 2),
);
console.log(JSON.stringify(results, null, 2));
console.log('Project capacity checks passed.');
