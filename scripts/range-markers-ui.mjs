import { testPath } from './test-paths.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron, expect } from 'playwright/test';
import { root, require, electronEnvironment } from './shared.mjs';
const checksRoot = testPath('range-markers');
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
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1600, 1000);
    w.webContents.setAudioMuted(true);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, fixture.file);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await go('Cut');
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  const card = (id) => page.locator(`[data-marker-card="${id}"]`);
  const range = (id) => page.locator(`[data-marker-range="${id}"]`);
  await expect(range('cross-start')).toBeVisible();
  await card('inside').getByLabel('Marker end', { exact: true }).fill('5.5');
  await card('inside').getByLabel('Marker end', { exact: true }).press('Enter');
  await saved();
  let model = (await state()).model;
  assert.equal(model.markers[fixture.rid].find((m) => m.id === 'inside').end, 5.5);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(card('inside').getByLabel('Marker end', { exact: true })).toHaveValue('4.2');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(card('inside').getByLabel('Marker end', { exact: true })).toHaveValue('5.5');
  await unfocus();
  await page.keyboard.press('h');
  await expect(range('inside')).toHaveAttribute('data-manipulate', 'true');
  const surface = await page.getByTestId('scrub-surface').boundingBox();
  const edge = await range('inside')
    .getByLabel('Marker end: Inside', { exact: true })
    .boundingBox();
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width / 2 + surface.width / 8, edge.y + edge.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await saved();
  model = (await state()).model;
  assert(Math.abs(model.markers[fixture.rid].find((m) => m.id === 'inside').end - 6.5) < 0.1);
  // Dragging a body retains duration; Escape commits nothing.
  const body = await range('inside')
    .getByRole('button', { name: 'Select marker: Inside', exact: true })
    .boundingBox();
  const before = model.markers[fixture.rid].find((m) => m.id === 'inside');
  await page.mouse.move(body.x + body.width / 2, body.y + body.height / 2);
  await page.mouse.down();
  await page.mouse.move(body.x + body.width / 2 + 50, body.y + body.height / 2, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await saved();
  assert.deepEqual(
    (await state()).model.markers[fixture.rid].find((m) => m.id === 'inside'),
    before,
  );
  await card('point').getByRole('button', { name: 'Make range', exact: true }).click();
  await expect(range('point')).toBeVisible();
  await card('point').getByRole('button', { name: 'Remove range end', exact: true }).click();
  await expect(range('point')).toHaveCount(0);
  const point = await page.locator('[data-marker="point"]').boundingBox();
  await page.keyboard.down('Alt');
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
  await page.mouse.down();
  await page.mouse.move(point.x + point.width / 2 + surface.width / 8, point.y + point.height / 2, {
    steps: 8,
  });
  const splitShape = async (id) =>
    range(id)
      .locator('[data-marker-edge="start"] span')
      .evaluate((el) => ({
        clip: getComputedStyle(el).clipPath,
        radius: getComputedStyle(el).borderTopLeftRadius,
      }));
  assert.deepEqual(
    await splitShape('point'),
    { clip: 'none', radius: '8px' },
    'Alt conversion keeps split circles while dragging',
  );
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect(range('point')).toBeVisible();
  assert.deepEqual(await splitShape('point'), { clip: 'none', radius: '8px' });
  // Manual inspector scrolling stays where the user put it through position updates.
  await range('cross-start')
    .getByRole('button', { name: 'Select marker: Cross start', exact: true })
    .click();
  const aside = card('cross-start').locator('xpath=ancestor::aside');
  const scrolled = await aside.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    return el.scrollTop;
  });
  assert(scrolled > 100);
  await seek(2);
  await page.waitForTimeout(1200);
  assert(
    Math.abs((await aside.evaluate((el) => el.scrollTop)) - scrolled) < 2,
    'Manual scrolling wins over position snapshots',
  );
  await capture('ranges-wide');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 720));
  await page.waitForTimeout(300);
  await capture('ranges-compact');
  assert(
    await aside.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    'Marker timing inputs fit the compact inspector without horizontal scrolling',
  );
  const layout = await page.getByTestId('scrub-surface').evaluate((el) => {
    const video = document.querySelector('video').getBoundingClientRect(),
      timeline = el.getBoundingClientRect();
    return { video: video.height, bottom: timeline.bottom, height: innerHeight };
  });
  assert(
    layout.video > 30 && layout.bottom < layout.height,
    'Viewer shrinks and timeline stays visible',
  );
  await unfocus();
  await seek(6);
  await page.keyboard.press('Shift+m');
  await expect(
    page
      .locator('[data-marker-card][data-selected=true]')
      .getByLabel('Marker name', { exact: true }),
  ).toBeFocused();
  await page.keyboard.type('New range keyboard');
  await page.keyboard.press('Enter');
  await saved();
  const created = (await state()).model.markers[fixture.rid].find(
    (m) => m.name === 'New range keyboard',
  );
  assert(created && created.end > created.time);
  // Editing leaves the playhead fixed before, during and after every gesture.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000));
  await page.waitForTimeout(200);
  const snap = page.getByRole('button', { name: 'Snapping', exact: true });
  await expect(snap).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Selection follows playhead').uncheck();
  async function dragTo(
    locator,
    target,
    origin,
    check = true,
    extent = [0, 8],
    cancel = false,
    playhead = target,
  ) {
    await seek(playhead);
    const track = await page.getByTestId('scrub-surface').boundingBox();
    const box = await locator.boundingBox();
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    const delta = ((target - origin) * track.width) / (extent[1] - extent[0]) + (check ? 2 : 8);
    await page.mouse.move(x, y);
    await page.mouse.down();
    assert(
      Math.abs((await page.locator('video').evaluate((v) => v.currentTime)) - playhead) < 0.02,
      'Pointer-down must not seek',
    );
    const destination =
      (await locator.getAttribute('data-clip-handle')) != null
        ? track.x + ((target - extent[0]) * track.width) / (extent[1] - extent[0]) + (check ? 2 : 8)
        : x + delta;
    await page.mouse.move(destination, y, { steps: 10 });
    assert(
      Math.abs((await page.locator('video').evaluate((v) => v.currentTime)) - playhead) < 0.02,
      'Dragging must not seek',
    );
    if (check)
      await expect(page.locator('[data-snap-guide]')).toHaveAttribute(
        'data-snap-guide',
        String(target),
      );
    else await expect(page.locator('[data-snap-guide]')).toHaveCount(0);
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(page.locator('[data-snap-guide]')).toHaveCount(0);
    await saved();
    assert(
      Math.abs((await page.locator('video').evaluate((v) => v.currentTime)) - playhead) < 0.02,
      'Release and save must not seek',
    );
  }
  let currentModel = (await state()).model;
  const clip = currentModel.clips[0];
  await dragTo(page.getByLabel(`Trim start of ${clip.name}`, { exact: true }), 3, clip.start);
  assert.equal((await state()).model.clips[0].start, 3);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved();
  await dragTo(page.getByLabel(`Trim end of ${clip.name}`, { exact: true }), 5, clip.end);
  assert.equal((await state()).model.clips[0].end, 5);
  await dragTo(range('inside').getByLabel('Marker start: Inside', { exact: true }), 3.5, 3.2);
  assert.equal((await state()).model.markers[fixture.rid].find((m) => m.id === 'inside').time, 3.5);
  await dragTo(range('inside').getByLabel('Marker end: Inside', { exact: true }), 5.5, 6.5);
  assert.equal((await state()).model.markers[fixture.rid].find((m) => m.id === 'inside').end, 5.5);
  // Escape cancels a snapped gesture; an invalid target cannot cross the other edge.
  await dragTo(
    range('inside').getByLabel('Marker start: Inside', { exact: true }),
    4,
    3.5,
    true,
    [0, 8],
    true,
  );
  assert.equal((await state()).model.markers[fixture.rid].find((m) => m.id === 'inside').time, 3.5);
  await dragTo(range('inside').getByLabel('Marker start: Inside', { exact: true }), 6, 3.5, false);
  const constrained = (await state()).model.markers[fixture.rid].find((m) => m.id === 'inside');
  assert(constrained.time < constrained.end && constrained.end === 5.5);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved();
  // Body movement aligns the nearest endpoint and retains duration.
  await dragTo(
    range('cross-start').getByRole('button', { name: 'Select marker: Cross start', exact: true }),
    4,
    3,
  );
  const moved = (await state()).model.markers[fixture.rid].find((m) => m.id === 'cross-start');
  assert.equal(moved.time, 2);
  assert.equal(moved.end, 4);
  await seek(6);
  await unfocus();
  await page.keyboard.press('m');
  await page.keyboard.type('Snap point');
  await page.keyboard.press('Enter');
  await saved();
  const pointId = (await state()).model.markers[fixture.rid].find(
    (m) => m.name === 'Snap point',
  ).id;
  await dragTo(page.locator(`[data-marker="${pointId}"]`), 7, 6);
  assert.equal((await state()).model.markers[fixture.rid].find((m) => m.id === pointId).time, 7);
  const peerState = (await state()).model;
  const peerRange = peerState.markers[fixture.rid].find((m) => m.id === 'inside');
  const peerClip = peerState.clips[0];
  const undo = async () => {
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await saved();
  };
  for (const target of [peerRange.time, peerRange.end, peerClip.start, peerClip.end]) {
    await dragTo(page.locator(`[data-marker="${pointId}"]`), target, 7, true, [0, 8], false, 0.5);
    assert.equal(
      (await state()).model.markers[fixture.rid].find((m) => m.id === pointId).time,
      target,
    );
    await undo();
  }
  await dragTo(
    page.getByLabel(`Trim end of ${clip.name}`, { exact: true }),
    7,
    peerClip.end,
    true,
    [0, 8],
    false,
    0.5,
  );
  assert.equal((await state()).model.clips[0].end, 7);
  await undo();
  await dragTo(
    range('inside').getByLabel('Marker end: Inside', { exact: true }),
    7,
    peerRange.end,
    true,
    [0, 8],
    false,
    0.5,
  );
  assert.equal((await state()).model.markers[fixture.rid].find((m) => m.id === 'inside').end, 7);
  await undo();
  await dragTo(
    range('cross-start').getByRole('button', { name: 'Select marker: Cross start', exact: true }),
    peerClip.end,
    moved.end,
    true,
    [0, 8],
    false,
    0.5,
  );
  const peerMoved = (await state()).model.markers[fixture.rid].find((m) => m.id === 'cross-start');
  assert.equal(peerMoved.end, peerClip.end);
  assert.equal(peerMoved.end - peerMoved.time, moved.end - moved.time);
  await undo();
  await snap.click();
  await dragTo(page.locator(`[data-marker="${pointId}"]`), 6, 7, false);
  assert((await state()).model.markers[fixture.rid].find((m) => m.id === pointId).time > 6.03);
  assert.equal(
    await page.evaluate(() => localStorage.getItem('virtual-cut.snap-playhead')),
    'false',
  );
  await snap.click();
  await seek(6);
  await page.getByRole('button', { name: 'Zoom in timeline', exact: true }).click();
  currentModel = (await state()).model;
  const beforeZoom = currentModel.markers[fixture.rid].find((m) => m.id === pointId).time;
  await dragTo(page.locator(`[data-marker="${pointId}"]`), 6.5, beforeZoom, true, [4, 8]);
  assert.equal((await state()).model.markers[fixture.rid].find((m) => m.id === pointId).time, 6.5);
  await page.getByRole('button', { name: 'Fit full recording', exact: true }).click();
  // Alt-drag converts to a range even without Manipulate; a left drag preserves the old point as End.
  await page.getByRole('button', { name: 'H · Manipulate', exact: true }).click();
  const pointBox = await page.locator(`[data-marker="${pointId}"]`).boundingBox();
  const fullTrack = await page.getByTestId('scrub-surface').boundingBox();
  await page.keyboard.down('Alt');
  await page.mouse.move(pointBox.x + pointBox.width / 2, pointBox.y + pointBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    pointBox.x + pointBox.width / 2 - fullTrack.width / 8,
    pointBox.y + pointBox.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await saved();
  const extended = (await state()).model.markers[fixture.rid].find((m) => m.id === pointId);
  assert(Math.abs(extended.time - 5.5) < 0.04);
  assert.equal(extended.end, 6.5);
  const finalBody = range(pointId).locator('[data-marker]');
  assert.equal(await finalBody.textContent(), '');
  assert.equal(await finalBody.evaluate((el) => getComputedStyle(el, '::before').height), '6px');
  assert.notEqual((await splitShape(pointId)).clip, 'none', 'H off restores pointed ends');
  // Select, deselect and seek are separate mouse actions, even with Follow enabled.
  await page.getByLabel('Selection follows playhead').check();
  await seek(1.5);
  const at = () => page.locator('video').evaluate((v) => v.currentTime);
  const clipButton = page.locator(`[data-clip="${clip.id}"]`);
  await clipButton.click();
  assert(Math.abs((await at()) - 1.5) < 0.02);
  await finalBody.click();
  assert(Math.abs((await at()) - 1.5) < 0.02);
  await expect(finalBody).toHaveAttribute('aria-pressed', 'true');
  const lane = page.getByLabel('Timeline markers', { exact: true });
  await lane.click({ position: { x: 10, y: 10 } });
  await expect(finalBody).toHaveAttribute('aria-pressed', 'false');
  assert(Math.abs((await at()) - 1.5) < 0.02);
  await finalBody.dblclick();
  await expect.poll(at).toBeCloseTo(extended.time, 1);
  await clipButton.dblclick();
  await expect.poll(at).toBeCloseTo(clip.start, 1);
  await page.getByRole('button', { name: 'H · Manipulate', exact: true }).click();
  await seek(1.5);
  await finalBody.dblclick();
  await expect.poll(at).toBeCloseTo(extended.time, 1);
  await seek(1.5);
  await finalBody.focus();
  await finalBody.press('ArrowRight');
  assert(Math.abs((await at()) - 1.5) < 0.02, 'Keyboard retiming does not seek');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const ruler = page.getByLabel('Time ruler', { exact: true });
  const rb = await ruler.boundingBox();
  await ruler.click({ position: { x: rb.width / 4, y: 12 } });
  await expect.poll(at).toBeCloseTo(2, 1);
  const film = page.locator('[data-seek-surface="filmstrip"]');
  const fb = await film.boundingBox();
  await page.mouse.move(fb.x + fb.width / 4, fb.y + 20);
  await page.mouse.down();
  await page.mouse.move(fb.x + fb.width / 2, fb.y + 20, { steps: 5 });
  await page.mouse.up();
  await expect.poll(at).toBeCloseTo(4, 1);
  const position = page.getByRole('textbox', { name: 'Timeline position', exact: true });
  await position.fill('00:00:02.500');
  await position.press('Enter');
  await expect.poll(at).toBeCloseTo(2.5, 2);
  await position.fill('00:70:00');
  await position.press('Enter');
  await expect(position).toHaveAttribute('aria-invalid', 'true');
  assert(Math.abs((await at()) - 2.5) < 0.02);
  await position.fill('99');
  await position.press('Enter');
  await expect(position).toHaveAttribute('aria-invalid', 'true');
  await position.press('Escape');
  await expect(position).toHaveValue('00:00:02.500');
  await position.focus();
  assert.equal(await position.evaluate((el) => getComputedStyle(el).outlineStyle), 'solid');
  await position.press('Escape');
  const labels = await ruler.locator('b').allTextContents();
  assert(labels.length >= 3 && new Set(labels).size === labels.length);
  // Readout mode is keyboard accessible, accepts indexed frames, and never seeks on toggle.
  const framesMode = page.getByRole('button', { name: 'Show position as frames', exact: true });
  await framesMode.focus();
  await page.keyboard.press('Enter');
  await expect(framesMode).toHaveAttribute('aria-pressed', 'true');
  await expect(position).toHaveValue('75');
  assert(Math.abs((await at()) - 2.5) < 0.02);
  await position.fill('90');
  await position.press('Enter');
  await expect.poll(at).toBeCloseTo(3, 2);
  await position.fill('1.5');
  await position.press('Enter');
  await expect(position).toHaveAttribute('aria-invalid', 'true');
  await position.press('Escape');
  await page.getByRole('button', { name: 'Show position as time', exact: true }).click();
  await expect(position).toHaveValue('00:00:03.000');
  const pb = await position.boundingBox();
  assert((await ruler.boundingBox()).y - (pb.y + pb.height) >= 8, 'Position has space above ruler');
  const beforeScrub = (await state()).model;
  const targets = [
    ...beforeScrub.markers[fixture.rid].flatMap((m) =>
      m.end == null ? [m.time] : [m.time, m.end],
    ),
    ...beforeScrub.clips.filter((c) => c.rid === fixture.rid).flatMap((c) => [c.start, c.end]),
  ];
  async function scrubNear(target, surface, enabled, extent = [0, 8]) {
    const box = await surface.boundingBox();
    const x = box.x + ((target - extent[0]) / (extent[1] - extent[0])) * box.width;
    await page.mouse.move(x - 24, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(x + 5, box.y + 12, { steps: 3 });
    if (enabled)
      await expect(page.locator('[data-snap-guide]')).toHaveAttribute(
        'data-snap-guide',
        String(target),
      );
    else await expect(page.locator('[data-snap-guide]')).toHaveCount(0);
    await page.mouse.up();
    await expect(page.locator('[data-snap-guide]')).toHaveCount(0);
    const expected = enabled ? target : target + (5 / box.width) * (extent[1] - extent[0]);
    await expect.poll(at).toBeCloseTo(expected, 2);
  }
  for (const manipulate of [true, false]) {
    const button = page.getByRole('button', { name: 'H · Manipulate', exact: true });
    if ((await button.getAttribute('aria-pressed')) !== String(manipulate)) await button.click();
    for (const target of [...new Set(targets)].filter((t) => t > 0.3 && t < 7.7))
      await scrubNear(target, manipulate ? ruler : film, true);
  }
  await snap.click();
  await scrubNear(extended.time, ruler, false);
  await snap.click();
  const zoomTarget = targets.find((t) => t > 3 && t < 5);
  assert(zoomTarget != null);
  await seek(zoomTarget);
  await page.getByRole('button', { name: 'Zoom in timeline', exact: true }).click();
  const zoomExtent = await page
    .getByTestId('scrub-surface')
    .evaluate((el) => [Number(el.dataset.viewStart), Number(el.dataset.viewEnd)]);
  await scrubNear(zoomTarget, ruler, true, zoomExtent);
  await page.getByRole('button', { name: 'Fit full recording', exact: true }).click();
  assert.deepEqual(
    (await state()).model.markers,
    beforeScrub.markers,
    'Scrubbing does not edit markers',
  );
  assert.deepEqual((await state()).model.clips, beforeScrub.clips, 'Scrubbing does not edit clips');
  await capture('snap-ranges-wide');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 720));
  await capture('snap-ranges-compact');
  await expect(snap).toBeInViewport();
  await go('Review');
  await saved();
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(
    'Range marker UI, numeric editing, edge manipulation, conversion, scroll and compact layout passed:',
    dir,
  );
} finally {
  await app.close();
}
