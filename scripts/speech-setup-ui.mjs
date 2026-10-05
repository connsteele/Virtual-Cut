import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, copyFile, writeFile, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
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
// A disposable manual setup is in use, so switching back to it is possible.
const fakeManual = path.join(dir, 'manual-speech');
await mkdir(path.join(fakeManual, 'Lib', 'site-packages', 'faster_whisper'), { recursive: true });
await mkdir(path.join(fakeManual, 'model'), { recursive: true });
await writeFile(path.join(fakeManual, 'python.exe'), '');
await writeFile(path.join(fakeManual, 'model', 'model.bin'), '');
await mkdir(path.join(dir, 'profile'), { recursive: true });
await writeFile(
  path.join(dir, 'profile', 'transcription-runtime.json'),
  JSON.stringify({
    python: path.join(fakeManual, 'python.exe'),
    libraries: path.join(fakeManual, 'Lib', 'site-packages'),
    model: path.join(fakeManual, 'model'),
    gpuLibraries: '',
    device: 'cpu',
    threads: 4,
  }),
);
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
const capture = async (name) => {
  // A hidden window returns its previous frame first, so capture twice.
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('#transcript'),
    ).webContents;
    await contents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    await new Promise((resolve) => setTimeout(resolve, 150));
    return (await contents.capturePage(undefined, { stayHidden: true, stayAwake: true }))
      .toPNG()
      .toString('base64');
  });
  await writeFile(path.join(dir, name), Buffer.from(png, 'base64'));
};
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
  await transcript.getByRole('button', { name: 'Speech engine', exact: true }).click();
  const setup = transcript.getByRole('region', { name: 'Speech engine settings' });
  const engine = setup.getByLabel(/^Speech engine: /);
  const advanced = setup.getByText('Advanced: use my own Python installation', { exact: true });
  await expect(setup).toBeVisible();
  await expect(
    setup.getByRole('button', { name: 'Download and install', exact: true }),
  ).toHaveCount(0);
  // One engine card. Your own installation is in use, so Advanced starts open, and the kept
  // downloaded engine is offered for deletion rather than as a second "setup".
  await expect(engine).toHaveAccessibleName('Speech engine: Ready');
  await expect(engine).toContainText('Your own Python installation');
  await expect(
    setup.getByRole('button', { name: 'Use the downloaded engine again', exact: true }),
  ).toBeVisible();
  await expect(setup.getByLabel('Previous speech engine')).toContainText(fakeInstall);
  await expect(
    setup.getByRole('button', { name: /^Delete previous engine \(\d+\.\d\d GB\)$/ }),
  ).toBeVisible();
  for (const gone of ['In use', 'Other setup', 'Switch to downloaded setup'])
    await expect(setup.getByText(gone, { exact: true })).toHaveCount(0);
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
  await setup.getByRole('button', { name: 'Download speech engine…', exact: true }).click();
  // First pick: beside the kept downloaded engine, not wherever Windows last opened.
  await expect
    .poll(() => app.evaluate(() => globalThis.setupPickerStart))
    .toBe(path.join(dir, 'speech-root'));
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
    .getByLabel('Include NVIDIA acceleration (compatible NVIDIA driver required)')
    .uncheck();
  await expect(
    setup.getByRole('button', { name: 'Download and install', exact: true }),
  ).toHaveCount(0);
  await setup.getByRole('button', { name: 'Download speech engine…', exact: true }).click();
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
  // Open folder only reveals the known engine folders (Explorer is stubbed in this test).
  await app.evaluate(({ shell }) => {
    shell.openPath = async (folder) => {
      globalThis.revealedSetup = folder;
      return '';
    };
  });
  await setup
    .getByLabel('Previous speech engine')
    .getByRole('button', { name: 'Open folder', exact: true })
    .click();
  await expect.poll(() => app.evaluate(() => globalThis.revealedSetup)).toBe(fakeInstall);
  // Switching between the downloaded engine and your own installation lives under
  // Advanced, and each button names what it returns to.
  await setup.getByRole('button', { name: 'Use the downloaded engine again', exact: true }).click();
  await expect(engine).toContainText('Virtual Cut speech engine');
  await expect(engine).toContainText(fakeInstall);
  await expect(setup.getByText('Now using the downloaded engine.', { exact: false })).toBeVisible();
  await expect(setup.getByLabel('Previous speech engine')).toHaveCount(0);
  assert.equal(
    (await transcript.evaluate(async () => (await window.virtualCut.transcript.runtime()).settings))
      .python,
    path.join(fakeInstall, 'python', 'python.exe'),
  );
  await advanced.click();
  await setup.getByRole('button', { name: 'Use my own installation again', exact: true }).click();
  await expect(engine).toContainText('Your own Python installation');
  // Settings round-trip through JSON, which drops undefined optional keys.
  assert.equal(
    JSON.stringify(
      await transcript.evaluate(
        async () => (await window.virtualCut.transcript.runtime()).settings,
      ),
    ),
    JSON.stringify(runtimeBefore),
  );
  // Files deleted in Explorer while the window is open are noticed when it regains focus
  // (M327): the card and the reason say so, and switching away still works.
  await setup.getByRole('button', { name: 'Use the downloaded engine again', exact: true }).click();
  await expect(engine).toContainText(fakeInstall);
  await rm(path.join(fakeInstall, 'model', 'model.bin'));
  await transcript.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(engine).toHaveAccessibleName('Speech engine: Files missing');
  await expect(setup.getByLabel('Speech engine files missing')).toContainText(
    'The speech model was not found',
  );
  assert.equal(
    await transcript.evaluate(
      async () => (await window.virtualCut.transcript.runtime()).configured,
    ),
    false,
  );
  await transcript.evaluate(() =>
    document.querySelector('[aria-label="Speech engine settings"]').scrollIntoView(),
  );
  await capture('setup-removed.png');
  await advanced.click();
  await setup.getByRole('button', { name: 'Use my own installation again', exact: true }).click();
  await expect(
    setup.getByText("The previous engine's files are missing", { exact: false }),
  ).toBeVisible();
  await expect(engine).toHaveAccessibleName('Speech engine: Ready');
  await expect(
    setup.getByRole('button', { name: 'Use the downloaded engine again', exact: true }),
  ).toHaveCount(0);
  await expect(setup.getByLabel('Previous speech engine')).toHaveCount(0);
  await expect(setup.getByLabel('Speech engine files missing')).toHaveCount(0);
  await transcript.evaluate(() =>
    document.querySelector('[aria-label="Speech engine settings"]').scrollIntoView(),
  );
  await capture('engine-card.png');
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
    await capture(`setup-${width}.png`);
  }
  await collectBeforeWindowClose(app);
  await transcript.close();
  const reopened = app.waitForEvent('window');
  await main.getByRole('button', { name: 'Transcript', exact: true }).click();
  const reopenedWindow = await reopened;
  await reopenedWindow.getByRole('button', { name: 'Speech engine', exact: true }).click();
  await expect(
    reopenedWindow
      .getByRole('region', { name: 'Speech engine settings' })
      .getByRole('button', { name: 'Download and install', exact: true }),
  ).toBeVisible();
  await expect(
    reopenedWindow.getByLabel('Include NVIDIA acceleration (compatible NVIDIA driver required)'),
  ).not.toBeChecked();
  await reopenedWindow
    .getByRole('button', { name: 'Download speech engine…', exact: true })
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
        removedSetupNoticedOnFocus: true,
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
