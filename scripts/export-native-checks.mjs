import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, writeFile, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { ProjectService } = require('../dist-electron/project-service.cjs');
const { exportClip, fileHash } = require('../dist-electron/clip-export.cjs');
const root = 'G:/GPT/Work/virtual-cut/m2';
await mkdir(root, { recursive: true });
const dir = await mkdtemp(path.join(root, 'native-'));
const command = (tool, args) =>
  new Promise((resolve, reject) => {
    const p = spawn(tool, args, {
      windowsHide: true,
      env: { ...process.env, TEMP: 'G:/GPT/Temp', TMP: 'G:/GPT/Temp' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '',
      error = '';
    p.stdout.on('data', (d) => (output += d));
    p.stderr.on('data', (d) => (error += d));
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve(output) : reject(Error(error))));
  });
const source = path.join(dir, 'bframes.mkv');
// A synchronized white flash / tone burst every two seconds, plus a distinct
// microphone signal. Packet checks use the original independent streams.
await command('ffmpeg', [
  '-v',
  'error',
  '-f',
  'lavfi',
  '-i',
  "testsrc2=size=640x360:rate=30:duration=8,drawbox=color=white:t=fill:enable='lt(mod(t,2),0.10)'",
  '-f',
  'lavfi',
  '-i',
  "aevalsrc='if(lt(mod(t,2),0.10),sin(2*PI*1000*t),0)':s=48000:d=8",
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=2000:sample_rate=48000:duration=8',
  '-map',
  '0:v',
  '-map',
  '1:a',
  '-map',
  '2:a',
  '-c:v',
  'libx264',
  '-preset',
  'fast',
  '-g',
  '60',
  '-keyint_min',
  '60',
  '-sc_threshold',
  '0',
  '-bf',
  '3',
  '-c:a',
  'aac',
  source,
]);
const offset = path.join(dir, 'offset.mkv'),
  vfr = path.join(dir, 'vfr.mkv');
await command('ffmpeg', [
  '-v',
  'error',
  '-copyts',
  '-i',
  source,
  '-map',
  '0',
  '-c',
  'copy',
  '-output_ts_offset',
  '4',
  offset,
]);
await command('ffmpeg', [
  '-v',
  'error',
  '-i',
  source,
  '-map',
  '0:v',
  '-map',
  '0:a',
  '-vf',
  "select='not(eq(mod(n,5),0))'",
  '-fps_mode',
  'vfr',
  '-c:v',
  'libx264',
  '-g',
  '48',
  '-keyint_min',
  '48',
  '-sc_threshold',
  '0',
  '-bf',
  '3',
  '-c:a',
  'copy',
  vfr,
]);
const originalHashes = await Promise.all([source, offset, vfr].map((file) => fileHash(file)));
const delayed = path.join(dir, 'delayed-audio.mkv'),
  early = path.join(dir, 'early-audio.mkv');
for (const [target, shift] of [
  [delayed, 0.35],
  [early, -0.25],
])
  await command('ffmpeg', [
    '-v',
    'error',
    '-copyts',
    '-i',
    source,
    '-itsoffset',
    String(shift),
    '-i',
    source,
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-c',
    'copy',
    '-avoid_negative_ts',
    'make_zero',
    target,
  ]);
const service = new ProjectService(path.join(dir, 'profile'), '');
const file = path.join(dir, 'test.vcut'),
  destination = path.join(dir, 'outputs'),
  cache = path.join(dir, 'cache');
await mkdir(destination);
await service.open(file, { name: 'M2 export proof', destination, cache });
const project = service.store.data.project.id,
  batch = service.store.data.activeBatchId;
const wait = async () => {
  for (let n = 0; n < 1200; n++) {
    if (!service.store.jobs().some((j) => ['queued', 'running'].includes(j.state))) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error('Export job timed out.');
};
await service.importFiles(project, batch, [source, offset, vfr, delayed, early], {
  game: 1,
  mic: 2,
});
await wait();
assert.equal(
  service.store.jobs().filter((j) => j.state === 'failed').length,
  0,
  JSON.stringify(service.store.jobs()),
);
const results = [];
await service.checkpoint(project);
const baselineSave = service.store.snapshot().saves.find((s) => s.kind === 'manual').id;
async function attempt(rid, start, end, container, label) {
  const before = structuredClone(service.store.data.model),
    after = structuredClone(before),
    clip = after.clips.find((c) => c.rid === rid);
  Object.assign(clip, {
    start,
    end,
    name: label,
    note: 'Clip note\nCai → Leda — café',
    folder: 'Mechanics/Blaze Arts',
  });
  for (const id of Object.keys(after.markers)) after.markers[id] = [];
  after.markers[rid] = [
    {
      id: 'zero',
      time: start,
      name: 'Cai → Leda',
      category: 'Character',
      topic: 'Cai',
      note: 'Two lines\n日本語',
    },
    {
      id: 'offset',
      time: (start + end) / 2,
      name: 'Blaze #=; arts',
      category: 'Mechanic',
      topic: 'Blaze Arts',
      note: 'Second note',
    },
    {
      id: 'outside',
      time: Math.min(7.99, after.recordings.find((r) => r.id === rid).duration),
      name: 'Outside clip',
      category: 'Story',
      topic: '',
    },
  ];
  await service.save(project, before, after);
  await wait();
  const plan = await service.exportPlan(project, clip.id, container),
    output = path.join(destination, label + '.' + container);
  await assert.rejects(() => service.startExport(project, plan.id, output, false), /Confirm/);
  await service.startExport(project, plan.id, output, true);
  await wait();
  const record = service.store.exports().find((e) => e.plan.id === plan.id);
  assert.equal(record.state, 'verified', record.message);
  const receipt = JSON.parse(await readFile(output + '.vcut.json', 'utf8'));
  assert.equal(receipt.audio.microphoneIncluded, false);
  assert.equal(receipt.audio.outputAudioTrack, 1);
  assert.equal(receipt.clip.note, clip.note);
  assert.equal(receipt.markers.find((m) => m.id === 'zero').note, 'Two lines\n日本語');
  assert.equal(receipt.markers.find((m) => m.id === 'offset').color, '#e3c17e');
  assert(receipt.verified.actual.start <= start + receipt.verified.tolerance);
  assert(receipt.verified.actual.end >= end - receipt.verified.tolerance);
  assert(receipt.verified.maxTimingError <= receipt.verified.tolerance);
  assert.equal(await fileHash(output), receipt.verified.sha256);
  assert(Math.abs((await stat(output)).mtimeMs - (record.input.sourceModified + start * 1000)) < 5);
  const metadata = JSON.parse(
    await command('ffprobe', [
      '-v',
      'error',
      '-show_chapters',
      '-show_streams',
      '-of',
      'json',
      output,
    ]),
  );
  assert.equal(metadata.streams.filter((s) => s.codec_type === 'audio').length, 1);
  assert.equal(
    metadata.chapters.find((c) => c.tags.title === 'Cai → Leda').start_time,
    receipt.markers.find((m) => m.id === 'zero').containerTime.toFixed(6),
  );
  assert.equal(
    metadata.chapters.find((c) => c.tags.title === 'Blaze #=; arts').tags.title,
    'Blaze #=; arts',
  );
  results.push({
    label,
    output,
    actual: receipt.verified.actual,
    maxTimingError: receipt.verified.maxTimingError,
  });
  return record;
}
try {
  const records = service.store.data.model.recordings;
  const normal =
    records.find((r) => r.sourcePath === source.replaceAll('/', path.sep)) || records[0];
  const a = await attempt(normal.id, 2.2, 5.1, 'mkv', 'B frames outward');
  await attempt(normal.id, 0, 1.6, 'mp4', 'Zero marker MP4');
  await attempt(normal.id, 6.2, normal.duration, 'mkv', 'End of source');
  await attempt(records[1].id, 2.2, 5.1, 'mp4', 'Nonzero source timestamps');
  await attempt(records[2].id, 2.2, 5.1, 'mkv', 'Variable frame timing');
  await attempt(records[3].id, 0, 5.1, 'mp4', 'Delayed game audio');
  await attempt(records[4].id, 2.2, 5.1, 'mkv', 'Early game audio');
  const trackBefore = structuredClone(service.store.data.model),
    trackAfter = structuredClone(trackBefore);
  const role = trackAfter.recordings.find((r) => r.id === normal.id);
  role.gameTrack = 2;
  role.micTrack = 1;
  await service.save(project, trackBefore, trackAfter);
  await wait();
  const secondTrack = await attempt(normal.id, 2.2, 5.1, 'mp4', 'Second source audio as game');
  assert.equal(secondTrack.input.gameTrack, 2);
  const cancelPlan = await service.exportPlan(project, a.plan.clipId, 'mkv');
  const cancelledOutput = path.join(destination, 'cancelled.mkv');
  await service.startExport(project, cancelPlan.id, cancelledOutput, true);
  await service.job(project, cancelPlan.id, 'cancel');
  assert.equal(service.store.exports().find((e) => e.plan.id === cancelPlan.id).state, 'cancelled');
  await assert.rejects(() => stat(cancelledOutput), /ENOENT/);
  await service.job(project, cancelPlan.id, 'retry');
  await wait();
  assert.equal(service.store.exports().find((e) => e.plan.id === cancelPlan.id).state, 'verified');
  // Existing targets are never overwritten; retry reconciles a known video
  // whose metadata publication was interrupted.
  const collision = await service.exportPlan(project, a.plan.clipId, 'mkv');
  const protectedFile = path.join(destination, 'protected.mkv');
  await writeFile(protectedFile, 'User file');
  await service.startExport(project, collision.id, protectedFile, true);
  await wait();
  assert.equal(service.store.exports().find((e) => e.plan.id === collision.id).state, 'failed');
  assert.equal(await readFile(protectedFile, 'utf8'), 'User file');
  await unlink(a.metadata);
  const recovered = await exportClip(
    a,
    { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' },
    new AbortController().signal,
    () => {},
  );
  assert.equal(recovered.state, 'verified');
  assert.equal(await fileHash(a.output), a.verification.sha256);
  const stale = await service.exportPlan(project, a.plan.clipId, 'mkv');
  const before = structuredClone(service.store.data.model),
    after = structuredClone(before);
  after.clips.find((c) => c.id === a.plan.clipId).name = 'Changed after planning';
  await service.save(project, before, after);
  await assert.rejects(
    () => service.startExport(project, stale.id, path.join(destination, 'stale.mkv'), true),
    /changed/,
  );
  await service.checkpoint(project);
  await service.restore(project, baselineSave);
  assert(service.store.exports().some((e) => e.plan.id === a.plan.id));
  await service.close();
  await service.open(file);
  assert(service.store.exports().some((e) => e.plan.id === a.plan.id));
  assert.deepEqual(
    await Promise.all([source, offset, vfr].map((file) => fileHash(file))),
    originalHashes,
  );
  await writeFile(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
  await writeFile(
    path.join(root, 'latest-native.json'),
    JSON.stringify({ dir, file, source, destination }, null, 2),
  );
  console.log('Verified export checks passed:', JSON.stringify({ dir, results }));
} finally {
  await service.close();
}
