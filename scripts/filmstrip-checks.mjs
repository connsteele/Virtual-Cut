import assert from 'node:assert/strict';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  writeFile,
  utimes,
  stat,
} from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { require } from './shared.mjs';

const { FilmstripCache, nearestKey } = require('../dist-electron/filmstrip.cjs');
const { identify, inspectMedia, launchTool } = require('../dist-electron/media-inspection.cjs');
const { ProjectService } = require('../dist-electron/project-service.cjs');
const root = 'G:/GPT/Work/virtual-cut/filmstrip';
await mkdir(root, { recursive: true });
const dir = await mkdtemp(path.join(root, 'native-'));
const ffmpeg = process.env.VIRTUAL_CUT_FFMPEG || 'ffmpeg',
  probe = process.env.VIRTUAL_CUT_FFPROBE || 'ffprobe';
const signal = new AbortController().signal;
const source = path.join(dir, 'clock.mkv');
await launchTool(
  ffmpeg,
  [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=30',
    '-t',
    '8',
    '-c:v',
    'libx264',
    '-g',
    '15',
    '-keyint_min',
    '15',
    '-sc_threshold',
    '0',
    '-an',
    source,
  ],
  signal,
);
const offsetFile = path.join(dir, 'offset.mkv');
await launchTool(
  ffmpeg,
  ['-v', 'error', '-i', source, '-c', 'copy', '-output_ts_offset', '5', offsetFile],
  signal,
);
const cache = new FilmstripCache(),
  results = {};
const hash = async (file) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
async function exercise(file, label, times) {
  const native = await identify(file, randomUUID());
  const info = await inspectMedia(file, native.id, probe, signal, () => {});
  const before = await hash(file),
    files = await readdir(dir);
  const at = times || Array.from({ length: 16 }, (_, i) => (info.duration * (i + 0.5)) / 16);
  const started = performance.now();
  const frames = await cache.request(ffmpeg, native, info.sourceStart, info.keys, at, randomUUID());
  const cold = performance.now() - started;
  assert.equal(frames.length, at.length);
  for (const [i, frame] of frames.entries()) {
    assert(Math.abs(frame.time - nearestKey(info.keys, at[i])) < 0.002);
    assert(frame.data.startsWith('data:image/jpeg;base64,'));
  }
  const warmStart = performance.now();
  assert.deepEqual(
    await cache.request(ffmpeg, native, info.sourceStart, info.keys, at, randomUUID()),
    frames,
  );
  const warm = performance.now() - warmStart;
  assert.deepEqual(await readdir(dir), files, 'No image or temporary files created');
  assert.equal(await hash(file), before);
  const token = randomUUID();
  cache.clear();
  const aborted = cache.request(ffmpeg, native, info.sourceStart, info.keys, at, token);
  setTimeout(() => cache.cancel(token), 20);
  await assert.rejects(aborted, /Cancelled/);
  const latest = await cache.request(
    ffmpeg,
    native,
    info.sourceStart,
    info.keys,
    [at[0]],
    randomUUID(),
  );
  assert.equal(latest.length, 1, 'Decoder recovers after cancel');
  cache.clear();
  assert.deepEqual(cache.stats(), { entries: 0, bytes: 0 });
  results[label] = {
    duration: info.duration,
    sourceStart: info.sourceStart,
    keys: info.keys.length,
    tiles: frames.length,
    coldMs: Math.round(cold),
    warmMs: Math.round(warm),
    memoryOnly: true,
    timestampsVerified: true,
  };
  return { native, info };
}
try {
  await exercise(source, 'synthetic');
  await exercise(offsetFile, 'nonzeroStart', [0.2, 1.8, 4.3, 7.1]);
  const long = path.join(dir, 'long-4k-av1.mp4');
  await copyFile('G:/GPT/Work/virtual-cut/full-resolution-demo/videos/r1.mp4', long);
  const { native, info } = await exercise(long, '4kAV1');
  const retained = await cache.request(
    ffmpeg,
    native,
    info.sourceStart,
    info.keys,
    [1, 10, 20],
    randomUUID(),
  );
  const alternate = await identify(source, randomUUID());
  const alternateInfo = await inspectMedia(source, alternate.id, probe, signal, () => {});
  await cache.request(
    ffmpeg,
    alternate,
    alternateInfo.sourceStart,
    alternateInfo.keys,
    [1, 2],
    randomUUID(),
  );
  assert.deepEqual(
    await cache.request(
      'nonexistent-decoder-must-not-run',
      native,
      info.sourceStart,
      info.keys,
      [1, 10, 20],
      randomUUID(),
    ),
    retained,
    'Cross-recording revisit uses completed native frames with no decoder',
  );
  const panHit = await cache.request(
    'nonexistent-decoder-must-not-run',
    native,
    info.sourceStart,
    info.keys,
    [10, 20],
    randomUUID(),
  );
  assert.equal(panHit.length, 2);
  results.revisit =
    'Cross-source and overlapping target requests used cached keyframes without a decoder';
  const zoom = Array.from({ length: 16 }, (_, i) => 50 + ((i + 0.5) * 50) / 16);
  const zoomStart = performance.now();
  const frames = await cache.request(
    ffmpeg,
    native,
    info.sourceStart,
    info.keys,
    zoom,
    randomUUID(),
  );
  results.zoom = {
    coldMs: Math.round(performance.now() - zoomStart),
    times: frames.map((f) => f.time),
  };
  // Repeated requests replace work instead of leaving parallel FFmpeg decoders.
  const obsolete = cache.request(
    ffmpeg,
    native,
    info.sourceStart,
    info.keys,
    [10, 20, 30],
    randomUUID(),
  );
  const latest = cache.request(ffmpeg, native, info.sourceStart, info.keys, [40], randomUUID());
  await assert.rejects(obsolete, /Cancelled/);
  assert.equal((await latest).length, 1);
  for (let i = 0; i < 128; i += 32)
    await cache.request(
      ffmpeg,
      native,
      info.sourceStart,
      info.keys,
      info.keys.slice(i, i + 32),
      randomUUID(),
    );
  for (let i = 0; i < 8; i++) {
    await cache.request(
      ffmpeg,
      { ...alternate, id: randomUUID() },
      alternateInfo.sourceStart,
      alternateInfo.keys,
      alternateInfo.keys,
      randomUUID(),
    );
  }
  assert(cache.stats().entries <= 192 && cache.stats().bytes <= 8 * 1024 * 1024);
  results.cacheBounds = cache.stats();
  const oldStat = await stat(long);
  await utimes(long, new Date(), new Date(oldStat.mtimeMs + 10000));
  await assert.rejects(
    cache.request(ffmpeg, native, info.sourceStart, info.keys, [40], randomUUID()),
    /source changed/,
  );
  assert.equal(cache.stats().entries, 0);
  await cache.close();
  const service = new ProjectService(path.join(dir, 'profile'), path.join(dir, 'tools'));
  try {
    let p = await service.open(path.join(dir, 'dates.vcut'), {
      name: 'Filmstrip dates',
      destination: dir,
      cache: path.join(dir, 'cache'),
    });
    await service.importFiles(p.project.id, p.activeBatchId, [source], { game: null, mic: null });
    for (let until = Date.now() + 45000; Date.now() < until;) {
      p = await service.snapshot();
      if (!p.jobs.some((j) => ['queued', 'running'].includes(j.state))) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert(p.jobs.every((j) => j.state === 'succeeded'));
    const r = p.model.recordings[0];
    assert.equal(r.sourceModified, (await stat(source)).mtimeMs);
    assert(Number.isFinite(r.importedAt));
    assert.equal(
      (await readdir(path.join(dir, 'cache'))).filter((n) => /frame-.*\.jpg$/.test(n)).length,
      1,
      'Only the stable media-pool poster is on disk',
    );
    const count = (await service.filmstrip(p.project.id, r.id, [1, 2, 3], randomUUID())).length;
    assert.equal(count, 3);
    assert.throws(() => service.filmstrip(p.project.id, 'foreign', [1], randomUUID()), /available/);
    assert.throws(
      () => service.filmstrip(p.project.id, r.id, Array(33).fill(1), randomUUID()),
      /Invalid/,
    );
    assert.throws(() => service.filmstrip(p.project.id, r.id, [NaN], randomUUID()), /Invalid/);
    assert.throws(() => service.filmstrip(p.project.id, r.id, [-1], randomUUID()), /Invalid/);
    assert.throws(() => service.filmstrip('foreign', r.id, [1], randomUUID()));
    await service.importFiles(p.project.id, p.activeBatchId, [source], { game: null, mic: null });
    assert.equal((await service.snapshot()).model.recordings[0].importedAt, r.importedAt);
    await service.close();
    p = await service.open(path.join(dir, 'dates.vcut'));
    assert.equal(p.model.recordings[0].importedAt, r.importedAt);
    for (const [name, year] of [
      ['Z older recording with a long descriptive title', 2024],
      ['A newer recording', 2027],
    ]) {
      const extra = path.join(dir, name + '.mp4');
      await copyFile(source, extra);
      await utimes(extra, new Date(), new Date(`${year}-01-02T12:30:00Z`));
      await service.importFiles(p.project.id, p.activeBatchId, [extra], { game: null, mic: null });
    }
    for (let until = Date.now() + 45000; Date.now() < until;) {
      p = await service.snapshot();
      if (!p.jobs.some((j) => ['queued', 'running'].includes(j.state))) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert(p.jobs.every((j) => j.state === 'succeeded'));
    results.native =
      'Dates, intake persistence, duplicate import, validation, cancellation, unchanged sources and no timeline image files passed';
    await writeFile(
      path.join(root, 'latest-native.json'),
      JSON.stringify({ dir, file: p.project.file, source, recording: r.id }),
    );
  } finally {
    await service.close();
  }
  await writeFile(path.join(dir, 'evidence.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ dir, ...results }));
} finally {
  await cache.close();
}
