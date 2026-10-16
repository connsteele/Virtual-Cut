// Split snap on the cue card (VC-165): a synthetic recording with a black screen from 6 to 8.5 s.
// A Split heard at 9.5 s proposes 8.5 s with the spoken time beside it; one heard at 14 s (the
// black ended 5.5 s before) keeps its spoken time. Accepting cuts at the snapped time and keeps
// the spoken time on the decision.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { require, root, electronEnvironment } from './shared.mjs';

const base = process.env.VIRTUAL_CUT_TEST_ROOT;
assert(base, 'Run with the test suite so all media is disposable.');
await mkdir(path.join(base, 'split-snap'), { recursive: true });
const dir = await mkdtemp(path.join(base, 'split-snap/run-'));
const source = path.join(dir, 'black-screen.mp4'),
  cache = path.join(dir, 'cache'),
  file = path.join(dir, 'split-snap.vcut');
await mkdir(cache);
await new Promise((resolve, reject) => {
  const scene = (d) => `color=c=0x183c36:size=640x360:rate=30:d=${d}`;
  const p = spawn(
    process.env.VIRTUAL_CUT_FFMPEG || 'ffmpeg',
    [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      `${scene(6)}[a];color=c=black:size=640x360:rate=30:d=2.5[b];${scene(6.5)}[c];[a][b][c]concat=n=3:v=1:a=0`,
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=48000:cl=stereo',
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-map',
      '1:a',
      '-t',
      '15',
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
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let error = '';
  p.stderr.on('data', (d) => (error += d));
  p.on('error', reject);
  p.on('close', (code) => (code ? reject(Error(error)) : resolve()));
});
const { ProjectService } = require('../dist-electron/project-service.cjs');
const logged = [];
const service = new ProjectService(path.join(dir, 'native-profile'), '', {
  record: (event) => logged.push(event),
});
let snap = await service.open(file, { name: 'Split snap QA', destination: dir, cache });
const id = snap.project.id,
  batchId = snap.activeBatchId;
await service.importFiles(id, snap.activeBatchId, [source], { game: 1, mic: 2 });
for (const until = Date.now() + 60000; ;) {
  snap = await service.snapshot();
  if (!snap.jobs.some((j) => ['queued', 'running'].includes(j.state))) break;
  assert(Date.now() < until, 'Import timed out');
  await new Promise((r) => setTimeout(r, 100));
}
const store = service.store,
  recording = snap.model.recordings[0],
  native = store.sources().find((s) => s.id === recording.id);
const transcriptId = 'synthetic-split-snap';
const phrases = [
  [1, 'Opening words'],
  [9.5, 'Split'],
  [14, 'Split'],
];
store.transcripts.begin({
  id: transcriptId,
  sourceId: recording.id,
  fingerprint: native.fingerprint,
  role: 'mic',
  track: 2,
  language: 'en',
  duration: recording.duration,
  offset: 0,
  state: 'complete',
  model: 'fixture',
  device: 'cpu',
  created: new Date().toISOString(),
  completed: new Date().toISOString(),
  context: { vocabulary: '', brief: '' },
  segmentCount: phrases.length,
  wordCount: phrases.length,
});
phrases.forEach(([start, text], i) =>
  store.transcripts.append(transcriptId, {
    id: i,
    start,
    end: start + 0.4,
    text,
    words: [{ text, start, end: start + 0.4, probability: 1 }],
    noSpeechProbability: 0,
    averageLogProbability: 0,
  }),
);
const before = store.data.model;
store.save(before, {
  ...before,
  cueDecisions: [],
  clips: [
    {
      id: 'whole',
      rid: recording.id,
      name: 'Whole take',
      start: 0,
      end: recording.duration,
      include: true,
      folder: '_Review',
    },
  ],
});
await service.checkpoint(id);
// A snap whose FFmpeg pass fails rejects, is not remembered, and leaves the queue working.
const moved = `${source}.away`;
await rename(source, moved);
await assert.rejects(service.splitSnap(id, recording.id, 9.5));
await rename(moved, source);
assert.equal((await service.splitSnap(id, recording.id, 9.5))?.time, 8.5);
// A batch record that cannot be saved is logged, and the export carries on (VC-182).
const blocked = service.batchRecords.file(id, batchId);
await mkdir(blocked, { recursive: true });
service.batchRecords.exported(store, batchId);
assert(logged.includes('operation-failed'), 'The failed record save is logged');
await rm(blocked, { recursive: true });
// A renamed copy in a second batch, for the Transcript button check below.
const copy = path.join(dir, 'renamed-copy.mp4');
await copyFile(source, copy);
await service.batch(id, 'Second');
const second = (await service.snapshot()).activeBatchId;
await service.importFiles(id, second, [copy], { game: 1, mic: 2 });
for (const until = Date.now() + 60000; ;) {
  snap = await service.snapshot();
  if (!snap.jobs.some((j) => ['queued', 'running'].includes(j.state))) break;
  assert(Date.now() < until, 'Copy import timed out');
  await new Promise((r) => setTimeout(r, 100));
}
await service.selectBatch(id, batchId);
// Without a requested recording, the window falls back to the selected one.
assert.equal(service.transcriptSession().sourceId, recording.id);
await service.close();

let app;
const errors = [];
const shot = async (name) => {
  const image = await app.evaluate(async ({ BrowserWindow }) =>
    (
      await BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith('#transcript'))
        .webContents.capturePage(undefined, { stayHidden: true })
    )
      .toPNG()
      .toString('base64'),
  );
  await writeFile(path.join(dir, name), Buffer.from(image, 'base64'));
};
try {
  app = await electron.launch({
    executablePath: process.env.VIRTUAL_CUT_TEST_EXECUTABLE || require('electron'),
    args: [
      ...(process.env.VIRTUAL_CUT_TEST_EXECUTABLE ? [] : [root]),
      `--user-data-dir=${path.join(dir, 'profile')}`,
      '--background-test',
    ],
    cwd: root,
    env: electronEnvironment(),
  });
  const main = await app.firstWindow();
  main.on('pageerror', (e) => errors.push(e.message));
  await main.locator('[data-workflow]').waitFor();
  await app.evaluate(({ dialog, BrowserWindow }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true);
  }, file);
  await main.getByRole('button', { name: 'Projects', exact: true }).click();
  await main.getByRole('button', { name: 'Open project file…', exact: true }).click();
  const opened = app.waitForEvent('window');
  await main.getByRole('button', { name: 'Transcript', exact: true }).click();
  const view = await opened;
  view.on('pageerror', (e) => errors.push(e.message));
  await view.getByLabel('Select transcript', { exact: true }).selectOption(transcriptId);
  const card = (n) => view.locator(`[data-proposal-card$=":${n}"]`);
  const snapLine = card(1).locator('[data-split-snap]');
  // Snapped: the card proposes the end of the black screen and shows the spoken time.
  await expect(snapLine).toHaveAttribute('data-split-snap', 'snapped');
  await expect(snapLine).toContainText('Spoken at 00:00:09.50');
  await expect(card(1).locator('button[title="Go to the start"]')).toHaveText('00:00:08.50');
  // Kept: the only black ended 5.5 s before this Split.
  await expect(card(2).locator('button[title="Go to the start"]')).toHaveText('00:00:14.00');
  await expect(card(2).locator('[data-split-snap]')).toHaveCount(0);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('#transcript'))
      .setSize(760, 520),
  );
  await shot('split-snap-card.png');
  // Dismissing the snap keeps the spoken time and still shows where the black ends.
  await card(1).getByRole('button', { name: 'Use spoken time', exact: true }).click();
  await expect(card(1).locator('button[title="Go to the start"]')).toHaveText('00:00:09.50');
  await expect(snapLine).toContainText('Black screen ends at 00:00:08.50');
  await shot('split-snap-dismissed.png');
  await card(1).getByRole('button', { name: 'Use snap', exact: true }).click();
  await expect(card(1).locator('button[title="Go to the start"]')).toHaveText('00:00:08.50');
  await card(1).getByRole('button', { name: 'Accept split', exact: true }).click();
  await expect(card(1)).toHaveAttribute('data-status', 'accepted');
  const current = await main.evaluate(() => window.virtualCut.project.current());
  const decision = current.model.cueDecisions.find((d) => d.kind === 'cut');
  assert.equal(decision.time, 9.5, 'The spoken anchor is kept');
  assert.equal(decision.appliedTime, 8.5);
  assert.deepEqual(
    current.model.clips
      .filter((c) => c.rid === recording.id)
      .map((c) => [c.start, c.end])
      .sort((a, b) => a[0] - b[0]),
    [
      [0, 8.5],
      [8.5, recording.duration],
    ],
  );
  // Transcript opens the recording on screen: after switching to a batch whose recording was
  // never clicked, it follows that recording and names it in the title bar.
  await expect.poll(() => view.title()).toContain('black-screen');
  await main.locator(`[data-recording="${recording.id}"]`).click();
  await main.getByLabel('Current batch', { exact: true }).selectOption({ label: 'Second' });
  await main.locator('[data-recording]', { hasText: 'renamed-copy' }).waitFor();
  await main.getByRole('button', { name: 'Transcript', exact: true }).click();
  await expect.poll(() => view.title()).toContain('renamed-copy');
  assert.deepEqual(errors, []);
  console.log(`Split snap card: snapped, kept, dismissed and accepted passed: ${dir}`);
} finally {
  await app?.close();
}
