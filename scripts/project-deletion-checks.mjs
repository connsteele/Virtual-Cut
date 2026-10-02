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
} from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { require } from './shared.mjs';
import { testPath } from './test-paths.mjs';
const { ProjectService } = require('../dist-electron/project-service.cjs');
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
// Two named projects sharing a cache never erase one another's previews.
const shared = await create('Shared');
service.store.db
  .prepare('INSERT INTO sources(id,body) VALUES (?,?)')
  .run(sourceId, JSON.stringify({ id: sourceId, file: source, fingerprint }));
await service.close();
const other = await create('Other', shared.cache);
await service.close();
await writeFile(path.join(shared.cache, prefix + '-audio-1.m4a'), 'shared');
plan = await service.deletionPlan(shared.id);
assert(plan.retained.some((p) => p.includes('shared cache')));
assert(!plan.files.some((f) => f.kind === 'preview'));
await service.deleteProject(shared.id, plan.token, true);
assert(await exists(other.file));
assert(await exists(path.join(shared.cache, prefix + '-audio-1.m4a')));
assert.equal(await readFile(output, 'utf8'), 'preserve unless verified disposable preview');
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
