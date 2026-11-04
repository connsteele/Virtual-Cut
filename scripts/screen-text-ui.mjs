// Screen text in the app (VC-141, M390): "Analyse picture now" reads picture events, then screen
// text. The thumbnail badge shows the screen text icon and its percent while it reads (amber when
// a preview pauses it), and both icons with the tick when both are ready; Jobs shows "Read screen
// text" in the media lane; without thumbnails the card has a line for each. The engine is the
// checks' stand-in (scripts/screen-text-stub): the real worker, guard and FFmpeg, made-up reading.
// Screenshots of each state are saved beside the project. visual-pass-ui covers the app without
// an engine and the setup link.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { require, root, electronEnvironment } from './shared.mjs';
import { screenTextClip, stubEngine } from './screen-text-stub.mjs';

const base = process.env.VIRTUAL_CUT_TEST_ROOT;
assert(base, 'Run with the test suite so all media is disposable.');
await mkdir(path.join(base, 'screen-text-ui'), { recursive: true });
const dir = await mkdtemp(path.join(base, 'screen-text-ui/run-'));
const ffmpeg = process.env.VIRTUAL_CUT_FFMPEG || 'ffmpeg';
const tool = (args) =>
  new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-v', 'error', ...args], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let error = '';
    p.stderr.on('data', (d) => (error += d));
    p.on('error', reject);
    p.on('close', (code) => (code ? reject(Error(error)) : resolve()));
  });
const clip = path.join(dir, 'Screen session.mp4');
await screenTextClip(tool, clip);
const { folder: engine } = await stubEngine(dir);
const { ProjectService } = require('../dist-electron/project-service.cjs');
const file = path.join(dir, 'screen-text.vcut'),
  cache = path.join(dir, 'cache');
await mkdir(cache);
const previous = process.env.VIRTUAL_CUT_PICTURE_PASS;
process.env.VIRTUAL_CUT_PICTURE_PASS = 'manual';
const service = new ProjectService(path.join(dir, 'native-profile'), '');
let snap = await service.open(file, { name: 'Screen text QA', destination: dir, cache });
await service.importFiles(snap.project.id, snap.activeBatchId, [clip], { game: 1, mic: 2 });
for (const until = Date.now() + 60000; ;) {
  snap = await service.snapshot();
  if (!snap.jobs.some((j) => ['queued', 'running'].includes(j.state))) break;
  assert(Date.now() < until, 'Import timed out');
  await new Promise((r) => setTimeout(r, 100));
}
const [id] = snap.model.recordings.map((r) => r.id);
await service.close();
if (previous === undefined) delete process.env.VIRTUAL_CUT_PICTURE_PASS;
else process.env.VIRTUAL_CUT_PICTURE_PASS = previous;

let app;
const errors = [];
const shots = [];
const shot = async (name) => {
  const image = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    await wc.capturePage(undefined, { stayHidden: true });
    await new Promise((r) => setTimeout(r, 150));
    return (await wc.capturePage(undefined, { stayHidden: true })).toPNG().toString('base64');
  });
  await writeFile(path.join(dir, name), Buffer.from(image, 'base64'));
  shots.push(name);
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
    env: electronEnvironment({
      // Idle and no NVIDIA decoder: the picture pass reads at once on the CPU.
      VIRTUAL_CUT_IDLE_SECONDS: '600',
      VIRTUAL_CUT_PICTURE_GPU: '0',
      VIRTUAL_CUT_OCR_RUNTIME: engine,
      // Slow readings so each state lasts long enough to see.
      VIRTUAL_CUT_STUB_OCR_MS: '400',
    }),
  });
  const main = await app.firstWindow();
  main.on('pageerror', (e) => errors.push(e.message));
  await main.locator('[data-workflow]').waitFor();
  await app.evaluate(({ dialog, BrowserWindow }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.setAudioMuted(true);
    win.setSize(1280, 800);
  }, file);
  await main.getByRole('button', { name: 'Projects', exact: true }).click();
  await main.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await main
    .getByRole('navigation', { name: 'Workspace pages' })
    .getByRole('button', { name: 'Cut', exact: true })
    .click();
  const card = main.locator(`[data-recording="${id}"]`);
  const overlay = card.locator('[data-screen-text-status]');
  const badge = overlay.getByRole('status');
  await card.click();
  await card.getByRole('button', { name: /^Analyse picture now/ }).click();
  // Picture events first; screen text waits for them, then reads with its own icon.
  await expect(overlay).toHaveAttribute('data-screen-text-status', 'running', { timeout: 60000 });
  await expect(badge).toHaveAttribute(
    'title',
    /^Picture events ready · \d+ s · CPU · Reading screen text… \d+%$/,
  );
  await expect(badge.locator('svg')).toHaveCount(1);
  await shot('1-card-reading-screen-text.png');
  await main.getByRole('button', { name: /^Jobs/ }).click();
  const jobs = main.getByRole('dialog', { name: 'Media jobs' });
  await expect(jobs.getByText('Read screen text', { exact: true })).toBeVisible();
  // The stand-in engine reports the CPU; the real one says GPU (DirectML).
  await expect(jobs.locator('[data-screen-text-use]')).toHaveText('Media lane · CPU');
  await shot('2-jobs-reading-screen-text.png');
  await jobs.getByRole('button', { name: 'Close' }).click();
  // A preview playing pauses it part way; the badge keeps its percent, in amber.
  for (
    const end = Date.now() + 20000;
    Date.now() < end;
    await new Promise((r) => setTimeout(r, 100))
  ) {
    const now = await main.evaluate(() => window.virtualCut.project.current());
    if (now.jobs.find((j) => j.kind === 'text' && j.state === 'running')?.progress >= 0.2) break;
  }
  await main.getByRole('button', { name: 'Play · K / Space', exact: true }).click();
  await expect(badge).toHaveAttribute(
    'title',
    /Reading screen text… \d+% · paused for preview playing$/,
  );
  await expect(badge).toContainText('paused');
  await shot('3-card-screen-text-paused.png');
  const pause = main.getByRole('button', { name: 'Pause · K / Space', exact: true });
  if (await pause.isVisible()) await pause.click();
  // Both ready: the eye and the screen text icon with the tick.
  await expect(overlay).toHaveAttribute('data-screen-text-status', 'ready', { timeout: 60000 });
  await expect(badge).toHaveAttribute(
    'title',
    /^Picture events ready · \d+ s · CPU · Screen text ready · \d+ lines · \d+ s$/,
  );
  await expect(badge.locator('svg')).toHaveCount(2);
  await expect(badge).toContainText('✓');
  // The scan icon only says where both stand now.
  const scan = card.locator('[data-picture-action]');
  await expect(scan).toHaveAttribute('data-picture-action', 'ready');
  await expect(scan).toHaveAttribute('aria-disabled', 'true');
  await shot('4-card-both-ready.png');
  await main.getByRole('button', { name: /^Jobs/ }).click();
  await expect(jobs).toContainText(
    /Screen text ready · \d+ lines from 20 keyframes \(\d+ unchanged\) · read on the CPU/,
  );
  await expect(jobs).toContainText('Every recording in this batch has picture events and screen');
  await expect(jobs.locator('[data-screen-text-engine]')).toHaveCount(0);
  await shot('5-jobs-both-ready.png');
  await jobs.getByRole('button', { name: 'Close' }).click();
  // Without thumbnails each pass has its own line.
  await main.getByRole('button', { name: 'Toggle thumbnails' }).click();
  await expect(card.locator('small[data-screen-text-status="ready"]')).toHaveText(
    /^Screen text ready · \d+ lines · \d+ s$/,
  );
  await expect(card.locator('small[data-picture-status="ready"]')).toBeVisible();
  await shot('6-card-lines-without-thumbnails.png');
  // A compact window keeps the badge on the Media page's cards.
  await main.getByRole('button', { name: 'Toggle thumbnails' }).click();
  await main
    .getByRole('navigation', { name: 'Workspace pages' })
    .getByRole('button', { name: 'Media', exact: true })
    .click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 720));
  await expect(card.getByRole('status')).toHaveAttribute('title', /Screen text ready/);
  await shot('7-media-compact.png');
  const current = await main.evaluate(() => window.virtualCut.project.current());
  assert.equal(current.screenText[id].keyframes, 20);
  assert.equal(current.screenTextEngine, '');
  assert(!JSON.stringify(current.model).includes('Score 100'), 'Nothing in the editable model');
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({ status: 'passed', dir, shots, screenText: current.screenText }, null, 2),
  );
} finally {
  await app?.close();
}
