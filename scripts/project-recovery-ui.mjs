import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron, expect } from 'playwright/test';
import { root, require, electronEnvironment } from './shared.mjs';
import { testPath } from './test-paths.mjs';
const base = testPath('project-recovery');
const fixture = JSON.parse(await readFile(path.join(base, 'latest-native.json'), 'utf8'));
const dir = await mkdtemp(path.join(base, 'ui-'));
await mkdir(path.join(dir, 'profile'));
const executable = process.env.VIRTUAL_CUT_TEST_EXECUTABLE;
const app = await electron.launch({
  executablePath: executable || require('electron'),
  args: [
    ...(executable ? [] : [root]),
    `--user-data-dir=${path.join(dir, 'profile')}`,
    '--background-test',
  ],
  cwd: root,
  env: electronEnvironment(),
});
const page = await app.firstWindow(),
  errors = [];
page.setDefaultTimeout(15000);
page.on('pageerror', (error) => errors.push(error.message));
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
const modal = () => page.getByRole('dialog');
try {
  await app.evaluate(({ BrowserWindow, dialog }, file) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setSize(1600, 1000);
    window.webContents.setAudioMuted(true);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, fixture.corrupt);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await modal().getByRole('button', { name: 'Open project file…', exact: true }).click();
  await expect(modal().getByRole('alert')).toContainText('Recover from save');
  const recovered = path.join(dir, 'from-checkpoint.vcut');
  await app.evaluate(
    ({ dialog }, { source, recovered }) => {
      dialog.showOpenDialog = async (_window, options) => {
        globalThis.recoveryPicker = options;
        return { canceled: false, filePaths: [source] };
      };
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: recovered });
    },
    { source: fixture.checkpoint, recovered },
  );
  const recoverButton = modal().getByRole('button', { name: 'Recover from save…', exact: true });
  await recoverButton.focus();
  await capture('recovery-wide');
  await page.keyboard.press('Enter');
  await expect(modal()).toHaveCount(0);
  const snapshot = await page.evaluate(() => window.virtualCut.project.current());
  assert.equal(snapshot.project.file, recovered);
  assert.equal(snapshot.model.scratchpad, 'Committed before interruption');
  assert.equal(snapshot.jobs[0].state, 'interrupted');
  assert(snapshot.canUndo);
  assert.equal(
    await app.evaluate(() => globalThis.recoveryPicker.defaultPath),
    fixture.corrupt + '.saves',
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect
    .poll(
      async () => (await page.evaluate(() => window.virtualCut.project.current())).model.scratchpad,
    )
    .toBe('Before child');
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await app.evaluate(({ BrowserWindow, dialog }) => {
    BrowserWindow.getAllWindows()[0].setSize(1100, 720);
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  await modal().getByRole('button', { name: 'Recover from save…', exact: true }).click();
  await expect(modal()).toBeVisible();
  assert.equal(
    (await page.evaluate(() => window.virtualCut.project.current())).project.file,
    recovered,
  );
  await modal().getByRole('button', { name: 'Recover from save…', exact: true }).focus();
  await capture('recovery-compact');
  await modal().getByRole('button', { name: 'Close dialog' }).click();
  // Reopen the migrated fixture to expose its retained v1 save in the real table.
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, fixture.legacy);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await modal().getByRole('button', { name: 'Open project file…', exact: true }).click();
  await page.getByRole('button', { name: 'Save history', exact: true }).click();
  await expect(modal().getByRole('table')).toContainText('Before upgrade');
  await capture('migration-history-compact');
  assert.deepEqual(errors, []);
  console.log(
    'Recovery dialogs, keyboard, cancellation, separate project, retained undo and migration history passed:',
    dir,
  );
} finally {
  await app.close();
}
