import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rename, copyFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ProjectService } = require('../dist-electron/project-service.cjs');
const { ProjectStore } = require('../dist-electron/project-store.cjs');
const { inspectMedia } = require('../dist-electron/media-inspection.cjs');
const root = 'G:/GPT/Work/virtual-cut/milestone-1';
await mkdir(root, { recursive: true });
const dir = await mkdtemp(path.join(root, 'native-'));
const fixtures = path.join(dir, 'sources');
await mkdir(fixtures);
const source = path.join(fixtures, 'two-tracks.mp4');
const chapter = path.join(dir, 'chapters.txt');
await writeFile(
  chapter,
  ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=2500\ntitle=Lead in\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=2500\nEND=5000\ntitle=Original chapter name\n',
);
const command = (exe, args) =>
  new Promise((resolve, reject) => {
    const p = spawn(exe, args, {
      windowsHide: true,
      env: { ...process.env, TEMP: 'G:/GPT/Temp', TMP: 'G:/GPT/Temp' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(Error(err))));
  });
await command('ffmpeg', [
  '-v',
  'error',
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=640x360:rate=30000/1001:duration=8',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=440:duration=8',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=880:duration=8',
  '-i',
  chapter,
  '-map',
  '0:v',
  '-map',
  '1:a',
  '-map',
  '2:a',
  '-map_metadata',
  '3',
  '-map_chapters',
  '3',
  '-metadata:s:a:0',
  'title=Game',
  '-metadata:s:a:1',
  'title=Mic',
  '-c:v',
  'libx264',
  '-preset',
  'ultrafast',
  '-g',
  '30',
  '-c:a',
  'aac',
  '-y',
  source,
]);
const original = await readFile(source),
  digest = createHash('sha256').update(original).digest('hex');
const service = new ProjectService(path.join(dir, 'profile'), path.join(dir, 'tools'));
const projectFile = path.join(dir, 'project.vcut');
const cache = path.join(dir, 'cache');
let p = await service.open(projectFile, { name: 'Production check', destination: fixtures, cache });
const id = p.project.id,
  batch = p.activeBatchId;
assert.equal(p.model.recordings.length, 0);
assert.throws(() => new ProjectStore(projectFile), /already open/);
async function settled() {
  const end = Date.now() + 90000;
  while (Date.now() < end) {
    const value = await service.snapshot();
    if (!value.jobs.some((j) => ['queued', 'running'].includes(j.state))) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('Jobs did not settle');
}
try {
  p = await service.importFiles(id, batch, [source, source]);
  assert.equal(p.model.recordings.length, 1, 'same-path duplicate should reuse identity');
  p = await settled();
  assert(
    p.jobs.every((j) => j.state === 'succeeded'),
    JSON.stringify(p.jobs),
  );
  let r = p.model.recordings[0];
  const rid = r.id;
  assert.equal(r.audioTracks.length, 2);
  assert(r.poster);
  assert.equal(r.frames.length, 0, 'Dynamic filmstrip frames are not stored in the project');
  assert(r.keys.length >= 8);
  assert(r.frameTimes.length >= 239);
  assert.equal(p.model.markers[rid][1].name, 'Original chapter name');
  assert.equal(p.model.markers[rid][1].time, 2.5);
  assert.equal(p.model.clips.length, 1, 'chapters must not create clip ranges');
  assert(r.audioTracks.find((t) => t.index === r.gameTrack).previewUrl);
  assert.equal(p.canUndo, false);
  let next = structuredClone(p.model);
  next.recordings[0].position = 2;
  p = await service.save(id, p.model, next);
  assert.equal(p.canUndo, false, 'seek must not enter undo history');
  next = structuredClone(p.model);
  next.clips[0].name = 'Retained clip';
  next.clips[0].start = 1.125;
  next.clips[0].end = 5.5;
  next.recordings[0].context = 'Why I captured this';
  next.recordings[0].micTrack = r.audioTracks[1].index;
  next.recordings[0].monitor = 'both';
  next.markers[rid][0].category = 'Character';
  next.markers[rid][0].note = 'A searchable observation';
  next.scratchpad = 'Project notes';
  p = await service.save(id, p.model, next);
  assert.equal(p.canUndo, true);
  await service.prepareAudio(id, rid);
  p = await settled();
  assert.equal(p.model.recordings[0].audioTracks.filter((t) => t.previewUrl).length, 2);
  const edited = structuredClone(p.model);
  p = await service.history(id, 'undo');
  assert.equal(p.model.clips[0].name, 'two-tracks');
  assert.equal(p.model.recordings[0].position, 2);
  p = await service.history(id, 'redo');
  assert.equal(p.model.clips[0].name, 'Retained clip');
  assert.equal(p.model.markers[rid][0].note, 'A searchable observation');
  next = structuredClone(p.model);
  next.clips[0].end = -1;
  await assert.rejects(() => service.save(id, p.model, next), /in\/out points/);
  const stale = structuredClone(p.model);
  next = structuredClone(stale);
  next.clips[0].name = 'New name';
  p = await service.save(id, stale, next);
  const conflict = structuredClone(stale);
  conflict.clips[0].name = 'Other name';
  await assert.rejects(() => service.save(id, stale, conflict), /changed elsewhere/);
  p = await service.history(id, 'undo');
  assert.equal(p.model.clips[0].name, edited.clips[0].name);
  p = await service.batch(id, 'Second batch');
  assert.equal(p.model.recordings.length, 1);
  p = await service.importFiles(id, p.activeBatchId, [source]);
  assert.equal(p.model.recordings.length, 1);
  assert.equal(p.model.recordings[0].batchIds.length, 2);
  await service.close();
  const moved = path.join(fixtures, 'moved.mp4');
  await rename(source, moved);
  p = await service.open(projectFile);
  assert.equal(p.project.id, id);
  assert.equal(p.model.recordings[0].availability, 'missing');
  p = await service.relink(id, rid, moved);
  assert.equal(p.model.recordings[0].availability, 'ready');
  assert.equal(p.model.clips[0].start, 1.125);
  assert.equal(p.model.scratchpad, 'Project notes');
  const other = path.join(fixtures, 'other.mp4');
  await copyFile(moved, other);
  await writeFile(other, Buffer.concat([original, Buffer.from('changed')]));
  await assert.rejects(() => service.relink(id, rid, other), /does not match/);
  p = await service.importFiles(id, p.activeBatchId, [other]);
  const inspection = p.jobs.find((j) => j.kind === 'inspect' && j.sourceId !== rid);
  await service.job(id, inspection.id, 'cancel');
  p = await service.snapshot();
  assert.equal(p.jobs.find((j) => j.id === inspection.id).state, 'cancelled');
  await service.job(id, inspection.id, 'retry');
  p = await settled();
  assert.equal(p.jobs.find((j) => j.id === inspection.id).state, 'succeeded');
  service.store.putJob({
    id: 'interrupted-fixture',
    sourceId: rid,
    kind: 'inspect',
    state: 'running',
    progress: 0.5,
    message: 'Fixture',
    updated: new Date().toISOString(),
  });
  await service.close();
  p = await service.open(projectFile);
  assert.equal(p.jobs.find((j) => j.id === 'interrupted-fixture').state, 'interrupted');
  assert.equal(
    createHash('sha256')
      .update(await readFile(moved))
      .digest('hex'),
    digest,
    'source bytes changed',
  );
  assert((await stat(projectFile)).size > 0);
  const vfr = path.join(fixtures, 'vfr.mkv');
  await command('ffmpeg', [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=160x90:rate=30:duration=4',
    '-vf',
    "select='if(lt(t,2),1,not(mod(n,3)))'",
    '-fps_mode',
    'vfr',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-y',
    vfr,
  ]);
  const info = await inspectMedia(vfr, 'vfr', 'ffprobe', new AbortController().signal, () => {});
  const diffs = info.frameTimes.slice(1).map((t, i) => t - info.frameTimes[i]);
  assert(
    Math.max(...diffs) - Math.min(...diffs) > 0.05,
    'VFR timestamps must retain varying frame spacing',
  );
  await writeFile(
    path.join(root, 'latest-native.json'),
    JSON.stringify({ dir, source: moved, projectFile, cache, passed: true }, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: true,
      dir,
      checks: [
        'duplicate intake',
        'chapters as points',
        'frame/keyframe index',
        'two audio streams',
        'saved edits',
        'undo/redo',
        'invalid edit rollback',
        'conflict rejection',
        'project reopen',
        'batch isolation',
        'missing and relink',
        'cancel/retry',
        'interrupted recovery',
        'VFR index',
        'source preservation',
      ],
    }),
  );
} finally {
  await service.close();
}
