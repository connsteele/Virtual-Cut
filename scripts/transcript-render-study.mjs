import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { require, root, electronEnvironment } from './shared.mjs';

// VC-29 note 28: fast playback stalled and the audio echoed while the Transcript window was open.
// This measures the window's main-thread time while the playhead moves, on a dense Both page with
// many corrections, so a change can be compared before and after. It is a study, not a gate.
const base = process.env.VIRTUAL_CUT_TEST_ROOT;
assert(
  base,
  'Run with VIRTUAL_CUT_TEST_ROOT set to a suite run that made transcripts/latest.json.',
);
const fixture = JSON.parse(await readFile(path.join(base, 'transcripts/latest.json'), 'utf8'));
await mkdir(path.join(base, 'transcript-render'), { recursive: true });
const dir = await mkdtemp(path.join(base, 'transcript-render/run-'));
const file = path.join(dir, 'render.vcut');
await copyFile(fixture.file, file);
const { ProjectService } = require('../dist-electron/project-service.cjs');
const service = new ProjectService(path.join(dir, 'native-profile'), '');
await service.open(file);
const store = service.store;
const recording = store.data.model.recordings.find((r) => r.id === fixture.rid);
const fingerprint = store.sources().find((s) => s.id === fixture.rid).fingerprint;
// The first page of a Both reading: 60 lines, 30 from each transcript, a dozen words each.
const lines = 60,
  wordsPerLine = 12,
  span = Math.min(recording.duration, 60);
const edits = [];
const transcript = (id, role, track, offset) => {
  store.transcripts.begin({
    ...store.transcripts.get(fixture.transcriptId),
    id,
    role,
    track,
    state: 'complete',
    created: new Date(Date.now() + 1000).toISOString(),
    fingerprint,
    segmentCount: lines,
    wordCount: lines * wordsPerLine,
  });
  for (let i = 0; i < lines; i++) {
    const start = ((i * 2 + offset) / (lines * 2)) * span,
      step = span / (lines * 2) / wordsPerLine;
    const words = Array.from({ length: wordsPerLine }, (_, n) => ({
      text: `${n ? ' ' : ''}word${n}`,
      start: start + n * step,
      end: start + (n + 1) * step,
      probability: 0.9,
    }));
    store.transcripts.append(id, {
      id: i,
      start,
      end: start + wordsPerLine * step,
      text: words.map((w) => w.text).join(''),
      words,
      noSpeechProbability: 0,
      averageLogProbability: 0,
    });
    // Heard-as corrections on every third word, as a game's names list makes them.
    for (let n = 0; n < wordsPerLine; n += 3)
      edits.push({
        id: `${id}:${i}:${n}`,
        transcriptId: id,
        segmentId: i,
        wordIndex: n,
        text: `${n ? ' ' : ''}Name${n}`,
        heardAs: `word${n}`,
      });
  }
};
transcript('render-mic', 'mic', 2, 0);
transcript('render-game', 'game', 1, 1);
// Corrections elsewhere in the transcripts (later pages) still sit in the session's list.
const extra = Number(process.env.STUDY_EXTRA_EDITS ?? 1500);
for (let i = 0; i < extra; i++)
  edits.push({
    id: `render-game:${1000 + i}:0`,
    transcriptId: 'render-game',
    segmentId: 1000 + i,
    wordIndex: 0,
    text: 'Name',
    heardAs: 'name',
  });
const before = store.data.model;
store.save(before, { ...before, transcriptEdits: edits, cueDecisions: [] });
await service.checkpoint(fixture.id);
await service.close();

let app;
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
  main.setDefaultTimeout(30000);
  await main.locator('[data-workflow]').waitFor();
  await app.evaluate(({ dialog, BrowserWindow }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true);
  }, file);
  await main.getByRole('button', { name: 'Projects', exact: true }).click();
  await main.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await main
    .getByRole('navigation', { name: 'Workspace pages' })
    .getByRole('button', { name: 'Cut', exact: true })
    .click();
  const opened = app.waitForEvent('window');
  await main.getByRole('button', { name: 'Transcript', exact: true }).click();
  const view = await opened;
  view.setDefaultTimeout(30000);
  await view.getByLabel('Select transcript', { exact: true }).selectOption('both');
  const rows = view.getByLabel('Transcript phrases').locator('article');
  // One page holds 60 lines: the first half of each transcript, interleaved.
  await expect(rows).toHaveCount(60);
  const { projectId, sourceId } = await view.evaluate(async () => {
    const s = await window.virtualCut.transcript.session();
    return { projectId: s.projectId, sourceId: s.sourceId };
  });
  // Main-thread time in the Transcript window per playhead update: the window's own busy time,
  // read as the delay of a zero-delay timer chain while updates arrive every ~120 ms.
  await view.evaluate(() => {
    const w = window;
    w.__busy = { samples: [] };
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      w.__busy.samples.push(now - last);
      last = now;
      w.__busy.timer = setTimeout(tick, 0);
    };
    tick();
  });
  const seconds = 10,
    updates = Math.round((seconds * 1000) / 120);
  const started = Date.now();
  for (let i = 0; i < updates; i++) {
    const time = (i / updates) * span * 0.48;
    await main.evaluate(
      ([p, s, t]) => window.virtualCut.transcript.position(p, s, t),
      [projectId, sourceId, time],
    );
    await new Promise((r) => setTimeout(r, Math.max(0, started + (i + 1) * 120 - Date.now())));
  }
  const busy = await view.evaluate(() => {
    clearTimeout(window.__busy.timer);
    const gaps = window.__busy.samples.slice(1);
    const blocked = gaps.filter((g) => g > 8);
    return {
      blockedMs: Math.round(blocked.reduce((a, b) => a + b, 0)),
      longest: Math.round(Math.max(...gaps)),
      blocks: blocked.length,
    };
  });
  const active = await view.locator('[data-active-word="true"]').count();
  const result = {
    dir,
    rows: 60,
    edits: edits.length,
    updates,
    seconds,
    transcriptBusyMs: busy.blockedMs,
    busyShare: Math.round((busy.blockedMs / (seconds * 1000)) * 1000) / 10,
    longestBlockMs: busy.longest,
    blocks: busy.blocks,
    activeWords: active,
  };
  await writeFile(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  if (app && app.process().exitCode === null) await app.close();
}
