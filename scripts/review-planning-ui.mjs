import { testPath } from './test-paths.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron, expect } from 'playwright/test';
import { root, require, electronEnvironment } from './shared.mjs';
const scratch = testPath('review-planning');
const fixture = JSON.parse(await readFile(path.join(scratch, 'latest-native.json'), 'utf8'));
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
page.setDefaultTimeout(15000);
page.on('pageerror', (e) => errors.push(e.message));
const state = () => page.evaluate(() => window.virtualCut.project.current());
const nav = page.getByRole('navigation', { name: 'Workspace pages' });
const card = (id) => page.locator(`[data-card="${id}"]`);
const modal = () => page.getByRole('dialog');
async function capture(name) {
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    await wc.capturePage(undefined, { stayHidden: true, stayAwake: true });
    return (await wc.capturePage(undefined, { stayHidden: true, stayAwake: true }))
      .toPNG()
      .toString('base64');
  });
  await writeFile(path.join(dir, name + '.png'), Buffer.from(png, 'base64'));
}
try {
  await app.evaluate(({ BrowserWindow, dialog }, file) => {
    BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true);
    BrowserWindow.getAllWindows()[0].setSize(1600, 1000);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, fixture.file);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await nav.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(card(fixture.clipIds[0])).toBeVisible();
  await page.getByRole('button', { name: 'Destination plan', exact: true }).click();
  await expect(modal().getByRole('table')).toContainText('Ready to review');
  await expect(modal()).toContainText(fixture.dest);
  await capture('plan-wide');
  await modal().getByRole('button', { name: 'Close dialog' }).click();
  await page.getByLabel('Current batch', { exact: true }).selectOption({ label: 'Other batch' });
  await page.getByRole('button', { name: 'Destination plan', exact: true }).click();
  await modal()
    .getByRole('row')
    .filter({ hasText: 'First' })
    .getByRole('button', { name: 'Review clip' })
    .click();
  await expect(card(fixture.clipIds[0]).locator('input[value="First"]')).toBeVisible();
  await expect(page.getByLabel('Current batch', { exact: true })).not.toHaveValue(
    (await state()).batches.find((b) => b.name === 'Other batch').id,
  );
  await card(fixture.clipIds[0]).getByRole('checkbox').check();
  await card(fixture.clipIds[1]).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Destination · 2', exact: true }).click();
  await modal().getByRole('button', { name: 'Destination root' }).click();
  await modal().getByRole('button', { name: 'Existing', exact: true }).click();
  await modal().getByLabel('New child folder (optional)').fill('CON');
  await expect(modal().getByRole('button', { name: 'Assign folder' })).toBeDisabled();
  await modal().getByLabel('New child folder (optional)').fill('Planned UI');
  await expect(modal()).toContainText('Existing\\Planned UI');
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async (_window, options) => {
      globalThis.openedDestination = options.defaultPath;
      return { canceled: true, filePaths: [] };
    };
  });
  await modal().getByRole('button', { name: 'Choose folder…', exact: true }).click();
  assert.equal(
    await app.evaluate(() => globalThis.openedDestination),
    path.join(fixture.dest, 'Existing'),
  );
  await expect(modal()).toContainText('Existing\\Planned UI');
  await app.evaluate(({ dialog }, dest) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dest] });
  }, fixture.dest);
  await modal().getByRole('button', { name: 'Choose folder…', exact: true }).click();
  await expect(modal().getByLabel('New child folder (optional)')).toHaveValue('');
  await modal().getByRole('button', { name: 'Existing', exact: true }).click();
  await modal().getByLabel('New child folder (optional)').fill('Planned UI');
  await capture('folder-wide');
  await modal().getByRole('button', { name: 'Assign folder' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(async () => (await state()).model.clips.every((c) => c.folder === 'Existing/Planned UI'))
    .toBe(true);
  assert.equal(await stat(path.join(fixture.dest, 'Existing/Planned UI')).catch(() => null), null);
  await page.getByRole('button', { name: 'Tree', exact: true }).click();
  const tree = page
    .locator('aside')
    .filter({ has: page.getByRole('button', { name: 'All destinations', exact: true }) });
  await tree.getByRole('button', { name: 'Existing', exact: true }).click();
  await expect(page.locator('[data-card]')).toHaveCount(2);
  await expect(tree.getByRole('button', { name: /^Use / })).toHaveCount(0);
  const separator = page.getByRole('separator', { name: 'Resize destination folders' });
  const originalWidth = Number(await separator.getAttribute('aria-valuenow'));
  await separator.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(Number(await separator.getAttribute('aria-valuenow')), originalWidth + 20);
  const separatorBox = await separator.boundingBox();
  await page.mouse.move(separatorBox.x + 2, separatorBox.y + 100);
  await page.mouse.down();
  await page.mouse.move(separatorBox.x + 72, separatorBox.y + 100);
  await page.mouse.up();
  assert(Number(await separator.getAttribute('aria-valuenow')) > originalWidth + 60);
  await capture('tree-wide');
  assert(
    await tree.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    'Folder rows fit inside the tree padding',
  );
  await card(fixture.clipIds[0])
    .getByRole('button', { name: 'Review source', exact: true })
    .click();
  await expect(page.locator('main[data-page="cut"]')).toBeVisible();
  await expect(page.locator(`[data-cut-clip="${fixture.clipIds[0]}"]`)).toHaveAttribute(
    'data-selected',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Play · K / Space', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'H · Manipulate', exact: true }).click();
  const pin = page.locator('[data-marker="move-marker"]');
  await expect(pin).toHaveAttribute('data-manipulate', 'true');
  const pinBox = await pin.boundingBox(),
    surface = await page.getByTestId('scrub-surface').boundingBox();
  await page.mouse.move(pinBox.x + pinBox.width / 2, pinBox.y + pinBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    pinBox.x + pinBox.width / 2 + surface.width / 6,
    pinBox.y + pinBox.height / 2,
    { steps: 10 },
  );
  const oldTime = (await state()).model.markers[(await state()).model.recordings[0].id][0].time;
  assert.equal(oldTime, 1, 'Dragging previews without persisting intermediate times');
  assert.equal(
    await pin.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return document
        .elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
        ?.closest('[data-marker]')
        ?.getAttribute('data-marker');
    }),
    'move-marker',
    'Dragged marker stays on top of a later overlapping marker',
  );
  await page.mouse.up();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const marker = async () => {
    const p = await state();
    return p.model.markers[p.model.recordings[0].id][0];
  };
  assert(Math.abs((await marker()).time - 2) < 0.04);
  assert.equal((await marker()).note, 'Retain\nnotes');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await marker()).time).toBe(1);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await marker()).time).toBe(2);
  const movedBox = await pin.boundingBox();
  await page.mouse.move(movedBox.x + 12, movedBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(movedBox.x + 150, movedBox.y + 10, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  assert.equal((await marker()).time, 2);
  await expect(pin).toHaveAttribute('aria-disabled', 'false');
  await pin.focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await marker()).time).toBeGreaterThan(2);
  assert(
    Math.abs((await marker()).time - (2 + 1 / 30)) < 0.0001,
    `Nudged marker: ${JSON.stringify(await marker())}`,
  );
  await capture('manipulate-wide');
  await nav.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'All 2', exact: true }).click();
  await card(fixture.clipIds[0]).getByRole('button', { name: 'Accept', exact: true }).click();
  await page.getByRole('button', { name: 'Queue 1', exact: true }).click();
  await expect(
    card(fixture.clipIds[0]).getByRole('button', { name: 'Accepted', exact: true }),
  ).toBeVisible();
  const nameInput = card(fixture.clipIds[0]).locator('input[value="First"]');
  if (!(await nameInput.isVisible()))
    await card(fixture.clipIds[0]).getByRole('button', { name: 'Details', exact: true }).click();
  await nameInput.fill('Second');
  await page.getByRole('button', { name: 'Remaining 2', exact: true }).click();
  await expect(
    card(fixture.clipIds[0]).getByRole('button', { name: 'Accept', exact: true }),
  ).toBeDisabled();
  await expect(card(fixture.clipIds[1]).locator('[data-destination-hold]')).toContainText(
    'Another clip',
  );
  await expect(page.getByRole('button', { name: 'Held 2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Destination plan', exact: true }).click();
  await expect(modal()).toContainText('Another clip');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 720));
  await capture('plan-compact');
  const bounds = await modal().boundingBox();
  assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 1100);
  await modal().getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
  await expect(modal()).toContainText('Local logging available');
  await app.evaluate(
    ({ clipboard, shell, dialog }, out) => {
      clipboard.writeText = (text) => {
        globalThis.copiedDiagnostics = text;
      };
      shell.openPath = async (file) => {
        globalThis.openedLogs = file;
        return '';
      };
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: out });
    },
    path.join(dir, 'diagnostics.txt'),
  );
  await modal().getByRole('button', { name: 'Copy diagnostics' }).click();
  const copied = await app.evaluate(() => globalThis.copiedDiagnostics);
  assert(copied.includes('session-start'));
  const toolVersions = copied
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line))
    .filter((event) => event.event === 'tool-version');
  assert(toolVersions.some((event) => event.tool === 'ffmpeg' && event.version));
  assert(toolVersions.some((event) => event.tool === 'ffprobe' && event.version));
  assert(!copied.includes('Confidential context'));
  assert(!copied.includes(fixture.source));
  await modal().getByRole('button', { name: 'Open logs', exact: true }).click();
  assert((await app.evaluate(() => globalThis.openedLogs)).endsWith('diagnostics'));
  await modal().getByRole('button', { name: 'Save diagnostic report…' }).click();
  await expect(modal()).toContainText('Diagnostic report saved.');
  assert((await readFile(path.join(dir, 'diagnostics.txt'), 'utf8')).includes('session-start'));
  await modal().getByRole('button', { name: 'Save diagnostic report…' }).click();
  await expect(modal()).toContainText('choose a new filename');
  await capture('diagnostics-compact');
  await modal().getByRole('button', { name: 'Close dialog' }).click();
  await nav.getByRole('button', { name: 'Cut', exact: true }).click();
  const headerOverflow = await page
    .locator('header')
    .first()
    .evaluate((e) => e.scrollWidth - e.clientWidth);
  assert(headerOverflow <= 1, `Compact header overflow: ${headerOverflow}`);
  await page.getByRole('button', { name: 'Diagnostics', exact: true }).focus();
  await expect(page.getByRole('button', { name: 'Diagnostics', exact: true })).toBeFocused();
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(dir, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        errors,
        nativePlan: true,
        noFoldersCreated: true,
        compact: true,
        diagnostics: true,
      },
      null,
      2,
    ),
  );
  console.log('Review planning and diagnostics UI passed:', dir);
} finally {
  await app.close();
}
