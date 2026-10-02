import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, expect } from 'playwright/test';
import { assertBuilt, electronEnvironment, require, root } from './shared.mjs';

const packagedExecutable = process.env.VIRTUAL_CUT_TEST_EXECUTABLE;
const backgroundTest = process.env.VIRTUAL_CUT_TEST_BACKGROUND === '1';
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
  args: [
    ...(packagedExecutable ? [] : [root]),
    `--user-data-dir=${profile}`,
    ...(backgroundTest ? ['--background-test'] : []),
  ],
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
  assert.deepEqual(boundary.apiKeys, [
    'diagnostics',
    'getAppInfo',
    'openVideo',
    'project',
    'selectProjectFolder',
    'toggleFullscreen',
    'transcript',
  ]);
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
    !backgroundTest,
  );
  const header = page.getByRole('banner');
  await page.getByRole('button', { name: 'Preview options', exact: true }).click();
  await page.getByRole('button', { name: 'Open previous foundation layouts', exact: true }).click();
  async function selectLayout(name) {
    await header.getByRole('button', { name: /Layouts/ }).click();
    await page.getByRole('button', { name: `${name} layout`, exact: true }).click();
    await expect(page.locator(`[data-layout="${name.toLowerCase()}"]`)).toBeVisible();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  }
  async function screenshot(name) {
    if (process.env.VIRTUAL_CUT_TEST_OUTPUT) {
      if (backgroundTest) {
        const png = await application.evaluate(async ({ BrowserWindow }) => {
          const contents = BrowserWindow.getAllWindows()[0].webContents;
          // A hidden window may still hold the frame from the previous layout.
          // Warm the capturer before saving the newly painted state.
          await contents.capturePage(undefined, { stayHidden: true, stayAwake: true });
          await new Promise((resolve) => setTimeout(resolve, 120));
          const image = await contents.capturePage(undefined, {
            stayHidden: true,
            stayAwake: true,
          });
          return image.toPNG().toString('base64');
        });
        await writeFile(path.join(testDirectory, `${name}.png`), Buffer.from(png, 'base64'));
      } else {
        await page.screenshot({ path: path.join(testDirectory, `${name}.png`), fullPage: true });
      }
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
    const heading = await header.getByRole('heading', { level: 1 }).boundingBox();
    const project = await header.getByRole('button', { name: /project folder/ }).boundingBox();
    const bar = await header.boundingBox();
    const workspace = await page.locator('[data-layout]').boundingBox();
    assert.ok(heading.x + heading.width <= project.x, 'Page name belongs before the project.');
    assert.ok(heading.y >= bar.y && heading.y + heading.height <= bar.y + bar.height);
    assert.ok(workspace.y - (bar.y + bar.height) <= 1, 'No separate page-heading row.');
  }

  const navigation = page.getByRole('navigation', { name: 'Workspace pages' });
  await navigation.waitFor();
  const scratchpad = page.getByRole('textbox', { name: 'Workspace notes' });
  if (process.env.VIRTUAL_CUT_TEST_PLAYBACK_ONLY !== '1') {
    for (const name of ['Media', 'Cut', 'Review', 'Library', 'Selects', 'Handoff']) {
      const button = navigation.getByRole('button', { name, exact: true });
      await button.click();
      assert.equal(await button.getAttribute('aria-current'), 'page');
      await expect(header.getByRole('heading', { level: 1 })).toHaveText(name);
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
    await expect(
      page.getByText('The folder picker could not open. Please try again.'),
    ).toBeVisible();
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
  }
  if (process.env.VIRTUAL_CUT_TEST_VIDEO) {
    const fixtureVideo = path.resolve(process.env.VIRTUAL_CUT_TEST_VIDEO);
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1600, 1000),
    );
    await selectLayout('Studio');
    await application.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, fixtureVideo);
    await header.getByRole('button', { name: 'Open video', exact: true }).click();
    const player = page.locator('video');
    await expect(page.getByRole('button', { name: 'Play video', exact: true })).toBeEnabled({
      timeout: 20000,
    });
    const metadata = await player.evaluate((video) => ({
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
      paused: video.paused,
      url: video.currentSrc,
    }));
    assert.ok(metadata.duration > 0);
    assert.ok(metadata.width > 0 && metadata.height > 0);
    assert.equal(metadata.paused, true, 'Opening footage must not autoplay.');
    assert.match(metadata.url, /^media:\/\/video\/[a-f0-9-]+$/);
    await page.getByRole('button', { name: 'Mute video', exact: true }).click();
    await page.getByRole('button', { name: 'Play video', exact: true }).click();
    await expect.poll(() => player.evaluate((video) => video.currentTime)).toBeGreaterThan(0.2);
    await page.getByRole('button', { name: 'Pause video', exact: true }).click();
    // A very short fixture can finish while a hidden-window click is queued.
    // K is an idempotent pause, unlike a play/pause toggle after end-of-file.
    await page.getByRole('region', { name: 'Footage viewer', exact: true }).focus();
    await page.keyboard.press('k');
    await expect.poll(() => player.evaluate((video) => video.paused)).toBe(true);
    await expect(page.getByRole('alert')).toHaveCount(0);
    assert.ok(
      await player.evaluate((video) => video.getVideoPlaybackQuality().totalVideoFrames > 0),
    );
    const seekControl = page.getByRole('slider', { name: 'Seek video', exact: true });
    await seekControl.focus();
    await page.keyboard.press('Home');
    for (let step = 0; step < 25; step++) await page.keyboard.press('ArrowRight');
    const position = Number(await seekControl.inputValue());
    assert.ok(position > 0 && position < metadata.duration);
    await expect
      .poll(() =>
        player.evaluate((video, target) => Math.abs(video.currentTime - target), position),
      )
      .toBeLessThan(0.05);
    await page.getByRole('combobox', { name: 'Playback speed' }).selectOption('2');
    await expect.poll(() => player.evaluate((video) => video.playbackRate)).toBe(2);
    assert.equal(await player.evaluate((video) => video.paused), true);
    for (const name of ['Studio', 'Library', 'Focus']) {
      await selectLayout(name);
      await expect
        .poll(() => player.evaluate((video) => video.readyState))
        .toBeGreaterThanOrEqual(2);
      await expect
        .poll(() =>
          player.evaluate((video, target) => Math.abs(video.currentTime - target), position),
        )
        .toBeLessThan(0.05);
      assert.equal(await player.evaluate((video) => video.muted), true);
      assert.equal(await player.evaluate((video) => video.playbackRate), 2);
      await expect(page.getByRole('alert')).toHaveCount(0);
      const size = await player.boundingBox();
      assert.ok(size && size.width > 100 && size.height > 50);
      assert.ok(Math.abs(size.width / size.height - 16 / 9) < 0.02, 'Viewer should be 16:9.');
      await checkViewport();
      await screenshot(`video-${name.toLowerCase()}`);
    }
    await selectLayout('Studio');
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setContentSize(2560, 1375),
    );
    async function checkStudioFit() {
      await expect
        .poll(() =>
          player.evaluate((video) => {
            const frame = video.getBoundingClientRect();
            const stage = video.parentElement.parentElement.getBoundingClientRect();
            return Math.abs(stage.width - frame.width);
          }),
        )
        .toBeLessThan(2);
      const fit = await player.evaluate((video) => {
        const frame = video.getBoundingClientRect();
        const stage = video.parentElement.parentElement.getBoundingClientRect();
        return { width: frame.width, height: frame.height, availableHeight: stage.height };
      });
      assert.ok(Math.abs(fit.height - fit.availableHeight) < 2, 'Keep the full-height preview.');
      assert.ok(Math.abs(fit.width / fit.height - 16 / 9) < 0.02);
      await checkViewport();
    }
    await checkStudioFit();
    await screenshot('video-studio-wide');
    await navigation.getByRole('button', { name: 'Review', exact: true }).click();
    await expect.poll(() => player.evaluate((video) => video.currentTime)).toBeCloseTo(position, 1);
    await header.getByRole('button', { name: 'Notes', exact: true }).click();
    await scratchpad.fill('Space and arrow keys here must only edit the note.');
    await page.keyboard.press('Space');
    assert.equal(await player.evaluate((video) => video.paused), true);
    await checkStudioFit();
    await screenshot('video-studio-wide-notes');
    await page.getByRole('button', { name: 'Close side panel' }).click();
    await page.getByRole('region', { name: 'Footage viewer', exact: true }).focus();
    await expect(page.getByRole('region', { name: 'Footage viewer', exact: true })).toBeFocused();
    await application.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    });
    await header.getByRole('button', { name: 'Open video', exact: true }).click();
    await expect(header.getByRole('button', { name: 'Open video', exact: true })).toBeEnabled();
    assert.equal(await player.evaluate((video) => video.currentSrc), metadata.url);
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1100, 720),
    );
    await checkViewport();
    await screenshot('video-compact');
    const invalid = path.join(testDirectory, 'unplayable.mp4');
    await writeFile(invalid, 'This is deliberately not a video.');
    await application.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, invalid);
    await header.getByRole('button', { name: 'Open video', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('This video could not be played');
    await application.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, fixtureVideo);
    await header.getByRole('button', { name: 'Open video', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Play video', exact: true })).toBeEnabled();
    assert.equal(await player.evaluate((video) => video.paused), true);
    assert.notEqual(await player.evaluate((video) => video.currentSrc), metadata.url);
    console.log(
      `Video preview passed: ${metadata.width}x${metadata.height}, ${metadata.duration.toFixed(3)}s; decoded frames, play/pause, seek, speed, mute, layout continuity, 16:9 viewer, and picker cancellation.`,
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    process.env.VIRTUAL_CUT_TEST_PLAYBACK_ONLY === '1'
      ? 'Focused Electron playback smoke passed.'
      : 'Electron smoke passed: native launch, production assets, bridge isolation, six pages, three layouts, saved notes/preferences, folder IPC handling, and compact window.',
  );
} finally {
  await application.close();
}
