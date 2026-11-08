import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const require = createRequire(import.meta.url);

// Local settings live in an uncommitted .env at the repository root (see .env.example and
// the README). A value already set for this run wins over the file.
const settings = path.join(root, '.env');
if (existsSync(settings)) process.loadEnvFile(settings);

/**
 * The Whole recording action in Cut (VC-206: import makes no clip). Returns a copy of the model
 * with a clip from the first frame to the last on each inspected recording that has none, the
 * same clip the button makes.
 */
export function withWholeClips(model) {
  const next = structuredClone(model);
  for (const r of next.recordings)
    if (r.duration && !next.clips.some((c) => c.rid === r.id))
      next.clips.push({
        id: randomUUID(),
        rid: r.id,
        name: r.title,
        originalName: r.title,
        folder: '_Review',
        originalFolder: '_Review',
        start: 0,
        end: r.duration,
        include: true,
      });
  return next;
}

/** A folder for check and study output: VIRTUAL_CUT_SCRATCH, else the OS temp folder. */
export const scratchPath = (...parts) =>
  path.resolve(process.env.VIRTUAL_CUT_SCRATCH || path.join(os.tmpdir(), 'virtual-cut'), ...parts);

/** A setting a script cannot run without, such as real footage; stops with what to set. */
export function requiredSetting(name, purpose) {
  const value = process.env[name];
  if (!value)
    throw new Error(`Set ${name} to ${purpose}, in .env or for this run (see .env.example).`);
  return value;
}

/**
 * Records a part of a check that did not run, such as an install that needs a setting, so the
 * suite report shows it beside the pass instead of hiding the gap. Prints it too, for runs
 * outside the suite. test-suite.mjs gives each check VIRTUAL_CUT_SKIPPED_STEPS, a file of one
 * JSON line per skipped part; checks started by a check inherit it.
 */
export function skippedStep(step, reason) {
  console.log(`Skipped part: ${step} (${reason})`);
  const file = process.env.VIRTUAL_CUT_SKIPPED_STEPS;
  if (file) appendFileSync(file, JSON.stringify({ step, reason }) + '\n');
}

if (process.env.VIRTUAL_CUT_COVERAGE_DIR && process.env.VIRTUAL_CUT_COVERAGE_CHECK)
  (await import('./coverage-desktop.mjs')).installCoverageCollector();
if (process.env.VIRTUAL_CUT_HANG_REQUEST)
  (await import('./hang-capture.mjs')).watchForHang(
    process.env.VIRTUAL_CUT_HANG_REQUEST,
    process.env.VIRTUAL_CUT_HANG_OUTPUT,
  );

/** The fixture transport-fixture.mjs builds in VIRTUAL_CUT_TRANSPORT_FIXTURE. */
export async function transportFixture() {
  const folder = requiredSetting(
    'VIRTUAL_CUT_TRANSPORT_FIXTURE',
    'the folder holding the transport fixture (build it with scripts/transport-fixture.mjs)',
  );
  return JSON.parse(await readFile(path.join(folder, 'latest-fixture.json'), 'utf8'));
}

export function electronEnvironment(extra = {}) {
  const env = { ...process.env, ...extra };
  // Editors may set this for their own Node utilities. A desktop launch needs
  // Electron's browser process, not its alternate command-line Node mode.
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

export async function runNode(script, args = []) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`${path.basename(script)} failed (${signal ?? code}).`)),
    );
  });
}

export function tsc(args) {
  // TypeScript 7 does not export bin/tsc, so require.resolve cannot find it.
  return runNode(path.join(root, 'node_modules/typescript/bin/tsc'), args);
}

export function assertBuilt() {
  for (const file of ['dist/index.html', 'dist-electron/main.cjs', 'dist-electron/preload.cjs']) {
    if (!existsSync(path.join(root, file)))
      throw new Error('Build Virtual Cut first with npm run build.');
  }
}

/** Stop only a child started by this launcher, including Electron helpers. */
export async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', () => {
        child.kill();
        resolve();
      });
      killer.once('exit', resolve);
    });
  } else {
    child.kill('SIGTERM');
  }
}
