import { testPath } from './test-paths.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { require, root, electronEnvironment } from './shared.mjs';
import { collectBeforeWindowClose } from './coverage-desktop.mjs';
const checksRoot = testPath('milestone-1');
const fixture = JSON.parse(await readFile(path.join(checksRoot, 'latest-native.json'), 'utf8'));
await mkdir(checksRoot, { recursive: true });
const dir = await mkdtemp(path.join(checksRoot, 'ui-'));
const projectFile = path.join(dir, 'project.vcut'),
  secondFile = path.join(dir, 'second.vcut');
const profile = path.join(dir, 'profile');
const executable = process.env.VIRTUAL_CUT_TEST_EXECUTABLE;
const errors = [];
let app, page;
async function launch() {
  app = await electron.launch({
    executablePath: executable || require('electron'),
    args: [...(executable ? [] : [root]), `--user-data-dir=${profile}`, '--background-test'],
    cwd: root,
    env: electronEnvironment({}),
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => errors.push(e.message));
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true);
  });
  await page.locator('[data-workflow]').waitFor();
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
  await writeFile(path.join(dir, `${name}.png`), Buffer.from(data, 'base64'));
}
async function nativePick(file) {
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, file);
}
async function create(name, file) {
  await app.evaluate(
    ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p.file });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p.dir] });
    },
    { file, dir },
  );
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByLabel('New project name').fill(name);
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Projects', exact: true })).toContainText(name);
  await expect(page.getByText('Bring recordings into this batch')).toBeVisible();
}
async function current() {
  return page.evaluate(() => window.virtualCut.project.current());
}
async function saved() {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('banner').getByRole('status')).toHaveText('Manual save made');
}
async function seek(time) {
  await page.locator('video').evaluate((v, time) => {
    v.currentTime = time;
  }, time);
  await expect.poll(() => page.locator('video').evaluate((v) => v.seeking)).toBe(false);
}
async function go(name) {
  await page
    .getByRole('navigation', { name: 'Workspace pages' })
    .getByRole('button', { name, exact: true })
    .click();
}
async function close() {
  await collectBeforeWindowClose(app);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  if (app.process().exitCode === null)
    await new Promise((resolve) => app.process().once('exit', resolve));
}
try {
  await launch();
  await create('Milestone 1 UI', projectFile);
  await nativePick(fixture.source);
  await page.getByRole('button', { name: 'Import files', exact: true }).click();
  await page.getByRole('button', { name: 'Choose files…', exact: true }).click();
  await expect
    .poll(
      async () => {
        const p = await current();
        return p.model.recordings[0]?.availability;
      },
      { timeout: 60000 },
    )
    .toBe('ready');
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await expect
    .poll(async () => (await current()).jobs.every((j) => j.state === 'succeeded'))
    .toBe(true);
  await capture('01-imported');
  let p = await current();
  const rid = p.model.recordings[0].id;
  await page.locator(`[data-recording="${rid}"]`).click();
  // VC-206: import makes no clip. Cut and Review say so, export is off, and Whole recording
  // (reached by keyboard here) makes the clip from the first frame to the last in one step.
  assert.equal(p.model.clips.length, 0, 'import makes no clip');
  await expect(page.locator('[data-no-clips]')).toContainText('exports nothing');
  await expect(page.locator('[data-cut-clip]')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Export selected clip', exact: true }),
  ).toBeDisabled();
  await capture('01a-cut-no-clips');
  const fullSize = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getSize(),
  );
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 720));
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(1100);
  await expect(page.getByRole('button', { name: 'Whole recording', exact: true })).toBeInViewport();
  await capture('01b-cut-no-clips-compact');
  await app.evaluate(
    ({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h),
    fullSize,
  );
  await go('Review');
  await expect(page.locator('[data-review-no-clips]')).toContainText('No clips in this batch yet');
  await capture('01c-review-no-clips');
  await page.locator('[data-review-no-clips]').getByRole('button', { name: 'Open Cut' }).click();
  await expect(page.locator('[data-no-clips]')).toBeVisible();
  await page.getByRole('button', { name: 'Whole recording', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-cut-clip]')).toHaveCount(1);
  await expect(page.locator('[data-no-clips]')).toHaveCount(0);
  await saved();
  p = await current();
  assert.deepEqual(
    p.model.clips.map((c) => [c.rid, c.name, c.start, c.end, c.folder]),
    [[rid, p.model.recordings[0].title, 0, p.model.recordings[0].duration, '_Review']],
  );
  await expect(
    page.getByRole('button', { name: 'Export selected clip', exact: true }),
  ).toBeEnabled();
  // A second press keeps the one clip and says why.
  await page.getByRole('button', { name: 'Whole recording', exact: true }).click();
  await expect(page.locator('[data-cut-clip]')).toHaveCount(1);
  await expect(page.getByText('already has a clip covering all of it')).toBeVisible();
  await capture('01d-cut-whole-recording');
  await page.getByLabel('Selection follows playhead').uncheck();
  await page.getByLabel('Clip name', { exact: true }).fill('Saved UI clip');
  await seek(1);
  await page.getByRole('button', { name: 'Q · In', exact: true }).click();
  await seek(6);
  await page.getByRole('button', { name: 'W · Out', exact: true }).click();
  await seek(3);
  await page.getByRole('button', { name: 'S · Split', exact: true }).click();
  await expect(page.locator('[data-cut-clip]')).toHaveCount(2);
  await saved();
  p = await current();
  assert.deepEqual(
    p.model.clips.map((c) => [c.start, c.end]),
    [
      [1, 3],
      [3, 6],
    ],
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('[data-cut-clip]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('[data-cut-clip]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Marker', exact: true }).click();
  await page.getByLabel('Marker name', { exact: true }).last().fill('UI point marker');
  await page
    .getByLabel('Marker note', { exact: true })
    .last()
    .fill('Note retained with the source time');
  await page.getByLabel('Capture intent').fill('Recorded to explain a character interaction');
  await saved();
  await page.getByText('Source & audio', { exact: false }).click();
  const tracks = p.model.recordings[0].audioTracks;
  await page.getByLabel('mic audio track', { exact: true }).selectOption(String(tracks[1].index));
  await saved();
  await expect
    .poll(async () => (await current()).jobs.every((j) => j.state === 'succeeded'), {
      timeout: 60000,
    })
    .toBe(true);
  await page.getByRole('button', { name: 'Combined', exact: true }).click();
  await saved();
  await expect(page.locator('audio')).toHaveCount(2);
  await page.getByRole('button', { name: 'Play · K / Space', exact: true }).click();
  await expect
    .poll(() => page.locator('audio').evaluateAll((items) => items.every((a) => !a.paused)))
    .toBe(true);
  await expect
    .poll(() =>
      page
        .locator('audio')
        .evaluateAll((items) =>
          Math.max(
            ...items.map((a) =>
              Math.abs(a.currentTime - document.querySelector('video').currentTime),
            ),
          ),
        ),
    )
    .toBeLessThan(0.25);
  // VC-29 note 28: when the picture stalls, the listening tracks wait for it. They used to be
  // pulled back to the picture, replaying a slice of sound each time (an echo at speed).
  const stall = await page.evaluate(async () => {
    const v = document.querySelector('video');
    const tracks = [...document.querySelectorAll('audio')];
    const frozen = v.currentTime;
    Object.defineProperty(v, 'currentTime', { configurable: true, get: () => frozen });
    v.dispatchEvent(new Event('waiting'));
    const samples = [];
    for (let i = 0; i < 40; i++) {
      samples.push(tracks.map((a) => ({ time: a.currentTime, paused: a.paused })));
      await new Promise((r) => setTimeout(r, 20));
    }
    delete v.currentTime;
    v.dispatchEvent(new Event('playing'));
    const backward = samples
      .slice(1)
      .some((row, i) => row.some((t, n) => t.time < samples[i][n].time - 0.001));
    return {
      backward,
      held: samples.at(-1).every((t) => t.paused),
      ahead: Math.max(...samples.at(-1).map((t) => t.time - frozen)),
    };
  });
  assert(!stall.backward && stall.held && stall.ahead < 0.3, JSON.stringify(stall));
  await expect
    .poll(() => page.locator('audio').evaluateAll((items) => items.every((a) => !a.paused)))
    .toBe(true);
  await page.getByRole('button', { name: 'Pause · K / Space', exact: true }).click();
  await expect
    .poll(() => page.locator('audio').evaluateAll((items) => items.every((a) => a.paused)))
    .toBe(true);
  await seek(2);
  await page.getByRole('button', { name: 'Next frame', exact: true }).click();
  const stepped = await page.locator('video').evaluate((v) => v.currentTime);
  assert(stepped > 2 && stepped < 2.05);
  await page.getByRole('button', { name: 'Next keyframe', exact: true }).click();
  assert((await page.locator('video').evaluate((v) => v.currentTime)) > stepped);
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByLabel('Workspace notes').fill('Project-specific scratch notes');
  await page.getByRole('button', { name: 'Close side panel', exact: true }).click();
  await saved();
  await capture('02-cut');
  await page.getByRole('button', { name: 'New batch', exact: true }).click();
  await page.getByLabel('Batch name').fill('Second intake');
  await page.getByRole('button', { name: 'Create batch', exact: true }).click();
  await expect(page.getByText('Bring recordings into this batch')).toBeVisible();
  await page.getByLabel('Current batch').selectOption({ label: 'First batch' });
  await expect(page.locator('[data-recording]')).toHaveCount(1);
  await go('Review');
  await page.getByRole('button', { name: /File queue/ }).click();
  await expect(page.getByRole('dialog').getByRole('table', { name: 'Filing plan' })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('No accepted clips');
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Details', exact: true }).first().click();
  await capture('03-review');
  await go('Library');
  await capture('04-library');
  await go('Media');
  await capture('05-media');
  await go('Cut');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 720));
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThanOrEqual(1100);
  await capture('06-compact');
  const size = await page.evaluate(() => ({
    w: innerWidth,
    h: innerHeight,
    sw: document.documentElement.scrollWidth,
    sh: document.documentElement.scrollHeight,
  }));
  assert(size.sw <= size.w + 1 && size.sh <= size.h + 1, JSON.stringify(size));
  await create('Unrelated project', secondFile);
  assert.equal((await current()).model.recordings.length, 0);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Milestone 1 UI', exact: true }).click();
  await expect(page.locator('[data-recording]')).toHaveCount(1);
  p = await current();
  assert.equal(p.model.clips[0].name, 'Saved UI clip');
  assert.equal(p.model.scratchpad, 'Project-specific scratch notes');
  await close();
  await launch();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Milestone 1 UI', exact: true }).click();
  await expect(page.locator('[data-recording]')).toHaveCount(1);
  p = await current();
  assert.equal(p.model.recordings[0].monitor, 'both');
  assert(p.model.markers[rid].some((m) => m.note === 'Note retained with the source time'));
  await page.getByLabel('Clip name', { exact: true }).first().fill('Close flush verified');
  await close();
  await launch();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Milestone 1 UI', exact: true }).click();
  await expect(page.getByLabel('Clip name', { exact: true }).first()).toHaveValue(
    'Close flush verified',
  );
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(checksRoot, 'latest-ui.json'),
    JSON.stringify({ passed: true, dir, projectFile }, null, 2),
  );
  console.log(JSON.stringify({ passed: true, dir }));
} catch (e) {
  await capture('failure').catch(() => {});
  console.error({ errors, dir });
  throw e;
} finally {
  if (app && app.process().exitCode === null) await app.close();
}
