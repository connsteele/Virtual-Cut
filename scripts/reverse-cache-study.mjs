// Measure reverse playback from a WebCodecs frame cache (rewind spike).
// Decodes one keyframe interval at a time with WebCodecs and shows it backwards while older
// intervals decode ahead, in an off-screen window opened by the app in test mode (never shown
// on the desktop, audio muted). Use copies of recordings only.
//   node scripts/reverse-cache-study.mjs <video copy> [start seconds]
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { root, require, electronEnvironment } from './shared.mjs';

const [file, start = '420'] = process.argv.slice(2);
if (!file) throw new Error('Usage: reverse-cache-study.mjs <video copy> [start seconds]');
const seconds = Number(process.env.VIRTUAL_CUT_SPEED_WINDOW || 4);
const profile = await mkdtemp(path.join(os.tmpdir(), 'reverse-cache-'));
const app = await electron.launch({
  executablePath: require('electron'),
  args: [root, `--user-data-dir=${profile}`, '--background-test'],
  cwd: root,
  env: electronEnvironment({}),
});
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
  await page.waitForFunction(() => typeof window.reverseFromCache === 'function');
  console.log(`== reverse from a WebCodecs cache: ${path.basename(file)}`);
  for (const rate of [1, 2, 4, 6, 8, 16]) {
    const r = await page.evaluate(
      ([f, s, rate, seconds]) => window.reverseFromCache(f, s, rate, seconds),
      [path.resolve(file), Number(start), rate, seconds],
    );
    console.log(
      `${String(rate).padStart(3)}× painted ${String(r.paintedPerSecond).padStart(5)}/s gaps p50 ${r.gapMedianMs}ms p95 ${r.gapP95Ms}ms max ${r.gapMaxMs}ms stutters ${r.stutters} waits ${r.waitsForDecode} interval decode ${r.intervalDecodeMedianMs}ms (every ${r.keptEveryNthFrame} kept, ${r.intervalsAhead} ahead) ${r.codec} ${r.size}`,
    );
  }
} finally {
  await app.close();
}
