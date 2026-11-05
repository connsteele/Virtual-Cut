import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  ScreenTextRuntime,
  SCREEN_TEXT_MODELS,
  screenTextLayout,
  SCREEN_TEXT_WORKER,
} = require('../dist-electron/screen-text-runtime.cjs');

// VC-192: the screen text engine is found in one place, so the reading pass (VC-141) and the
// setup (VC-192) agree on it.
async function engine(folder) {
  const { python, libraries } = screenTextLayout(folder);
  await mkdir(path.dirname(python), { recursive: true });
  await writeFile(python, '');
  await mkdir(path.join(libraries, 'rapidocr', 'models'), { recursive: true });
  for (const name of SCREEN_TEXT_MODELS)
    await writeFile(path.join(libraries, 'rapidocr', 'models', name), '');
}

test('screen text engine lookup: override, saved folder, bundled default', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vc-ocr-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const previous = process.env.VIRTUAL_CUT_OCR_RUNTIME;
  t.after(() => {
    if (previous === undefined) delete process.env.VIRTUAL_CUT_OCR_RUNTIME;
    else process.env.VIRTUAL_CUT_OCR_RUNTIME = previous;
  });
  delete process.env.VIRTUAL_CUT_OCR_RUNTIME;
  const profile = path.join(dir, 'profile'),
    tools = path.join(dir, 'tools');
  await mkdir(profile, { recursive: true });

  // Nothing installed and nothing chosen: a first setup.
  let runtime = new ScreenTextRuntime(profile, tools);
  assert.equal(runtime.settings.folder, path.join(tools, 'ocr'));
  assert.equal(runtime.configured, false);
  assert.equal(runtime.removed, '');
  assert.equal(runtime.problem, 'Screen text engine not installed.');

  // The bundled folder, once complete, is used.
  await engine(path.join(tools, 'ocr'));
  runtime = new ScreenTextRuntime(profile, tools);
  assert.equal(runtime.configured, true);
  assert.equal(runtime.problem, '');

  // A folder saved by setup wins over the bundled one; deleting it is reported as removed.
  const saved = path.join(dir, 'saved');
  await engine(saved);
  await writeFile(
    path.join(profile, 'screen-text-runtime.json'),
    JSON.stringify({ folder: saved }),
  );
  runtime = new ScreenTextRuntime(profile, tools);
  assert.equal(runtime.settings.python, path.join(saved, 'python', 'python.exe'));
  assert.equal(runtime.configured, true);
  await rm(path.join(saved, 'libraries', 'rapidocr', 'models', SCREEN_TEXT_MODELS[1]));
  assert.match(runtime.missing, /screen text engine was not found/);
  assert.match(runtime.problem, /moved or deleted/);
  await rm(path.join(saved, 'python'), { recursive: true });
  assert.match(runtime.removed, /Python was not found/);

  // A saved value that isn't an absolute folder is ignored.
  await writeFile(path.join(profile, 'screen-text-runtime.json'), JSON.stringify({ folder: 'x' }));
  assert.equal(new ScreenTextRuntime(profile, tools).settings.folder, path.join(tools, 'ocr'));
  await writeFile(path.join(profile, 'screen-text-runtime.json'), '{');
  assert.equal(new ScreenTextRuntime(profile, tools).settings.folder, path.join(tools, 'ocr'));

  // The .env override wins over both.
  const override = path.join(dir, 'override');
  process.env.VIRTUAL_CUT_OCR_RUNTIME = override;
  runtime = new ScreenTextRuntime(profile, tools);
  assert.equal(runtime.settings.libraries, path.join(override, 'libraries'));
  assert.match(runtime.removed, /Python was not found/);

  assert.ok(SCREEN_TEXT_WORKER.endsWith(path.join('integrations', 'screen-text', 'worker.py')));

  // Setup's choice is saved under an override but only used once the override is cleared.
  assert.equal(runtime.overridden, true);
  runtime.use(saved);
  assert.equal(runtime.settings.folder, path.resolve(override));
  assert.equal(runtime.savedFolder, saved);
  delete process.env.VIRTUAL_CUT_OCR_RUNTIME;
  runtime = new ScreenTextRuntime(profile, tools);
  assert.equal(runtime.overridden, false);
  assert.equal(runtime.settings.folder, saved);
  // Without one, use() switches at once, and a fresh profile has nothing saved.
  await engine(path.join(dir, 'next'));
  runtime.use(path.join(dir, 'next'));
  assert.equal(runtime.settings.folder, path.join(dir, 'next'));
  assert.equal(runtime.configured, true);
  assert.equal(new ScreenTextRuntime(path.join(dir, 'empty'), tools).savedFolder, '');
});
