import { testPath } from './test-paths.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron, expect } from 'playwright/test';
import { root, require, electronEnvironment } from './shared.mjs';
const checksRoot = testPath('range-markers');
const fixture = JSON.parse(await readFile(path.join(checksRoot, 'latest-native.json'), 'utf8'));
await mkdir(checksRoot, { recursive: true });
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
    TEMP: process.env.TEMP || 'G:/GPT/Temp',
    TMP: process.env.TEMP || 'G:/GPT/Temp',
  }),
});
const page = await app.firstWindow(),
  errors = [];
page.setDefaultTimeout(20000);
page.on('pageerror', (e) => errors.push(e.message));
async function state() {
  return page.evaluate(() => window.virtualCut.project.current());
}
async function saved() {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('banner').getByRole('status')).toHaveText('Manual save made');
}
async function seek(at) {
  await page.locator('video').evaluate((v, at) => (v.currentTime = at), at);
  await expect.poll(() => page.locator('video').evaluate((v) => v.seeking)).toBe(false);
}
async function unfocus() {
  await expect(page.locator('[data-workflow]')).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(() => document.activeElement?.blur());
}
async function go(name) {
  await page
    .getByRole('navigation', { name: 'Workspace pages' })
    .getByRole('button', { name, exact: true })
    .click();
}
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
try {
  await app.evaluate(({ dialog, BrowserWindow }, file) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1600, 1000);
    w.webContents.setAudioMuted(true);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, fixture.file);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await go('Cut');
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  const card = (id) => page.locator(`[data-marker-card="${id}"]`);
  const range = (id) => page.locator(`[data-marker-range="${id}"]`);
  await expect(range('cross-start')).toBeVisible();
  await card('inside').getByLabel('Marker end', { exact: true }).fill('5.5');
  await card('inside').getByLabel('Marker end', { exact: true }).press('Enter');
  await saved();
  let model = (await state()).model;
  assert.equal(model.markers[fixture.rid].find((m) => m.id === 'inside').end, 5.5);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(card('inside').getByLabel('Marker end', { exact: true })).toHaveValue('4.2');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(card('inside').getByLabel('Marker end', { exact: true })).toHaveValue('5.5');
  await unfocus();
  await page.keyboard.press('h');
  await expect(range('inside')).toHaveAttribute('data-manipulate', 'true');
  const surface = await page.getByTestId('scrub-surface').boundingBox();
  const edge = await range('inside')
    .getByLabel('Marker end: Inside', { exact: true })
    .boundingBox();
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 + surface.width / 8, edge.y + edge.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await saved();
  model = (await state()).model;
  assert(Math.abs(model.markers[fixture.rid].find((m) => m.id === 'inside').end - 6.5) < 0.1);
  // Dragging a body retains duration; Escape commits nothing.
  const body = await range('inside')
    .getByRole('button', { name: 'Seek to marker: Inside', exact: true })
    .boundingBox();
  const before = model.markers[fixture.rid].find((m) => m.id === 'inside');
  await page.mouse.move(body.x + body.width / 2, body.y + body.height / 2);
  await page.mouse.down();
  await page.mouse.move(body.x + body.width / 2 + 50, body.y + body.height / 2, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await saved();
  assert.deepEqual(
    (await state()).model.markers[fixture.rid].find((m) => m.id === 'inside'),
    before,
  );
  await card('point').getByRole('button', { name: 'Make range', exact: true }).click();
  await expect(range('point')).toBeVisible();
  await card('point').getByRole('button', { name: 'Make point marker', exact: true }).click();
  await expect(range('point')).toHaveCount(0);
  const point = await page.locator('[data-marker="point"]').boundingBox();
  await page.keyboard.down('Shift');
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
  await page.mouse.down();
  await page.mouse.move(point.x + point.width / 2 + surface.width / 8, point.y + point.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(range('point')).toBeVisible();
  // Manual inspector scrolling stays where the user put it through position updates.
  await range('cross-start')
    .getByRole('button', { name: 'Seek to marker: Cross start', exact: true })
    .click();
  const aside = card('cross-start').locator('xpath=ancestor::aside');
  const scrolled = await aside.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    return el.scrollTop;
  });
  assert(scrolled > 100);
  await seek(2);
  await page.waitForTimeout(1200);
  assert(
    Math.abs((await aside.evaluate((el) => el.scrollTop)) - scrolled) < 2,
    'Manual scrolling wins over position snapshots',
  );
  await capture('ranges-wide');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 720));
  await page.waitForTimeout(300);
  await capture('ranges-compact');
  assert(
    await aside.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    'Marker timing inputs fit the compact inspector without horizontal scrolling',
  );
  const layout = await page.getByTestId('scrub-surface').evaluate((el) => {
    const video = document.querySelector('video').getBoundingClientRect(),
      timeline = el.getBoundingClientRect();
    return { video: video.height, bottom: timeline.bottom, height: innerHeight };
  });
  assert(
    layout.video > 30 && layout.bottom < layout.height,
    'Viewer shrinks and timeline stays visible',
  );
  await unfocus();
  await seek(6);
  await page.keyboard.press('Shift+m');
  await expect(
    page
      .locator('[data-marker-card][data-selected=true]')
      .getByLabel('Marker name', { exact: true }),
  ).toBeFocused();
  await page.keyboard.type('New range keyboard');
  await page.keyboard.press('Enter');
  await saved();
  const created = (await state()).model.markers[fixture.rid].find(
    (m) => m.name === 'New range keyboard',
  );
  assert(created && created.end > created.time);
  await go('Review');
  await saved();
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(
    'Range marker UI, numeric editing, edge manipulation, conversion, scroll and compact layout passed:',
    dir,
  );
} finally {
  await app.close();
}
