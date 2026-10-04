import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, readFile, access, rm } from 'node:fs/promises';
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
  // Setup locations, picker start and switching (separate profile; no download).
  {
    const locProfile = path.join(dir, 'locations-profile');
    const locRuntime = new TranscriptionRuntime(locProfile);
    const locSetup = new SpeechSetup(locProfile, locRuntime);
    const fresh = await locSetup.status();
    assert.equal(fresh.current.kind, 'manual');
    assert.equal(fresh.other, undefined);
    // Nothing chosen yet is a first setup, not files that went missing.
    assert.equal(locRuntime.removed, '');
    assert.match(locRuntime.problem, /^Set up local transcription/);
    const manualFolder = path.join(dir, 'manual-speech');
    const manual = {
      python: path.join(manualFolder, 'python.exe'),
      libraries: path.join(manualFolder, 'Lib', 'site-packages'),
      model: path.join(manualFolder, 'model'),
      gpuLibraries: '',
      device: 'auto',
      threads: 4,
    };
    await mkdir(path.join(manual.libraries, 'faster_whisper'), { recursive: true });
    await mkdir(manual.model, { recursive: true });
    await writeFile(manual.python, '');
    await writeFile(path.join(manual.model, 'model.bin'), '');
    locRuntime.use(manual);
    const savedLocal = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = path.join(dir, 'localappdata');
    assert.equal(await locSetup.suggestedFolder(), path.join(dir, 'localappdata', 'Virtual Cut'));
    process.env.LOCALAPPDATA = savedLocal;
    const install = path.join(
      dir,
      'speech-root',
      'Virtual Cut speech',
      'install-11111111-1111-4111-8111-111111111111',
    );
    await mkdir(path.join(install, 'python'), { recursive: true });
    await mkdir(path.join(install, 'libraries', 'faster_whisper'), { recursive: true });
    await mkdir(path.join(install, 'model'), { recursive: true });
    await writeFile(path.join(install, 'python', 'python.exe'), '');
    await writeFile(path.join(install, 'model', 'model.bin'), '');
    const downloaded = {
      python: path.join(install, 'python', 'python.exe'),
      libraries: path.join(install, 'libraries'),
      model: path.join(install, 'model'),
      gpuLibraries: '',
      device: 'auto',
      threads: 4,
    };
    locRuntime.use(downloaded);
    await mkdir(locProfile, { recursive: true });
    await writeFile(path.join(locProfile, 'speech-previous-runtime.json'), JSON.stringify(manual));
    const both = await locSetup.status();
    assert.equal(both.current.kind, 'downloaded');
    assert.equal(both.current.folder, install);
    assert.equal(both.current.available, true);
    assert.equal(both.other.kind, 'manual');
    assert.equal(await locSetup.suggestedFolder(), path.join(dir, 'speech-root'));
    const switched = await locSetup.restore();
    assert.equal(switched.current.kind, 'manual');
    assert.equal(switched.other.kind, 'downloaded');
    assert.match(
      switched.message,
      /Now using your own installation\. The downloaded engine is kept/,
    );
    // Settings round-trip through JSON, which drops undefined optional keys.
    assert.equal(JSON.stringify(locRuntime.settings), JSON.stringify(manual));
    // The picker still starts beside the downloaded setup while it is the other one.
    assert.equal(await locSetup.suggestedFolder(), path.join(dir, 'speech-root'));
    const back = await locSetup.restore();
    assert.equal(back.current.kind, 'downloaded');
    assert.match(back.notice, /Now using the downloaded engine\. Your own installation is kept/);
    // Switching while a download is only planned leaves it planned, never "ready" to use.
    assert.equal((await locSetup.plan(dir, false)).state, 'planned');
    assert.equal((await locSetup.restore()).state, 'planned');
    assert.equal((await locSetup.restore()).state, 'planned');
    // A look-alike path outside the installer's layout is never treated as downloaded.
    locRuntime.use({ ...downloaded, model: path.join(dir, 'elsewhere') });
    assert.equal((await locSetup.status()).current.kind, 'manual');
    locRuntime.use(downloaded);

    // Files deleted in Explorer while the app runs (VC-90 follow-up). An earlier GPU
    // result must not survive, and the reason names the missing file.
    locRuntime.gpuStatus = Promise.resolve({ available: true, message: 'Cached as ready' });
    const modelFile = path.join(install, 'model', 'model.bin');
    await rm(modelFile);
    assert.equal(locRuntime.configured, false);
    assert.match(locRuntime.removed, /speech model was not found/);
    assert.match(locRuntime.problem, /moved or deleted\. Open Speech engine/);
    const gone = await locRuntime.inspectGpu();
    assert.equal(gone.available, false);
    assert.match(gone.message, /once the speech setup files are found/);
    assert.equal(locRuntime.gpuStatus, undefined, 'No GPU answer is cached for missing files');
    const removedState = await locSetup.status();
    assert.equal(removedState.current.available, false);
    assert.equal(removedState.other.available, true);
    // The intact manual setup can still be switched to; the missing one cannot come back.
    const away = await locSetup.restore();
    assert.equal(away.current.kind, 'manual');
    assert.match(away.notice, /previous engine's files are missing/);
    await assert.rejects(locSetup.restore(), /previous engine's files were moved or deleted/);
    assert.equal(JSON.stringify(locRuntime.settings), JSON.stringify(manual));
    await writeFile(modelFile, '');
    assert.equal((await locSetup.status()).other.available, true);
  }
  // A checked download that is deleted before or after activation reports itself missing,
  // cannot be activated, and recovers if its files return. No download or worker runs.
  {
    const candidateProfile = path.join(dir, 'candidate-profile');
    const owner = 'install-22222222-2222-4222-8222-222222222222';
    const candidateRoot = path.join(dir, 'candidate-root');
    const folder = path.join(candidateRoot, 'Virtual Cut speech', owner);
    const manifest = JSON.parse(
      await readFile(path.join(root, 'integrations/transcription/runtime-manifest.json'), 'utf8'),
    );
    await mkdir(path.join(folder, 'python'), { recursive: true });
    await mkdir(path.join(folder, 'libraries', 'faster_whisper'), { recursive: true });
    await mkdir(path.join(folder, 'model'), { recursive: true });
    await writeFile(path.join(folder, 'python', 'python.exe'), '');
    await writeFile(path.join(folder, 'model', 'model.bin'), '');
    await writeFile(
      path.join(folder, '.virtual-cut-speech-install.json'),
      JSON.stringify({ owner, manifest: manifest.id, complete: true }),
    );
    await mkdir(candidateProfile, { recursive: true });
    await writeFile(
      path.join(candidateProfile, 'speech-setup-candidate.json'),
      JSON.stringify({
        root: candidateRoot,
        owner,
        manifest: manifest.id,
        state: { ...(await installer.status()), state: 'ready', folder, includeGpu: false },
      }),
    );
    const candidateRuntime = new TranscriptionRuntime(candidateProfile);
    const before = { ...candidateRuntime.settings };
    const candidateSetup = new SpeechSetup(candidateProfile, candidateRuntime);
    assert.equal((await candidateSetup.status()).state, 'ready');
    await rm(path.join(folder, 'model'), { recursive: true });
    const missing = await candidateSetup.status();
    assert.equal(missing.state, 'missing');
    assert.match(missing.message, /moved or deleted outside Virtual Cut/);
    await assert.rejects(candidateSetup.activate(), /moved or deleted outside Virtual Cut/);
    assert.deepEqual(candidateRuntime.settings, before);
    // Reopening the app reports the same; the remembered candidate is not discarded.
    assert.equal(
      (await new SpeechSetup(candidateProfile, candidateRuntime).status()).state,
      'missing',
    );
    await mkdir(path.join(folder, 'model'));
    await writeFile(path.join(folder, 'model', 'model.bin'), '');
    assert.equal((await candidateSetup.status()).state, 'ready');
    const used = await candidateSetup.activate();
    assert.equal(used.state, 'activated');
    // The engine it replaced never existed, so nothing is kept to switch back to.
    assert.equal(used.message, 'The speech engine is installed and in use.');
    assert.equal(used.other, undefined);
    assert.equal(await exists(path.join(candidateProfile, 'speech-previous-runtime.json')), false);

    // Deleting a kept downloaded engine (single-engine model, M328).
    const fakeEngine = async (id, receipt = true) => {
      const engineFolder = path.join(candidateRoot, 'Virtual Cut speech', `install-${id}`);
      await mkdir(path.join(engineFolder, 'python'), { recursive: true });
      await mkdir(path.join(engineFolder, 'libraries', 'faster_whisper'), { recursive: true });
      await mkdir(path.join(engineFolder, 'model'), { recursive: true });
      await writeFile(path.join(engineFolder, 'python', 'python.exe'), '');
      await writeFile(path.join(engineFolder, 'model', 'model.bin'), 'x'.repeat(4096));
      if (receipt)
        await writeFile(
          path.join(engineFolder, '.virtual-cut-speech-install.json'),
          JSON.stringify({ owner: `install-${id}`, manifest: manifest.id, complete: true }),
        );
      return {
        folder: engineFolder,
        settings: {
          python: path.join(engineFolder, 'python', 'python.exe'),
          libraries: path.join(engineFolder, 'libraries'),
          model: path.join(engineFolder, 'model'),
          gpuLibraries: '',
          device: 'auto',
          threads: 4,
        },
      };
    };
    const keep = (settings) =>
      writeFile(
        path.join(candidateProfile, 'speech-previous-runtime.json'),
        JSON.stringify(settings),
      );
    const old = await fakeEngine('33333333-3333-4333-8333-333333333333');
    await keep(old.settings);
    const withOld = await candidateSetup.status();
    assert.equal(withOld.other.kind, 'downloaded');
    assert.ok(withOld.otherBytes >= 4096, 'The kept engine reports its size');
    const removed = await candidateSetup.removeOther();
    assert.match(removed.notice, /Deleted the previous speech engine and freed/);
    assert.equal(await exists(old.folder), false);
    assert.equal(removed.other, undefined);
    assert.equal(removed.current.folder, folder, 'The engine in use is untouched');
    // Never delete your own installation, a folder Virtual Cut did not create, or the engine in use.
    const own = {
      python: path.join(dir, 'manual-speech', 'python.exe'),
      libraries: path.join(dir, 'manual-speech', 'Lib', 'site-packages'),
      model: path.join(dir, 'manual-speech', 'model'),
      gpuLibraries: '',
      device: 'auto',
      threads: 4,
    };
    await keep(own);
    await assert.rejects(candidateSetup.removeOther(), /no unused downloaded engine/);
    await access(own.python);
    const foreign = await fakeEngine('44444444-4444-4444-8444-444444444444', false);
    await keep(foreign.settings);
    await assert.rejects(candidateSetup.removeOther(), /not created by Virtual Cut/);
    await access(foreign.folder);
    await keep(candidateRuntime.settings);
    await assert.rejects(candidateSetup.removeOther(), /still in use/);
    await access(folder);

    // A finished download is used straight away; the replaced engine is kept until deleted.
    const auto = new SpeechSetup(candidateProfile, candidateRuntime);
    await auto.plan(candidateRoot, false);
    const next = await fakeEngine('55555555-5555-4555-8555-555555555555');
    auto.install = async () => {
      auto.owned = path.basename(next.folder);
      auto.state.folder = next.folder;
      auto.state.state = 'ready';
    };
    auto.manifest = manifest;
    await auto.start();
    await auto.task;
    const installed = await auto.status();
    assert.equal(installed.state, 'activated', installed.message);
    assert.match(
      installed.message,
      /new speech engine is installed and in use\. The previous engine is kept until you delete it/,
    );
    assert.equal(candidateRuntime.settings.python, next.settings.python);
    assert.equal(installed.other.folder, folder);
  }
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
  const python = process.env.VIRTUAL_CUT_PYTHON || process.env.VIRTUAL_CUT_ASR_PYTHON || 'python';
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
    removedOutsideApp: true,
    installed: false,
  };
  globalThis.fetch = originalFetch;
  if (process.env.VIRTUAL_CUT_VERIFY_SPEECH_INSTALL === '1') {
    await installer.plan(dir, true);
    const installStarted = performance.now();
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
    result.coldInstallElapsedMs = process.env.VIRTUAL_CUT_REUSE_SETUP_CANDIDATE
      ? null
      : Math.round(performance.now() - installStarted);
    if (process.env.VIRTUAL_CUT_REUSE_SETUP_CANDIDATE) {
      assert.equal(state.state, 'ready', state.message);
      const pinned = installer.manifest.id;
      installer.manifest.id = 'different-release';
      await assert.rejects(installer.activate(), /no longer available/);
      assert.deepEqual(runtime.settings, initial);
      installer.manifest.id = pinned;
      await installer.activate();
    } else assert.equal(state.state, 'activated', state.message);
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
