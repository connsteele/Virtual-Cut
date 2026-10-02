import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron, expect } from 'playwright/test';
import { root, require, electronEnvironment } from './shared.mjs';
import { testPath } from './test-paths.mjs';
const base = testPath('project-deletion');
const fixture = JSON.parse(await readFile(path.join(base, 'latest-native.json'), 'utf8'));
const dir = await mkdtemp(path.join(base, 'ui-'));
await mkdir(path.join(dir, 'profile'), { recursive: true });
await writeFile(path.join(dir, 'profile', 'projects.json'), JSON.stringify([fixture.project]));
const exe = process.env.VIRTUAL_CUT_TEST_EXECUTABLE;
const app = await electron.launch({
  executablePath: exe || require('electron'),
  args: [
    ...(exe ? [] : [root]),
    `--user-data-dir=${path.join(dir, 'profile')}`,
    '--background-test',
  ],
  cwd: root,
  env: electronEnvironment(),
});
const page = await app.firstWindow();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  const trash = () =>
    page.getByRole('button', { name: `Delete project: ${fixture.project.name}`, exact: true });
  await trash().focus();
  await page.keyboard.press('Enter');
  const modal = page.getByRole('dialog');
  await expect(modal).toContainText(
    'Source footage, completed exports and .vcut.json companions are always kept.',
  );
  for (const [w, h] of [
    [1600, 1000],
    [1100, 720],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h),
      [w, h],
    );
    await page.waitForTimeout(150);
    await expect(modal.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
    await expect(
      modal.getByRole('button', { name: 'Delete with cleanup', exact: true }),
    ).toBeInViewport();
    const data = await app.evaluate(async ({ BrowserWindow }) =>
      (
        await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, {
          stayHidden: true,
          stayAwake: true,
        })
      )
        .toPNG()
        .toString('base64'),
    );
    await writeFile(path.join(dir, `delete-${w}.png`), Buffer.from(data, 'base64'));
  }
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert(await stat(fixture.project.file));
  await trash().click();
  await modal.getByRole('button', { name: 'Delete without cleanup', exact: true }).click();
  await expect(trash()).toHaveCount(0);
  await expect(modal).toContainText('completed exports and their companions were preserved');
  assert.equal(await stat(fixture.project.file).catch(() => null), null);
  assert(await stat(fixture.output));
  assert(await stat(fixture.metadata));
  const activeFile = path.join(dir, 'Active cleanup.vcut');
  await app.evaluate(
    ({ dialog }, { file, dir }) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    },
    { file: activeFile, dir },
  );
  await page.getByLabel('New project name').fill('Active cleanup');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Delete project: Active cleanup', exact: true }).click();
  await expect(modal).toContainText('The project is closed');
  assert.equal(await page.evaluate(() => window.virtualCut.project.current()), null);
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert(await stat(activeFile));
  await page.getByRole('button', { name: 'Delete project: Active cleanup', exact: true }).click();
  await modal.getByRole('button', { name: 'Delete with cleanup', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Delete project: Active cleanup', exact: true }),
  ).toHaveCount(0);
  assert.equal(await stat(activeFile).catch(() => null), null);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, dir }));
} finally {
  await app.close();
}
