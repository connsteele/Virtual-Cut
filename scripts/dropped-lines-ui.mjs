// VC-166 / VC-164 in the transcript window: dropped lines are left out, Original shows them as
// "Dropped: no speech", and the summary says where vocabulary hints came from and how many
// spans the hint guard redid. Screenshots: reading, Original, and a compact window.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { require, root, electronEnvironment } from './shared.mjs';
const base = process.env.VIRTUAL_CUT_TEST_ROOT;
assert(base, 'Run with the test suite so all media is disposable.');
const fixture = JSON.parse(await readFile(path.join(base, 'transcripts/latest.json'), 'utf8'));
await mkdir(path.join(base, 'dropped-lines'), { recursive: true });
const dir = await mkdtemp(path.join(base, 'dropped-lines/run-'));
const file = path.join(dir, 'dropped.vcut');
await copyFile(fixture.file, file);
const { ProjectService } = require('../dist-electron/project-service.cjs');
const { dropLines } = await import('../dist-electron/dropped-lines.js');
const service = new ProjectService(path.join(dir, 'native-profile'), '');
await service.open(file);
const store = service.store,
  summary = store.transcripts.get(fixture.transcriptId);
const transcriptId = 'vc166-microphone';
const said = [
  ['This is starting the big main quest with Kai.', 0.8, 1, 3.4, 0.05],
  ['Thank you.', 0.04, 4, 4.5, 0.84], // invented over a cough
  ['Split.', 0.02, 5.2, 5.7, 0.2], // quiet, but a cue always stays
  ['Hmm.', 0.02, 6.4, 6.8, 0.88], // neither detector heard speech
  ['Okay.', 0.06, 8, 8.4, 0.26], // the speech model heard it: stays
  ['Nice little crit here with Peter.', 0.58, 9.5, 11.1, 0.01],
];
const lines = said.map(([text, voiceScore, start, end, noSpeechProbability], id) => ({
  id,
  start,
  end,
  text: ` ${text}`,
  words: text.split(' ').map((word, i, all) => ({
    text: (i ? ' ' : '') + word,
    start: start + ((end - start) * i) / all.length,
    end: start + ((end - start) * (i + 1)) / all.length,
    probability: 0.9,
  })),
  noSpeechProbability,
  averageLogProbability: -0.2,
  voiceScore,
}));
const mic = {
  ...summary,
  id: transcriptId,
  role: 'mic',
  segmentCount: lines.length,
  wordCount: lines.reduce((n, l) => n + l.words.length, 0),
  context: { ...summary.context, gameName: 'Fortune’s Weave', vocabulary: 'Kai, Theodora' },
  guardRedos: 2,
};
store.transcripts.begin(mic);
for (const line of lines) store.transcripts.append(transcriptId, line);
store.transcripts.put({ ...mic, state: 'complete' });
const dropped = dropLines(mic, lines);
assert.deepEqual(
  dropped.map((d) => [d.segmentId, d.reason]),
  [
    [1, 'stock-phrase'],
    [3, 'no-voice'],
  ],
);
const before = store.data.model;
store.save(before, { ...before, droppedLines: [...(before.droppedLines || []), ...dropped] });
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
  await view.setViewportSize({ width: 1000, height: 640 });
  await view.getByLabel('Select transcript', { exact: true }).selectOption(transcriptId);
  const phrases = view.getByLabel('Transcript phrases');
  // Reading: the two dropped lines are left out, and the chip counts agree.
  await expect(phrases.locator('article')).toHaveCount(4);
  await expect(phrases.getByText('Thank you.')).toHaveCount(0);
  await expect(phrases.getByText('Dropped: no speech')).toHaveCount(0);
  await expect(view.locator('[data-filter="all"] span')).toHaveText('4');
  const help = view.locator('details summary').filter({ hasText: 'vocabulary hints' });
  await expect(help).toContainText(
    'vocabulary hints used, from Fortune’s Weave’s names and terms · 2 spans redone without hints',
  );
  await view.screenshot({ path: path.join(dir, 'reading.png') });
  // Original, by keyboard: the dropped lines come back, labelled, and can't be edited.
  const original = view.getByLabel('Original', { exact: true });
  await original.focus();
  await view.keyboard.press('Space');
  await expect(original).toBeChecked();
  await expect(phrases.locator('article')).toHaveCount(6);
  await expect(phrases.locator('article[data-dropped]')).toHaveCount(2);
  await expect(phrases.getByText('Dropped: no speech', { exact: true })).toHaveCount(2);
  await expect(view.locator('[data-filter="all"] span')).toHaveText('6');
  const droppedRow = phrases.locator('article[data-dropped="stock-phrase"]');
  await expect(droppedRow).toContainText('Thank you.');
  await expect(droppedRow.getByRole('button', { name: 'Edit phrase' })).toBeDisabled();
  await droppedRow.getByRole('button', { name: 'Thank', exact: true }).dblclick();
  await expect(view.getByLabel('Transcript correction')).toHaveCount(0);
  await expect(phrases.locator('article[data-dropped="no-voice"]')).toContainText('Hmm.');
  await view.screenshot({ path: path.join(dir, 'original.png') });
  await view.setViewportSize({ width: 560, height: 640 });
  await expect(phrases.getByText('Dropped: no speech', { exact: true }).first()).toBeVisible();
  await view.screenshot({ path: path.join(dir, 'original-compact.png') });
  await original.focus();
  await view.keyboard.press('Space');
  await expect(phrases.locator('article')).toHaveCount(4);
  // VC-164: Transcribe starts with the game's names and terms as hints.
  await view.setViewportSize({ width: 1000, height: 640 });
  await view.getByRole('button', { name: 'Transcribe', exact: true }).click();
  const start = view.getByLabel('Start transcription');
  await expect(
    start.getByLabel('Use this batch’s names and game terms as recognition hints'),
  ).toBeChecked();
  await start.scrollIntoViewIfNeeded();
  await view.screenshot({ path: path.join(dir, 'transcribe-hints-on.png') });
  assert.deepEqual(errors, []);
  console.log(`Dropped lines, Original label and hint notes passed: ${dir}`);
} catch (error) {
  if (app)
    for (const [i, page] of app.windows().entries())
      await writeFile(path.join(dir, `failure-${i}.html`), await page.content());
  throw error;
} finally {
  if (app) await app.close();
}
