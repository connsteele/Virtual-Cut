import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, readdir, copyFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { ProjectService } = require('../dist-electron/project-service.cjs');
const root = 'G:/GPT/Work/virtual-cut/m1-feedback';
await mkdir(root, { recursive: true });
const dir = await mkdtemp(path.join(root, 'native-')),
  source = path.join(dir, 'audio-notes.mkv');
async function ffmpeg(args) {
  await new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-v', 'error', '-nostdin', ...args], {
      windowsHide: true,
      env: { ...process.env, TEMP: 'G:/GPT/Temp', TMP: 'G:/GPT/Temp' },
    });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('exit', (code) => (code ? reject(Error(stderr)) : resolve()));
  });
}
await ffmpeg([
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=640x360:rate=30:duration=8',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=440:duration=8',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=880:duration=8',
  '-filter_complex',
  "[1:a]volume='if(lt(t,4),1,0)':eval=frame[game];[2:a]volume='if(lt(t,4),0,1)':eval=frame[mic]",
  '-map',
  '0:v',
  '-map',
  '[game]',
  '-map',
  '[mic]',
  '-c:v',
  'libx264',
  '-preset',
  'ultrafast',
  '-g',
  '30',
  '-c:a',
  'flac',
  '-y',
  source,
]);
const second = path.join(dir, 'second.mkv'),
  mismatch = path.join(dir, 'single-track.mkv');
await copyFile(source, second);
await ffmpeg(['-i', source, '-map', '0:v', '-map', '0:a:0', '-c', 'copy', '-y', mismatch]);
const hash = createHash('sha256')
  .update(await readFile(source))
  .digest('hex');
const service = new ProjectService(path.join(dir, 'profile'), path.join(dir, 'tools'));
const file = path.join(dir, 'feedback.vcut');
let p = await service.open(file, {
  name: 'M1 feedback regression',
  destination: dir,
  cache: path.join(dir, 'cache'),
});
const id = p.project.id,
  batch = p.activeBatchId;
async function settled() {
  for (let deadline = Date.now() + 90000; Date.now() < deadline;) {
    const p = await service.snapshot();
    if (!p.jobs.some((j) => ['queued', 'running'].includes(j.state))) return p;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('Media jobs did not settle');
}
try {
  await service.importFiles(id, batch, [source], { game: 1, mic: 2 });
  // A later import remembers the batch setup; a mismatched source is flagged.
  await service.importFiles(id, batch, [second, mismatch]);
  p = await settled();
  assert(
    p.jobs.every((j) => j.state === 'succeeded'),
    JSON.stringify(p.jobs),
  );
  assert.deepEqual(p.batches[0].audioDefaults, { game: 1, mic: 2 });
  const record = p.model.recordings[0];
  const game = record.audioTracks.find((t) => t.index === record.gameTrack),
    mic = record.audioTracks.find((t) => t.index === record.micTrack);
  assert(game.previewUrl && mic.previewUrl, 'Both assigned tracks prepare automatically');
  const max = (peaks, start, end) => Math.max(...peaks.slice(start, end));
  assert(max(game.waveform.peaks, 100, 600) > 0.05 && max(game.waveform.peaks, 1400, 1800) < 0.005);
  assert(
    max(mic.waveform.peaks, 100, 600) < 0.005 && max(mic.waveform.peaks, 1400, 1800) > 0.05,
    'Waveforms must come from their assigned streams',
  );
  assert(
    p.model.recordings[2].audioWarning && p.model.recordings[2].micTrack == null,
    'Missing microphone tracks must not silently map to game audio',
  );
  let next = structuredClone(p.model);
  next.selectedRecordingId = record.id;
  next.recordings[0].monitor = 'both';
  next.clips[0].name = 'Checkpoint clip';
  next.clips[0].end = 3;
  next.clips.push({
    ...next.clips[0],
    id: 'feedback-gap-clip',
    name: 'After gap',
    start: 5,
    end: 7,
  });
  p = await service.save(id, p.model, next);
  assert.equal(p.saves.filter((s) => s.kind === 'auto').length, 1);
  p = await service.checkpoint(id);
  const manual = p.saves.find((s) => s.kind === 'manual');
  next = structuredClone(p.model);
  next.clips[0].name = 'Later edit';
  p = await service.save(id, p.model, next);
  p = await service.restore(id, manual.id);
  assert.equal(p.model.clips[0].name, 'Checkpoint clip');
  assert.equal(p.canUndo, false, 'Restoring clears stale undo entries');
  assert(
    p.saves.some((s) => s.kind === 'manual' && s.id !== manual.id),
    'Restore protects current work in its own checkpoint',
  );
  await assert.rejects(() => service.restore(id, '../outside.vcut'), /available save/);
  // Exercise independent rotation and reopen of real SQLite backup files.
  for (let i = 0; i < 7; i++) {
    next = structuredClone(p.model);
    next.scratchpad = `rotation ${i}`;
    p = await service.save(id, p.model, next);
    await service.store.checkpoint('auto', true);
    p = await service.checkpoint(id);
  }
  assert.equal(p.saves.filter((s) => s.kind === 'auto').length, 5);
  assert.equal(p.saves.filter((s) => s.kind === 'manual').length, 5);
  assert.equal((await readdir(file + '.saves')).filter((s) => s.endsWith('.partial')).length, 0);
  await service.close();
  p = await service.open(file);
  assert.equal(p.model.scratchpad, 'rotation 6');
  assert.equal(p.saves.length, 10);
  const order = p.model.clips.map((c) => c.id);
  next = structuredClone(p.model);
  next.clips.splice(0, 1);
  p = await service.save(id, p.model, next);
  p = await service.history(id, 'undo');
  assert.deepEqual(
    p.model.clips.map((c) => c.id),
    order,
    'Deletion undo preserves clip ordering',
  );
  assert.equal(
    createHash('sha256')
      .update(await readFile(source))
      .digest('hex'),
    hash,
    'Original media bytes must remain unchanged',
  );
  // Nested intake, shared membership and reversible batch deletion.
  const nested = path.join(dir, 'nested');
  await mkdir(path.join(nested, 'one', 'two'), { recursive: true });
  await copyFile(source, path.join(nested, 'root.mkv'));
  await copyFile(source, path.join(nested, 'one', 'middle.MKV'));
  await copyFile(source, path.join(nested, 'one', 'two', 'deep.mkv'));
  await writeFile(path.join(nested, 'one', 'ignored.txt'), 'Not a recording');
  const files = await service.gather(nested);
  assert.equal(files.length, 3);
  assert(files.some((file) => file.endsWith('deep.mkv')));
  const protectedSaves = new Set(p.saves.map((x) => x.id));
  p = await service.checkpoint(id);
  const initial = p.saves.find((x) => x.kind === 'manual' && !protectedSaves.has(x.id));
  const originalClips = structuredClone(p.model.clips);
  p = await service.batch(id, 'Temporary nested intake');
  const temporary = p.activeBatchId;
  await service.importFiles(id, temporary, [...files, source]);
  p = await settled();
  assert(p.jobs.every((j) => j.state === 'succeeded'));
  assert.equal(p.model.recordings.length, 6);
  p = await service.importFiles(id, temporary, files);
  assert.equal(p.model.recordings.length, 6, 'Repeated nested import does not duplicate sources');
  await assert.rejects(() => service.deleteBatch(id, temporary, '../invalid'), /existing batch/);
  p = await service.deleteBatch(id, temporary, batch);
  assert.equal(p.batches.length, 1);
  assert(p.model.recordings.every((r) => r.batchIds.includes(batch)));
  assert.deepEqual(p.model.clips.slice(0, originalClips.length), originalClips);
  p = await service.batch(id, 'Empty batch');
  p = await service.deleteBatch(id, p.activeBatchId, batch);
  assert.equal(p.model.recordings.length, 6);
  p = await service.deleteBatch(id, batch);
  assert.equal(p.batches[0].name, 'Unbatched');
  assert(p.model.recordings.every((r) => r.batchIds.includes(p.activeBatchId)));
  await service.close();
  p = await service.open(file);
  assert.equal(p.batches[0].name, 'Unbatched');
  p = await service.restore(id, initial.id);
  assert.equal(p.batches[0].id, batch);
  assert.deepEqual(p.model.clips, originalClips);
  // Upgrade a legacy preview while a Windows player holds it open without share-delete.
  const native = service.store.sources().find((x) => x.id === record.id);
  const generated = path.join(dir, 'cache', native.audioPreviews[game.index]);
  const legacy = path.join(
    dir,
    'cache',
    `${native.id}-${native.fingerprint}-audio-${game.index}.m4a`,
  );
  await copyFile(generated, legacy);
  service.store.transaction(() => {
    delete native.audioPreviews[game.index];
    service.store.putSource(native);
    delete service.store.data.model.recordings[0].audioTracks.find((t) => t.index === game.index)
      .waveform;
  });
  let lock;
  try {
    if (process.platform === 'win32') {
      lock = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `$f=[System.IO.File]::Open('${legacy.replace(/'/g, "''")}',[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::Read); [Console]::Out.WriteLine('locked'); $null=[Console]::In.ReadLine(); $f.Dispose()`,
        ],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      await new Promise((resolve, reject) => {
        lock.once('error', reject);
        lock.stdout.once('data', resolve);
        lock.once('exit', (code) => {
          if (code) reject(Error('Preview lock helper failed'));
        });
      });
      await assert.rejects(() => rename(legacy, legacy + '.moved'), /EPERM|EACCES|EBUSY/);
    }
    await service.prepareAudio(id, record.id);
    p = await settled();
    assert(p.jobs.filter((j) => j.sourceId === record.id).every((j) => j.state === 'succeeded'));
    const published = service.store.sources().find((x) => x.id === record.id).audioPreviews[
      game.index
    ];
    assert.notEqual(published, path.basename(legacy));
    assert(p.model.recordings[0].audioTracks.find((t) => t.index === game.index).waveform);
    assert.equal((await readFile(legacy)).length, (await readFile(generated)).length);
  } finally {
    if (lock) {
      lock.stdin.end('\n');
      await new Promise((resolve) => lock.once('exit', resolve));
    }
  }
  await service.close();
  p = await service.open(file);
  assert(
    p.model.recordings[0].audioTracks.find((t) => t.index === game.index).previewUrl,
    'New preview generation is persisted and playable on reopen',
  );
  // Remove exclusive app records/cache, retain shared work and restore from
  // a real pre-cleanup checkpoint whose previews must be regenerated.
  const baselineBatch = p.activeBatchId;
  const baselineCount = p.model.recordings.length;
  p = await service.batch(id, 'Cleanup test');
  const cleanupBatch = p.activeBatchId;
  await service.importFiles(id, cleanupBatch, [source, ...files]);
  p = await settled();
  const exclusive = p.model.recordings.filter(
    (r) => r.batchIds.includes(cleanupBatch) && r.batchIds.length === 1,
  );
  const exclusiveIds = new Set(exclusive.map((r) => r.id));
  let edited = structuredClone(p.model);
  edited.clips.find((c) => exclusiveIds.has(c.rid)).note = 'Recover this note after cleanup';
  const editedRecord = edited.recordings.find((r) => exclusiveIds.has(r.id));
  [editedRecord.gameTrack, editedRecord.micTrack] = [editedRecord.micTrack, editedRecord.gameTrack];
  edited.markers[editedRecord.id].push({
    id: 'cleanup-marker',
    time: 1,
    name: 'Recover marker',
    note: 'Cleanup note',
    category: 'Context',
    topic: '',
  });
  p = await service.save(id, p.model, edited);
  const protectedCache = path.join(dir, 'cache', 'user-kept.txt');
  await writeFile(protectedCache, 'Do not remove unrelated cache-folder files');
  const cacheBefore = await readdir(path.join(dir, 'cache'));
  const savesBeforeCleanup = new Set(p.saves.map((copy) => copy.id));
  await assert.rejects(
    () => service.deleteBatch(id, cleanupBatch, baselineBatch, 'invalid'),
    /how to remove/,
  );
  p = await service.deleteBatch(id, cleanupBatch, baselineBatch, 'remove');
  assert.equal(p.model.recordings.length, baselineCount);
  assert(p.model.recordings.find((r) => r.id === record.id).batchIds.includes(baselineBatch));
  assert(p.model.clips.every((c) => !exclusiveIds.has(c.rid)));
  assert(p.jobs.every((job) => !exclusiveIds.has(job.sourceId)));
  assert(service.store.sources().every((r) => !exclusiveIds.has(r.id)));
  assert.equal(p.canUndo, false);
  assert(p.cleanup.cacheFilesRemoved >= exclusive.length * 8, 'Owned previews should be removed');
  const cacheAfter = await readdir(path.join(dir, 'cache'));
  assert(cacheAfter.includes('user-kept.txt'));
  assert(
    cacheBefore
      .filter((name) => name.startsWith(record.id))
      .every((name) => cacheAfter.includes(name)),
    'Shared caches remain',
  );
  for (const video of files)
    assert.equal(
      createHash('sha256')
        .update(await readFile(video))
        .digest('hex'),
      hash,
    );
  await assert.rejects(() => service.saveLocation(id, '../outside.vcut'), /available save/);
  const preCleanup = p.saves.find(
    (copy) => copy.kind === 'manual' && !savesBeforeCleanup.has(copy.id),
  );
  assert.equal(
    await service.saveLocation(id, preCleanup.id),
    path.join(file + '.saves', preCleanup.id),
  );
  await service.close();
  p = await service.open(file);
  assert.equal(p.model.recordings.length, baselineCount);
  p = await service.restore(id, preCleanup.id);
  p = await settled();
  assert(p.model.clips.some((c) => c.note === 'Recover this note after cleanup'));
  assert(p.model.markers[editedRecord.id].some((m) => m.id === 'cleanup-marker'));
  assert.equal(
    p.model.recordings.find((r) => r.id === editedRecord.id).gameTrack,
    editedRecord.gameTrack,
  );
  assert(p.model.recordings.find((r) => r.id === editedRecord.id).frames.length === 8);
  p = await service.deleteBatch(id, cleanupBatch, baselineBatch, 'remove');
  // Cleanup while its exclusive inspection is still active must cancel before
  // unregistering that source, so the worker cannot republish orphaned data.
  p = await service.batch(id, 'Active cleanup');
  const activeBatch = p.activeBatchId;
  const activeSource = path.join(dir, 'active-cleanup.mkv');
  await copyFile(source, activeSource);
  await service.importFiles(id, activeBatch, [activeSource]);
  p = await service.deleteBatch(id, activeBatch, baselineBatch, 'remove');
  p = await settled();
  assert.equal(p.model.recordings.length, baselineCount);
  assert.equal(service.store.sources().length, baselineCount);
  assert.equal(
    createHash('sha256')
      .update(await readFile(activeSource))
      .digest('hex'),
    hash,
  );
  // Retain an old failure in the job log to exercise successful retry status in UI.
  service.store.putJob({
    id: 'older-locked-preview-failure',
    sourceId: record.id,
    kind: 'audio',
    track: game.index,
    state: 'failed',
    progress: 0,
    message: 'Older locked-preview failure',
    updated: '2000-01-01T00:00:00.000Z',
  });
  await writeFile(
    path.join(root, 'latest-native.json'),
    JSON.stringify({ passed: true, dir, file, source, nested }, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: true,
      dir,
      checks: [
        'batch audio defaults',
        'automatic mic preparation',
        'track-specific real waveforms',
        'mixed-layout warning',
        'manual checkpoint restore',
        'path rejection',
        'independent save rotation',
        'reopen',
        'source preservation',
        'recursive nested intake and duplicate detection',
        'empty, shared and last-batch deletion, reopen and recovery',
        'legacy audio preview upgrade while Windows playback locks the old file',
        'batch app-data cleanup preserves originals/shared work and unrelated cache files',
        'cleanup checkpoint restores notes, markers, audio assignments and regenerated previews',
        'active-job cleanup cannot republish removed sources',
        'native save-location lookup rejects paths outside known checkpoints',
      ],
    }),
  );
} finally {
  await service.close();
}
