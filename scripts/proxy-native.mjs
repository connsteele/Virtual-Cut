import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { require } from './shared.mjs';
import { testPath } from './test-paths.mjs';

// VC-237: making playback proxies through the real job queue with FFmpeg. Nothing is made until
// asked; a proxy asked for at import follows the picture pass; the made proxy has the
// recording's frames with a keyframe on every source keyframe and every half second (checked
// here from packets, separately from the job's own check); a proxy gives way to playback and
// carries on with the segments it had; stopping removes every partial file; Remove, Make again,
// Never and settings behave. Encoding uses x264 and CPU decoding so the check runs on any PC;
// the NVIDIA path is measured on real footage (evidence for VC-237).
process.env.VIRTUAL_CUT_PROXY_ENCODER = 'x264';
process.env.VIRTUAL_CUT_PICTURE_GPU = '0';
process.env.VIRTUAL_CUT_PICTURE_PASS = 'manual';
process.env.VIRTUAL_CUT_PROXY_SEGMENT = '3';
const { ProjectService } = require('../dist-electron/project-service.cjs');

await mkdir(testPath('proxy-native'), { recursive: true });
const dir = await mkdtemp(path.join(testPath('proxy-native'), 'run-'));
const ffmpeg = process.env.VIRTUAL_CUT_FFMPEG || 'ffmpeg';
const ffprobe = process.env.VIRTUAL_CUT_FFPROBE || 'ffprobe';
const run = (tool, args) =>
  new Promise((resolve, reject) => {
    const p = spawn(tool, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '',
      error = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (error += d));
    p.on('error', reject);
    p.on('close', (code) => (code ? reject(Error(error)) : resolve(out)));
  });
// 12 s at 30 fps with keyframes every second plus irregular ones (1.3 s, 5.55 s), and B-frames.
const make = (file, seconds = 12) =>
  run(ffmpeg, [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=30',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000',
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-t',
    String(seconds),
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-bf',
    '2',
    '-g',
    '600',
    '-force_key_frames',
    '0,1,1.3,2,3,4,5,5.55,6,7,8,9,10,11,12,13,14,15,16,17,18,19',
    '-c:a',
    'aac',
    '-y',
    file,
  ]);
const packets = async (file) =>
  (
    await run(ffprobe, [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'packet=pts_time,flags',
      '-of',
      'csv=p=0',
      file,
    ])
  )
    .trim()
    .split(/\r?\n/)
    .map((l) => l.split(','))
    .map(([t, f]) => ({ t: Number(t), key: f.includes('K') }))
    .sort((a, b) => a.t - b.t);

const first = path.join(dir, 'first.mp4'),
  second = path.join(dir, 'second.mp4'),
  long = path.join(dir, 'long.mp4');
await Promise.all([make(first), make(second, 20), make(long, 60)]);
const file = path.join(dir, 'proxies.vcut'),
  cache = path.join(dir, 'cache'),
  destination = path.join(dir, 'outputs');
await mkdir(cache);
await mkdir(destination);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const service = new ProjectService(path.join(dir, 'profile'), '');
// CPU decoding waits for an idle PC like the picture pass; the check plays an idle PC.
service.idleSeconds = () => 600;
const jobs = () => service.store.jobs();
const until = async (test, what, limit = 60000) => {
  for (const end = Date.now() + limit; Date.now() < end; await sleep(25)) if (await test()) return;
  throw Error(`Timed out waiting for ${what}: ${JSON.stringify(jobs(), null, 1)}`);
};
const idle = () =>
  until(() => !jobs().some((j) => ['queued', 'running'].includes(j.state)), 'idle jobs');
// Newest first, like Jobs.
const proxyJobs = (id) => jobs().filter((j) => j.kind === 'proxy' && j.sourceId === id);
const leftovers = async () => (await readdir(cache)).filter((n) => /\.partial\.mp4$/i.test(n));
const results = {};
try {
  let snap = await service.open(file, { name: 'Proxies', destination, cache });
  const project = snap.project.id,
    batch = snap.activeBatchId;
  assert.deepEqual(service.store.data.proxies, undefined, 'New projects use the defaults');
  snap = await service.setProxySettings(project, { onImport: 'ask', height: 720 });
  assert.deepEqual(snap.proxies, { onImport: 'ask', height: 720 });
  await assert.rejects(
    service.setProxySettings(project, { onImport: 'ask', height: 480 }),
    /from the list/,
  );

  // Off by default: an import without the checkbox makes no proxy.
  await service.importFiles(project, batch, [first], { game: 1, mic: null });
  await idle();
  const a = service.store.data.model.recordings[0].id;
  assert.equal(proxyJobs(a).length, 0, 'Nothing is made without being asked');
  assert.equal((await service.snapshot()).model.recordings[0].proxy.state, 'none');
  assert.equal(service.store.data.batches[0].audioDefaults.proxy, undefined);

  // Asked at import: queued after inspection, made, verified, recorded.
  await service.importFiles(project, batch, [second], { game: 1, mic: null, proxy: true });
  assert.equal(
    service.store.data.batches[0].audioDefaults.proxy,
    undefined,
    'The checkbox is not remembered with the batch',
  );
  const b = service.store.data.model.recordings.find((r) => r.id !== a).id;
  await idle();
  const madeJob = proxyJobs(b)[0];
  assert.equal(madeJob?.state, 'succeeded', JSON.stringify(madeJob));
  assert.equal(madeJob.origin, 'background');
  assert.match(madeJob.message, /Proxy ready · 720p · .* · CPU decoder · x264 \(CPU\)/);
  const source = service.store.sources().find((x) => x.id === b);
  assert.equal(source.proxy.height, 720);
  assert.equal(source.proxy.width, 1280);
  assert.equal(source.proxy.keyframeStep, 0.5);
  const proxyFile = path.join(cache, source.proxy.file);
  snap = await service.snapshot();
  const shown = snap.model.recordings.find((r) => r.id === b).proxy;
  assert.equal(shown.state, 'ready');
  assert.match(shown.url, /^media:\/\//);
  assert.equal(shown.bytes, source.proxy.bytes);
  assert.deepEqual(await leftovers(), [], 'No segment or partial files are left');

  // Independent packet check: same frames, keyframes on source keyframes and every 0.5 s.
  const original = await packets(second),
    made = await packets(proxyFile);
  const start = original[0].t;
  assert.equal(made.length, original.length, 'Same number of frames');
  assert.equal(made[0].t, 0, 'The proxy starts at 0 (the recording’s position 0)');
  for (let i = 0; i < made.length; i++) {
    assert.ok(Math.abs(made[i].t - (original[i].t - start)) < 1 / 120, `frame ${i} time`);
    if (original[i].key) assert.ok(made[i].key, `keyframe at source keyframe ${original[i].t}`);
  }
  const keyTimes = made.filter((p) => p.key).map((p) => p.t);
  for (let i = 1; i < keyTimes.length; i++)
    assert.ok(keyTimes[i] - keyTimes[i - 1] <= 0.5 + 1 / 30 + 1e-6, `gap at ${keyTimes[i - 1]}`);
  for (let t = 0; t < 20; t += 0.5)
    assert.ok(
      keyTimes.some((k) => Math.abs(k - t) < 1 / 60),
      `keyframe at ${t} s`,
    );
  results.keyframes = keyTimes.length;
  results.frames = made.length;

  // Asked from the chip: a user job; it gives way to playback and carries on afterwards.
  const startedAt = Date.now();
  snap = await service.makeProxies(project, [a]);
  assert.equal(proxyJobs(a)[0].origin, 'user');
  await until(() => proxyJobs(a)[0].progress > 0.1, 'proxy progress');
  service.previewPlaying(true);
  await until(
    () => proxyJobs(a)[0].state === 'queued' && proxyJobs(a)[0].progress > 0,
    'proxy giving way to playback',
  );
  const paused = proxyJobs(a)[0];
  assert.equal(paused.message, 'Paused: preview playing');
  const keptSegments = (await readdir(cache)).filter((n) =>
    /-s\d{4}-proxy-720p\.partial\.mp4$/.test(n),
  );
  assert.ok(keptSegments.length >= 1, 'Segments made before pausing are kept');
  await sleep(300);
  assert.equal(proxyJobs(a)[0].state, 'queued', 'It stays paused while playback runs');
  service.previewPlaying(false);
  await idle();
  assert.equal(proxyJobs(a)[0].state, 'succeeded', JSON.stringify(proxyJobs(a)[0]));
  assert.ok(proxyJobs(a)[0].progress === 1);
  results.pauseResume = { keptSegments: keptSegments.length, ms: Date.now() - startedAt };
  assert.deepEqual(await leftovers(), []);

  // Already ready at this size: Make proxy for the batch skips it.
  const before = jobs().length;
  await service.makeProxies(project, [a, b]);
  assert.equal(jobs().length, before, 'Ready proxies at this size are kept');

  // Make again replaces the ready proxy.
  const old = service.store.sources().find((x) => x.id === a).proxy;
  await service.makeProxies(project, [a], true);
  await idle();
  const remade = service.store.sources().find((x) => x.id === a).proxy;
  assert.equal(proxyJobs(a)[0].state, 'succeeded');
  assert.notEqual(remade.made, old.made, 'Make again makes a new proxy');

  // Stop making while it runs: the partial proxy and its segments are removed.
  await service.importFiles(project, batch, [long], { game: 1, mic: null });
  await idle();
  const c = service.store.data.model.recordings.find((r) => ![a, b].includes(r.id)).id;
  await service.makeProxies(project, [c]);
  await until(
    () => proxyJobs(c)[0].state === 'running' && proxyJobs(c)[0].progress > 0.1,
    'long proxy progress',
  );
  await service.job(project, proxyJobs(c)[0].id, 'cancel');
  assert.equal(proxyJobs(c)[0].state, 'cancelled');
  assert.equal(proxyJobs(c)[0].message, 'Stopped; the partial proxy was removed');
  assert.deepEqual(await leftovers(), [], 'Stopping removes partial files');
  assert.equal(service.store.sources().find((x) => x.id === c).proxy, undefined);

  // A paused job that is stopped also removes its kept segments.
  await service.makeProxies(project, [c]);
  await until(() => proxyJobs(c)[0].progress > 0.1, 'progress before pause');
  service.previewPlaying(true);
  await until(() => proxyJobs(c)[0].state === 'queued', 'pause');
  await service.job(project, proxyJobs(c)[0].id, 'cancel');
  service.previewPlaying(false);
  assert.deepEqual(await leftovers(), [], 'Stopping a paused proxy removes its segments');

  // A proxy file deleted outside the app shows as missing; Make proxy makes it again, and
  // segments a crashed run left behind are removed when the next run starts.
  const aFile = path.join(cache, service.store.sources().find((x) => x.id === a).proxy.file);
  await rm(aFile);
  const shownMissing = (await service.snapshot()).model.recordings.find((r) => r.id === a).proxy;
  assert.equal(shownMissing.state, 'missing');
  await assert.rejects(service.proxyLocation(project, a), /missing/);
  const fp = service.store.sources().find((x) => x.id === a).fingerprint;
  const crashed = path.join(cache, `${a}-${fp}-0badc0de-s0000-proxy-720p.partial.mp4`);
  await writeFile(crashed, 'left by a crashed run');
  await service.makeProxies(project, [a]);
  await idle();
  assert.equal(proxyJobs(a)[0].state, 'succeeded', JSON.stringify(proxyJobs(a)[0]));
  assert.ok(existsSync(aFile), 'The missing proxy is made again');
  assert.ok(!existsSync(crashed), 'A crashed run’s segment is removed');
  // Forget the missing proxy: the record goes even though the file is already gone.
  await rm(aFile);
  await service.removeProxy(project, a);
  assert.equal(service.store.sources().find((x) => x.id === a).proxy, undefined);
  await service.makeProxies(project, [a]);
  await idle();

  // Remove and Show in folder; a removed proxy is gone from disk and from the project.
  assert.equal(await service.proxyLocation(project, b), proxyFile);
  await service.removeProxy(project, b);
  assert.ok(!existsSync(proxyFile));
  assert.equal(
    (await service.snapshot()).model.recordings.find((r) => r.id === b).proxy.state,
    'none',
  );
  await assert.rejects(service.proxyLocation(project, b), /missing/);

  // A 1080p proxy at the project's new size.
  await service.setProxySettings(project, { onImport: 'ask', height: 1080 });
  await service.makeProxies(project, [b]);
  await idle();
  const big = service.store.sources().find((x) => x.id === b).proxy;
  assert.equal(big?.height, 1080, JSON.stringify(proxyJobs(b)[0]));
  assert.equal(big.width, 1920);

  // Never: nothing can be made, and an import's checkbox is ignored.
  await service.setProxySettings(project, { onImport: 'never', height: 1080 });
  await assert.rejects(service.makeProxies(project, [a]), /Proxies are off/);
  await assert.rejects(
    service.importFiles(project, batch, [first], { game: 1, mic: null, proxy: 'yes' }),
    /proxies during this import/,
  );
  // proxy-ui.mjs opens this project on the default settings: the second recording with a ready
  // 1080p proxy, the first with a 720p one, the long one without.
  await service.setProxySettings(project, { onImport: 'ask', height: 1080 });
  await writeFile(
    path.join(testPath('proxy-native'), 'latest-native.json'),
    JSON.stringify({ file, dir, ready: b, small: a, long: c }, null, 2),
  );
  console.log(JSON.stringify({ status: 'passed', ...results }, null, 2));
} finally {
  await service.close();
}
