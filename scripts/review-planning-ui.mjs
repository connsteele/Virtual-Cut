import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron, expect } from 'playwright/test';
import { root, require, electronEnvironment } from './shared.mjs';
const scratch = 'G:/GPT/Work/virtual-cut/review-planning';
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
  env: electronEnvironment({ TEMP: 'G:/GPT/Temp', TMP: 'G:/GPT/Temp' }),
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
  await page.getByRole('button', { name: 'Check destinations', exact: true }).click();
  await expect(modal().getByRole('table')).toContainText('Ready to review');
  await expect(modal()).toContainText(fixture.dest);
  await capture('plan-wide');
  await modal().getByRole('button', { name: 'Close dialog' }).click();
  await page.getByLabel('Current batch', { exact: true }).selectOption({ label: 'Other batch' });
  await page.getByRole('button', { name: 'Check destinations', exact: true }).click();
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
  await capture('folder-wide');
  await modal().getByRole('button', { name: 'Assign folder' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(async () => (await state()).model.clips.every((c) => c.folder === 'Existing/Planned UI'))
    .toBe(true);
  assert.equal(await stat(path.join(fixture.dest, 'Existing/Planned UI')).catch(() => null), null);
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
  await card(fixture.clipIds[0]).getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Another clip' })).toBeVisible();
  assert(!(await state()).model.clips[0].accepted);
  await page.getByRole('button', { name: 'Check destinations', exact: true }).click();
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
