import { testPath } from './test-paths.mjs';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { root, require, electronEnvironment } from './shared.mjs';
const base = testPath('milestone-1');
const fixture = JSON.parse(await readFile(path.join(base, 'latest-native.json'), 'utf8'));
const dir = await mkdtemp(base + '/timing-');
for (const ext of ['mp4', 'mkv'])
  execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      fixture.source,
      '-map',
      '0:v',
      '-map',
      '0:a',
      '-c',
      'copy',
      '-output_ts_offset',
      '4',
      '-y',
      `${dir}/offset.${ext}`,
    ],
    { windowsHide: true },
  );
const app = await electron.launch({
  executablePath: require('electron'),
  args: [root, `--user-data-dir=${dir}/profile`, '--background-test'],
  cwd: root,
  env: electronEnvironment({
    TEMP: process.env.TEMP || 'G:/GPT/Temp',
    TMP: process.env.TEMP || 'G:/GPT/Temp',
  }),
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  await app.evaluate(({ dialog, BrowserWindow }, dir) => {
    BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true);
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: dir + '/project.vcut' });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, dir);
  await page.locator('[data-workflow]').waitFor();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByLabel('New project name').fill('Timestamp offsets');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByText('Bring recordings into this batch')).toBeVisible();
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [dir + '/offset.mkv', dir + '/offset.mp4'],
    });
  }, dir);
  await page.getByRole('button', { name: 'Import files', exact: true }).click();
  await page.getByRole('button', { name: 'Choose files…', exact: true }).click();
  const current = () => page.evaluate(() => window.virtualCut.project.current());
  await expect
    .poll(
      async () => {
        const p = await current();
        if (p.jobs.some((j) => j.state === 'failed')) throw Error(JSON.stringify(p.jobs));
        return p.jobs.length >= 4 && p.jobs.every((j) => j.state === 'succeeded');
      },
      { timeout: 60000 },
    )
    .toBe(true);
  const p = await current(),
    mkv = p.model.recordings.find((r) => r.sourcePath.endsWith('.mkv')),
    mp4 = p.model.recordings.find((r) => r.sourcePath.endsWith('.mp4'));
  assert.equal(mkv.sourceStart, 4);
  assert(Math.abs(mkv.duration - 8.008) < 0.04);
  await page.locator(`[data-recording="${mkv.id}"]`).click();
  await expect(page.getByRole('button', { name: 'Play · K / Space', exact: true })).toBeEnabled();
  await page.locator('video').evaluate((v) => {
    v.currentTime = 6;
  });
  await page.waitForFunction(() => !document.querySelector('video').seeking);
  await page.getByRole('button', { name: 'Marker', exact: true }).click();
  await expect
    .poll(async () =>
      (await current()).model.markers[mkv.id].some(
        (m) => m.name === 'New marker' && Math.abs(m.time - 2) < 0.01,
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Play · K / Space', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate((a) => a.paused)).toBe(false);
  const drift = await page
    .locator('audio')
    .evaluate((a) =>
      Math.abs(a.currentTime - (document.querySelector('video').currentTime - 4 + 0.023)),
    );
  assert(drift < 0.2, String(drift));
  await page.getByRole('button', { name: 'Pause · K / Space', exact: true }).click();
  await page.locator(`[data-recording="${mp4.id}"]`).click();
  await expect(page.getByText(/timestamp offset is not supported/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play · K / Space', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Q · In', exact: true })).toBeDisabled();
  await writeFile(
    path.join(base, 'latest-timing.json'),
    JSON.stringify(
      {
        passed: true,
        dir,
        offset: mkv.sourceStart,
        duration: mkv.duration,
        drift,
        unsupportedMp4Blocked: true,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, dir, drift }));
} finally {
  await app.close();
}
