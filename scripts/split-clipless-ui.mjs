// A Split on a recording with no clip yet (VC-243): a synthetic 15 s recording with no clips and
// two spoken Splits, at 5 s and 10 s. The first card says it makes two clips named after the
// recording; accepting makes 0-5 and 5-15. The second Split then cuts the clip it lands in, like
// any Split. Undo in the main window takes the second split back, then both clips of the first.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { require, root, electronEnvironment } from './shared.mjs';

const base = process.env.VIRTUAL_CUT_TEST_ROOT;
assert(base, 'Run with the test suite so all media is disposable.');
await mkdir(path.join(base, 'split-clipless'), { recursive: true });
const dir = await mkdtemp(path.join(base, 'split-clipless/run-'));
const source = path.join(dir, 'Clipless take.mp4'),
  cache = path.join(dir, 'cache'),
  file = path.join(dir, 'split-clipless.vcut');
await mkdir(cache);
await new Promise((resolve, reject) => {
  const p = spawn(
    process.env.VIRTUAL_CUT_FFMPEG || 'ffmpeg',
    [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x183c36:size=640x360:rate=30:d=15',
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
const service = new ProjectService(path.join(dir, 'native-profile'), '');
let snap = await service.open(file, { name: 'Clipless Split QA', destination: dir, cache });
const id = snap.project.id;
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
// Import makes no clip (VC-206).
assert.equal(snap.model.clips.filter((c) => c.rid === recording.id).length, 0);
const transcriptId = 'synthetic-split-clipless';
const phrases = [
  [1, 'Opening words'],
  [5, 'Split'],
  [10, 'Split'],
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
await service.checkpoint(id);
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
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('#transcript'))
      .setSize(760, 520),
  );
  const card = (n) => view.locator(`[data-proposal-card$=":${n}"]`);
  const clips = async () =>
    (await main.evaluate(() => window.virtualCut.project.current())).model.clips
      .filter((c) => c.rid === recording.id)
      .map((c) => [c.name, c.start, c.end])
      .sort((a, b) => a[1] - b[1]);
  // The card names both clips after the recording and says what accepting makes.
  const clipless = card(1).locator('[data-split-clipless]');
  await expect(clipless).toHaveText(
    'No clip yet: accepting makes both clips, from the start to the Split and from the Split to the end.',
  );
  await expect(card(1).locator('button[title="Show details"]')).toHaveText(
    `${recording.title} | ${recording.title} · 2`,
  );
  const accept = card(1).getByRole('button', { name: 'Accept split', exact: true });
  await expect(accept).toBeEnabled();
  await shot('split-clipless-card.png');
  await accept.click();
  await expect(card(1)).toHaveAttribute('data-status', 'accepted');
  // The decided card names the two clips it made.
  await expect(card(1)).toContainText(`${recording.title} | ${recording.title} · 2`);
  await expect.poll(clips).toEqual([
    [recording.title, 0, 5],
    [`${recording.title} · 2`, 5, recording.duration],
  ]);
  // The second Split now has a clip to cut: the one it lands in.
  await card(2).getByRole('button', { name: 'Details', exact: true }).click();
  await expect(card(2).locator('[data-split-clipless]')).toHaveCount(0);
  await expect(card(2)).toContainText(`Splits ${recording.title} · 2 into`);
  await shot('split-clipless-second.png');
  await card(2).getByRole('button', { name: 'Accept split', exact: true }).click();
  await expect(card(2)).toHaveAttribute('data-status', 'accepted');
  await shot('split-clipless-both.png');
  await expect.poll(clips).toEqual([
    [recording.title, 0, 5],
    [`${recording.title} · 2`, 5, 10],
    [`${recording.title} · 2 · 2`, 10, recording.duration],
  ]);
  // Undo takes the second split back, then both clips the first one made.
  await main.bringToFront();
  await main.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(clips).toEqual([
    [recording.title, 0, 5],
    [`${recording.title} · 2`, 5, recording.duration],
  ]);
  await main.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(clips).toEqual([]);
  await expect(card(1)).toHaveAttribute('data-status', 'pending');
  await shot('split-clipless-undone.png');
  assert.deepEqual(errors, []);
  console.log(`Split on a clipless recording: card, both clips, second split, undo: ${dir}`);
} finally {
  await app?.close();
}
