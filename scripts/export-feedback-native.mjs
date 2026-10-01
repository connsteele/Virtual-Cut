import { testPath } from './test-paths.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { identify, inspectMedia, launchTool } = require('../dist-electron/media-inspection.cjs');
const { exportClip, fileHash } = require('../dist-electron/clip-export.cjs');
const { ProjectService } = require('../dist-electron/project-service.cjs');
const { markerColors, markerColorName } = require('../dist-electron/workflow-types.js');
assert.equal(Object.keys(markerColors).length, 16);
assert.equal(markerColorName({ category: 'Context', color: 'constructor' }), 'Blue');
const root = testPath('m2-feedback');
await mkdir(root, { recursive: true });
const dir = await mkdtemp(path.join(root, 'native-'));
const signal = new AbortController().signal;
const ffmpeg = (args) => launchTool('ffmpeg', ['-v', 'error', '-nostdin', ...args], signal);
const clock = path.join(dir, '60hz-av1-flac.mp4');
await ffmpeg([
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=160x90:rate=60:duration=8',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=1000:sample_rate=48000:duration=8',
  '-map',
  '0:v',
  '-map',
  '1:a',
  '-c:v',
  'libaom-av1',
  '-cpu-used',
  '8',
  '-crf',
  '45',
  '-b:v',
  '0',
  '-g',
  '120',
  '-c:a',
  'flac',
  '-strict',
  'experimental',
  '-video_track_timescale',
  '60',
  clock,
]);
const fixture = JSON.parse(await readFile(testPath('m2/latest-native.json'), 'utf8'));
const mov = path.join(dir, 'same-source.mov'),
  m4v = path.join(dir, 'same-source.m4v'),
  webm = path.join(dir, 'same-source.webm');
for (const target of [mov, m4v])
  await ffmpeg(['-i', fixture.source, '-map', '0:v', '-map', '0:a:0', '-c', 'copy', target]);
await ffmpeg([
  '-i',
  clock,
  '-map',
  '0:v',
  '-map',
  '0:a:0',
  '-c:v',
  'copy',
  '-c:a',
  'libopus',
  webm,
]);
const results = [];
async function copy(file, start, end, container, label) {
  const id = randomUUID(),
    source = await identify(file, id),
    hash = await fileHash(file);
  const info = await inspectMedia(file, id, 'ffprobe', signal, () => {});
  const clip = {
    id: randomUUID(),
    rid: id,
    name: label,
    start,
    end,
    folder: '_Review',
    include: true,
  };
  const created = new Date().toISOString(),
    output = path.join(dir, label + '.' + container);
  const record = {
    plan: {
      id: randomUUID(),
      clipId: clip.id,
      sourceId: id,
      name: label,
      sourceName: path.basename(file),
      gameTrack: info.audioTracks[0].index,
      container,
      requested: { start, end },
      planned: {
        start: info.keys.filter((t) => t <= start).at(-1),
        end: info.keys.find((t) => t >= end) || info.duration,
      },
      revision: 0,
      created,
    },
    input: {
      clip,
      markers: [
        {
          id: randomUUID(),
          time: start + 0.15,
          name: 'Blue chapter',
          category: 'Character',
          color: 'Blue',
          topic: '',
          note: 'Portable note',
        },
      ],
      context: '',
      gameTrack: info.audioTracks[0].index,
      micTrack: null,
      sourceFile: source.file,
      sourceFingerprint: source.fingerprint,
      sourceBytes: source.bytes,
      sourceModified: source.modified,
      sourceStart: info.sourceStart,
      duration: info.duration,
    },
    inputHash: 'feedback-regression',
    state: 'queued',
    output,
    metadata: output + '.vcut.json',
    cleanGameConfirmed: true,
    message: 'Queued',
    updated: created,
  };
  const done = await exportClip(record, { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }, signal, () => {});
  assert.equal(done.state, 'verified');
  assert(done.elapsedMs > 0 && done.started);
  const receipt = JSON.parse(await readFile(done.metadata, 'utf8'));
  assert.equal(receipt.version, 4);
  assert.equal(receipt.markers[0].colorName, 'Blue');
  assert.equal(receipt.markers[0].color, '#3f80d6');
  assert.equal(receipt.markers[0].note, 'Portable note');
  assert.equal(await fileHash(file), hash);
  assert(done.verification.maxTimingError <= done.verification.tolerance);
  results.push({ label, output, ...done.verification, elapsedMs: done.elapsedMs });
  return done;
}
await copy(clock, 2.2, 5.1, 'mp4', 'Coarse video clock');
for (const [file, container] of [
  [mov, 'mov'],
  [m4v, 'm4v'],
  [webm, 'webm'],
])
  await copy(file, 2.2, 5.1, container, 'Source ' + container);
const real = process.env.VIRTUAL_CUT_CENRY_COPY;
if (real) {
  assert(real.toLowerCase().startsWith('g:'), 'Use a disposable G: copy for the regression');
  const done = await copy(real, 54.973, 64.465, 'mp4', 'Cenry regression');
  assert.equal(done.verification.videoPackets, 600);
  assert(done.verification.maxTimingError < 0.00001);
}
// Version-one interrupted publication retains byte-identical old companion format.
const legacy = await copy(mov, 0, 1.5, 'mp4', 'Legacy receipt recovery');
const v1 = JSON.parse(await readFile(legacy.metadata, 'utf8'));
v1.version = 1;
delete v1.markers[0].colorName;
delete v1.markers[0].color;
// Old exports had no explicit palette property and serialized category color.
legacy.input.markers[0].color = undefined;
v1.markers[0].color = '#c2a1e8';
legacy.annotationVersion = 1;
await writeFile(legacy.metadata, JSON.stringify(v1, null, 2) + '\n');
await unlink(legacy.metadata);
await exportClip(legacy, { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' }, signal, () => {});
assert.equal(JSON.parse(await readFile(legacy.metadata, 'utf8')).version, 1);
assert.equal(JSON.parse(await readFile(legacy.metadata, 'utf8')).markers[0].color, '#c2a1e8');
await exportClip(
  { ...legacy, annotationVersion: undefined },
  { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' },
  signal,
  () => {},
);
const service = new ProjectService(path.join(dir, 'profile'), '');
const destination = path.join(dir, 'outputs');
await mkdir(destination);
try {
  await service.open(path.join(dir, 'feedback.vcut'), {
    name: 'Feedback tests',
    destination,
    cache: path.join(dir, 'cache'),
  });
  const id = service.store.data.project.id;
  await service.importFiles(id, service.store.data.activeBatchId, [clock, mov, m4v, webm], {
    game: 1,
    mic: null,
  });
  for (
    let n = 0;
    n < 1600 && service.store.jobs().some((j) => ['queued', 'running'].includes(j.state));
    n++
  )
    await new Promise((r) => setTimeout(r, 50));
  assert(
    service.store.jobs().every((j) => j.state === 'succeeded'),
    JSON.stringify(service.store.jobs()),
  );
  for (const r of service.store.data.model.recordings) {
    const c = service.store.data.model.clips.find((c) => c.rid === r.id);
    const plan = await service.exportPlan(id, c.id, 'source');
    assert.equal(plan.container, path.extname(r.sourcePath).slice(1));
  }
  await assert.rejects(
    () => service.exportPlan(id, service.store.data.model.clips[0].id, 'exe'),
    /Choose/,
  );
} finally {
  await service.close();
}
await writeFile(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
await writeFile(path.join(root, 'latest-native.json'), JSON.stringify({ dir, results }, null, 2));
console.log('Feedback export regressions passed:', JSON.stringify({ dir, results }));
