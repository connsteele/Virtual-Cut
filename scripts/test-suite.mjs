import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile, realpath, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { root, require, stopChild } from './shared.mjs';
import { fast, native, desktop, dependencies, other } from './test-inventory.mjs';

const profile = process.argv[2] || 'fast';
const profiles = ['fast', 'native', 'desktop', 'packaged', 'all'];
if (!profiles.includes(profile)) throw new Error(`Choose ${profiles.join(', ')}.`);
const only = process.argv
  .find((a) => a.startsWith('--only='))
  ?.slice(7)
  .split(',');
const known = [...fast, ...native, ...desktop];
if (only?.some((s) => !known.includes(s)))
  throw new Error('Unknown --only test. Use names from test-inventory.mjs.');
const base = path.resolve(
  process.env.VIRTUAL_CUT_SUITE_OUTPUT || 'G:/GPT/Work/virtual-cut/test-runs',
);
await mkdir(base, { recursive: true });
const directory = await mkdtemp(path.join(base, 'run-'));
if (process.argv.includes('--coverage'))
  process.env.VIRTUAL_CUT_COVERAGE_DIR = path.join(directory, 'coverage');
await mkdir(path.join(directory, 'temp'));
await writeFile(path.join(directory, '.virtual-cut-tests-owned'), 'running');
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const git = (args) =>
  spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).stdout?.trim();
const report = {
  profile,
  appVersion: manifest.version,
  commit: git(['rev-parse', 'HEAD']),
  dirty: !!git(['status', '--porcelain']),
  started: new Date().toISOString(),
  node: process.version,
  electron: require('electron/package.json').version,
  tools: {},
  checks: [],
  excluded: other,
};
const executable = process.env.VIRTUAL_CUT_TEST_EXECUTABLE;
const packaged = profile === 'packaged' || profile === 'all';
const toolsDirectory =
  packaged && executable ? path.join(path.dirname(executable), 'resources', 'tools') : '';
const env = {
  ...process.env,
  TEMP: path.join(directory, 'temp'),
  TMP: path.join(directory, 'temp'),
  VIRTUAL_CUT_TEST_ROOT: directory,
  VIRTUAL_CUT_TEST_OUTPUT: path.join(directory, 'shell'),
  VIRTUAL_CUT_TEST_BACKGROUND: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
if (toolsDirectory) {
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
  env[pathKey] = toolsDirectory + path.delimiter + (env[pathKey] || '');
}
for (const name of ['ffmpeg', 'ffprobe']) {
  const file = toolsDirectory
    ? path.join(toolsDirectory, name + '.exe')
    : process.env[`VIRTUAL_CUT_${name.toUpperCase()}`] || name;
  const result = spawnSync(file, ['-version'], { encoding: 'utf8', windowsHide: true, env });
  report.tools[name] = {
    file,
    available: result.status === 0,
    version: result.stdout?.split('\n')[0] || null,
  };
  if (result.status === 0) env[`VIRTUAL_CUT_${name.toUpperCase()}`] = file;
}
let child,
  interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    interrupted = true;
    void stopChild(child);
  });
async function run(name, command, args, extra = {}) {
  const started = performance.now();
  console.log(`Running ${name}…`);
  let output = '',
    timedOut = false;
  const code = await new Promise((resolve) => {
    child = spawn(command, args, {
      cwd: root,
      windowsHide: true,
      env: {
        ...env,
        ...extra,
        ...(process.env.VIRTUAL_CUT_COVERAGE_DIR && known.includes(name)
          ? { VIRTUAL_CUT_COVERAGE_CHECK: name }
          : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const capture = (data) => {
      if (output.length < 2 * 1024 * 1024)
        output += data.toString().slice(0, 2 * 1024 * 1024 - output.length);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    const timer = setTimeout(
      () => {
        timedOut = true;
        void stopChild(child);
      },
      10 * 60 * 1000,
    );
    child.on('error', (e) => {
      capture(String(e));
      clearTimeout(timer);
      resolve(-1);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  const result = {
    name,
    status: code === 0 && !timedOut && !interrupted ? 'passed' : 'failed',
    code,
    durationMs: Math.round(performance.now() - started),
    ...(timedOut ? { reason: 'Ten minute timeout' } : {}),
  };
  report.checks.push(result);
  await writeFile(path.join(directory, name.replaceAll(/[^a-zA-Z0-9.-]/g, '-') + '.log'), output);
  console.log(`${result.status.toUpperCase()} ${name} (${(result.durationMs / 1000).toFixed(1)}s)`);
  if (result.status === 'failed') console.log(output.slice(-5000));
  return result.status === 'passed';
}
const skip = (name, reason) => {
  report.checks.push({ name, status: 'skipped', reason });
  console.log(`SKIPPED ${name}: ${reason}`);
};
try {
  const classified = new Set([...known, ...Object.keys(other)]);
  const scripts = await readdir(path.join(root, 'scripts'));
  const missing = scripts.filter(
    (s) =>
      /(?:\.test|checks|smoke|investigation|study|fixture)\.mjs$/.test(s) && !classified.has(s),
  );
  if (missing.length)
    throw new Error(`Classify new checks in test-inventory.mjs: ${missing.join(', ')}`);
  const wanted = new Set(
    only ||
      (profile === 'fast'
        ? fast
        : profile === 'native'
          ? native
          : [...fast, ...native, ...desktop]),
  );
  const addDependencies = (name) => {
    for (const dep of dependencies[name] || []) {
      wanted.add(dep);
      addDependencies(dep);
    }
  };
  [...wanted].forEach(addDependencies);
  const build = await run('build', process.execPath, ['scripts/build.mjs']);
  if (profile === 'fast' || profile === 'all')
    await run('lint', process.execPath, [
      path.join(root, 'node_modules/eslint/bin/eslint.js'),
      '.',
    ]);
  for (const name of known.filter((s) => wanted.has(s))) {
    const deps = dependencies[name] || [];
    const failedDependency = deps.find(
      (d) => !report.checks.some((r) => r.name === d && r.status === 'passed'),
    );
    if (!build || interrupted) {
      skip(name, interrupted ? 'Run interrupted' : 'Build failed');
      continue;
    }
    if (failedDependency) {
      skip(name, `Prerequisite ${failedDependency} did not pass in this run`);
      continue;
    }
    if (
      !fast.includes(name) &&
      (!report.tools.ffmpeg.available || !report.tools.ffprobe.available)
    ) {
      skip(name, 'FFmpeg and FFprobe are required');
      continue;
    }
    if (packaged && desktop.includes(name) && (!executable || !existsSync(executable))) {
      skip(name, 'Set VIRTUAL_CUT_TEST_EXECUTABLE to the packaged Windows application');
      continue;
    }
    if (fast.includes(name))
      await run(name, process.execPath, [
        ...(process.env.VIRTUAL_CUT_COVERAGE_DIR
          ? ['--import', './scripts/coverage-fast.mjs']
          : []),
        '--experimental-strip-types',
        '--test',
        `scripts/${name}`,
      ]);
    else if (native.includes(name))
      await run(name, require('electron'), [`scripts/${name}`], { ELECTRON_RUN_AS_NODE: '1' });
    else await run(name, process.execPath, [`scripts/${name}`]);
  }
} catch (error) {
  report.checks.push({ name: 'suite', status: 'failed', reason: String(error) });
} finally {
  await stopChild(child);
  report.finished = new Date().toISOString();
  report.status = report.checks.some((r) => r.status === 'failed')
    ? 'failed'
    : report.checks.some((r) => r.status === 'skipped')
      ? 'incomplete'
      : 'passed';
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(
    path.join(directory, 'report.md'),
    `# ${profile}: ${report.status}\n\nApp ${report.appVersion}; commit ${report.commit}${report.dirty ? ' + local changes' : ''}.\n\n` +
      report.checks
        .map((r) => `- ${r.status}: ${r.name}${r.reason ? ' — ' + r.reason : ''}`)
        .join('\n'),
  );
  await writeFile(path.join(directory, '.virtual-cut-tests-owned'), 'complete');
  console.log(`Report: ${path.join(directory, 'report.json')}`);
  if (process.env.VIRTUAL_CUT_COVERAGE_DIR) {
    const { coverageReport } = await import('./coverage-report.mjs');
    const gates = path.join(root, 'scripts/coverage-gates.json');
    const coverage = await coverageReport(
      process.env.VIRTUAL_CUT_COVERAGE_DIR,
      path.join(directory, 'report.json'),
      existsSync(gates) ? gates : undefined,
    );
    if (coverage.status === 'failed') report.status = 'failed';
    report.coverage = {
      status: coverage.status,
      summary: path.join(process.env.VIRTUAL_CUT_COVERAGE_DIR, 'summary.json'),
    };
    await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
    await writeFile(
      path.join(directory, 'report.md'),
      `# ${profile}: ${report.status}\n\n` +
        report.checks
          .map((r) => `- ${r.status}: ${r.name}${r.reason ? ' — ' + r.reason : ''}`)
          .join('\n') +
        `\n\nCoverage: ${coverage.status}. See ${report.coverage.summary}\n`,
    );
  }
  // Retain five completed runs. Only delete direct, real, marked suite-owned folders.
  const completed = [];
  for (const item of await readdir(base, { withFileTypes: true })) {
    if (!item.isDirectory() || !/^run-[A-Za-z0-9]+$/.test(item.name)) continue;
    const full = path.join(base, item.name);
    if ((await realpath(full)) !== full || path.dirname(full) !== base) continue;
    if (
      (await readFile(path.join(full, '.virtual-cut-tests-owned'), 'utf8').catch(() => '')) !==
      'complete'
    )
      continue;
    const old = JSON.parse(await readFile(path.join(full, 'report.json'), 'utf8'));
    completed.push({ full, finished: old.finished });
  }
  completed.sort((a, b) => b.finished.localeCompare(a.finished));
  for (const old of completed.slice(5))
    if (old.full !== directory) await rm(old.full, { recursive: true });
  process.exitCode = report.status === 'failed' ? 1 : report.status === 'incomplete' ? 2 : 0;
}
