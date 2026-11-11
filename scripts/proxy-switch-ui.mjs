// The Original/Proxy switch (VC-238): one switch for the whole project, shortcut P, saved with the
// project; Proxy plays the recording's proxy everywhere (paused frames too) and keeps the
// playhead when it flips; a recording without a usable proxy shows its original, with Proxy
// greyed out, and the project's choice comes back on the next recording that has one; the tag
// on the picture names what is on screen; a drag on a proxy seeks exact frames.
//
// The proxy is made here with FFmpeg from the check's own clip, inverted and at 1920×1080, so
// the picture size tells the two files apart; its record is written into the project the way
// making proxies (VC-237) will. Screenshots are saved beside the project.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rename, stat, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { require, root, electronEnvironment } from './shared.mjs';
import { proxyFileName } from '../dist-electron/proxy-record.js';

const base = process.env.VIRTUAL_CUT_TEST_ROOT;
assert(base, 'Run with the test suite so all media is disposable.');
await mkdir(path.join(base, 'proxy-switch-ui'), { recursive: true });
const dir = await mkdtemp(path.join(base, 'proxy-switch-ui/run-'));
const ffmpeg = process.env.VIRTUAL_CUT_FFMPEG || 'ffmpeg';
const tool = (args) =>
  new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-v', 'error', ...args], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let error = '';
    p.stderr.on('data', (d) => (error += d));
    p.on('error', reject);
    p.on('close', (code) => (code ? reject(Error(error)) : resolve()));
  });
// Two recordings at 1280×720, 30 fps, a keyframe each second, game and mic tracks.
const recording = (file, seconds, pattern) =>
  tool([
    ...['-f', 'lavfi', '-i', `${pattern}=size=1280x720:rate=30`],
    ...['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000'],
    ...['-map', '0:v', '-map', '1:a', '-map', '1:a', '-t', String(seconds)],
    ...['-c:v', 'libx264', '-preset', 'ultrafast', '-g', '30', '-keyint_min', '30'],
    ...['-sc_threshold', '0', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', file],
  ]);
const first = path.join(dir, 'With proxy.mp4'),
  second = path.join(dir, 'Without proxy.mp4');
await recording(first, 12, 'testsrc2');
await recording(second, 8, 'testsrc');

const { ProjectService } = require('../dist-electron/project-service.cjs');
const file = path.join(dir, 'proxy switch.vcut'),
  cache = path.join(dir, 'cache');
await mkdir(cache);
const previous = process.env.VIRTUAL_CUT_PICTURE_PASS;
process.env.VIRTUAL_CUT_PICTURE_PASS = 'manual';
const service = new ProjectService(path.join(dir, 'native-profile'), '');
let snap = await service.open(file, { name: 'Proxy switch QA', destination: dir, cache });
await service.importFiles(snap.project.id, snap.activeBatchId, [first, second], {
  game: 1,
  mic: 2,
});
for (const until = Date.now() + 60000; ;) {
  snap = await service.snapshot();
  if (!snap.jobs.some((j) => ['queued', 'running'].includes(j.state))) break;
  assert(Date.now() < until, 'Import timed out');
  await new Promise((r) => setTimeout(r, 100));
}
const id = snap.model.recordings.find((r) => r.title.startsWith('With proxy')).id,
  other = snap.model.recordings.find((r) => r.title.startsWith('Without proxy')).id;
await service.close();
if (previous === undefined) delete process.env.VIRTUAL_CUT_PICTURE_PASS;
else process.env.VIRTUAL_CUT_PICTURE_PASS = previous;

// The proxy: the same frames inverted, 1920×1080 H.264, a keyframe every 0.5 s, no audio.
const db = new DatabaseSync(file);
const source = JSON.parse(db.prepare('SELECT body FROM sources WHERE id = ?').get(id).body);
const proxyFile = path.join(cache, proxyFileName(id, source.fingerprint, 1080));
await tool([
  ...['-i', first, '-map', '0:v', '-vf', 'scale=1920:1080,negate', '-c:v', 'libx264'],
  ...['-preset', 'ultrafast', '-g', '15', '-keyint_min', '15', '-sc_threshold', '0', '-bf', '0'],
  ...['-pix_fmt', 'yuv420p', '-an', '-y', proxyFile],
]);
const info = await stat(proxyFile);
source.proxy = {
  file: path.basename(proxyFile),
  height: 1080,
  width: 1920,
  codec: 'h264',
  keyframeStep: 0.5,
  fingerprint: source.fingerprint,
  bytes: info.size,
  modified: info.mtimeMs,
  made: new Date().toISOString(),
};
db.prepare('UPDATE sources SET body = ? WHERE id = ?').run(JSON.stringify(source), id);
db.close();

const errors = [];
let app, page;
async function launch() {
  app = await electron.launch({
    executablePath: process.env.VIRTUAL_CUT_TEST_EXECUTABLE || require('electron'),
    args: [
      ...(process.env.VIRTUAL_CUT_TEST_EXECUTABLE ? [] : [root]),
      `--user-data-dir=${path.join(dir, 'profile')}`,
      '--background-test',
    ],
    cwd: root,
    env: electronEnvironment({ VIRTUAL_CUT_IDLE_SECONDS: '600', VIRTUAL_CUT_PICTURE_GPU: '0' }),
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('[data-workflow]').waitFor();
  await app.evaluate(({ dialog, BrowserWindow }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.setAudioMuted(true);
    win.setSize(1280, 800);
  }, file);
  await page.evaluate(() => localStorage.setItem('virtual-cut.selection-follows', 'false'));
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Workspace pages' })
    .getByRole('button', { name: 'Cut', exact: true })
    .click();
}
async function capture(name) {
  const image = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    await wc.capturePage(undefined, { stayHidden: true, stayAwake: true });
    await new Promise((r) => setTimeout(r, 150));
    return (await wc.capturePage(undefined, { stayHidden: true, stayAwake: true }))
      .toPNG()
      .toString('base64');
  });
  await writeFile(path.join(dir, name + '.png'), Buffer.from(image, 'base64'));
}
const video = () => page.locator('[data-video-stage] video');
const tag = () => page.locator('[data-viewer-source]');
const switcher = () => page.getByRole('group', { name: 'Viewer source' });
const original = () => switcher().getByRole('button', { name: 'Original', exact: true });
const proxyButton = () => switcher().getByRole('button', { name: /^Proxy/ });
/** The width of the decoded picture: 1920 is the proxy, 1280 the original. */
const shown = () => video().evaluate((v) => (v.readyState >= 2 && !v.seeking ? v.videoWidth : 0));
const position = () => video().evaluate((v) => v.currentTime);
async function key(value) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press(value);
}
async function select(recordingId) {
  await page.locator(`[data-recording="${recordingId}"]`).first().click();
  await expect(page.getByLabel(/^Video: /)).toHaveCount(1);
}
const saved = () => page.evaluate(() => window.virtualCut.project.current());

try {
  await launch();
  await select(id);
  // A project starts on Proxy: this recording has one, so the viewer plays it.
  await expect.poll(shown).toBe(1920);
  await expect(tag()).toHaveAttribute('data-viewer-source', 'proxy');
  await expect(tag()).toHaveText('Proxy1920 × 1080 · H.264 · 30.00 fps');
  await expect(proxyButton()).toHaveAttribute('aria-pressed', 'true');
  await expect(original()).toHaveAttribute('aria-pressed', 'false');
  await capture('proxy-shown');

  // P keeps the playhead: seek to a frame that is not a keyframe of either file, then flip.
  const ruler = await page.locator('[data-seek-surface="ruler"]').boundingBox();
  const rulerY = ruler.y + ruler.height / 2;
  await page.mouse.click(ruler.x + ruler.width * 0.43, rulerY);
  await expect.poll(() => video().evaluate((v) => v.seeking)).toBe(false);
  const at = await position();
  assert(at > 4 && at < 6, `seeked to ${at}`);
  await key('p');
  await expect.poll(shown).toBe(1280);
  await expect(tag()).toHaveAttribute('data-viewer-source', 'original');
  await expect(tag()).toHaveText('Original1280 × 720 · H.264 · 30.00 fps');
  assert(Math.abs((await position()) - at) < 0.5 / 30, `original at ${await position()}, ${at}`);
  await expect(page.getByLabel('Playback status', { exact: true })).toHaveText('Paused');
  await capture('original-shown');
  await key('p');
  await expect.poll(shown).toBe(1920);
  assert(Math.abs((await position()) - at) < 0.5 / 30, `proxy at ${await position()}, ${at}`);
  // The switch itself, by pointer, does the same.
  await original().click();
  await expect.poll(shown).toBe(1280);
  await proxyButton().click();
  await expect.poll(shown).toBe(1920);

  // Playing through a flip carries on playing from where the picture was.
  await key('k');
  await expect(page.getByLabel('Playback status', { exact: true })).toHaveText('1× forward');
  await new Promise((r) => setTimeout(r, 400));
  const playing = await position();
  await key('p');
  await expect.poll(shown).toBe(1280);
  await expect(page.getByLabel('Playback status', { exact: true })).toHaveText('1× forward');
  await expect
    .poll(() => video().evaluate((v) => !v.paused && v.currentTime))
    .toBeGreaterThan(playing);
  assert((await position()) < playing + 1.5, 'resumed near the flip, not from elsewhere');
  await key('k');
  await key('p');
  await expect.poll(shown).toBe(1920);

  // A drag on the proxy seeks exact frames: no seek lands on the original's whole-second
  // keyframes unless the pointer was there. (On the original a fast drag would snap to them.)
  await video().evaluate((v) => {
    window.__proxySeeks = [];
    v.addEventListener('seeking', () => window.__proxySeeks.push(v.currentTime));
  });
  await page.mouse.move(ruler.x + ruler.width * 0.05, rulerY);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++)
    await page.mouse.move(ruler.x + ruler.width * (0.05 + i * 0.029), rulerY);
  await page.mouse.up();
  await expect.poll(() => video().evaluate((v) => v.seeking)).toBe(false);
  const seeks = await page.evaluate(() => window.__proxySeeks);
  assert(seeks.length >= 3, `${seeks.length} seeks during the drag`);
  const onKeys = seeks.filter((t) => Math.abs(t - Math.round(t)) < 0.001).length;
  assert(onKeys <= 2, `${onKeys} of ${seeks.length} drag seeks landed on keyframes: ${seeks}`);
  await expect.poll(shown).toBe(1920);

  // Info beside the switch: Always, When paused or Never, with a 2 s flash when the source
  // changes; remembered for the app.
  const info = page.getByRole('button', { name: /^Info: / });
  const infoItem = (name) =>
    page.getByRole('menu', { name: 'Info tag on the picture' }).getByRole('menuitemradio', {
      name: new RegExp('^\\W*' + name),
    });
  await expect(info).toHaveText('Info: Always');
  await info.click();
  await expect(infoItem('Always')).toBeFocused();
  await capture('info-menu');
  await infoItem('When paused').click();
  await expect(info).toHaveText('Info: When paused');
  await expect(tag()).toHaveAttribute('data-shown', 'true');
  // Hidden while playing (once the 2 s flash of the last flip is over); from 1 s, so the
  // 12 s clip does not end first.
  await page.mouse.click(ruler.x + ruler.width * 0.08, rulerY);
  await key('k');
  await expect(page.getByLabel('Playback status', { exact: true })).toHaveText('1× forward');
  await expect(tag()).toHaveAttribute('data-shown', 'false', { timeout: 4000 });
  await key('k');
  await expect(tag()).toHaveAttribute('data-shown', 'true');
  await info.click();
  await infoItem('Never').click();
  await expect(tag()).toHaveAttribute('data-shown', 'false');
  // A flip shows it for 2 s, then it hides again.
  await key('p');
  await expect.poll(shown).toBe(1280);
  await expect(tag()).toHaveAttribute('data-shown', 'true');
  await expect(tag()).toHaveAttribute('data-shown', 'false', { timeout: 4000 });
  await key('p');
  await expect.poll(shown).toBe(1920);
  assert.equal(await page.evaluate(() => localStorage.getItem('virtual-cut.viewer-info')), 'never');
  await info.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Info tag on the picture' })).toHaveCount(0);
  await info.click();
  await infoItem('Always').click();
  await expect(tag()).toHaveAttribute('data-shown', 'true');
  // The metrics text, Info and the switch share one centre line.
  const centres = await page.evaluate(() =>
    [
      '[aria-label="Playback metrics"]',
      '[aria-haspopup="menu"][title^="When the info tag"]',
      '[aria-label="Viewer source"]',
    ].map((q) => {
      const b = document.querySelector(q).getBoundingClientRect();
      return b.top + b.height / 2;
    }),
  );
  assert(Math.max(...centres) - Math.min(...centres) < 1.5, `heading centres ${centres}`);

  // A recording without a proxy shows its original; Proxy greys out and P only says so.
  await select(other);
  await expect.poll(shown).toBe(1280);
  await expect(tag()).toHaveText('Original1280 × 720 · H.264 · 30.00 fps');
  await expect(proxyButton()).toBeDisabled();
  await expect(original()).toHaveAttribute('aria-pressed', 'true');
  await key('p');
  await expect(tag()).toHaveText(
    'Original1280 × 720 · H.264 · 30.00 fps · No proxy for this recording',
  );
  await capture('no-proxy-fallback');
  // The project's choice is still Proxy, so it comes back on the recording that has one.
  await select(id);
  await expect.poll(shown).toBe(1920);
  await expect(tag()).toHaveAttribute('data-viewer-source', 'proxy');

  // The choice is saved with the project, without an undo step.
  const undoBefore = (await saved()).canUndo;
  await original().click();
  await expect.poll(shown).toBe(1280);
  await expect.poll(async () => (await saved()).model.viewerSource).toBe('original');
  assert.equal((await saved()).canUndo, undoBefore, 'the switch is not an edit');
  await key('Control+s');
  await expect.poll(async () => (await saved()).unsavedChanges).toBe(false);
  await app.close();

  // Reopened: still Original, with Proxy available. Back to Proxy, then the proxy file goes.
  await launch();
  await select(id);
  await expect.poll(shown).toBe(1280);
  await expect(original()).toHaveAttribute('aria-pressed', 'true');
  await expect(proxyButton()).toBeEnabled();
  await key('p');
  await expect.poll(shown).toBe(1920);
  await key('p');
  await expect.poll(shown).toBe(1280);
  await key('p');
  await expect.poll(shown).toBe(1920);
  await original().click();
  await expect.poll(shown).toBe(1280);
  await rename(proxyFile, proxyFile + '.gone');
  await proxyButton().click();
  // The next snapshot (selecting a recording saves the session) finds the proxy missing.
  await select(other);
  await select(id);
  await expect
    .poll(async () => (await saved()).model.recordings.find((r) => r.id === id).proxy?.state)
    .toBe('missing');
  await expect(proxyButton()).toBeDisabled();
  await expect(tag()).toHaveText('Original1280 × 720 · H.264 · 30.00 fps · proxy file missing');
  await capture('proxy-missing');
  await key('p');
  await expect(tag()).toHaveText(
    'Original1280 × 720 · H.264 · 30.00 fps · The proxy file is missing',
  );
  // A project set to make proxies Never has no switch; the tag keeps only the format.
  const setProxies = (onImport) =>
    page.evaluate(async (onImport) => {
      const { project } = await window.virtualCut.project.current();
      await window.virtualCut.project.setProxySettings(project.id, { onImport, height: 1080 });
    }, onImport);
  await setProxies('never');
  await expect(switcher()).toHaveCount(0);
  await expect(tag()).toHaveText('1280 × 720 · H.264 · 30.00 fps');
  await setProxies('ask');
  await expect(switcher()).toBeVisible();
  // Compact window: the switch and the tag still fit.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
  await page.waitForTimeout(300);
  await expect(switcher()).toBeVisible();
  await capture('compact');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ dir, seeks: seeks.length, onKeys }));
} finally {
  await app?.close().catch(() => {});
}
