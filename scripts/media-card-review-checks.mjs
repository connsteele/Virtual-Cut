import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { root, require, electronEnvironment } from './shared.mjs';
const scratch = 'G:/GPT/Work/virtual-cut/transport-investigation';
const fixture = JSON.parse(await readFile(path.join(scratch, 'latest-fixture.json'), 'utf8'));
const dir = await mkdtemp(path.join(scratch, 'card-review-'));
const file = path.join(dir, 'cards.vcut');
await copyFile(fixture.file, file);
const executable = process.env.VIRTUAL_CUT_TEST_EXECUTABLE;
const app = await electron.launch({
  executablePath: executable || require('electron'),
  args: [
    ...(executable ? [] : [root]),
    `--user-data-dir=${path.join(dir, 'profile')}`,
    '--background-test',
  ],
  cwd: root,
  env: electronEnvironment({ TEMP: 'G:/GPT/Temp', TMP: 'G:/GPT/Temp' }),
});
const results = [];
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ BrowserWindow, dialog }, file) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1800, 1100);
    w.webContents.setAudioMuted(true);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, file);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Workspace pages' })
    .getByRole('button', { name: 'Media', exact: true })
    .click();
  const divider = page.getByRole('separator', { name: 'Resize media browser' });
  const cards = page.locator('#media-pool-panel [data-recording]');
  const measure = () =>
    cards.evaluateAll((els) =>
      els.map((el) => {
        const rect = (e) => e.getBoundingClientRect().toJSON();
        return {
          title: rect(el.querySelector('strong')),
          date: rect(el.querySelector('time')),
          duration: rect(el.querySelector(':scope > span:not([class*="noThumb"])')),
          actions: rect(el.querySelector('button').parentElement),
          overflow: el.scrollWidth > el.clientWidth + 1,
        };
      }),
    );
  const aligned = (a, b) => Math.abs((a.top + a.bottom - b.top - b.bottom) / 2) < 2;
  async function capture(name) {
    const data = await app.evaluate(async ({ BrowserWindow }) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      await wc.capturePage(undefined, { stayHidden: true, stayAwake: true });
      await new Promise((r) => setTimeout(r, 1100));
      return (await wc.capturePage(undefined, { stayHidden: true, stayAwake: true }))
        .toPNG()
        .toString('base64');
    });
    await writeFile(path.join(dir, name + '.png'), Buffer.from(data, 'base64'));
  }
  for (const width of [520, 360, 260, 180]) {
    await divider.focus();
    while (Number(await divider.getAttribute('aria-valuenow')) !== width) {
      const current = Number(await divider.getAttribute('aria-valuenow'));
      await page.keyboard.press(current > width ? 'ArrowLeft' : 'ArrowRight');
    }
    await page.getByRole('button', { name: 'Thumbnails', exact: true }).click();
    await page.waitForTimeout(100);
    let rows = await measure();
    assert(
      rows.every((r) => !r.overflow && aligned(r.duration, r.actions)),
      JSON.stringify({ width, view: 'thumbnails', rows }),
    );
    results.push({ width, view: 'thumbnails', rows });
    await capture('thumbnails-' + width);
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await page.waitForTimeout(100);
    rows = await measure();
    assert(
      rows.every((r) => !r.overflow && aligned(r.duration, r.actions)),
      JSON.stringify({ width, view: 'list', rows }),
    );
    assert(
      rows.every((r) => (width === 520 ? aligned(r.title, r.date) : r.date.top >= r.title.bottom)),
      JSON.stringify({ width, rows }),
    );
    results.push({ width, view: 'list', rows });
    await capture('list-' + width);
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 720));
  await page.waitForTimeout(200);
  const compactRows = await measure();
  assert(compactRows.every((r) => !r.overflow && r.date.top >= r.title.bottom));
  assert(
    await page.locator('#media-pool-panel').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  );
  await capture('compact-window-list');
  await page.getByRole('button', { name: 'Thumbnails', exact: true }).click();
  await capture('compact-window-thumbnails');
  await cards
    .first()
    .getByRole('button', { name: /Show source in Explorer/ })
    .focus();
  await expect(
    cards.first().getByRole('button', { name: /Show source in Explorer/ }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cards.first().getByRole('button', { name: /Remove/ })).toBeFocused();
  assert.deepEqual(errors, []);
  console.log('Media card review checks passed:', dir);
} finally {
  await writeFile(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(dir);
  await app.close();
}
