// The Screen text engine card (VC-192, prototype M395) in the Transcript window: not installed,
// a planned download, and, with VIRTUAL_CUT_OCR_DOWNLOADS (a folder of the pinned files), a real
// install from those copies that reads its test image, checks again, switches to a kept engine
// and back, deletes it, and notices deleted files. Screenshots of each state are saved.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, copyFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { require, root, electronEnvironment } from './shared.mjs';
import { testPath } from './test-paths.mjs';

const fixture = JSON.parse(
  await readFile(
    process.env.VIRTUAL_CUT_TRANSCRIPT_FIXTURE || testPath('transcripts', 'latest.json'),
    'utf8',
  ),
);
const base = testPath('screen-text-setup-ui');
await mkdir(base, { recursive: true });
const dir = await mkdtemp(path.join(base, 'run-'));
const project = path.join(dir, 'screen-text.vcut');
await copyFile(fixture.file, project);
const target = path.join(dir, 'engines');
await mkdir(target);
const manifest = JSON.parse(
  await readFile(path.join(root, 'integrations/screen-text/runtime-manifest.json'), 'utf8'),
);
const downloads = process.env.VIRTUAL_CUT_OCR_DOWNLOADS || '';
const canInstall = !!downloads && existsSync(path.join(downloads, manifest.artifacts[0].name));
const result = { passed: false, installed: false, screenshots: [] };
let app;
const errors = [];
const capture = async (name) => {
  await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().endsWith('#transcript'),
    );
    await w.webContents.executeJavaScript(
      "document.getElementById('screen-text-setup').scrollIntoView({block: 'start'})",
    );
  });
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
  result.screenshots.push(name);
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
    // Met as a user would: no development engine, and nothing from the network.
    env: electronEnvironment({
      LOCALAPPDATA: path.join(dir, 'localappdata'),
      VIRTUAL_CUT_OCR_RUNTIME: '',
      VIRTUAL_CUT_OCR_DOWNLOADS: canInstall ? downloads : '',
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
  transcript.setDefaultTimeout(20000);
  transcript.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('#transcript'))
      .setSize(900, 900),
  );
  const gear = transcript.getByRole('button', { name: 'Speech engine', exact: true });
  await expect(gear).toHaveAttribute('title', 'Speech and screen text engines');
  await gear.click();
  // The screen text card sits under the speech card, behind the same gear.
  await expect(transcript.getByRole('region', { name: 'Speech engine settings' })).toBeVisible();
  const card = transcript.locator('#screen-text-setup');
  await expect(card).toHaveAccessibleName('Screen text engine settings');
  const engine = card.getByLabel(/^Screen text engine: /);
  await expect(engine).toHaveAccessibleName('Screen text engine: Not installed');
  await expect(engine).toContainText('no pictures are uploaded');
  await expect(card.getByRole('button', { name: 'Check again' })).toHaveCount(0);
  await capture('01-not-installed.png');

  // Planning: the picker starts in the per-user folder; nothing is created.
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async (_window, options) => {
      globalThis.pickerStart = options.defaultPath;
      globalThis.pickerTitle = options.title;
      return { canceled: false, filePaths: [target] };
    };
  }, target);
  await card.getByRole('button', { name: 'Download screen text engine…', exact: true }).click();
  await expect(card.getByText('Ready to download.', { exact: false })).toBeVisible();
  assert.equal(
    await app.evaluate(() => globalThis.pickerStart),
    path.join(dir, 'localappdata', 'Virtual Cut'),
  );
  assert.equal(
    await app.evaluate(() => globalThis.pickerTitle),
    'Choose where to put the screen text engine',
  );
  await expect(card).toContainText('Download: 0.13 GB · Installed: 0.32 GB');
  await expect(card).toContainText(path.join(target, 'Virtual Cut screen text', 'install-'));
  assert.equal(existsSync(path.join(target, 'Virtual Cut screen text')), false);
  await capture('02-planned.png');

  if (!canInstall) {
    result.installSkipped = 'Set VIRTUAL_CUT_OCR_DOWNLOADS to a folder of the pinned files.';
  } else {
    await card.getByRole('button', { name: 'Download and install', exact: true }).click();
    await expect(engine).toHaveAccessibleName(/^Screen text engine: (Installing|Checking)…$/);
    await expect(engine).toHaveAccessibleName(/^Screen text engine: Ready/, { timeout: 120000 });
    await expect(card.getByText('The screen text engine is installed and in use.')).toBeVisible();
    await expect(engine).toContainText('Virtual Cut screen text engine');
    await expect(engine).toContainText(
      /Reads on the graphics card \(DirectML\)|read on the processor/,
    );
    await expect(engine).toContainText(/Checked today at/);
    await capture('03-ready.png');
    const first = (
      await transcript.evaluate(() => window.virtualCut.transcript.screenTextSetup('status'))
    ).current.folder;
    result.check = (
      await transcript.evaluate(() => window.virtualCut.transcript.screenTextSetup('status'))
    ).check;

    // Check again reads the test image once more.
    await card.getByRole('button', { name: 'Check again', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Check again', exact: true })).toBeEnabled();
    const rechecked = (
      await transcript.evaluate(() => window.virtualCut.transcript.screenTextSetup('status'))
    ).check;
    assert.notEqual(rechecked.at, result.check.at);

    // A kept copy appears as the previous engine (a copy stands in for an older download).
    const owner = 'install-33333333-3333-4333-8333-333333333333';
    const older = path.join(target, 'Virtual Cut screen text', owner);
    await cp(first, older, { recursive: true });
    await writeFile(
      path.join(older, '.virtual-cut-screen-text-install.json'),
      JSON.stringify({ owner, manifest: manifest.id, complete: true }),
    );
    await writeFile(
      path.join(dir, 'profile', 'screen-text-previous-runtime.json'),
      JSON.stringify({ folder: older }),
    );
    await transcript.evaluate(() => window.dispatchEvent(new Event('focus')));
    const previous = card.getByLabel('Previous screen text engine');
    await expect(previous).toContainText(older);
    await expect(
      previous.getByRole('button', { name: /^Delete previous engine \(0\.\d\d GB\)$/ }),
    ).toBeVisible();
    await capture('04-previous-kept.png');
    await previous
      .getByRole('button', { name: 'Use the previous engine again', exact: true })
      .click();
    await expect(
      card.getByText('Now using the previous screen text engine.', { exact: false }),
    ).toBeVisible();
    await expect(engine).toContainText(older);
    await previous
      .getByRole('button', { name: 'Use the previous engine again', exact: true })
      .click();
    await expect(engine).toContainText(first);
    await previous.getByRole('button', { name: /^Delete previous engine/ }).click();
    await expect(
      card.getByText(/Deleted the previous screen text engine and freed 0\.\d\d GB\./).first(),
    ).toBeVisible();
    await expect(previous).toHaveCount(0);
    assert.equal(existsSync(older), false);

    // Compact window and keyboard: the card's buttons are reachable with Tab.
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith('#transcript'))
        .setSize(500, 800),
    );
    const download = card.getByRole('button', { name: 'Download a new copy…', exact: true });
    await card.getByRole('button', { name: 'Check again', exact: true }).focus();
    await transcript.keyboard.press('Tab');
    await expect(download).toBeFocused();
    const overflow = await transcript.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    assert.ok(overflow <= 0, `No sideways scrolling at 500 px (${overflow})`);
    await capture('05-compact.png');

    // Files deleted in Explorer are noticed when the window is focused again.
    await rm(path.join(first, 'libraries', 'rapidocr', 'models', 'PP-OCRv6_rec_small.onnx'));
    await transcript.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(engine).toHaveAccessibleName('Screen text engine: Files missing');
    await expect(card.getByLabel('Screen text engine files missing')).toContainText(
      'Download it again below.',
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith('#transcript'))
        .setSize(900, 900),
    );
    await capture('06-files-missing.png');
    result.installed = true;
  }
  assert.deepEqual(errors, []);
  result.passed = true;
  await writeFile(path.join(dir, 'report.json'), JSON.stringify(result, null, 2));
  console.log(`Screen text engine card checks passed: ${dir}`);
} catch (error) {
  result.error = String(error?.stack || error);
  await writeFile(path.join(dir, 'report.json'), JSON.stringify(result, null, 2)).catch(() => {});
  throw error;
} finally {
  if (app) await app.close();
}
