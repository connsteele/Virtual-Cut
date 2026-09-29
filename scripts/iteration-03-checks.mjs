import assert from 'node:assert/strict';
import { expect } from 'playwright/test';

export async function verifyIteration03({ page, app, capture, go, videoReady, stateKey }) {
  const saved = await page.evaluate((key) => localStorage.getItem(key), stateKey);
  const model = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).data, stateKey);
  const selected = () =>
    page.locator('[data-cut-clip][data-selected="true"]').getAttribute('data-cut-clip');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1800, 1100));
  await go('Cut');
  await page.locator('[data-recording="r1"]').click();
  await videoReady();
  const surface = page.getByTestId('scrub-surface');
  async function scrub(from, to = from) {
    const b = await surface.boundingBox();
    await page.mouse.move(b.x + from * b.width, b.y + 55);
    await page.mouse.down();
    await page.mouse.move(b.x + to * b.width, b.y + 55, { steps: 7 });
    await page.mouse.up();
    await expect
      .poll(() => page.locator('video').evaluate((v) => v.currentTime))
      .toBeCloseTo(to * 166.5, 0);
  }
  await scrub(0.7, 0.35);
  await page.keyboard.press('s');
  await expect(page.locator('[data-cut-clip]')).toHaveCount(2);
  let data = await model();
  const right = data.clips.find((c) => c.rid === 'r1' && c.id !== 'c1');
  assert(Math.abs(right.start - 166.5 * 0.35) < 0.1);
  assert.equal(await selected(), right.id);
  assert.equal(await page.locator('input[aria-label="Seek video"]').count(), 0);
  await scrub(0.15);
  assert.equal(await selected(), 'c1');
  await page.keyboard.press('q');
  assert(Math.abs((await model()).clips.find((c) => c.id === 'c1').start - 166.5 * 0.15) < 0.1);
  await scrub(0.25);
  await page.keyboard.press('w');
  assert(Math.abs((await model()).clips.find((c) => c.id === 'c1').end - 166.5 * 0.25) < 0.1);
  await page.getByRole('checkbox', { name: 'Selection follows playhead' }).uncheck();
  await page.locator('[data-cut-clip="c1"]').click({ position: { x: 15, y: 15 } });
  await scrub(0.8);
  assert.equal(await selected(), 'c1');
  await page.keyboard.press('s');
  await expect(page.locator('[data-cut-clip]')).toHaveCount(2);
  await expect(page.getByRole('status')).toContainText('selected clip');
  // Boundary actions use actual clip edges, and all transport controls have hover titles.
  await page.getByRole('button', { name: 'Previous clip boundary', exact: true }).click();
  await expect
    .poll(() => page.locator('video').evaluate((v) => v.currentTime))
    .toBeCloseTo(right.start, 1);
  await page.getByRole('button', { name: 'Previous clip boundary', exact: true }).click();
  await expect
    .poll(() => page.locator('video').evaluate((v) => v.currentTime))
    .toBeCloseTo(166.5 * 0.25, 1);
  for (const name of [
    'Previous clip boundary',
    'Previous keyframe',
    'Previous frame',
    'Next frame',
    'Next keyframe',
    'Next clip boundary',
  ]) {
    assert(await page.getByRole('button', { name, exact: true }).getAttribute('title'));
  }
  await page
    .locator('[data-cut-clip="c1"]')
    .getByRole('textbox', { name: 'Clip name' })
    .fill('Selected clip test');
  await surface.focus();
  await page.keyboard.press('Control+ArrowDown');
  await expect(page.locator('[data-recording="r2"]')).toHaveClass(/selected/);
  await videoReady();
  await page.keyboard.press('l');
  await expect.poll(() => page.locator('video').evaluate((v) => v.paused)).toBe(false);
  await page.keyboard.press('k');
  await page.keyboard.press('Control+ArrowUp');
  await videoReady();
  const deleteButton = page
    .locator(`[data-cut-clip="${right.id}"]`)
    .getByRole('button', { name: /^Delete clip:/ });
  await deleteButton.click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(deleteButton).toBeVisible();
  await deleteButton.click();
  await page.getByRole('button', { name: 'Delete clip', exact: true }).click();
  await expect(page.locator('[data-cut-clip]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Export 1 clips', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Marker', exact: true }).click();
  await page.getByRole('textbox', { name: 'Marker name' }).fill('Needs review');
  const markerCount = (await model()).markers.r1.length;
  await page.getByRole('button', { name: 'Hide color key', exact: true }).click();
  await expect(page.getByLabel('Marker color key')).toHaveCount(0);
  await page.getByRole('button', { name: 'Color key', exact: true }).click();
  const images = await surface.locator('img').evaluateAll((images) =>
    images.map((i) => ({
      draggable: i.draggable,
      fit: getComputedStyle(i).objectFit,
      ratio: i.clientWidth / i.clientHeight,
    })),
  );
  assert(
    images.every((i) => !i.draggable && i.fit === 'contain' && Math.abs(i.ratio - 16 / 9) < 0.05),
  );
  const flag = page.getByRole('button', { name: 'Seek to marker: Needs review' });
  const markerBox = await flag.boundingBox();
  const frameBox = await surface.locator('img').first().boundingBox();
  assert(markerBox.y + markerBox.height <= frameBox.y + 1);
  await capture('iteration-cut');

  await go('Review');
  const first = page.locator('[data-card="c1"]');
  await expect(first.getByRole('button', { name: 'Name', exact: true })).toBeVisible();
  await first.getByRole('button', { name: 'Hold', exact: true }).click();
  await expect(first).toBeVisible(); // Held remains in Remaining.
  await first.getByRole('combobox', { name: 'Hold reason' }).selectOption('Check name');
  assert.equal((await model()).clips.find((c) => c.id === 'c1').holdReason, 'Check name');
  await first.getByRole('button', { name: 'Name', exact: true }).click();
  await videoReady();
  await expect(first.getByRole('textbox', { name: 'Clip name' })).toBeFocused();
  assert.equal(await first.getByLabel('Clip selection').count(), 0);
  await page.waitForTimeout(300);
  const reviewFit = await first.getByRole('region', { name: 'Footage viewer' }).evaluate((el) => {
    const viewer = el.getBoundingClientRect(),
      container = el.closest('[data-scroll]').getBoundingClientRect();
    return { top: viewer.top, bottom: viewer.bottom, min: container.top, max: container.bottom };
  });
  assert(
    reviewFit.top >= reviewFit.min - 1 && reviewFit.bottom <= reviewFit.max + 1,
    `Review transport must remain visible: ${JSON.stringify(reviewFit)}`,
  );
  await capture('iteration-review-held');
  await first.getByRole('button', { name: 'Supports', exact: true }).click();
  assert.equal(
    await page.getByRole('dialog').getByRole('button', { name: 'List', exact: true }).count(),
    0,
  );
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  assert.equal((await model()).markers.r1.length, markerCount);

  await go('Library');
  await page.getByRole('button', { name: 'Cai', exact: true }).click();
  const group = page.locator('[data-concept-folder="Characters"]');
  await expect(group.locator('[data-graph-node]')).toHaveCount(4);
  await expect(page.locator('[data-concept-folder="Mechanics/Combat"]')).toBeVisible();
  await expect(page.locator('[data-concept-folder="Mechanics/Unique"]')).toBeVisible();
  await capture('iteration-graph-cai');
  await group.getByRole('button', { name: 'Show all 5', exact: true }).click();
  await expect(group.locator('[data-graph-node]')).toHaveCount(5);
  await page.getByRole('combobox', { name: 'Sort graph connections' }).selectOption('Name');
  await group.locator('[data-graph-node="Bertrand"]').click();
  await expect(page.getByRole('combobox', { name: 'Connection focus' })).toHaveValue('Bertrand');
  await page.getByRole('button', { name: 'Back through connections', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Connection focus' })).toHaveValue('Cai');
  await page.getByRole('button', { name: 'Blaze Arts', exact: true }).click();
  await expect(page.locator('[data-graph-node="Cai"]')).toBeVisible();
  await expect(page.locator('[data-graph-node="Leda"]')).toBeVisible();
  console.log(
    'Iteration 03: drag scrubbing, selected Q/W/S, boundary navigation, deletion, held review and grouped graph passed.',
  );

  // Exercise migration of an existing user draft, including old opt-out flags.
  await page.evaluate(
    ({ saved, key }) => {
      const data = JSON.parse(saved);
      delete data.data.uiRevision;
      delete data.data.markerBaseline;
      data.data.terms = data.data.terms.filter((t) => t.id !== 'Centurio');
      data.data.clips[0].name = 'Preserved existing draft';
      data.data.clips[0].include = false;
      localStorage.setItem(key, JSON.stringify(data));
    },
    { saved, key: stateKey },
  );
  await page.reload();
  await page.locator('[data-workflow]').waitFor();
  data = await model();
  assert.equal(data.clips[0].name, 'Preserved existing draft');
  assert(data.clips[0].include);
  assert(data.terms.some((t) => t.id === 'Centurio'));
  await page.evaluate(
    ({ saved, key }) => {
      localStorage.setItem(key, saved);
      localStorage.setItem('virtual-cut.selection-follows', 'true');
    },
    { saved, key: stateKey },
  );
  await page.reload();
  await page.locator('[data-workflow]').waitFor();
}
