import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright/test';
import { root, require, electronEnvironment } from './shared.mjs';
const scratch = 'G:/GPT/Work/virtual-cut/transport-investigation';
const fixture = JSON.parse(await readFile(path.join(scratch, 'latest-fixture.json'), 'utf8'));
const dir = await mkdtemp(path.join(scratch, 'delivery-'));
const html = path.join(dir, 'player.html');
await writeFile(
  html,
  '<!doctype html><title>Playback delivery diagnostic</title><video muted style="width:1280px;height:720px"></video>',
);
const app = await electron.launch({
  executablePath: require('electron'),
  args: [
    root,
    `--user-data-dir=${path.join(dir, 'profile')}`,
    '--background-test',
    '--enable-blink-features=AudioVideoTracks',
  ],
  cwd: root,
  env: electronEnvironment({ TEMP: 'G:/GPT/Temp', TMP: 'G:/GPT/Temp' }),
});
const page = await app.firstWindow();
const results = [];
try {
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, fixture.file);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await page.locator('[data-recording]').filter({ hasText: '4K AV1 gameplay' }).click();
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  const mediaUrl = await page.locator('video').getAttribute('src');
  const fileUrl = pathToFileURL(fixture.source).href;
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
  const cdp = await harness.context().newCDPSession(harness);
  const mediaLog = [];
  for (const event of ['playerPropertiesChanged', 'playerErrorsRaised', 'playerEventsAdded'])
    cdp.on('Media.' + event, (data) => mediaLog.push({ event, ...data }));
  await cdp.send('Media.enable');
  for (const mode of ['file-noaudio', 'custom-noaudio', 'native-fetch']) {
    if (mode === 'native-fetch')
      await app.evaluate(
        ({ protocol, net }, { mediaUrl, fileUrl }) => {
          protocol.unhandle('media');
          protocol.handle('media', (req) =>
            req.url === mediaUrl
              ? net.fetch(fileUrl, { method: req.method, headers: req.headers })
              : new Response(null, { status: 404 }),
          );
        },
        { mediaUrl, fileUrl },
      );
    const result = await harness.evaluate(
      async ({ mode, url }) => {
        const v = document.querySelector('video');
        v.src = url;
        v.load();
        await new Promise((r, j) => {
          v.onloadeddata = r;
          v.onerror = () => j(v.error.message);
        });
        const tracks = v.audioTracks?.length;
        if (mode.endsWith('noaudio'))
          for (const track of v.audioTracks || []) track.enabled = false;
        const events = {},
          samples = [],
          frames = [];
        const start = performance.now();
        const listen = (e) => (events[e.type] = (events[e.type] || 0) + 1);
        ['waiting', 'stalled', 'playing', 'error'].forEach((e) => v.addEventListener(e, listen));
        let cb;
        const frame = (now, m) => {
          frames.push({ wall: now - start, time: m.mediaTime });
          cb = v.requestVideoFrameCallback(frame);
        };
        cb = v.requestVideoFrameCallback(frame);
        const timer = setInterval(
          () =>
            samples.push({
              wall: performance.now() - start,
              time: v.currentTime,
              ready: v.readyState,
              buffered: Array.from({ length: v.buffered.length }, (_, i) => [
                v.buffered.start(i),
                v.buffered.end(i),
              ]),
            }),
          100,
        );
        v.playbackRate = 16;
        const playing = v.play().catch((e) => e.message);
        await new Promise((r) => setTimeout(r, 8000));
        v.pause();
        clearInterval(timer);
        v.cancelVideoFrameCallback(cb);
        ['waiting', 'stalled', 'playing', 'error'].forEach((e) => v.removeEventListener(e, listen));
        return {
          mode,
          tracks,
          time: v.currentTime,
          events,
          frames: frames.length,
          quality: JSON.parse(JSON.stringify(v.getVideoPlaybackQuality())),
          samples,
          frameTimes: frames,
          play: await playing,
        };
      },
      { mode, url: mode.startsWith('file') ? fileUrl : mediaUrl },
    );
    results.push(result);
    console.log(JSON.stringify({ ...result, samples: undefined, frameTimes: undefined }));
  }
  await writeFile(path.join(dir, 'media-log.json'), JSON.stringify(mediaLog, null, 2));
  await writeFile(
    path.join(dir, 'gpu.json'),
    JSON.stringify(await app.evaluate(({ app }) => app.getGPUInfo('complete')), null, 2),
  );
} finally {
  await writeFile(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(dir);
  await app.close();
}
