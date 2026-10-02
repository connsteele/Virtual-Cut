import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, stat, writeFile, copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { require } from './shared.mjs';
import { testPath } from './test-paths.mjs';
const { ProjectStore } = require('../dist-electron/project-store.cjs');
const { DatabaseSync } = require('node:sqlite');
const { compactSaveCopy } = require('../dist-electron/project-recovery.cjs');
const base = testPath('save-policy');
await mkdir(base, { recursive: true });
const dir = await mkdtemp(path.join(base, 'native-'));
const file = path.join(dir, 'save.vcut');
let store = new ProjectStore(file, { name: 'Save policy', destination: dir, cache: dir });
const disk = () => JSON.parse(store.db.prepare('SELECT body FROM project WHERE id=1').get().body);
const edit = (fn) => {
  const before = structuredClone(store.data.model),
    after = structuredClone(before);
  fn(after);
  store.save(before, after);
};
store.transaction(() => {
  store.data.model.recordings.push({
    id: 'source',
    title: 'Recording',
    url: '',
    poster: '',
    frames: [],
    base: 0,
    duration: 3600,
    position: 0,
    sample: false,
    context: '',
    frameTimes: Array.from({ length: 216000 }, (_, i) => i / 60),
  });
  store.data.model.clips.push({
    id: 'clip',
    rid: 'source',
    name: 'Original',
    start: 0,
    end: 10,
    folder: '_Review',
    include: true,
  });
});
const baseline = disk();
const writes = store.db.prepare('SELECT total_changes() AS n').get().n;
const began = performance.now();
for (let i = 1; i <= 40; i++)
  edit((m) => {
    m.clips[0].name = 'Change ' + i;
  });
const editMs = performance.now() - began;
assert.deepEqual(disk(), baseline, 'Editing waits in memory');
assert.equal(
  store.db.prepare('SELECT total_changes() AS n').get().n,
  writes,
  'No SQLite writes for 40 edits',
);
assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM history').get().n, 0);
assert(JSON.stringify(store.journal).length < 100000, 'Undo must not duplicate frame indexes');
assert.equal(store.snapshot().canUndo, true);
edit((m) => {
  m.recordings[0].position = 40;
});
store.history('undo');
assert.equal(store.data.model.clips[0].name, 'Change 39');
assert.equal(store.data.model.recordings[0].position, 40);
store.history('redo');
// Native inspection/job writes must not leak the staged name/position to disk.
store.transaction(() => {
  store.data.model.recordings[0].width = 3840;
  store.putJob({ id: 'job', kind: 'inspect', sourceId: 'source', state: 'succeeded' });
});
assert.equal(disk().model.recordings[0].width, 3840);
assert.equal(disk().model.recordings[0].position, 0);
assert.equal(disk().model.clips[0].name, 'Original');
assert.equal(store.data.model.clips[0].name, 'Change 40');
await store.checkpoint('manual');
const saved = store.snapshot();
assert.equal(saved.unsavedChanges, false);
assert.equal(saved.canUndo, true, 'Save keeps live Undo');
store.history('undo');
assert.equal(store.data.model.clips[0].name, 'Change 39');
assert.equal(store.data.model.recordings[0].width, 3840);
assert.equal(disk().model.clips[0].name, 'Change 40');
store.history('redo');
const copyPath = path.join(file + '.saves', saved.saves[0].id);
const copy = new DatabaseSync(copyPath, { readOnly: true });
assert.equal(copy.prepare('PRAGMA freelist_count').get().freelist_count, 0);
assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM history').get().n, 0);
copy.close();
store.close();
// Upgrade a bloated rolling copy without losing its distinct saved state.
const legacy = path.join(dir, 'legacy.vcut');
await copyFile(copyPath, legacy);
const old = new DatabaseSync(legacy);
old.exec('PRAGMA user_version=2');
const oldBody = old.prepare('SELECT body FROM project WHERE id=1').get().body;
const oldModel = JSON.parse(oldBody).model;
old
  .prepare('INSERT INTO history (before, after, applied) VALUES (?, ?, 1)')
  .run(JSON.stringify({ ...oldModel, scratchpad: 'Earlier state' }), JSON.stringify(oldModel));
old.exec(
  'CREATE TABLE waste (body BLOB); INSERT INTO waste VALUES (zeroblob(20000000)); DROP TABLE waste',
);
old.close();
const oldBytes = (await stat(legacy)).size;
compactSaveCopy(legacy);
assert((await stat(legacy)).size < oldBytes / 2);
const upgraded = new DatabaseSync(legacy, { readOnly: true });
assert.equal(upgraded.prepare('SELECT body FROM project WHERE id=1').get().body, oldBody);
assert.equal(upgraded.prepare('PRAGMA user_version').get().user_version, 3);
assert.equal(upgraded.prepare('SELECT COUNT(*) AS n FROM history').get().n, 0);
upgraded.close();
const damaged = path.join(dir, 'damaged.vcut');
await writeFile(damaged, 'Invalid save');
assert.throws(() => compactSaveCopy(damaged));
assert.equal(await readFile(damaged, 'utf8'), 'Invalid save');
assert(!(await readdir(dir)).some((name) => name.endsWith('.partial')));
// A closed, WAL-mode legacy copy must not acquire support files merely by checking its version.
const walCopy = path.join(dir, 'closed-wal.vcut');
await copyFile(copyPath, walCopy);
const walWriter = new DatabaseSync(walCopy);
walWriter.exec('PRAGMA journal_mode=WAL');
walWriter.close();
const walBefore = await readFile(walCopy);
compactSaveCopy(walCopy);
assert.deepEqual(await readFile(walCopy), walBefore);
assert(!(await readdir(dir)).some((name) => name.startsWith('closed-wal.vcut-')));
await writeFile(walCopy + '.lock', 'active');
assert.throws(() => compactSaveCopy(walCopy), /pending database files/);
assert.deepEqual(await readFile(walCopy), walBefore);
store = new ProjectStore(file);
assert.equal(store.snapshot().canUndo, false);
assert.equal(store.snapshot().canRedo, false);
assert.equal(store.data.model.clips[0].name, 'Change 40');
// Failed saves keep the current edit and Undo available for a retry.
edit((m) => {
  m.scratchpad = 'Keep after failure';
});
const persist = store.persist;
store.persist = () => {
  throw new Error('Simulated full disk');
};
await assert.rejects(() => store.checkpoint('manual'), /full disk/);
assert(store.snapshot().unsavedEdits);
assert(store.snapshot().canUndo);
store.persist = persist;
await store.checkpoint('manual');
store.close();
assert(!(await readdir(file + '.saves')).some((name) => /partial|wal|shm/.test(name)));
await writeFile(
  path.join(base, 'latest-native.json'),
  JSON.stringify({ dir, file, copyPath, editMs, copyBytes: (await stat(copyPath)).size }),
);
console.log(
  'Memory Undo, zero edit writes, native fact isolation, compact copies, save/reopen and failed-save retry passed',
  { dir, editMs },
);
