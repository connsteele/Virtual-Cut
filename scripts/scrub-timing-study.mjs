// Time timeline scrubbing on a real project (VC-202): pointer-to-frame time and frames shown per
// second of drag, the time to the exact frame when the pointer rests and after release, seeks
// started against seeks completed, main-thread long tasks, and GPU decode load.
//
// Each round drags the playhead slowly (about 50 px/s), then fast (about 600 px/s), rests for a
// second, then moves a little and releases. Pointer moves come every 16 ms like a mouse. Rounds
// start at different places so the decoder never has the frames cached.
//
// The window is shown off-screen without focus or a taskbar entry; it never appears on the
// desktop. Use copies of recordings only. Check that nothing else is using the GPU first.
//   node scripts/scrub-timing-study.mjs <project.vcut> <output folder> [label]
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { root, require, electronEnvironment } from './shared.mjs';

const [project, outputRoot, label = 'scrub'] = process.argv.slice(2);
if (!project || !outputRoot)
  throw new Error('Usage: scrub-timing-study.mjs <project.vcut> <output> [label]');
await mkdir(outputRoot, { recursive: true });
const dir = await mkdtemp(path.join(outputRoot, `${label}-`));
const rounds = Number(process.env.VIRTUAL_CUT_SCRUB_ROUNDS || 3);
const zoomSteps = Number(process.env.VIRTUAL_CUT_SCRUB_ZOOM || 0);
// Keyframe spacing of the recording in seconds: a keyframe seek lands within half of it.
const gop = Number(process.env.VIRTUAL_CUT_SCRUB_GOP || 1);

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

// In-page probe: every presented video frame, seek events, long tasks and the scrub tile.
const probe = () => {
  const v = document.querySelector('video');
  const s = (window.__scrub = {
    frames: [],
    seeking: 0,
    seeked: 0,
    longTaskMs: 0,
    tile: [],
  });
  const onFrame = (now, meta) => {
    s.frames.push({ at: now, media: meta.mediaTime });
    v.requestVideoFrameCallback(onFrame);
  };
  v.requestVideoFrameCallback(onFrame);
  v.addEventListener('seeking', () => s.seeking++);
  v.addEventListener('seeked', () => s.seeked++);
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) s.longTaskMs += e.duration;
  }).observe({ type: 'longtask', buffered: false });
  // The fixed viewer shows the nearest filmstrip tile while the decoder catches up.
  const stage = document.querySelector('[data-video-stage]');
  let shown = false;
  new MutationObserver(() => {
    const now = !!stage.querySelector('[data-scrub-tile]');
    if (now !== shown) s.tile.push({ at: performance.now(), shown: (shown = now) });
  }).observe(stage, { childList: true, subtree: true, attributes: true });
};
const reset = (page) =>
  page.evaluate(() => {
    const s = window.__scrub;
    s.frames = [];
    s.seeking = 0;
    s.seeked = 0;
    s.longTaskMs = 0;
    s.tile = [];
  });
const collect = (page) => page.evaluate(() => window.__scrub);
const now = (page) => page.evaluate(() => performance.now());

const quantile = (values, p) => {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]);
};
const median = (values) => quantile(values, 0.5);

const results = { label, project, rounds, zoomSteps, gop, runs: [] };
try {
  const page = await app.firstWindow();
  await page.locator('[data-workflow]').waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSkipTaskbar(true);
    w.setFocusable(false);
    w.setPosition(-20000, -20000);
    w.setSize(1600, 1000);
    w.webContents.setAudioMuted(true);
    w.showInactive();
  });
  results.gpuFeatures = await app.evaluate(({ app }) => app.getGPUFeatureStatus());
  results.gpuVideoDecode = await app.evaluate(async ({ app }) => {
    const info = await app.getGPUInfo('complete');
    const profiles =
      info.videoDecodeAcceleratorSupportedProfile ||
      info.videoDecodeAcceleratorCapabilities ||
      info.auxAttributes?.videoDecodeAcceleratorSupportedProfile;
    return {
      av1Profiles: JSON.stringify(profiles || null).match(/AV1[^"]*/gi) || [],
      device: info.gpuDevice?.[0] && {
        vendorId: info.gpuDevice[0].vendorId,
        driver: info.gpuDevice[0].driverVersion,
      },
    };
  });
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
  for (let i = 0; i < zoomSteps; i++)
    await page.getByRole('button', { name: 'Zoom in timeline', exact: true }).click();
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
  const surface = page.getByTestId('scrub-surface');
  const view = () =>
    surface.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        width: r.width,
        top: r.top,
        start: +el.dataset.viewStart,
        end: +el.dataset.viewEnd,
      };
    });
  // Frame timing of the recording, for "exact frame" checks.
  const fps = await page.evaluate(() => {
    const m = /Source ([\d.]+) fps/.exec(
      document.querySelector('[data-video-stage]')?.parentElement?.textContent || '',
    );
    return m ? Number(m[1]) : 60;
  });
  results.fps = fps;
  const frameTolerance = 0.75 / fps;
  await page.evaluate(probe);
  await page.evaluate(() => document.activeElement?.blur());
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const box = await view();
  // Drag on the time ruler, which is always a seek surface (clips and markers sit lower).
  const y = await page.evaluate(() => {
    const r = document.querySelector('[data-seek-surface="ruler"]').getBoundingClientRect();
    return r.top + r.height / 2;
  });
  const secondsPerPixel = (box.end - box.start) / box.width;
  results.secondsPerPixel = Number(secondsPerPixel.toFixed(3));
  const targetAt = (x) =>
    box.start + Math.max(0, Math.min(1, (x - box.left) / box.width)) * (box.end - box.start);

  // Moves the pointer in 16 ms steps; returns [{at (page clock), target}] per move.
  async function drag(from, to, ms) {
    const moves = [];
    const steps = Math.max(1, Math.round(ms / 16));
    const t0 = Date.now();
    for (let i = 1; i <= steps; i++) {
      const x = from + ((to - from) * i) / steps;
      const at = await now(page);
      await page.mouse.move(x, y);
      moves.push({ at, target: targetAt(x) });
      const due = t0 + i * 16 - Date.now();
      if (due > 0) await wait(due);
    }
    return moves;
  }
  // Pointer-to-frame: for each shown frame, the time since the pointer first asked for that
  // picture on its latest visit (the first of the latest run of moves whose exact frame, or
  // nearest keyframe, it is). Frames that match no move (stale or in between) are not timed.
  function lagFor(frames, moves, from, to) {
    const lags = [];
    const shown = frames.filter((f) => f.at >= from && f.at <= to);
    for (const f of shown) {
      let best, run;
      for (const m of moves) {
        if (m.at > f.at) break;
        // Keyframes sit on whole multiples of the spacing from 0 (true of OBS and our encodes).
        const key = Math.round(m.target / gop) * gop;
        const exact = f.media <= m.target + frameTolerance && m.target - f.media < 1 / fps;
        if (exact || Math.abs(f.media - key) <= frameTolerance) best = run ??= m;
        else run = undefined;
      }
      if (best) lags.push(f.at - best.at);
    }
    const distinct = new Set(shown.map((f) => Math.round(f.media * 1000))).size;
    // Waits between new pictures while the pointer moves (start of the phase to the first).
    const stamps = [from, ...shown.map((f) => f.at), to];
    const gaps = stamps.slice(1).map((t, i) => t - stamps[i]);
    return {
      gapMedianMs: median(gaps),
      gapP95Ms: quantile(gaps, 0.95),
      gapMaxMs: Math.round(Math.max(...gaps)),
      framesShown: shown.length,
      distinctFramesPerSecond: Number((distinct / ((to - from) / 1000)).toFixed(1)),
      matched: lags.length,
      lagMedianMs: median(lags),
      lagP95Ms: quantile(lags, 0.95),
      // How far, in footage seconds, each shown frame is from where the pointer is right then.
      offsetMedianS: (() => {
        const offs = shown
          .map((f) => {
            const last = [...moves].reverse().find((m) => m.at <= f.at);
            return last ? Math.abs(f.media - last.target) : undefined;
          })
          .filter((v) => v !== undefined);
        const sorted = offs.sort((a, b) => a - b);
        return sorted.length ? Number(sorted[Math.floor(sorted.length / 2)].toFixed(2)) : undefined;
      })(),
    };
  }
  // Time until the exact frame for `target` is shown, after `since`.
  async function exactAfter(target, since, timeoutMs = 4000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const s = await collect(page);
      const hit = s.frames.find(
        (f) => f.at >= since && f.media <= target + frameTolerance && target - f.media < 1 / fps,
      );
      if (hit) return Math.round(hit.at - since);
      await wait(20);
    }
    return null;
  }
  for (let round = 0; round < rounds; round++) {
    const startFrac = 0.15 + 0.25 * round;
    const x0 = box.left + box.width * startFrac;
    await page.mouse.move(x0, y);
    await wait(600);
    await reset(page);
    const wallFrom = Date.now();
    const downAt = await now(page);
    await page.mouse.down();
    const slow = await drag(x0, x0 + 200, 4000);
    const slowEnd = await now(page);
    const fast = await drag(x0 + 200, x0 + 200 - 600 * 0.5, 500);
    const fastEnd = await now(page);
    // Rest: the pointer stays still.
    const restTarget = fast.at(-1).target;
    const rest = await exactAfter(restTarget, fastEnd, 3000);
    await wait(Math.max(0, 1000 - (rest ?? 1000)));
    // Release a little further on, without resting.
    const release = await drag(x0 - 100, x0 - 60, 64);
    const upAt = await now(page);
    await page.mouse.up();
    const released = await exactAfter(release.at(-1).target, upAt, 4000);
    await wait(400);
    const s = await collect(page);
    const wallTo = Date.now();
    const tileShows = s.tile.filter((t) => t.shown).length;
    results.runs.push({
      round,
      startSeconds: Number(targetAt(x0).toFixed(2)),
      slow: lagFor(s.frames, slow, downAt, slowEnd),
      fast: lagFor(s.frames, fast, slowEnd, fastEnd),
      restToExactMs: rest,
      restTarget: Number(restTarget.toFixed(3)),
      lastShown: Number((s.frames.at(-1)?.media ?? NaN).toFixed(3)),
      releaseToExactMs: released,
      seeksStarted: s.seeking,
      seeksCompleted: s.seeked,
      seeksAbandoned: s.seeking - s.seeked,
      longTaskMs: Math.round(s.longTaskMs),
      tileShows,
      gpu: gpuDuring(wallFrom, wallTo),
    });
    console.log(JSON.stringify(results.runs.at(-1)));
  }
  const pick = (f) => median(results.runs.map(f).filter((v) => v != null));
  results.summary = {
    slowDistinctFps: pick((r) => r.slow.distinctFramesPerSecond * 10) / 10,
    slowLagMedianMs: pick((r) => r.slow.lagMedianMs),
    slowLagP95Ms: pick((r) => r.slow.lagP95Ms),
    slowGapMedianMs: pick((r) => r.slow.gapMedianMs),
    slowGapMaxMs: pick((r) => r.slow.gapMaxMs),
    fastGapMaxMs: pick((r) => r.fast.gapMaxMs),
    fastOffsetMedianS: pick((r) => r.fast.offsetMedianS * 100) / 100,
    fastDistinctFps: pick((r) => r.fast.distinctFramesPerSecond * 10) / 10,
    fastLagMedianMs: pick((r) => r.fast.lagMedianMs),
    restToExactMs: pick((r) => r.restToExactMs),
    releaseToExactMs: pick((r) => r.releaseToExactMs),
    seeksStarted: pick((r) => r.seeksStarted),
    seeksAbandoned: pick((r) => r.seeksAbandoned),
    longTaskMs: pick((r) => r.longTaskMs),
    decodePercent: pick((r) => r.gpu?.decodePercent),
  };
  console.log(JSON.stringify({ summary: results.summary, decode: results.decodeSupport }));
} finally {
  smi?.kill();
  await writeFile(path.join(dir, 'scrub-timing.json'), JSON.stringify(results, null, 2));
  await app.close().catch(() => {});
  console.log(`Wrote ${path.join(dir, 'scrub-timing.json')}`);
}
