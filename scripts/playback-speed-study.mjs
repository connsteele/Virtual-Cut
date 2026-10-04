// Measure preview playback at each J/K/L speed on a real project (VC-43, VC-48, rewind spike).
//
// For forward 1×–16× and reverse 1×–16× it records, per speed: frames actually painted per
// second (requestVideoFrameCallback), distinct source frames shown, dropped frames, how far the
// playhead moved relative to the requested speed, seek latency for scan modes, which mode the
// player used (native or scan), and GPU decode load from nvidia-smi when available. A bare
// <video> page plays the same file at the same rates to separate decoder limits from app work.
//
// The window is shown off-screen without focus or a taskbar entry so Chromium composites it
// like a visible window; it never appears on the desktop. Use copies of recordings only.
//   node scripts/playback-speed-study.mjs <project.vcut> <output folder> [label]
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { root, require, electronEnvironment } from './shared.mjs';

const [project, outputRoot, label = 'source'] = process.argv.slice(2);
if (!project || !outputRoot)
  throw new Error('Usage: playback-speed-study.mjs <project.vcut> <output> [label]');
await mkdir(outputRoot, { recursive: true });
const dir = await mkdtemp(path.join(outputRoot, `${label}-`));
const seconds = Number(process.env.VIRTUAL_CUT_SPEED_WINDOW || 4);

// GPU decode utilization, one sample per second, when nvidia-smi exists.
const gpu = [];
let smi;
try {
  smi = spawn('nvidia-smi', ['dmon', '-s', 'u', '-d', '1'], { windowsHide: true });
  smi.stdout.on('data', (d) => {
    for (const line of String(d).split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/);
      if (/^\d+$/.test(cols[0] || '') && cols.length >= 5)
        gpu.push({ t: Date.now(), sm: Number(cols[1]), dec: Number(cols[4]) });
    }
  });
  smi.on('error', () => {});
} catch {
  /* No NVIDIA tools: decode load is reported as unavailable. */
}
const gpuDuring = (from, to) => {
  const s = gpu.filter((g) => g.t >= from && g.t <= to + 500);
  if (!s.length) return undefined;
  return {
    decodePercent: Math.round(s.reduce((a, g) => a + g.dec, 0) / s.length),
    shaderPercent: Math.round(s.reduce((a, g) => a + g.sm, 0) / s.length),
  };
};

const app = await electron.launch({
  executablePath: process.env.VIRTUAL_CUT_TEST_EXECUTABLE || require('electron'),
  args: [
    ...(process.env.VIRTUAL_CUT_TEST_EXECUTABLE ? [] : [root]),
    `--user-data-dir=${path.join(dir, 'profile')}`,
    '--background-test',
  ],
  cwd: root,
  env: electronEnvironment({}),
});
const showOffscreen = (index) =>
  app.evaluate(({ BrowserWindow }, index) => {
    const w = BrowserWindow.getAllWindows()[index];
    w.setSkipTaskbar(true);
    w.setIgnoreMouseEvents(true);
    w.setFocusable(false);
    w.setPosition(-20000, -20000);
    w.setSize(1600, 1000);
    w.webContents.setAudioMuted(true);
    w.showInactive();
  }, index);

// In-page probe: counts painted frames and distinct media times, and times seeks.
const probe = () => {
  const v = document.querySelector('video');
  const s = (window.__speed = { painted: 0, media: new Set(), seeks: [], seekStart: 0, times: [] });
  const onFrame = (now, meta) => {
    s.painted++;
    s.times.push(now);
    s.media.add(Math.round(meta.mediaTime * 1000));
    v.requestVideoFrameCallback(onFrame);
  };
  v.requestVideoFrameCallback(onFrame);
  v.addEventListener('seeking', () => (s.seekStart = performance.now()));
  v.addEventListener('seeked', () => s.seekStart && s.seeks.push(performance.now() - s.seekStart));
};
const begin = (page) =>
  page.evaluate(() => {
    const v = document.querySelector('video');
    const s = window.__speed;
    s.painted = 0;
    s.media = new Set();
    s.seeks = [];
    s.times = [];
    const q = v.getVideoPlaybackQuality();
    s.start = {
      time: v.currentTime,
      dropped: q.droppedVideoFrames,
      total: q.totalVideoFrames,
      at: performance.now(),
    };
  });
const end = (page) =>
  page.evaluate(() => {
    const v = document.querySelector('video');
    const s = window.__speed;
    const q = v.getVideoPlaybackQuality();
    const elapsed = (performance.now() - s.start.at) / 1000;
    const seeks = s.seeks.slice().sort((a, b) => a - b);
    const gaps = s.times
      .slice(1)
      .map((t, i) => t - s.times[i])
      .sort((a, b) => a - b);
    const pct = (p) =>
      gaps.length
        ? Math.round(gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))])
        : undefined;
    return {
      gapMedianMs: pct(0.5),
      gapP95Ms: pct(0.95),
      gapMaxMs: gaps.length ? Math.round(gaps.at(-1)) : undefined,
      stutters: gaps.filter((g) => g > 50).length,
      paintedPerSecond: Number((s.painted / elapsed).toFixed(1)),
      distinctFramesPerSecond: Number((s.media.size / elapsed).toFixed(1)),
      dropped: q.droppedVideoFrames - s.start.dropped,
      decodedFrames: q.totalVideoFrames - s.start.total,
      effectiveSpeed: Number(((v.currentTime - s.start.time) / elapsed).toFixed(2)),
      seeks: seeks.length,
      seekMedianMs: seeks.length ? Math.round(seeks[Math.floor(seeks.length / 2)]) : undefined,
      status: document.querySelector('[aria-label="Playback status"]')?.textContent || '',
    };
  });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function measure(page, name, settleMs = 700) {
  await wait(settleMs);
  const from = Date.now();
  await begin(page);
  await wait(seconds * 1000);
  const result = await end(page);
  return { speed: name, ...result, gpu: gpuDuring(from, Date.now()) };
}

const results = { label, project, seconds, app: { forward: [], reverse: [] }, bare: [] };
try {
  const page = await app.firstWindow();
  await page.locator('[data-workflow]').waitFor();
  await showOffscreen(0);
  results.gpuFeatures = await app.evaluate(({ app }) => app.getGPUFeatureStatus());
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, project);
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
  results.decodeSupport = await page.evaluate(async () => {
    const v = document.querySelector('video');
    const info = await navigator.mediaCapabilities.decodingInfo({
      type: 'file',
      video: {
        contentType: 'video/mp4; codecs="av01.0.12M.08"',
        width: v.videoWidth,
        height: v.videoHeight,
        bitrate: 20e6,
        framerate: 60,
      },
    });
    return {
      width: v.videoWidth,
      height: v.videoHeight,
      smooth: info.smooth,
      powerEfficient: info.powerEfficient,
    };
  });
  await page.evaluate(probe);
  const seek = (t) =>
    page.evaluate(async (t) => {
      const v = document.querySelector('video');
      v.currentTime = t;
      await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
    }, t);
  const key = (k) => page.keyboard.press(k);
  await page.evaluate(() => document.activeElement?.blur());
  // Forward: L from pause starts 1×, then steps up through the app's speeds.
  const speeds = [1, 2, 4, 6, 8, 16];
  await seek(60);
  for (const rate of speeds) {
    await key('l');
    results.app.forward.push(await measure(page, `${rate}×`));
  }
  await key('k');
  // Reverse: J starts 1× reverse and uses the same steps.
  await seek(420);
  for (const rate of speeds) {
    await key('j');
    results.app.reverse.push(await measure(page, `${rate}×`));
  }
  await key('k');
  // A bare video element in its own window: native playbackRate only, no app code.
  const file = await page.evaluate(() => document.querySelector('video').currentSrc);
  await app.evaluate(({ BrowserWindow }, src) => {
    const w = new BrowserWindow({
      width: 1600,
      height: 1000,
      show: false,
      webPreferences: { backgroundThrottling: false },
    });
    w.loadURL(
      'data:text/html,' +
        encodeURIComponent(
          `<body style="margin:0;background:#000"><video style="width:100%" muted src="${src}"></video></body>`,
        ),
    );
  }, file);
  const bare = await app.waitForEvent('window');
  await bare
    .waitForFunction(() => document.querySelector('video')?.readyState >= 2, null, {
      timeout: 60000,
    })
    .catch(() => {});
  if (await bare.evaluate(() => document.querySelector('video')?.readyState >= 2)) {
    await showOffscreen(1);
    await bare.evaluate(probe);
    for (const rate of [1, 2, 4, 6, 8, 16]) {
      await bare.evaluate(async (rate) => {
        const v = document.querySelector('video');
        v.currentTime = 60;
        await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
        v.playbackRate = rate;
        await v.play();
      }, rate);
      results.bare.push(await measure(bare, `${rate}×`));
      await bare.evaluate(() => document.querySelector('video').pause());
    }
    // Reverse without the app's 83 ms timer: seek again as soon as each seek lands, always to
    // the exact frame the wall clock asks for (what a timer-free reverse scan could reach).
    results.bareReverse = [];
    for (const rate of [1, 2, 4, 6, 8, 16]) {
      await bare.evaluate(async (rate) => {
        const v = document.querySelector('video');
        v.pause();
        v.currentTime = 420;
        await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
        const origin = v.currentTime,
          started = performance.now();
        window.__reverseStop = false;
        const step = () => {
          if (window.__reverseStop) return;
          v.currentTime = Math.max(0, origin - (rate * (performance.now() - started)) / 1000);
        };
        v.onseeked = step;
        step();
      }, rate);
      results.bareReverse.push(await measure(bare, `${rate}×`, 300));
      await bare.evaluate(() => {
        window.__reverseStop = true;
        document.querySelector('video').onseeked = null;
      });
    }
  } else results.bare = 'The bare page could not load the app media URL.';
} finally {
  await app.close().catch(() => {});
  smi?.kill();
}
await writeFile(path.join(dir, 'playback-speed.json'), JSON.stringify(results, null, 2));
const table = (rows) =>
  rows
    .map(
      (r) =>
        `${r.speed.padStart(4)} painted ${String(r.paintedPerSecond).padStart(5)}/s gaps p50 ${r.gapMedianMs}ms p95 ${r.gapP95Ms}ms max ${r.gapMaxMs}ms stutters ${r.stutters} dropped ${String(r.dropped).padStart(4)} speed ${String(r.effectiveSpeed).padStart(6)} seeks ${String(r.seeks).padStart(3)}${r.seekMedianMs != null ? ` (${r.seekMedianMs} ms)` : ''} dec ${r.gpu?.decodePercent ?? '-'}% "${r.status || ''}"`,
    )
    .join('\n');
console.log(
  `== ${label}: app forward\n${table(results.app.forward)}\n== app reverse\n${table(results.app.reverse)}`,
);
if (Array.isArray(results.bare)) console.log(`== bare video forward\n${table(results.bare)}`);
if (results.bareReverse)
  console.log(`== bare reverse, back-to-back exact seeks\n${table(results.bareReverse)}`);
console.log(`decode support ${JSON.stringify(results.decodeSupport)}; report ${dir}`);
