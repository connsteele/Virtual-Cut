// Stitched clips (VC-212, decision 0028): a clip with gaps exports as one verified file. Video
// pieces are copied from keyframe to keyframe and joined without re-encoding; game audio is
// rebuilt as FLAC with 10 ms fades at the joins; markers, chapters and the companion run on the
// stitched clock and leave out what a gap removes. Clips without gaps, or whose gaps are too
// short to remove anything, export exactly as before.
//
// Synthetic AV1 (keyframes every second) with two 24-bit ALAC tracks, like the Mass Effect footage.
// VIRTUAL_CUT_STITCH_SOURCE may name a copy of real footage for one extra stitched export.
import { testPath } from './test-paths.mjs';
import { skippedStep, withWholeClips } from './shared.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { ProjectService } = require('../dist-electron/project-service.cjs');
const { fileHash } = require('../dist-electron/clip-export.cjs');
const root = testPath('stitched');
await mkdir(root, { recursive: true });
const dir = await mkdtemp(path.join(root, 'native-'));
const command = (tool, args) =>
  new Promise((resolve, reject) => {
    const p = spawn(tool, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '',
      error = '';
    p.stdout.on('data', (d) => (output += d));
    p.stderr.on('data', (d) => (error += d));
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve(output) : reject(Error(error))));
  });
const source = path.join(dir, 'stitch-source.mp4');
// A tone burst every second on the game track, a steady sine on the mic track.
await command('ffmpeg', [
  '-v',
  'error',
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=320x180:rate=60:duration=12',
  '-f',
  'lavfi',
  '-i',
  "aevalsrc='0.5*sin(2*PI*440*t)|0.5*sin(2*PI*660*t)':s=48000:d=12",
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=2000:sample_rate=48000:duration=12',
  '-map',
  '0:v',
  '-map',
  '1:a',
  '-map',
  '2:a',
  '-c:v',
  'libsvtav1',
  '-preset',
  '12',
  '-g',
  '60',
  // 24-bit ALAC, as OBS records it: exports use the verified FLAC copy made at import.
  '-c:a',
  'alac',
  '-sample_fmt',
  's32p',
  source,
]);
const service = new ProjectService(path.join(dir, 'profile'), '');
const file = path.join(dir, 'test.vcut'),
  destination = path.join(dir, 'outputs'),
  cache = path.join(dir, 'cache');
await mkdir(destination);
await service.open(file, { name: 'Stitched export proof', destination, cache });
const project = service.store.data.project.id,
  batch = service.store.data.activeBatchId;
const wait = async () => {
  for (let n = 0; n < 2400; n++) {
    if (!service.store.jobs().some((j) => ['queued', 'running'].includes(j.state))) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error('Job timed out.');
};
await service.importFiles(project, batch, [source], { game: 1, mic: 2 });
await wait();
{
  const unclipped = structuredClone(service.store.data.model);
  await service.save(project, unclipped, withWholeClips(unclipped));
}
const rid = service.store.data.model.recordings[0].id;
const keys = service.store.frameIndex(rid)?.keys || [];
assert(keys.length >= 11, `keyframes indexed: ${keys.length}`);
assert(
  keys.every((k) => Math.abs(k - Math.round(k)) < 0.001),
  `keyframes on seconds: ${keys}`,
);

async function exportWith(label, clipPatch, markers) {
  const before = structuredClone(service.store.data.model),
    after = structuredClone(before),
    clip = after.clips.find((c) => c.rid === rid);
  for (const k of ['gaps']) delete clip[k];
  Object.assign(clip, { name: label, folder: 'Stitched' }, clipPatch);
  after.markers[rid] = markers;
  await service.save(project, before, after);
  await wait();
  const plan = await service.exportPlan(project, clip.id, 'mp4'),
    output = path.join(destination, label + '.mp4');
  await service.startExport(project, plan.id, output, true);
  await wait();
  const record = service.store.exports().find((e) => e.plan.id === plan.id);
  assert.equal(record.state, 'verified', `${label}: ${record.message}`);
  const receipt = JSON.parse(await readFile(output + '.vcut.json', 'utf8'));
  assert.equal(await fileHash(output), receipt.verified.sha256);
  const probe = JSON.parse(
    await command('ffprobe', [
      '-v',
      'error',
      '-show_streams',
      '-show_chapters',
      '-show_format',
      '-of',
      'json',
      output,
    ]),
  );
  return { plan, record, receipt, probe, output };
}
const marker = (id, time, end) => ({
  id,
  time,
  ...(end != null ? { end } : {}),
  name: id,
  category: 'Context',
  topic: '',
});
const markers = [
  marker('kept', 1.5),
  marker('gone', 4.0),
  marker('after', 7.2),
  marker('span', 2.0, 7.0),
  marker('last', 10.5),
];

// Two gaps: 2.4–6.6 leaves out 3–6; 8.3–10.1 leaves out 9–10. Pieces 1–3, 6–9, 10–11: 6 s.
const stitched = await exportWith(
  'Two gaps',
  {
    start: 1,
    end: 11,
    gaps: [
      { id: 'g1', start: 2.4, end: 6.6 },
      { id: 'g2', start: 8.3, end: 10.1 },
    ],
  },
  markers,
);
{
  const { plan, receipt, probe, record } = stitched;
  assert.deepEqual(plan.pieces, [
    { start: 1, end: 3 },
    { start: 6, end: 9 },
    { start: 10, end: 11 },
  ]);
  assert.equal(receipt.stitched.version, 1);
  assert.equal(receipt.stitched.length.toFixed(3), '6.000');
  assert.deepEqual(
    receipt.stitched.gaps.map((g) => [g.removed.start, g.removed.end, g.joinAt]),
    [
      [3, 6, 2],
      [9, 10, 5],
    ],
  );
  assert.deepEqual(
    receipt.stitched.leftOut.map((m) => m.id),
    ['gone'],
  );
  const at = Object.fromEntries(receipt.markers.map((m) => [m.id, m]));
  assert.equal(at.kept.clipTime.toFixed(3), '0.500');
  assert.equal(at.after.clipTime.toFixed(3), '3.200');
  assert.equal(at.span.clipTime.toFixed(3), '1.000');
  assert.equal(at.span.clipEnd.toFixed(3), '3.000', 'a range is cut back across the join');
  assert.equal(at.last.clipTime.toFixed(3), '5.500');
  assert.equal(at.gone, undefined);
  assert.equal(at.kept.containerTime.toFixed(3), '0.500', 'container time is the stitched clock');
  const audio = probe.streams.filter((s) => s.codec_type === 'audio');
  assert.equal(audio.length, 1);
  assert.equal(audio[0].codec_name, 'flac');
  assert.equal(record.verification.audioCodec, 'flac');
  assert(Math.abs(Number(probe.format.duration) - 6) < 0.05, `duration ${probe.format.duration}`);
  assert.equal(record.verification.videoPackets, 360);
  assert.deepEqual(
    probe.chapters.map((c) => [c.tags.title, Number(c.start_time).toFixed(2)]),
    [
      ['Clip start', '0.00'],
      ['kept', '0.50'],
      ['span', '1.00'],
      ['after', '3.20'],
      ['last', '5.50'],
    ].filter((c) => probe.chapters.some((x) => x.tags.title === c[0])),
  );
  assert(!probe.chapters.some((c) => c.tags.title === 'gone'));
  // The published companion still matches what the receipt regenerates.
  const { verifyPublished } = require('../dist-electron/clip-export.cjs');
  await verifyPublished(record);
}

// A clip whose only gap has no two keyframes inside exports exactly as an ungapped clip.
const short = await exportWith(
  'Short gap',
  { start: 1, end: 11, gaps: [{ id: 's1', start: 4.2, end: 5.8 }] },
  [],
);
assert.equal(short.plan.pieces, undefined);
assert.equal(short.plan.gaps[0].removed, undefined);
assert.equal(short.receipt.stitched, undefined);
assert.equal(
  short.probe.streams.find((s) => s.codec_type === 'audio').codec_name,
  'flac',
  'the verified FLAC copy is copied, as before',
);

// No gaps: unchanged, with no stitched section.
const plain = await exportWith('No gaps', { start: 1, end: 11 }, []);
assert.equal(plain.plan.gaps, undefined);
assert.equal(plain.receipt.stitched, undefined);
assert(Math.abs(Number(plain.probe.format.duration) - 10) < 0.05);

// Optional: one stitched export of a copy of real footage.
const real = process.env.VIRTUAL_CUT_STITCH_SOURCE;
if (!real) skippedStep('real footage', 'VIRTUAL_CUT_STITCH_SOURCE is not set');
else {
  await service.importFiles(project, batch, [real], { game: 1, mic: 2 });
  await wait();
  const unclipped = structuredClone(service.store.data.model);
  await service.save(project, unclipped, withWholeClips(unclipped));
  const recording = service.store.data.model.recordings.find((r) => r.id !== rid);
  const before = structuredClone(service.store.data.model),
    after = structuredClone(before),
    clip = after.clips.find((c) => c.rid === recording.id);
  const t = Math.min(recording.duration, 120);
  Object.assign(clip, {
    name: 'Real footage with gaps',
    start: t * 0.1,
    end: t * 0.9,
    gaps: [
      { id: 'r1', start: t * 0.25, end: t * 0.4 },
      { id: 'r2', start: t * 0.55, end: t * 0.7 },
    ],
  });
  await service.save(project, before, after);
  await wait();
  const plan = await service.exportPlan(project, clip.id, 'mp4'),
    output = path.join(destination, 'Real footage with gaps.mp4');
  await service.startExport(project, plan.id, output, true);
  await wait();
  const record = service.store.exports().find((e) => e.plan.id === plan.id);
  assert.equal(record.state, 'verified', record.message);
  console.log(
    `Real footage: ${plan.pieces.length} pieces, ${record.verification.length.toFixed(3)} s, ${record.elapsedMs} ms`,
  );
}
await service.close();
// gaps-ui.mjs opens this project: one 12 s recording, its clip 1–11 s without gaps.
await writeFile(
  path.join(root, 'latest-native.json'),
  JSON.stringify({ file, recording: rid, clip: plain.plan.clipId }),
);
console.log(`Stitched export checks passed in ${dir}`);
