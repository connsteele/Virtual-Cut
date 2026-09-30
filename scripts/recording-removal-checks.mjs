import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ProjectService } = require('../dist-electron/project-service.cjs');
const fixture = JSON.parse(
  await readFile('G:/GPT/Work/virtual-cut/m1-feedback/latest-native.json', 'utf8'),
);
const root = 'G:/GPT/Work/virtual-cut/m2-followup';
await mkdir(root, { recursive: true });
const dir = await mkdtemp(path.join(root, 'removal-'));
const first = path.join(dir, 'shared.mkv'),
  second = path.join(dir, 'exclusive.mkv');
await copyFile(fixture.source, first);
await copyFile(fixture.source, second);
const hash = async (file) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
const sourceHash = await hash(first);
const file = path.join(dir, 'removal.vcut');
const service = new ProjectService(path.join(dir, 'profile'), path.join(dir, 'tools'));
let p = await service.open(file, {
  name: 'Recording removal checks',
  destination: dir,
  cache: path.join(dir, 'cache'),
});
const id = p.project.id,
  batch = p.activeBatchId;
async function settled() {
  for (let end = Date.now() + 90000; Date.now() < end;) {
    const value = await service.snapshot();
    if (!value.jobs.some((j) => ['queued', 'running'].includes(j.state))) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error('Media jobs did not settle');
}
try {
  await service.importFiles(id, batch, [first, second], { game: 1, mic: 2 });
  p = await settled();
  assert(p.jobs.every((j) => j.state === 'succeeded'));
  const shared = p.model.recordings.find((r) => r.sourcePath === first);
  const exclusive = p.model.recordings.find((r) => r.sourcePath === second);
  assert.equal(await service.sourceLocation(id, shared.id), first);
  await assert.rejects(() => service.sourceLocation(id, '../../elsewhere'), /no longer in/);
  await assert.rejects(() => service.sourceLocation('other-project', shared.id));
  const edited = structuredClone(p.model);
  edited.recordings.forEach((r) => {
    r.context = 'Retain this recording context';
  });
  edited.clips.forEach((c) => {
    c.note = 'Retain this clip note';
  });
  edited.markers[exclusive.id] = [
    {
      id: 'removal-marker',
      time: 1,
      name: 'Keep on restore',
      note: 'Marker note',
      category: 'Context',
      topic: '',
      color: 'Cream',
    },
  ];
  edited.links.push({
    from: edited.clips.find((c) => c.rid === exclusive.id).id,
    to: edited.clips.find((c) => c.rid === shared.id).id,
    label: 'Related footage',
  });
  p = await service.save(id, p.model, edited);
  const originalClips = structuredClone(p.model.clips);
  const exclusiveMarkers = structuredClone(p.model.markers[exclusive.id]);
  const originalLinks = structuredClone(p.model.links);
  p = await service.batch(id, 'Other batch');
  const other = p.activeBatchId;
  await service.importFiles(id, other, [first]);
  await service.selectBatch(id, batch);
  await assert.rejects(
    () => service.removeRecording(id, 'unknown-batch', shared.id),
    /Batch not found/,
  );
  await assert.rejects(() => service.removeRecording(id, other, exclusive.id), /no longer in/);
  p = await service.removeRecording(id, batch, shared.id);
  assert.deepEqual(p.model.recordings.find((r) => r.id === shared.id).batchIds, [other]);
  assert.deepEqual(p.model.clips, originalClips, 'Removing shared membership preserves all edits');
  assert.equal(p.model.selectedRecordingId, exclusive.id);
  const clip = p.model.clips.find((c) => c.rid === exclusive.id);
  const plan = await service.exportPlan(id, clip.id, 'mkv');
  const output = path.join(dir, 'verified.mkv');
  await service.startExport(id, plan.id, output, true);
  p = await settled();
  assert.equal(p.exports.find((e) => e.plan.id === plan.id).state, 'verified');
  const outputHash = await hash(output),
    companionHash = await hash(output + '.vcut.json');
  const queued = await service.exportPlan(id, clip.id, 'mkv');
  // Hold the queue so removal covers a pending export deterministically.
  service.switching = true;
  await service.startExport(id, queued.id, path.join(dir, 'queued.mkv'), true);
  const cached = (await readdir(path.join(dir, 'cache'))).filter((name) =>
    name.startsWith(exclusive.id),
  );
  p = await service.removeRecording(id, batch, exclusive.id);
  assert(
    p.batches.some((b) => b.id === batch),
    'Removing its last recording keeps an empty batch',
  );
  assert.equal(p.model.selectedRecordingId, '');
  assert.equal(p.canUndo, false);
  assert(!p.model.recordings.some((r) => r.id === exclusive.id));
  assert(!p.model.clips.some((c) => c.rid === exclusive.id));
  assert(!p.model.markers[exclusive.id]);
  assert(!p.model.links.some((link) => link.from === clip.id || link.to === clip.id));
  assert(!service.store.sources().some((s) => s.id === exclusive.id));
  assert(!p.jobs.some((j) => j.sourceId === exclusive.id));
  assert.equal(p.exports.find((e) => e.plan.id === plan.id).state, 'verified');
  assert.equal(p.exports.find((e) => e.plan.id === queued.id).state, 'cancelled');
  assert.deepEqual(
    (await readdir(path.join(dir, 'cache'))).filter((name) => name.startsWith(exclusive.id)),
    cached,
  );
  const recovery = p.saves
    .filter((s) => s.kind === 'manual')
    .sort((a, b) => b.created.localeCompare(a.created))[0];
  await service.close();
  p = await service.open(file);
  assert(!p.model.recordings.some((r) => r.id === exclusive.id), 'Removal survives reopen');
  p = await service.restore(id, recovery.id);
  p = await settled();
  assert.deepEqual(p.model.clips, originalClips);
  assert.deepEqual(p.model.markers[exclusive.id], exclusiveMarkers);
  assert.deepEqual(p.model.links, originalLinks);
  assert.equal(
    p.model.recordings.find((r) => r.id === exclusive.id).context,
    'Retain this recording context',
  );
  assert(service.store.sources().some((s) => s.id === exclusive.id));
  const activeFile = path.join(dir, 'active.mkv');
  await copyFile(first, activeFile);
  p = await service.importFiles(id, batch, [activeFile]);
  const activeId = p.model.recordings.find((r) => r.sourcePath === activeFile).id;
  await service.removeRecording(id, batch, activeId);
  p = await settled();
  assert(
    !p.model.recordings.some((r) => r.id === activeId),
    'Active inspection cannot republish a removed recording',
  );
  assert(!p.jobs.some((j) => j.sourceId === activeId));
  for (const source of [first, second, activeFile]) assert.equal(await hash(source), sourceHash);
  assert.equal(await hash(output), outputHash);
  assert.equal(await hash(output + '.vcut.json'), companionHash);
  await writeFile(
    path.join(root, 'latest-removal.json'),
    JSON.stringify({ dir, file, passed: true }, null, 2),
  );
  console.log('Recording removal checks passed:', dir);
} finally {
  await service.close();
}
