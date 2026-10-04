import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, copyFile, writeFile, stat } from 'node:fs/promises';
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
// A disposable downloaded setup stands in as the "other" setup; no real runtime is touched.
const fakeInstall = path.join(
  dir,
  'speech-root',
  'Virtual Cut speech',
  'install-00000000-0000-4000-8000-000000000000',
);
await mkdir(path.join(fakeInstall, 'python'), { recursive: true });
await mkdir(path.join(fakeInstall, 'libraries', 'faster_whisper'), { recursive: true });
await mkdir(path.join(fakeInstall, 'model'), { recursive: true });
await writeFile(path.join(fakeInstall, 'python', 'python.exe'), '');
await writeFile(path.join(fakeInstall, 'model', 'model.bin'), '');
await mkdir(path.join(dir, 'profile'), { recursive: true });
await writeFile(
  path.join(dir, 'profile', 'speech-previous-runtime.json'),
  JSON.stringify({
    python: path.join(fakeInstall, 'python', 'python.exe'),
    libraries: path.join(fakeInstall, 'libraries'),
    model: path.join(fakeInstall, 'model'),
    gpuLibraries: path.join(fakeInstall, 'libraries'),
    device: 'auto',
    threads: 4,
  }),
);
const localAppData = path.join(dir, 'localappdata');
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
    env: electronEnvironment({
      TEMP: process.env.TEMP || 'G:/GPT/Temp',
      TMP: process.env.TMP || 'G:/GPT/Temp',
      LOCALAPPDATA: localAppData,
    }),
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
  // Both setups are listed with their folders before any download.
  await expect(setup.getByLabel('In use: Manual setup')).toBeVisible();
  await expect(setup.getByLabel('Other setup: Downloaded setup')).toContainText(fakeInstall);
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async (_window, options) => {
      globalThis.setupPickerStart = options.defaultPath;
      return { canceled: false, filePaths: [dir] };
    };
  }, dir);
  const runtimeBefore = await transcript.evaluate(
    async () => (await window.virtualCut.transcript.runtime()).settings,
  );
  const plannedBefore = await transcript.evaluate(() =>
    window.virtualCut.transcript.speechSetup('status'),
  );
  assert.equal(plannedBefore.state, 'idle');
  await setup
    .getByRole('button', { name: 'Choose folder for a new download…', exact: true })
    .click();
  // First pick: beside the other downloaded setup, not wherever Windows last opened.
  assert.equal(
    await app.evaluate(() => globalThis.setupPickerStart),
    path.join(dir, 'speech-root'),
  );
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
  await setup
    .getByRole('button', { name: 'Choose folder for a new download…', exact: true })
    .click();
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
  // Open folder only reveals the known setup folder (Explorer is stubbed in this test).
  await app.evaluate(({ shell }) => {
    shell.openPath = async (folder) => {
      globalThis.revealedSetup = folder;
      return '';
    };
  });
  await setup
    .getByLabel('Other setup: Downloaded setup')
    .getByRole('button', { name: 'Open folder', exact: true })
    .click();
  await expect.poll(() => app.evaluate(() => globalThis.revealedSetup)).toBe(fakeInstall);
  // The switch button names its target, the two setups trade places, and switching back restores.
  await setup.getByRole('button', { name: 'Switch to downloaded setup', exact: true }).click();
  await expect(setup.getByLabel('In use: Downloaded setup')).toContainText(fakeInstall);
  await expect(setup.getByText('Now using the downloaded setup.', { exact: false })).toBeVisible();
  assert.equal(
    (await transcript.evaluate(async () => (await window.virtualCut.transcript.runtime()).settings))
      .python,
    path.join(fakeInstall, 'python', 'python.exe'),
  );
  await setup.getByRole('button', { name: 'Switch to manual setup', exact: true }).click();
  await expect(setup.getByLabel('In use: Manual setup')).toBeVisible();
  // Settings round-trip through JSON, which drops undefined optional keys.
  assert.equal(
    JSON.stringify(
      await transcript.evaluate(
        async () => (await window.virtualCut.transcript.runtime()).settings,
      ),
    ),
    JSON.stringify(runtimeBefore),
  );
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
  await expect(
    reopenedWindow.getByLabel(
      'Include NVIDIA acceleration libraries (compatible NVIDIA driver required)',
    ),
  ).not.toBeChecked();
  await reopenedWindow
    .getByRole('button', { name: 'Choose folder for a new download…', exact: true })
    .click();
  const reopenedCpu = await reopenedWindow.evaluate(() =>
    window.virtualCut.transcript.speechSetup('status'),
  );
  assert.equal(reopenedCpu.includeGpu, false);
  const keepFile = path.join(dir, 'user-file-to-keep.txt');
  await writeFile(keepFile, 'Keep this unrelated file.');
  // Pause a native download after its first chunk, then close the whole app normally.
  await app.evaluate(() => {
    globalThis.fetch = async (_url, options) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            options.signal.addEventListener('abort', () => controller.error(new Error('Aborted')));
          },
        }),
      );
  });
  await reopenedWindow.getByRole('button', { name: 'Download and install', exact: true }).click();
  await expect
    .poll(async () => {
      try {
        return (
          await stat(
            path.join(reopenedCpu.folder, 'downloads', 'python-3.12.10-embed-amd64.zip.part'),
          )
        ).size;
      } catch {
        return 0;
      }
    })
    .toBe(3);
  await collectBeforeWindowClose(app);
  const child = app.process();
  const exited = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('App did not finish setup cleanup on close.')),
      15000,
    );
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  await main.evaluate(() => window.virtualCut.project.finishClose()).catch(() => {});
  await exited;
  app = undefined;
  await assert.rejects(stat(reopenedCpu.folder), { code: 'ENOENT' });
  assert.equal(await readFile(keepFile, 'utf8'), 'Keep this unrelated file.');
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
        orderlyCloseRemovedOnlyPartialSetup: true,
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
