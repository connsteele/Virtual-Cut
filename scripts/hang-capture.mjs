import { _electron } from 'playwright/test';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// When a desktop check runs out of time, test-suite.mjs creates the request file. The check
// then saves a screenshot of every open window (output-1.png, output-2.png, …) and writes
// the request file name + '.done', so the suite can stop it with the screenshots on disk.
// A hung Playwright call leaves the event loop free, so this timer still runs. Screenshots
// go through the renderer, so they work even when the main process is busy.
export function watchForHang(request, output) {
  const apps = new Set();
  const launch = _electron.launch.bind(_electron);
  _electron.launch = async (...args) => {
    const app = await launch(...args);
    apps.add(app);
    app.once('close', () => apps.delete(app));
    return app;
  };
  const timer = setInterval(async () => {
    if (!existsSync(request)) return;
    clearInterval(timer);
    const screenshots = [];
    for (const app of apps)
      for (const page of app.windows()) {
        const file = `${output}-${screenshots.length + 1}.png`;
        try {
          await page.screenshot({ path: file, timeout: 5000 });
          screenshots.push(path.basename(file));
        } catch (error) {
          screenshots.push(`${path.basename(file)} not saved: ${error.message.split('\n')[0]}`);
        }
      }
    if (!screenshots.length) screenshots.push('No window was open');
    await writeFile(request + '.done', JSON.stringify({ screenshots }));
  }, 250);
  timer.unref();
}
