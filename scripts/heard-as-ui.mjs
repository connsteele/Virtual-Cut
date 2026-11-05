// VC-194 heard-as spellings, end to end with a deterministic speech worker:
// - a new transcription hints the rows' game spellings and writes the corrections itself;
// - the Heard as list in the project context: Enter flow, problems after leaving a row, five rows
//   then a scroll, and the offer to apply the rows to older transcripts of the game;
// - the transcript window: header line, Original, the word's note, Restore original, main Undo.
// Screenshots: offer, problems, many rows, applied, keyboard focus, transcript, restored.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { require, root, electronEnvironment } from './shared.mjs';
const base = process.env.VIRTUAL_CUT_TEST_ROOT;
assert(base, 'Run with the test suite so all media is disposable.');
const fixture = JSON.parse(await readFile(path.join(base, 'transcripts/latest.json'), 'utf8'));
await mkdir(path.join(base, 'heard-as'), { recursive: true });
const dir = await mkdtemp(path.join(base, 'heard-as/run-'));
const file = path.join(dir, 'heard-as.vcut');
await copyFile(fixture.file, file);
const { ProjectService } = require('../dist-electron/project-service.cjs');

const game = { id: 'g-weave', name: 'Fortune’s Weave', vocabulary: 'Orchel, Theodora' };
const rows = [{ name: 'Cai', heard: ['Kai'] }];
const line = (id, start, text, extra = {}) => ({
  id,
  start,
  end: start + 3,
  text: ` ${text}`,
  words: text.split(' ').map((word, i, all) => ({
    text: ` ${word}`,
    start: start + (3 * i) / all.length,
    end: start + (3 * (i + 1)) / all.length,
    probability: 0.9,
  })),
  noSpeechProbability: 0,
  averageLogProbability: -0.2,
  ...extra,
});
// Real lines from the Battle copy (Sprint 11 hint check), with Kaiser to show a near miss.
const said = {
  game: [
    "Kai, I don't think it's as simple as that.",
    "Part 1 Kai's Path Chapter 5 Kai's Battle",
    'The Kaiser waits beyond the gate.',
  ],
  mic: [
    'This is starting the big main quest for Chapter 4 with Kai, I believe.',
    "It's the first time we see Orchel in the game on Kai's route.",
  ],
};

// 1. A new transcription with the rows set: hints carry Cai, and the corrections are written.
const service = new ProjectService(path.join(dir, 'native-profile'), '');
let snap = await service.open(file);
const id = snap.project.id,
  batch = snap.activeBatchId,
  rid = fixture.rid;
const store = service.store;
const context = (heardAs) => ({
  id: 'project',
  gameMode: 'set',
  briefMode: 'replace',
  brief: '',
  game: { ...game, ...(heardAs ? { heardAs } : {}) },
});
let model = store.data.model;
store.save(model, {
  ...model,
  contexts: [...(model.contexts || []).filter((c) => c.id !== 'project'), context(rows)],
});
const libraries = path.join(dir, 'libraries'),
  speechModel = path.join(dir, 'model');
await mkdir(path.join(libraries, 'faster_whisper'), { recursive: true });
await mkdir(speechModel);
await writeFile(path.join(speechModel, 'model.bin'), 'fixture');
service.transcription.settings = {
  python: process.execPath,
  libraries,
  model: speechModel,
  device: 'cpu',
  threads: 4,
};
const hints = [];
service.transcription.run = async (request, signal, receive) => {
  hints.push(request.vocabulary);
  const role = request.track === 1 ? 'game' : 'mic';
  receive({ type: 'info', device: 'cpu', language: 'en', duration: 15 });
  said[role].forEach((text, i) =>
    receive({ type: 'segment', segment: line(i, 1 + i * 4, text), progress: 0.5 }),
  );
  receive({ type: 'complete', guardRedos: 0 });
};
const earlier = new Set(snap.jobs.map((j) => j.id));
service.requestTranscription(id, rid, batch, {
  roles: ['game', 'mic'],
  language: 'en',
  vocabulary: true,
});
for (let until = Date.now() + 60000; ;) {
  snap = await service.snapshot();
  if (!snap.jobs.some((j) => ['queued', 'running'].includes(j.state))) break;
  assert(Date.now() < until, 'Fake transcription timed out.');
  await new Promise((r) => setTimeout(r, 100));
}
const fresh = snap.jobs.filter(
  (j) => j.kind === 'transcribe' && j.state === 'succeeded' && !earlier.has(j.id),
);
assert.equal(fresh.length, 2, JSON.stringify(snap.jobs));
assert.deepEqual(hints, ['Orchel, Theodora, Cai', 'Orchel, Theodora, Cai']);
const auto = store.data.model.transcriptEdits.filter((e) =>
  fresh.some((j) => j.id === e.transcriptId),
);
assert.equal(auto.length, 5);
assert.equal(auto.filter((e) => e.text === ' Cai,').length, 2);
assert.equal(auto.filter((e) => e.text === " Cai's").length, 3);
assert(auto.every((e) => e.heardAs === 'Kai'));
assert.deepEqual(store.transcripts.get(fresh[0].id).context.heardAs, rows);

// 2. Two older transcripts of the game (before the rows existed); one Kai corrected by hand.
const summary = store.transcripts.get(fixture.transcriptId);
const older = {};
for (const role of ['game', 'mic']) {
  const transcriptId = `vc194-${role}`;
  const lines = said[role].map((text, i) => line(i, 20 + i * 4, text));
  const transcript = {
    ...summary,
    id: transcriptId,
    role,
    segmentCount: lines.length,
    wordCount: lines.reduce((n, l) => n + l.words.length, 0),
    // The mic one was transcribed before any game was set (Connor's 4.2X project, 2026-11-05):
    // it still belongs to the game through its recording's batch.
    context:
      role === 'game'
        ? { gameId: game.id, gameName: game.name, vocabulary: game.vocabulary, brief: '' }
        : { vocabulary: '', brief: '' },
  };
  store.transcripts.begin(transcript);
  for (const l of lines) store.transcripts.append(transcriptId, l);
  store.transcripts.put({ ...transcript, state: 'complete' });
  older[role] = transcriptId;
}
model = store.data.model;
store.save(model, {
  ...model,
  contexts: [...model.contexts.filter((c) => c.id !== 'project'), context()],
  transcriptEdits: [
    ...model.transcriptEdits,
    {
      id: 'vc194-mic:1:11',
      transcriptId: 'vc194-mic',
      segmentId: 1,
      wordIndex: 11,
      text: ' Cai’s',
    },
  ],
});
// Only the older transcripts still say Kai; the new ones are already corrected.
assert.deepEqual((await service.heardAs(id, game.id, rows)).preview, {
  transcripts: 2,
  words: 4,
  own: 1,
  heard: ['Kai'],
});
await assert.rejects(service.heardAs(id, '', rows), /valid heard-as/);
await service.checkpoint(id);
await service.close();

let app;
const errors = [];
const shot = (page, name, locator) =>
  (locator || page).screenshot({ path: path.join(dir, `${name}.png`) });
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
  await main.setViewportSize({ width: 1280, height: 1000 });
  await main.locator('[data-workflow]').waitFor();
  await app.evaluate(({ dialog, BrowserWindow }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true);
  }, file);
  await main.getByRole('button', { name: 'Projects', exact: true }).click();
  await main.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await main.getByRole('button', { name: 'Projects', exact: true }).click();
  await main.getByText('Project game and video brief', { exact: true }).click();
  const project = main.getByRole('region', { name: 'Project context', exact: true }).last();
  const heardAs = project.getByRole('region', { name: /^Heard as/ });
  await expect(heardAs.getByLabel('Game spelling, row 1')).toHaveCount(0);
  // Keyboard: Add, type the game spelling, Enter to the heard-as box, then leave the list.
  await heardAs.getByRole('button', { name: 'Add a heard-as spelling', exact: true }).click();
  await expect(heardAs.getByLabel('Game spelling, row 1')).toBeFocused();
  await main.keyboard.type('Cai');
  await main.keyboard.press('Enter');
  await expect(heardAs.getByLabel('Heard as, row 1')).toBeFocused();
  await main.keyboard.type('Kai, Kye');
  await shot(main, 'keyboard-focus', heardAs);
  await project.getByLabel('Video brief (optional)').click();
  await expect(heardAs).toContainText('1 name');
  await expect(heardAs).toContainText('Kai’s becomes Cai’s');
  const offer = project.getByRole('status').filter({ hasText: 'still say Kai' });
  await expect(offer).toContainText(
    '4 words in 2 transcripts of Fortune’s Weave in this project still say Kai.',
  );
  await expect(offer).toContainText(
    '1 word you corrected or restored yourself stays as you left it.',
  );
  await shot(main, 'offer', project);
  // A two-word name stays a hint, a cue word is never replaced; named only after leaving the row.
  await heardAs.getByRole('button', { name: 'Add a heard-as spelling', exact: true }).click();
  await main.keyboard.type('Yu Phas');
  await main.keyboard.press('Enter');
  await main.keyboard.type('Euphos');
  await expect(heardAs).not.toContainText('one word for one word');
  await main.keyboard.press('Enter');
  await expect(heardAs.getByLabel('Game spelling, row 3')).toBeFocused();
  await main.keyboard.type('Marc');
  await main.keyboard.press('Enter');
  await main.keyboard.type('Mark');
  await project.getByLabel('Video brief (optional)').click();
  await expect(heardAs).toContainText(
    'Yu Phas heard as Euphos: heard-as works one word for one word for now, so Yu Phas is only a hint.',
  );
  await expect(heardAs).toContainText('Mark is a spoken cue word, so it is never replaced.');
  await expect(heardAs.getByLabel('Heard as, row 2')).toHaveClass(/bad/);
  await shot(main, 'problems', project);
  await heardAs.getByRole('button', { name: 'Remove Marc', exact: true }).click();
  await heardAs.getByRole('button', { name: 'Remove Yu Phas', exact: true }).click();
  // Many rows: five show, the rest scroll; Add stays in view.
  for (const [name, heard] of [
    ['Orchel', 'Archel'],
    ['Leda', 'Theodora'],
    ['Iliana', 'Illyana'],
    ['Tialla', 'Tiala'],
    ['Zarcone', 'Zarkone'],
  ]) {
    await heardAs.getByRole('button', { name: 'Add a heard-as spelling', exact: true }).click();
    await main.keyboard.type(name);
    await main.keyboard.press('Enter');
    await main.keyboard.type(heard);
  }
  await project.getByLabel('Video brief (optional)').click();
  await expect(heardAs).toContainText('6 names');
  await expect(heardAs).toContainText('Showing 5 of 6; scroll for the rest');
  await expect(heardAs).toContainText('Theodora is also in the names box');
  await expect(
    heardAs.getByRole('button', { name: 'Add a heard-as spelling', exact: true }),
  ).toBeInViewport();
  await shot(main, 'many-rows', project);
  await heardAs.getByRole('button', { name: 'Remove Leda', exact: true }).click();
  await project.getByLabel('Video brief (optional)').click();
  await expect(heardAs).not.toContainText('also in the names box');
  // Apply: one edit for both transcripts.
  await offer.getByRole('button', { name: 'Apply to 2 transcripts', exact: true }).click();
  await expect(project.getByRole('status').filter({ hasText: 'Applied' })).toContainText(
    'Applied to 2 transcripts: 4 words now say Cai.',
  );
  await shot(main, 'applied', project);
  await main.setViewportSize({ width: 900, height: 760 });
  await shot(main, 'applied-compact');
  await main.setViewportSize({ width: 1280, height: 1000 });
  await main.getByRole('button', { name: 'Close dialog', exact: true }).click();

  // Transcript window: the header names the spellings; Original shows Kai; restore one word.
  const opened = app.waitForEvent('window');
  await main.getByRole('button', { name: 'Transcript', exact: true }).click();
  const view = await opened;
  view.on('pageerror', (e) => errors.push(e.message));
  await view.setViewportSize({ width: 1000, height: 700 });
  await view.getByLabel('Select transcript', { exact: true }).selectOption(older.game);
  const phrases = view.getByLabel('Transcript phrases');
  const header = view.locator('[data-heard-as-used]');
  await expect(header).toContainText('heard-as spellings used: Kai → Cai (3 words)');
  await expect(phrases).toContainText("Part 1 Cai's Path Chapter 5 Cai's Battle");
  await expect(phrases).toContainText('The Kaiser waits beyond the gate.');
  const word = phrases.getByRole('button', { name: 'Cai,', exact: true });
  await expect(word).toHaveAttribute(
    'title',
    /original: Kai, · heard-as spelling from Fortune’s Weave’s names and terms/,
  );
  await view.locator('details summary').filter({ hasText: 'heard-as spellings used' }).click();
  await expect(view.locator('details')).toContainText('a restored word stays as heard');
  await shot(view, 'transcript');
  const original = view.getByLabel('Original', { exact: true });
  await original.check();
  await expect(phrases).toContainText("Kai, I don't think it's as simple as that.");
  await original.uncheck();
  // Wait for the corrected text to render again, so both clicks land on the same word
  // (CI once double-clicked "The" while the rows were still redrawing).
  await expect(phrases).toContainText("Cai, I don't think it's as simple as that.");
  await word.scrollIntoViewIfNeeded();
  await expect(word).toBeVisible();
  await word.dblclick();
  const hint = view.getByLabel('Transcript correction');
  await expect(hint).toContainText(
    'Original: Kai, · heard-as spelling from Fortune’s Weave’s names and terms',
  );
  await hint.getByRole('button', { name: 'Restore original' }).click();
  await expect(phrases).toContainText("Kai, I don't think it's as simple as that.");
  await expect(header).toContainText('heard-as spellings used: Kai → Cai (2 words)');
  await shot(view, 'restored');
  // Undo in the main window brings the correction back.
  await main.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(phrases).toContainText("Cai, I don't think it's as simple as that.");
  await main.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(header).toHaveCount(0);
  await expect(phrases).toContainText("Kai's Path");
  await main.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(header).toContainText('heard-as spellings used: Kai → Cai (3 words)');
  assert.deepEqual(errors, []);
  console.log(`Heard-as spellings passed: ${dir}`);
} catch (error) {
  if (app)
    for (const [i, page] of app.windows().entries())
      await writeFile(path.join(dir, `failure-${i}.html`), await page.content());
  throw error;
} finally {
  if (app) await app.close();
}
