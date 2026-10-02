import { testPath } from './test-paths.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { _electron as electron, expect } from 'playwright/test';
import { root, require, electronEnvironment } from './shared.mjs';
const checks = testPath('standalone-tools');
const fixture = JSON.parse(await readFile(path.join(checks, 'latest-native.json'), 'utf8'));
await mkdir(checks, { recursive: true });
const dir = await mkdtemp(path.join(checks, 'ui-')),
  executable = process.env.VIRTUAL_CUT_TEST_EXECUTABLE;
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
page.on('pageerror', (e) => errors.push(e.message));
const state = () => page.evaluate(() => window.virtualCut.project.current());
const go = (name) =>
  page
    .getByRole('navigation', { name: 'Workspace pages' })
    .getByRole('button', { name, exact: true })
    .click();
const track = page.getByTestId('scrub-surface');
async function view() {
  return track.evaluate((el) => ({
    start: Number(el.dataset.viewStart),
    end: Number(el.dataset.viewEnd),
  }));
}
async function capture(name) {
  const b64 = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    await wc.capturePage(undefined, { stayHidden: true, stayAwake: true });
    await new Promise((r) => setTimeout(r, 150));
    return (await wc.capturePage(undefined, { stayHidden: true, stayAwake: true }))
      .toPNG()
      .toString('base64');
  });
  await writeFile(path.join(dir, name + '.png'), Buffer.from(b64, 'base64'));
}
async function drop(files, hover = false) {
  // Real native-backed File objects enter through Chromium's file-input mechanism,
  // then exercise the same DataTransfer/preload/main path as an Explorer drop.
  await page.evaluate(() => {
    document.getElementById('test-native-files')?.remove();
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.id = 'test-native-files';
    input.hidden = true;
    document.body.append(input);
  });
  await page.locator('#test-native-files').setInputFiles(files);
  await page.evaluate((hover) => {
    const input = document.getElementById('test-native-files'),
      dt = new DataTransfer();
    for (const file of input.files) dt.items.add(file);
    const el = document.querySelector('#workspace');
    el.dispatchEvent(
      new DragEvent(hover ? 'dragover' : 'drop', {
        dataTransfer: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, hover);
}
async function wheel(fraction, delta, options = {}) {
  return track.evaluate(
    (el, args) => {
      const rect = el.getBoundingClientRect(),
        e = new WheelEvent('wheel', {
          clientX: rect.x + rect.width * args.fraction,
          deltaY: args.delta,
          altKey: args.alt !== false,
          shiftKey: args.shift || false,
          bubbles: true,
          cancelable: true,
        });
      el.dispatchEvent(e);
      return e.defaultPrevented;
    },
    { fraction, delta, ...options },
  );
}
try {
  await app.evaluate(({ dialog, BrowserWindow }, file) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.setAudioMuted(true);
    win.setSize(1600, 1000);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, fixture.file);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await go('Media');
  const originalCount = (await state()).model.recordings.length;
  const url = page.url();
  await drop([fixture.invalid]);
  const audioSetup = page.getByRole('dialog', { name: 'Batch audio setup', exact: true });
  await expect(
    audioSetup.getByRole('button', { name: 'Import 0 videos', exact: true }),
  ).toBeDisabled();
  await expect(audioSetup.getByLabel('Dropped files summary')).toContainText('1 skipped');
  await page.keyboard.press('Escape');
  assert.equal((await state()).model.recordings.length, originalCount);
  await drop([fixture.first, fixture.second, fixture.invalid], true);
  await expect(page.getByText(/Drop videos into/)).toBeVisible();
  await capture('drop-target-wide');
  await drop([fixture.first, fixture.second, fixture.invalid]);
  await expect(audioSetup.getByLabel('Dropped files summary')).toContainText('2 video files ready');
  await expect(audioSetup.getByLabel('Batch microphone notes track')).toHaveValue('2');
  await capture('drop-summary-wide');
  await page.keyboard.press('Escape');
  assert.equal((await state()).model.recordings.length, originalCount);
  await page.getByRole('button', { name: 'Hide both panels', exact: true }).click();
  await drop([fixture.first, fixture.second, fixture.invalid]);
  await audioSetup.getByRole('button', { name: 'Import 2 videos', exact: true }).click();
  await expect(audioSetup).not.toBeVisible();
  await expect.poll(async () => (await state()).model.recordings.length).toBe(2);
  await expect
    .poll(async () => (await state()).jobs.some((j) => ['running', 'queued'].includes(j.state)))
    .toBe(false);
  let p = await state();
  assert(
    p.model.recordings.every(
      (r) => r.availability === 'ready' && r.micTrack === 2 && r.gameTrack === 1,
    ),
  );
  assert.equal(page.url(), url);
  assert.equal(
    createHash('sha256')
      .update(await readFile(fixture.first))
      .digest('hex'),
    fixture.hash,
  );
  assert.equal(
    createHash('sha256')
      .update(await readFile(fixture.second))
      .digest('hex'),
    fixture.hash,
  );
  await page.getByRole('button', { name: 'Show both panels', exact: true }).click();
  // No renderer-supplied path on a generated File can become a file grant.
  const denied = await page.evaluate(async (p) => {
    const file = new File(['fake'], 'fake.mkv');
    Object.defineProperty(file, 'path', { value: p.model.recordings[0].sourcePath });
    return window.virtualCut.project.stageDrop(p.project.id, p.activeBatchId, [file]);
  }, p);
  assert.equal(denied.count, 0);
  assert.equal(denied.token, '');
  await go('Cut');
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await page.getByRole('checkbox', { name: 'Selection follows playhead' }).uncheck();
  await page.locator('[data-cut-clip="zoom-a"]').click({ position: { x: 18, y: 18 } });
  const timings = (await state()).model.clips.map((c) => [c.id, c.start, c.end]);
  const full = await view(),
    timeBefore = await page.locator('video').evaluate((v) => v.currentTime);
  assert.equal(await wheel(0.6, -120), true);
  await expect
    .poll(async () => (await view()).end - (await view()).start)
    .toBeLessThan(full.end - full.start);
  const zoomed = await view();
  assert(Math.abs(zoomed.end - zoomed.start - (full.end - full.start) / 1.25) < 1e-5);
  assert(
    Math.abs(
      (full.start + (full.end - full.start) * 0.6 - zoomed.start) / (zoomed.end - zoomed.start) -
        0.6,
    ) < 0.002,
  );
  assert.equal(await page.locator('video').evaluate((v) => v.currentTime), timeBefore);
  assert.equal(await wheel(0.5, 120, { alt: false }), false);
  await page.getByRole('button', { name: 'Zoom in timeline', exact: true }).click();
  await page.getByLabel('Waveform display').selectOption('overlay');
  await page.getByRole('button', { name: 'Combined', exact: true }).click();
  await expect(page.locator('[data-waveform-track]')).toHaveCount(2);
  // Pan to the overlap; marker, clip bounds, waveform points and seek all use this viewport.
  // Keyboard pan is a full alternative to pointer/Alt+Shift-wheel controls.
  await page.getByLabel('Visible timeline start').focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Home');
  await page.getByRole('button', { name: 'Pan timeline right', exact: true }).click();
  const at = await view();
  assert.equal(await page.locator('[data-clip-lanes]').getAttribute('data-clip-lanes'), '2');
  const markerFraction = await page
    .locator('[data-marker="zoom-marker"]')
    .evaluate((el) => parseFloat(el.style.left) / 100);
  assert(Math.abs(markerFraction - (4.5 - at.start) / (at.end - at.start)) < 1e-5);
  const gameShape = await page
    .getByRole('img', { name: 'Game waveform', exact: true })
    .locator('polygon')
    .getAttribute('points');
  const micShape = await page
    .getByRole('img', { name: 'Mic waveform', exact: true })
    .locator('polygon')
    .getAttribute('points');
  assert(
    Number(gameShape.split(' ')[0].split(',')[1]) < 5 &&
      Number(gameShape.split(' ')[511].split(',')[1]) > 24,
    'Game signal ends at the visible four-second transition',
  );
  assert(
    Number(micShape.split(' ')[0].split(',')[1]) > 24 &&
      Number(micShape.split(' ')[511].split(',')[1]) < 5,
    'Mic signal begins at the same transition',
  );
  await track.click({ position: { x: (await track.boundingBox()).width * 0.5, y: 12 } });
  await expect
    .poll(() => page.locator('video').evaluate((v) => v.currentTime))
    .toBeCloseTo((at.start + at.end) / 2, 1);
  await page.getByRole('button', { name: 'Show playhead in timeline', exact: true }).click();
  await capture('timeline-zoom-wide');
  await expect(page.locator('[data-cut-clip="zoom-a"]')).toBeVisible();
  await expect
    .poll(async () => (await state()).model.clips.map((c) => [c.id, c.start, c.end]))
    .toEqual(timings);
  await page.getByRole('button', { name: 'Fit full recording', exact: true }).click();
  assert.deepEqual(await view(), full);
  // Zoom around a visible marker, then click it; click elsewhere clears the marker.
  await wheel(4.5 / 8, -120);
  await page.getByRole('button', { name: 'Select marker: Zoom marker', exact: true }).click();
  await expect(page.locator('[data-marker-card="zoom-marker"]')).toHaveAttribute(
    'data-selected',
    'true',
  );
  await track.click({ position: { x: 30, y: 12 } });
  await expect(page.locator('[data-marker="zoom-marker"]')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  // Clipped viewport boundaries must never become false trim handles.
  await page.getByRole('button', { name: 'H · Manipulate', exact: true }).click();
  await page.locator('video').evaluate((v) => {
    v.currentTime = 4.5;
  });
  await expect.poll(() => page.locator('video').evaluate((v) => v.seeking)).toBe(false);
  await page.getByRole('button', { name: 'Zoom in timeline', exact: true }).click();
  await expect(page.locator('[data-clipped-start="true"]')).not.toHaveCount(0);
  await expect(page.locator('[data-clipped-end="true"]')).not.toHaveCount(0);
  for (const el of await page.locator('[data-clipped-start="true"]').all())
    await expect(el.locator('[data-clip-handle="start"]')).toHaveCount(0);
  for (const el of await page.locator('[data-clipped-end="true"]').all())
    await expect(el.locator('[data-clip-handle="end"]')).toHaveCount(0);
  const endHandle = page.getByRole('button', { name: 'Trim end of Zoom first', exact: true });
  await endHandle.focus();
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(async () => (await state()).model.clips.find((c) => c.id === 'zoom-a').end)
    .toBeGreaterThan(5);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect
    .poll(async () => (await state()).model.clips.find((c) => c.id === 'zoom-a').end)
    .toBe(5);
  // A handle crossing the viewport retains pointer capture and commits once.
  await expect(page.locator('[data-workflow]')).toHaveAttribute('aria-busy', 'false');
  await expect(endHandle).toHaveAttribute('aria-disabled', 'false');
  await endHandle.scrollIntoViewIfNeeded();
  const handleBox = await endHandle.boundingBox(),
    trackBox = await track.boundingBox();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(trackBox.x + trackBox.width + 10, handleBox.y + handleBox.height / 2);
  await page.mouse.up();
  await expect
    .poll(async () => (await state()).model.clips.find((c) => c.id === 'zoom-a').end)
    .toBeGreaterThan((await view()).end);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect
    .poll(async () => (await state()).model.clips.find((c) => c.id === 'zoom-a').end)
    .toBe(5);
  await expect(page.locator('[data-workflow]')).toHaveAttribute('aria-busy', 'false');
  await expect(endHandle).toHaveAttribute('aria-disabled', 'false');
  const cancelBox = await endHandle.boundingBox();
  await page.mouse.move(cancelBox.x + cancelBox.width / 2, cancelBox.y + cancelBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(cancelBox.x - 20, cancelBox.y + cancelBox.height / 2);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect
    .poll(async () => (await state()).model.clips.find((c) => c.id === 'zoom-a').end)
    .toBe(5);
  // Looping continues to use the actual clip range, independent of the view.
  await page.locator('[data-cut-clip="zoom-a"]').click({ position: { x: 18, y: 18 } });
  await page.getByRole('checkbox', { name: 'Selection follows playhead' }).check();
  await page.getByRole('button', { name: 'Loop selected clip', exact: true }).click();
  await page.locator('video').evaluate((v) => {
    v.currentTime = 4.95;
  });
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('l');
  await expect.poll(() => page.locator('video').evaluate((v) => v.currentTime)).toBeLessThan(2);
  await expect(page.locator('[data-cut-clip="zoom-a"]')).toHaveAttribute('data-selected', 'true');
  await page.keyboard.press('k');
  await page.getByRole('button', { name: 'Loop selected clip', exact: true }).click();
  await page.getByRole('button', { name: 'Fit full recording', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in timeline', exact: true }).click();
  const other = p.model.recordings.find((r) => r.id !== fixture.rid);
  await page.locator(`[data-recording="${other.id}"]`).click();
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await expect(page.getByLabel('Timeline zoom level')).toHaveText('1.0×');
  await page.locator(`[data-recording="${fixture.rid}"]`).click();
  await expect(page.getByLabel('Timeline zoom level')).toHaveText('1.0×');
  await go('Review');
  await page
    .locator('[data-card="zoom-a"]')
    .getByRole('button', { name: 'Details', exact: true })
    .click();
  await page.getByRole('button', { name: 'Zoom in timeline', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Fit full clip', exact: true })).toBeEnabled();
  const bounded = await view();
  assert(bounded.start >= 1 && bounded.end <= 5);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 760));
  await capture('review-zoom-compact');
  await go('Media');
  await page.getByRole('button', { name: 'Zoom in timeline', exact: true }).click();
  await capture('media-zoom-compact');
  const separation = await page.locator('video').evaluate((v) => {
    const player = v.closest('section'),
      audio = player.querySelector('[aria-label="Preview audio controls"]'),
      setup = player.nextElementSibling;
    return {
      audioBottom: audio.getBoundingClientRect().bottom,
      playerBottom: player.getBoundingClientRect().bottom,
      setupTop: setup.getBoundingClientRect().top,
    };
  });
  assert(
    separation.audioBottom <= separation.playerBottom + 1 &&
      separation.audioBottom < separation.setupTop,
    'Wrapped audio controls do not overlap source setup',
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  // The empty Media page also accepts a single file and reuses a shared source.
  await page.getByRole('button', { name: 'New batch', exact: true }).click();
  const batchDialog = page.getByRole('dialog', { name: 'New batch', exact: true });
  await batchDialog.getByRole('textbox').fill('Drop into empty batch');
  await batchDialog.getByRole('button', { name: 'Create batch', exact: true }).click();
  await expect(page.getByText('Bring recordings into this batch', { exact: true })).toBeVisible();
  await expect(page.locator('[data-workflow]')).toHaveAttribute('aria-busy', 'false');
  await drop([fixture.first]);
  await audioSetup.getByRole('button', { name: 'Import 1 video', exact: true }).click();
  await expect
    .poll(async () => {
      const p = await state();
      return p.model.recordings.filter((r) => r.batchIds.includes(p.activeBatchId)).length;
    })
    .toBe(1);
  assert.equal((await state()).model.recordings.length, 2);
  await page.getByLabel('Current batch').selectOption(fixture.batch);
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(dir, 'result.json'),
    JSON.stringify({ passed: true, nativeFileDrops: true, wideCompact: true, errors }, null, 2),
  );
  console.log(`Drop intake and timeline zoom UI checks passed: ${dir}`);
} finally {
  await app.close();
}
