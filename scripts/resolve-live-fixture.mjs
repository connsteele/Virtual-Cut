// Disposable media for live Resolve verification. This does not connect to Resolve.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { require } from './shared.mjs';
const { ProjectService } = require('../dist-electron/project-service.cjs');
const dir = path.resolve(
  process.env.VIRTUAL_CUT_RESOLVE_FIXTURE ||
    'G:/GPT/Work/virtual-cut/m2-completion/resolve-validation',
);
await mkdir(dir, { recursive: true });
const source = path.join(dir, 'source-60.mp4');
await new Promise((resolve, reject) => {
  const child = spawn(
    'ffmpeg',
    [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=60:duration=4',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=700:sample_rate=48000:duration=4',
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-g',
      '120',
      '-sc_threshold',
      '0',
      '-c:a',
      'aac',
      '-n',
      source,
    ],
    { windowsHide: true, stdio: 'inherit' },
  );
  child.on('error', reject);
  child.on('exit', (code) => (code === 0 ? resolve() : reject(Error('Fixture generation failed'))));
});
const service = new ProjectService(path.join(dir, 'profile'), '');
await service.open(path.join(dir, 'test.vcut'), {
  name: 'Resolve metadata verification',
  destination: dir,
  cache: path.join(dir, 'cache'),
});
const id = service.store.data.project.id,
  batch = service.store.data.activeBatchId;
const wait = async () => {
  for (let i = 0; i < 1200; i++) {
    if (!service.store.jobs().some((j) => ['queued', 'running'].includes(j.state))) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw Error('Timed out');
};
try {
  await service.importFiles(id, batch, [source], { game: 1, mic: null });
  await wait();
  const before = structuredClone(service.store.data.model),
    after = structuredClone(before),
    clip = after.clips[0];
  clip.name = 'multiLineMarkers';
  clip.start = 0;
  clip.end = 4;
  after.markers[clip.rid] = [
    {
      id: 'review-line',
      name: 'review line note',
      time: 0.554444,
      color: 'Blue',
      category: 'Story',
      topic: '',
      note: 'First line\nSecond line — 日本語',
    },
    {
      id: 'two-line',
      name: '2 line note',
      time: 1.242176,
      color: 'Red',
      category: 'Mechanic',
      topic: '',
      note: 'Two line note\nSecond line',
    },
  ];
  await service.save(id, before, after);
  const plan = await service.exportPlan(id, clip.id, 'mp4');
  await service.startExport(id, plan.id, path.join(dir, 'multiLineMarkers.mp4'), true);
  await wait();
  const record = service.store.exports().find((e) => e.plan.id === plan.id);
  if (record.state !== 'verified') throw Error(record.message);
  await writeFile(
    path.join(dir, 'fixture.json'),
    JSON.stringify(
      {
        record,
        copiedFromUser: false,
        reason:
          'Earlier user-review output files were unavailable; same reviewed chapter times reconstructed on disposable 60 fps footage.',
      },
      null,
      2,
    ),
  );
  console.log('Resolve 60 fps fixture:', dir);
} finally {
  await service.close();
}
