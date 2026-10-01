import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rename,
  readdir,
  stat,
  unlink,
  symlink,
  lstat,
  rmdir,
} from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { testPath } from './test-paths.mjs';
const require = createRequire(import.meta.url);
const { ProjectService } = require('../dist-electron/project-service.cjs');
const { exportClip, verifyPublished, fileHash } = require('../dist-electron/clip-export.cjs');
const root = testPath('filing');
await mkdir(root, { recursive: true });
const dir = await mkdtemp(path.join(root, 'native-'));
const command = (tool, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(tool, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let error = '';
    child.stderr.on('data', (d) => (error += d));
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(Error(error))));
  });
const source = path.join(dir, 'source.mkv'),
  dest = path.join(dir, 'outputs'),
  cache = path.join(dir, 'cache'),
  file = path.join(dir, 'filing.vcut');
await mkdir(dest);
await command('ffmpeg', [
  '-v',
  'error',
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=320x180:rate=30:duration=10',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=700:sample_rate=48000:duration=10',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=1700:sample_rate=48000:duration=10',
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
  '60',
  '-keyint_min',
  '60',
  '-sc_threshold',
  '0',
  '-c:a',
  'aac',
  source,
]);
const originalHash = await fileHash(source);
const service = new ProjectService(path.join(dir, 'profile'), '');
await service.open(file, { name: 'M2 filing checks', destination: dest, cache });
const id = service.store.data.project.id,
  batch = service.store.data.activeBatchId;
const wait = async () => {
  for (let i = 0; i < 1200; i++) {
    if (!service.store.jobs().some((j) => ['queued', 'running'].includes(j.state))) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw Error('Filing job timed out');
};
await service.importFiles(id, batch, [source], { game: 1, mic: 2 });
await wait();
assert.equal(service.store.jobs().filter((j) => j.state === 'failed').length, 0);
const rid = service.store.data.model.recordings[0].id;
const edit = async (fn) => {
  const before = structuredClone(service.store.data.model),
    after = structuredClone(before);
  fn(after);
  return service.save(id, before, after);
};
await edit((m) => {
  m.clips = [
    { ...m.clips[0], name: 'First', start: 1.1, end: 3.1, folder: 'Story/First' },
    {
      ...m.clips[0],
      id: 'second',
      name: 'Second',
      start: 4.2,
      end: 5.4,
      folder: 'Mechanics',
      note: 'Searchable café\nSecond line',
    },
  ];
  m.markers[rid] = [
    {
      id: 'blue',
      time: 2,
      name: 'First marker',
      category: 'Story',
      color: 'Blue',
      topic: 'Story',
      note: 'Two lines\n日本語',
    },
    {
      id: 'red',
      time: 5,
      name: 'Red marker',
      category: 'Mechanic',
      color: 'Red',
      topic: 'Combat',
      note: 'Range note\nLine two',
    },
    { id: 'boundary', time: 6, name: 'End excluded', category: 'Context', topic: '' },
  ];
});
const ids = service.store.data.model.clips.map((c) => c.id);
await service.acceptReview(id, ids[0]);
await service.acceptReview(id, ids[1]);
const plan = await service.filingPlan(id, batch);
assert.equal(plan.rows.length, 2);
assert.ok(plan.rows.every((r) => !r.issues.length));
await assert.rejects(() => service.fileQueue(id, plan.id, false), /Confirm/);
// A changed review invalidates the frozen plan; a new plan needs reacceptance.
await edit((m) => (m.clips[0].note = 'Changed'));
await assert.rejects(() => service.fileQueue(id, plan.id, true), /changed/);
await service.acceptReview(id, ids[0]);
const fresh = await service.filingPlan(id, batch);
const submission = service.fileQueue(id, fresh.id, true);
await assert.rejects(() => service.fileQueue(id, fresh.id, true), /plan/);
await submission;
await wait();
const records = service.store.exports().filter((e) => e.filing);
assert.equal(records.length, 2);
for (const e of records) {
  assert.equal(e.state, 'verified', e.message);
  assert.equal(e.filing.state, 'complete');
  await verifyPublished(e);
}
let snapshot = await service.snapshot();
assert.ok(snapshot.model.clips.every((c) => c.filed));
assert.equal(snapshot.library.length, 2);
assert.ok(snapshot.destinations.rows.every((r) => !r.issues.length));
assert.equal(await fileHash(source), originalHash);
const first = records.find((e) => e.plan.clipId === ids[0]),
  second = records.find((e) => e.plan.clipId === ids[1]);
const receipt = JSON.parse(await readFile(second.metadata, 'utf8'));
assert.equal(receipt.markers.length, 1);
assert.equal(receipt.markers[0].colorName, 'Red');
assert.equal(receipt.markers[0].note, 'Range note\nLine two');
assert.ok(Math.abs(receipt.markers[0].clipTime - (5 - second.verification.actual.start)) < 1e-6);
assert.ok(
  Math.abs((await stat(second.output)).mtimeMs - ((await stat(source)).mtimeMs + 4200)) < 2,
);
assert.equal((await service.filingPlan(id, batch)).rows.length, 0);
await assert.rejects(() => service.fileQueue(id, fresh.id, true), /plan/);
// Restore and Undo cannot unpublish verified work or invent a receipt.
await edit((m) => (m.clips[0].note = 'Later edits'));
snapshot = await service.snapshot();
assert.equal(snapshot.model.clips[0].filed, false);
assert.equal(snapshot.model.clips[1].filed, true);
await service.history(id, 'undo');
assert.equal((await service.snapshot()).model.clips[0].filed, true);
const restoreId = service.store.snapshot().saves.find((s) => s.kind === 'manual').id;
await service.restore(id, restoreId);
assert.equal((await service.snapshot()).library.length, 2);
await service.close();
await rename(source, source + '.offline');
await service.open(file);
snapshot = await service.snapshot();
assert.equal(snapshot.library.length, 2);
assert.ok(snapshot.model.clips.every((c) => c.filed));
assert.ok((await service.retainedMedia(id, second.plan.id)).url.startsWith('media://video/'));
// Moving a completed pair only changes native output paths after full identity verification.
const moved = path.join(dir, 'moved');
await mkdir(moved);
const nextFile = path.join(moved, path.basename(second.output));
await rename(second.output, nextFile);
await rename(second.metadata, nextFile + '.vcut.json');
assert.equal(
  (await service.snapshot()).library.find((c) => c.exportId === second.plan.id).available,
  false,
);
await assert.rejects(() => service.relinkExport(id, second.plan.id, first.output), /match/);
await service.relinkExport(id, second.plan.id, nextFile);
assert.equal((await service.retainedMedia(id, second.plan.id)).output, nextFile);
assert.equal(
  (await service.snapshot()).library.find((c) => c.exportId === second.plan.id).folder,
  moved,
  'Library groups a relinked outside-root output by its current folder',
);
await service.close();
await service.open(file);
assert.equal(
  (await service.snapshot()).library.find((c) => c.exportId === second.plan.id).output,
  nextFile,
);
assert.equal(
  (await service.snapshot()).library.find((c) => c.exportId === second.plan.id).folder,
  moved,
  'Current output folder survives reopening',
);
await rename(source + '.offline', source);
await service.snapshot();
// Interrupted publication: the video alone is not Done; retry finishes the exact pair.
await edit((m) => {
  m.clips.push({
    ...m.clips[0],
    id: 'interrupted',
    name: 'Interrupted',
    folder: 'Recovery',
    accepted: false,
    acceptedKey: undefined,
  });
});
await service.acceptReview(id, 'interrupted');
const partialPlan = await service.filingPlan(id, batch);
const saved = service.filingPlans.get(partialPlan.id).records[0];
await mkdir(path.dirname(saved.output), { recursive: true });
const controller = new AbortController();
let guards = 0;
await assert.rejects(
  () =>
    exportClip(
      { ...saved, cleanGameConfirmed: true },
      { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' },
      controller.signal,
      (record) => service.store.putExport(record),
      async () => {
        if (++guards === 3) throw Error('Injected interruption after video publication');
      },
    ),
  /Injected/,
);
assert.ok(await stat(saved.output));
assert.equal(await stat(saved.metadata).catch(() => null), null);
assert.equal(
  (await service.snapshot()).model.clips.find((c) => c.id === 'interrupted').filed,
  false,
);
await service.checkpoint(id);
await service.close();
await service.open(file);
const interrupted = service.store.exports().find((e) => e.plan.clipId === 'interrupted');
assert.equal(interrupted.state, 'interrupted');
await service.job(id, interrupted.plan.id, 'retry');
await wait();
assert.equal(
  service.store.exports().find((e) => e.plan.id === interrupted.plan.id).filing.state,
  'complete',
);
assert.equal(
  (await readdir(path.dirname(saved.output))).filter((f) => f.startsWith('.vcut-')).length,
  0,
);
// Collision after preview must preserve the unrelated file and refuse to start.
await edit((m) =>
  m.clips.push({
    ...m.clips[0],
    id: 'collision',
    name: 'Collision',
    folder: 'Recovery',
    accepted: false,
    acceptedKey: undefined,
  }),
);
await service.acceptReview(id, 'collision');
const collision = await service.filingPlan(id, batch),
  target = collision.rows[0].path;
await writeFile(target, 'unrelated');
await assert.rejects(() => service.fileQueue(id, collision.id, true), /destination/);
assert.equal(await readFile(target, 'utf8'), 'unrelated');
await unlink(target);
// Cancellation and stale queued jobs never finish, even if replayed later.
await service.acceptReview(id, 'collision');
const cancelled = await service.filingPlan(id, batch);
service.switching = true;
await service.fileQueue(id, cancelled.id, true);
await service.cancelFiling(id, cancelled.id);
const cancelledRecord = service.store.exports().find((e) => e.filing?.queueId === cancelled.id);
assert.equal(cancelledRecord.state, 'cancelled');
assert.equal(await stat(cancelledRecord.output).catch(() => null), null);
await edit((m) => (m.clips.find((c) => c.id === 'collision').held = true));
await assert.rejects(() => service.job(id, cancelledRecord.plan.id, 'retry'), /held/);
service.switching = false;
// Individual cancellation leaves peer jobs alone: cancel one queued item and
// the currently active writer, then let the remaining item finish normally.
const individualIds = ['cancel-queued', 'cancel-active-a', 'cancel-active-b'];
await edit((m) => {
  for (const clipId of individualIds)
    m.clips.push({
      ...m.clips[0],
      id: clipId,
      name: clipId,
      folder: 'Individual cancel',
      accepted: false,
      acceptedKey: undefined,
    });
});
for (const clipId of individualIds) await service.acceptReview(id, clipId);
const individualPlan = await service.filingPlan(id, batch);
service.switching = true;
await service.fileQueue(id, individualPlan.id, true);
const individualRecords = () =>
  service.store.exports().filter((e) => e.filing?.queueId === individualPlan.id);
const queuedOne = individualRecords().find((e) => e.plan.clipId === 'cancel-queued');
await service.job(id, queuedOne.plan.id, 'cancel');
assert.equal(individualRecords().filter((e) => e.state === 'cancelled').length, 1);
assert.equal(individualRecords().filter((e) => e.state === 'queued').length, 2);
service.switching = false;
service.pump();
const activeId = service.active.id;
await service.job(id, activeId, 'cancel');
await wait();
assert.equal(individualRecords().filter((e) => e.state === 'cancelled').length, 2);
const survivor = individualRecords().find((e) => e.state === 'verified');
assert(survivor, JSON.stringify(individualRecords()));
await verifyPublished(survivor);
for (const record of individualRecords().filter((e) => e.state === 'cancelled')) {
  assert.equal(await stat(record.output).catch(() => null), null);
  assert.equal(await stat(record.metadata).catch(() => null), null);
}
await edit((m) => {
  for (const record of individualRecords().filter((e) => e.state === 'cancelled'))
    m.clips.find((c) => c.id === record.plan.clipId).held = true;
});
// A folder replaced by a junction after preview must not receive any output.
const trap = path.join(dest, 'Trap'),
  outside = path.join(dir, 'outside');
await mkdir(trap);
await mkdir(outside);
await edit((m) =>
  m.clips.push({
    ...m.clips[0],
    id: 'junction',
    name: 'Junction',
    folder: 'Trap',
    accepted: false,
    acceptedKey: undefined,
  }),
);
await service.acceptReview(id, 'junction');
const junctionPlan = await service.filingPlan(id, batch);
await rename(trap, trap + '-original');
await symlink(outside, trap, 'junction');
await assert.rejects(() => service.fileQueue(id, junctionPlan.id, true), /destination/);
assert.deepEqual(await readdir(outside), []);
assert.ok((await lstat(trap)).isSymbolicLink());
await rmdir(trap);
await rename(trap + '-original', trap);
await edit((m) => (m.clips.find((c) => c.id === 'junction').held = true));
// Kill the writer after the video link is published, without normal cleanup.
await edit((m) =>
  m.clips.push({
    ...m.clips[0],
    id: 'killed',
    name: 'Killed writer',
    folder: 'Recovery',
    accepted: false,
    acceptedKey: undefined,
  }),
);
await service.acceptReview(id, 'killed');
const killPlan = await service.filingPlan(id, batch);
service.switching = true;
await service.fileQueue(id, killPlan.id, true);
const killRecord = service.store.exports().find((e) => e.filing?.queueId === killPlan.id);
await service.close();
const writer = path.join(dir, 'writer.cjs');
await writeFile(
  writer,
  `const {ProjectService}=require(${JSON.stringify(require.resolve('../dist-electron/project-service.cjs'))});
const {exportClip}=require(${JSON.stringify(require.resolve('../dist-electron/clip-export.cjs'))});
(async()=>{ const s=new ProjectService(${JSON.stringify(path.join(dir, 'writer-profile'))},''); await s.open(${JSON.stringify(file)});
const record=s.store.exports().find(e=>e.plan.id===${JSON.stringify(killRecord.plan.id)}); let n=0;
const job=s.store.jobs().find(j=>j.id===record.plan.id); s.store.putJob({...job,state:'running'});
await exportClip(record,{ffmpeg:'ffmpeg',ffprobe:'ffprobe'},new AbortController().signal,r=>s.store.putExport(r),async()=>{if(++n===3){setInterval(()=>{},30000);console.log('PUBLICATION-READY');await new Promise(()=>{});}});
})().catch(e=>{console.error(e);process.exit(1)});`,
);
const child = spawn(process.execPath, [writer], {
  windowsHide: true,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let writerError = '';
child.stderr.on('data', (b) => (writerError += b));
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    reject(Error('Writer did not reach publication: ' + writerError));
  }, 30000);
  child.on('error', (e) => {
    clearTimeout(timer);
    reject(e);
  });
  child.on('exit', () => {
    clearTimeout(timer);
    reject(Error('Writer exited early: ' + writerError));
  });
  child.stdout.on('data', (b) => {
    if (String(b).includes('PUBLICATION-READY')) {
      clearTimeout(timer);
      resolve();
    }
  });
});
const killed = new Promise((resolve) => child.once('exit', resolve));
child.kill('SIGKILL');
await killed;
assert.ok(await stat(killRecord.output));
assert.equal(await stat(killRecord.metadata).catch(() => null), null);
assert.ok(await stat(killRecord.output + '.vcut-lock'));
const unrelated = path.join(path.dirname(killRecord.output), '.vcut-unrelated.keep');
await writeFile(unrelated, 'Preserve');
await service.open(file);
assert.equal(
  service.store.exports().find((e) => e.plan.id === killRecord.plan.id).state,
  'interrupted',
);
assert.equal((await service.snapshot()).model.clips.find((c) => c.id === 'killed').filed, false);
await service.job(id, killRecord.plan.id, 'retry');
await wait();
const recovered = service.store.exports().find((e) => e.plan.id === killRecord.plan.id);
assert.equal(recovered.filing.state, 'complete', recovered.message);
await verifyPublished(recovered);
assert.equal(await readFile(unrelated, 'utf8'), 'Preserve');
assert.equal(
  (await readdir(path.dirname(killRecord.output))).filter((f) =>
    f.startsWith('.vcut-' + killRecord.plan.id),
  ).length,
  0,
);
await service.close();
await writeFile(
  path.join(root, 'latest-native.json'),
  JSON.stringify(
    { file, dir, dest, ids, first: first.plan.id, second: second.plan.id, nextFile, originalHash },
    null,
    2,
  ),
);
console.log(
  'Filing: accepted plans, duplicate submission, current revision, copied packets, annotations, dates, original preservation, Done receipts, Undo/restore/reopen, offline originals, retained preview, move/relink, interrupted publication, collision, junction swap, cancellation and forced writer termination/recovery passed.',
);
