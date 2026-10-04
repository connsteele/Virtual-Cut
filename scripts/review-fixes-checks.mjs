import { testPath } from './test-paths.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { root, require, electronEnvironment } from './shared.mjs';
import { collectBeforeWindowClose } from './coverage-desktop.mjs';

// Every run owns its project and copies of the synthetic eight-second source.
if (process.argv.includes('--reopen')) {
  const dir = process.argv.at(-1);
  const { ProjectService } = require('../dist-electron/project-service.cjs');
  const service = new ProjectService(path.join(dir, 'reopen-profile'), path.join(dir, 'tools'));
  try {
    const p = await service.open(path.join(dir, 'feedback.vcut'));
    assert(
      Math.abs(
        p.model.recordings.find((r) => r.id === p.model.selectedRecordingId).position - 6.25,
      ) < 0.001,
    );
    assert.equal(p.model.clips.find((c) => c.id === 'clip-1').name, 'Saved after seeking');
  } finally {
    await service.close();
  }
} else if (process.argv.includes('--fixture')) {
  const dir = process.argv.at(-1);
  const old = JSON.parse(await readFile(testPath('m1-feedback/latest-native.json'), 'utf8'));
  const { ProjectService } = require('../dist-electron/project-service.cjs');
  const service = new ProjectService(path.join(dir, 'native-profile'), path.join(dir, 'tools'));
  const file = path.join(dir, 'feedback.vcut');
  const source = path.join(dir, 'first.mkv'),
    second = path.join(dir, 'second.mkv');
  await copyFile(old.source, source);
  await copyFile(old.source, second);
  try {
    let p = await service.open(file, {
      name: 'Review fixes',
      destination: dir,
      cache: path.join(dir, 'cache'),
    });
    await service.importFiles(p.project.id, p.activeBatchId, [source, second], { game: 1, mic: 2 });
    for (let until = Date.now() + 90000; Date.now() < until;) {
      p = await service.snapshot();
      if (!p.jobs.some((j) => ['queued', 'running'].includes(j.state))) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert(p.jobs.every((j) => j.state === 'succeeded'));
    const model = structuredClone(p.model),
      rid = model.recordings[0].id;
    model.selectedRecordingId = rid;
    model.clips = [1, 2, 3, 4].map((n) => ({
      id: `clip-${n}`,
      rid,
      name: `Overlap ${n}`,
      start: n * 0.5,
      end: 7,
      folder: '_Review',
      include: true,
      note: '',
    }));
    model.markers[rid] = [
      {
        id: 'marker-a',
        time: 3,
        name: 'Seek marker',
        note: '',
        category: 'Context',
        color: 'Blue',
        topic: '',
      },
    ];
    await service.save(p.project.id, p.model, model);
    await writeFile(path.join(dir, 'fixture.json'), JSON.stringify({ file, source, second, rid }));
  } finally {
    await service.close();
  }
} else {
  const checks = testPath('playback-feedback');
  await mkdir(checks, { recursive: true });
  const dir = await mkdtemp(path.join(checks, 'checks-'));
  await new Promise((resolve, reject) => {
    const child = spawn(
      require('electron'),
      [path.join(root, 'scripts/review-fixes-checks.mjs'), '--fixture', dir],
      {
        cwd: root,
        windowsHide: true,
        stdio: 'inherit',
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          TEMP: process.env.TEMP || 'G:/GPT/Temp',
          TMP: process.env.TEMP || 'G:/GPT/Temp',
        },
      },
    );
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(Error('Fixture failed'))));
  });
  const f = JSON.parse(await readFile(path.join(dir, 'fixture.json'), 'utf8'));
  const hash = async () =>
    createHash('sha256')
      .update(await readFile(f.source))
      .digest('hex');
  const beforeHash = await hash();
  const executable = process.env.VIRTUAL_CUT_TEST_EXECUTABLE;
  const app = await electron.launch({
    executablePath: executable || require('electron'),
    args: [
      ...(executable ? [] : [root]),
      `--user-data-dir=${path.join(dir, 'profile')}`,
      '--background-test',
    ],
    cwd: root,
    env: electronEnvironment({
      TEMP: process.env.TEMP || 'G:/GPT/Temp',
      TMP: process.env.TEMP || 'G:/GPT/Temp',
    }),
  });
  const page = await app.firstWindow(),
    errors = [],
    evidence = {};
  const appProcess = app.process();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => errors.push(e.message));
  const state = () => page.evaluate(() => window.virtualCut.project.current());
  const go = (name) =>
    page
      .getByRole('navigation', { name: 'Workspace pages' })
      .getByRole('button', { name, exact: true })
      .click();
  const position = () => page.locator('video').evaluate((v) => v.currentTime);
  const seek = async (at) => {
    await page.locator('video').evaluate((v, at) => {
      v.currentTime = at;
    }, at);
    await expect.poll(() => page.locator('video').evaluate((v) => v.seeking)).toBe(false);
  };
  async function capture(name) {
    const data = await app.evaluate(async ({ BrowserWindow }) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      await wc.capturePage(undefined, { stayHidden: true, stayAwake: true });
      await new Promise((r) => setTimeout(r, 180));
      return (await wc.capturePage(undefined, { stayHidden: true, stayAwake: true }))
        .toPNG()
        .toString('base64');
    });
    await writeFile(path.join(dir, name + '.png'), Buffer.from(data, 'base64'));
  }
  try {
    await app.evaluate(({ dialog, BrowserWindow, shell }, file) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.setAudioMuted(true);
      win.setSize(1600, 1000);
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      globalThis.revealed = [];
      shell.showItemInFolder = (file) => {
        globalThis.revealed.push(file);
      };
    }, f.file);
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    await page.getByRole('button', { name: 'Open project file…', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    await go('Media');
    await expect(
      page.getByRole('group', { name: 'Media panels' }).locator('button').first(),
    ).toHaveAttribute('aria-label', 'Hide both panels');
    const secondRecord = (await state()).model.recordings.find((r) => r.id !== f.rid);
    const secondCard = page.locator(`[data-recording="${secondRecord.id}"]`);
    await secondCard.getByRole('button', { name: /^Show source in Explorer:/ }).click();
    await expect.poll(() => app.evaluate(() => globalThis.revealed.at(-1))).toBe(f.second);
    assert.equal(
      (await state()).model.selectedRecordingId,
      f.rid,
      'Source action does not select a different card',
    );
    await secondCard.getByRole('button', { name: /^Remove from batch:/ }).click();
    await expect(page.getByRole('dialog', { name: 'Remove recording from batch' })).toContainText(
      secondRecord.title,
    );
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal((await state()).model.recordings.length, 2);
    await capture('media-wide');
    await go('Cut');
    await expect(page.locator('[data-clip-lanes]')).toHaveAttribute('data-clip-lanes', '4');
    await page.getByLabel('Selection follows playhead').uncheck();
    const clip = page.locator('[data-cut-clip="clip-1"]');
    await seek(5);
    await clip.dblclick({ position: { x: 10, y: 10 } });
    await expect.poll(position).toBeCloseTo(0.5, 2);
    const marker = page.locator('[data-marker-card="marker-a"]');
    await marker.dblclick({ position: { x: 10, y: 10 } });
    await expect.poll(position).toBeCloseTo(3, 2);
    await marker.getByLabel('Marker note').fill('First line\nSecond line');
    await expect
      .poll(async () => (await state()).model.markers[f.rid][0].note)
      .toBe('First line\nSecond line');
    assert.equal(
      await marker
        .locator('..')
        .locator('h3')
        .evaluate((el) => getComputedStyle(el).borderBottomWidth),
      '0px',
    );
    await page.getByRole('button', { name: 'Zoom in timeline', exact: true }).click();
    const track = page.getByTestId('scrub-surface');
    const original = await track.evaluate((el) => ({
      start: +el.dataset.viewStart,
      end: +el.dataset.viewEnd,
    }));
    const timeBefore = await position();
    assert(
      await track.evaluate((el) => {
        const event = new WheelEvent('wheel', {
          ctrlKey: true,
          deltaY: 140,
          bubbles: true,
          cancelable: true,
        });
        el.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    );
    await expect
      .poll(() => track.evaluate((el) => +el.dataset.viewStart))
      .toBeGreaterThan(original.start);
    const panned = await track.evaluate((el) => ({
      start: +el.dataset.viewStart,
      end: +el.dataset.viewEnd,
    }));
    assert(panned.start > original.start);
    assert(Math.abs(panned.end - panned.start - (original.end - original.start)) < 0.001);
    assert.equal(await position(), timeBefore);
    async function layout(name, width, height) {
      await app.evaluate(
        ({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h),
        [width, height],
      );
      await page.waitForTimeout(250);
      const measured = await page.locator('[data-video-stage]').evaluate((el) => {
        const player = el.parentElement,
          pane = player.parentElement;
        const footer = document
          .querySelector('[aria-label="Workspace pages"]')
          .getBoundingClientRect();
        const audio = document
          .querySelector('[aria-label="Preview audio controls"]')
          .getBoundingClientRect();
        return {
          stageHeight: el.clientHeight,
          paneHeight: pane.clientHeight,
          paneScroll: pane.scrollHeight,
          audioBottom: audio.bottom,
          footerTop: footer.top,
          paneBottom: pane.getBoundingClientRect().bottom,
        };
      });
      evidence[name] = measured;
      assert(measured.stageHeight > 50, JSON.stringify(measured));
      assert(measured.paneScroll <= measured.paneHeight + 1, JSON.stringify(measured));
      assert(measured.audioBottom <= measured.footerTop, JSON.stringify(measured));
      await capture(name);
    }
    await layout('cut-wide', 1600, 1000);
    await layout('cut-compact', 1100, 720);
    assert(evidence['cut-compact'].stageHeight < evidence['cut-wide'].stageHeight);
    await go('Review');
    const review = page.locator('[data-card="clip-1"]');
    await review.getByRole('button', { name: 'Details', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    await page.waitForTimeout(500);
    await seek(5);
    await review.locator('[data-review-field="name"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await review.locator('[data-review-field="name"]').dblclick({ position: { x: 3, y: 3 } });
    await expect.poll(position).toBeCloseTo(0.5, 2);
    await review.locator('[data-marker-card="marker-a"]').dblclick({ position: { x: 10, y: 10 } });
    await expect.poll(position).toBeCloseTo(3, 2);
    await capture('review-compact');
    await go('Cut');
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    await seek(1);
    await page.waitForTimeout(2400);
    const before = await state();
    // Real decoding while continuously seeking stresses the navigation save cadence.
    await page.evaluate(() => {
      let n = 0;
      window.seekTest = setInterval(() => {
        document.querySelector('video').currentTime = 1 + (n++ % 50) / 10;
      }, 120);
    });
    await page.waitForTimeout(33000);
    const during = await state();
    assert.equal(during.revision, before.revision, 'No automatic writes during navigation');
    assert.deepEqual(
      during.saves,
      before.saves,
      'Navigation does not generate save-history copies',
    );
    await clip.locator('input').first().fill('Saved after seeking');
    await page.waitForTimeout(2800);
    assert.equal(
      (await state()).revision,
      before.revision,
      'Edits also wait for transport to stop',
    );
    await expect(page.getByRole('banner').getByRole('status')).toHaveText('Unsaved changes');
    await page.evaluate(() => clearInterval(window.seekTest));
    await seek(4.25);
    // The deferred edit lands with the settled save, together with the final position.
    await expect
      .poll(async () => (await state()).model.clips.find((c) => c.id === 'clip-1').name)
      .toBe('Saved after seeking');
    await expect
      .poll(async () => (await state()).model.recordings.find((r) => r.id === f.rid).position)
      .toBeCloseTo(4.25, 2);
    evidence.savesIn33Seconds = during.revision - before.revision;
    // Holding the scrub pointer still is not an idle transport.
    const settled = await state();
    const box = await track.boundingBox();
    await page.mouse.move(box.x + box.width * 0.4, box.y + 8);
    await page.mouse.down();
    await page.waitForTimeout(2800);
    assert.equal((await state()).revision, settled.revision, 'Held scrub does not save');
    await page.mouse.up();
    await expect
      .poll(async () => (await state()).revision, 'Released scrub saves after settling')
      .toBeGreaterThan(settled.revision);
    await seek(1);
    await page.waitForTimeout(2400);
    const beforePlaying = await state();
    await page.locator('video').evaluate((v) => v.play());
    await page.waitForTimeout(3200);
    assert.equal(await page.locator('video').evaluate((v) => v.paused), false);
    assert.equal(
      (await state()).revision,
      beforePlaying.revision,
      'Forward playback does not save',
    );
    await page.locator('video').evaluate((v) => v.pause());
    await expect
      .poll(async () => (await state()).revision, 'Paused playback saves')
      .toBeGreaterThan(beforePlaying.revision);
    await seek(7);
    await page.waitForTimeout(2400);
    const beforeReverse = await state();
    await page.getByRole('button', { name: 'Reverse · J', exact: true }).click();
    await page.waitForTimeout(2800);
    assert.equal((await state()).revision, beforeReverse.revision, 'Reverse scan does not save');
    await page.getByRole('button', { name: 'Pause · K / Space', exact: true }).click();
    await page.waitForTimeout(2400);
    // Navigation does not hide the last edit behind position-only Undo steps or
    // clear Redo. Undo/Redo of the name must also leave the decoded frame alone.
    await seek(4.75);
    await page.waitForTimeout(2400);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(clip.locator('input').first()).toHaveValue('Overlap 1');
    await expect.poll(position).toBeCloseTo(4.75, 2);
    await seek(5);
    await page.waitForTimeout(2400);
    await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect(clip.locator('input').first()).toHaveValue('Saved after seeking');
    await expect.poll(position).toBeCloseTo(5, 2);
    evidence.idleOnlySaving = [
      'continuous seeks',
      'held scrub',
      'forward playback',
      'reverse scan',
      'edits deferred until stop',
    ];
    evidence.undo = 'Navigation skipped; Redo retained; current viewing position preserved';
    await seek(5.25);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect
      .poll(async () => (await state()).model.recordings.find((r) => r.id === f.rid).position)
      .toBeCloseTo(5.25, 2);
    await expect(page.getByRole('banner').getByRole('status')).toHaveText('Manual save made');
    await seek(6.25);
    const closed = new Promise((resolve) => appProcess.once('exit', resolve));
    await collectBeforeWindowClose(app);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed;
    await new Promise((resolve, reject) => {
      const child = spawn(
        require('electron'),
        [path.join(root, 'scripts/review-fixes-checks.mjs'), '--reopen', dir],
        {
          cwd: root,
          windowsHide: true,
          stdio: 'inherit',
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        },
      );
      child.on('error', reject);
      child.on('exit', (code) =>
        code === 0 ? resolve() : reject(Error('Immediate close/reopen failed')),
      );
    });
    assert.equal(await hash(), beforeHash);
    assert.deepEqual(errors, []);
    await writeFile(path.join(dir, 'evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`Review fixes checks passed: ${dir}\n${JSON.stringify(evidence)}`);
  } catch (error) {
    await capture('failure').catch(() => {});
    console.error(`Evidence: ${dir}`);
    throw error;
  } finally {
    if (appProcess.exitCode === null) await app.close();
  }
}
