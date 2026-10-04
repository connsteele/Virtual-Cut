import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { assertBuilt, electronEnvironment, require, root } from './shared.mjs';

assertBuilt();
const directory = process.env.VIRTUAL_CUT_TEST_OUTPUT || 'G:/GPT/Work/virtual-cut/overlaps/qa';
await mkdir(directory, { recursive: true });
const profile = await mkdtemp(path.join(directory, 'profile-'));
const packaged = process.env.VIRTUAL_CUT_TEST_EXECUTABLE;
const app = await electron.launch({
  executablePath: packaged || require('electron'),
  args: [...(packaged ? [] : [root]), `--user-data-dir=${profile}`, '--background-test'],
  cwd: root,
  env: electronEnvironment({
    VIRTUAL_CUT_TEST_BACKGROUND: '1',
    TEMP: 'G:/GPT/Temp',
    TMP: 'G:/GPT/Temp',
  }),
});
const stateKey = 'virtual-cut.workflow-preview.full-resolution.v1';
let page;
const errors = [];
async function capture(name) {
  const data = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    await wc.capturePage(undefined, { stayHidden: true, stayAwake: true });
    return (await wc.capturePage(undefined, { stayHidden: true, stayAwake: true }))
      .toPNG()
      .toString('base64');
  });
  await writeFile(path.join(directory, `${name}.png`), Buffer.from(data, 'base64'));
}
async function seed(ranges) {
  await page.evaluate(
    ({ stateKey, ranges }) => {
      const saved = JSON.parse(localStorage.getItem(stateKey));
      const base = saved.data.clips.find((c) => c.rid === 'r1');
      saved.data.clips = [
        ...ranges.map(([start, end], index) => ({
          ...base,
          id: `overlap-${index}`,
          name: ['Opening', 'Conversation', 'Reaction', 'Alternate take'][index],
          start,
          end,
        })),
        ...saved.data.clips.filter((c) => c.rid !== 'r1'),
      ];
      saved.data.recordings.find((r) => r.id === 'r1').position = 118;
      localStorage.setItem(stateKey, JSON.stringify(saved));
      localStorage.setItem('virtual-cut.selection-follows', 'false');
    },
    { stateKey, ranges },
  );
  await page.reload();
  await page.locator('[data-workflow]').waitFor();
  await page
    .getByRole('navigation', { name: 'Workspace pages' })
    .getByRole('button', { name: 'Cut', exact: true })
    .click();
  await page.locator('[data-recording="r1"]').click();
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await expect(page.locator('[data-clip]')).toHaveCount(ranges.length);
}
async function geometry(ranges) {
  const boxes = await page.locator('[data-clip]').evaluateAll((nodes) =>
    nodes.map((n) => {
      const b = n.getBoundingClientRect(),
        parent = n.closest('[data-clip-lanes]').getBoundingClientRect();
      const style = getComputedStyle(n.closest('[data-clip-container]'));
      const hit = (x) =>
        document.elementFromPoint(x, b.y + b.height / 2)?.closest('[data-clip]')?.dataset.clip;
      return {
        id: n.dataset.clip,
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        parentX: parent.x,
        parentWidth: parent.width,
        color: style.getPropertyValue('--clip-color'),
        z: Number(style.zIndex),
        leftHit: hit(b.x + 2),
        rightHit: hit(b.right - 2),
      };
    }),
  );
  for (const [i, a] of boxes.entries()) {
    assert(
      Math.abs(a.x - a.parentX - (ranges[i][0] / 166.5) * a.parentWidth) < 1.5,
      'Clip starts at its true source position',
    );
    assert(
      Math.abs(a.width - ((ranges[i][1] - ranges[i][0]) / 166.5) * a.parentWidth) < 1.5,
      'Entire clip extent is represented',
    );
    assert.equal(a.leftHit, a.id, 'Start boundary is unobstructed');
    assert.equal(a.rightHit, a.id, 'End boundary is unobstructed');
    for (let j = i + 1; j < boxes.length; j++) {
      if (ranges[i][0] < ranges[j][1] && ranges[j][0] < ranges[i][1]) {
        const b = boxes[j];
        assert(
          a.y + a.height <= b.y || b.y + b.height <= a.y,
          'Overlapping time ranges must remain separately visible',
        );
      }
    }
  }
  return boxes;
}
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    new MutationObserver(() =>
      document.querySelectorAll('video').forEach((v) => {
        v.muted = true;
      }),
    ).observe(document, { childList: true, subtree: true });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('[data-workflow]').waitFor();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1800, 1100));
  const ranges = [
    [0, 35],
    [47, 128],
    [108, 166.5],
  ];
  await seed(ranges);
  const second = page.locator('[data-clip="overlap-1"]');
  await second.click({
    position: { x: Math.max(5, (await second.boundingBox()).width - 10), y: 10 },
  });
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  let boxes = await geometry(ranges);
  assert(boxes[1].z > boxes[2].z, 'Selected clip has visual priority');
  assert.notEqual(boxes[1].color, boxes[2].color, 'Adjacent clip identities have distinct colors');
  await expect(page.locator('[data-overlap-count="2"]')).toHaveCount(1);
  await capture('wide-selected-overlap');
  // Keyboard selection works for the overlapping item without moving the playhead.
  const before = await page.locator('video').evaluate((v) => v.currentTime);
  const third = page.locator('[data-clip="overlap-2"]');
  await third.focus();
  await page.keyboard.press('Space');
  await expect(third).toHaveAttribute('aria-pressed', 'true');
  assert.equal(await page.locator('video').evaluate((v) => v.currentTime), before);
  await page.locator('[data-clip="overlap-0"]').focus();
  await page.keyboard.press('Enter');
  await capture('wide-overlap-unselected');
  const color = boxes[1].color;
  await page
    .locator('[data-cut-clip="overlap-1"]')
    .getByRole('textbox', { name: 'Clip name' })
    .fill('Renamed conversation');
  assert.equal((await geometry(ranges))[1].color, color);
  // A drag beginning over the filmstrip still moves immediately and continuously.
  const track = await page.getByTestId('scrub-surface').boundingBox();
  await page.mouse.move(track.x + track.width * 0.15, track.y + 55);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width * 0.7, track.y + 55, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() => page.locator('video').evaluate((v) => v.currentTime))
    .toBeCloseTo(166.5 * 0.7, 0);
  for (const [w, h, name] of [
    [2560, 1440, 'wide'],
    [1100, 720, 'compact'],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, { w, h }) => BrowserWindow.getAllWindows()[0].setSize(w, h),
      { w, h },
    );
    await second.focus();
    await page.keyboard.press('Enter');
    await geometry(ranges);
    const fit = await page.evaluate(() => ({
      w: innerWidth,
      h: innerHeight,
      sw: document.documentElement.scrollWidth,
      sh: document.documentElement.scrollHeight,
      footer: document.querySelector('footer').getBoundingClientRect().bottom,
    }));
    assert(
      fit.sw <= fit.w + 1 && fit.sh <= fit.h + 1 && fit.footer <= fit.h + 1,
      'Workspace remains within the window',
    );
    await expect(
      page.getByRole('button', { name: 'Play · K / Space', exact: true }),
    ).toBeInViewport();
    await capture(`${name}-overlap-layout`);
  }
  const nested = [
    [0, 166.5],
    [20, 130],
    [20, 130],
    [40, 70],
  ];
  await seed(nested);
  await page.locator('[data-clip="overlap-2"]').focus();
  await page.keyboard.press('Enter');
  await geometry(nested);
  await expect(page.locator('[data-clip-lanes]')).toHaveAttribute('data-clip-lanes', '4');
  await capture('compact-nested-identical');
  await seed([
    [0, 30],
    [30, 60],
    [90, 166.5],
  ]);
  await expect(page.locator('[data-clip-lanes]')).toHaveAttribute('data-clip-lanes', '1');
  await expect(page.locator('[data-overlap-count]')).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(
    'Overlap checks passed: partial, nested, identical and touching ranges; unobstructed extents; pointer/keyboard selection; stable colors; scrubbing; wide/compact Electron.',
  );
} catch (error) {
  if (page) await capture('failure').catch(() => {});
  throw error;
} finally {
  await app.close();
}
