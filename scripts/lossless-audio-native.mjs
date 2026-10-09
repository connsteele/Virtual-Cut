import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { testPath } from './test-paths.mjs';
const require = createRequire(import.meta.url);
const { ProjectService } = require('../dist-electron/project-service.cjs');
const { verifyPublished, fileHash } = require('../dist-electron/clip-export.cjs');

// ALAC and PCM recordings: the track copies are FLAC with the source's own sample rate
// and bit depth, decode to the original's exact samples, and filed clips carry that FLAC.
const root = testPath('lossless-audio');
await mkdir(root, { recursive: true });
const dir = await mkdtemp(path.join(root, 'native-'));
const run = (tool, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(tool, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '',
      error = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (error += d));
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(Error(error))));
  });
const ffmpeg = process.env.VIRTUAL_CUT_FFMPEG || 'ffmpeg',
  ffprobe = process.env.VIRTUAL_CUT_FFPROBE || 'ffprobe';
const samples = async (file, stream, filter) =>
  /MD5=(\w+)/.exec(
    await run(ffmpeg, [
      '-v',
      'error',
      '-i',
      file,
      '-map',
      `0:${stream}`,
      ...(filter ? ['-af', filter] : []),
      '-c:a',
      'pcm_s32le',
      '-f',
      'md5',
      '-',
    ]),
  )[1];
const pcm = (file, stream) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      ['-v', 'error', '-i', file, '-map', `0:${stream}`, '-c:a', 'pcm_s32le', '-f', 's32le', '-'],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const chunks = [];
    child.stdout.on('data', (d) => chunks.push(d));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve(Buffer.concat(chunks)) : reject(Error('decode')),
    );
  });
const audioFacts = async (file, stream) =>
  JSON.parse(
    await run(ffprobe, [
      '-v',
      'error',
      '-select_streams',
      String(stream),
      '-show_entries',
      'stream=codec_name,sample_rate,bits_per_raw_sample,channels',
      '-of',
      'json',
      file,
    ]),
  ).streams[0];

const fixtures = [
  // OBS-style 24-bit ALAC in MP4 at 48 kHz.
  { name: 'alac.mp4', codec: ['-c:a', 'alac', '-sample_fmt', 's32p'], rate: 48000, bits: '24' },
  // 16-bit PCM in MKV at 44.1 kHz: depth and rate must not be raised or resampled.
  { name: 'pcm.mkv', codec: ['-c:a', 'pcm_s16le'], rate: 44100, bits: '16' },
];
for (const fixture of fixtures) {
  const source = path.join(dir, fixture.name);
  await run(ffmpeg, [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x180:rate=30:duration=8',
    '-f',
    'lavfi',
    '-i',
    `anoisesrc=r=${fixture.rate}:a=0.4:d=8:seed=3,aformat=channel_layouts=stereo`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=997:sample_rate=${fixture.rate}:duration=8`,
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-map',
    '2:a',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-g',
    '30',
    '-keyint_min',
    '30',
    '-sc_threshold',
    '0',
    ...fixture.codec,
    ...(fixture.bits === '24' ? ['-bits_per_raw_sample', '24'] : []),
    source,
  ]);
  const originalHash = await fileHash(source);
  const project = path.join(dir, path.parse(fixture.name).name);
  await mkdir(path.join(project, 'outputs'), { recursive: true });
  const service = new ProjectService(path.join(project, 'profile'), '');
  await service.open(path.join(project, 'lossless.vcut'), {
    name: 'Lossless audio checks',
    destination: path.join(project, 'outputs'),
    cache: path.join(project, 'cache'),
  });
  const id = service.store.data.project.id,
    batch = service.store.data.activeBatchId;
  const wait = async () => {
    for (let i = 0; i < 1200; i++) {
      if (!service.store.jobs().some((j) => ['queued', 'running'].includes(j.state))) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw Error('Job timed out');
  };
  await service.importFiles(id, batch, [source], { game: 1, mic: 2 });
  await wait();
  assert.deepEqual(
    service.store.jobs().filter((j) => j.state === 'failed'),
    [],
    `${fixture.name} preparation`,
  );
  const native = service.store.sources()[0];
  for (const track of [1, 2]) {
    assert.equal(native.audioCopies[track].kind, 'flac');
    const copy = path.join(project, 'cache', native.audioPreviews[track]);
    const facts = await audioFacts(copy, 0);
    assert.equal(facts.codec_name, 'flac');
    assert.equal(Number(facts.sample_rate), fixture.rate, `${fixture.name} rate`);
    assert.equal(facts.bits_per_raw_sample, fixture.bits, `${fixture.name} bits`);
    assert.equal(await samples(copy, 0), await samples(source, track), `${fixture.name} samples`);
  }
  const snapshot = await service.snapshot();
  assert.ok(snapshot.model.recordings[0].audioTracks.every((t) => t.previewUrl));

  const before = structuredClone(service.store.data.model),
    after = structuredClone(before);
  after.clips = [{ ...after.clips[0], name: 'Middle', start: 2, end: 5, folder: 'Checks' }];
  await service.save(id, before, after);
  await service.acceptReview(id, service.store.data.model.clips[0].id);
  const plan = await service.filingPlan(id, batch);
  await service.fileQueue(id, plan.id, true);
  await wait();
  const [record] = service.store.exports().filter((e) => e.filing);
  assert.equal(record.state, 'verified', record.message);
  assert.equal(record.verification.audioCodec, 'flac');
  await verifyPublished(record);
  const out = await audioFacts(record.output, 1);
  assert.equal(out.codec_name, 'flac');
  assert.equal(Number(out.sample_rate), fixture.rate, `${fixture.name} output rate`);
  assert.equal(out.bits_per_raw_sample, fixture.bits, `${fixture.name} output bits`);
  // The filed audio is a contiguous run of the original's own samples.
  const filed = await pcm(record.output, 1),
    original = await pcm(source, 1),
    at = original.indexOf(filed);
  assert.ok(filed.length > fixture.rate * 8 * 2, `${fixture.name} filed audio length`);
  assert.ok(at >= 0 && at % 8 === 0, `${fixture.name} filed samples match the original`);
  assert.equal(await fileHash(source), originalHash, 'original unchanged');
  await service.close();
}
console.log('Lossless audio checks passed.');
