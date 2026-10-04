import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { root, require, electronEnvironment } from './shared.mjs';
const source =
  process.env.VIRTUAL_CUT_LONG_FIXTURE ||
  'G:/GPT/Work/virtual-cut/spoken-cues-20260929/recording.mp4';
const base = 'G:/GPT/Work/virtual-cut/milestone-1';
await mkdir(base, { recursive: true });
const dir = await mkdtemp(path.join(base, 'long-')),
  before = await stat(source);
const app = await electron.launch({
  executablePath: require('electron'),
  args: [root, `--user-data-dir=${path.join(dir, 'profile')}`, '--background-test'],
  cwd: root,
  env: electronEnvironment({ TEMP: 'G:/GPT/Temp', TMP: 'G:/GPT/Temp' }),
});
let page;
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ dialog, BrowserWindow }, dir) => {
    BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true);
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: dir + '/long.vcut' });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, dir);
  await page.locator('[data-workflow]').waitFor();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByLabel('New project name').fill('Long AV1 validation');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByText('Bring recordings into this batch')).toBeVisible();
  await app.evaluate(({ dialog }, source) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
  }, source);
  const start = Date.now();
  await page.getByRole('button', { name: 'Import files', exact: true }).click();
  await page.getByRole('button', { name: 'Choose files…', exact: true }).click();
  const current = () => page.evaluate(() => window.virtualCut.project.current());
  await expect
    .poll(
      async () => {
        const p = await current();
        if (p.jobs.some((j) => j.state === 'failed')) throw Error(JSON.stringify(p.jobs));
        return p.jobs.length >= 2 && p.jobs.every((j) => j.state === 'succeeded');
      },
      { timeout: 240000, intervals: [500, 1000] },
    )
    .toBe(true);
  const inspectionAndGameAudioMs = Date.now() - start;
  let p = await current();
  const r = p.model.recordings[0];
  assert.equal(r.width, 3840);
  assert.equal(r.height, 2160);
  assert.equal(r.codec, 'av1');
  assert(r.duration > 470);
  const index = await page.evaluate(
    ([project, source]) => window.virtualCut.project.frameIndex(project, source),
    [p.project.id, r.id],
  );
  assert(index.frameTimes.length > 28000);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await page.getByText('Source & audio', { exact: false }).click();
  await page
    .getByLabel('mic audio track', { exact: true })
    .selectOption(String(r.audioTracks[1].index));
  await expect
    .poll(async () => (await current()).jobs.every((j) => j.state === 'succeeded'), {
      timeout: 120000,
    })
    .toBe(true);
  await page.getByRole('button', { name: 'Combined', exact: true }).click();
  await expect(page.locator('audio')).toHaveCount(2);
  const seekMs = [];
  for (const target of [10, 237, 465]) {
    const start = Date.now();
    await page.locator('video').evaluate((v, t) => {
      v.currentTime = t;
    }, target);
    await page.waitForFunction((t) => {
      const v = document.querySelector('video');
      return v && !v.seeking && v.readyState >= 2 && Math.abs(v.currentTime - t) < 0.06;
    }, target);
    seekMs.push(Date.now() - start);
  }
  await page.getByRole('button', { name: 'Play · K / Space', exact: true }).click();
  await expect
    .poll(() => page.locator('audio').evaluateAll((items) => items.every((a) => !a.paused)))
    .toBe(true);
  const playback = await page.evaluate(async () => {
    const v = document.querySelector('video');
    const samples = [];
    let last = performance.now();
    const q = v.getVideoPlaybackQuality();
    const started = v.currentTime;
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const now = performance.now();
      samples.push({
        eventLoopGapMs: now - last,
        drift: Math.max(
          ...[...document.querySelectorAll('audio')].map((a) =>
            Math.abs(a.currentTime - v.currentTime),
          ),
        ),
      });
      last = now;
    }
    const next = v.getVideoPlaybackQuality();
    return {
      advanced: v.currentTime - started,
      frames: next.totalVideoFrames - q.totalVideoFrames,
      dropped: next.droppedVideoFrames - q.droppedVideoFrames,
      maxEventLoopGapMs: Math.max(...samples.map((s) => s.eventLoopGapMs)),
      maxAudioDriftSeconds: Math.max(...samples.map((s) => s.drift)),
    };
  });
  await page.getByRole('button', { name: 'Pause · K / Space', exact: true }).click();
  assert(playback.advanced > 3.5);
  assert(playback.maxAudioDriftSeconds < 0.3, JSON.stringify(playback));
  const after = await stat(source);
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    dir,
    source,
    duration: r.duration,
    resolution: [r.width, r.height],
    codec: r.codec,
    frameCount: index.frameTimes.length,
    keyframes: index.keys.length,
    audioTracks: r.audioTracks.length,
    inspectionAndGameAudioMs,
    seekMs,
    playback,
  };
  await writeFile(path.join(base, 'latest-long.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await app.close();
}
