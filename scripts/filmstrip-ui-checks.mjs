import { testPath } from './test-paths.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { root, require, electronEnvironment } from './shared.mjs';
const scratch = testPath('filmstrip');
const f = JSON.parse(await readFile(path.join(scratch, 'latest-native.json'), 'utf8'));
const dir = await mkdtemp(path.join(scratch, 'ui-'));
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
page.setDefaultTimeout(20000);
page.on('pageerror', (e) => errors.push(e.message));
const go = (name) =>
  page
    .getByRole('navigation', { name: 'Workspace pages' })
    .getByRole('button', { name, exact: true })
    .click();
const cards = page.locator('[data-recording]');
const order = () => cards.evaluateAll((els) => els.map((el) => el.dataset.recording));
const frames = page.locator('[data-frame-time]');
const state = () => page.evaluate(() => window.virtualCut.project.current());
async function capture(name) {
  // Screenshots are evidence of the thumbnails, so wait until every filmstrip has finished
  // loading and every image has decoded.
  if (name !== 'failure')
    await expect(page.locator('[data-filmstrip-loading]')).toHaveCount(0, { timeout: 15000 });
  await page.evaluate(() =>
    Promise.all([...document.images].map((image) => image.decode().catch(() => {}))),
  );
  const data = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    await wc.capturePage(undefined, { stayHidden: true, stayAwake: true });
    await new Promise((r) => setTimeout(r, 150));
    return (await wc.capturePage(undefined, { stayHidden: true, stayAwake: true }))
      .toPNG()
      .toString('base64');
  });
  await writeFile(path.join(dir, name + '.png'), Buffer.from(data, 'base64'));
}
try {
  await app.evaluate(({ BrowserWindow, dialog }, file) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1800, 1100);
    w.webContents.setAudioMuted(true);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, f.file);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await go('Media');
  const recordings = (await state()).model.recordings;
  assert.equal(recordings.length, 3);
  const expectedDate = [...recordings]
    .sort((a, b) => a.sourceModified - b.sourceModified)
    .map((r) => r.id);
  const expectedIntake = [...recordings]
    .sort((a, b) => b.importedAt - a.importedAt)
    .map((r) => r.id);
  await expect(page.getByLabel('Sort media')).toHaveValue('date-asc');
  assert.deepEqual(await order(), expectedDate);
  for (const r of recordings)
    await expect(page.locator(`[data-recording="${r.id}"] time`)).toHaveAttribute(
      'datetime',
      new Date(r.sourceModified).toISOString(),
    );
  await expect.poll(() => frames.count()).toBeGreaterThan(0);
  assert(
    await frames.locator('img').evaluateAll((els) => els.every((e) => e.src.startsWith('blob:'))),
  );
  await capture('media-thumbnails-wide');
  await page.getByRole('button', { name: 'List', exact: true }).click();
  const rects = await cards.first().evaluate((el) => ({
    title: el.querySelector('strong').getBoundingClientRect().toJSON(),
    date: el.querySelector('time').getBoundingClientRect().toJSON(),
  }));
  assert(rects.date.x > rects.title.x, 'List date appears to the right at wide sizes');
  await capture('media-list-wide');
  await page.getByLabel('Sort media').selectOption('date-desc');
  assert.deepEqual(await order(), [...expectedDate].reverse());
  await page.getByLabel('Sort media').selectOption('intake-desc');
  assert.deepEqual(await order(), expectedIntake);
  await page.getByLabel('Sort media').selectOption('name-asc');
  assert.deepEqual(
    await order(),
    [...recordings].sort((a, b) => a.title.localeCompare(b.title)).map((r) => r.id),
  );
  await page.getByLabel('Sort media').selectOption('date-asc');
  await page.locator(`[data-recording="${expectedDate[0]}"]`).click();
  await page.keyboard.press('Control+ArrowDown');
  await expect.poll(async () => (await state()).model.selectedRecordingId).toBe(expectedDate[1]);
  await go('Cut');
  await go('Media');
  await expect(page.getByLabel('Sort media')).toHaveValue('date-asc');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 720));
  await capture('media-list-compact');
  assert(await cards.evaluateAll((els) => els.every((el) => el.scrollWidth <= el.clientWidth + 1)));
  await page.getByRole('button', { name: 'Thumbnails', exact: true }).click();
  await capture('media-thumbnails-compact');
  await go('Cut');
  await expect.poll(() => frames.count()).toBeGreaterThan(0);
  const track = page.getByTestId('scrub-surface');
  await page.getByRole('button', { name: 'Zoom in timeline', exact: true }).click();
  await expect.poll(() => frames.count()).toBeGreaterThan(0);
  const window = await track.evaluate((el) => ({
    start: +el.dataset.viewStart,
    end: +el.dataset.viewEnd,
  }));
  assert(window.end - window.start < 8);
  for (const t of await frames.evaluateAll((els) => els.map((el) => +el.dataset.frameTime)))
    assert(t >= window.start - 0.5 && t <= window.end + 0.5);
  const image = frames.locator('img').first();
  await image.click();
  await expect.poll(() => page.locator('video').evaluate((v) => v.seeking)).toBe(false);
  await page.getByRole('button', { name: 'Fit full recording', exact: true }).click();
  await expect.poll(() => frames.count()).toBeGreaterThan(0);
  const saved = page.getByRole('banner').getByRole('status');
  await page.locator('video').evaluate((v) => {
    v.currentTime = 2;
  });
  // Navigation is staged in memory; the default timed policy must not flash Saved.
  await page.waitForTimeout(3200);
  await expect(saved).toHaveText('');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(saved).toHaveText('Manual save made');
  await expect(saved).toHaveText('', { timeout: 6000 });
  // A view change while playing defers decoding until playback has stopped.
  await page.locator('video').evaluate(async (v) => {
    v.currentTime = 1;
    await v.play();
  });
  await page.getByRole('button', { name: 'Zoom in timeline', exact: true }).click();
  await expect(page.getByText('Filmstrip updates when paused')).toBeVisible();
  await page.locator('video').evaluate((v) => v.pause());
  await expect.poll(() => frames.count()).toBeGreaterThan(0);
  await capture('cut-filmstrip-compact');
  // M331: with no job waiting, every recording gets its tile file; cards then lose their
  // "Making filmstrip…" mark, and zooming and panning never show "Loading filmstrip…".
  await expect
    .poll(
      async () => {
        const s = await state();
        return s.model.recordings.every((r) => s.filmstrips?.[r.id] === 'ready');
      },
      { timeout: 30000 },
    )
    .toBe(true);
  await go('Media');
  await expect(page.locator('[data-filmstrip-status]')).toHaveCount(0);
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  await expect(page.locator('[data-app-version]')).toHaveText(`Virtual Cut ${version}`);
  await go('Cut');
  await expect(page.locator('[data-filmstrip-loading]')).toHaveCount(0, { timeout: 15000 });
  await page.evaluate(() => {
    window.__stripFlashes = 0;
    window.__stripObserver = new MutationObserver(() => {
      if (
        [...document.querySelectorAll('[role="status"]')].some((el) =>
          el.textContent?.includes('Loading filmstrip'),
        )
      )
        window.__stripFlashes++;
    });
    window.__stripObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  const steps = [
    'Zoom in timeline',
    'Zoom in timeline',
    'Pan timeline right',
    'Pan timeline right',
    'Pan timeline left',
    'Zoom out timeline',
  ];
  for (const name of steps) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('[data-filmstrip-loading]')).toHaveCount(0, { timeout: 15000 });
  }
  assert.equal(
    await page.evaluate(() => (window.__stripObserver.disconnect(), window.__stripFlashes)),
    0,
    'Loading filmstrip… never shows for a recording with a tile file',
  );
  assert.deepEqual(errors, []);
  console.log(`Filmstrip UI checks passed: ${dir}`);
} catch (e) {
  await capture('failure').catch(() => {});
  console.error(dir);
  throw e;
} finally {
  await app.close();
}
