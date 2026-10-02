import { testPath } from './test-paths.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron, expect } from 'playwright/test';
import { root, require, electronEnvironment } from './shared.mjs';
const scratch = testPath('filing'),
  fixture = JSON.parse(await readFile(path.join(scratch, 'latest-native.json'), 'utf8'));
const dir = await mkdtemp(path.join(scratch, 'ui-')),
  executable = process.env.VIRTUAL_CUT_TEST_EXECUTABLE;
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
page.setDefaultTimeout(15000);
page.on('pageerror', (e) => errors.push(e.message));
const nav = page.getByRole('navigation', { name: 'Workspace pages' }),
  dialog = () => page.getByRole('dialog');
const current = () => page.evaluate(() => window.virtualCut.project.current());
async function capture(name) {
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    // Wake the hidden compositor before capturing the current selected clip.
    await contents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    return (
      await contents.capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      })
    )
      .toPNG()
      .toString('base64');
  });
  await writeFile(path.join(dir, name + '.png'), Buffer.from(png, 'base64'));
}
try {
  await app.evaluate(({ BrowserWindow, dialog }, file) => {
    BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true);
    BrowserWindow.getAllWindows()[0].setSize(1600, 1000);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, fixture.file);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await nav.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Preview completed clip: Second', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Search completed clips').fill('café');
  await expect(page.getByRole('button', { name: /Preview completed clip:/ })).toHaveCount(1);
  // Real native verification still runs; delay its response to exercise focus
  // during a larger-file verification instead of hiding the race with tiny fixtures.
  await app.evaluate(({ ipcMain }) => {
    const handler = ipcMain._invokeHandlers.get('workspace:retainedMedia');
    ipcMain.removeHandler('workspace:retainedMedia');
    ipcMain.handle('workspace:retainedMedia', async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 750));
      return handler(...args);
    });
  });
  const secondCard = page.getByRole('button', {
    name: 'Preview completed clip: Second',
    exact: true,
  });
  await secondCard.click();
  const library = page.getByRole('region', { name: 'Completed Library' });
  await expect(library.getByRole('status')).toContainText('Verifying');
  await expect(secondCard).toBeFocused();
  await expect
    .poll(() => library.locator('video').evaluate((v) => v.readyState))
    .toBeGreaterThanOrEqual(2);
  await expect(secondCard).toBeFocused();
  await page.keyboard.press('l');
  await expect(library.getByLabel('Playback status', { exact: true })).toHaveText('1× forward');
  await page.keyboard.press('k');
  await expect(library.getByLabel('Playback status', { exact: true })).toHaveText('Paused');
  await page.getByLabel('Search completed clips').fill('');
  await page.getByLabel('Search completed clips').pressSequentially('jkl');
  await expect(library.getByLabel('Playback status', { exact: true })).toHaveText('Paused');
  await page.getByLabel('Search completed clips').fill('café');
  await expect(library.locator('[data-frame-time]').first()).toBeVisible({ timeout: 30000 });
  await library.getByLabel('Waveform display').selectOption('overlay');
  await expect(library.getByLabel('Game waveform', { exact: true })).toBeVisible();
  await expect(library.getByRole('button', { name: 'Mic', exact: true })).toHaveCount(0);
  assert.equal(await library.locator('video').evaluate((v) => v.muted), false);
  await library.getByRole('button', { name: 'Zoom in timeline', exact: true }).click();
  await expect(library.getByLabel('Timeline zoom level')).toHaveText('2.0×');
  await expect(library.locator('[data-frame-time]').first()).toBeVisible({ timeout: 30000 });
  await library.getByRole('button', { name: 'Fit full recording', exact: true }).click();
  await expect(library.locator('[data-frame-time] img').first()).toBeVisible();
  await expect(library.getByText('Loading filmstrip…', { exact: true })).toHaveCount(0);
  const overviewUrl = await library.locator('[data-frame-time] img').first().getAttribute('src');
  await page.getByLabel('Search completed clips').fill('');
  await page.getByRole('button', { name: 'Preview completed clip: First', exact: true }).click();
  await expect(
    library.getByRole('region', { name: 'Footage viewer' }).locator('strong').first(),
  ).toHaveText('First');
  await expect(library.locator('[data-frame-time] img').first()).toBeVisible({ timeout: 30000 });
  await expect(library.getByText('Loading filmstrip…', { exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    window.__cachedStripFlashes = [];
    window.__stripObserver = new MutationObserver(() => {
      const root = document.querySelector('[aria-label="Completed Library"]');
      if (
        root &&
        [...root.querySelectorAll('[role="status"]')].some(
          (el) =>
            el.textContent?.includes('Loading filmstrip') ||
            el.textContent?.includes('Preparing filmstrip'),
        )
      )
        window.__cachedStripFlashes.push({
          text: [...root.querySelectorAll('[role="status"]')].map((el) => el.textContent),
          tiles: root.querySelectorAll('[data-frame-time]').length,
          requested: [...root.querySelectorAll('[data-tile-time]')].map(
            (el) => el.dataset.tileTime,
          ),
          width: root.querySelector('[data-testid="scrub-surface"]')?.getBoundingClientRect().width,
        });
    });
    window.__stripObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  await secondCard.click();
  await expect(
    library.getByRole('region', { name: 'Footage viewer' }).locator('strong').first(),
  ).toHaveText('Second');
  await expect(library.locator('[data-frame-time] img').first()).toHaveAttribute(
    'src',
    overviewUrl,
    { timeout: 30000 },
  );
  await page.waitForTimeout(200);
  assert.deepEqual(
    await page.evaluate(() => {
      window.__stripObserver.disconnect();
      return window.__cachedStripFlashes;
    }),
    [],
    'Verified cached revisit has no pending filmstrip placeholder',
  );
  await capture('library-viewer-wide');
  const viewerHeight = await library
    .locator('video')
    .evaluate((v) => v.getBoundingClientRect().height);
  const libraryHeight = (await library.boundingBox()).height;
  const playerHeight = (await library.getByRole('region', { name: 'Footage viewer' }).boundingBox())
    .height;
  assert(
    playerHeight > libraryHeight * 0.8,
    `Player should fill the available Library space: ${playerHeight}/${libraryHeight}; video=${viewerHeight}`,
  );
  await library.locator('summary', { hasText: 'Clip details & markers' }).click();
  const libraryVideo = library.locator('video');
  await libraryVideo.evaluate((v) => v.pause());
  const beforeMarkerSelection = await libraryVideo.evaluate((v) => v.currentTime);
  const timelineMarker = library.getByRole('button', {
    name: 'Select marker: Red marker',
    exact: true,
  });
  await timelineMarker.click();
  await expect(timelineMarker).toHaveAttribute('aria-pressed', 'true');
  assert(
    Math.abs((await libraryVideo.evaluate((v) => v.currentTime)) - beforeMarkerSelection) < 0.02,
  );
  const detailMarker = library.getByRole('button', { name: /Red marker/ }).last();
  await detailMarker.click();
  assert(
    Math.abs((await libraryVideo.evaluate((v) => v.currentTime)) - beforeMarkerSelection) < 0.02,
  );
  await detailMarker.dblclick();
  await expect
    .poll(() => library.locator('video').evaluate((v) => v.currentTime))
    .toBeGreaterThan(0.5);
  await expect(library).toContainText('Range note');
  await capture('library-wide');
  // A missing completed pair shows a centered relink action. A failed relink
  // must reveal its specific reason rather than hiding behind the first error.
  const beforeRelink = await current(),
    movedClip = beforeRelink.library.find((c) => c.name === 'Second'),
    otherClip = beforeRelink.library.find((c) => c.name === 'First'),
    relinkFolder = path.join(dir, 'relinked-library'),
    relinkFile = path.join(relinkFolder, path.basename(movedClip.output));
  await mkdir(relinkFolder);
  await rename(movedClip.output, relinkFile);
  await rename(movedClip.output + '.vcut.json', relinkFile + '.vcut.json');
  await page.getByRole('button', { name: 'Preview completed clip: Second', exact: true }).click();
  await expect(library.getByRole('alert')).toContainText('Completed preview unavailable');
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async (_window, options) => {
      globalThis.relinkPickerRoot = options.defaultPath;
      return { canceled: false, filePaths: [file] };
    };
  }, otherClip.output);
  await library.getByRole('button', { name: 'Relink completed video…', exact: true }).click();
  await expect(library.getByRole('alert')).toContainText('does not match');
  assert.equal(
    await app.evaluate(() => globalThis.relinkPickerRoot),
    beforeRelink.project.destination,
  );
  await capture('library-relink-error');
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, relinkFile);
  await library.getByRole('button', { name: 'Relink completed video…', exact: true }).click();
  await expect(library.locator('p', { hasText: 'Finished file' })).toContainText(relinkFile);
  await expect(library.getByRole('alert')).toHaveCount(0);
  await expect(
    library.getByLabel('Library folder').getByRole('option', { name: relinkFolder, exact: true }),
  ).toHaveCount(1);
  await page.getByLabel('Search completed clips').fill('');
  await nav.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: /^Done \d/ }).click();
  const secondId = beforeRelink.exports.find((e) => e.plan.id === movedClip.exportId).plan.clipId;
  const doneCard = page.locator(`[data-card="${secondId}"]`);
  await expect(doneCard).toContainText('Filed · ' + relinkFolder);
  await expect(
    doneCard.getByRole('button', { name: 'Show filed video: Second', exact: true }),
  ).toHaveAttribute('title', relinkFile);
  await doneCard.locator('summary', { hasText: 'Original destination' }).click();
  await expect(doneCard.locator('details').first()).toContainText(
    beforeRelink.model.clips.find((c) => c.id === secondId).folder,
  );
  await page.getByRole('button', { name: 'Tree', exact: true }).click();
  const doneTree = page
    .locator('aside')
    .filter({ has: page.getByRole('button', { name: 'All destinations', exact: true }) });
  await expect(doneTree.getByRole('button', { name: relinkFolder, exact: true })).toHaveCount(1);
  await doneTree.getByRole('button', { name: relinkFolder, exact: true }).click();
  await expect(page.locator('[data-card]')).toHaveCount(1);
  await app.evaluate(({ shell }) => {
    globalThis.revealedFile = '';
    shell.showItemInFolder = (file) => {
      globalThis.revealedFile = file;
    };
  });
  await doneCard.getByRole('button', { name: 'Show filed video: Second', exact: true }).click();
  assert.equal(await app.evaluate(() => globalThis.revealedFile), relinkFile);
  await capture('review-filed-location-wide');
  await doneTree.getByRole('button', { name: 'All destinations', exact: true }).click();
  await page.getByRole('button', { name: /^All \d/ }).click();
  await doneCard.getByRole('button', { name: /^Details/ }).click();
  await expect
    .poll(() => doneCard.locator('video').evaluate((v) => v.readyState))
    .toBeGreaterThanOrEqual(2);
  await doneCard.locator('video').evaluate((v) => {
    v.dataset.reviewIdentity = 'keep-mounted';
  });
  const nameInput = doneCard.getByLabel('Clip name', { exact: true });
  await nameInput.focus();
  await page.keyboard.press('End');
  await nameInput.pressSequentially(' draft', { delay: 50 });
  await expect(nameInput).toHaveValue('Second draft');
  await expect(nameInput).toBeFocused();
  assert.equal(
    await doneCard.locator('video').getAttribute('data-review-identity'),
    'keep-mounted',
    'Regrouping a Done edit preserves the preview element',
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: /^All \d/ }).click();
  await expect(doneCard.getByRole('button', { name: /Show filed video:/ })).toHaveCount(0);
  await expect(doneCard).not.toContainText(relinkFolder);
  assert.equal(
    (await current()).model.clips.find((c) => c.id === secondId).folder,
    beforeRelink.model.clips.find((c) => c.id === secondId).folder,
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(doneCard).toContainText('Filed · ' + relinkFolder);
  await doneCard.getByRole('button', { name: /^Details/ }).click();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, fixture.file);
  await dialog().getByRole('button', { name: 'Open project file…', exact: true }).click();
  await nav.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: /^All \d/ }).click();
  await expect(doneCard).toContainText('Filed · ' + relinkFolder);
  const relinkedRecord = (await current()).exports.find((e) => e.plan.id === movedClip.exportId);
  assert.deepEqual(
    relinkedRecord.input,
    beforeRelink.exports.find((e) => e.plan.id === movedClip.exportId).input,
  );
  await page.getByRole('button', { name: 'Tree', exact: true }).click();
  const card = page.locator('[data-card="collision"]');
  await page.getByRole('button', { name: /^All \d/ }).click();
  await page.getByLabel('Sort review').selectOption('name');
  await expect(page.getByLabel('Sort review')).toHaveValue('name');
  await page.getByLabel('Sort review').selectOption('folder');
  await app.evaluate(({ shell }) => {
    globalThis.revealedDestination = '';
    shell.openPath = async (folder) => {
      globalThis.revealedDestination = folder;
      return '';
    };
  });
  await page
    .locator('[data-review-group="Recovery"]')
    .getByTitle(/^Open destination in Explorer/)
    .click();
  assert.equal(
    await app.evaluate(() => globalThis.revealedDestination),
    path.join((await current()).project.destination, 'Recovery'),
    'The folder header opens its current destination through the native bridge',
  );
  await card.getByRole('button', { name: 'Release hold', exact: true }).click();
  await card.getByRole('button', { name: 'Accept', exact: true }).click();
  await page.getByRole('button', { name: /^File queue ·/ }).click();
  await expect(dialog().getByRole('table', { name: 'Filing plan' })).toContainText('Collision');
  await expect(
    dialog().getByRole('button', { name: 'File 1 accepted clips', exact: true }),
  ).toBeDisabled();
  await dialog().getByRole('checkbox').check();
  await capture('filing-wide');
  await dialog().getByRole('button', { name: 'File 1 accepted clips', exact: true }).click();
  await expect(dialog().getByRole('table', { name: 'Filing progress' })).toContainText('Done', {
    timeout: 30000,
  });
  await dialog().getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: /^File queue ·/ }).click();
  await dialog()
    .getByRole('button', { name: /^Progress ·/ })
    .click();
  await expect(dialog().getByRole('table', { name: 'Filing progress' })).toContainText('Done');
  await dialog().getByRole('button', { name: 'Open Library', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Preview completed clip: Collision', exact: true }),
  ).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1040, 720));
  await page
    .getByRole('button', { name: 'Preview completed clip: Collision', exact: true })
    .click();
  await expect(
    library.getByRole('region', { name: 'Footage viewer' }).getByText('Collision', { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => library.locator('video').evaluate((v) => v.readyState))
    .toBeGreaterThanOrEqual(2);
  await expect(library.locator('p', { hasText: 'Finished file' })).toContainText('Collision.mkv');
  // Collapse metadata to devote the compact window to playback.
  if (await library.locator('details[open] > summary').count())
    await library.locator('details[open] > summary').click();
  await expect(library.locator('[data-frame-time]').first()).toBeVisible({ timeout: 30000 });
  await capture('library-compact');
  const compactLayout = await library.evaluate((root) => {
    const video = root.querySelector('video').getBoundingClientRect();
    const player = root.querySelector('[aria-label="Footage viewer"]').getBoundingClientRect();
    const facts = root.querySelector('details').getBoundingClientRect();
    return {
      videoHeight: video.height,
      playerBottom: player.bottom,
      factsBottom: facts.bottom,
      bottom: root.getBoundingClientRect().bottom,
    };
  });
  assert(compactLayout.videoHeight >= 120, JSON.stringify(compactLayout));
  assert(
    compactLayout.playerBottom <= compactLayout.bottom + 1 &&
      compactLayout.factsBottom <= compactLayout.bottom + 1,
    'Video, timeline, transport and details fit the compact Library without page scrolling',
  );
  await page.getByLabel('Search completed clips').focus();
  await expect(page.getByLabel('Search completed clips')).toBeFocused();
  assert.ok(await page.locator('body').evaluate((e) => e.scrollWidth <= e.clientWidth + 1));
  // Review's source link retains the preview position rather than resetting it.
  await nav.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: /^All \d/ }).click();
  await card.getByRole('button', { name: /^Details/ }).click();
  await expect
    .poll(() => card.locator('video').evaluate((v) => v.readyState))
    .toBeGreaterThanOrEqual(2);
  await card.locator('video').evaluate((v) => (v.currentTime = 2.5));
  await expect.poll(() => card.locator('video').evaluate((v) => v.currentTime)).toBeCloseTo(2.5);
  await card
    .getByTitle(/^Open source in Cut:/)
    .first()
    .click();
  await expect.poll(async () => (await current()).model.recordings[0].position).toBeCloseTo(2.5, 1);
  await capture('source-seek-compact');
  // Exercise the real installer with an isolated app-data destination, including
  // loading the helper from the packaged resource directory when applicable.
  const appData = path.join(dir, 'helper-appdata');
  await mkdir(appData);
  await app.evaluate(({ app }, directory) => app.setPath('appData', directory), appData);
  await page.getByRole('button', { name: 'Exports', exact: true }).click();
  await dialog().getByRole('button', { name: 'Handoff to Resolve…', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Handoff to Resolve', exact: true })
      .getByRole('status')
      .first(),
  ).toHaveText('Not installed');
  await page
    .getByRole('region', { name: 'Handoff to Resolve', exact: true })
    .getByRole('button', { name: 'Install Resolve metadata helper…', exact: true })
    .click();
  await expect(
    page
      .getByRole('region', { name: 'Handoff to Resolve', exact: true })
      .getByRole('status')
      .first(),
  ).toContainText('Installed · current version');
  const helper = path.join(
    appData,
    'Blackmagic Design/DaVinci Resolve/Support/Fusion/Scripts/Utility/Virtual Cut metadata.py',
  );
  assert.equal(
    await readFile(helper, 'utf8'),
    await readFile(path.join(root, 'integrations/resolve/Virtual Cut metadata.py'), 'utf8'),
  );
  await app.evaluate(({ shell }) => {
    globalThis.helperRevealed = '';
    shell.showItemInFolder = (file) => {
      globalThis.helperRevealed = file;
    };
  });
  await page
    .getByRole('region', { name: 'Handoff to Resolve', exact: true })
    .getByRole('button', { name: 'Open helper location', exact: true })
    .click();
  assert.equal(await app.evaluate(() => globalThis.helperRevealed), helper);
  await expect(
    page
      .getByRole('region', { name: 'Handoff to Resolve', exact: true })
      .getByRole('button', { name: 'Open helper location', exact: true }),
  ).toBeEnabled();
  await capture('handoff-compact');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000));
  await capture('handoff-wide');
  const helperContent = await readFile(helper, 'utf8');
  await writeFile(
    path.join(path.dirname(helper), 'Personal script.py'),
    '# preserved personal script',
  );
  await writeFile(helper + '.previous-review', '# retained backup');
  await page
    .getByRole('region', { name: 'Handoff to Resolve', exact: true })
    .getByRole('button', { name: 'Remove helper…', exact: true })
    .click();
  await page
    .getByRole('region', { name: 'Handoff to Resolve', exact: true })
    .getByRole('button', { name: 'Keep helper', exact: true })
    .click();
  assert.equal(await readFile(helper, 'utf8'), helperContent);
  await page
    .getByRole('region', { name: 'Handoff to Resolve', exact: true })
    .getByRole('button', { name: 'Remove helper…', exact: true })
    .click();
  await writeFile(helper, '# customized after status check');
  await page
    .getByRole('region', { name: 'Handoff to Resolve', exact: true })
    .getByRole('button', { name: 'Remove installed helper', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'Handoff to Resolve', exact: true }).getByRole('alert'),
  ).toContainText('preserved');
  await expect(
    page
      .getByRole('region', { name: 'Handoff to Resolve', exact: true })
      .getByRole('status')
      .first(),
  ).toContainText('Customized');
  assert.equal(await readFile(helper, 'utf8'), '# customized after status check');
  await writeFile(helper, helperContent);
  await page
    .getByRole('region', { name: 'Handoff to Resolve', exact: true })
    .getByRole('button', { name: 'Refresh status', exact: true })
    .click();
  await expect(
    page
      .getByRole('region', { name: 'Handoff to Resolve', exact: true })
      .getByRole('status')
      .first(),
  ).toContainText('Installed');
  await page
    .getByRole('region', { name: 'Handoff to Resolve', exact: true })
    .getByRole('button', { name: 'Remove installed helper', exact: true })
    .click();
  await expect(
    page
      .getByRole('region', { name: 'Handoff to Resolve', exact: true })
      .getByRole('status')
      .first(),
  ).toHaveText('Not installed');
  assert.equal(
    await readFile(path.join(path.dirname(helper), 'Personal script.py'), 'utf8'),
    '# preserved personal script',
  );
  assert.equal(await readFile(helper + '.previous-review', 'utf8'), '# retained backup');
  await page
    .getByRole('region', { name: 'Handoff to Resolve', exact: true })
    .getByRole('button', { name: 'Install Resolve metadata helper…', exact: true })
    .click();
  await expect(
    page
      .getByRole('region', { name: 'Handoff to Resolve', exact: true })
      .getByRole('status')
      .first(),
  ).toContainText('Installed');
  await nav.getByRole('button', { name: 'Library', exact: true }).click();
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(dir, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        errors,
        compact: true,
        keyboard: true,
        queue: true,
        library: true,
        sourceSeek: true,
      },
      null,
      2,
    ),
  );
  console.log('Filing and completed Library UI passed:', dir);
} finally {
  await app.close();
}
