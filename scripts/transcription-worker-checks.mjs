import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { TranscriptionRuntime } = require('../dist-electron/transcription-runtime.cjs');
const root =
  process.env.VIRTUAL_CUT_ASR_TEST_OUTPUT || 'G:/GPT/Work/virtual-cut/m3-worker-validation';
await mkdir(root, { recursive: true });
const dir = await mkdtemp(path.join(root, 'run-'));
const runtime = new TranscriptionRuntime(dir, '');
assert.ok(runtime.configured, 'Configure VIRTUAL_CUT_ASR_PYTHON, LIBRARIES and MODEL first.');
const input = process.env.VIRTUAL_CUT_ASR_TEST_AUDIO;
assert.ok(input && existsSync(input), 'Supply an existing disposable speech sample.');
const source = path.join(dir, 'speech.wav');
await copyFile(input, source);
const request = {
  source,
  track: 0,
  offset: 0,
  language: 'en',
  vocabulary: '',
  ffmpeg: process.env.VIRTUAL_CUT_FFMPEG || 'ffmpeg',
  wav: path.join(dir, 'recognition.wav'),
  tempDirectory: dir,
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
let processes = {},
  events = [];
const start = performance.now();
await runtime.run(request, new AbortController().signal, (e) => {
  if (e.type === 'worker') processes = { pid: e.pid, guardPid: e.guardPid };
  events.push(e);
});
assert.ok(
  events.some((e) => e.type === 'segment'),
  'Real sample must produce speech.',
);
assert.ok(
  !alive(processes.pid) && !alive(processes.guardPid),
  'Both workers must exit after success.',
);
assert.ok(!existsSync(request.wav), 'Worker must clean extracted audio.');
const controller = new AbortController();
await assert.rejects(
  runtime.run(request, controller.signal, (e) => {
    if (e.type === 'worker') {
      processes = { pid: e.pid, guardPid: e.guardPid };
      controller.abort();
    }
  }),
  /cancelled/,
);
assert.ok(
  !alive(processes.pid) && !alive(processes.guardPid),
  'Cancellation must terminate both processes.',
);
let failedProcesses;
await assert.rejects(
  runtime.run(
    { ...request, source: path.join(dir, 'missing.wav') },
    new AbortController().signal,
    (e) => {
      if (e.type === 'worker') failedProcesses = e;
    },
  ),
);
assert.ok(
  !alive(failedProcesses.pid) && !alive(failedProcesses.guardPid),
  'Failure releases both processes.',
);
const runtimeUrl = pathToFileURL(
  fileURLToPath(new URL('../dist-electron/transcription-runtime.cjs', import.meta.url)),
).href;
const driver = `const {TranscriptionRuntime}=await import(${JSON.stringify(runtimeUrl)});const runtime=new TranscriptionRuntime(${JSON.stringify(dir)},'');await runtime.run(${JSON.stringify(request)},new AbortController().signal,e=>process.send(e));`;
const parent = spawn(process.execPath, ['--input-type=module', '-e', driver], {
  windowsHide: true,
  stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  env: process.env,
});
const crashed = await new Promise((resolve, reject) => {
  let owned;
  const timeout = setTimeout(() => reject(Error('Crash fixture did not load the model.')), 60000);
  parent.on('error', reject);
  parent.on('message', (event) => {
    if (event.type === 'worker') owned = event;
    if (event.type === 'stage' && event.message === 'Recognizing speech') {
      clearTimeout(timeout);
      resolve(owned);
    }
  });
  parent.on('exit', (code) => {
    clearTimeout(timeout);
    if (code) reject(Error(`Crash fixture exited early (${code}).`));
  });
});
parent.kill();
const deadline = Date.now() + 10000;
while ((alive(crashed.pid) || alive(crashed.guardPid)) && Date.now() < deadline)
  await new Promise((r) => setTimeout(r, 100));
assert.ok(
  !alive(crashed.pid) && !alive(crashed.guardPid),
  'Parent crash must terminate the loaded speech worker and guard.',
);
await writeFile(path.join(dir, 'recognition.json'), JSON.stringify(events, null, 2));
await writeFile(
  path.join(dir, 'metrics.json'),
  JSON.stringify(
    {
      elapsedMs: Math.round(performance.now() - start),
      words: events
        .filter((e) => e.type === 'segment')
        .reduce((n, e) => n + e.segment.words.length, 0),
      processesExited: true,
      failureCleanup: true,
      loadedWorkerParentCrashCleanup: true,
      peakMemoryBytes: events.find((e) => e.type === 'complete')?.peakMemoryBytes,
      files: await readdir(dir),
    },
    null,
    2,
  ),
);
console.log(`Real recognition and cancellation passed: ${dir}`);
