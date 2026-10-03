import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { require, root } from './shared.mjs';
const modules = process.env.VIRTUAL_CUT_TEST_EXECUTABLE
  ? path.join(path.dirname(process.env.VIRTUAL_CUT_TEST_EXECUTABLE), 'resources/app/dist-electron')
  : path.join(root, 'dist-electron');
const { SpeechSetup, verifyArtifact } = require(path.join(modules, 'speech-setup.cjs'));
const { TranscriptionRuntime } = require(path.join(modules, 'transcription-runtime.cjs'));
const base = path.join(
  process.env.VIRTUAL_CUT_TEST_ROOT || 'G:/GPT/Work/virtual-cut/runtime-setup/checks',
  'speech-setup',
);
await mkdir(base, { recursive: true });
const dir = await mkdtemp(path.join(base, 'run-'));
const profile = path.join(dir, 'profile');
const runtime = new TranscriptionRuntime(profile);
const initial = { ...runtime.settings };
const installer = new SpeechSetup(profile, runtime);
const originalFetch = globalThis.fetch;
const exists = async (file) => {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
};
try {
  const content = Buffer.from('A known component.');
  const file = path.join(dir, 'verified.bin');
  await writeFile(file, content);
  await verifyArtifact(file, {
    bytes: content.length,
    sha256: createHash('sha256').update(content).digest('hex'),
  });
  await assert.rejects(
    verifyArtifact(file, { bytes: content.length, sha256: '0'.repeat(64) }),
    /verification failed/,
  );
  await assert.rejects(
    verifyArtifact(file, {
      bytes: content.length + 1,
      sha256: createHash('sha256').update(content).digest('hex'),
    }),
    /verification failed/,
  );
  await assert.rejects(installer.activate(), /Finish installing/);
  await assert.rejects(installer.restore());
  const plan = await installer.plan(dir, true);
  assert.equal(plan.state, 'planned');
  assert.ok(plan.folder.startsWith(path.join(dir, 'Virtual Cut speech') + path.sep));
  assert.ok(plan.downloadBytes > 3e9 && plan.requiredBytes > plan.installedBytes);
  assert.equal(await exists(plan.folder), false, 'Planning creates no installation files');
  const noGpu = await installer.plan(dir, false);
  assert.ok(noGpu.downloadBytes < plan.downloadBytes);
  // Inject a corrupt network response; no setup can become active on failed verification.
  globalThis.fetch = async () => new Response(content);
  await installer.start();
  await installer.task;
  assert.equal((await installer.status()).state, 'failed');
  assert.match((await installer.status()).message, /verification/);
  assert.equal(await exists(noGpu.folder), false);
  assert.deepEqual(runtime.settings, initial);
  // Cancellation interrupts an actual pending streamed transfer and cleans only its owned folder.
  const cancelPlan = await installer.plan(dir, true);
  globalThis.fetch = async (_url, { signal }) =>
    new Promise((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
    );
  await installer.start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const cancelled = await installer.cancel();
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(await exists(cancelPlan.folder), false);
  assert.deepEqual(runtime.settings, initial);
  await access(file); // An unrelated file in the chosen folder survives every cleanup.
  const processFile = (executable, args, input) =>
    new Promise((resolve, reject) => {
      const p = spawn(executable, args, {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, TEMP: dir, TMP: dir },
      });
      let output = '';
      p.stdout.on('data', (d) => {
        output += d;
      });
      p.stderr.on('data', (d) => {
        output += d;
      });
      p.on('error', reject);
      p.on('close', (code) => resolve({ code, output }));
      p.stdin.end(input);
    });
  // Both unpackers reject path traversal before any extraction, using a deliberately invalid zip.
  const python = process.env.VIRTUAL_CUT_ASR_PYTHON || 'C:/python312/python.exe';
  const zip = path.join(dir, 'bad.zip');
  const made = await processFile(python, [
    '-c',
    'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],"w"); z.writestr("../outside.txt","bad"); z.close()',
    zip,
  ]);
  assert.equal(made.code, 0);
  const ps = await processFile(
    path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(root, 'integrations/transcription/unpack-python.ps1'),
      '-Archive',
      zip,
      '-Destination',
      path.join(dir, 'bad-python'),
    ],
  );
  assert.notEqual(ps.code, 0);
  assert.match(ps.output, /Unsafe archive/);
  const wheel = await processFile(
    python,
    ['-I', '-B', path.join(root, 'integrations/transcription/install-runtime.py')],
    JSON.stringify({ mode: 'unpack', archive: zip, destination: path.join(dir, 'bad-wheel') }),
  );
  assert.notEqual(wheel.code, 0);
  assert.match(wheel.output, /Unsafe wheel/);
  assert.equal(await exists(path.join(dir, 'outside.txt')), false);
  const result = {
    integrity: true,
    cancellation: true,
    cleanup: true,
    traversal: true,
    installed: false,
  };
  globalThis.fetch = originalFetch;
  if (process.env.VIRTUAL_CUT_VERIFY_SPEECH_INSTALL === '1') {
    await installer.plan(dir, true);
    let state;
    if (process.env.VIRTUAL_CUT_REUSE_SETUP_CANDIDATE) {
      const folder = path.resolve(process.env.VIRTUAL_CUT_REUSE_SETUP_CANDIDATE);
      const receipt = JSON.parse(
        await readFile(path.join(folder, '.virtual-cut-speech-install.json'), 'utf8'),
      );
      assert.equal(receipt.complete, true);
      installer.state.folder = folder;
      installer.state.state = 'ready';
      installer.owned = receipt.owner;
      installer.root = path.dirname(path.dirname(folder));
      state = await installer.status();
    } else {
      await installer.start();
      do {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        state = await installer.status();
        console.log(
          `${state.state}: ${(state.downloadedBytes / 1e9).toFixed(2)} GB · ${state.message}`,
        );
      } while (state.state === 'installing');
    }
    assert.equal(state.state, 'ready', state.message);
    assert.deepEqual(runtime.settings, initial, 'Installation must not automatically activate');
    const pinned = installer.manifest.id;
    installer.manifest.id = 'different-release';
    await assert.rejects(installer.activate(), /no longer available/);
    assert.deepEqual(runtime.settings, initial);
    installer.manifest.id = pinned;
    await installer.activate();
    const installed = { ...runtime.settings };
    assert.equal(runtime.configured, true);
    const gpu = await runtime.inspectGpu(true);
    assert.equal(gpu.available, true, gpu.message);
    const source = path.join(dir, 'silent.wav');
    const ffmpeg = process.env.VIRTUAL_CUT_FFMPEG || 'ffmpeg';
    const audio = await processFile(ffmpeg, [
      '-hide_banner',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=16000:cl=mono',
      '-t',
      '3',
      '-y',
      source,
    ]);
    assert.equal(audio.code, 0, audio.output);
    const events = [];
    await runtime.run(
      {
        source,
        track: 0,
        offset: 0,
        language: 'en',
        vocabulary: '',
        ffmpeg,
        wav: path.join(dir, 'extracted.wav'),
        tempDirectory: dir,
        device: 'cuda',
      },
      AbortSignal.timeout(120000),
      (e) => events.push(e),
    );
    assert.ok(events.some((e) => e.type === 'complete'));
    assert.ok(
      events.some((e) => e.device === 'cuda'),
      'New installation must run the GPU model',
    );
    await installer.restore();
    assert.equal(JSON.stringify(runtime.settings), JSON.stringify(initial));
    await installer.restore();
    assert.deepEqual(runtime.settings, installed);
    const reopened = new TranscriptionRuntime(profile);
    assert.deepEqual(reopened.settings, installed);
    const reopenedSetup = new SpeechSetup(profile, reopened);
    assert.equal((await reopenedSetup.status()).state, 'activated');
    await reopenedSetup.restore();
    assert.equal((await reopenedSetup.status()).state, 'ready');
    assert.equal((await new SpeechSetup(profile, reopened).status()).state, 'ready');
    await reopenedSetup.activate();
    assert.deepEqual(reopened.settings, installed);
    await access(installed.python);
    await access(installed.model);
    result.installed = true;
    result.reusedValidatedCandidate = !!process.env.VIRTUAL_CUT_REUSE_SETUP_CANDIDATE;
    result.folder = state.folder;
    result.gpu = gpu;
    result.events = events;
  }
  await writeFile(path.join(dir, 'report.json'), JSON.stringify(result, null, 2));
  console.log(`Speech setup checks passed: ${dir}`);
} finally {
  globalThis.fetch = originalFetch;
}
