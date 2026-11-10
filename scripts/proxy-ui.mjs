// VC-237: making proxies in the app window. Recording cards show a proxy chip (+ Proxy, Proxy
// waiting / NN%, Proxy 1080p) whose menu makes, stops, removes or shows the proxy, with arrow
// keys and Escape; Jobs shows the proxy job; the Proxies button beside Transcript opens the
// batch's proxy status and the project's settings (when made, size); Never hides the chips and
// the import checkbox; On ticks the import checkbox. Opens the project proxy-native.mjs leaves
// behind. Encodes with x264 on the CPU so it runs on any PC, as an idle PC so the CPU job runs.
import { testPath } from './test-paths.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { root, require, electronEnvironment } from './shared.mjs';

const checksRoot = testPath('proxy-native');
const fixture = JSON.parse(await readFile(path.join(checksRoot, 'latest-native.json'), 'utf8'));
const dir = await mkdtemp(path.join(checksRoot, 'ui-'));
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
    VIRTUAL_CUT_PROXY_ENCODER: 'x264',
    VIRTUAL_CUT_PICTURE_GPU: '0',
    VIRTUAL_CUT_PICTURE_PASS: 'manual',
    VIRTUAL_CUT_PROXY_SEGMENT: '3',
    VIRTUAL_CUT_IDLE_SECONDS: '600',
  }),
});
const page = await app.firstWindow(),
  errors = [];
page.setDefaultTimeout(30000);
page.on('pageerror', (e) => errors.push(e.message));
const state = () => page.evaluate(() => window.virtualCut.project.current());
async function capture(name) {
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
const card = (id) => page.locator(`[data-recording="${id}"]`);
const chip = (id) => card(id).locator('[data-proxy-state]');
const { small, long } = fixture;
try {
  await app.evaluate(({ dialog, BrowserWindow }, file) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1600, 1000);
    w.webContents.setAudioMuted(true);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, fixture.file);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Workspace pages' })
    .getByRole('button', { name: 'Cut', exact: true })
    .click();
  await expect(chip(fixture.ready)).toHaveText('Proxy 1080p');
  await expect(chip(fixture.ready)).toHaveAttribute('data-proxy-state', 'ready');
  await expect(chip(small)).toHaveText('Proxy 720p');
  await expect(chip(long)).toHaveText('+ Proxy');
  await capture('01-cards');

  // Keyboard: the chip opens its menu, arrows move, Escape closes and returns focus.
  await chip(long).focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: /^Proxy for / });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Make proxy (1080p)' })).toBeFocused();
  await capture('02-menu-none');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(chip(long)).toBeFocused();

  // Make proxy, then stop it: the chip shows it being made, the menu stops it.
  await chip(long).click();
  await menu.getByRole('menuitem', { name: 'Make proxy (1080p)' }).click();
  await expect(chip(long)).toHaveText(/^Proxy \d+%/);
  await capture('03-making');
  await chip(long).click();
  await capture('04-menu-making');
  await menu.getByRole('menuitem', { name: 'Show in Jobs' }).click();
  const jobs = page.getByRole('dialog', { name: 'Media jobs' });
  await expect(jobs.getByText(/Make playback proxy · 1080p/).first()).toBeVisible();
  await capture('05-jobs');
  await jobs.getByRole('button', { name: 'Close dialog' }).click();
  await chip(long).click();
  await menu.getByRole('menuitem', { name: 'Stop making proxy' }).click();
  await expect(chip(long)).toHaveText('+ Proxy');
  const stopped = (await state()).jobs.find((j) => j.kind === 'proxy' && j.sourceId === long);
  assert.equal(stopped.state, 'cancelled');

  // Make proxy again at the project's size: the 720p proxy becomes a 1080p one.
  await chip(small).click();
  await menu.getByRole('menuitem', { name: 'Make proxy again' }).click();
  await expect(chip(small)).toHaveText('Proxy 1080p', { timeout: 120000 });
  const made = (await state()).model.recordings.find((r) => r.id === small).proxy;
  assert.equal(made.state, 'ready');
  assert.equal(made.height, 1080);

  // Remove proxy asks first, then removes the file.
  const before = (await state()).model.recordings.find((r) => r.id === fixture.ready).proxy;
  await chip(fixture.ready).click();
  await menu.getByRole('menuitem', { name: 'Remove proxy…' }).click();
  const remove = page.getByRole('dialog', { name: 'Remove proxy' });
  await expect(remove).toContainText('1080p proxy');
  await capture('06-remove');
  await remove.getByRole('button', { name: 'Remove proxy' }).click();
  await expect(chip(fixture.ready)).toHaveText('+ Proxy');
  assert.equal(before.state, 'ready');

  // The Proxies window: batch status, make for the batch, settings.
  await page.getByRole('button', { name: 'Proxies', exact: true }).click();
  const proxies = page.getByRole('dialog', { name: 'Proxies' });
  await expect(proxies.getByRole('list', { name: 'Proxies in this batch' })).toBeVisible();
  await expect(proxies.locator('[data-proxy-row]')).toHaveCount(3);
  await expect(proxies.getByRole('button', { name: 'Make proxies for this batch' })).toBeEnabled();
  await expect(proxies.getByRole('radio', { name: /Off: only when I ask/ })).toBeChecked();
  await expect(proxies.getByRole('radio', { name: /^1080p/ })).toBeChecked();
  await capture('07-proxies-window');
  await proxies.getByRole('radio', { name: /^720p/ }).check();
  await expect.poll(async () => (await state()).proxies?.height).toBe(720);
  await proxies.getByRole('radio', { name: /^Never/ }).check();
  await expect.poll(async () => (await state()).proxies?.onImport).toBe('never');
  await expect(proxies.getByText('Proxies are off for this project.')).toBeVisible();
  await proxies.getByRole('button', { name: 'Close dialog' }).click();
  await expect(card(small).locator('[data-proxy-state]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Import files', exact: true }).click();
  const importing = page.getByRole('dialog', { name: 'Batch audio setup' });
  await expect(importing.getByRole('checkbox', { name: /Make proxies/ })).toHaveCount(0);
  await importing.getByRole('button', { name: 'Close dialog' }).click();
  // On: the import checkbox starts ticked at the project's size.
  await page.getByRole('button', { name: 'Proxies', exact: true }).click();
  await proxies.getByRole('radio', { name: /On: tick the import checkbox/ }).check();
  await expect.poll(async () => (await state()).proxies?.onImport).toBe('import');
  await proxies.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Import files', exact: true }).click();
  const box = importing.getByRole('checkbox', { name: /Make proxies \(720p\) during import/ });
  await expect(box).toBeChecked();
  await capture('08-import-checkbox');
  await importing.getByRole('button', { name: 'Close dialog' }).click();
  await expect(chip(small)).toHaveText('Proxy 1080p');

  // Compact window: the chip stays on the card's icon row.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 720));
  await expect(chip(small)).toBeInViewport();
  await capture('09-compact');
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(JSON.stringify({ status: 'passed', screenshots: dir }, null, 2));
} finally {
  await app.close();
}
