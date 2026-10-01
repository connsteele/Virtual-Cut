import { testPath } from './test-paths.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { ProjectService } = require('../dist-electron/project-service.cjs');
const root = testPath('range-markers');
await mkdir(root, { recursive: true });
const dir = await mkdtemp(path.join(root, 'native-')),
  source = path.join(dir, 'audio-notes.mkv');
async function ffmpeg(args) {
  await new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-v', 'error', '-nostdin', ...args], {
      windowsHide: true,
      env: {
        ...process.env,
        TEMP: process.env.TEMP || 'G:/GPT/Temp',
        TMP: process.env.TEMP || 'G:/GPT/Temp',
      },
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
  p = await settled();
  const rid = p.model.recordings[0].id;
  const before = structuredClone(p.model),
    after = structuredClone(before);
  after.clips = [
    { ...after.clips[0], start: 2.2, end: 5.4, name: 'Range export', folder: '_Review' },
  ];
  after.markers[rid] = [
    {
      id: 'cross-start',
      time: 1,
      end: 3,
      name: 'Cross start',
      note: 'First line\nSecond line',
      color: 'Green',
      category: 'Context',
      topic: '',
    },
    {
      id: 'inside',
      time: 3.2,
      end: 4.2,
      name: 'Inside',
      color: 'Red',
      category: 'Story',
      topic: '',
    },
    {
      id: 'cross-end',
      time: 4.5,
      end: 7,
      name: 'Cross end',
      color: 'Blue',
      category: 'Context',
      topic: '',
    },
    { id: 'point', time: 4, name: 'Point', color: 'Blue', category: 'Context', topic: '' },
    {
      id: 'outside',
      time: 0,
      end: 1,
      name: 'Outside',
      color: 'Blue',
      category: 'Context',
      topic: '',
    },
  ];
  await service.save(id, before, after);
  await service.checkpoint(id);
  await service.close();
  await service.open(file);
  assert.deepEqual(service.store.data.model.markers[rid], after.markers[rid]);
  const badBefore = structuredClone(service.store.data.model),
    bad = structuredClone(badBefore);
  bad.markers[rid][0].end = bad.markers[rid][0].time;
  await assert.rejects(() => service.save(id, badBefore, bad), /Invalid marker/);
  const outputs = [];
  for (const container of ['mp4', 'mkv']) {
    const plan = await service.exportPlan(id, after.clips[0].id, container);
    const output = path.join(dir, 'range-proof.' + container);
    await service.startExport(id, plan.id, output, true);
    await settled();
    const record = service.store.exports().find((e) => e.plan.id === plan.id);
    assert.equal(record.state, 'verified', record.message);
    const data = JSON.parse(await readFile(output + '.vcut.json', 'utf8'));
    assert.equal(data.version, 4);
    assert(
      Math.abs(data.verified.constantFrameDuration - 1 / 30) < 1e-8,
      'Frame-grid proof handles rounded MKV packet clocks',
    );
    assert.deepEqual(
      data.markers.map((m) => m.id),
      ['cross-start', 'inside', 'cross-end', 'point'],
    );
    for (const marker of data.markers.filter((m) => m.end != null)) {
      assert(marker.duration > 0);
      assert(Math.abs(marker.clipEnd - marker.clipTime - marker.duration) < 1e-6);
      assert(Math.abs(marker.containerEnd - marker.containerTime - marker.duration) < 1e-6);
    }
    assert.equal(data.markers[0].sourceTime, 1);
    assert.equal(data.markers[0].clipTime, 0);
    assert.equal(data.markers[2].sourceEnd, 7);
    assert.equal(data.markers[2].clipEnd, data.verified.actual.end - data.verified.actual.start);
    outputs.push({ container, output, markers: data.markers, verified: data.verified });
  }
  assert.equal(
    createHash('sha256')
      .update(await readFile(source))
      .digest('hex'),
    hash,
  );
  await writeFile(
    path.join(root, 'latest-native.json'),
    JSON.stringify({ file, rid, outputs, dir }, null, 2),
  );
  console.log('Range source persistence, validation and MP4/MKV intersection checks passed:', dir);
} finally {
  await service.close();
}
