import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect } from 'playwright/test';
import { assertBuilt, electronEnvironment, require, root } from './shared.mjs';

const packagedExecutable = process.env.VIRTUAL_CUT_TEST_EXECUTABLE;
if (!packagedExecutable) assertBuilt();
const env = electronEnvironment();
delete env.VIRTUAL_CUT_DEV_URL;
const testDirectory = path.resolve(
  process.env.VIRTUAL_CUT_TEST_OUTPUT || path.join(tmpdir(), 'virtual-cut-smoke'),
);
await mkdir(testDirectory, { recursive: true });
const profile = process.env.VIRTUAL_CUT_TEST_PROFILE
  ? path.resolve(process.env.VIRTUAL_CUT_TEST_PROFILE)
  : await mkdtemp(path.join(testDirectory, 'profile-'));
const errors = [];
const application = await electron.launch({
  executablePath: packagedExecutable ? path.resolve(packagedExecutable) : require('electron'),
  args: [...(packagedExecutable ? [] : [root]), `--user-data-dir=${profile}`],
  cwd: root,
  env,
});

try {
  const actualProfile = await application.evaluate(({ app }) => ({
    userData: app.getPath('userData'),
    sessionData: app.getPath('sessionData'),
  }));
  assert.equal(path.resolve(actualProfile.userData), profile);
  assert.equal(path.resolve(actualProfile.sessionData), profile);
  const page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForLoadState('domcontentloaded');
  await page.locator('#root').waitFor({ state: 'visible' });
  assert.match(await page.title(), /Virtual Cut/);

  const boundary = await page.evaluate(async () => ({
    requireType: typeof window.require,
    processType: typeof window.process,
    apiKeys: Object.keys(window.virtualCut).sort(),
    info: await window.virtualCut.getAppInfo(),
  }));
  assert.equal(boundary.requireType, 'undefined');
  assert.equal(boundary.processType, 'undefined');
  assert.deepEqual(boundary.apiKeys, ['getAppInfo', 'selectProjectFolder']);
  assert.equal(boundary.info.name, 'Virtual Cut');
  assert.equal(boundary.info.platform, process.platform);

  const security = await application.evaluate(({ BrowserWindow }) => {
    const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {
      contextIsolation: preferences.contextIsolation,
      sandbox: preferences.sandbox,
      nodeIntegration: preferences.nodeIntegration,
    };
  });
  assert.deepEqual(security, { contextIsolation: true, sandbox: true, nodeIntegration: false });

  assert.equal(
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
    true,
  );
  const header = page.getByRole('banner');
  async function selectLayout(name) {
    await header.getByRole('button', { name: /Layouts/ }).click();
    await page.getByRole('button', { name: `${name} layout`, exact: true }).click();
    await expect(page.locator(`[data-layout="${name.toLowerCase()}"]`)).toBeVisible();
  }
  async function screenshot(name) {
    if (process.env.VIRTUAL_CUT_TEST_OUTPUT) {
      await page.screenshot({ path: path.join(testDirectory, `${name}.png`), fullPage: true });
    }
  }
  async function checkViewport() {
    const dimensions = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      navigationBottom: document.querySelector('footer').getBoundingClientRect().bottom,
    }));
    assert.ok(dimensions.scrollWidth <= dimensions.width, 'Workspace should fit horizontally.');
    assert.ok(dimensions.scrollHeight <= dimensions.height, 'Workspace should fit vertically.');
    assert.ok(
      dimensions.navigationBottom <= dimensions.height + 1,
      `Bottom navigation must stay visible: ${JSON.stringify(dimensions)}`,
    );
  }

  const navigation = page.getByRole('navigation', { name: 'Workspace pages' });
  await navigation.waitFor();
  for (const name of ['Media', 'Cut', 'Review', 'Library', 'Selects']) {
    const button = navigation.getByRole('button', { name, exact: true });
    await button.click();
    assert.equal(await button.getAttribute('aria-current'), 'page');
  }
  await navigation.getByRole('button', { name: 'Cut', exact: true }).click();
  for (const name of ['Studio', 'Library', 'Focus']) {
    await selectLayout(name);
    await checkViewport();
    await screenshot(`layout-${name.toLowerCase()}`);
  }
  await header.getByRole('button', { name: /Layouts/ }).click();
  await screenshot('layout-choices');
  await page.keyboard.press('Escape');
  await expect(header.getByRole('button', { name: /Layouts/ })).toBeFocused();

  await header.getByRole('button', { name: 'Notes', exact: true }).click();
  const scratchpad = page.getByRole('textbox', { name: 'Workspace notes' });
  const note = 'Foundation check: keep the capture intent beside the footage.';
  await scratchpad.fill(note);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('virtual-cut.scratchpad.v1')))
    .toBe(note);
  await selectLayout('Studio');
  await navigation.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(scratchpad).toHaveValue(note);
  await page.reload();
  await expect(navigation.getByRole('button', { name: 'Review', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.locator('[data-layout="studio"]')).toBeVisible();
  await header.getByRole('button', { name: 'Notes', exact: true }).click();
  await expect(scratchpad).toHaveValue(note);
  await screenshot('notes-panel');
  await scratchpad.focus();
  await page.keyboard.press('Escape');
  await expect(header.getByRole('button', { name: 'Notes', exact: true })).toBeFocused();

  await header.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A second set of eyes.' })).toBeVisible();
  await page.getByRole('button', { name: 'Agent mode', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A hand with the whole batch.' })).toBeVisible();
  await screenshot('agent-panel');
  await page.getByRole('button', { name: 'Close side panel' }).click();

  // Exercise the actual IPC round trip with deterministic native dialog results.
  // The picker UI itself is Windows-owned and isn't driven by this smoke test.
  await application.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  await header.getByRole('button', { name: 'Select project folder', exact: true }).click();
  await expect(
    header.getByRole('button', { name: 'Select project folder', exact: true }),
  ).toBeEnabled();
  const fixture = path.join(testDirectory, 'Example video project');
  await mkdir(fixture, { recursive: true });
  await application.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, fixture);
  await header.getByRole('button', { name: 'Select project folder', exact: true }).click();
  await expect(
    header.getByRole('button', {
      name: 'Change project folder: Example video project',
      exact: true,
    }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Dismiss message' }).click();
  await application.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => {
      throw new Error('Simulated picker failure');
    };
  });
  await header
    .getByRole('button', { name: 'Change project folder: Example video project', exact: true })
    .click();
  await expect(page.getByText('The folder picker could not open. Please try again.')).toBeVisible();
  await expect(
    header.getByRole('button', {
      name: 'Change project folder: Example video project',
      exact: true,
    }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Dismiss message' }).click();

  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1100, 720),
  );
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(1100);
  await navigation.getByRole('button', { name: 'Cut', exact: true }).click();
  for (const name of ['Studio', 'Library', 'Focus']) {
    await selectLayout(name);
    await checkViewport();
    await screenshot(`compact-${name.toLowerCase()}`);
    await header.getByRole('button', { name: 'Notes', exact: true }).click();
    await expect(scratchpad).toBeVisible();
    await checkViewport();
    await screenshot(`compact-${name.toLowerCase()}-notes`);
    await page.getByRole('button', { name: 'Close side panel' }).click();
  }
  assert.deepEqual(errors, []);
  console.log(
    'Electron smoke passed: native launch, production assets, bridge isolation, five pages, three layouts, saved notes/preferences, folder IPC handling, and compact window.',
  );
} finally {
  await application.close();
}
