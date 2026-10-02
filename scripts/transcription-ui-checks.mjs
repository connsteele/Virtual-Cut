import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron, expect } from 'playwright/test';
import { require, root, electronEnvironment } from './shared.mjs';
const fixture = JSON.parse(
  await readFile(
    process.env.VIRTUAL_CUT_TRANSCRIPT_FIXTURE ||
      path.join(
        process.env.VIRTUAL_CUT_TEST_ROOT || 'G:/GPT/Work/virtual-cut/m3-storage-validation',
        'transcripts',
        'latest.json',
      ),
    'utf8',
  ),
);
const output = path.join(
  process.env.VIRTUAL_CUT_TEST_ROOT || 'G:/GPT/Work/virtual-cut/m3-ui-validation',
  'transcript-ui',
);
await mkdir(output, { recursive: true });
const dir = await mkdtemp(path.join(output, 'run-'));
const file = path.join(dir, 'speech-review.vcut');
await copyFile(fixture.file, file);
let app;
const errors = [];
try {
  app = await electron.launch({
    executablePath: process.env.VIRTUAL_CUT_TEST_EXECUTABLE || require('electron'),
    args: [
      ...(process.env.VIRTUAL_CUT_TEST_EXECUTABLE ? [] : [root]),
      `--user-data-dir=${path.join(dir, 'profile')}`,
      '--background-test',
    ],
    cwd: root,
    env: electronEnvironment({ TEMP: 'G:/GPT/Temp', TMP: 'G:/GPT/Temp' }),
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('[data-workflow]').waitFor();
  await app.evaluate(({ dialog, BrowserWindow }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true);
  }, file);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Transcript', exact: true })).toBeEnabled();
  const newWindow = app.waitForEvent('window');
  await page.getByRole('button', { name: 'Transcript', exact: true }).click();
  const transcript = await newWindow;
  transcript.setDefaultTimeout(20000);
  transcript.on('pageerror', (e) => errors.push(e.message));
  await expect(transcript.getByRole('heading', { name: 'Transcript', exact: true })).toBeVisible();
  await expect(transcript.getByLabel('Transcript phrases').locator('article')).not.toHaveCount(0);
  const phrases = transcript.getByLabel('Transcript phrases');
  const words = phrases.locator('article').first().locator('[class*="words"] button');
  await words.nth(3).click();
  await expect(transcript.getByLabel('Transcript correction')).toBeVisible();
  const expectedTime = await transcript.evaluate(() =>
    document.querySelector('[class*="words"] .selected')?.getAttribute('title'),
  );
  await expect.poll(() => page.locator('video').evaluate((v) => v.currentTime)).toBeGreaterThan(0);
  const position = await page.locator('video').evaluate((v) => v.currentTime);
  assert.ok(position > 0, `Word click must seek the main viewer (${expectedTime})`);
  await transcript.getByLabel('Corrected transcript text').fill('Cai');
  await transcript.getByRole('button', { name: 'Save correction', exact: true }).click();
  await expect(words.nth(3)).toHaveText('Cai');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(words.nth(3)).not.toHaveText('Cai');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(words.nth(3)).toHaveText('Cai');
  await transcript.getByRole('button', { name: 'Close edit', exact: true }).click();
  await phrases
    .locator('article')
    .first()
    .getByRole('button', { name: 'Edit phrase', exact: true })
    .click();
  await transcript
    .getByLabel('Corrected transcript text')
    .fill('A corrected phrase with different words.');
  await transcript.getByRole('button', { name: 'Save correction', exact: true }).click();
  await expect(phrases.locator('article').first()).toContainText('phrase timing');
  await transcript.getByRole('button', { name: 'Restore original', exact: true }).click();
  await expect(phrases.locator('article').first()).not.toContainText('phrase timing');
  await transcript.getByRole('button', { name: 'Close edit', exact: true }).click();
  await transcript.getByLabel('Search transcript').fill('zzzz-not-present');
  await expect(transcript.getByText('No matching phrases.')).toBeVisible();
  await transcript.getByLabel('Search transcript').fill('');
  await expect(phrases.locator('article')).not.toHaveCount(0);
  // An isolated floating renderer cannot use broad workspace/file access.
  assert.match(
    await transcript.evaluate(() =>
      window.virtualCut.project
        .current()
        .then(() => 'unsafe')
        .catch((e) => e.message),
    ),
    /rejected/,
  );
  for (const [width, height, name] of [
    [760, 850, 'wide'],
    [500, 600, 'compact'],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().endsWith('#transcript'))
          .setSize(size[0], size[1]);
      },
      [width, height],
    );
    await new Promise((r) => setTimeout(r, 250));
    const shot = await app.evaluate(async ({ BrowserWindow }) =>
      (
        await BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().endsWith('#transcript'))
          .webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
      )
        .toPNG()
        .toString('base64'),
    );
    await writeFile(path.join(dir, `${name}.png`), Buffer.from(shot, 'base64'));
    assert.ok(
      await transcript.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'No horizontal overflow',
    );
  }
  await transcript.close();
  const reopenedPromise = app.waitForEvent('window');
  await page.getByRole('button', { name: 'Transcript', exact: true }).click();
  const reopened = await reopenedPromise;
  await expect(reopened.getByLabel('Transcript phrases')).toContainText('Cai');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(dir, 'result.json'),
    JSON.stringify({ fixture, wordSeek: position, passed: true, errors }, null, 2),
  );
  console.log(
    `Floating transcript, seeking, corrections, Undo, phrase timing, reopen and IPC isolation passed: ${dir}`,
  );
} finally {
  if (app) await app.close();
}
