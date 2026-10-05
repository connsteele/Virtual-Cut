import { testPath } from './test-paths.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { root, require, electronEnvironment } from './shared.mjs';
const checksRoot = testPath('m1-feedback');
const fixture = JSON.parse(await readFile(path.join(checksRoot, 'latest-native.json'), 'utf8'));
await mkdir(checksRoot, { recursive: true });
const dir = await mkdtemp(path.join(checksRoot, 'ui-'));
const executable = process.env.VIRTUAL_CUT_TEST_EXECUTABLE;
const app = await electron.launch({
  executablePath: executable || require('electron'),
  args: [
    ...(executable ? [] : [root]),
    `--user-data-dir=${path.join(dir, 'profile')}`,
    '--background-test',
  ],
  cwd: root,
  env: electronEnvironment({
    TEMP: process.env.TEMP || 'G:/GPT/Temp',
    TMP: process.env.TEMP || 'G:/GPT/Temp',
  }),
});
const page = await app.firstWindow(),
  errors = [];
page.setDefaultTimeout(20000);
// Hidden Windows test windows can suspend CSS transitions between paint frames.
// Test the actual selected colors with motion disabled, keeping the color assertions.
await page.emulateMedia({ reducedMotion: 'reduce' });
page.on('pageerror', (e) => errors.push(e.message));
async function state() {
  return page.evaluate(() => window.virtualCut.project.current());
}
async function saved() {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('banner').getByRole('status')).toHaveText('Manual save made');
}
async function seek(at) {
  await page.locator('video').evaluate((v, at) => (v.currentTime = at), at);
  await expect.poll(() => page.locator('video').evaluate((v) => v.seeking)).toBe(false);
}
async function unfocus() {
  await expect(page.locator('[data-workflow]')).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(() => document.activeElement?.blur());
}
async function go(name) {
  await page
    .getByRole('navigation', { name: 'Workspace pages' })
    .getByRole('button', { name, exact: true })
    .click();
}
async function capture(name) {
  const data = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    await wc.capturePage(undefined, { stayHidden: true, stayAwake: true });
    await new Promise((r) => setTimeout(r, 150));
    return (await wc.capturePage(undefined, { stayHidden: true, stayAwake: true }))
      .toPNG()
      .toString('base64');
  });
  await writeFile(path.join(dir, name + '.png'), Buffer.from(data, 'base64'));
}
try {
  await app.evaluate(({ dialog, BrowserWindow }, file) => {
    BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, fixture.file);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  let p = await state();
  const rid = p.model.recordings[0].id,
    cid = p.model.clips[0].id;
  async function centered() {
    const offset = await page
      .getByRole('navigation', { name: 'Workspace pages' })
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.x + r.width / 2 - innerWidth / 2;
      });
    assert(Math.abs(offset) < 1, `Page navigation offset from center: ${offset}px`);
  }
  await centered();
  await expect(
    page.locator('[aria-label="Preview audio controls"]').getByRole('status'),
  ).toHaveText('Audio ready');
  await expect(page.getByLabel('Volume', { exact: true })).toHaveValue('1');
  const audioBox = await page
    .getByRole('group', { name: 'Preview audio controls', exact: true })
    .boundingBox();
  const volumeBox = await page.getByLabel('Volume', { exact: true }).boundingBox();
  assert(
    volumeBox.y >= audioBox.y && volumeBox.y + volumeBox.height <= audioBox.y + audioBox.height + 1,
    'Volume is inside the audio group',
  );
  assert.equal(
    await page
      .getByText('Listen', { exact: true })
      .evaluate((el) => getComputedStyle(el).fontWeight),
    '650',
  );
  const toggle = page.locator('[data-play-pause]');
  await unfocus();
  await page.keyboard.press('k');
  await expect(toggle).toHaveAccessibleName('Pause · K / Space');
  await expect
    .poll(() => page.locator('video').evaluate((v) => !v.paused && v.playbackRate === 1))
    .toBe(true);
  await expect(toggle).toHaveCSS('background-color', 'rgb(4, 99, 95)');
  const teal = await toggle.evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.keyboard.press('k');
  await expect(toggle).toHaveAccessibleName('Play · K / Space');
  await expect(toggle).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const faster = page.getByRole('button', { name: 'Forward / faster · L', exact: true });
  await page.keyboard.press('l');
  await expect.poll(() => page.locator('video').evaluate((v) => v.playbackRate)).toBe(1);
  await page.keyboard.press('l');
  await expect.poll(() => page.locator('video').evaluate((v) => v.playbackRate)).toBe(2);
  await expect(faster).toHaveCSS('background-color', teal);
  await page.keyboard.press('l');
  await expect.poll(() => page.locator('video').evaluate((v) => v.playbackRate)).toBe(4);
  await page.keyboard.press('k');
  await seek(2);
  await page.keyboard.press('j');
  await expect(page.getByLabel('Playback status')).toContainText('reverse');
  await expect(page.getByRole('button', { name: 'Reverse · J', exact: true })).toHaveCSS(
    'background-color',
    teal,
  );
  await page.keyboard.press('k');
  await expect(page.getByLabel('Playback status')).toHaveText('Paused');
  // Loop a clip ending beside another one; delayed timeupdate must not select
  // its neighbor or turn the loop into whole-recording playback.
  const followBox = page.getByRole('checkbox', { name: 'Selection follows playhead' });
  await followBox.uncheck();
  await page.locator(`[data-cut-clip="${cid}"]`).click({ position: { x: 20, y: 20 } });
  const loopButton = page.getByRole('button', { name: 'Loop selected clip', exact: true });
  await loopButton.click();
  await followBox.check();
  await seek(2.9);
  await unfocus();
  await page.keyboard.press('l');
  await expect
    .poll(() => page.locator('video').evaluate((v) => v.currentTime), { intervals: [50] })
    .toBeLessThan(2);
  await expect(page.locator(`[data-cut-clip="${cid}"]`)).toHaveAttribute('data-selected', 'true');
  await expect(loopButton).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('k');
  await loopButton.click();
  await page.getByLabel('Waveform display').selectOption('overlay');
  await expect(page.locator('[data-waveform-track]')).toHaveCount(2);
  await expect(page.getByRole('img', { name: 'Mic waveform', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mic', exact: true }).click();
  await expect(page.locator('[data-waveform-track]')).toHaveCount(1);
  await expect(page.getByRole('img', { name: 'Game waveform', exact: true })).toHaveCount(0);
  await page.getByLabel('Waveform display').selectOption('replace');
  await expect(page.locator('[data-waveform-mode=replace]')).toBeVisible();
  await page.getByRole('button', { name: 'Combined', exact: true }).click();
  await page.getByRole('button', { name: 'Keyframe ticks', exact: true }).click();
  await expect(page.getByLabel('Keyframe positions', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Keyframe ticks', exact: true }).click();
  await page.getByLabel('Waveform display').selectOption('off');
  await expect(page.locator('[data-waveform-track]')).toHaveCount(0);
  await page.locator(`[data-cut-clip="${cid}"]`).click({ position: { x: 20, y: 20 } });
  await seek(2);
  await seek(4);
  await expect(page.locator(`[data-cut-clip="${cid}"]`)).toHaveAttribute('data-selected', 'true');
  await unfocus();
  await page.keyboard.press('w');
  await expect.poll(async () => (await state()).model.clips.find((c) => c.id === cid).end).toBe(4);
  await page.evaluate(() => {
    window.feedbackVideo = document.querySelector('video');
    window.feedbackLoads = 0;
    window.feedbackVideo.addEventListener('emptied', () => window.feedbackLoads++);
    window.controlSamples = [];
    window.controlObserver = new MutationObserver(() => {
      window.controlSamples.push(
        [...document.querySelectorAll('header button, [aria-label="Current batch"]')]
          .filter(
            (el) =>
              ['Save', 'Save history', 'Import'].includes(el.textContent.trim()) ||
              el.matches('select'),
          )
          .map((el) => ({ disabled: el.disabled, opacity: getComputedStyle(el).opacity })),
      );
    });
    window.controlObserver.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'class'],
    });
  });
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await state()).model.clips.find((c) => c.id === cid).end).toBe(3);
  assert.equal(
    await page.evaluate(
      () => window.feedbackVideo === document.querySelector('video') && window.feedbackLoads === 0,
    ),
    true,
    'Undo must preserve decoded media and not reload it',
  );
  assert(Math.abs((await page.locator('video').evaluate((v) => v.currentTime)) - 4) < 0.05);
  const samples = await page.evaluate(() => {
    window.controlObserver.disconnect();
    return window.controlSamples;
  });
  assert(
    samples.flat().every((x) => !x.disabled && Number(x.opacity) === 1),
    `Quiet undo must not dim header and batch controls: ${JSON.stringify(samples)}`,
  );
  // Opening a project starts a fresh session history. After undoing its first edit,
  // another Undo is optional, but the undone edit must always remain redoable.
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
  // Unrelated keys after pointer scrubbing must not create a whole-timeline highlight.
  const track = page.getByTestId('scrub-surface');
  // Park the playhead at 2 s, clear of the trim targets below (0.5, 4 and 6 s): trims snap to it
  // within 10 px, and in a narrow window a fixed 30 px click landed within reach of 0.5 s.
  const trackBox = await track.boundingBox();
  await track.click({
    position: { x: (2 / p.model.recordings[0].duration) * trackBox.width, y: 12 },
  });
  await page.keyboard.press('e');
  assert.equal(await track.evaluate((el) => getComputedStyle(el).outlineStyle), 'none');
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await track.evaluate((el) => getComputedStyle(el).outlineStyle),
    'solid',
    'Deliberate keyboard seeking retains a visible focus indicator',
  );
  await unfocus();
  await page.keyboard.press('h');
  await expect(page.getByRole('button', { name: 'H · Manipulate', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const handle = (edge) =>
    page.locator(`[data-clip-container="${cid}"] [data-clip-handle="${edge}"]`);
  async function dragEdge(edge, at, cancel = false) {
    const r = await track.boundingBox(),
      h = await handle(edge).boundingBox();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(r.x + (at / 8) * r.width, h.y + h.height / 2, { steps: 6 });
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
  }
  const clipState = async () => (await state()).model.clips.find((c) => c.id === cid);
  await dragEdge('start', 0.5);
  await expect.poll(async () => (await clipState()).start).toBe(0.5);
  await dragEdge('end', 6);
  await expect.poll(async () => (await clipState()).end).toBe(6);
  await expect(page.locator('[data-clip-lanes]')).toHaveAttribute('data-clip-lanes', '2');
  await expect(page.locator(`[data-cut-clip="${cid}"]`)).toHaveAttribute('data-selected', 'true');
  await unfocus();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await clipState()).end).toBe(3);
  await unfocus();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await clipState()).start).toBe(0);
  await dragEdge('end', 4, true);
  await page.waitForTimeout(350);
  assert.equal((await clipState()).end, 3, 'Escape cancels the entire handle drag');
  await dragEdge('start', 9);
  await expect.poll(async () => (await clipState()).start).toBeGreaterThan(2.9);
  assert((await clipState()).start < 3, 'A handle cannot cross its opposite edge');
  await unfocus();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await clipState()).start).toBe(0);
  await unfocus();
  await handle('end').focus();
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(async () => (await clipState()).end)
    .toBe(
      (
        await page.evaluate(
          ([project, source]) => window.virtualCut.project.frameIndex(project, source),
          [p.project.id, rid],
        )
      ).frameTimes.find((t) => t > 3.000001),
    );
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await clipState()).end).toBe(3);
  await unfocus();
  await page.keyboard.press('h');
  await expect(page.locator('[data-clip-handle]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'H · Manipulate', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await unfocus();
  await page.keyboard.press('r');
  const name = page.locator(`[data-cut-clip="${cid}"] input[aria-label="Clip name"]`);
  assert(
    await name.evaluate((el) => el.selectionStart === 0 && el.selectionEnd === el.value.length),
  );
  await page.keyboard.type('Renamed by keyboard');
  await page.keyboard.press('h');
  await expect(page.getByRole('button', { name: 'H · Manipulate', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  assert.equal(
    await name.evaluate((el) => getComputedStyle(el).outlineColor),
    'rgb(113, 215, 205)',
  );
  await page.keyboard.press('Enter');
  await saved();
  await seek(1);
  await unfocus();
  await page.keyboard.press('m');
  await expect(page.locator('[data-marker-card][data-selected=true]')).toHaveCount(1);
  const markerName = page.getByLabel('Marker name', { exact: true });
  await expect(markerName).toBeFocused();
  await expect(page.getByLabel('Marker color', { exact: true })).toHaveValue('Blue');
  assert(
    await markerName.evaluate(
      (el) => el.selectionStart === 0 && el.selectionEnd === el.value.length,
    ),
  );
  await page.keyboard.type('Keyboard marker');
  await page.keyboard.press('Backspace');
  await expect(page.locator('[data-delete-confirm]')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /Select marker: Keyboard marke/ }).click();
  await expect(page.locator('[data-marker-card][data-selected=true]')).toHaveCount(1);
  await expect(page.locator('[data-cut-clip][data-selected=true]')).toHaveCount(0);
  // Clicking the filmstrip clears marker priority, even at the same playhead.
  const scrubBox = await page.getByTestId('scrub-surface').boundingBox();
  await page
    .getByTestId('scrub-surface')
    .click({ position: { x: scrubBox.width / p.model.recordings[0].duration, y: 12 } });
  await expect(page.locator('[data-marker-card][data-selected=true]')).toHaveCount(0);
  await unfocus();
  await page.keyboard.press('r');
  await expect(page.getByLabel('Clip name', { exact: true }).first()).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /Select marker: Keyboard marke/ }).click();
  await page.getByLabel('Marker color', { exact: true }).selectOption('Fuchsia');
  await saved();
  assert.equal((await state()).model.markers[rid][0].color, 'Fuchsia');
  await unfocus();
  await page.keyboard.press('Backspace');
  await expect(page.locator('[data-delete-confirm]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-marker-card]')).toHaveCount(1);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-marker-card]')).toHaveCount(0);
  await page.locator(`[data-cut-clip="${cid}"]`).click({ position: { x: 20, y: 20 } });
  await unfocus();
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await expect(page.locator(`[data-cut-clip="${cid}"]`)).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.locator(`[data-cut-clip="${cid}"]`)).toHaveCount(1);
  await page.getByLabel('Clip name', { exact: true }).first().fill('Manual save target');
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('banner').getByRole('status')).toHaveText('Manual save made');
  p = await state();
  const manual = p.saves.find((s) => s.kind === 'manual');
  await page.getByLabel('Clip name', { exact: true }).first().fill('Changed after manual save');
  await expect
    .poll(async () => (await state()).model.clips[0].name)
    .toBe('Changed after manual save');
  await page.getByRole('button', { name: 'Save history', exact: true }).click();
  const saveTable = page.getByRole('table', { name: 'Save history', exact: true });
  await expect(saveTable.getByRole('columnheader')).toHaveText(['Type', 'Date', 'Time', 'Actions']);
  await app.evaluate(({ shell }) => {
    shell.showItemInFolder = (file) => {
      globalThis.revealedSave = file;
    };
  });
  await page
    .getByRole('button', { name: /^Open save folder:/ })
    .first()
    .click();
  const revealed = await app.evaluate(() => globalThis.revealedSave);
  assert.equal(path.dirname(revealed), fixture.file + '.saves');
  await capture('save-history');
  await page.getByRole('button', { name: 'Restore…', exact: true }).first().click();
  await page.getByRole('button', { name: 'Restore save', exact: true }).click();
  await expect(page.getByLabel('Clip name', { exact: true }).first()).toHaveValue(
    'Manual save target',
  );
  assert((await state()).saves.some((s) => s.kind === 'manual' && s.id !== manual.id));
  await unfocus();
  await page.keyboard.press('Control+ArrowDown');
  await expect(page.locator('[data-recording]')).toHaveCount(3);
  await expect
    .poll(async () => (await state()).model.selectedRecordingId)
    .toBe(p.model.recordings[1].id);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  assert.equal(
    await page.locator('video').getAttribute('poster'),
    null,
    'Viewer never uses browser thumbnails as posters',
  );
  await expect(page.locator('[data-video-stage] img')).toHaveCount(0);
  assert(
    await page.evaluate(() => window.feedbackVideo === document.querySelector('video')),
    'Source switching preserves the viewer element',
  );
  await page.keyboard.press('Control+ArrowUp');
  await expect.poll(async () => (await state()).model.selectedRecordingId).toBe(rid);
  await page.getByRole('button', { name: 'Import files', exact: true }).click();
  await expect(
    page.getByText('This batch has microphone audio notes', { exact: true }).locator('input'),
  ).toBeChecked();
  await expect(page.getByLabel('Batch microphone notes track')).toHaveValue('2');
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog', exact: true }).click();
  await go('Review');
  await page.getByRole('button', { name: 'Accept', exact: true }).first().click();
  await page.getByRole('button', { name: 'Queue 1', exact: true }).click();
  const accepted = page.getByRole('button', { name: 'Accepted', exact: true });
  await expect(accepted).toHaveAttribute('aria-pressed', 'true');
  const green = await accepted.evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.equal(green, 'rgb(45, 81, 55)');
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await capture('review');
  await go('Media');
  await centered();
  await expect(page.getByRole('button', { name: /^Source folder:/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^Source folder:/ }).first()).toHaveAttribute(
    'title',
    fixture.dir.replaceAll('\\', '/'),
  );
  await page.getByLabel('Waveform display').selectOption('overlay');
  await capture('media-waveforms');
  await go('Cut');
  await capture('cut');
  const beforeBatch = await state();
  await page.getByRole('button', { name: 'New batch', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Batch name').fill('Disposable UI batch');
  await page.getByRole('button', { name: 'Create batch', exact: true }).click();
  await page.getByRole('button', { name: 'Delete batch…', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('A manual save is made first');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await state()).batches.length, 2);
  await page.getByRole('button', { name: 'Delete batch…', exact: true }).click();
  await page.getByRole('button', { name: 'Delete batch', exact: true }).click();
  await expect.poll(async () => (await state()).batches.length).toBe(1);
  assert.deepEqual((await state()).model.clips, beforeBatch.model.clips);
  // Nested intake updates the actual source tree. A child folder excludes its
  // similarly prefixed sibling and Ctrl+Down stays inside the filtered pool.
  await page.getByRole('button', { name: 'New batch', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Batch name').fill('UI cleanup and source folders');
  await page.getByRole('button', { name: 'Create batch', exact: true }).click();
  await app.evaluate(({ dialog }, nested) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [nested] });
  }, fixture.nested);
  await page.getByRole('button', { name: 'Import folder', exact: true }).click();
  await page.getByRole('button', { name: 'Choose folder…', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await state()).jobs.filter((j) => j.state === 'queued' || j.state === 'running').length,
      { timeout: 60000 },
    )
    .toBe(0);
  await go('Media');
  await expect(page.getByRole('button', { name: /^Source folder:/ })).toHaveCount(3);
  const deepPath = fixture.nested.replaceAll('\\', '/') + '/one/two';
  await page.getByRole('button', { name: `Source folder: ${deepPath}`, exact: true }).click();
  await expect(page.locator('[data-recording]')).toHaveCount(1);
  await unfocus();
  await page.keyboard.press('Control+ArrowDown');
  await expect
    .poll(async () => {
      const value = await state();
      return value.model.recordings
        .find((r) => r.id === value.model.selectedRecordingId)
        ?.sourcePath?.endsWith('deep.mkv');
    })
    .toBe(true);
  await page.getByRole('button', { name: 'All recordings', exact: true }).click();
  await expect(page.locator('[data-recording]')).toHaveCount(3);
  await capture('source-folders');
  const removingId = (await state()).model.selectedRecordingId;
  await page
    .locator(`[data-recording="${removingId}"]`)
    .getByRole('button', { name: /^Remove from batch:/ })
    .click();
  const removalDialog = page.getByRole('dialog', { name: 'Remove recording from batch' });
  await expect(removalDialog).toContainText(
    'Original video files and finished exports are never moved or deleted',
  );
  await removalDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('[data-recording]')).toHaveCount(3);
  await page
    .locator(`[data-recording="${removingId}"]`)
    .getByRole('button', { name: /^Remove from batch:/ })
    .click();
  await removalDialog.getByRole('button', { name: 'Remove recording', exact: true }).click();
  await expect(page.locator('[data-recording]')).toHaveCount(2);
  assert(!(await state()).model.recordings.some((r) => r.id === removingId));
  await capture('recording-removed');
  await page.getByRole('button', { name: 'Delete batch…', exact: true }).click();
  await page.getByLabel('Batch removal', { exact: true }).selectOption('remove');
  await expect(page.getByRole('dialog')).toContainText('Original video files are never deleted');
  await page.getByRole('button', { name: 'Delete batch', exact: true }).click();
  await expect
    .poll(async () => (await state()).model.recordings.length)
    .toBe(beforeBatch.model.recordings.length);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 720));
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(1100);
  await centered();
  await capture('compact');
  const dimensions = await page.evaluate(() => ({
    w: innerWidth,
    h: innerHeight,
    sw: document.documentElement.scrollWidth,
    sh: document.documentElement.scrollHeight,
  }));
  assert(
    dimensions.sw <= dimensions.w + 1 && dimensions.sh <= dimensions.h + 1,
    JSON.stringify(dimensions),
  );
  await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Backspace');
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(checksRoot, 'latest-ui.json'),
    JSON.stringify({ passed: true, dir }, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: true,
      dir,
      checks: [
        'listen/waveform modes',
        'keyframe toggle',
        'gap selection',
        'R rename',
        'Backspace/Enter/Escape',
        'text editing guard',
        'marker priority',
        'undo without reload',
        'save restoration',
        'Ctrl batch navigation',
        'no thumbnail poster',
        'green accepted state',
        'compact layout',
        'centered page navigation at wide and compact sizes',
        'unrelated E key focus behavior and keyboard seek accessibility',
        'stable header and batch controls during quiet undo',
        'handle start/end trim, overlap, clamping, cancel, keyboard and single-step undo',
        'high-contrast name focus',
        'K toggle, L acceleration, J reverse and state-aware transport colors',
        'selected-clip loop retains selection at adjacent boundary',
        'right-grouped audio and distinct Listen label',
        'save table and restricted native folder action',
        'nested source-folder navigation and filtered Ctrl+Up/Down',
        'UI batch app-data cleanup',
        'successful audio retry supersedes older failed status while preserving the job log',
      ],
    }),
  );
} catch (e) {
  await capture('failure').catch(() => {});
  console.error({ dir, errors });
  throw e;
} finally {
  await app.close();
}
