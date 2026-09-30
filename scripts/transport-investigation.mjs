import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { root, electronEnvironment } from './shared.mjs';
const scratch = 'G:/GPT/Work/virtual-cut/transport-investigation';
const fixture = JSON.parse(await readFile(path.join(scratch, 'latest-fixture.json'), 'utf8'));
const dir = await mkdtemp(path.join(scratch, 'benchmark-'));
// Reproduce the original synchronizer measurements. The current app must be
// exercised through its transport controls; see transport-regression-checks.mjs.
const baselineExecutable = process.env.VIRTUAL_CUT_BASELINE_EXECUTABLE;
if (!baselineExecutable)
  throw new Error('Set VIRTUAL_CUT_BASELINE_EXECUTABLE to the packaged 0.3.5 app.');
const app = await electron.launch({
  executablePath: baselineExecutable,
  args: [`--user-data-dir=${path.join(dir, 'profile')}`, '--background-test'],
  cwd: root,
  env: electronEnvironment({ TEMP: 'G:/GPT/Temp', TMP: 'G:/GPT/Temp' }),
});
const page = await app.firstWindow();
page.setDefaultTimeout(30000);
const results = [];
try {
  const version = await app.evaluate(({ app }) => app.getVersion());
  if (version !== '0.3.5') throw new Error(`Expected baseline 0.3.5; found ${version}`);
  await app.evaluate(({ dialog, BrowserWindow }, file) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1800, 1100);
    w.webContents.setAudioMuted(true);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, fixture.file);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Workspace pages' })
    .getByRole('button', { name: 'Cut', exact: true })
    .click();
  await page.locator('[data-recording]').filter({ hasText: '4K AV1 gameplay' }).click();
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await page.getByRole('button', { name: 'Combined', exact: true }).click();
  // Keep Chromium rendering in this hidden test window.
  await app.evaluate(async ({ BrowserWindow }) => {
    await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, {
      stayHidden: true,
      stayAwake: true,
    });
  });
  await page.evaluate(() => {
    window.telemetry = {};
    const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      ...desc,
      set(value) {
        if (this.tagName === 'AUDIO')
          window.telemetry.audioSeeks = (window.telemetry.audioSeeks || 0) + 1;
        else window.telemetry.videoSeeks = (window.telemetry.videoSeeks || 0) + 1;
        desc.set.call(this, value);
      },
    });
  });
  for (const mode of ['workspace', 'bare']) {
    if (mode === 'bare')
      await page.evaluate(() => {
        const old = document.querySelector('video');
        old.pause();
        document.querySelectorAll('audio').forEach((a) => {
          a.pause();
          a.play = async () => {};
        });
        const v = document.createElement('video');
        v.muted = true;
        v.src = old.src;
        v.style.cssText = old.style.cssText;
        old.style.display = 'none';
        old.parentNode.append(v);
        v.dataset.benchmark = 'true';
      });
    const target = page.locator(
      mode === 'bare' ? 'video[data-benchmark]' : 'video:not([data-benchmark])',
    );
    await target.evaluate((v) => {
      v.pause();
      v.currentTime = 10;
    });
    await page.waitForFunction(
      (sel) => {
        const v = document.querySelector(sel);
        return v?.readyState >= 2 && !v.seeking;
      },
      mode === 'bare' ? 'video[data-benchmark]' : 'video:not([data-benchmark])',
    );
    for (const rate of [1, 4, 8, 16]) {
      await target.evaluate((v) => {
        v.pause();
        v.currentTime = 10;
      });
      await page.waitForTimeout(600);
      const result = await target.evaluate(
        async (v, { mode, rate }) => {
          window.telemetry = { audioSeeks: 0, videoSeeks: 0 };
          const events = {};
          const listen = (e) => (events[e.type] = (events[e.type] || 0) + 1);
          ['waiting', 'stalled', 'seeking', 'seeked', 'error', 'playing'].forEach((e) =>
            v.addEventListener(e, listen),
          );
          const start = performance.now(),
            initial = v.currentTime,
            quality = v.getVideoPlaybackQuality(),
            frames = [],
            samples = [];
          let cb;
          const frame = (now, meta) => {
            frames.push({ wall: now - start, time: meta.mediaTime });
            cb = v.requestVideoFrameCallback(frame);
          };
          cb = v.requestVideoFrameCallback(frame);
          const timer = setInterval(
            () =>
              samples.push({
                wall: performance.now() - start,
                time: v.currentTime,
                ready: v.readyState,
                seeking: v.seeking,
                paused: v.paused,
                error: v.error?.code,
              }),
            100,
          );
          v.playbackRate = rate;
          const play = v.play().catch((e) => e.message);
          await new Promise((r) => setTimeout(r, 5000));
          v.pause();
          clearInterval(timer);
          v.cancelVideoFrameCallback(cb);
          const end = v.getVideoPlaybackQuality();
          ['waiting', 'stalled', 'seeking', 'seeked', 'error', 'playing'].forEach((e) =>
            v.removeEventListener(e, listen),
          );
          return {
            mode,
            rate,
            advanced: v.currentTime - initial,
            frames: frames.length,
            maxFrameGap: Math.max(
              0,
              ...frames.map((f, i) => f.wall - (i ? frames[i - 1].wall : 0)),
              5000 - (frames.at(-1)?.wall || 0),
            ),
            dropped: end.droppedVideoFrames - quality.droppedVideoFrames,
            total: end.totalVideoFrames - quality.totalVideoFrames,
            events,
            ...window.telemetry,
            samples,
            frameTimes: frames,
            play: await play,
          };
        },
        { mode, rate },
      );
      results.push(result);
      console.log(JSON.stringify({ ...result, samples: undefined, frameTimes: undefined }));
    }
  }
} finally {
  await writeFile(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(dir);
  await app.close();
}
