import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { root, require, electronEnvironment } from './shared.mjs';
const scratch = 'G:/GPT/Work/virtual-cut/transport-investigation';
const fixture = JSON.parse(await readFile(path.join(scratch, 'latest-fixture.json'), 'utf8'));
const dir = await mkdtemp(path.join(scratch, 'regression-'));
const file = path.join(dir, 'transport.vcut');
await copyFile(fixture.file, file);
const executable = process.env.VIRTUAL_CUT_TEST_EXECUTABLE;
const app = await electron.launch({
  executablePath: executable || require('electron'),
  args: [
    ...(executable ? [] : [root]),
    `--user-data-dir=${path.join(dir, 'profile')}`,
    '--background-test',
  ],
  cwd: root,
  env: electronEnvironment({ TEMP: 'G:/GPT/Temp', TMP: 'G:/GPT/Temp' }),
});
const page = await app.firstWindow(),
  errors = [],
  results = [];
page.setDefaultTimeout(20000);
page.on('pageerror', (e) => errors.push(e.message));
const v = page.locator('video');
const status = page.getByLabel('Playback status', { exact: true });
const key = async (k) => {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press(k);
};
const pause = () =>
  page.evaluate(() => window.dispatchEvent(new Event('virtual-cut-pause-workspace')));
const seek = async (t) => {
  await v.evaluate((v, t) => {
    v.currentTime = t;
  }, t);
  await expect.poll(() => v.evaluate((v) => !v.seeking && v.readyState >= 2)).toBe(true);
};
const go = (name) =>
  page
    .getByRole('navigation', { name: 'Workspace pages' })
    .getByRole('button', { name, exact: true })
    .click();
async function capture(name) {
  const data = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    await wc.capturePage(undefined, { stayHidden: true, stayAwake: true });
    await new Promise((r) => setTimeout(r, 1200));
    return (await wc.capturePage(undefined, { stayHidden: true, stayAwake: true }))
      .toPNG()
      .toString('base64');
  });
  await writeFile(path.join(dir, name + '.png'), Buffer.from(data, 'base64'));
}
try {
  await app.evaluate(({ dialog, BrowserWindow }, file) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1800, 1100);
    w.webContents.setAudioMuted(true);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, file);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await go('Cut');
  await page.locator('[data-recording]').filter({ hasText: '4K AV1 gameplay' }).click();
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await page.getByRole('button', { name: 'Combined', exact: true }).click();
  for (const width of [1800, 1100]) {
    await app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()[0].setSize(width, width === 1800 ? 1100 : 720),
      width,
    );
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      window.heights = [];
      window.stageObserver = new ResizeObserver(() =>
        window.heights.push({
          stage: document.querySelector('[data-video-stage]').getBoundingClientRect().height,
          film: document.querySelector('[data-waveform-mode]').getBoundingClientRect().height,
        }),
      );
      window.stageObserver.observe(document.querySelector('[data-video-stage]'));
    });
    for (const title of ['Short clock', '4K AV1 gameplay', 'Short clock', '4K AV1 gameplay']) {
      await page.locator('[data-recording]').filter({ hasText: title }).click();
      await expect.poll(() => v.evaluate((v) => v.readyState >= 2 && !v.seeking)).toBe(true);
      await page.waitForTimeout(180);
    }
    const heights = await page.evaluate(() => {
      window.stageObserver.disconnect();
      return window.heights;
    });
    results.push({ width, heights });
    assert(
      Math.max(...heights.map((h) => h.stage)) - Math.min(...heights.map((h) => h.stage)) <= 1,
      JSON.stringify(heights),
    );
    assert(heights.every((h) => h.film === (width === 1800 ? 64 : 48)));
    await capture('stable-viewer-' + width);
  }
  await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
    window.transportStats = {
      audioSeeks: 0,
      overlappingVideoSeeks: 0,
      videoSeeks: 0,
      completed: 0,
    };
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      ...descriptor,
      set(t) {
        if (this.tagName === 'AUDIO') window.transportStats.audioSeeks++;
        else {
          window.transportStats.videoSeeks++;
          if (this.seeking) window.transportStats.overlappingVideoSeeks++;
        }
        descriptor.set.call(this, t);
      },
    });
    document
      .querySelector('video')
      .addEventListener('seeked', () => window.transportStats.completed++);
  });
  for (const rate of [1, 2, 4, 8, 16]) {
    await pause();
    await seek(10);
    await page.evaluate(() => {
      window.transportStats = {
        audioSeeks: 0,
        overlappingVideoSeeks: 0,
        videoSeeks: 0,
        completed: 0,
      };
    });
    for (let i = 0; i <= Math.log2(rate); i++) await key('l');
    await expect(status).toHaveText(new RegExp(`^${rate}× forward`));
    const start = await v.evaluate((v) => v.currentTime);
    await page.waitForTimeout(rate === 16 ? 6500 : 2500);
    const data = await page.evaluate(() => ({
      ...window.transportStats,
      time: document.querySelector('video').currentTime,
      status: document.querySelector('[aria-label="Playback status"]').textContent,
      audioPaused: [...document.querySelectorAll('audio')].every((a) => a.paused),
      error: document.querySelector('video').error?.code,
    }));
    results.push({ rate, start, ...data });
    console.log(JSON.stringify({ rate, start, ...data }));
    assert(!data.error);
    assert(
      data.time - start > rate * (rate === 16 ? 4.5 : 1.8),
      'Forward scan advances at the requested rate',
    );
    assert(data.audioSeeks <= 10, `Audio corrections must be bounded: ${JSON.stringify(data)}`);
    if (rate > 4) assert(data.audioPaused);
    if (rate === 16) {
      assert(data.status.includes('scan'), 'Heavy source should trigger adaptive scanning');
      assert(data.completed >= 4);
      assert.equal(data.overlappingVideoSeeks, 0);
    }
    await key('k');
    await expect(status).toHaveText('Paused');
    await expect.poll(() => v.evaluate((v) => !v.seeking)).toBe(true);
    const stopped = await v.evaluate((v) => v.currentTime);
    await page.waitForTimeout(300);
    assert.equal(await v.evaluate((v) => v.currentTime), stopped);
    await key('l');
    await expect(status).toHaveText('1× forward');
    await page.waitForTimeout(350);
    assert((await v.evaluate((v) => v.currentTime)) > stopped);
  }
  await pause();
  await seek(150);
  await page.evaluate(() => {
    window.transportStats = {
      audioSeeks: 0,
      overlappingVideoSeeks: 0,
      videoSeeks: 0,
      completed: 0,
    };
  });
  for (let i = 0; i < 5; i++) await key('j');
  await expect(status).toHaveText('16× reverse scan');
  await page.waitForTimeout(2500);
  const reverse = await page.evaluate(() => ({
    ...window.transportStats,
    time: document.querySelector('video').currentTime,
  }));
  results.push({ reverse });
  assert(reverse.time < 120);
  assert.equal(reverse.overlappingVideoSeeks, 0);
  assert(reverse.completed > 4);
  await key('k');
  await expect(status).toHaveText('Paused');
  await expect.poll(() => v.evaluate((v) => !v.seeking)).toBe(true);
  await key('l');
  await expect(status).toHaveText('1× forward');
  await page.waitForTimeout(300);
  await pause();
  // Reproduce the error path deterministically without corrupting the source.
  await seek(35);
  await v.evaluate((v) => v.dispatchEvent(new Event('error')));
  await expect(page.getByRole('button', { name: 'Reload preview', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reload preview', exact: true }).click();
  await expect.poll(() => v.evaluate((v) => !v.seeking && v.readyState >= 2)).toBe(true);
  assert(Math.abs((await v.evaluate((v) => v.currentTime)) - 35) < 0.01);
  await key('l');
  await expect(status).toHaveText('1× forward');
  await pause();
  // Manual-save feedback must not flash the automatic-save message.
  await seek(37);
  await page.evaluate(() => {
    window.notices = [];
    window.noticeObserver = new MutationObserver(() =>
      window.notices.push(document.querySelector('header [role=status]')?.textContent),
    );
    window.noticeObserver.observe(document.querySelector('header'), {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  await key('Control+s');
  await expect(page.getByRole('banner').getByRole('status')).toHaveText('Manual save made');
  const notices = await page.evaluate(() => {
    window.noticeObserver.disconnect();
    return window.notices;
  });
  assert(!notices.includes('Saved'), JSON.stringify(notices));
  await go('Media');
  await page.getByRole('button', { name: 'List', exact: true }).click();
  for (const width of [1800, 1100]) {
    await app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()[0].setSize(width, width === 1800 ? 1100 : 720),
      width,
    );
    await page.waitForTimeout(250);
    const rows = await page.locator('[data-recording]').evaluateAll((els) =>
      els.map((el) => ({
        title: el.querySelector('strong').getBoundingClientRect().toJSON(),
        date: el.querySelector('time').getBoundingClientRect().toJSON(),
        duration: el.querySelector(':scope > span').getBoundingClientRect().toJSON(),
        actions: el.querySelector('button').parentElement.getBoundingClientRect().toJSON(),
        overflow: el.scrollWidth > el.clientWidth + 1,
        stacked:
          Number.parseFloat(getComputedStyle(document.getElementById('media-pool-panel')).width) -
            Number.parseFloat(
              getComputedStyle(document.getElementById('media-pool-panel')).paddingLeft,
            ) -
            Number.parseFloat(
              getComputedStyle(document.getElementById('media-pool-panel')).paddingRight,
            ) <=
          380,
      })),
    );
    assert(
      rows.every(
        (r) =>
          !r.overflow &&
          (r.stacked
            ? r.date.top >= r.title.bottom
            : Math.abs((r.title.top + r.title.bottom - r.date.top - r.date.bottom) / 2) < 2) &&
          Math.abs((r.duration.top + r.duration.bottom - r.actions.top - r.actions.bottom) / 2) < 2,
      ),
      JSON.stringify(rows),
    );
    await capture('compact-media-list-' + width);
  }
  assert.deepEqual(errors, []);
  console.log('Transport and review regression checks passed:', dir);
} catch (e) {
  await capture('failure').catch(() => {});
  throw e;
} finally {
  await writeFile(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(dir);
  await app.close();
}
