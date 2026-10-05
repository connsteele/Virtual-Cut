// Run a delivery end to end (VC-149): fast gate, desktop suite with coverage, Windows package,
// packaged checks and the transport check, then copy the evidence for the version.
//
//   node scripts/deliver.mjs [--version 0.4.15] [--no-transport]
//
// --version updates package.json and package-lock.json first. Stops at the first failed step
// and names it. Everything it writes stays under VIRTUAL_CUT_DELIVERY_ROOT
// (default G:/Claude/Virtual Cut): test-runs, builds, evidence/<version> and temp.
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { root, stopChild } from './shared.mjs';

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const base = path.resolve(process.env.VIRTUAL_CUT_DELIVERY_ROOT || 'G:/Claude/Virtual Cut');
const transport = !args.includes('--no-transport');

const requested = option('--version');
if (requested) {
  if (!/^\d+\.\d+\.\d+$/.test(requested)) throw new Error('Use --version like 0.4.15.');
  const manifestFile = path.join(root, 'package.json');
  const text = await readFile(manifestFile, 'utf8');
  await writeFile(manifestFile, text.replace(/"version": "[^"]+"/, `"version": "${requested}"`));
  const lockFile = path.join(root, 'package-lock.json');
  const lock = JSON.parse(await readFile(lockFile, 'utf8'));
  lock.version = requested;
  lock.packages[''].version = requested;
  await writeFile(lockFile, JSON.stringify(lock, null, 2) + '\n');
}
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const evidence = path.join(base, 'evidence', version);
const logs = path.join(evidence, 'logs');
const temp = path.join(base, 'temp');
await mkdir(logs, { recursive: true });
await mkdir(temp, { recursive: true });

const git = (a) =>
  spawnSync('git', a, { cwd: root, encoding: 'utf8', windowsHide: true }).stdout?.trim();
const delivery = {
  version,
  commit: git(['rev-parse', '--short', 'HEAD']),
  dirty: !!git(['status', '--porcelain']),
  started: new Date().toISOString(),
  steps: [],
};
const env = {
  ...process.env,
  TEMP: temp,
  TMP: temp,
  VIRTUAL_CUT_SUITE_OUTPUT: path.join(base, 'test-runs'),
  VIRTUAL_CUT_PACKAGE_DIR: path.join(base, 'builds'),
  VIRTUAL_CUT_TRANSPORT_OUTPUT: path.join(evidence, 'transport'),
  VIRTUAL_CUT_TRANSPORT_TEMP: temp,
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.VIRTUAL_CUT_COVERAGE_DIR;

let child;
process.on('SIGINT', () => void stopChild(child));

/** Run one step, echoing and logging its output. Returns the captured output. */
async function step(name, script, scriptArgs = [], extra = {}) {
  const started = performance.now();
  console.log(`\n== ${name}`);
  let output = '';
  const code = await new Promise((resolve) => {
    child = spawn(process.execPath, [script, ...scriptArgs], {
      cwd: root,
      env: { ...env, ...extra },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const take = (d) => {
      process.stdout.write(d);
      output += d;
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (e) => {
      output += String(e);
      resolve(-1);
    });
    child.on('exit', resolve);
  });
  await writeFile(path.join(logs, name.replaceAll(/[^a-z0-9]+/gi, '-') + '.log'), output);
  const result = { name, code, durationMs: Math.round(performance.now() - started) };
  delivery.steps.push(result);
  if (code !== 0) {
    // test-suite.mjs exits 2 when a check was skipped; that is not a delivery.
    result.status = code === 2 ? 'incomplete' : 'failed';
    await finish(`${name} ${result.status === 'incomplete' ? 'skipped checks' : 'failed'}`);
  }
  result.status = 'passed';
  return output;
}

/** Copy a suite run's reports and logs (not its profiles or media) into the evidence folder. */
async function keepRun(output, folder) {
  const report = /Report: (.+report\.json)/.exec(output)?.[1]?.trim();
  if (!report) throw new Error(`No suite report in the ${folder} output.`);
  const run = path.dirname(report);
  const destination = path.join(evidence, folder, path.basename(run));
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(run, { withFileTypes: true }))
    if (entry.isFile() && /\.(json|md|log)$/.test(entry.name))
      await copyFile(path.join(run, entry.name), path.join(destination, entry.name));
  const summary = path.join(run, 'coverage', 'summary.json');
  if (existsSync(summary)) await copyFile(summary, path.join(destination, 'coverage-summary.json'));
  return destination;
}

async function finish(failure) {
  delivery.finished = new Date().toISOString();
  delivery.status = failure ? 'failed' : 'passed';
  if (failure) delivery.failure = failure;
  delivery.notes = {
    changelog: (await readFile(path.join(root, 'CHANGELOG.md'), 'utf8')).includes(`## ${version} `),
    review: existsSync(path.join(root, 'docs', `review-${version}.md`)),
  };
  await writeFile(path.join(evidence, 'delivery.json'), JSON.stringify(delivery, null, 2));
  const lines = [
    `# Delivery ${version}: ${delivery.status}`,
    '',
    `Commit ${delivery.commit}${delivery.dirty ? ' + local changes' : ''}.`,
    ...(failure ? ['', `**Stopped:** ${failure}. Log: ${logs}`] : []),
    '',
    ...delivery.steps.map((s) => `- ${s.status}: ${s.name} (${Math.round(s.durationMs / 1000)} s)`),
    '',
    ...Object.entries(delivery.paths || {}).map(([k, v]) => `- ${k}: ${v}`),
    '',
    `CHANGELOG entry: ${delivery.notes.changelog ? 'yes' : 'missing'}. docs/review-${version}.md: ${delivery.notes.review ? 'yes' : 'missing'}.`,
  ];
  await writeFile(path.join(evidence, 'delivery.md'), lines.join('\n') + '\n');
  console.log('\n' + lines.join('\n'));
  process.exit(failure ? 1 : 0);
}

delivery.paths = {};
const fast = await step('Fast gate', 'scripts/test-suite.mjs', ['fast']);
delivery.paths.fast = await keepRun(fast, 'fast');
const suite = await step('Desktop suite with coverage', 'scripts/test-suite.mjs', [
  'desktop',
  '--coverage',
]);
delivery.paths.suite = await keepRun(suite, 'suite');
const packaged = await step('Package for Windows', 'scripts/package-windows.mjs');
const build = /Desktop folder ready: (.+)/.exec(packaged)?.[1]?.trim();
if (!build || !(await stat(build).catch(() => null))) await finish('No build folder reported');
delivery.paths.build = build;
const exe = path.join(build, 'Virtual Cut.exe');
const checks = await step('Packaged checks', 'scripts/test-suite.mjs', ['packaged'], {
  VIRTUAL_CUT_TEST_EXECUTABLE: exe,
});
delivery.paths.packaged = await keepRun(checks, 'packaged');
if (transport) {
  await mkdir(env.VIRTUAL_CUT_TRANSPORT_OUTPUT, { recursive: true });
  await step('Transport check', 'scripts/transport-regression-checks.mjs', [], {
    VIRTUAL_CUT_TEST_EXECUTABLE: exe,
  });
  delivery.paths.transport = env.VIRTUAL_CUT_TRANSPORT_OUTPUT;
} else delivery.steps.push({ name: 'Transport check', status: 'skipped', durationMs: 0 });
await finish();
