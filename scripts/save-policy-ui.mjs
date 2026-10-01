import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, copyFile, rename, unlink } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { _electron as electron, expect } from 'playwright/test';
import { root, require, electronEnvironment } from './shared.mjs';
import { testPath } from './test-paths.mjs';
const base = testPath('save-policy');
await mkdir(base, { recursive: true });
const dir = await mkdtemp(path.join(base, 'ui-'));
const fixture = JSON.parse(await readFile(testPath('m1-feedback', 'latest-native.json'), 'utf8'));
const file = path.join(dir, 'test.vcut');
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
  env: electronEnvironment(),
});
const page = await app.firstWindow(),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.setDefaultTimeout(15000);
const state = () => page.evaluate(() => window.virtualCut.project.current());
const disk = () => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return JSON.parse(db.prepare('SELECT body FROM project WHERE id=1').get().body).model;
  } finally {
    db.close();
  }
};
const capture = async (name) => {
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (
      await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      })
    )
      .toPNG()
      .toString('base64'),
  );
  await writeFile(path.join(dir, name + '.png'), Buffer.from(png, 'base64'));
};
// Advance wall time in both processes while leaving real media/event timers alone.
const advance = async (ms) => {
  await app.evaluate((_, ms) => {
    globalThis.originalNow ??= Date.now;
    globalThis.clockOffset = (globalThis.clockOffset || 0) + ms;
    Date.now = () => globalThis.originalNow() + globalThis.clockOffset;
  }, ms);
  await page.evaluate((ms) => {
    window.originalNow ??= Date.now;
    window.clockOffset = (window.clockOffset || 0) + ms;
    Date.now = () => window.originalNow() + window.clockOffset;
  }, ms);
};
try {
  await app.evaluate(({ BrowserWindow, dialog }, file) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(1600, 1000);
    win.webContents.setAudioMuted(true);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, file);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await page.getByRole('button', { name: 'Save history', exact: true }).click();
  await expect(page.getByLabel('Autosave interval')).toHaveValue('10');
  await expect(page.getByLabel('Also save after edits')).not.toBeChecked();
  await page.getByLabel('Autosave interval').focus();
  await capture('autosave-wide');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 720));
  await capture('autosave-compact');
  await expect(page.getByLabel('Autosave interval')).toBeInViewport();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Workspace pages' })
    .getByRole('button', { name: 'Cut', exact: true })
    .click();
  const name = page.getByLabel('Clip name', { exact: true }).first();
  const original = await name.inputValue();
  const cid = (await state()).model.clips[0].id;
  await name.fill('Timer edit');
  await page.evaluate(() => document.activeElement.blur());
  await expect.poll(async () => (await state()).unsavedEdits).toBe(true);
  assert.equal(disk().clips.find((c) => c.id === cid).name, original);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(name).toHaveValue(original);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(name).toHaveValue('Timer edit');
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('banner').getByRole('status')).toHaveText('Manual save made');
  assert.equal(disk().clips.find((c) => c.id === cid).name, 'Timer edit');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await name.fill('Due while seeking');
  await page.evaluate(() => document.activeElement.blur());
  await expect.poll(async () => (await state()).unsavedEdits).toBe(true);
  await advance(9 * 60000);
  await page.waitForTimeout(2500);
  assert.equal(disk().clips.find((c) => c.id === cid).name, 'Timer edit');
  await page.evaluate(() => {
    let n = 0;
    window.seeks = setInterval(() => {
      const v = document.querySelector('video');
      if (v) v.currentTime = 1 + (++n % 30) / 10;
    }, 120);
  });
  await page.waitForTimeout(500);
  await advance(61000);
  await page.waitForTimeout(3000);
  assert.equal(
    disk().clips.find((c) => c.id === cid).name,
    'Timer edit',
    'Due save waits for seeking',
  );
  await page.evaluate(() => clearInterval(window.seeks));
  await expect.poll(() => disk().clips.find((c) => c.id === cid).name).toBe('Due while seeking');
  assert((await state()).saves.some((s) => s.kind === 'auto'));
  await page.getByRole('button', { name: 'Save history', exact: true }).click();
  await page.getByLabel('Autosave interval').selectOption('1');
  await page.getByLabel('Also save after edits').check();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await name.fill('Save after edits');
  await page.evaluate(() => document.activeElement.blur());
  await expect.poll(() => disk().clips.find((c) => c.id === cid).name).toBe('Save after edits');
  const saves = (await state()).saves.length,
    savedAt = (await state()).savedAt;
  await page.locator('video').evaluate((v) => {
    v.currentTime = 2;
  });
  await page.waitForTimeout(3200);
  assert.equal(
    (await state()).savedAt,
    savedAt,
    'Navigation alone does not trigger save-after-edits',
  );
  assert.equal((await state()).saves.length, saves);
  await page.reload();
  await expect.poll(async () => (await state()).project.file).toBe(file);
  await page.getByRole('button', { name: 'Save history', exact: true }).click();
  await expect(page.getByLabel('Autosave interval')).toHaveValue('1');
  await expect(page.getByLabel('Also save after edits')).toBeChecked();
  await page.getByLabel('Also save after edits').uncheck();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  // Block only this disposable fixture's save-copy folder. Failed Save must remain
  // visible after a subsequent in-memory edit, and Retry must make a real save.
  const savesFolder = file + '.saves';
  await rename(savesFolder, savesFolder + '-held');
  await writeFile(savesFolder, 'Fixture: temporarily unavailable save-copy folder');
  try {
    await name.fill('Failed checkpoint');
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('Control+s');
    await expect(page.getByRole('banner').getByRole('status')).toHaveText('Not saved');
    await name.fill('Recovered checkpoint');
    await page.evaluate(() => document.activeElement.blur());
    await expect.poll(async () => (await state()).unsavedEdits).toBe(true);
    await expect(page.getByRole('banner').getByRole('status')).toHaveText('Not saved');
    await expect(page.getByRole('button', { name: 'Retry saving', exact: true })).toBeVisible();
  } finally {
    await unlink(savesFolder);
    await rename(savesFolder + '-held', savesFolder);
  }
  await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
  await expect(page.getByRole('banner').getByRole('status')).toHaveText('Manual save made');
  assert.equal(disk().clips.find((c) => c.id === cid).name, 'Recovered checkpoint');
  await expect(page.getByRole('button', { name: 'Retry saving', exact: true })).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(
    'Autosave default/interval, idle guard, manual Save, live Undo, save failure/retry, settings persistence and compact UI passed',
    dir,
  );
} finally {
  await app.close();
}
