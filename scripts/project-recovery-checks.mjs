import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile, unlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { require } from './shared.mjs';
import { testPath } from './test-paths.mjs';
const { ProjectStore } = require('../dist-electron/project-store.cjs');
const { recoverProjectCopy } = require('../dist-electron/project-recovery.cjs');
const { ProjectService } = require('../dist-electron/project-service.cjs');
const edit = (store, text) => {
  const before = structuredClone(store.data.model),
    after = structuredClone(before);
  after.scratchpad = text;
  store.save(before, after);
};

if (process.argv[2] === '--crash') {
  const store = new ProjectStore(process.argv[3]);
  edit(store, 'Committed before interruption');
  store.putJob({
    id: 'interrupted-job',
    sourceId: 'fixture',
    kind: 'inspect',
    state: 'running',
    progress: 0.5,
    message: 'Running',
    updated: new Date().toISOString(),
  });
  await store.checkpoint('manual');
  store.db.exec('BEGIN IMMEDIATE');
  store.data.model.scratchpad = 'UNCOMMITTED — must disappear';
  store.write();
  process.stdout.write('ready-to-kill\n');
  await new Promise(() => {
    setInterval(() => {}, 1000);
  });
} else {
  const base = testPath('project-recovery');
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, 'native-'));
  const destination = path.join(dir, 'finished'),
    cache = path.join(dir, 'cache');
  await mkdir(destination);
  await mkdir(cache);
  const file = path.join(dir, 'crash.vcut');
  let store = new ProjectStore(file, { name: 'Recovery fixture', destination, cache });
  edit(store, 'Before child');
  store.close();
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--crash', file], {
    env: process.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childError = '';
  child.stderr.on('data', (data) => {
    childError += data;
  });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Crash fixture did not become ready: ' + childError)),
        20000,
      );
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', () => {
        clearTimeout(timeout);
        reject(new Error(childError));
      });
      child.stdout.on('data', (data) => {
        if (String(data).includes('ready-to-kill')) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
    assert.throws(() => new ProjectStore(file), /already open/);
  } finally {
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
  }
  store = new ProjectStore(file);
  assert.equal(store.data.model.scratchpad, 'Committed before interruption');
  assert.match(store.snapshot().recoveryNotice, /unexpectedly/);
  assert.equal(store.jobs()[0].state, 'interrupted');
  assert(store.snapshot().canUndo);
  store.history('undo');
  assert.equal(store.data.model.scratchpad, 'Before child');
  store.history('redo');
  assert.equal(store.data.model.scratchpad, 'Committed before interruption');
  await store.loadCopies();
  const checkpoint = path.join(file + '.saves', store.snapshot().saves[0].id);
  store.close();
  store = new ProjectStore(file);
  assert.equal(
    store.snapshot().recoveryNotice,
    undefined,
    'Clean close clears interruption notice',
  );
  store.close();

  // A real v1 fixture, including history and no session table, must migrate once.
  const legacy = path.join(dir, 'legacy.vcut');
  await recoverProjectCopy(checkpoint, legacy);
  let db = new DatabaseSync(legacy);
  db.exec('DROP TABLE project_session; PRAGMA user_version=1');
  db.close();
  const beforeMigration = await readFile(legacy);
  await writeFile(legacy + '.saves', 'block backup creation');
  assert.throws(() => new ProjectStore(legacy));
  db = new DatabaseSync(legacy, { readOnly: true });
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
  db.close();
  await unlink(legacy + '.saves');
  store = new ProjectStore(legacy);
  assert.match(store.snapshot().recoveryNotice, /upgraded/);
  assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 2);
  await store.loadCopies();
  const migration = store.snapshot().saves.find((s) => s.kind === 'migration');
  assert(migration);
  const legacyBackup = path.join(legacy + '.saves', migration.id);
  db = new DatabaseSync(legacyBackup, { readOnly: true });
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
  assert(db.prepare('SELECT COUNT(*) AS n FROM history').get().n > 0);
  db.close();
  for (let i = 0; i < 7; i++) {
    edit(store, 'Change ' + i);
    await store.checkpoint('auto', true);
    await store.checkpoint('manual');
  }
  assert.equal(store.snapshot().saves.filter((s) => s.kind === 'auto').length, 5);
  assert.equal(store.snapshot().saves.filter((s) => s.kind === 'manual').length, 5);
  assert.equal(store.snapshot().saves.filter((s) => s.kind === 'migration').length, 1);
  await store.restore(migration.id);
  assert.equal(store.data.model.scratchpad, 'Committed before interruption');
  store.close();
  store = new ProjectStore(legacy);
  await store.loadCopies();
  assert.equal(store.snapshot().saves.filter((s) => s.kind === 'migration').length, 1);
  store.close();
  assert.notDeepEqual(await readFile(legacy), beforeMigration);

  const future = path.join(dir, 'future.vcut');
  await recoverProjectCopy(checkpoint, future);
  db = new DatabaseSync(future);
  db.exec('PRAGMA user_version=999');
  db.close();
  const futureBytes = await readFile(future);
  assert.throws(() => new ProjectStore(future), /newer Virtual Cut/);
  assert.deepEqual(await readFile(future), futureBytes);

  const corrupt = path.join(dir, 'damaged.vcut');
  await writeFile(corrupt, 'not a sqlite database');
  assert.throws(() => new ProjectStore(corrupt), /Recover from save/);
  const recovered = path.join(dir, 'recovered.vcut');
  await assert.rejects(() => recoverProjectCopy(corrupt, recovered));
  await recoverProjectCopy(legacyBackup, recovered);
  const recoveredBytes = await readFile(recovered);
  await assert.rejects(() => recoverProjectCopy(checkpoint, recovered), /EEXIST/);
  assert.deepEqual(await readFile(recovered), recoveredBytes);
  assert.equal(await readFile(corrupt, 'utf8'), 'not a sqlite database');
  store = new ProjectStore(recovered);
  assert.equal(store.data.model.scratchpad, 'Committed before interruption');
  assert(store.snapshot().canUndo, 'Recovery preserves the command journal');
  const originalId = store.data.project.id;
  store.close();
  db = new DatabaseSync(checkpoint, { readOnly: true });
  assert.notEqual(
    originalId,
    JSON.parse(db.prepare('SELECT body FROM project WHERE id=1').get().body).project.id,
  );
  db.close();
  const service = new ProjectService(path.join(dir, 'profile'));
  await service.open(recovered);
  await assert.rejects(() => service.open(corrupt));
  assert.equal(service.store.file, recovered, 'Failed open preserves the current project');
  const checkpointMethod = service.store.checkpoint;
  service.store.checkpoint = async () => {
    throw new Error('Simulated storage failure');
  };
  await assert.rejects(() => service.open(file), /Simulated storage failure/);
  assert.equal(service.store.file, recovered);
  service.store.checkpoint = checkpointMethod;
  const unlockedNext = new ProjectStore(file);
  unlockedNext.close();
  await service.close();
  // Simulate another writer committing after initial validation but before the snapshot.
  const sqlite = require('node:sqlite'),
    originalBackup = sqlite.backup;
  const moving = path.join(dir, 'moving.vcut');
  await recoverProjectCopy(checkpoint, moving);
  const consistent = path.join(dir, 'consistent.vcut');
  sqlite.backup = async (...args) => {
    const writer = new ProjectStore(moving);
    edit(writer, 'Committed while recovery started');
    writer.close();
    return originalBackup(...args);
  };
  try {
    await recoverProjectCopy(moving, consistent);
  } finally {
    sqlite.backup = originalBackup;
  }
  store = new ProjectStore(consistent);
  assert.equal(store.data.model.scratchpad, 'Committed while recovery started');
  store.history('undo');
  assert.equal(store.data.model.scratchpad, 'Committed before interruption');
  store.close();
  assert(
    !(await readdir(dir)).some((f) => f.includes('.partial')),
    'No recovery staging files remain',
  );
  await writeFile(
    path.join(base, 'latest-native.json'),
    JSON.stringify({ dir, file, legacy, recovered, corrupt, checkpoint }),
  );
  console.log(
    'Crash rollback, committed edits, history, locks, migration, restore, retention, future versions and separate-file recovery passed:',
    dir,
  );
}
