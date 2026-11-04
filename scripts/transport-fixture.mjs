// Build the 4K transport fixture for transport-regression-checks.mjs and the transport studies:
// a project holding a copy of one real 4K AV1 recording (game and mic tracks) and a short
// synthetic clock clip, written to VIRTUAL_CUT_TRANSPORT_FIXTURE with latest-fixture.json.
//
//   node scripts/transport-fixture.mjs <recording>
//
// <recording> (or VIRTUAL_CUT_TRANSPORT_SOURCE) should itself be a disposable copy. It is only
// read: the fixture imports its own copy, and the checks open copies of the fixture project.
// The recording must run for at least 160 seconds (the check scans back from 150 s).
import { mkdir, mkdtemp, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { require, requiredSetting } from './shared.mjs';
const { ProjectService } = require('../dist-electron/project-service.cjs');
const { launchTool } = require('../dist-electron/media-inspection.cjs');
const recording =
  process.argv[2] ||
  requiredSetting('VIRTUAL_CUT_TRANSPORT_SOURCE', 'a disposable copy of a 4K AV1 recording');
const root = path.resolve(
  requiredSetting('VIRTUAL_CUT_TRANSPORT_FIXTURE', 'the folder that keeps the transport fixture'),
);
await mkdir(root, { recursive: true });
const dir = await mkdtemp(path.join(root, 'fixture-'));
const source = path.join(dir, '4K AV1 gameplay.mp4');
await copyFile(recording, source);
// The second recording only needs a different picture size and length: an 8 s 640×360 clock.
const short = path.join(dir, 'Short clock.mkv');
await launchTool(
  process.env.VIRTUAL_CUT_FFMPEG || 'ffmpeg',
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
    short,
  ],
  new AbortController().signal,
);
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
  const longest = Math.max(...p.model.recordings.map((r) => r.duration || 0));
  assert(longest >= 160, `The recording runs ${longest} s; it needs 160 s or more.`);
  await writeFile(
    path.join(root, 'latest-fixture.json'),
    JSON.stringify(
      { dir, file: p.project.file, source, short, copiedFrom: path.resolve(recording) },
      null,
      2,
    ),
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
