import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  writeFile,
  readFile,
  stat,
  copyFile,
  link,
  symlink,
  unlink,
  readdir,
} from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { require } from './shared.mjs';
import { testPath } from './test-paths.mjs';
const { ProjectService } = require('../dist-electron/project-service.cjs');
const { projectStorageUsage } = require('../dist-electron/project-storage.cjs');
const {
  planProjectDeletion,
  executeProjectDeletion,
} = require('../dist-electron/project-deletion.cjs');
const { recoverProjectCopy, inspectProject } = require('../dist-electron/project-recovery.cjs');
const { DatabaseSync } = require('node:sqlite');
const base = testPath('project-deletion');
await mkdir(base, { recursive: true });
const dir = await mkdtemp(path.join(base, 'native-'));
const service = new ProjectService(path.join(dir, 'profile'), dir);
const exists = async (f) => !!(await stat(f).catch(() => null));
async function create(name, cache = path.join(dir, name + '-cache')) {
  const file = path.join(dir, name + '.vcut');
  await mkdir(cache, { recursive: true });
  const p = await service.open(file, { name, destination: dir, cache });
  return { id: p.project.id, name, file, cache };
}
const project = await create('Cleanup');
const sourceId = randomUUID(),
  fingerprint = 'a'.repeat(64);
const prefix = `${sourceId}-${fingerprint}`;
const source = path.join(project.cache, prefix + '-frame-0.jpg');
const preview = path.join(project.cache, prefix + '-audio-1.m4a');
const unknown = path.join(project.cache, 'user-notes.txt');
const output = path.join(dir, 'finished.mp4');
const metadata = output + '.vcut.json';
for (const f of [source, preview, unknown, output, metadata])
  await writeFile(f, 'preserve unless verified disposable preview');
service.store.db
  .prepare('INSERT INTO sources(id,body) VALUES (?,?)')
  .run(
    sourceId,
    JSON.stringify({ id: sourceId, file: source, bytes: 43, modified: 0, fingerprint }),
  );
const exportId = randomUUID();
service.store.db.prepare('INSERT INTO exports(id,body) VALUES (?,?)').run(
  exportId,
  JSON.stringify({
    plan: { id: exportId },
    input: { sourceFile: source },
    output,
    metadata,
    state: 'verified',
  }),
);
await assert.rejects(() => service.deletionPlan(project.id), /close/i);
const writesBefore = service.store.db.prepare('SELECT total_changes() AS n').get().n;
const sizes = await service.storageUsage(project.id);
const category = (id) => sizes.rows.find((r) => r.id === id);
assert.equal(category('sources').files, 1);
assert.equal(category('images').files, 0, 'A source inside cache remains referenced media');
assert.equal(category('audio').bytes, (await stat(preview)).size);
assert.equal(category('exports').files, 1);
assert.equal(category('companions').files, 1);
assert.equal(category('cacheOther').files, 1);
assert.equal(
  service.store.db.prepare('SELECT total_changes() AS n').get().n,
  writesBefore,
  'Size measurement must not save',
);
assert.equal(await exists(project.file + '.saves'), false);
await assert.rejects(() => service.storageUsage(randomUUID()), /project/i);
await service.close();
// Make a genuine same-project save, plus an unrelated file and linked generated-looking file.
const saveDir = project.file + '.saves';
await mkdir(saveDir, { recursive: true });
const save = path.join(saveDir, `manual-123-${randomUUID()}.vcut`);
await copyFile(project.file, save);
const lockedSave = path.join(saveDir, `auto-124-${randomUUID()}.vcut`);
await copyFile(project.file, lockedSave);
await writeFile(lockedSave + '.lock', JSON.stringify({ pid: process.pid }));
await writeFile(path.join(saveDir, 'keep.txt'), 'Keep');
const linked = path.join(project.cache, prefix + '-frame-1.jpg');
await link(unknown, linked);
const junction = path.join(project.cache, prefix + '-frame-2.jpg');
await symlink(saveDir, junction, 'junction');
let plan = await service.deletionPlan(project.id);
assert(
  plan.retainedDetails.some((f) => f.path === lockedSave && /open or has pending/.test(f.reason)),
);
assert(plan.files.some((f) => f.path === preview));
assert(plan.files.some((f) => f.path === save));
for (const protectedFile of [source, unknown, output, metadata, linked, junction, lockedSave])
  assert(!plan.files.some((f) => f.path === protectedFile));
// Changed files and an active writer invalidate confirmation without removing anything.
await writeFile(preview, 'changed since preview');
await assert.rejects(() => service.deleteProject(project.id, plan.token, true), /changed/i);
assert(await exists(project.file));
plan = await service.deletionPlan(project.id);
await writeFile(project.file + '.lock', JSON.stringify({ pid: process.pid }));
await assert.rejects(() => service.deleteProject(project.id, plan.token, true), /Close/i);
await unlink(project.file + '.lock');
plan = await service.deletionPlan(project.id);
const result = await service.deleteProject(project.id, plan.token, true);
assert.equal(result.removed, 3);
for (const removed of [project.file, preview, save]) assert(!(await exists(removed)));
for (const preserved of [
  source,
  unknown,
  output,
  metadata,
  linked,
  lockedSave,
  path.join(saveDir, 'keep.txt'),
])
  assert(await exists(preserved));
assert(!(await service.recent()).some((p) => p.id === project.id));
await assert.rejects(() => service.deleteProject(project.id, plan.token, true), /preview/i);
// No cleanup removes only the project. No project/cache directory recursion.
const basic = await create('Basic');
await service.close();
await mkdir(basic.file + '.saves', { recursive: true });
const basicSave = path.join(basic.file + '.saves', `manual-123-${randomUUID()}.vcut`);
await copyFile(basic.file, basicSave);
plan = await service.deletionPlan(basic.id);
await service.deleteProject(basic.id, plan.token, false);
assert(await exists(basicSave));
const recovered = path.join(dir, 'Recovered after deletion.vcut');
await recoverProjectCopy(basicSave, recovered);
assert.equal(
  await exists(basicSave + '-wal'),
  false,
  'Reading a closed checkpoint must not create journals',
);
assert.equal(await exists(basicSave + '-shm'), false);
const recoveredDb = new DatabaseSync(recovered, { readOnly: true });
assert.notEqual(inspectProject(recoveredDb).data.project.id, basic.id);
recoveredDb.close();
// Two named projects sharing a cache never erase one another's previews.
const shared = await create('Shared');
service.store.db
  .prepare('INSERT INTO sources(id,body) VALUES (?,?)')
  .run(sourceId, JSON.stringify({ id: sourceId, file: source, fingerprint }));
await service.close();
const other = await create('Other', shared.cache);
service.store.db
  .prepare('INSERT INTO sources(id,body) VALUES (?,?)')
  .run(sourceId, JSON.stringify({ id: sourceId, file: source, fingerprint }));
await service.close();
await writeFile(path.join(shared.cache, prefix + '-audio-1.m4a'), 'shared');
plan = await service.deletionPlan(shared.id);
assert(plan.retained.some((p) => p.includes('shared cache')));
assert(!plan.files.some((f) => f.kind === 'preview'));
await service.deleteProject(shared.id, plan.token, true);
assert(await exists(other.file));
assert(await exists(path.join(shared.cache, prefix + '-audio-1.m4a')));
assert.equal(await readFile(output, 'utf8'), 'preserve unless verified disposable preview');
// Grouped cleanup fixture: several verified previews, two saves, and a retained locked save.
for (const n of [0, 1, 2])
  await writeFile(path.join(other.cache, prefix + `-frame-${n}.jpg`), 'thumbnail');
await mkdir(other.file + '.saves', { recursive: true });
for (const n of [1, 2])
  await copyFile(other.file, path.join(other.file + '.saves', `manual-${n}-${randomUUID()}.vcut`));
const pending = path.join(other.file + '.saves', `auto-3-${randomUUID()}.vcut`);
await copyFile(other.file, pending);
await writeFile(pending + '.lock', 'open');
// Accounting uses live file sizes, deduplicates aliases, reports offline files and avoids nested trees.
const nested = path.join(other.cache, 'nested');
await mkdir(nested);
await writeFile(path.join(nested, 'not-scanned'), 'not counted');
const alias = path.join(dir, 'source-alias.jpg');
await link(source, alias);
const extraSources = [
  { file: source },
  { file: source.toUpperCase() },
  { file: alias },
  { file: path.join(dir, 'offline.mp4') },
];
const beforeNames = await readdir(other.file + '.saves');
const report = await projectStorageUsage(other, extraSources, [
  { state: 'verified', output, metadata },
  { state: 'verified', output, metadata },
]);
assert.equal(report.rows.find((r) => r.id === 'sources').files, 1);
assert.equal(report.rows.find((r) => r.id === 'sources').unavailable, 1);
assert.equal(report.rows.find((r) => r.id === 'exports').files, 1);
assert.equal(report.rows.find((r) => r.id === 'manual').files, 2);
assert.equal(report.rows.find((r) => r.id === 'images').bytes, 27);
assert(report.issues.some((i) => i.includes('nested')));
assert.deepEqual(await readdir(other.file + '.saves'), beforeNames);
// A cleanup preview must retain saves whose ownership or schema cannot be established.
const guarded = await create('Guarded');
await service.close();
await mkdir(guarded.file + '.saves');
const foreign = path.join(guarded.file + '.saves', `manual-1-${randomUUID()}.vcut`);
const corrupt = path.join(guarded.file + '.saves', `manual-2-${randomUUID()}.vcut`);
const future = path.join(guarded.file + '.saves', `manual-3-${randomUUID()}.vcut`);
await copyFile(other.file, foreign);
await writeFile(corrupt, 'not a database');
await copyFile(guarded.file, future);
const futureDb = new DatabaseSync(future);
futureDb.exec('PRAGMA user_version=999');
futureDb.close();
plan = await planProjectDeletion(guarded, [guarded]);
for (const file of [foreign, corrupt, future]) {
  assert(!plan.files.some((f) => f.path === file));
  assert(plan.retainedDetails.some((f) => f.path === file));
}
await assert.rejects(
  () => planProjectDeletion({ ...guarded, id: randomUUID() }, [guarded]),
  /project file changed/i,
);
await writeFile(guarded.file + '-wal', 'pending');
await assert.rejects(() => planProjectDeletion(guarded, [guarded]), /pending database/i);
await unlink(guarded.file + '-wal');
const beforeOpen = await planProjectDeletion(guarded, [guarded]);
await writeFile(guarded.file + '.lock', JSON.stringify({ pid: process.pid }));
await assert.rejects(() => executeProjectDeletion(beforeOpen, true), /now open/i);
assert(await exists(guarded.file));
assert(
  await exists(guarded.file + '.lock'),
  'A failed cleanup must not remove another writer lock',
);
await unlink(guarded.file + '.lock');
// An unavailable known peer prevents claiming exclusive ownership of previews.
plan = await planProjectDeletion(other, [other, { ...guarded, file: guarded.file + '.missing' }]);
assert(!plan.files.some((f) => f.kind === 'preview'));
assert(plan.retainedDetails.some((f) => /another recent project/.test(f.reason)));
// Even a normal leaf reached through a junction is retained, protecting its real target.
const linkedParent = path.join(dir, 'linked-parent');
await symlink(path.dirname(guarded.file), linkedParent, 'junction');
await assert.rejects(
  () =>
    planProjectDeletion(
      { ...guarded, file: path.join(linkedParent, path.basename(guarded.file)) },
      [],
    ),
  /linked folders/i,
);
// A malformed/reference-conflicted project must never authorize deleting its own media.
const guardedDb = new DatabaseSync(guarded.file);
guardedDb
  .prepare('INSERT INTO sources(id,body) VALUES (?,?)')
  .run(sourceId, JSON.stringify({ id: sourceId, file: guarded.file, fingerprint }));
guardedDb.close();
await assert.rejects(() => planProjectDeletion(guarded, [guarded]), /referenced as source media/i);
assert(await exists(guarded.file));
// Missing cache locations are reported without scanning the finished-video root.
const offlineReport = await projectStorageUsage(
  { ...other, cache: path.join(dir, 'absent-cache') },
  [],
  [],
);
assert(offlineReport.issues.some((i) => /unavailable/.test(i)));
assert.equal(offlineReport.rows.find((r) => r.id === 'exports').files, 0);
const linkedReport = await projectStorageUsage(
  { ...other, cache: linkedParent },
  [{ file: nested }],
  [],
);
assert(linkedReport.issues.some((i) => /linked or non-folder/.test(i)));
assert.equal(linkedReport.rows.find((r) => r.id === 'sources').unavailable, 1);
await writeFile(
  path.join(base, 'latest-native.json'),
  JSON.stringify({ dir, project: other, output, metadata }, null, 2),
);
console.log(
  JSON.stringify({
    passed: true,
    dir,
    protectedSources: true,
    protectedExports: true,
    changedFiles: true,
    links: true,
    sharedCache: true,
  }),
);
