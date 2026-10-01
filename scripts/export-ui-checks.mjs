import { testPath } from './test-paths.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron, expect } from 'playwright/test';
import { root, require, electronEnvironment } from './shared.mjs';
const checks = testPath('m2'),
  fixture = JSON.parse(await readFile(path.join(checks, 'latest-native.json'), 'utf8'));
await mkdir(checks, { recursive: true });
const dir = await mkdtemp(path.join(checks, 'ui-'));
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
const state = () => page.evaluate(() => window.virtualCut.project.current());
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
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, fixture.file);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Export selected clip', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Export selected clip', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export selected clip', exact: true });
  await expect(dialog.getByLabel('Export container')).toHaveValue('source');
  await expect(dialog.getByRole('table', { name: 'Export ranges' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Choose output file…' })).toBeDisabled();
  await dialog.getByLabel('Export container').selectOption('mp4');
  await expect(dialog.getByRole('table', { name: 'Export ranges' })).toBeVisible();
  await dialog.getByRole('checkbox').check();
  await capture('export-plan-wide');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 760));
  await capture('export-plan-compact');
  const bounds = await dialog.boundingBox();
  assert(
    bounds.x >= 0 &&
      bounds.y >= 0 &&
      bounds.x + bounds.width <= 1120 &&
      bounds.y + bounds.height <= 760,
  );
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true });
  });
  await dialog.getByRole('button', { name: 'Choose output file…' }).click();
  await expect(dialog).toBeVisible();
  const output = path.join(dir, 'UI exported clip.mp4');
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, output);
  await dialog.getByRole('button', { name: 'Choose output file…' }).click();
  const history = page.getByRole('dialog', { name: 'Exports', exact: true });
  await expect(history).toBeVisible();
  await expect
    .poll(async () => (await state()).exports.find((e) => e.output === output)?.state, {
      timeout: 90000,
    })
    .toBe('verified');
  await expect(history.getByRole('button', { name: /Show video:/ }).last()).toBeVisible();
  await capture('export-history-compact');
  let revealed = '';
  await app.evaluate(({ shell }) => {
    shell.showItemInFolder = (file) => {
      globalThis.__exportRevealed = file;
    };
  });
  const row = history
    .getByRole('row')
    .filter({ hasText: 'Original video and game audio verified' })
    .filter({ hasText: 'bframes' })
    .first();
  await row.getByRole('button', { name: 'Metadata', exact: true }).click();
  revealed = await app.evaluate(() => globalThis.__exportRevealed);
  assert.equal(revealed, output + '.vcut.json');
  await history.getByRole('button', { name: 'Close dialog' }).click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 960));
  const navigation = page.getByRole('navigation', { name: 'Workspace pages' });
  const center = await navigation.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.x + r.width / 2 - innerWidth / 2;
  });
  assert(Math.abs(center) < 1);
  await navigation.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Details', exact: true }).first().click();
  await page.getByRole('button', { name: 'Export clip…', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Export selected clip', exact: true }),
  ).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog' }).click();
  await navigation.getByRole('button', { name: 'Cut', exact: true }).click();
  await page.getByRole('button', { name: 'Exports', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Exports', exact: true }).getByRole('table'),
  ).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Time', exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog' }).click();
  await navigation.getByRole('button', { name: 'Media', exact: true }).click();
  const folderDivider = page.getByRole('separator', { name: 'Resize source folders' });
  const browserDivider = page.getByRole('separator', { name: 'Resize media browser' });
  await folderDivider.focus();
  const initialFolders = Number(await folderDivider.getAttribute('aria-valuenow'));
  await page.keyboard.press('ArrowRight');
  await expect(folderDivider).toHaveAttribute('aria-valuenow', String(initialFolders + 20));
  const box = await browserDivider.boundingBox();
  const initialBrowser = Number(await browserDivider.getAttribute('aria-valuenow'));
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - initialBrowser + 220, box.y + 100, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => browserDivider.getAttribute('aria-valuenow')).toBe('220');
  const cards = page.locator('[data-recording]');
  const first = await cards.nth(0).boundingBox(),
    second = await cards.nth(1).boundingBox();
  assert(
    Math.abs(first.x - second.x) < 1 && second.y > first.y,
    'Narrow media browser becomes one column',
  );
  await capture('media-resized-wide');
  const preferences = await page.evaluate(() => localStorage.getItem('virtual-cut.media-panels'));
  const viewerBeforeCollapse = await page.locator('video').evaluate((v) => ({
    url: v.currentSrc,
    position: v.currentTime,
    width: v.closest('[data-video-stage]').getBoundingClientRect().width,
  }));
  await page.getByRole('button', { name: 'Hide folders', exact: true }).click();
  await expect(folderDivider).toHaveCount(0);
  assert((await cards.count()) > 0);
  await capture('media-folders-hidden');
  await page.getByRole('button', { name: 'Show folders', exact: true }).click();
  await page.getByRole('button', { name: 'Hide media pool', exact: true }).click();
  await expect(cards).toHaveCount(0);
  await expect(browserDivider).toHaveCount(0);
  await expect(folderDivider).toBeVisible();
  await capture('media-pool-hidden');
  await page.getByRole('button', { name: 'Hide both panels', exact: true }).click();
  await expect(folderDivider).toHaveCount(0);
  const viewerCollapsed = await page.locator('video').evaluate((v) => ({
    url: v.currentSrc,
    position: v.currentTime,
    width: v.closest('[data-video-stage]').getBoundingClientRect().width,
  }));
  assert.equal(viewerCollapsed.url, viewerBeforeCollapse.url);
  assert(Math.abs(viewerCollapsed.position - viewerBeforeCollapse.position) < 0.05);
  // The stage expands; the video itself can already be capped by its aspect ratio and height.
  assert(viewerCollapsed.width > viewerBeforeCollapse.width);
  await capture('media-pool-collapsed');
  await navigation.getByRole('button', { name: 'Cut', exact: true }).click();
  await navigation.getByRole('button', { name: 'Media', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show both panels', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show both panels', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(folderDivider).toBeVisible();
  await expect(browserDivider).toHaveAttribute('aria-valuenow', '220');
  assert.equal(
    await page.evaluate(() => localStorage.getItem('virtual-cut.media-panels')),
    preferences,
  );
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 760));
  await capture('media-resized-compact');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert(!overflow, 'Resized media panels fit compact app width');
  await page.getByRole('button', { name: /^Jobs/ }).click();
  await expect(page.getByRole('dialog', { name: 'Media jobs' })).toBeVisible();
  await capture('jobs-actions-compact');
  assert.deepEqual(errors, []);
  await writeFile(path.join(checks, 'latest-ui.json'), JSON.stringify({ dir, output }, null, 2));
  console.log('Export UI checks passed:', JSON.stringify({ dir, output }));
} finally {
  await app.close();
}
