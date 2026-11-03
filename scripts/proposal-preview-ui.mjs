import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { require, root, electronEnvironment } from './shared.mjs';
import { collectBeforeWindowClose } from './coverage-desktop.mjs';

// VC-170: every pending proposal for the recording on screen shows faintly on the main
// timeline, a band for ranges and clip ranges and a line for the rest, in the proposer's
// colour. Focusing its card in the Transcript window brightens it; deciding it takes it off.
// The previews are read-only: clicks and keys reach the timeline beneath.
const base = process.env.VIRTUAL_CUT_TEST_ROOT;
assert(base, 'Run with the test suite so all media is disposable.');
const fixture = JSON.parse(await readFile(path.join(base, 'transcripts/latest.json'), 'utf8'));
await mkdir(path.join(base, 'proposal-preview'), { recursive: true });
const dir = await mkdtemp(path.join(base, 'proposal-preview/run-'));
const file = path.join(dir, 'previews.vcut');
await copyFile(fixture.file, file);
const { ProjectService } = require('../dist-electron/project-service.cjs');
const service = new ProjectService(path.join(dir, 'native-profile'), '');
await service.open(file);
const store = service.store;
const recording = store.data.model.recordings.find((r) => r.id === fixture.rid);
const fingerprint = store.sources().find((s) => s.id === fixture.rid).fingerprint;
const at = (share) => Math.round(recording.duration * share * 1000) / 1000;
// Spoken: a Split, and a clip range said as a start and an end.
const lines = [
  [0.05, 'Okay, starting the fort chapter.'],
  [0.62, 'Split here.'],
  [0.7, 'Clip start, siege begins.'],
  [0.9, 'Clip end.'],
];
store.transcripts.begin({
  ...store.transcripts.get(fixture.transcriptId),
  id: 'preview-mic',
  role: 'mic',
  state: 'complete',
  fingerprint,
  segmentCount: lines.length,
  wordCount: lines.length,
});
lines.forEach(([share, text], i) =>
  store.transcripts.append('preview-mic', {
    id: i,
    start: at(share),
    end: at(share + 0.04),
    text,
    words: [{ text, start: at(share), end: at(share + 0.04), probability: 1 }],
    noSpeechProbability: 0,
    averageLogProbability: 0,
  }),
);
const proposal = (id, kind, time, extra = {}) => ({
  id,
  sourceId: fixture.rid,
  kind,
  time,
  title: id,
  text: '',
  reason: 'Preview check.',
  evidence: [],
  agent: { clientId: 'preview-check', name: 'Claude Code' },
  submitted: new Date().toISOString(),
  submissionId: 'preview-check',
  projectRevision: store.data.revision,
  ...extra,
});
store.proposals.add([
  proposal('Siege scene', 'mark', at(0.15), { end: at(0.4) }),
  proposal('Bertrand arrives', 'mark', at(0.45)),
  proposal('Fort split', 'cut', at(0.5), { names: { first: 'Fort', second: 'Siege' } }),
  proposal('Music note', 'note', at(0.55)),
]);
const before = store.data.model;
store.save(before, {
  ...before,
  cueDecisions: [],
  clips: [
    {
      id: 'whole',
      rid: fixture.rid,
      name: 'Whole session',
      start: 0,
      end: recording.duration,
      include: true,
      folder: '_Review',
    },
  ],
});
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
  const previews = timeline.locator('[data-proposal-preview]');
  const preview = (card) => timeline.locator(`[data-proposal-preview="${card}"]`);
  // Four from the agent, the spoken Split, and the spoken clip range as one band.
  await expect(previews).toHaveCount(6);
  await expect(timeline.locator('[data-proposal-count]')).toHaveText('6 proposals waiting');
  const kinds = await previews.evaluateAll((list) =>
    list.map((p) => [p.dataset.proposalPreview, p.dataset.proposalKind, p.dataset.who]),
  );
  assert.deepEqual(kinds, [
    ['Siege scene', 'range', 'agent'],
    ['Bertrand arrives', 'marker', 'agent'],
    ['Fort split', 'split', 'agent'],
    ['Music note', 'note', 'agent'],
    ['cue:preview-mic:1', 'split', 'spoken'],
    ['cue:preview-mic:2', 'clip', 'spoken'],
  ]);
  const range = preview('Siege scene'),
    spokenSplit = preview('cue:preview-mic:1'),
    spokenClip = preview('cue:preview-mic:2');
  // A band spans its range in the ruler; a Split's line cuts through the track.
  const track = await timeline.locator('[data-testid="scrub-surface"]').boundingBox();
  const x = (t) => track.x + (track.width * t) / recording.duration;
  const box = await range.boundingBox();
  assert(Math.abs(box.x - x(at(0.15))) < 3, `band starts at its time: ${box.x}`);
  assert(Math.abs(box.x + box.width - x(at(0.4))) < 3, `band ends at its end: ${box.width}`);
  assert(box.height <= 35 && box.y < track.y + 2, `a band sits in the ruler: ${box.height}`);
  assert((await spokenSplit.boundingBox()).width <= 4, 'a Split is a line');
  await expect(spokenClip).toHaveCSS('border-left-color', 'rgba(211, 178, 107, 0.85)');
  await expect(range).toHaveCSS('border-left-color', 'rgba(143, 123, 216, 0.85)');
  await expect(range).toHaveCSS('opacity', '0.3');
  await timeline.screenshot({ path: path.join(dir, 'preview-faint.png') });
  // Read-only: a click on the band seeks the filmstrip beneath it.
  const strip = await timeline.locator('[data-seek-surface="filmstrip"]').boundingBox();
  await main.mouse.click(x(at(0.3)), strip.y + strip.height / 2);
  await expect
    .poll(async () =>
      Math.abs((await main.locator('video').evaluate((v) => v.currentTime)) - at(0.3)),
    )
    .toBeLessThan(0.3);

  const opened = app.waitForEvent('window');
  await main.getByRole('button', { name: 'Transcript', exact: true }).click();
  const view = await opened;
  view.on('pageerror', (e) => errors.push(e.message));
  await view.getByLabel('Select transcript', { exact: true }).selectOption('preview-mic');
  const card = (id) => view.locator(`[data-proposal-card="${id}"]`);
  await expect(card('Siege scene')).toBeVisible();
  await expect(main.locator('[data-proposal-preview][data-focused="true"]')).toHaveCount(0);
  // At rest every preview is dim. Hovering anywhere on a card brings its preview to full
  // strength; leaving dims it again.
  await card('cue:preview-mic:1').hover({ position: { x: 40, y: 10 } });
  await expect(spokenSplit).toHaveAttribute('data-focused', 'true');
  await expect(spokenSplit).toContainText('Spoken · Split');
  await expect(range).toHaveCSS('opacity', '0.3');
  await expect(spokenSplit).toHaveCSS('opacity', '1');
  await view.mouse.move(2, 2);
  await expect(spokenSplit).toHaveAttribute('data-focused', 'false');
  await expect(range).toHaveCSS('opacity', '0.3');
  await expect(spokenSplit).toHaveCSS('opacity', '0.3');
  // Clicking the card itself picks it: a full outline in the proposer's colour, and its preview
  // stays lit after the pointer leaves, and while you look at the main window.
  const pick = (id) => card(id).locator('[class*="pcKind"]').click();
  await pick('Siege scene');
  await view.mouse.move(2, 2);
  await expect(card('Siege scene')).toHaveAttribute('data-picked', 'true');
  await expect(card('Siege scene')).toHaveCSS('outline-color', 'rgb(143, 123, 216)');
  await card('Siege scene').screenshot({ path: path.join(dir, 'card-picked.png') });
  await expect(range).toHaveAttribute('data-focused', 'true');
  await expect(range).toContainText('Agent · Range marker · Siege scene');
  await expect(main.locator('[data-proposal-preview][data-focused="true"]')).toHaveCount(1);
  await main.bringToFront();
  await expect(range).toHaveAttribute('data-focused', 'true');
  await timeline.screenshot({ path: path.join(dir, 'preview-range-focused.png') });
  // N picks the next card waiting for review; Esc lets the pick go.
  await view.bringToFront();
  await card('Siege scene').focus();
  await view.keyboard.press('n');
  await expect(range).toHaveAttribute('data-focused', 'false');
  await expect(main.locator('[data-proposal-preview][data-focused="true"]')).toHaveCount(1);
  const picked = view.locator('[data-proposal-card][data-picked="true"]');
  await expect(picked).toHaveCount(1);
  await view.keyboard.press('Escape');
  await expect(main.locator('[data-proposal-preview][data-focused="true"]')).toHaveCount(0);
  // Esc lets go entirely: no outline and no focus ring left behind.
  await expect(picked).toHaveCount(0);
  assert.equal(
    await view.evaluate(() => document.activeElement?.closest('[data-proposal-card]')),
    null,
  );
  // Opening details or using a card's buttons doesn't pick it.
  await card('cue:preview-mic:1').getByRole('button', { name: 'Details', exact: true }).click();
  await view.mouse.move(2, 2);
  await expect(card('cue:preview-mic:1')).toHaveAttribute('data-picked', 'false');
  await expect(spokenSplit).toHaveAttribute('data-focused', 'false');
  // A Split cuts through the track; a marker sits above it in the ruler, a note outlined.
  const marker = preview('Bertrand arrives');
  const shape = await marker.locator('i').boundingBox();
  assert(shape.height < 30 && shape.y < track.y + 34, `a marker sits in the ruler: ${shape.y}`);
  assert((await spokenSplit.boundingBox()).height > track.height * 0.8, 'a Split cuts through');
  await card('Bertrand arrives').hover({ position: { x: 40, y: 10 } });
  await expect(marker).toHaveAttribute('data-focused', 'true');
  await main.bringToFront();
  await timeline.screenshot({ path: path.join(dir, 'preview-marker-focused.png') });
  await view.bringToFront();
  await pick('cue:preview-mic:1');
  await view.mouse.move(2, 2);
  await expect(spokenSplit).toHaveAttribute('data-focused', 'true');
  await main.bringToFront();
  await timeline.screenshot({ path: path.join(dir, 'preview-split-focused.png') });

  // Zoomed in, a focused proposal out of view pans the timeline to it; the playhead stays.
  const scrubber = timeline.locator('[data-testid="scrub-surface"]');
  for (let i = 0; i < 4; i++)
    await timeline.getByRole('button', { name: 'Zoom in timeline', exact: true }).click();
  const viewEnd = Number(await scrubber.getAttribute('data-view-end'));
  assert(viewEnd < at(0.7), `zoomed in before the clip band: ${viewEnd}`);
  const playhead = await main.locator('video').evaluate((v) => v.currentTime);
  await view.bringToFront();
  // Hovering only lights the preview; the view stays where it is.
  await card('cue:preview-mic:2').hover({ position: { x: 40, y: 10 } });
  await main.waitForTimeout(300);
  await expect(spokenClip).toHaveCount(0);
  assert.equal(Number(await scrubber.getAttribute('data-view-end')), viewEnd, 'hover does not pan');
  await pick('cue:preview-mic:2');
  await view.mouse.move(2, 2);
  await expect(spokenClip).toHaveAttribute('data-focused', 'true');
  await expect
    .poll(async () => Number(await scrubber.getAttribute('data-view-start')))
    .toBeLessThanOrEqual(at(0.7));
  assert(Number(await scrubber.getAttribute('data-view-end')) > at(0.7), 'the band is in view');
  assert.equal(await main.locator('video').evaluate((v) => v.currentTime), playhead);
  await main.bringToFront();
  // Zoomed in, the filmstrip may still be making tiles, so the timeline never settles for an
  // element screenshot; capture its area of the window instead.
  await main.screenshot({
    path: path.join(dir, 'preview-panned.png'),
    clip: await timeline.boundingBox(),
  });
  await timeline.getByRole('button', { name: 'Fit full recording' }).click();
  await view.bringToFront();
  await pick('cue:preview-mic:1');
  await view.mouse.move(2, 2);
  await expect(spokenSplit).toHaveAttribute('data-focused', 'true');

  // The compact window keeps every preview on the track, and the track keeps arrow keys.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => !w.webContents.getURL().endsWith('#transcript'))
      .setSize(1120, 760),
  );
  await expect.poll(() => main.evaluate(() => window.innerWidth)).toBeLessThan(1130);
  const compact = await timeline.locator('[data-testid="scrub-surface"]').boundingBox();
  for (const p of await previews.all()) {
    const b = await p.boundingBox();
    assert(b.x >= compact.x - 1 && b.x + b.width <= compact.x + compact.width + 1);
  }
  await expect(spokenSplit).toHaveAttribute('data-focused', 'true');
  await timeline.screenshot({ path: path.join(dir, 'preview-compact.png') });
  const scrub = timeline.locator('[data-testid="scrub-surface"]');
  await scrub.focus();
  const was = await main.locator('video').evaluate((v) => v.currentTime);
  await main.keyboard.press('Shift+ArrowRight');
  await expect
    .poll(async () => (await main.locator('video').evaluate((v) => v.currentTime)) - was)
    .toBeGreaterThan(0.5);

  // VC-174: a nudge on a card being edited moves its preview live, before anything is accepted;
  // the preview stays lit while the field has keyboard focus, and Esc puts it back.
  await view.bringToFront();
  const markerAt = async () => {
    const b = await marker.boundingBox();
    return ((b.x + b.width / 2 - compact.x) / compact.width) * recording.duration;
  };
  const markerWas = await markerAt();
  await card('Bertrand arrives').getByRole('button', { name: 'Edit', exact: true }).click();
  const field = view.getByLabel('Proposal position Bertrand arrives', { exact: true });
  await field.focus();
  await view.mouse.move(2, 2);
  for (let i = 0; i < 5; i++) await view.keyboard.press('Shift+ArrowUp');
  await expect(marker).toHaveAttribute('data-focused', 'true');
  await expect.poll(async () => (await markerAt()) - markerWas).toBeGreaterThan(4.5);
  assert((await markerAt()) - markerWas < 5.5, 'the preview moved by the nudge');
  await view.getByLabel('Proposal position Bertrand arrives −1 s', { exact: true }).click();
  await expect.poll(async () => (await markerAt()) - markerWas).toBeLessThan(4.5);
  await main.bringToFront();
  await timeline.screenshot({ path: path.join(dir, 'preview-nudged.png') });
  await view.bringToFront();
  await field.focus();
  await view.keyboard.press('Escape');
  await expect.poll(async () => Math.abs((await markerAt()) - markerWas)).toBeLessThan(0.3);
  // Let go: the pointer off every card and keyboard focus out of this one.
  await view.getByLabel('Select transcript', { exact: true }).hover();
  await view.evaluate(() => document.activeElement?.blur());
  await expect(marker).toHaveAttribute('data-focused', 'false');

  // VC-184: only the picked card's preview can be dragged. Hovering a card lights its preview
  // but gives it no handles.
  const grabs = (p) => p.locator('[data-proposal-grab]');
  const timeOf = (px) => ((px - compact.x) / compact.width) * recording.duration;
  await card('Siege scene').hover({ position: { x: 40, y: 10 } });
  await expect(range).toHaveAttribute('data-focused', 'true');
  await expect(grabs(range)).toHaveCount(0);
  await pick('Siege scene');
  await view.mouse.move(2, 2);
  await expect(grabs(range)).toHaveCount(2);
  const proposedSpan = await card('Siege scene').locator('[class*="pcTimes"]').innerText();
  await main.bringToFront();
  const bandWas = await range.boundingBox();
  const endGrab = await range.locator('[data-proposal-grab="end"]').boundingBox();
  const grabY = endGrab.y + endGrab.height / 2;
  // Esc during a drag puts the edge back, and the card never hears of it.
  await main.mouse.move(endGrab.x + endGrab.width / 2, grabY);
  await main.mouse.down();
  await main.mouse.move(endGrab.x + endGrab.width / 2 + 70, grabY, { steps: 6 });
  await expect(range).toHaveAttribute('data-dragging', 'true');
  await expect
    .poll(async () => (await range.boundingBox()).width - bandWas.width)
    .toBeGreaterThan(60);
  await timeline.screenshot({ path: path.join(dir, 'preview-dragging.png') });
  await main.keyboard.press('Escape');
  await expect
    .poll(async () => Math.abs((await range.boundingBox()).width - bandWas.width))
    .toBeLessThan(2);
  await main.mouse.up();
  await main.waitForTimeout(200);
  await expect(card('Siege scene').locator('[data-proposal-was]')).toHaveCount(0);
  assert.equal(await card('Siege scene').locator('[class*="pcTimes"]').innerText(), proposedSpan);
  // Dropped, the card takes the new end and shows the proposed span beside it.
  await main.mouse.move(endGrab.x + endGrab.width / 2, grabY);
  await main.mouse.down();
  await main.mouse.move(endGrab.x + endGrab.width / 2 + 70, grabY, { steps: 6 });
  await main.mouse.up();
  const droppedEnd = timeOf(endGrab.x + endGrab.width / 2 + 70);
  await expect(card('Siege scene').locator('[data-proposal-was]')).toHaveText(
    `was ${proposedSpan.replace(/\s+/g, ' ').trim()}`,
  );
  await expect
    .poll(async () => (await range.boundingBox()).width - bandWas.width)
    .toBeGreaterThan(60);
  await expect(range).toHaveAttribute('data-dragging', 'false');
  await expect(range).toHaveAttribute('data-focused', 'true');
  await timeline.screenshot({ path: path.join(dir, 'preview-dragged.png') });
  await view.bringToFront();
  await card('Siege scene').screenshot({ path: path.join(dir, 'card-dragged.png') });
  // The start edge snaps to the playhead like any edge in Cut.
  await main.bringToFront();
  const playheadNow = await main.locator('video').evaluate((v) => v.currentTime);
  const startGrab = await range.locator('[data-proposal-grab="start"]').boundingBox();
  await main.mouse.move(startGrab.x + startGrab.width / 2, grabY);
  await main.mouse.down();
  const towards = compact.x + (compact.width * playheadNow) / recording.duration;
  await main.mouse.move(towards + 4, grabY, { steps: 8 });
  await expect(timeline.locator('[data-snap-guide]')).toHaveCount(1);
  await main.mouse.up();
  await expect(timeline.locator('[data-snap-guide]')).toHaveCount(0);
  await expect
    .poll(async () => Math.abs(timeOf((await range.boundingBox()).x) - playheadNow))
    .toBeLessThan(0.2);
  // A Split moves by its line.
  await view.bringToFront();
  await pick('Fort split');
  await view.mouse.move(2, 2);
  const split = preview('Fort split');
  await expect(grabs(split)).toHaveCount(1);
  await main.bringToFront();
  const line = await split.locator('[data-proposal-grab]').boundingBox();
  const splitWas = await split.boundingBox();
  const lineY = line.y + line.height * 0.75;
  await main.mouse.move(line.x + line.width / 2, lineY);
  await main.mouse.down();
  await main.mouse.move(line.x + line.width / 2 - 50, lineY, { steps: 6 });
  await main.mouse.up();
  await expect(card('Fort split').locator('[data-proposal-was]')).toBeVisible();
  await expect.poll(async () => splitWas.x - (await split.boundingBox()).x).toBeGreaterThan(40);
  // Ctrl+Z on the card puts a drop back.
  await view.bringToFront();
  await card('Fort split').focus();
  await view.keyboard.press('Control+z');
  await expect(card('Fort split').locator('[data-proposal-was]')).toHaveCount(0);
  await expect
    .poll(async () => Math.abs(splitWas.x - (await split.boundingBox()).x))
    .toBeLessThan(3);
  await view.keyboard.press('Escape');

  // Deciding a proposal takes its preview off; accepted ones are real markers or clips.
  await view.bringToFront();
  await card('Siege scene')
    .getByRole('button', { name: 'Accept as range marker', exact: true })
    .click();
  await expect(card('Siege scene')).toHaveAttribute('data-status', 'accepted');
  await expect(range).toHaveCount(0);
  await expect(timeline.locator('[data-marker-range]')).toHaveCount(1);
  // Accepting used the dragged times (VC-184).
  const made = await timeline.locator('[data-marker-range]').boundingBox();
  assert(
    Math.abs(timeOf(made.x + made.width) - droppedEnd) < 0.6,
    `the range marker ends where the edge was dropped: ${timeOf(made.x + made.width)} vs ${droppedEnd}`,
  );
  assert(Math.abs(timeOf(made.x) - playheadNow) < 0.6, 'and starts where it snapped');
  await card('Music note').getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(preview('Music note')).toHaveCount(0);
  await card('cue:preview-mic:1').getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(spokenSplit).toHaveCount(0);
  await expect(previews).toHaveCount(3);
  await expect(timeline.locator('[data-proposal-count]')).toHaveText('3 proposals waiting');
  // Reopening brings it back; Undo in the editor reverses the reopen, as on the card.
  await card('Music note').getByRole('button', { name: 'Reopen', exact: true }).click();
  await expect(preview('Music note')).toHaveCount(1);
  await main.bringToFront();
  await main.keyboard.press('Control+z');
  await expect(card('Music note')).toHaveAttribute('data-status', 'rejected');
  await expect(preview('Music note')).toHaveCount(0);

  // With the transcript window closed, nothing stays bright.
  await card('cue:preview-mic:2').getByTitle('Go to the start', { exact: true }).hover();
  await expect(spokenClip).toHaveAttribute('data-focused', 'true');
  await view.close();
  await expect(spokenClip).toHaveAttribute('data-focused', 'false');
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
