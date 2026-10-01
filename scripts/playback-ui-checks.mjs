import { testPath } from './test-paths.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron, expect } from 'playwright/test';
import { root, require, electronEnvironment } from './shared.mjs';
const checks = testPath('m2-followup');
const fixture = JSON.parse(await readFile(testPath('m1-feedback/latest-native.json'), 'utf8'));
await mkdir(checks, { recursive: true });
const dir = await mkdtemp(path.join(checks, 'playback-ui-'));
const executable = process.env.VIRTUAL_CUT_TEST_EXECUTABLE;
const app = await electron.launch({
  executablePath: executable || require('electron'),
  args: [
    ...(executable ? [] : [root]),
    `--user-data-dir=${path.join(dir, 'profile')}`,
    '--background-test',
  ],
  cwd: root,
  env: electronEnvironment({
    TEMP: process.env.TEMP || 'G:/GPT/Temp',
    TMP: process.env.TEMP || 'G:/GPT/Temp',
  }),
});
const page = await app.firstWindow(),
  errors = [];
page.setDefaultTimeout(15000);
page.on('pageerror', (e) => errors.push(e.message));
const video = page.locator('video');
const status = page.getByLabel('Playback status', { exact: true });
const metrics = page.getByLabel('Playback metrics', { exact: true });
async function key(value) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press(value);
}
async function seek(at) {
  await video.evaluate((v, t) => {
    v.currentTime = t;
  }, at);
  await expect.poll(() => video.evaluate((v) => v.seeking)).toBe(false);
}
async function go(name) {
  await page
    .getByRole('navigation', { name: 'Workspace pages' })
    .getByRole('button', { name, exact: true })
    .click();
}
async function capture(name) {
  const image = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    await wc.capturePage(undefined, { stayHidden: true, stayAwake: true });
    await new Promise((r) => setTimeout(r, 150));
    return (await wc.capturePage(undefined, { stayHidden: true, stayAwake: true }))
      .toPNG()
      .toString('base64');
  });
  await writeFile(path.join(dir, name + '.png'), Buffer.from(image, 'base64'));
}
try {
  await app.evaluate(({ dialog, BrowserWindow }, file) => {
    BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true);
    BrowserWindow.getAllWindows()[0].setSize(1600, 1000);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, fixture.file);
  await page.evaluate(() => localStorage.setItem('virtual-cut.selection-follows', 'false'));
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await go('Cut');
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await page.getByRole('checkbox', { name: 'Selection follows playhead' }).uncheck();
  const card = page.locator('[data-cut-clip]').first();
  await card.click({ position: { x: 20, y: 20 } });
  await page.getByRole('button', { name: 'Loop selected clip', exact: true }).click();
  for (const rate of [1, 2, 4, 8, 16, 16]) {
    await key('l');
    await expect(status).toHaveText(`${rate}× forward`);
    await expect.poll(() => video.evaluate((v) => v.playbackRate)).toBe(rate);
  }
  await expect(metrics).toHaveText('Scan · metrics paused');
  await expect(page.getByRole('button', { name: 'Forward / faster · L', exact: true })).toHaveCSS(
    'background-color',
    'rgb(4, 99, 95)',
  );
  for (const rate of [1, 2, 4, 8, 16, 16]) {
    await key('j');
    await expect(status).toHaveText(`${rate}× reverse scan`);
  }
  await expect(video).toHaveJSProperty('paused', true);
  await expect(metrics).toHaveText('Scan · metrics paused');
  await capture('reverse-16x-wide');
  await key('k');
  await expect(status).toHaveText('Paused');
  await key('l');
  await expect(status).toHaveText('1× forward');
  await expect
    .poll(async () => Number(await metrics.getAttribute('data-total')))
    .toBeGreaterThan(0);
  await capture('playback-metrics-wide');
  await key('k');
  const pausedTotal = await metrics.getAttribute('data-total');
  await page.waitForTimeout(650);
  assert.equal(await metrics.getAttribute('data-total'), pausedTotal);
  await seek(1.5);
  await page.waitForTimeout(650);
  assert.equal(await metrics.getAttribute('data-total'), pausedTotal, 'Paused seeking is excluded');
  await page.getByRole('button', { name: 'Loop selected clip', exact: true }).click();
  await seek(0.01);
  await key('j');
  await expect(status).toHaveText('Paused');
  await video.evaluate((v) => {
    v.currentTime = v.duration - 0.2;
  });
  await key('l');
  await expect
    .poll(() => video.evaluate((v) => v.ended || (v.paused && v.currentTime >= v.duration - 0.05)))
    .toBe(true);
  await expect(status).toHaveText('Paused');
  // Create adjacent marker cards through the actual keyboard naming flow.
  for (const [at, name] of [
    [0.5, 'First spaced marker'],
    [1, 'Second spaced marker'],
    [1.5, 'Third spaced marker'],
  ]) {
    await seek(at);
    await key('m');
    const field = page
      .locator('[data-marker-card][data-selected=true]')
      .getByLabel('Marker name', { exact: true });
    await expect(field).toBeFocused();
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
  }
  const markerCards = page.locator('[data-marker-card]');
  const boxes = await markerCards.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    }),
  );
  for (let i = 1; i < boxes.length; i++)
    assert(boxes[i].top - boxes[i - 1].bottom >= 8, 'Selection outlines have a clear gap');
  const palette = markerCards.last().getByLabel('Marker color', { exact: true });
  assert.equal(await palette.locator('option').count(), 16);
  const colors = await palette
    .locator('option')
    .evaluateAll((options) => options.map((o) => getComputedStyle(o).color));
  assert.equal(new Set(colors).size, 16);
  await capture('marker-spacing-wide');
  await markerCards.last().getByLabel('Marker name', { exact: true }).focus();
  await page.keyboard.press('l');
  await expect(status).toHaveText('Paused');
  // Exercise telemetry with deterministic browser counter readings. This proves
  // nonzero drops and unavailable data without pretending synthetic load is real footage.
  await seek(0.2);
  await video.evaluate((v) => {
    window.testQuality = { totalVideoFrames: 100, droppedVideoFrames: 10 };
    v.getVideoPlaybackQuality = () => window.testQuality;
  });
  await key('l');
  await page.waitForTimeout(600);
  const beforeDrop = Number(await metrics.getAttribute('data-dropped'));
  await page.evaluate(() => {
    window.testQuality.totalVideoFrames += 20;
    window.testQuality.droppedVideoFrames += 3;
  });
  await expect
    .poll(async () => Number(await metrics.getAttribute('data-dropped')))
    .toBe(beforeDrop + 3);
  await key('k');
  await video.evaluate((v) => {
    v.getVideoPlaybackQuality = undefined;
  });
  await expect(metrics).toHaveText('Playback metrics unavailable');
  await video.evaluate((v) => {
    delete v.getVideoPlaybackQuality;
    v.load();
  });
  await expect.poll(() => metrics.getAttribute('data-total')).toBe('');
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await go('Media');
  await page.locator('[data-recording]').first().click();
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await key('l');
  await expect(status).toHaveText('1× forward');
  await key('l');
  await expect(status).toHaveText('2× forward');
  await key('k');
  await page.locator('[data-recording]').nth(1).click();
  await expect.poll(() => metrics.getAttribute('data-total')).toBe('');
  await expect(status).toHaveText('Paused');
  await go('Review');
  await page.getByRole('button', { name: 'Details', exact: true }).first().click();
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await video.click();
  await key('l');
  await expect(status).toHaveText('1× forward');
  await key('k');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 760));
  await capture('review-metrics-compact');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await go('Cut');
  await capture('marker-spacing-compact');
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(checks, 'latest-playback-ui.json'),
    JSON.stringify({ dir, passed: true }, null, 2),
  );
  console.log('Playback and marker UI checks passed:', dir);
} finally {
  await app.close();
}
