// Isolated decoder/audio-sync experiment. This does not add a product speed step
// or assert that pitch-preserved speech at 6x is comfortable to listen to.
import { readFile, writeFile, mkdtemp, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { root, require, electronEnvironment } from './shared.mjs';
const scratch = 'G:/GPT/Work/virtual-cut/transport-investigation';
const fixture = JSON.parse(await readFile(path.join(scratch, 'latest-fixture.json'), 'utf8'));
const dir = await mkdtemp(path.join(scratch, 'six-speed-'));
const file = path.join(dir, 'study.vcut');
await copyFile(fixture.file, file);
const html = path.join(dir, 'study.html');
await writeFile(
  html,
  '<!doctype html><title>Audio speed study</title><video muted style="width:1280px;height:720px"></video>',
);
const app = await electron.launch({
  executablePath: require('electron'),
  args: [root, `--user-data-dir=${path.join(dir, 'profile')}`, '--background-test'],
  cwd: root,
  env: electronEnvironment({ TEMP: 'G:/GPT/Temp', TMP: 'G:/GPT/Temp' }),
});
const results = [];
try {
  const page = await app.firstWindow();
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, file);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await page.locator('[data-recording]').filter({ hasText: '4K AV1 gameplay' }).click();
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  const source = await page.evaluate(async () => {
    const p = await window.virtualCut.project.current();
    const r = p.model.recordings.find((r) => r.title === '4K AV1 gameplay');
    return {
      url: r.url,
      offset: Math.max(0, r.sourceStart || 0),
      tracks: r.audioTracks.map((t) => ({ url: t.previewUrl, offset: t.offset })),
    };
  });
  await app.evaluate(async ({ BrowserWindow }, html) => {
    const w = new BrowserWindow({
      show: false,
      width: 1280,
      height: 720,
      webPreferences: {
        offscreen: true,
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    w.webContents.setAudioMuted(true);
    w.webContents.setFrameRate(60);
    await w.loadFile(html);
  }, html);
  const harness = app.windows().at(-1);
  const cdp = await harness.context().newCDPSession(harness),
    mediaLog = [];
  for (const event of ['playerErrorsRaised', 'playerEventsAdded'])
    cdp.on('Media.' + event, (data) => mediaLog.push({ event, ...data }));
  await cdp.send('Media.enable');
  for (const [rate, withAudio] of [
    [4, true],
    [6, true],
    [6, false],
    [8, true],
    [6, true],
  ]) {
    const result = await harness.evaluate(
      async ({ source, rate, withAudio }) => {
        const v = document.querySelector('video');
        document.querySelectorAll('audio').forEach((a) => a.remove());
        const audio = withAudio
          ? source.tracks.map((t) => {
              const a = document.createElement('audio');
              a.src = t.url;
              document.body.append(a);
              return { a, offset: t.offset };
            })
          : [];
        const ready = (m) =>
          new Promise((resolve, reject) => {
            m.onloadeddata = resolve;
            m.onerror = () => reject(new Error(m.error?.message || 'Media unavailable'));
          });
        const loaded = ready(v);
        v.src = source.url;
        v.load();
        await Promise.all([loaded, ...audio.map(({ a }) => ready(a))]);
        const seek = (m, t) =>
          new Promise((resolve) => {
            m.addEventListener('seeked', resolve, { once: true });
            m.currentTime = t;
          });
        await Promise.all([
          seek(v, 10 + source.offset),
          ...audio.map(({ a, offset }) => seek(a, 10 - offset)),
        ]);
        v.playbackRate = rate;
        audio.forEach(({ a }) => {
          a.playbackRate = rate;
          a.preservesPitch = true;
        });
        const events = {},
          samples = [],
          frames = [];
        let corrections = 0;
        const last = new Map(),
          starting = new Set();
        const listen = (e) => {
          events[e.type] = (events[e.type] || 0) + 1;
        };
        ['waiting', 'stalled', 'error'].forEach((e) => v.addEventListener(e, listen));
        const begin = performance.now();
        let callback;
        const frame = (now, m) => {
          frames.push({ wall: now - begin, time: m.mediaTime });
          callback = v.requestVideoFrameCallback(frame);
        };
        callback = v.requestVideoFrameCallback(frame);
        const timer = setInterval(() => {
          for (const { a, offset } of audio) {
            const t = v.currentTime - source.offset - offset;
            if (v.paused || v.seeking || t < 0 || t >= a.duration) {
              a.pause();
              continue;
            }
            if (a.seeking) continue;
            if (
              Math.abs(a.currentTime - t) > 0.12 * rate &&
              performance.now() - (last.get(a) || -Infinity) > 350
            ) {
              a.currentTime = t;
              corrections++;
              last.set(a, performance.now());
            }
            if (a.paused && !starting.has(a)) {
              starting.add(a);
              void a
                .play()
                .catch(() => {})
                .finally(() => starting.delete(a));
            }
          }
          samples.push({
            wall: performance.now() - begin,
            time: v.currentTime,
            ready: v.readyState,
            audio: audio.map(({ a, offset }) => ({
              paused: a.paused,
              error: a.error?.code,
              delta: a.currentTime - (v.currentTime - source.offset - offset),
            })),
          });
        }, 50);
        await v.play();
        await new Promise((r) => setTimeout(r, 12000));
        v.pause();
        audio.forEach(({ a }) => a.pause());
        clearInterval(timer);
        v.cancelVideoFrameCallback(callback);
        ['waiting', 'stalled', 'error'].forEach((e) => v.removeEventListener(e, listen));
        const quality = v.getVideoPlaybackQuality();
        return {
          rate,
          withAudio,
          elapsed: (performance.now() - begin) / 1000,
          advanced: v.currentTime - source.offset - 10,
          corrections,
          events,
          frames: frames.length,
          maxPresentationGapMs: Math.max(
            ...frames.map((f, i) => (i ? f.wall - frames[i - 1].wall : 0)),
          ),
          quality: { total: quality.totalVideoFrames, dropped: quality.droppedVideoFrames },
          samples,
        };
      },
      { source, rate, withAudio },
    );
    results.push(result);
    console.log(JSON.stringify({ ...result, samples: undefined }));
  }
  await writeFile(path.join(dir, 'media-log.json'), JSON.stringify(mediaLog, null, 2));
} finally {
  await writeFile(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(dir);
  await app.close();
}
