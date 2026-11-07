// Why does the app fall short at 4× and 8× on H.264 proxies while a bare <video> keeps up?
// (VC-16, open since the October playback study: 3.5×, 5.4× and 7.7× in the app.)
//
// For each copied file it builds a throwaway project, opens it in the real app off-screen and
// measures 4× and 8× forward, changing one thing at a time:
//   app-ramp     the app's L key from 1× up (what Connor does, and what October measured)
//   app-direct   the app's own <video>, seek, then playbackRate and play() in one step
//   bare-*       a bare page in the same app session on the same media URL:
//                direct (October's bare player), ramp (1× → 2× → 4× → 8× without a seek),
//                attrs (the app's crossOrigin, preload, playsInline and object-fit stage),
//                throttled (backgroundThrottling left on, as in the app window)
// Each row records effective speed, "waiting" events, time spent below HAVE_FUTURE_DATA,
// frames painted and dropped, and GPU decode load. Use copies only; the GPU must be free.
//   node scripts/underflow-study.mjs <output folder> <file> [more files]
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { root, require, electronEnvironment } from './shared.mjs';

const [output, ...files] = process.argv.slice(2);
if (!output || !files.length) throw new Error('Usage: underflow-study.mjs <output> <file> [more]');
await mkdir(output, { recursive: true });
const { ProjectService } = require('../dist-electron/project-service.cjs');
const seconds = Number(process.env.VIRTUAL_CUT_SPEED_WINDOW || 4);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const gpu = [];
const smi = spawn('nvidia-smi', ['dmon', '-s', 'u', '-d', '1'], { windowsHide: true });
smi.on('error', () => {});
smi.stdout.on('data', (d) => {
  for (const line of String(d).split(/\r?\n/)) {
    const c = line.trim().split(/\s+/);
    if (/^\d+$/.test(c[0] || '') && c.length >= 5)
      gpu.push({ t: Date.now(), dec: Number(c[4]), sm: Number(c[1]) });
  }
});
const decodeDuring = (from, to) => {
  const s = gpu.filter((g) => g.t >= from + 1000 && g.t <= to);
  return s.length ? Math.round(s.reduce((a, g) => a + g.dec, 0) / s.length) : undefined;
};

async function project(file, dir) {
  const service = new ProjectService(path.join(dir, 'profile-svc'), path.join(dir, 'tools'));
  try {
    let p = await service.open(path.join(dir, 'underflow.vcut'), {
      name: 'Underflow study',
      destination: dir,
      cache: path.join(dir, 'cache'),
    });
    await service.importFiles(p.project.id, p.activeBatchId, [file], { game: 1, mic: 2 });
    for (const until = Date.now() + 300000; Date.now() < until;) {
      p = await service.snapshot();
      if (!p.jobs.some((j) => ['queued', 'running'].includes(j.state))) break;
      await wait(250);
    }
    return p.project.file;
  } finally {
    await service.close();
  }
}

// In-page probe, installed on any page with one <video>.
const install = () => {
  const v = document.querySelector('video');
  const s = (window.__u = { painted: 0, waiting: 0, low: 0, samples: 0 });
  const onFrame = () => {
    s.painted++;
    v.requestVideoFrameCallback(onFrame);
  };
  v.requestVideoFrameCallback(onFrame);
  v.addEventListener('waiting', () => s.waiting++);
  setInterval(() => {
    s.samples++;
    if (v.readyState < 3) s.low++;
  }, 20);
};
const begin = (page) =>
  page.evaluate(() => {
    const v = document.querySelector('video');
    const s = window.__u;
    const q = v.getVideoPlaybackQuality();
    Object.assign(s, { painted: 0, waiting: 0, low: 0, samples: 0 });
    s.start = { time: v.currentTime, at: performance.now(), dropped: q.droppedVideoFrames };
  });
const end = (page) =>
  page.evaluate(() => {
    const v = document.querySelector('video');
    const s = window.__u;
    const elapsed = (performance.now() - s.start.at) / 1000;
    return {
      effectiveSpeed: Number(((v.currentTime - s.start.time) / elapsed).toFixed(2)),
      waiting: s.waiting,
      belowFutureDataPercent: Math.round((100 * s.low) / Math.max(1, s.samples)),
      paintedPerSecond: Number((s.painted / elapsed).toFixed(1)),
      dropped: v.getVideoPlaybackQuality().droppedVideoFrames - s.start.dropped,
      rate: v.playbackRate,
      status: document.querySelector('[aria-label="Playback status"]')?.textContent || '',
    };
  });
async function measure(page, variant, rate, rows) {
  await wait(700);
  const from = Date.now();
  await begin(page);
  await wait(seconds * 1000);
  const r = await end(page);
  rows.push({ variant, requested: rate, ...r, gpuDecodePercent: decodeDuring(from, Date.now()) });
  console.log(JSON.stringify(rows.at(-1)));
}
// Seek to 60 s, then play at `rates` in turn: one rate means direct, several mean a ramp.
const playAt = (page, rates, step) =>
  page.evaluate(
    async ({ rates, step }) => {
      const v = document.querySelector('video');
      v.pause();
      v.currentTime = 60;
      await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
      for (const [i, rate] of rates.entries()) {
        v.playbackRate = rate;
        if (v.paused) await v.play();
        if (i < rates.length - 1) await new Promise((r) => setTimeout(r, step));
      }
    },
    { rates, step },
  );

const results = [];
for (const file of files) {
  const dir = await mkdtemp(path.join(output, 'run-'));
  const vcut = await project(file, dir);
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root, `--user-data-dir=${path.join(dir, 'profile')}`, '--background-test'],
    cwd: root,
    env: electronEnvironment({}),
  });
  const rows = [];
  try {
    const page = await app.firstWindow();
    await page.locator('[data-workflow]').waitFor();
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.setSkipTaskbar(true);
      w.setIgnoreMouseEvents(true);
      w.setFocusable(false);
      w.setPosition(-20000, -20000);
      w.setSize(1600, 1000);
      w.webContents.setAudioMuted(true);
      w.showInactive();
    });
    await app.evaluate(({ dialog }, f) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
    }, vcut);
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    await page.getByRole('button', { name: 'Open project file…', exact: true }).click();
    await page.locator('[data-recording]').first().waitFor();
    await page
      .getByRole('navigation', { name: 'Workspace pages' })
      .getByRole('button', { name: 'Cut', exact: true })
      .click();
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2, null, {
      timeout: 60000,
    });
    // Let the filmstrip finish so it doesn't share the decoder with the first rows.
    await page
      .waitForFunction(() => !document.body.textContent.includes('Loading filmstrip'), null, {
        timeout: 120000,
      })
      .catch(() => {});
    await page.evaluate(install);
    await page.evaluate(() => document.activeElement?.blur());
    const element = await page.evaluate(() => {
      const v = document.querySelector('video');
      const r = v.getBoundingClientRect();
      return {
        size: `${v.videoWidth}x${v.videoHeight}`,
        shown: `${Math.round(r.width)}x${Math.round(r.height)}`,
        muted: v.muted,
        audioElements: document.querySelectorAll('audio').length,
      };
    });
    // app-ramp: L from pause is 1×, then 2×, 4×, 6×, 8×.
    await page.evaluate(async () => {
      const v = document.querySelector('video');
      v.currentTime = 60;
      await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
    });
    for (const [presses, rate] of [
      [3, 4],
      [2, 8],
    ]) {
      for (let i = 0; i < presses; i++) await page.keyboard.press('l');
      await measure(page, 'app-ramp', rate, rows);
    }
    await page.keyboard.press('k');
    for (const rate of [4, 8]) {
      await playAt(page, [rate], 0);
      await measure(page, 'app-direct', rate, rows);
    }
    await page.keyboard.press('k');
    const src = await page.evaluate(() => document.querySelector('video').currentSrc);
    for (const bare of [
      { name: 'bare-direct', throttle: false, attrs: false, ramp: false },
      { name: 'bare-ramp', throttle: false, attrs: false, ramp: true },
      { name: 'bare-attrs', throttle: false, attrs: true, ramp: false },
      { name: 'bare-throttled', throttle: true, attrs: false, ramp: false },
    ]) {
      await app.evaluate(
        ({ BrowserWindow }, { src, bare }) => {
          const w = new BrowserWindow({
            width: 1600,
            height: 1000,
            show: false,
            webPreferences: { backgroundThrottling: bare.throttle },
          });
          const video = bare.attrs
            ? `<div style="position:relative;width:1180px;height:664px;background:#090e0d;display:flex"><video crossorigin="anonymous" playsinline preload="metadata" muted style="position:absolute;width:100%;height:100%;object-fit:contain;display:block" src="${src}"></video></div>`
            : `<video style="width:100%" muted src="${src}"></video>`;
          w.loadURL(
            'data:text/html,' +
              encodeURIComponent(`<body style="margin:0;background:#000">${video}</body>`),
          );
        },
        { src, bare },
      );
      const page2 = await app.waitForEvent('window');
      await page2.waitForFunction(() => document.querySelector('video')?.readyState >= 1, null, {
        timeout: 60000,
      });
      await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().at(-1);
        w.setSkipTaskbar(true);
        w.setIgnoreMouseEvents(true);
        w.setFocusable(false);
        w.setPosition(-20000, -20000);
        w.showInactive();
      });
      await page2.evaluate(install);
      for (const rate of [4, 8]) {
        await playAt(page2, bare.ramp ? [1, 2, rate] : [rate], 700);
        await measure(page2, bare.name, rate, rows);
      }
      await page2.close();
    }
    results.push({ file: path.basename(file), element, rows });
  } catch (error) {
    results.push({ file: path.basename(file), error: String(error.stack || error), rows });
  } finally {
    await app.close().catch(() => {});
  }
  await writeFile(path.join(output, 'underflow.json'), JSON.stringify(results, null, 2));
}
smi.kill();
