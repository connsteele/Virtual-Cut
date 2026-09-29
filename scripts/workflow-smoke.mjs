import assert from 'node:assert/strict';
import { mkdir, mkdtemp, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { _electron as electron, expect } from 'playwright/test';
import { assertBuilt, electronEnvironment, require, root } from './shared.mjs';
import { verifyIteration03 } from './iteration-03-checks.mjs';

assertBuilt();
const catalog = JSON.parse(
  await readFile(path.join(root, 'src/workflow/demo-recordings.json'), 'utf8'),
);
const stateKey = 'virtual-cut.workflow-preview.full-resolution.v1';
const directory = process.env.VIRTUAL_CUT_TEST_OUTPUT || 'G:/GPT/Work/virtual-cut/desktop-ui/qa';
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
const errors = [];
let page;
async function capture(name) {
  const data = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    await wc.capturePage(undefined, { stayHidden: true, stayAwake: true });
    await new Promise((resolve) => setTimeout(resolve, 120));
    return (await wc.capturePage(undefined, { stayHidden: true, stayAwake: true }))
      .toPNG()
      .toString('base64');
  });
  await writeFile(path.join(directory, `${name}.png`), Buffer.from(data, 'base64'));
}
async function go(name) {
  await page
    .getByRole('navigation', { name: 'Workspace pages' })
    .getByRole('button', { name, exact: true })
    .click();
  await expect(page.locator('[data-page]')).toHaveAttribute('data-page', name.toLowerCase());
}
async function videoReady() {
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
}
async function noOuterOverflow() {
  const box = await page.evaluate(() => {
    const nav = document.querySelector('footer').getBoundingClientRect();
    return {
      w: innerWidth,
      h: innerHeight,
      sw: document.documentElement.scrollWidth,
      sh: document.documentElement.scrollHeight,
      bottom: nav.bottom,
    };
  });
  assert(box.sw <= box.w + 1, `Horizontal overflow: ${JSON.stringify(box)}`);
  assert(
    box.sh <= box.h + 1 && box.bottom <= box.h + 1,
    `Vertical overflow: ${JSON.stringify(box)}`,
  );
  const viewers = await page
    .getByRole('region', { name: 'Footage viewer', exact: true })
    .evaluateAll((elements) =>
      elements.map((el) => ({
        bottom: el.getBoundingClientRect().bottom,
        childrenBottom: Math.max(
          ...[...el.children]
            .filter((c) => c.tagName !== 'DIALOG')
            .map((c) => c.getBoundingClientRect().bottom),
        ),
      })),
    );
  for (const viewer of viewers)
    assert(
      viewer.childrenBottom <= viewer.bottom + 2,
      'Viewer controls must stay inside their layout box',
    );
}
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('[data-workflow]').waitFor();
  await page.addInitScript(() => {
    const mute = () =>
      document.querySelectorAll('video').forEach((v) => {
        v.muted = true;
      });
    new MutationObserver(mute).observe(document, { childList: true, subtree: true });
    mute();
  });
  await page.reload();
  await page.locator('[data-workflow]').waitFor();
  assert.equal(await page.locator('[data-recording]').count(), 6);
  assert.equal(catalog.filter((r) => r.folder === 'Supports').length, 3);
  assert.equal(
    new Set(catalog.filter((r) => r.folder !== 'Supports').map((r) => r.folder)).size,
    3,
  );
  for (const r of catalog) {
    await page.locator(`[data-recording="${r.id}"]`).click();
    await videoReady();
    const metadata = await page
      .locator('video')
      .evaluate((v) => ({ width: v.videoWidth, height: v.videoHeight, duration: v.duration }));
    assert.equal(metadata.width, 3840);
    assert.equal(metadata.height, 2160);
    assert(Math.abs(metadata.duration - r.duration) < 0.1);
    assert(r.audio);
    await page.locator('video').evaluate((v) => {
      v.currentTime = v.duration * 0.55;
    });
    await page.waitForFunction(
      () =>
        !document.querySelector('video').seeking && document.querySelector('video').readyState >= 2,
    );
    await page.getByRole('button', { name: 'Play forward · L', exact: true }).click();
    await expect
      .poll(() => page.locator('video').evaluate((v) => v.currentTime))
      .toBeGreaterThan(r.duration * 0.55 + 0.1);
    await page.keyboard.press('k');
  }
  console.log('Six full-length 3840 × 2160 AV1 videos decoded, sought and played successfully.');
  await page.locator('[data-recording="r1"]').click();
  await videoReady();
  await page.locator('video').evaluate((v) => {
    v.currentTime = 0;
  });
  await page.waitForFunction(() => !document.querySelector('video').seeking);
  assert.equal(await page.locator('[data-testid="combined-timeline"]').count(), 1);
  await page.getByRole('button', { name: 'Next keyframe', exact: true }).click();
  await expect
    .poll(() => page.locator('video').evaluate((v) => v.currentTime))
    .toBeCloseTo(catalog[0].keys[1], 1);
  await page.getByRole('button', { name: 'Previous keyframe', exact: true }).click();
  await expect.poll(() => page.locator('video').evaluate((v) => v.currentTime)).toBeLessThan(0.1);
  await page.getByRole('button', { name: 'Play forward · L', exact: true }).click();
  await expect
    .poll(() => page.locator('video').evaluate((v) => v.currentTime))
    .toBeGreaterThan(0.2);
  await page.keyboard.press('k');
  assert(await page.locator('video').evaluate((v) => v.paused));
  await page.getByRole('button', { name: 'Capture current frame', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Use as thumbnail', exact: true }).click();
  const saved = await page.evaluate((key) => localStorage.getItem(key), stateKey);
  assert(!saved.includes('data:image'), 'Captured frames must not inflate persisted data');
  await page.locator('[data-recording="r2"]').click();
  await videoReady();
  await expect(page.locator('video')).toHaveAttribute('aria-label', `Video: ${catalog[1].title}`);
  await page.keyboard.press('Control+ArrowUp');
  await videoReady();
  await page.getByRole('button', { name: 'Marker', exact: true }).click();
  await page.getByRole('textbox', { name: 'Marker name', exact: true }).fill('UI test marker');
  const deleteMarker = page.getByRole('button', {
    name: 'Delete marker: UI test marker',
    exact: true,
  });
  await deleteMarker.click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(deleteMarker).toBeVisible();
  await deleteMarker.click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Marker name', exact: true }).count(), 0);
  console.log(
    'Cut: playback, measured sample keyframes, screenshot, batch navigation, marker confirmation passed.',
  );

  await verifyIteration03({ page, app, capture, go, videoReady, stateKey });
  await go('Review');
  const first = page.locator('[data-card="c1"]');
  await first.getByRole('button', { name: 'Details', exact: true }).click();
  await videoReady();
  await expect(first.getByRole('textbox', { name: 'Clip name', exact: true })).toBeVisible();
  await first
    .getByRole('textbox', { name: 'Clip name', exact: true })
    .fill('Review test — Cai support');
  await first.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(first).toHaveCount(0);
  await page.getByRole('button', { name: 'Queue 1', exact: true }).click();
  await expect(page.locator('[data-card="c1"]')).toBeVisible();
  await page.getByRole('button', { name: 'File queue · 1', exact: true }).click();
  await page.getByRole('button', { name: 'Simulate filing', exact: true }).click();
  await page.getByRole('button', { name: 'Done 1', exact: true }).click();
  await expect(page.locator('[data-card="c1"]')).toBeVisible();
  await page.getByRole('button', { name: 'Remaining 5', exact: true }).click();
  const second = page.locator('[data-card="c2"]');
  await second.getByRole('button', { name: 'Hold', exact: true }).click();
  await page.getByRole('button', { name: 'Held 1', exact: true }).click();
  await second.getByRole('button', { name: 'Supports', exact: true }).click();
  await page.getByRole('button', { name: 'New folder here', exact: true }).click();
  await page.getByRole('textbox', { name: 'New folder name', exact: true }).fill('Demo discussion');
  await page.getByRole('button', { name: 'Assign folder', exact: true }).click();
  await expect(second).toContainText('Supports/Demo discussion');
  await page.getByRole('button', { name: 'All 6', exact: true }).click();
  await page
    .locator('[data-card="c5"]')
    .getByRole('button', { name: 'Details', exact: true })
    .click();
  await videoReady();
  await page.waitForTimeout(650);
  const expansion = await page.locator('[data-card="c5"]').evaluate((el) => ({
    top: el.getBoundingClientRect().top,
    container: el.closest('[data-scroll]').getBoundingClientRect().top,
  }));
  assert(expansion.top >= expansion.container - 3, 'Expanded review must keep its heading visible');
  await capture('review-expanded');
  console.log('Review: accept, hold, simulated filing, new folder, expansion visibility passed.');

  await go('Library');
  await page.getByRole('button', { name: 'Blaze Arts', exact: true }).click();
  const focus = page.getByRole('combobox', { name: 'Connection focus' });
  await expect(focus).toHaveValue('Blaze Arts');
  await expect(page.getByRole('complementary', { name: 'Connection details' })).toContainText(
    'Cai',
  );
  await expect(page.getByRole('complementary', { name: 'Connection details' })).toContainText(
    'Leda',
  );
  await page.getByRole('button', { name: 'Edit glossary entry', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Aliases / transcript spellings', exact: true })
    .fill('Blaze Art; battle power');
  await page.getByRole('button', { name: 'Save entry', exact: true }).click();
  await page.getByRole('button', { name: 'Glossary', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search library', exact: true }).fill('battle power');
  await expect(page.getByRole('heading', { name: 'Blaze Arts', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Explore connections', exact: true }).click();
  await capture('graph-blaze-arts');
  console.log('Library: glossary edits, alias search and shared Cai/Leda connections passed.');

  await go('Selects');
  await videoReady();
  await page.getByRole('button', { name: 'Move later', exact: true }).first().click();
  await page.getByRole('button', { name: 'Play sequence', exact: true }).click();
  await expect(page.locator('video')).toHaveAttribute('aria-label', `Video: ${catalog[3].title}`);
  await videoReady();
  await page.locator('video').evaluate((v) => {
    v.currentTime = v.duration - 0.01;
  });
  await expect(page.locator('video')).toHaveAttribute('aria-label', `Video: ${catalog[0].title}`);
  await videoReady();
  await page.keyboard.press('k');
  await page.getByRole('button', { name: 'Resolve handoff', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(
    '1 items to add · 1 exact duplicates skipped',
  );
  await page.getByRole('button', { name: 'Simulate append', exact: true }).click();
  await page.getByRole('button', { name: 'Resolve handoff', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(
    '0 items to add · 2 exact duplicates skipped',
  );
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  console.log('Selects: reorder and repeat-append duplicate handling passed.');

  for (const [width, height, label] of [
    [2560, 1440, 'wide'],
    [1100, 720, 'compact'],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, { width, height }) =>
        BrowserWindow.getAllWindows()[0].setSize(width, height),
      { width, height },
    );
    for (const name of ['Media', 'Cut', 'Review', 'Library', 'Selects']) {
      await go(name);
      await page.waitForTimeout(180);
      await noOuterOverflow();
      await capture(`${label}-${name.toLowerCase()}`);
    }
  }
  await page.reload();
  await page.locator('[data-workflow]').waitFor();
  const persisted = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)).data,
    stateKey,
  );
  assert.equal(persisted.clips.find((c) => c.id === 'c1').name, 'Review test — Cai support');
  assert.equal(persisted.markers.r1.length, 0);
  console.log('All five pages fit wide and compact windows; sample edits survive restart.');

  const fixture = path.join(directory, 'local-playback.mp4');
  await copyFile(
    process.env.VIRTUAL_CUT_TEST_VIDEO || path.join(root, 'public/demo/conversation.mp4'),
    fixture,
  );
  const hash = async () =>
    createHash('sha256')
      .update(await readFile(fixture))
      .digest('hex');
  const before = await hash();
  await app.evaluate(({ dialog }, fixture) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] });
  }, fixture);
  await page.getByRole('button', { name: 'Open video', exact: true }).click();
  await videoReady();
  await expect(page.getByRole('button', { name: 'Next keyframe', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Capture current frame', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Clip', exact: true }).click();
  await page.getByRole('button', { name: 'Marker', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Capture intent', exact: true })
    .fill('Local draft context');
  const draft = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).data, stateKey);
  assert(!draft.recordings.some((r) => !r.sample), 'Session media must not persist capabilities');
  assert.equal(await hash(), before, 'Original file bytes unchanged');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 1000));
  await capture('local-playback');
  await page.locator('[data-recording="r1"]').click();
  await videoReady();
  assert.equal(await page.locator('video').evaluate((v) => v.videoWidth), 3840);
  console.log('Opening local video preserves access to full-resolution demo videos.');
  const full = await page.evaluate(() => window.virtualCut.toggleFullscreen());
  assert.equal(full, true);
  assert.equal(await page.evaluate(() => window.virtualCut.toggleFullscreen()), false);
  assert.equal(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    'Local playback, session-only draft, unchanged source, fullscreen IPC and no renderer errors passed.',
  );
} catch (error) {
  if (page) await capture('failure').catch(() => {});
  throw error;
} finally {
  await app.close();
}
