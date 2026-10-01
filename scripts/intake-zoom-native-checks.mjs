import { testPath } from './test-paths.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const { ProjectService } = require('../dist-electron/project-service.cjs');
const { DroppedImports } = require('../dist-electron/dropped-imports.cjs');
const root = testPath('standalone-tools');
await mkdir(root, { recursive: true });
const dir = await mkdtemp(path.join(root, 'native-'));
const first = path.join(dir, 'original.mkv'),
  second = path.join(dir, 'new-recording.mkv'),
  invalid = path.join(dir, 'notes.txt');
await new Promise((resolve, reject) => {
  const child = spawn(
    process.env.VIRTUAL_CUT_FFMPEG || 'ffmpeg',
    [
      '-v',
      'error',
      '-nostdin',
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
      first,
    ],
    {
      windowsHide: true,
      env: {
        ...process.env,
        TEMP: process.env.TEMP || 'G:/GPT/Temp',
        TMP: process.env.TEMP || 'G:/GPT/Temp',
      },
    },
  );
  let error = '';
  child.stderr.on('data', (data) => {
    error += data;
  });
  child.on('error', reject);
  child.on('exit', (code) => (code === 0 ? resolve() : reject(Error(error))));
});
await copyFile(first, second);
await writeFile(invalid, 'Not footage');
const hash = (file) =>
  readFile(file).then((data) => createHash('sha256').update(data).digest('hex'));
const before = await hash(first);
const file = path.join(dir, 'standalone.vcut'),
  service = new ProjectService(path.join(dir, 'profile'), path.join(dir, 'tools'));
const drops = new DroppedImports();
let p = await service.open(file, {
  name: 'Standalone tools review',
  destination: dir,
  cache: path.join(dir, 'cache'),
});
const id = p.project.id,
  batch = p.activeBatchId;
const entries = [first, second, invalid, dir, path.join(dir, 'missing.mkv'), first].map((file) => ({
  name: path.basename(file),
  path: file,
}));
try {
  await assert.rejects(drops.stage(id, batch, []));
  const unsupported = await drops.stage(id, batch, [{ name: 'generated.mkv', path: '' }]);
  assert.equal(unsupported.count, 0);
  assert.equal(unsupported.token, '');
  let offer = await drops.stage(id, batch, entries);
  assert.equal(offer.count, 2);
  assert.equal(offer.skipped, 4);
  assert.equal((await service.snapshot()).model.recordings.length, 0, 'Staging does not import');
  assert.throws(() => drops.take(id, 'other-batch', offer.token));
  drops.discard(offer.token);
  assert.throws(() => drops.take(id, batch, offer.token));
  offer = await drops.stage(id, batch, entries);
  const now = Date.now;
  Date.now = () => now() + 11 * 60 * 1000;
  try {
    assert.throws(() => drops.take(id, batch, offer.token));
  } finally {
    Date.now = now;
  }
  offer = await drops.stage(id, batch, entries);
  const paths = drops.take(id, batch, offer.token);
  assert.throws(() => drops.take(id, batch, offer.token));
  // The picker and drop route share registration, audio defaults, and inspection jobs.
  await service.importFiles(id, batch, [paths[0]], { game: 1, mic: 2 });
  for (let until = Date.now() + 90000; Date.now() < until;) {
    p = await service.snapshot();
    if (!p.jobs.some((j) => ['running', 'queued'].includes(j.state))) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(p.model.recordings[0].availability, 'ready');
  assert.equal(p.model.recordings[0].micTrack, 2);
  const rid = p.model.recordings[0].id;
  const beforeModel = p.model,
    model = structuredClone(beforeModel);
  model.clips = [
    {
      id: 'zoom-a',
      rid,
      name: 'Zoom first',
      start: 1,
      end: 5,
      folder: '_Review',
      include: true,
      note: '',
    },
    {
      id: 'zoom-b',
      rid,
      name: 'Zoom overlap',
      start: 4,
      end: 7,
      folder: '_Review',
      include: true,
      note: '',
    },
  ];
  model.markers[rid] = [
    {
      id: 'zoom-marker',
      time: 4.5,
      name: 'Zoom marker',
      category: 'Context',
      color: 'Blue',
      topic: '',
      note: 'Retain timing',
    },
  ];
  await service.save(id, beforeModel, model);
  assert.equal(await hash(first), before);
  await writeFile(
    path.join(root, 'latest-native.json'),
    JSON.stringify({ dir, file, first, second, invalid, hash: before, rid, batch }, null, 2),
  );
  console.log(`Drop boundaries and disposable fixture passed: ${dir}`);
} finally {
  await service.close();
}
