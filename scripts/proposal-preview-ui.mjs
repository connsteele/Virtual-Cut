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
  // A band spans its range on the track; a line marks its point.
  const track = await timeline.locator('[data-testid="scrub-surface"]').boundingBox();
  const x = (t) => track.x + (track.width * t) / recording.duration;
  const box = await range.boundingBox();
  assert(Math.abs(box.x - x(at(0.15))) < 3, `band starts at its time: ${box.x}`);
  assert(Math.abs(box.x + box.width - x(at(0.4))) < 3, `band ends at its end: ${box.width}`);
  assert(box.height > track.height * 0.8, 'the band covers the track');
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
  // Keyboard focus: the card itself, then N to the next card waiting for review.
  await card('Siege scene').focus();
  await expect(range).toHaveAttribute('data-focused', 'true');
  await expect(range).toContainText('Agent · Range marker · Siege scene');
  await expect(main.locator('[data-proposal-preview][data-focused="true"]')).toHaveCount(1);
  await main.bringToFront();
  await timeline.screenshot({ path: path.join(dir, 'preview-range-focused.png') });
  await view.bringToFront();
  await card('Siege scene').focus();
  await view.keyboard.press('n');
  await expect(range).toHaveAttribute('data-focused', 'false');
  await expect(main.locator('[data-proposal-preview][data-focused="true"]')).toHaveCount(1);
  // Details open keep a preview bright after focus leaves the card.
  await card('cue:preview-mic:1').getByRole('button', { name: 'Details', exact: true }).click();
  await view.evaluate(() => document.activeElement?.blur());
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
  await card('cue:preview-mic:2').focus();
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
  await card('cue:preview-mic:1')
    .getByRole('button', { name: 'Hide details', exact: true })
    .click();
  await card('cue:preview-mic:1').getByRole('button', { name: 'Details', exact: true }).click();
  await view.evaluate(() => document.activeElement?.blur());
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

  // Deciding a proposal takes its preview off; accepted ones are real markers or clips.
  await view.bringToFront();
  await card('Siege scene')
    .getByRole('button', { name: 'Accept range marker', exact: true })
    .click();
  await expect(card('Siege scene')).toHaveAttribute('data-status', 'accepted');
  await expect(range).toHaveCount(0);
  await expect(timeline.locator('[data-marker-range]')).toHaveCount(1);
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
