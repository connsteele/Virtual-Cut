import { mkdir, mkdtemp, copyFile, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { require } from './shared.mjs';
const { ProjectService } = require('../dist-electron/project-service.cjs');
const root = 'G:/GPT/Work/virtual-cut/transport-investigation';
await mkdir(root, { recursive: true });
const dir = await mkdtemp(path.join(root, 'fixture-'));
// Only disposable copies are imported and exercised.
const source = path.join(dir, '4K AV1 gameplay.mp4');
await copyFile('G:/GPT/Work/virtual-cut/full-resolution-demo/videos/r1.mp4', source);
const old = JSON.parse(
  await readFile('G:/GPT/Work/virtual-cut/filmstrip/latest-native.json', 'utf8'),
);
const short = path.join(dir, 'Short clock.mkv');
await copyFile(old.source, short);
const service = new ProjectService(path.join(dir, 'profile'), path.join(dir, 'tools'));
try {
  let p = await service.open(path.join(dir, 'transport.vcut'), {
    name: 'Transport regression',
    destination: dir,
    cache: path.join(dir, 'cache'),
  });
  await service.importFiles(p.project.id, p.activeBatchId, [source, short], { game: 1, mic: 2 });
  for (const until = Date.now() + 180000; Date.now() < until;) {
    p = await service.snapshot();
    if (!p.jobs.some((j) => ['queued', 'running'].includes(j.state))) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert(
    p.jobs.every((j) => j.state === 'succeeded'),
    JSON.stringify(p.jobs),
  );
  await writeFile(
    path.join(root, 'latest-fixture.json'),
    JSON.stringify({ dir, file: p.project.file, source, short }, null, 2),
  );
  console.log(
    JSON.stringify({
      dir,
      recordings: p.model.recordings.map((r) => ({
        id: r.id,
        duration: r.duration,
        audio: r.audioTracks?.map((t) => ({
          index: t.index,
          codec: t.codec,
          ready: !!t.previewUrl,
        })),
      })),
    }),
  );
} finally {
  await service.close();
}
