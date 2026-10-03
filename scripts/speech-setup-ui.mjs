import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron, expect } from 'playwright/test';
import { require, root, electronEnvironment } from './shared.mjs';
import { collectBeforeWindowClose } from './coverage-desktop.mjs';
const fixture = JSON.parse(
  await readFile(
    process.env.VIRTUAL_CUT_TRANSCRIPT_FIXTURE ||
      path.join(
        process.env.VIRTUAL_CUT_TEST_ROOT || 'G:/GPT/Work/virtual-cut/m3-storage-validation',
        'transcripts/latest.json',
      ),
    'utf8',
  ),
);
const base = path.join(
  process.env.VIRTUAL_CUT_TEST_ROOT || 'G:/GPT/Work/virtual-cut/runtime-setup/ui',
  'speech-setup-ui',
);
await mkdir(base, { recursive: true });
const dir = await mkdtemp(path.join(base, 'run-'));
const project = path.join(dir, 'setup-review.vcut');
await copyFile(fixture.file, project);
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
  const main = await app.firstWindow();
  main.setDefaultTimeout(20000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.locator('[data-workflow]').waitFor();
  await app.evaluate(({ dialog }, project) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
  }, project);
  await main.getByRole('button', { name: 'Projects', exact: true }).click();
  await main.getByRole('button', { name: 'Open project file…', exact: true }).click();
  const pending = app.waitForEvent('window');
  await main.getByRole('button', { name: 'Transcript', exact: true }).click();
  const transcript = await pending;
  transcript.on('pageerror', (e) => errors.push(e.message));
  await transcript.getByRole('button', { name: 'Local transcription setup', exact: true }).click();
  const setup = transcript.getByRole('region', { name: 'Download local speech setup' });
  await expect(setup).toBeVisible();
  await expect(
    setup.getByRole('button', { name: 'Download and install', exact: true }),
  ).toHaveCount(0);
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, dir);
  const runtimeBefore = await transcript.evaluate(
    async () => (await window.virtualCut.transcript.runtime()).settings,
  );
  const plannedBefore = await transcript.evaluate(() =>
    window.virtualCut.transcript.speechSetup('status'),
  );
  assert.equal(plannedBefore.state, 'idle');
  await setup.getByRole('button', { name: 'Choose setup folder…', exact: true }).click();
  await expect(
    setup.getByRole('button', { name: 'Download and install', exact: true }),
  ).toBeEnabled();
  const planned = await transcript.evaluate(() =>
    window.virtualCut.transcript.speechSetup('status'),
  );
  assert.equal(planned.state, 'planned');
  assert.equal(planned.downloadedBytes, 0);
  assert.ok(planned.downloadBytes > 3e9);
  await setup
    .getByLabel('Include NVIDIA acceleration libraries (compatible NVIDIA driver required)')
    .uncheck();
  await expect(
    setup.getByRole('button', { name: 'Download and install', exact: true }),
  ).toHaveCount(0);
  await setup.getByRole('button', { name: 'Choose setup folder…', exact: true }).click();
  const cpu = await transcript.evaluate(() => window.virtualCut.transcript.speechSetup('status'));
  assert.ok(cpu.downloadBytes < planned.downloadBytes);
  assert.deepEqual(
    await transcript.evaluate(async () => (await window.virtualCut.transcript.runtime()).settings),
    runtimeBefore,
  );
  const refused = await transcript.evaluate(async () => {
    try {
      await window.virtualCut.transcript.speechSetup('activate');
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(refused, true);
  for (const width of [900, 500]) {
    await app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().endsWith('#transcript'))
          .setSize(width, 700),
      width,
    );
    assert.equal(
      await transcript.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
    );
    await setup.getByRole('button', { name: 'Download and install', exact: true }).focus();
    await expect(
      setup.getByRole('button', { name: 'Download and install', exact: true }),
    ).toBeFocused();
    const png = await app.evaluate(async ({ BrowserWindow }) =>
      (
        await BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().endsWith('#transcript'))
          .webContents.capturePage(undefined, { stayHidden: true })
      )
        .toPNG()
        .toString('base64'),
    );
    await writeFile(path.join(dir, `setup-${width}.png`), Buffer.from(png, 'base64'));
  }
  await collectBeforeWindowClose(app);
  await transcript.close();
  const reopened = app.waitForEvent('window');
  await main.getByRole('button', { name: 'Transcript', exact: true }).click();
  const reopenedWindow = await reopened;
  await reopenedWindow
    .getByRole('button', { name: 'Local transcription setup', exact: true })
    .click();
  await expect(
    reopenedWindow
      .getByRole('region', { name: 'Download local speech setup' })
      .getByRole('button', { name: 'Download and install', exact: true }),
  ).toBeVisible();
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(dir, 'report.json'),
    JSON.stringify(
      {
        passed: true,
        planned,
        cpu,
        untouchedRuntime: true,
        compactKeyboard: true,
        reopenedPlan: true,
      },
      null,
      2,
    ),
  );
  console.log(
    `Speech setup consent, native folder planning, compact UI and reopen checks passed: ${dir}`,
  );
} finally {
  if (app) await app.close();
}
