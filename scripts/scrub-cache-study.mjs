// Time scrubbing from a WebCodecs frame cache (VC-202 three-way timing, VC-147) with the same
// drag as scrub-timing-study.mjs, in an off-screen window opened by the app in test mode (never
// shown on the desktop, audio muted). Use copies of recordings only.
//   node scripts/scrub-cache-study.mjs <video copy> <output folder> [seconds per pixel] [starts]
// Seconds per pixel and the comma-separated start times come from a scrub-timing-study run, so
// both drags cover the same footage.
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { root, require, electronEnvironment } from './shared.mjs';

const [file, outputRoot, spp = '0.97', starts = '147.78,394.09,640.39'] = process.argv.slice(2);
if (!file || !outputRoot)
  throw new Error('Usage: scrub-cache-study.mjs <video copy> <output> [s/px] [starts]');
await mkdir(outputRoot, { recursive: true });
const dir = await mkdtemp(path.join(outputRoot, 'cache-'));
const app = await electron.launch({
  executablePath: require('electron'),
  args: [root, `--user-data-dir=${path.join(dir, 'profile')}`, '--background-test'],
  cwd: root,
  env: electronEnvironment({}),
});
const results = { file: path.resolve(file), secondsPerPixel: Number(spp), runs: [] };
try {
  await app.firstWindow();
  await app.evaluate(
    ({ BrowserWindow }, page) => {
      const w = new BrowserWindow({
        width: 1600,
        height: 900,
        show: false,
        skipTaskbar: true,
        focusable: false,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
          sandbox: false,
          backgroundThrottling: false,
        },
      });
      w.setIgnoreMouseEvents(true);
      w.setPosition(-20000, -20000);
      w.webContents.setAudioMuted(true);
      w.loadFile(page).then(() => w.showInactive());
    },
    path.join(root, 'scripts', 'reverse-cache-study.html'),
  );
  const page = await app.waitForEvent('window');
  await page.waitForFunction(() => typeof window.scrubFromCache === 'function');
  for (const start of starts.split(',').map(Number)) {
    const r = await page.evaluate(
      ([f, s, spp]) => window.scrubFromCache(f, s, spp),
      [path.resolve(file), start, Number(spp)],
    );
    results.runs.push({ start, ...r });
    console.log(JSON.stringify(results.runs.at(-1)));
  }
  const median = (f) => {
    const v = results.runs
      .map(f)
      .filter((x) => x != null)
      .sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  };
  results.summary = {
    slowDistinctFps: median((r) => r.slow.distinctFramesPerSecond),
    slowGapMedianMs: median((r) => r.slow.gapMedianMs),
    slowGapMaxMs: median((r) => r.slow.gapMaxMs),
    fastDistinctFps: median((r) => r.fast.distinctFramesPerSecond),
    fastGapMaxMs: median((r) => r.fast.gapMaxMs),
    restToExactMs: median((r) => r.restToExactMs),
    releaseToExactMs: median((r) => r.releaseToExactMs),
  };
  console.log(JSON.stringify({ summary: results.summary }));
} finally {
  await writeFile(path.join(dir, 'scrub-cache.json'), JSON.stringify(results, null, 2));
  await app.close().catch(() => {});
}
