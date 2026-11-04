// Picture pass in the app (VC-180): "Analyse picture now" on a recording card and for the batch
// in Jobs, the card's "Reading picture… N%" and "Picture events ready" lines, and Jobs' lane
// line: "Paused: preview playing" while the preview plays, then the decoder in use. Without an
// NVIDIA decoder the pass waits for the PC to be idle and reads on the CPU. With
// VIRTUAL_CUT_PICTURE_UI_GPU=1 (only on a PC with NVDEC) it reads on the GPU decoder while you
// work and adds CPU workers once idle. Screenshots of each state are saved beside the project.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { require, root, electronEnvironment } from './shared.mjs';

const base = process.env.VIRTUAL_CUT_TEST_ROOT;
assert(base, 'Run with the test suite so all media is disposable.');
const gpu = process.env.VIRTUAL_CUT_PICTURE_UI_GPU === '1';
await mkdir(path.join(base, 'visual-pass-ui'), { recursive: true });
const dir = await mkdtemp(path.join(base, 'visual-pass-ui/run-'));
const ffmpeg = process.env.VIRTUAL_CUT_FFMPEG || 'ffmpeg';
const make = (args) =>
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
// 45 s of moving picture with a black screen every 9 s, and two audio tracks.
const scene = (d) => `testsrc2=size=1280x720:rate=60:d=${d}`;
const black = 'color=c=black:size=1280x720:rate=60:d=1';
const parts = Array.from({ length: 5 }, (_, i) => `${scene(8)}[s${i}];${black}[b${i}]`);
const order = Array.from({ length: 5 }, (_, i) => `[s${i}][b${i}]`).join('');
const sources = ['First session', 'Second session'].map((name) => path.join(dir, `${name}.mp4`));
for (const file of sources)
  await make([
    ...['-f', 'lavfi', '-i', `${parts.join(';')};${order}concat=n=10:v=1:a=0`],
    ...['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000'],
    ...['-map', '0:v', '-map', '1:a', '-map', '1:a', '-shortest'],
    ...['-c:v', 'libx264', '-preset', 'ultrafast', '-g', '60', '-c:a', 'aac', '-y', file],
  ]);
const { ProjectService } = require('../dist-electron/project-service.cjs');
const cache = path.join(dir, 'cache'),
  file = path.join(dir, 'picture-pass.vcut');
await mkdir(cache);
const service = new ProjectService(path.join(dir, 'native-profile'), '');
let snap = await service.open(file, { name: 'Picture pass QA', destination: dir, cache });
await service.importFiles(snap.project.id, snap.activeBatchId, sources, { game: 1, mic: 2 });
for (const until = Date.now() + 60000; ;) {
  snap = await service.snapshot();
  if (!snap.jobs.some((j) => ['queued', 'running'].includes(j.state))) break;
  assert(Date.now() < until, 'Import timed out');
  await new Promise((r) => setTimeout(r, 100));
}
// Imports in checks don't start the pass by themselves (VIRTUAL_CUT_PICTURE_PASS=manual).
assert(!snap.jobs.some((j) => j.kind === 'visual'));
const [first, second] = snap.model.recordings.map((r) => r.id);
await service.close();

let app;
const errors = [];
const shots = [];
const shot = async (name) => {
  const image = await app.evaluate(async ({ BrowserWindow }) =>
    (
      await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, {
        stayHidden: true,
      })
    )
      .toPNG()
      .toString('base64'),
  );
  await writeFile(path.join(dir, name), Buffer.from(image, 'base64'));
  shots.push(name);
};
const setIdle = (seconds) =>
  app.evaluate((_, value) => {
    process.env.VIRTUAL_CUT_IDLE_SECONDS = String(value);
  }, seconds);
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
      VIRTUAL_CUT_IDLE_SECONDS: '0',
      // Small chunks so each state lasts long enough to see on a 45 s recording.
      VIRTUAL_CUT_PICTURE_CHUNK: '0.5',
      VIRTUAL_CUT_PICTURE_GPU: gpu ? '' : '0',
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
  const card = (id) => main.locator(`[data-recording="${id}"]`);
  const status = (id) => card(id).locator('[data-picture-status]');
  await main.locator(`[data-recording="${first}"]`).click();
  await expect(status(first)).toHaveAttribute('data-picture-status', 'none');
  const analyse = card(first).getByRole('button', { name: 'Analyse picture now', exact: true });
  await expect(analyse).toBeVisible();
  // Keyboard reaches the button and it does not select the card behind it.
  await analyse.focus();
  await expect(analyse).toBeFocused();
  await shot('1-card-analyse-picture-now.png');

  // Like every project action, starting it stops playback; the pass then waits.
  await analyse.press('Enter');
  // With no NVIDIA decoder it waits for idle; with one it starts reading at once.
  await expect(status(first)).toHaveAttribute('data-picture-status', gpu ? 'running' : 'queued');
  if (!gpu) await expect(status(first)).toContainText('Picture events waiting');
  // Playing the preview pauses the pass: the GPU decoder stays with playback.
  // (With NVDEC it stops part way and keeps what it has read.)
  await main.getByRole('button', { name: 'Play · K / Space', exact: true }).click();
  await expect(main.getByRole('button', { name: 'Pause · K / Space', exact: true })).toBeVisible();
  await main.getByRole('button', { name: /^Jobs/ }).click();
  const jobs = main.getByRole('dialog', { name: 'Media jobs' });
  const lane = jobs.locator('[data-picture-use]');
  await expect(lane).toHaveText('Media lane · Paused: preview playing');
  await shot('2-jobs-paused-preview-playing.png');
  await jobs.getByRole('button', { name: 'Close' }).click();
  // Stop the preview (it may already have stopped while the dialog was open).
  const pause = main.getByRole('button', { name: 'Pause · K / Space', exact: true });
  if (await pause.isVisible()) await pause.click();
  await expect(main.getByRole('button', { name: 'Play · K / Space', exact: true })).toBeVisible();

  // Working at the PC: the GPU decoder alone, or no NVIDIA decoder and a wait for idle.
  if (gpu) {
    await expect(status(first)).toHaveAttribute('data-picture-status', 'running');
    await main.getByRole('button', { name: /^Jobs/ }).click();
    await expect(lane).toHaveText('Media lane · GPU decoder');
    await expect(status(first)).toContainText(/Reading picture… \d+%/);
    await shot('3-reading-gpu-decoder.png');
    await setIdle(600);
    await expect(lane).toHaveText('Media lane · GPU decoder + CPU');
    await shot('4-reading-gpu-decoder-and-cpu.png');
  } else {
    await main.getByRole('button', { name: /^Jobs/ }).click();
    await expect(lane).toHaveText('Media lane · Waiting for the PC to be idle (no NVIDIA decoder)');
    await shot('3-waiting-for-idle-no-nvidia.png');
    await setIdle(600);
    await expect(lane).toHaveText('Media lane · CPU');
    await expect(status(first)).toContainText(/Reading picture… \d+%/);
    await shot('4-reading-cpu.png');
  }
  await jobs.getByRole('button', { name: 'Close' }).click();
  // The card while it reads, part way (when the pass is still running by then).
  for (
    const end = Date.now() + 10000;
    Date.now() < end;
    await new Promise((r) => setTimeout(r, 100))
  ) {
    const now = await main.evaluate(() => window.virtualCut.project.current());
    const job = now.jobs.find((j) => j.kind === 'visual' && j.state === 'running');
    if (!job || job.progress >= 0.2) break;
  }
  if ((await status(first).getAttribute('data-picture-status')) === 'running')
    await shot('4b-card-reading-picture.png');
  await expect(status(first)).toHaveAttribute('data-picture-status', 'ready', { timeout: 60000 });
  await expect(status(first)).toHaveText(
    gpu
      ? /^Picture events ready · (\d+ min )?\d+ s · GPU( \+ CPU)?$/
      : /^Picture events ready · (\d+ min )?\d+ s · CPU$/,
  );
  await shot('5-card-picture-events-ready.png');

  // Jobs: the batch's remaining recording, in one click.
  await main.getByRole('button', { name: /^Jobs/ }).click();
  await expect(jobs).toContainText('1 recording in this batch without picture events');
  await jobs.getByRole('button', { name: 'Analyse picture now', exact: true }).click();
  await expect(status(second)).toHaveAttribute('data-picture-status', 'ready', { timeout: 60000 });
  await expect(jobs).toContainText('Every recording in this batch has picture events');
  await expect(
    jobs.getByRole('button', { name: 'Analyse picture now', exact: true }),
  ).toBeDisabled();
  await shot('6-jobs-batch-done.png');
  const current = await main.evaluate(() => window.virtualCut.project.current());
  for (const id of [first, second]) {
    assert(current.pictures[id], 'Picture events stored');
    assert.equal(current.pictures[id].counts.black, 5, 'One black screen every 9 s');
  }
  assert(!JSON.stringify(current.model).includes('picture'), 'Nothing in the editable model');
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({ status: 'passed', gpu, dir, shots, pictures: current.pictures }, null, 2),
  );
} finally {
  await app?.close();
}
