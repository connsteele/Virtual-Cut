import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
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
  const previews = modal.locator('summary').filter({ hasText: /^Disposable previews \(4\)$/ });
  await expect(previews).toBeVisible();
  await expect(previews.locator('..')).not.toHaveAttribute('open');
  await expect(modal.locator('summary').filter({ hasText: /^Save copies \(2\)$/ })).toBeVisible();
  assert.equal(
    await modal
      .locator('summary')
      .filter({ hasText: /^Project file/ })
      .count(),
    0,
  );
  await previews.focus();
  await page.keyboard.press('Enter');
  await expect(previews.locator('..').locator('li')).toHaveCount(4);
  await page.keyboard.press('Enter');
  const retained = modal.locator('summary').filter({ hasText: /^Retained files or folders/ });
  await retained.click();
  await expect(modal).toContainText('A retained, valid save can still recover its checkpoint');
  await expect(modal).toContainText('Save copy is open or has pending database files');
  await retained.click();
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
  const storage = page.getByRole('region', { name: 'Project storage' });
  await expect(storage).toContainText('Total measured, excluding source footage');
  await expect(storage).toContainText('Before-upgrade saves');
  const current = await page.evaluate(() => window.virtualCut.project.current());
  const unknown = path.join(current.project.cache, 'test-size.txt');
  await writeFile(unknown, 'x'.repeat(4096));
  await storage.getByRole('button', { name: 'Refresh storage' }).focus();
  await page.keyboard.press('Enter');
  await expect(
    storage
      .locator('div')
      .filter({ has: page.locator('dt', { hasText: /^Other cache files/ }) })
      .filter({ has: page.locator('dd', { hasText: '4 KB' }) }),
  ).toHaveCount(1);
  assert.equal(
    (await page.evaluate(() => window.virtualCut.project.current())).revision,
    current.revision,
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
    await storage.scrollIntoViewIfNeeded();
    assert(await storage.evaluate((e) => e.scrollWidth <= e.clientWidth + 1));
    await expect(storage.getByRole('button', { name: 'Refresh storage' })).toBeInViewport();
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
    await writeFile(path.join(dir, `storage-${w}.png`), Buffer.from(data, 'base64'));
  }
  await page.getByRole('button', { name: 'Delete project: Active cleanup', exact: true }).click();
  await expect(modal).toContainText('The project is closed');
  assert.equal(await page.evaluate(() => window.virtualCut.project.current()), null);
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert(await stat(activeFile));
  await page.getByRole('button', { name: 'Delete project: Active cleanup', exact: true }).click();
  await modal.getByRole('button', { name: 'Delete with cleanup', exact: true }).click();
  await expect(modal).toContainText('completed exports and their companions were preserved');
  await expect(
    page.getByRole('button', { name: 'Delete project: Active cleanup', exact: true }),
  ).toHaveCount(0);
  assert.equal(await stat(activeFile).catch(() => null), null);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, dir }));
} finally {
  await app.close();
}
