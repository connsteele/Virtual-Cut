import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, readdir, copyFile } from 'node:fs/promises';
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
  await writeFile(
    path.join(root, 'latest-native.json'),
    JSON.stringify({ passed: true, dir, file, source }, null, 2),
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
      ],
    }),
  );
} finally {
  await service.close();
}
