import { testPath } from './test-paths.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron, expect } from 'playwright/test';
import { root, require, electronEnvironment } from './shared.mjs';

const scratch = testPath('filmstrip');
const fixture = JSON.parse(await readFile(path.join(scratch, 'latest-native.json'), 'utf8'));
const dir = await mkdtemp(path.join(scratch, 'reuse-'));
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
  errors = [],
  evidence = {};
page.setDefaultTimeout(20000);
page.on('pageerror', (e) => errors.push(e.message));
const go = (name) =>
  page
    .getByRole('navigation', { name: 'Workspace pages' })
    .getByRole('button', { name, exact: true })
    .click();
const tiles = page.locator('[data-tile-time]');
const paint = () =>
  app.evaluate(async ({ BrowserWindow }) => {
    await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, {
      stayHidden: true,
      stayAwake: true,
    });
  });
const loaded = async () => {
  await paint();
  await expect
    .poll(() =>
      tiles.evaluateAll(
        (els) =>
          els.length > 1 &&
          els.every((e) => {
            const img = e.querySelector('img');
            return img?.complete && img.naturalWidth > 0;
          }),
      ),
    )
    .toBe(true);
};
const pictures = () =>
  tiles.evaluateAll((els) =>
    els.map((el) => ({
      requested: +el.dataset.tileTime,
      actual: +el.dataset.frameTime,
      src: el.querySelector('img')?.src,
      x: el.getBoundingClientRect().x,
      width: el.getBoundingClientRect().width,
    })),
  );
const requests = () => app.evaluate(() => globalThis.filmstripRequests);
const reset = () =>
  app.evaluate(() => {
    globalThis.filmstripRequests = [];
  });
async function capture(name) {
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    await wc.capturePage(undefined, { stayHidden: true, stayAwake: true });
    await new Promise((r) => setTimeout(r, 250));
    return (await wc.capturePage(undefined, { stayHidden: true, stayAwake: true }))
      .toPNG()
      .toString('base64');
  });
  await writeFile(path.join(dir, name + '.png'), Buffer.from(png, 'base64'));
}
try {
  await app.evaluate(({ BrowserWindow, dialog, ipcMain }, file) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.unmaximize();
    win.setSize(1800, 1100);
    win.webContents.setAudioMuted(true);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    // Test-only request tracing around the existing trusted IPC handler.
    const handler = ipcMain._invokeHandlers.get('workspace:filmstrip');
    globalThis.filmstripRequests = [];
    ipcMain.removeHandler('workspace:filmstrip');
    ipcMain.handle('workspace:filmstrip', (event, ...args) => {
      globalThis.filmstripRequests.push({ source: args[1], times: args[2] });
      return handler(event, ...args);
    });
  }, fixture.file);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await go('Media');
  await loaded();
  const state = await page.evaluate(() => window.virtualCut.project.current());
  const [a, b] = state.model.recordings;
  const choose = async (id) => {
    await page.locator(`[data-recording="${id}"]`).click();
    await loaded();
  };
  await choose(a.id);
  const before = await pictures();
  await choose(b.id);
  await reset();
  await choose(a.id);
  await page.waitForTimeout(600);
  assert.deepEqual(
    (await pictures()).map((p) => p.src),
    before.map((p) => p.src),
  );
  assert.deepEqual(await requests(), [], 'Revisit does not cross IPC or decode');
  evidence.revisit = { tiles: before.length, requests: 0 };
  await go('Cut');
  await loaded();
  await page.getByRole('button', { name: 'Zoom in timeline', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in timeline', exact: true }).click();
  await loaded();
  const track = page.getByTestId('scrub-surface');
  await page.getByRole('group', { name: 'Timeline pan', exact: true }).getByRole('slider').focus();
  await page.keyboard.press('Home');
  await loaded();
  const initial = await pictures();
  const view = await track.evaluate((el) => ({
    start: +el.dataset.viewStart,
    end: +el.dataset.viewEnd,
    width: el.clientWidth,
  }));
  await reset();
  // Pan a quarter viewport using the actual Ctrl+wheel handler. Observe before
  // the 250 ms decode debounce, then assert only newly exposed slots requested.
  await track.dispatchEvent('wheel', { ctrlKey: true, deltaY: 100 });
  const during = await pictures();
  const common = during.filter((p) => initial.some((q) => q.requested === p.requested));
  assert(common.length >= Math.floor(initial.length / 2));
  for (const p of common) {
    const q = initial.find((q) => q.requested === p.requested);
    assert.equal(p.src, q.src, 'Existing image stays in its source-time tile');
    assert(Math.abs(p.x - q.x + view.width / 4) < 2, 'Image translates with timeline');
  }
  await loaded();
  const pans = await requests();
  for (const req of pans) assert(req.times.every((at) => !initial.some((p) => p.requested === at)));
  evidence.pan = { retained: common.length, newlyRequested: pans.flatMap((r) => r.times).length };
  await capture('pan-wide');
  await reset();
  await track.dispatchEvent('wheel', { ctrlKey: true, deltaY: -100 });
  await loaded();
  await page.waitForTimeout(400);
  assert.deepEqual(await requests(), [], 'Returning pan reuses all tiles');
  // Keyboard zoom/reset remains usable; play suppresses uncached work.
  await page.getByRole('button', { name: 'Fit full recording', exact: true }).focus();
  await page.keyboard.press('Enter');
  await loaded();
  await page.locator('video').evaluate(async (v) => {
    v.currentTime = 0.5;
    v.playbackRate = 0.25;
    await v.play();
  });
  await reset();
  for (let i = 0; i < 4; i++)
    await page
      .getByRole('button', { name: 'Zoom in timeline', exact: true })
      .evaluate((b) => b.click());
  await page.waitForTimeout(500);
  assert.equal(
    await page.locator('video').evaluate((v) => v.paused),
    false,
    'Playback still active during assertion',
  );
  assert.deepEqual(await requests(), [], 'No generation while playing');
  await page.locator('video').evaluate((v) => v.pause());
  await loaded();
  // Rapid pan and source changes must not install a response in another recording.
  for (const delta of [100, -100, 100, 100, -100])
    await track.dispatchEvent('wheel', { ctrlKey: true, deltaY: delta });
  await page.locator(`[data-recording="${b.id}"]`).click();
  await page.locator(`[data-recording="${a.id}"]`).click();
  await loaded();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 720));
  await loaded();
  const height = await tiles.first().evaluate((el) => el.parentElement.clientHeight);
  assert([48, 64].includes(height));
  await capture('compact');
  await go('Media');
  await loaded();
  await capture('media-revisit');
  await go('Review');
  const details = page
    .locator('[data-card]')
    .first()
    .getByRole('button', { name: 'Details', exact: true });
  await details.click();
  await loaded();
  const reviewImages = (await pictures()).map((p) => p.src);
  await details.click();
  await reset();
  await details.click();
  await loaded();
  await page.waitForTimeout(400);
  assert.deepEqual(
    (await pictures()).map((p) => p.src),
    reviewImages,
  );
  assert.deepEqual(await requests(), [], 'Review reopening also reuses its visible strip');
  await capture('review-revisit');
  assert.deepEqual(errors, []);
  evidence.result =
    'Revisit without IPC; source-aligned pan; only new requests; reverse pan hits; pause-only; rapid switches; compact and keyboard passed';
  await writeFile(path.join(dir, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ dir, ...evidence }));
} catch (error) {
  await capture('failure').catch(() => {});
  console.error(dir);
  throw error;
} finally {
  await app.close();
}
