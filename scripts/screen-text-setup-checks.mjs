// Screen text engine setup (VC-192): the pinned manifest, failed and cancelled downloads, and,
// with the pinned files at hand, a real install that reads its test image, then switching back
// and deleting the previous engine. Run against the packaged app (VIRTUAL_CUT_TEST_EXECUTABLE),
// it also proves worker.py and check.png ship and `check` runs from there.
//
// Optional settings (.env): VIRTUAL_CUT_OCR_DOWNLOADS, a folder holding the manifest's files,
// installs from those copies instead of the network (still hash-checked); VIRTUAL_CUT_OCR_RUNTIME,
// an installed engine, is checked with the packaged worker. Without them those parts are skipped
// and the report says so.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { require, root } from './shared.mjs';
import { testPath } from './test-paths.mjs';

const app = process.env.VIRTUAL_CUT_TEST_EXECUTABLE
  ? path.join(path.dirname(process.env.VIRTUAL_CUT_TEST_EXECUTABLE), 'resources/app')
  : root;
const modules = path.join(app, 'dist-electron');
const { ScreenTextSetup, checkScreenText, describeScreenText } = require(
  path.join(modules, 'screen-text-setup.cjs'),
);
const { ScreenTextRuntime, SCREEN_TEXT_WORKER } = require(
  path.join(modules, 'screen-text-runtime.cjs'),
);
const exists = (file) =>
  access(file).then(
    () => true,
    () => false,
  );
const base = testPath('screen-text-setup');
await mkdir(base, { recursive: true });
const dir = await mkdtemp(path.join(base, 'run-'));
const devEngine = process.env.VIRTUAL_CUT_OCR_RUNTIME || '';
const downloads = process.env.VIRTUAL_CUT_OCR_DOWNLOADS || '';
// The setup is checked as a user would meet it: no development override.
delete process.env.VIRTUAL_CUT_OCR_RUNTIME;
const originalFetch = globalThis.fetch;
const result = {
  app,
  worker: false,
  manifest: false,
  failures: false,
  devCheck: null,
  installed: false,
};
const report = () => writeFile(path.join(dir, 'report.json'), JSON.stringify(result, null, 2));
try {
  // The worker and its test image ship beside the compiled code (packaged builds too).
  assert.equal(SCREEN_TEXT_WORKER, path.join(app, 'integrations', 'screen-text', 'worker.py'));
  assert.ok(existsSync(SCREEN_TEXT_WORKER), `worker.py ships: ${SCREEN_TEXT_WORKER}`);
  assert.ok(
    existsSync(path.join(path.dirname(SCREEN_TEXT_WORKER), 'check.png')),
    'check.png ships',
  );
  result.worker = true;

  // The manifest pins Python first, then every wheel, each with a hash, size and HTTPS source.
  const manifest = JSON.parse(
    await readFile(path.join(app, 'integrations/screen-text/runtime-manifest.json'), 'utf8'),
  );
  assert.equal(manifest.artifacts[0].kind, 'python');
  for (const a of manifest.artifacts) {
    assert.match(a.sha256, /^[0-9a-f]{64}$/, a.name);
    assert.ok(a.bytes > 0 && a.expandedBytes > 0, a.name);
    assert.match(a.url, /^https:\/\/(www\.python\.org|files\.pythonhosted\.org)\//, a.name);
    assert.ok(a.url.endsWith('/' + a.name), a.name);
    if (a.kind === 'wheel') assert.ok(a.package && a.version, a.name);
  }
  for (const pkg of ['rapidocr', 'onnxruntime-directml', 'opencv-python', 'numpy'])
    assert.ok(
      manifest.artifacts.some((a) => a.package === pkg),
      `${pkg} is pinned`,
    );
  result.manifest = true;

  // A development engine, if there is one, answers `check` through the shipped worker.
  if (devEngine) {
    const check = await checkScreenText(devEngine, new AbortController().signal);
    assert.equal(check.ok, true, check.error);
    result.devCheck = check;
  }

  const profile = path.join(dir, 'profile');
  const runtime = new ScreenTextRuntime(profile, path.join(dir, 'tools'));
  const setup = new ScreenTextSetup(profile, runtime);
  const fresh = await setup.status();
  assert.equal(fresh.state, 'idle');
  assert.equal(fresh.current, undefined);
  assert.equal(fresh.problem, 'Screen text engine not installed.');
  await assert.rejects(setup.activate(), /Finish installing/);
  await assert.rejects(setup.check(), /not installed/);
  await assert.rejects(setup.restore(), /no previous/);
  await assert.rejects(setup.removeOther(), /no unused downloaded engine/);
  assert.throws(() => setup.start(), /Choose where/);
  const savedLocal = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = path.join(dir, 'localappdata');
  assert.equal(await setup.suggestedFolder(), path.join(dir, 'localappdata', 'Virtual Cut'));
  process.env.LOCALAPPDATA = savedLocal;

  // Planning only measures: no folder is created.
  const target = path.join(dir, 'engines');
  await mkdir(target);
  const keep = path.join(target, 'unrelated.txt');
  await writeFile(keep, 'Not ours.');
  const plan = await setup.plan(target);
  assert.equal(plan.state, 'planned');
  assert.ok(plan.folder.startsWith(path.join(target, 'Virtual Cut screen text', 'install-')));
  assert.equal(
    plan.downloadBytes,
    manifest.artifacts.reduce((s, a) => s + a.bytes, 0),
  );
  assert.ok(plan.requiredBytes > plan.installedBytes);
  assert.equal(await exists(plan.folder), false, 'Planning creates no files');

  // A corrupt download fails verification, removes only its own folder, changes nothing.
  const savedDownloads = process.env.VIRTUAL_CUT_OCR_DOWNLOADS;
  delete process.env.VIRTUAL_CUT_OCR_DOWNLOADS;
  globalThis.fetch = async () => new Response('not the archive');
  await setup.start();
  await setup.task;
  let state = await setup.status();
  assert.equal(state.state, 'failed');
  assert.match(state.message, /verification failed/);
  assert.equal(await exists(plan.folder), false);
  assert.equal(runtime.configured, false);
  // Cancelling a pending transfer cleans up the same way.
  const cancelPlan = await setup.plan(target);
  globalThis.fetch = async (_url, { signal }) =>
    new Promise((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
    );
  await setup.start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  state = await setup.cancel();
  assert.equal(state.state, 'cancelled');
  assert.match(state.message, /Download cancelled/);
  assert.equal(await exists(cancelPlan.folder), false);
  assert.ok(await exists(keep), 'An unrelated file in the chosen folder survives');
  globalThis.fetch = originalFetch;
  if (savedDownloads) process.env.VIRTUAL_CUT_OCR_DOWNLOADS = savedDownloads;
  result.failures = true;

  if (!downloads || !existsSync(path.join(downloads, manifest.artifacts[0].name))) {
    result.installSkipped = 'Set VIRTUAL_CUT_OCR_DOWNLOADS to a folder of the pinned files.';
  } else {
    // A real install from the pinned copies: unpack, versions, test image, then used at once.
    // Any network use here would be a bug, so the network is refused.
    globalThis.fetch = async () => {
      throw new Error('No downloads in this check.');
    };
    const started = performance.now();
    const first = await setup.plan(target);
    await setup.start();
    const seen = new Set();
    do {
      await new Promise((resolve) => setTimeout(resolve, 500));
      state = await setup.status();
      seen.add(state.state);
    } while (['installing', 'checking'].includes(state.state));
    result.installMs = Math.round(performance.now() - started);
    assert.equal(state.state, 'activated', state.message);
    assert.ok(seen.has('checking'), 'The test image is read before the engine is used');
    assert.equal(state.message, 'The screen text engine is installed and in use.');
    assert.equal(state.current.folder, first.folder);
    assert.equal(state.current.downloaded, true);
    assert.equal(state.problem, '');
    assert.equal(state.check.ok, true);
    assert.equal(typeof state.check.gpu, 'boolean');
    assert.equal(state.other, undefined);
    assert.equal(await exists(path.join(first.folder, 'downloads')), false, 'Archives removed');
    assert.equal(runtime.settings.folder, first.folder);
    // The choice survives a restart: a new runtime and setup find it in the profile.
    const reopened = new ScreenTextRuntime(profile, path.join(dir, 'tools'));
    assert.equal(reopened.settings.folder, first.folder);
    assert.equal((await new ScreenTextSetup(profile, reopened).status()).state, 'activated');
    result.installedCheck = state.check;

    // Check again on demand.
    const rechecked = await setup.check();
    assert.equal(rechecked.check.ok, true);
    assert.notEqual(rechecked.check.at, state.check.at);

    // A second copy (copied, not installed again) replaces it; the first is kept.
    const owner = 'install-22222222-2222-4222-8222-222222222222';
    const second = path.join(target, 'Virtual Cut screen text', owner);
    await cp(first.folder, second, { recursive: true });
    await writeFile(
      path.join(second, '.virtual-cut-screen-text-install.json'),
      JSON.stringify({ owner, manifest: manifest.id, complete: true }),
    );
    Object.assign(setup, { owned: owner, root: target });
    setup.state.folder = second;
    setup.state.state = 'ready';
    state = await setup.activate();
    assert.equal(state.state, 'activated');
    assert.match(
      state.notice,
      /new screen text engine is installed and in use\. The previous engine is kept/,
    );
    assert.equal(runtime.settings.folder, second);
    assert.equal(state.other.folder, first.folder);
    assert.ok(state.otherBytes > 1e8, 'The kept engine shows its size');
    assert.equal(state.check, undefined, 'A check of another folder is not shown');
    assert.equal(await setup.suggestedFolder(), target);

    // Switch back and forth; the engine in use is never deleted.
    state = await setup.restore();
    assert.equal(runtime.settings.folder, first.folder);
    assert.equal(state.other.folder, second);
    assert.equal(state.state, 'ready');
    assert.match(state.notice, /Now using the previous screen text engine\. The other one is kept/);
    state = await setup.restore();
    assert.equal(runtime.settings.folder, second);
    assert.equal(state.state, 'activated');
    // A redirected or foreign folder is never deleted.
    await writeFile(
      path.join(first.folder, '.virtual-cut-screen-text-install.json'),
      JSON.stringify({ owner: 'install-someone-else' }),
    );
    await assert.rejects(setup.removeOther(), /not created by Virtual Cut/);
    await writeFile(
      path.join(first.folder, '.virtual-cut-screen-text-install.json'),
      JSON.stringify({ owner: path.basename(first.folder), manifest: manifest.id, complete: true }),
    );
    state = await setup.removeOther();
    assert.match(state.notice, /Deleted the previous screen text engine and freed 0\.\d\d GB/);
    assert.equal(await exists(first.folder), false);
    assert.equal(state.other, undefined);
    assert.equal(runtime.configured, true);

    // Files deleted outside the app are reported, not forgotten.
    await rm(path.join(second, 'libraries', 'rapidocr', 'models', 'PP-OCRv6_det_small.onnx'));
    state = await setup.status();
    assert.equal(state.state, 'missing');
    assert.match(state.problem, /moved or deleted\. Open Screen text engine/);
    assert.equal(describeScreenText(second).available, false);
    result.installed = true;
    globalThis.fetch = originalFetch;
  }
  await report();
  console.log(`Screen text setup checks passed: ${dir}`);
} catch (error) {
  result.error = String(error?.stack || error);
  await report().catch(() => {});
  throw error;
} finally {
  globalThis.fetch = originalFetch;
}
