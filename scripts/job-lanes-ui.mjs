// VC-145 desktop check with the real speech engine: in the app window, start a transcription,
// then import a recording and export clips while it runs; pause and cancel the transcription
// while an export runs. Saves a screenshot of each step. Needs disposable copies and the local
// speech engine, so it is not part of the suite.
//
//   VIRTUAL_CUT_LANES_UI_OUTPUT   output folder (required)
//   VIRTUAL_CUT_LANES_UI          JSON {transcribe, imported, role?, device?, clipSeconds?}
//   VIRTUAL_CUT_ASR_*             the local speech engine; VIRTUAL_CUT_TEST_EXECUTABLE optional
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { _electron as electron } from 'playwright/test';
import { expect } from './desktop-expect.mjs';
import { electronEnvironment, require, root } from './shared.mjs';

const out = process.env.VIRTUAL_CUT_LANES_UI_OUTPUT;
const options = JSON.parse(process.env.VIRTUAL_CUT_LANES_UI || '{}');
if (!out || !options.transcribe || !options.imported)
  throw Error('Set VIRTUAL_CUT_LANES_UI_OUTPUT and VIRTUAL_CUT_LANES_UI {transcribe, imported}.');
for (const file of [options.transcribe, options.imported])
  if (/^[iI]:/.test(path.resolve(file)))
    throw Error('Use disposable copies, never the original recordings on I:.');
const project = path.join(out, 'lanes-check.vcut'),
  outputs = path.join(out, 'outputs'),
  shots = path.join(out, 'screenshots');

// Prepare the project natively: one inspected recording with a clip to export.
if (process.argv[2] === '--prepare') {
  const { ProjectService } = require('../dist-electron/project-service.cjs');
  const service = new ProjectService(path.join(out, 'prepare-profile'), '');
  const snap = await service.open(project, {
    name: 'Job lanes check',
    destination: outputs,
    cache: path.join(out, 'cache'),
  });
  await service.importFiles(snap.project.id, snap.activeBatchId, [options.transcribe], {
    game: 1,
    mic: 2,
  });
  while (service.store.jobs().some((j) => ['queued', 'running'].includes(j.state)))
    await new Promise((r) => setTimeout(r, 100));
  const before = structuredClone(service.store.data.model),
    after = structuredClone(before),
    clip = after.clips[0];
  Object.assign(clip, {
    start: 0,
    end: Math.min(options.clipSeconds || 300, after.recordings[0].duration),
    name: 'Lanes check clip',
  });
  after.selectedRecordingId = clip.rid;
  await service.save(snap.project.id, before, after);
  await service.close();
  process.exit(0);
}

await mkdir(outputs, { recursive: true });
await mkdir(shots, { recursive: true });
const executable = process.env.VIRTUAL_CUT_TEST_EXECUTABLE;
await new Promise((resolve, reject) => {
  const p = spawn(require('electron'), [path.join(root, 'scripts/job-lanes-ui.mjs'), '--prepare'], {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
  });
  p.on('error', reject);
  p.on('exit', (code) => (code ? reject(Error('Prepare failed')) : resolve()));
});

const app = await electron.launch({
  executablePath: executable || require('electron'),
  args: [
    ...(executable ? [] : [root]),
    `--user-data-dir=${path.join(out, 'profile')}`,
    '--background-test',
  ],
  cwd: root,
  env: electronEnvironment(),
});
const errors = [],
  report = { options, steps: [] };
const page = await app.firstWindow();
page.setDefaultTimeout(30000);
page.on('pageerror', (e) => errors.push(e.message));
const state = () => page.evaluate(() => window.virtualCut.project.current());
const jobs = async () => (await state()).jobs;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let shot = 0;
async function capture(name, titlePart = '') {
  const image = await app.evaluate(async ({ BrowserWindow }, part) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      part ? w.getTitle().includes(part) : !w.getTitle().startsWith('Transcript'),
    );
    const wc = win.webContents;
    await wc.capturePage(undefined, { stayHidden: true, stayAwake: true });
    await new Promise((r) => setTimeout(r, 200));
    return (await wc.capturePage(undefined, { stayHidden: true, stayAwake: true }))
      .toPNG()
      .toString('base64');
  }, titlePart);
  const file = `${String(++shot).padStart(2, '0')}-${name}.png`;
  await writeFile(path.join(shots, file), Buffer.from(image, 'base64'));
  return file;
}
const step = (name, data) => {
  report.steps.push({ name, at: new Date().toISOString(), ...data });
  console.log(name, JSON.stringify(data));
};
/** Milliseconds from now until a job matching `pick` leaves the queue. */
async function startDelay(pick, limit = 10000) {
  const began = performance.now();
  for (const end = began + limit; performance.now() < end; await sleep(20)) {
    const job = (await jobs()).find(pick);
    if (job && job.state !== 'queued') return Math.round(performance.now() - began);
  }
  throw Error('Job did not start within ' + limit + ' ms');
}
const transcription = async () => (await jobs()).find((j) => j.kind === 'transcribe');
async function openJobs(name) {
  await page.getByRole('button', { name: /^Jobs/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Media jobs' });
  await expect(dialog).toBeVisible();
  await sleep(300);
  const file = await capture(name);
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  return file;
}
let exportCount = 0;
async function exportClip() {
  const nav = page.getByRole('navigation', { name: 'Workspace pages' });
  await nav.getByRole('button', { name: 'Cut', exact: true }).click();
  await page.getByRole('button', { name: 'Export selected clip', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export selected clip', exact: true });
  await dialog.getByRole('checkbox', { name: /game track is clean/ }).check();
  const file = path.join(outputs, `Lanes check export ${++exportCount}.mkv`);
  await dialog.getByLabel('Export container').selectOption('mkv');
  await app.evaluate(({ dialog }, f) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: f });
  }, file);
  const before = new Set((await jobs()).filter((j) => j.kind === 'export').map((j) => j.id));
  await dialog.getByRole('button', { name: 'Choose output file…' }).click();
  const isNew = (j) => j.kind === 'export' && !before.has(j.id);
  const delay = await startDelay(isNew);
  const id = (await jobs()).find(isNew).id;
  // Starting an export opens the Exports list; close it so the next step can use the page.
  const history = page.getByRole('dialog', { name: 'Exports', exact: true });
  await expect(history).toBeVisible();
  await history.getByRole('button', { name: 'Close dialog' }).click();
  return { id, delay, file };
}
const exportState = async (id) => (await state()).exports.find((e) => e.plan.id === id)?.state;
async function exportFinishes(id) {
  for (const end = Date.now() + 180000; Date.now() < end; await sleep(200)) {
    const s = await exportState(id);
    if (!['queued', 'running'].includes(s)) return s;
  }
  throw Error('Export did not finish');
}
try {
  await app.evaluate(({ dialog, BrowserWindow }, file) => {
    BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, project);
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Open project file…', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Transcript', exact: true })).toBeEnabled();
  const selected = (await state()).model.selectedRecordingId;

  // 1. Start a transcription in the Transcript window.
  const next = app.waitForEvent('window');
  await page.getByRole('button', { name: 'Transcript', exact: true }).click();
  const transcript = await next;
  transcript.setDefaultTimeout(30000);
  transcript.on('pageerror', (e) => errors.push(e.message));
  await expect(transcript).toHaveTitle(/^Transcript · /);
  await transcript.getByRole('button', { name: 'Transcribe', exact: true }).click();
  const start = transcript.getByRole('region', { name: 'Start transcription' });
  await start.getByLabel('Transcribe audio').selectOption(options.role || 'game');
  await start.getByLabel('Processing device').selectOption(options.device || 'cpu');
  await expect(start.getByRole('button', { name: 'Start transcription' })).toBeEnabled();
  await start.getByRole('button', { name: 'Start transcription' }).click();
  await startDelay((j) => j.kind === 'transcribe');
  await sleep(1500);
  step('Transcription started', { message: (await transcription()).message });
  report.shots = { started: await capture('transcription-running', 'Transcript') };

  // 2. Import another recording while it runs.
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, options.imported);
  await page.getByRole('button', { name: 'Import files', exact: true }).click();
  await page.getByRole('button', { name: 'Choose files…', exact: true }).click();
  const importDelay = await startDelay((j) => j.kind === 'inspect');
  step('Import started', {
    importDelayMs: importDelay,
    transcription: (await transcription()).state,
  });
  await sleep(500);
  report.shots.importBeside = await openJobs('jobs-import-beside-transcription');
  // Wait for the import to finish, still beside the transcription.
  for (const end = Date.now() + 120000; Date.now() < end; await sleep(200)) {
    const all = await jobs();
    if (!all.some((j) => j.kind !== 'transcribe' && ['queued', 'running'].includes(j.state))) break;
  }
  const imported = (await state()).model.recordings.find((r) => r.id !== selected);
  step('Import finished', {
    availability: imported?.availability,
    transcription: (await transcription()).state,
    selectedStill: (await state()).model.selectedRecordingId === selected,
  });

  // 3. Export a clip of the recording being transcribed.
  const first = await exportClip();
  step('Export 1 started', { delayMs: first.delay, transcription: (await transcription()).state });
  await sleep(1000);
  report.shots.exportBeside = await openJobs('jobs-export-beside-transcription');
  const firstState = await exportFinishes(first.id);
  step('Export 1 finished', { state: firstState, transcription: (await transcription()).state });

  // 4. Pause the transcription while an export runs; the export carries on.
  const second = await exportClip();
  await sleep(500);
  await transcript.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect.poll(async () => (await transcription()).state).toBe('interrupted');
  step('Paused during export 2', {
    delayMs: second.delay,
    exportAtPause: await exportState(second.id),
  });
  report.shots.paused = await capture('transcription-paused', 'Transcript');
  const secondState = await exportFinishes(second.id);
  step('Export 2 finished after the pause', { state: secondState });

  // 5. Resume, then cancel the transcription while another export runs.
  await transcript.getByRole('button', { name: 'Resume from start', exact: true }).click();
  await expect.poll(async () => (await transcription()).state).toBe('running');
  await sleep(1500);
  const third = await exportClip();
  await sleep(500);
  await transcript.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect.poll(async () => (await transcription()).state).toBe('cancelled');
  step('Cancelled during export 3', {
    delayMs: third.delay,
    exportAtCancel: await exportState(third.id),
  });
  report.shots.cancelBeside = await openJobs('jobs-export-after-cancel');
  const thirdState = await exportFinishes(third.id);
  step('Export 3 finished after the cancel', { state: thirdState });
  report.shots.end = await openJobs('jobs-history');
  for (const s of [firstState, secondState, thirdState]) assert.equal(s, 'verified');
  assert(importDelay < 2000 && first.delay < 2000, 'Import and export start within 2 s');
  assert.deepEqual(errors, []);
  report.status = 'passed';
} catch (e) {
  report.status = 'failed';
  report.error = String(e?.stack || e);
  try {
    await capture('failure');
  } catch {
    /* The window may already be gone. */
  }
  throw e;
} finally {
  report.errors = errors;
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  await app.close();
}
