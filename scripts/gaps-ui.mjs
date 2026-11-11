// VC-212 (decision 0028): gaps on the Cut page. G at the playhead starts a gap and G again ends
// it; the clip card lists it and the timeline draws it inside the clip; a right-click menu
// removes it; Undo brings it back; Backspace removes a selected gap; Shift+G toggles Skip gaps;
// Shift-drag then G makes one; the export panel shows the clip as it will export. Opens the
// project stitched-export-native.mjs leaves behind.
import { testPath } from './test-paths.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { root, require, electronEnvironment } from './shared.mjs';
const checksRoot = testPath('stitched');
const fixture = JSON.parse(await readFile(path.join(checksRoot, 'latest-native.json'), 'utf8'));
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
  env: electronEnvironment({}),
});
const page = await app.firstWindow(),
  errors = [];
page.setDefaultTimeout(20000);
page.on('pageerror', (e) => errors.push(e.message));
const state = () => page.evaluate(() => window.virtualCut.project.current());
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
// The renderer saves after 2 s of settled activity; read the model once it has.
const gapsSaved = (count) =>
  expect
    .poll(
      async () => (await state()).model.clips.find((c) => c.id === fixture.clip).gaps?.length ?? 0,
      {
        timeout: 15000,
      },
    )
    .toBe(count);
async function seek(seconds) {
  const position = page.getByLabel('Timeline position', { exact: true });
  await position.click();
  await position.fill(String(seconds));
  await position.press('Enter');
  await expect
    .poll(() => page.evaluate(() => document.querySelector('video').currentTime))
    .toBeGreaterThan(seconds - 0.2);
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
  await page
    .getByRole('navigation', { name: 'Workspace pages' })
    .getByRole('button', { name: 'Cut', exact: true })
    .click();
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  const clip = page.locator(`[data-clip-container="${fixture.clip}"]`),
    card = page.locator(`[data-cut-clip="${fixture.clip}"]`);
  await card.click({ position: { x: 4, y: 4 } });
  // No gaps yet: the card offers the hint.
  await expect(card.getByText('cuts it out', { exact: false })).toBeVisible();
  // G at 2.4 s starts a gap; the note beside Position says how to finish it.
  await seek(2.4);
  await page.keyboard.press('g');
  await expect(page.locator('[data-gap-note]')).toContainText('Making a gap from');
  await seek(6.6);
  await expect(clip.locator('[data-gap-pending]')).toBeVisible();
  await capture('gaps-marking');
  await page.keyboard.press('g');
  await expect(page.locator('[data-gap-note]')).toHaveCount(0);
  const gap = clip.locator('[data-gap]');
  await expect(gap).toHaveCount(1);
  await expect(gap).toHaveText('Gap 1');
  await expect(gap).toHaveAttribute('data-selected', 'true');
  await expect(clip).toHaveAttribute('data-gapped', 'true');
  await expect(clip.locator('[data-clip-piece]')).toHaveCount(2);
  // The card lists it: on 1 s keyframes 2.4–6.6 removes 3–6.
  const row = card.locator('[data-gap-row]');
  await expect(row).toContainText('00:02.4–00:06.6');
  await expect(row).toContainText('−00:03.0');
  await expect(card.locator('[data-exported-length]')).toContainText('00:07.000');
  await gapsSaved(1);
  await capture('gaps-one');
  // Right-click opens the gap's menu; Remove gap puts the footage back.
  await gap.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Gap 1' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText([
    /Remove gap 1/,
    'Go to gap start',
    'Go to gap end',
  ]);
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await capture('gaps-menu');
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Go to gap start' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(gap).toHaveCount(0);
  await gapsSaved(0);
  // Undo brings it back.
  await page.keyboard.press('Control+z');
  await gapsSaved(1);
  await expect(clip.locator('[data-gap]')).toHaveCount(1);
  // Skip gaps is off; Shift+G turns it on and back off.
  const skip = page.locator('[data-skip-gaps]');
  await expect(skip).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Shift+G');
  await expect(skip).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Shift+G');
  await expect(skip).toHaveAttribute('aria-pressed', 'false');
  // A second gap by Shift-drag over the clip, then G.
  const box = await clip.boundingBox(),
    track = await page.getByTestId('scrub-surface').boundingBox(),
    view = await page.getByTestId('scrub-surface').evaluate((e) => ({
      start: Number(e.dataset.viewStart),
      end: Number(e.dataset.viewEnd),
    })),
    x = (t) => track.x + ((t - view.start) / (view.end - view.start)) * track.width;
  await page.mouse.move(x(8.3), box.y + box.height / 2);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(x(9.2), box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(x(10.1), box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(clip.locator('[data-gap-sweep]')).toBeVisible();
  await page.keyboard.press('g');
  await expect(clip.locator('[data-gap]')).toHaveCount(2);
  await gapsSaved(2);
  const model = (await state()).model.clips.find((c) => c.id === fixture.clip);
  assert(Math.abs(model.gaps[1].start - 8.3) < 0.15 && Math.abs(model.gaps[1].end - 10.1) < 0.15);
  // Backspace removes the selected gap at once.
  await expect(clip.locator('[data-gap][data-selected="true"]')).toHaveText('Gap 2');
  await page.keyboard.press('Backspace');
  await expect(clip.locator('[data-gap]')).toHaveCount(1);
  await gapsSaved(1);
  // The export panel shows the clip as it will export, gaps for review only.
  await page.getByRole('button', { name: 'Export selected clip', exact: true }).click();
  const preview = page.locator('[data-stitched-preview]');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('2 pieces · 1 join');
  await expect(preview.locator('[data-stitched-row="gap"]')).toContainText('No, review only');
  await capture('gaps-export');
  await page.keyboard.press('Escape');
  // Compact window: the clip card's gap row stays reachable.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 720));
  await row.scrollIntoViewIfNeeded();
  await expect(row).toBeInViewport();
  await capture('gaps-compact');
  assert.equal(errors.length, 0, errors.join('\n'));
} finally {
  await app.close();
}
console.log(`Gaps UI checks passed in ${dir}`);
