import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron, expect } from 'playwright/test';
import { require, root, electronEnvironment } from './shared.mjs';
const base = process.env.VIRTUAL_CUT_TEST_ROOT;
assert(base, 'Run with the test suite so all media is disposable.');
const fixture = JSON.parse(await readFile(path.join(base, 'transcripts/latest.json'), 'utf8'));
await mkdir(path.join(base, 'transcript-review'), { recursive: true });
const dir = await mkdtemp(path.join(base, 'transcript-review/run-'));
const file = path.join(dir, 'review.vcut');
await copyFile(fixture.file, file);
const { ProjectService } = require('../dist-electron/project-service.cjs');
const service = new ProjectService(path.join(dir, 'native-profile'), '');
await service.open(file);
const store = service.store,
  summary = store.transcripts.get(fixture.transcriptId);
const transcriptId = 'synthetic-pagination-and-cues';
store.transcripts.begin({ ...summary, id: transcriptId, segmentCount: 125, wordCount: 125 });
for (let i = 0; i < 125; i++) {
  const text =
    i === 10
      ? 'Clip start opening'
      : i === 95
        ? 'Clip end'
        : i === 110
          ? 'Split'
          : i === 115
            ? 'Mark short title'
            : `word${i}`;
  store.transcripts.append(transcriptId, {
    id: i,
    start: i / 10,
    end: (i + 1) / 10,
    text,
    words: [{ text, start: i / 10, end: (i + 1) / 10, probability: 1 }],
    noSpeechProbability: 0,
    averageLogProbability: 0,
  });
}
const before = store.data.model;
store.save(before, {
  ...before,
  cueDecisions: [],
  clips: [
    {
      id: 'overlap-a',
      rid: fixture.rid,
      name: 'First overlap',
      start: 0,
      end: 15,
      include: true,
      folder: '_Review',
    },
    {
      id: 'overlap-b',
      rid: fixture.rid,
      name: 'Second overlap',
      start: 0,
      end: 15,
      include: true,
      folder: '_Review',
    },
  ],
});
await service.checkpoint(fixture.id);
await service.close();
let app;
const errors = [];
try {
  app = await electron.launch({
    executablePath: process.env.VIRTUAL_CUT_TEST_EXECUTABLE || require('electron'),
    args: [
      ...(process.env.VIRTUAL_CUT_TEST_EXECUTABLE ? [] : [root]),
      `--user-data-dir=${path.join(dir, 'profile')}`,
      '--background-test',
    ],
    cwd: root,
    env: electronEnvironment(),
  });
  const main = await app.firstWindow();
  main.on('pageerror', (e) => errors.push(e.message));
  await main.locator('[data-workflow]').waitFor();
  await app.evaluate(({ dialog, BrowserWindow }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true);
  }, file);
  await main.getByRole('button', { name: 'Projects', exact: true }).click();
  await main.getByRole('button', { name: 'Open project file…', exact: true }).click();
  const opened = app.waitForEvent('window');
  await main.getByRole('button', { name: 'Transcript', exact: true }).click();
  const view = await opened;
  view.on('pageerror', (e) => errors.push(e.message));
  await view.getByLabel('Recognition', { exact: true }).selectOption(transcriptId);
  const phrases = view.getByLabel('Transcript phrases');
  await expect(phrases.locator('article')).toHaveCount(60);
  await view.getByRole('button', { name: 'word30', exact: true }).click();
  await expect(view.getByLabel('Transcript correction')).toHaveCount(0);
  await view.keyboard.press('l');
  await expect.poll(() => main.locator('video').evaluate((v) => v.paused)).toBe(false);
  await view.keyboard.press('k');
  await expect.poll(() => main.locator('video').evaluate((v) => v.paused)).toBe(true);
  await view.getByLabel('Search transcript').fill('l');
  await view.getByLabel('Search transcript').press('l');
  assert.equal(
    await main.locator('video').evaluate((v) => v.paused),
    true,
    'Typing L must not start playback',
  );
  await view.getByLabel('Search transcript').fill('');
  await view.getByRole('button', { name: 'Follow playback', exact: true }).click();
  // Exercise production IPC and page following without waiting through the whole sample.
  const position = async (time) =>
    main.evaluate(({ id, rid, time }) => window.virtualCut.transcript.position(id, rid, time), {
      id: fixture.id,
      rid: fixture.rid,
      time,
    });
  await position(12.2);
  await expect(view.getByRole('navigation', { name: 'Transcript pages' })).toContainText('Page 3');
  await new Promise((r) => setTimeout(r, 150));
  await position(0.5);
  await expect(view.getByRole('navigation', { name: 'Transcript pages' })).toContainText('Page 1');
  await view.getByLabel('Transcript filter').selectOption('pending');
  await expect(phrases.locator('article')).toHaveCount(4);
  await expect(view.getByLabel('Cue title 95')).toHaveValue('opening');
  await phrases
    .locator('article')
    .nth(1)
    .getByRole('button', { name: 'Accept clip range', exact: true })
    .click();
  await expect(phrases.locator('article')).toHaveCount(2);
  let current = await main.evaluate(() => window.virtualCut.project.current());
  assert.equal(current.model.clips.at(-1).name, 'opening');
  assert.equal(current.model.cueDecisions.length, 2);
  await main.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(phrases.locator('article')).toHaveCount(4);
  await view.getByLabel('Cue title 10').fill('Reviewed opening');
  await view.getByLabel('Cue position 10').fill('0.8');
  await view.getByLabel('Cue end 10').fill('9.6');
  await phrases
    .locator('article')
    .first()
    .getByRole('button', { name: 'Accept clip range', exact: true })
    .click();
  await expect(phrases.locator('article')).toHaveCount(2);
  current = await main.evaluate(() => window.virtualCut.project.current());
  assert.equal(current.model.cueDecisions.length, 2);
  assert.deepEqual(
    current.model.clips.filter((c) => c.name === 'Reviewed opening').map((c) => [c.start, c.end]),
    [[0.8, 9.6]],
  );
  await main.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(phrases.locator('article')).toHaveCount(4);
  await main.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(phrases.locator('article')).toHaveCount(2);
  await expect(view.getByRole('button', { name: 'Accept split', exact: true })).toBeDisabled();
  await view.getByLabel('Split target 110').selectOption('overlap-b');
  await view.getByRole('button', { name: 'Accept split', exact: true }).click();
  await expect(phrases.locator('article')).toHaveCount(1);
  await expect(view.getByLabel('Cue title 115')).toHaveValue('short title');
  await expect(view.getByLabel('Cue text 115')).toHaveValue(/word124/);
  await view.getByLabel('Cue context end 115').selectOption('116');
  await expect(view.getByLabel('Cue text 115')).toHaveValue('short title word116');
  await view.getByLabel('Cue title 115').fill('Context review marker');
  await view.getByRole('button', { name: 'Seek to context end', exact: true }).click();
  await expect.poll(() => main.locator('video').evaluate((v) => v.currentTime)).toBe(11.7);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('#transcript'))
      .setSize(500, 600),
  );
  await view.getByLabel('Cue title 115').focus();
  await view.getByLabel('Cue title 115').press('l');
  assert.equal(await main.locator('video').evaluate((v) => v.paused), true);
  await view.getByLabel('Cue title 115').fill('Context review marker');
  assert.equal(
    await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
  );
  const cueImage = await app.evaluate(async ({ BrowserWindow }) =>
    (
      await BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith('#transcript'))
        .webContents.capturePage(undefined, { stayHidden: true })
    )
      .toPNG()
      .toString('base64'),
  );
  await writeFile(path.join(dir, 'cue-context-compact.png'), Buffer.from(cueImage, 'base64'));
  await view.getByRole('button', { name: 'Accept marker', exact: true }).click();
  await expect(view.getByText('No matching cues.')).toBeVisible();
  current = await main.evaluate(() => window.virtualCut.project.current());
  const marker = current.model.markers[fixture.rid].find((m) => m.name === 'Context review marker');
  assert.equal(marker.note, 'short title word116');
  const decision = current.model.cueDecisions.find((d) => d.markerId === marker.id);
  assert.deepEqual(decision.segmentIds, [115, 116]);
  assert.equal(decision.contextEnd, 11.7);
  await main.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(phrases.locator('article')).toHaveCount(1);
  await main.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(view.getByText('No matching cues.')).toBeVisible();
  assert.equal(current.model.clips.find((c) => c.id === 'overlap-a').end, 15);
  assert.equal(current.model.clips.find((c) => c.id === 'overlap-b').end, 11);
  await view.getByLabel('Transcript filter').selectOption('accepted');
  await expect(phrases.locator('article')).toHaveCount(4);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('#transcript'))
      .setSize(500, 600),
  );
  await view.getByRole('button', { name: 'Local transcription setup', exact: true }).click();
  await view.getByText('Install or update speech recognition', { exact: true }).click();
  await expect(
    view.getByRole('button', { name: 'GPU installation guide', exact: true }),
  ).toBeVisible();
  assert.equal(
    await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
  );
  const image = await app.evaluate(async ({ BrowserWindow }) =>
    (
      await BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith('#transcript'))
        .webContents.capturePage(undefined, { stayHidden: true })
    )
      .toPNG()
      .toString('base64'),
  );
  await writeFile(path.join(dir, 'setup-compact.png'), Buffer.from(image, 'base64'));
  assert.deepEqual(errors, []);
  console.log(
    `Transcript JKL/focus, page following, cross-page cue filters, paired ranges/Undo, explicit split targets and setup passed: ${dir}`,
  );
} catch (error) {
  if (app)
    for (const [i, page] of app.windows().entries())
      await writeFile(path.join(dir, `failure-${i}.html`), await page.content());
  throw error;
} finally {
  if (app) await app.close();
}
