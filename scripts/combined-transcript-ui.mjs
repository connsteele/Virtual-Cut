import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { require, root, electronEnvironment } from './shared.mjs';
import { collectBeforeWindowClose } from './coverage-desktop.mjs';

// VC-185: the Transcript window's Both view interleaves microphone and game lines in time
// order, each with a coloured edge and a Mic or Game label, and proposal cards sit between
// them where they sit on the microphone. It opens there while proposals wait. Editing a line
// edits its own transcript; search and Original work across both; previews still name the
// card in focus.
const base = process.env.VIRTUAL_CUT_TEST_ROOT;
assert(base, 'Run with the test suite so all media is disposable.');
const fixture = JSON.parse(await readFile(path.join(base, 'transcripts/latest.json'), 'utf8'));
await mkdir(path.join(base, 'combined-transcript'), { recursive: true });
const dir = await mkdtemp(path.join(base, 'combined-transcript/run-'));
const file = path.join(dir, 'combined.vcut');
await copyFile(fixture.file, file);
const { ProjectService } = require('../dist-electron/project-service.cjs');
const service = new ProjectService(path.join(dir, 'native-profile'), '');
await service.open(file);
const store = service.store;
const recording = store.data.model.recordings.find((r) => r.id === fixture.rid);
const fingerprint = store.sources().find((s) => s.id === fixture.rid).fingerprint;
const at = (share) => Math.round(recording.duration * share * 1000) / 1000;
const transcript = (id, role, track, lines) => {
  store.transcripts.begin({
    ...store.transcripts.get(fixture.transcriptId),
    id,
    role,
    track,
    state: 'complete',
    // Newer than the fixture's own transcripts, so Both reads these two.
    created: new Date(Date.now() + 1000).toISOString(),
    fingerprint,
    segmentCount: lines.length,
    wordCount: lines.length * 3,
  });
  lines.forEach(([share, text], i) => {
    const words = text.split(' ');
    const step = at(0.03) / words.length;
    store.transcripts.append(id, {
      id: i,
      start: at(share),
      end: at(share + 0.03),
      text,
      words: words.map((w, n) => ({
        text: `${n ? ' ' : ''}${w}`,
        start: at(share) + n * step,
        end: at(share) + (n + 1) * step,
        probability: 1,
      })),
      noSpeechProbability: 0,
      averageLogProbability: 0,
    });
  });
};
transcript('both-mic', 'mic', 2, [
  [0.1, 'Okay, into the fort.'],
  [0.4, 'That was a big reveal.'],
  [0.7, 'Split here.'],
]);
transcript('both-game', 'game', 1, [
  [0.2, 'Lapis: Hold the gate!'],
  [0.3, 'Bertrand: They are coming.'],
  [0.5, 'Lapis: The archive is ours.'],
]);
const proposal = (id, kind, time, extra = {}) => ({
  id,
  sourceId: fixture.rid,
  kind,
  time,
  title: id,
  text: '',
  reason: 'Combined view check.',
  evidence: [],
  agent: { clientId: 'combined-check', name: 'Claude Code' },
  submitted: new Date().toISOString(),
  submissionId: 'combined-check',
  projectRevision: store.data.revision,
  ...extra,
});
// The siege range starts between two game lines; the archive marker after the last one.
store.proposals.add([
  proposal('Gate siege', 'mark', at(0.25), { end: at(0.35) }),
  proposal('Archive taken', 'mark', at(0.55)),
]);
const before = store.data.model;
store.save(before, { ...before, cueDecisions: [] });
await service.checkpoint(fixture.id);
await service.close();

const errors = [];
let app, main;
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
  main = await app.firstWindow();
  main.setDefaultTimeout(20000);
  main.on('pageerror', (e) => errors.push(e.message));
  await main.locator('[data-workflow]').waitFor();
  await app.evaluate(({ dialog, BrowserWindow }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    const w = BrowserWindow.getAllWindows()[0];
    w.webContents.setAudioMuted(true);
    w.setSize(1600, 960);
  }, file);
  await main.getByRole('button', { name: 'Projects', exact: true }).click();
  await main.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await main
    .getByRole('navigation', { name: 'Workspace pages' })
    .getByRole('button', { name: 'Cut', exact: true })
    .click();
  const timeline = main.locator('[data-testid="combined-timeline"]');
  await expect(timeline.locator('[data-proposal-preview]')).toHaveCount(3);

  const opened = app.waitForEvent('window');
  await main.getByRole('button', { name: 'Transcript', exact: true }).click();
  const view = await opened;
  view.setDefaultTimeout(20000);
  view.on('pageerror', (e) => errors.push(e.message));
  // Proposals are waiting, so the window opens on Both.
  const picker = view.getByLabel('Select transcript', { exact: true });
  await expect(picker).toHaveValue('both');
  await expect(picker.locator('option').first()).toHaveText('Both · Microphone and game');
  const phrases = view.getByLabel('Transcript phrases');
  const rows = phrases.locator('article');
  await expect(rows).toHaveCount(6);
  // Time order across both, each line labelled with its own transcript.
  assert.deepEqual(await rows.evaluateAll((list) => list.map((r) => r.dataset.source)), [
    'mic',
    'game',
    'game',
    'mic',
    'game',
    'mic',
  ]);
  await expect(rows.nth(1).locator('[class*="source"]')).toHaveText('Game');
  await expect(rows.nth(0).locator('[class*="source"]')).toHaveText('Mic');
  await expect(rows.nth(1)).toHaveCSS('border-left-color', 'rgb(227, 166, 200)');
  await expect(rows.nth(0)).toHaveCSS('border-left-color', 'rgb(113, 215, 205)');
  // The spoken Split keeps its cue colour; its label still says Mic.
  await expect(rows.nth(5)).toHaveAttribute('data-cue', 'cut');
  await expect(rows.nth(5)).toHaveCSS('border-left-color', 'rgb(224, 143, 122)');
  // Cards sit in time order between the lines: the siege after the gate line, the archive
  // after the archive line.
  const order = await phrases.evaluate((list) =>
    [...list.querySelectorAll('article, [data-proposal-card]')]
      .filter((e) => !e.closest('article') || e.matches('article'))
      .map((e) => e.dataset.proposalCard || e.dataset.source),
  );
  assert.deepEqual(order, [
    'mic',
    'game',
    'Gate siege',
    'game',
    'mic',
    'game',
    'Archive taken',
    'mic',
  ]);
  await expect(view.locator('[data-filter="all"] span')).toHaveText('6');

  // Previews still name the card in focus with game lines between the microphone's.
  const card = (id) => view.locator(`[data-proposal-card="${id}"]`);
  const preview = (id) => timeline.locator(`[data-proposal-preview="${id}"]`);
  await card('Archive taken').hover({ position: { x: 40, y: 10 } });
  await expect(preview('Archive taken')).toHaveAttribute('data-focused', 'true');
  await expect(preview('Gate siege')).toHaveAttribute('data-focused', 'false');
  await view.mouse.move(2, 2);
  await card('Gate siege').locator('[class*="pcKind"]').click();
  await view.mouse.move(2, 2);
  await expect(card('Gate siege')).toHaveAttribute('data-picked', 'true');
  await expect(preview('Gate siege')).toHaveAttribute('data-focused', 'true');
  // N passes over the game lines to the next waiting card; Esc lets it go.
  await view.keyboard.press('n');
  await expect(card('Archive taken')).toHaveAttribute('data-picked', 'true');
  await expect(preview('Archive taken')).toHaveAttribute('data-focused', 'true');
  await expect(main.locator('[data-proposal-preview][data-focused="true"]')).toHaveCount(1);
  await view.keyboard.press('Escape');
  await expect(main.locator('[data-proposal-preview][data-focused="true"]')).toHaveCount(0);

  // The compact window keeps both labels and the card readable.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().endsWith('#transcript'))
      .setSize(620, 720),
  );
  await expect.poll(() => view.evaluate(() => window.innerWidth)).toBeLessThan(640);
  await view.evaluate(() => window.scrollTo(0, 0));
  const width = await view.evaluate(() => document.documentElement.scrollWidth);
  assert(width <= (await view.evaluate(() => window.innerWidth)), `no sideways scroll: ${width}`);
  await view.screenshot({ path: path.join(dir, 'both-compact.png'), fullPage: true });

  // Editing a game line edits the game transcript, not the microphone's.
  await rows.nth(1).getByRole('button', { name: 'gate!', exact: true }).dblclick();
  await view.getByLabel('Correct word').fill('door!');
  await view.getByLabel('Correct word').press('Enter');
  await expect(rows.nth(1).getByRole('button', { name: 'door!', exact: true })).toBeVisible();
  const edits = await view.evaluate(
    async () => (await window.virtualCut.transcript.session()).edits,
  );
  assert.deepEqual(
    edits.map((e) => [e.transcriptId, e.segmentId, e.wordIndex, e.text]),
    [['both-game', 0, 3, ' door!']],
  );
  // A microphone line with the same number is untouched.
  await expect(rows.nth(0)).toContainText('Okay, into the fort.');
  // Original shows the recognition on either source.
  await view.getByLabel('Original', { exact: true }).check();
  await expect(rows.nth(1).getByRole('button', { name: 'gate!', exact: true })).toBeVisible();
  await view.getByLabel('Original', { exact: true }).uncheck();
  // Search covers both, corrections included.
  await view.getByLabel('Search transcript').fill('door');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute('data-source', 'game');
  await view.getByLabel('Search transcript').fill('archive');
  await expect(rows).toHaveCount(1);
  await view.getByLabel('Search transcript').fill('');
  // A cue filter leaves the microphone's cues, with the cards waiting.
  await view.locator('[data-filter="pending"]').click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute('data-source', 'mic');
  await view.locator('[data-filter="all"]').click();
  await expect(rows).toHaveCount(6);

  // Microphone alone reads as before: no game lines and no labels. The game edit stays there.
  await picker.selectOption('both-mic');
  await expect(rows).toHaveCount(3);
  await expect(phrases.locator('article[data-source]')).toHaveCount(0);
  await expect(card('Gate siege')).toBeVisible();
  await picker.selectOption('both-game');
  await expect(rows).toHaveCount(3);
  await expect(rows.first().getByRole('button', { name: 'door!', exact: true })).toBeVisible();
  await picker.selectOption('both');
  await expect(rows).toHaveCount(6);
  await expect(view.getByRole('button', { name: /^Export/ })).toBeDisabled();
  assert.deepEqual(errors, []);
  await collectBeforeWindowClose(app);
  console.log(JSON.stringify({ passed: true, dir }));
} catch (e) {
  await main?.screenshot({ path: path.join(dir, 'failure.png') }).catch(() => {});
  console.error({ errors, dir });
  throw e;
} finally {
  if (app && app.process().exitCode === null) await app.close();
}
