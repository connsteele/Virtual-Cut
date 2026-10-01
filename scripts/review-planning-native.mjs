import { testPath } from './test-paths.mjs';
import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  readdir,
  symlink,
  stat,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { require } from './shared.mjs';
const { ProjectStore } = require('../dist-electron/project-store.cjs');
const { ProjectService } = require('../dist-electron/project-service.cjs');
const { destinationPlan, destinationFolders } = require('../dist-electron/destination-plan.cjs');
const { nameProblem } = require('../dist-electron/review-plan.js');
const { Diagnostics } = require('../dist-electron/diagnostics.cjs');
const scratch = testPath('review-planning');
await mkdir(scratch, { recursive: true });
const dir = await mkdtemp(path.join(scratch, 'native-'));
const dest = path.join(dir, 'Finished clips'),
  cache = path.join(dir, 'cache');
await mkdir(dest);
await mkdir(cache);
await mkdir(path.join(dest, 'Existing'));
const file = path.join(dir, 'test.vcut');
let store = new ProjectStore(file, { name: 'Review planning tests', destination: dest, cache });
const r = {
  id: randomUUID(),
  title: 'Source',
  sourcePath: path.join(dir, 'source.mp4'),
  sourceModified: 1,
  availability: 'ready',
  url: '',
  poster: '',
  frames: [],
  base: 0,
  duration: 10,
  position: 0,
  context: '',
  sample: false,
  audioTracks: [{ index: 1 }, { index: 2 }],
  gameTrack: 1,
  micTrack: 2,
};
store.data.model.recordings = [r];
store.data.model.clips = [
  { id: 'clip1', rid: r.id, name: 'One', folder: 'Existing/New', start: 1, end: 8, include: true },
];
store.data.model.markers[r.id] = [
  {
    id: 'm1',
    time: 2,
    name: 'Marker',
    note: 'Two\nlines',
    category: 'Context',
    topic: '',
    color: 'Blue',
  },
];
store.write();
const change = (fn) => {
  const before = structuredClone(store.data.model),
    after = structuredClone(before);
  fn(after);
  store.save(before, after);
};
const accept = () =>
  change((m) => {
    m.clips[0].accepted = true;
    m.clips[0].held = false;
  });
accept();
assert(store.data.model.clips[0].acceptedKey);
for (const fn of [
  (m) => (m.clips[0].name += 'x'),
  (m) => (m.clips[0].start += 0.1),
  (m) => (m.clips[0].folder += '/child'),
  (m) => (m.clips[0].note = 'private'),
  (m) => (m.recordings[0].context = 'context'),
  (m) => {
    m.recordings[0].gameTrack = 2;
    m.recordings[0].micTrack = 1;
  },
  (m) => (m.markers[r.id][0].color = 'Red'),
  (m) => (m.markers[r.id][0].note += '\nthird'),
]) {
  change(fn);
  assert.equal(store.data.model.clips[0].accepted, false);
  store.history('undo');
  assert.equal(
    store.data.model.clips[0].accepted,
    true,
    'Undo restores the exact reviewed content',
  );
  store.history('redo');
  assert.equal(store.data.model.clips[0].accepted, false);
  accept();
  assert.equal(store.data.model.clips[0].accepted, true);
}
change((m) => {
  m.recordings[0].position = 5;
  m.recordings[0].monitor = 'both';
});
assert(store.data.model.clips[0].accepted, 'Navigation/listening do not invalidate acceptance');
change((m) => {
  m.clips[0].held = true;
  m.clips[0].filed = true;
  m.clips[0].holdReason = 'Check context';
});
assert.equal(store.data.model.clips[0].accepted, false);
assert.equal(store.data.model.clips[0].filed, false);
store.close();
store = new ProjectStore(file);
assert.equal(store.data.model.clips[0].holdReason, 'Check context');
accept();
store.close();
store = new ProjectStore(file);
assert(store.data.model.clips[0].acceptedKey);
const stale = structuredClone(store.data.model),
  edited = structuredClone(stale);
change((m) => (m.clips[0].name = 'Fresh'));
edited.clips[0].note = 'Stale';
assert.throws(() => store.save(stale, edited), /changed elsewhere/);
store.close();

const model = structuredClone(store.data.model);
model.clips[0] = { ...model.clips[0], name: 'Clean', folder: 'Existing/New' };
let plan = await destinationPlan(dest, model, [r.sourcePath]);
assert.deepEqual(plan.rows[0].issues, []);
assert.equal(plan.rows[0].path, path.join(dest, 'Existing/New/Clean.mp4'));
assert.equal(
  await stat(path.join(dest, 'Existing/New')).catch(() => null),
  null,
  'Planning never creates folders',
);
assert.deepEqual((await destinationFolders(dest, '')).children, ['Existing']);
assert.equal((await destinationFolders(dest, 'Existing/New')).planned, true);
for (const invalid of [
  'CON',
  'nul.mp4',
  'COM¹',
  'LPT9.txt',
  '../escape',
  'bad:',
  'bad.',
  'bad ',
  'a\u0001b',
  '',
])
  assert(nameProblem(invalid), invalid);
model.clips.push({ ...model.clips[0], id: 'clip2', name: 'CLEAN' });
assert(
  (await destinationPlan(dest, model, [])).rows.every((row) =>
    row.issues.some((x) => x.includes('Another clip')),
  ),
);
model.clips.pop();
model.clips[0].folder = 'Existing';
await writeFile(path.join(dest, 'Existing/Clean.mp4'), 'existing original');
await writeFile(path.join(dest, 'Existing/Clean.mp4.vcut.json'), 'existing companion');
plan = await destinationPlan(dest, model, [path.join(dest, 'Existing/Clean.mp4')]);
assert(plan.rows[0].issues.some((x) => x.includes('original source')));
assert(plan.rows[0].issues.some((x) => x.includes('companion')));
assert.equal(await readFile(path.join(dest, 'Existing/Clean.mp4'), 'utf8'), 'existing original');
model.clips[0].folder = '../outside';
assert((await destinationPlan(dest, model, [])).rows[0].issues.length);
const outside = path.join(dir, 'outside');
await mkdir(outside);
await symlink(outside, path.join(dest, 'Link'), 'junction');
model.clips[0].folder = 'Link';
assert((await destinationPlan(dest, model, [])).rows[0].issues.some((x) => x.includes('link')));
assert(!(await destinationFolders(dest, '')).children.includes('Link'));
model.clips[0].folder = '';
assert(
  (await destinationPlan(path.join(dir, 'offline'), model, [])).rows[0].issues.some((x) =>
    x.includes('unavailable'),
  ),
);

const log = new Diagnostics(path.join(dir, 'logs-profile'), { bytes: 1000, files: 3 });
const playbackLog = new Diagnostics(path.join(dir, 'playback-log'));
playbackLog.record('media-error', {
  fault: 'demuxer-seek',
  clipCount: 0,
  readyState: 1,
  networkState: 1,
  recent: Array.from({ length: 40 }, (_, atMs) => ({
    action: 'seek',
    atMs,
    target: 1.431,
    message: 'SECRET',
    recent: [{ path: 'SECRET' }],
  })),
  path: 'SECRET',
  message: 'SECRET',
});
await playbackLog.flush();
const diagnosticReport = (await playbackLog.summary()).text;
assert(!diagnosticReport.includes('SECRET'));
const diagnosticEvent = JSON.parse(
  diagnosticReport.split('\n').find((line) => line.startsWith('{')),
);
assert.equal(diagnosticEvent.recent.length, 24);
assert.equal(diagnosticEvent.fault, 'demuxer-seek');
log.record('tool-version', { tool: 'ffmpeg', version: '8.0.1-essentials_build-www.gyan.dev' });
await log.flush();
assert((await log.summary()).text.includes('8.0.1-essentials_build-www.gyan.dev'));
log.record('tool-version', { tool: 'ffprobe', version: 'N-118616-g3e9777dc75-20250304' });
await log.flush();
assert((await log.summary()).text.includes('N-118616-g3e9777dc75-20250304'));
for (let i = 0; i < 55; i++)
  log.record('play', {
    sourceId: r.id,
    rate: 16,
    position: i,
    path: 'SECRET path',
    note: 'SECRET note',
    token: 'SECRET token',
  });
await log.flush();
let logs = await readdir(log.directory);
assert(logs.length <= 3);
for (const f of logs) assert((await stat(path.join(log.directory, f))).size <= 1000);
assert(!(await log.summary()).text.includes('SECRET'));
for (let i = 0; i < 1000; i++) log.record('scan', { rate: 16 });
await log.flush();
assert(log.dropped > 900, 'Floods are capped');
logs = await readdir(log.directory);
await writeFile(
  path.join(log.directory, logs[0]),
  'not JSON\n' +
    JSON.stringify({
      at: new Date().toISOString(),
      event: 'play',
      path: 'SECRET',
      session: r.id,
      rate: 2,
    }) +
    '\n{torn',
);
const reopened = new Diagnostics(path.join(dir, 'logs-profile'));
assert(!(await reopened.summary()).text.includes('SECRET'));
const blocked = path.join(dir, 'blocked');
await writeFile(blocked, 'not a directory');
const broken = new Diagnostics(blocked);
broken.record('operation-failed', { operation: 'save', errorCode: 'ENOSPC' });
await broken.flush();
assert.equal(broken.logging, false);
assert((await broken.summary()).text.includes('ENOSPC'));
await writeFile(
  path.join(dir, 'result.json'),
  JSON.stringify(
    { passed: true, acceptance: true, destinationBoundaries: true, logging: true },
    null,
    2,
  ),
);
console.log('Review planning and diagnostics native checks passed:', dir);

// A disposable playable project also exercises the service/IPC acceptance path.
const source = path.join(dir, 'Review source.mp4');
const generated = spawnSync(
  'ffmpeg',
  [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=30:duration=6',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=6',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-g',
    '30',
    '-c:a',
    'aac',
    '-y',
    source,
  ],
  { windowsHide: true, encoding: 'utf8' },
);
assert.equal(generated.status, 0, generated.stderr);
const service = new ProjectService(
  path.join(dir, 'service-profile'),
  path.join(dir, 'tools'),
  reopened,
);
const uiFile = path.join(dir, 'Review UI.vcut');
let p = await service.open(uiFile, { name: 'Planning and diagnostics', destination: dest, cache });
const pid = p.project.id;
await service.importFiles(pid, p.activeBatchId, [source], { game: 1, mic: null });
const deadline = Date.now() + 30000;
while (service.store.jobs().some((j) => ['queued', 'running'].includes(j.state))) {
  assert(Date.now() < deadline);
  await new Promise((resolve) => setTimeout(resolve, 100));
}
p = await service.snapshot();
assert.equal(p.model.recordings[0].availability, 'ready');
let before = p.model,
  after = structuredClone(before);
after.clips[0].name = 'First';
after.clips[0].folder = 'Existing';
after.clips[0].end = 3;
after.clips.push({ ...after.clips[0], id: randomUUID(), name: 'Second', start: 3, end: 6 });
p = await service.save(pid, before, after);
const exportPlan = await service.exportPlan(pid, p.model.clips[0].id, 'source');
p = await service.acceptReview(pid, p.model.clips[0].id);
assert(p.model.clips[0].accepted);
assert(
  p.exports.find((e) => e.plan.id === exportPlan.id).current,
  'Acceptance does not stale the export payload',
);
await service.close();
p = await service.open(uiFile);
assert(p.model.clips[0].accepted, 'Exact acceptance survives a native reopen');
before = p.model;
after = structuredClone(before);
after.clips[0].held = true;
after.clips[0].holdReason = 'Check later';
p = await service.save(pid, before, after);
assert(!p.model.clips[0].accepted);
assert(
  p.exports.find((e) => e.plan.id === exportPlan.id).current,
  'Holding a clip does not stale the export payload',
);
p = await service.acceptReview(pid, p.model.clips[0].id);
before = p.model;
after = structuredClone(before);
after.recordings[0].context = 'Confidential context';
p = await service.save(pid, before, after);
assert(!p.model.clips[0].accepted);
before = p.model;
after = structuredClone(before);
after.clips[0].name = 'Second';
p = await service.save(pid, before, after);
await assert.rejects(() => service.acceptReview(pid, p.model.clips[0].id), /Another clip/);
assert(!service.store.data.model.clips[0].accepted);
before = p.model;
after = structuredClone(before);
after.clips[0].name = 'First';
p = await service.save(pid, before, after);
const firstBatch = p.activeBatchId;
// Automatic snapshots refresh on target changes and filesystem checks without editorial saves.
assert(p.destinations.rows.every((r) => !r.issues.length));
p = await service.acceptReview(pid, p.model.clips[1].id);
before = p.model;
after = structuredClone(before);
after.clips[0].name = 'SECOND.mp4';
p = await service.save(pid, before, after);
assert(p.destinations.rows.every((r) => r.issues.some((i) => i.includes('Another clip'))));
assert(!p.model.clips[1].accepted, 'A peer target change invalidates acceptance');
p = await service.history(pid, 'undo');
assert(p.model.clips[1].accepted, 'Undo restores the exact accepted peer and unique target');
assert(p.destinations.rows.every((r) => !r.issues.length));
p = await service.history(pid, 'redo');
assert(!p.model.clips[1].accepted, 'Redo restores the peer conflict without stale acceptance');
before = p.model;
after = structuredClone(before);
after.clips[0].name = 'First';
after.clips[0].held = true;
after.clips[0].holdReason = 'Keep this manual hold';
p = await service.save(pid, before, after);
assert(p.destinations.rows.every((r) => !r.issues.length));
assert(p.model.clips[0].held && !p.model.clips[1].accepted);
const collision = path.join(dest, 'Existing', 'Second.mp4');
await writeFile(collision, 'existing file remains untouched');
assert((await service.destinationPlan(pid)).rows[1].issues.some((i) => i.includes('already uses')));
await assert.rejects(() => service.acceptReview(pid, p.model.clips[1].id), /already uses/);
assert.equal(await readFile(collision, 'utf8'), 'existing file remains untouched');
await unlink(collision);
assert((await service.destinationPlan(pid)).rows.every((r) => !r.issues.length));
assert.equal(
  await service.destinationLocation(pid, 'Existing/Planned'),
  path.join(dest, 'Existing'),
);
await assert.rejects(() => service.destinationLocation(pid, '../escape'));
assert.equal(await service.selectDestination(pid, path.join(dest, 'Existing')), 'Existing');
assert.equal(await service.selectDestination(pid, dest), '');
await assert.rejects(() => service.selectDestination(pid, dir), /inside/);
await assert.rejects(() => service.selectDestination(pid, path.join(dest, 'Missing')), /available/);
await symlink(dir, path.join(dest, 'Linked'), 'junction');
await assert.rejects(() => service.selectDestination(pid, path.join(dest, 'Linked')), /link/);
const revision = service.store.data.revision;
await service.snapshot();
await service.snapshot();
assert.equal(
  service.store.data.revision,
  revision,
  'Destination polling creates no edit or save history',
);
before = p.model;
after = structuredClone(before);
after.clips[0].held = false;
after.markers[after.recordings[0].id] = [
  {
    id: 'move-marker',
    name: 'Move me',
    time: 1,
    color: 'Blue',
    category: 'Context',
    topic: '',
    note: 'Retain\nnotes',
  },
  {
    id: 'later-marker',
    name: 'Later marker',
    time: 2,
    color: 'Red',
    category: 'Context',
    topic: '',
    note: '',
  },
];
p = await service.save(pid, before, after);
p = await service.batch(pid, 'Other batch');
p = await service.selectBatch(pid, firstBatch);
await service.close();
await writeFile(
  path.join(scratch, 'latest-native.json'),
  JSON.stringify(
    { dir, file: uiFile, source, dest, clipIds: p.model.clips.map((c) => c.id) },
    null,
    2,
  ),
);
await reopened.flush();
console.log('Native service acceptance and disposable UI fixture passed:', uiFile);
