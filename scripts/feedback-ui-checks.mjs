import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron, expect } from 'playwright/test';
import { root, require, electronEnvironment } from './shared.mjs';
const checksRoot = 'G:/GPT/Work/virtual-cut/m1-feedback';
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
  env: electronEnvironment({ TEMP: 'G:/GPT/Temp', TMP: 'G:/GPT/Temp' }),
});
const page = await app.firstWindow(),
  errors = [];
page.setDefaultTimeout(20000);
page.on('pageerror', (e) => errors.push(e.message));
async function state() {
  return page.evaluate(() => window.virtualCut.project.current());
}
async function saved() {
  await expect(page.getByRole('banner').getByRole('status')).toHaveText('Saved');
}
async function seek(at) {
  await page.locator('video').evaluate((v, at) => (v.currentTime = at), at);
  await expect.poll(() => page.locator('video').evaluate((v) => v.seeking)).toBe(false);
}
async function unfocus() {
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
  await expect(page.getByLabel('Volume', { exact: true })).toHaveValue('1');
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
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await unfocus();
  await page.keyboard.press('r');
  const name = page.locator(`[data-cut-clip="${cid}"] input[aria-label="Clip name"]`);
  assert(
    await name.evaluate((el) => el.selectionStart === 0 && el.selectionEnd === el.value.length),
  );
  await page.keyboard.type('Renamed by keyboard');
  await page.keyboard.press('Enter');
  await saved();
  await seek(1);
  await unfocus();
  await page.keyboard.press('m');
  await expect(page.locator('[data-marker-card][data-selected=true]')).toHaveCount(1);
  await page.keyboard.press('r');
  const markerName = page.getByLabel('Marker name', { exact: true });
  assert(
    await markerName.evaluate(
      (el) => el.selectionStart === 0 && el.selectionEnd === el.value.length,
    ),
  );
  await page.keyboard.type('Keyboard marker');
  await page.keyboard.press('Backspace');
  await expect(page.locator('[data-delete-confirm]')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /Seek to marker: Keyboard marke/ }).click();
  await expect(page.locator('[data-marker-card][data-selected=true]')).toHaveCount(1);
  await expect(page.locator('[data-cut-clip][data-selected=true]')).toHaveCount(0);
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
  await saved();
  await page.getByRole('button', { name: 'Save history', exact: true }).click();
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
  await page.getByLabel('Waveform display').selectOption('overlay');
  await capture('media-waveforms');
  await go('Cut');
  await capture('cut');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 720));
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(1100);
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
