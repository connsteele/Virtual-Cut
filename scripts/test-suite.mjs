import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile, realpath, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { root, require, scratchPath, stopChild } from './shared.mjs';
import {
  fast,
  native,
  desktop,
  dependencies,
  exclusive,
  sharedFixtures,
  checkTimeout,
  longerTimeouts,
  other,
} from './test-inventory.mjs';

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
const jobs = Number(process.argv.find((a) => a.startsWith('--jobs='))?.slice(7) || 4);
if (!Number.isInteger(jobs) || jobs < 1) throw new Error('--jobs takes a whole number from 1.');
const base = path.resolve(process.env.VIRTUAL_CUT_SUITE_OUTPUT || scratchPath('test-runs'));
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
  // Imports don't start background picture passes (VC-180) unless a check turns them on.
  VIRTUAL_CUT_PICTURE_PASS: 'manual',
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
const children = new Set();
let interrupted = false,
  // The first check that fails; the checks running beside it are stopped.
  halted = null;
const fileName = (name) => name.replaceAll(/[^a-zA-Z0-9.-]/g, '-');
const lastLines = (output, count = 40) =>
  output.trim() ? output.trimEnd().split(/\r?\n/).slice(-count) : ['(the check printed nothing)'];
const stopAll = () => Promise.all([...children].map((c) => stopChild(c)));
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    interrupted = true;
    void stopAll();
  });
async function run(name, command, args, extra = {}) {
  const started = performance.now();
  console.log(`Running ${name}…`);
  let output = '',
    timedOut = false;
  // Each check gets its own TEMP, so checks running side by side never share scratch files.
  const temp = path.join(directory, 'temp', fileName(name));
  await mkdir(temp, { recursive: true });
  const limit = longerTimeouts[name] ?? checkTimeout;
  // A desktop check that runs out of time saves screenshots of its windows when this file
  // appears (scripts/hang-capture.mjs), before it is stopped.
  const hang = desktop.includes(name) ? path.join(directory, `${fileName(name)}.hang`) : null;
  // Parts the check skipped (skippedStep in shared.mjs) are listed beside its result.
  const skippedSteps = path.join(directory, `${fileName(name)}.skipped-steps`);
  const code = await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: root,
      windowsHide: true,
      env: {
        ...env,
        TEMP: temp,
        TMP: temp,
        VIRTUAL_CUT_SKIPPED_STEPS: skippedSteps,
        ...(hang
          ? {
              VIRTUAL_CUT_HANG_REQUEST: hang,
              VIRTUAL_CUT_HANG_OUTPUT: path.join(directory, `${fileName(name)}-timeout`),
            }
          : {}),
        ...extra,
        ...(process.env.VIRTUAL_CUT_COVERAGE_DIR && known.includes(name)
          ? { VIRTUAL_CUT_COVERAGE_CHECK: name }
          : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.add(child);
    const capture = (data) => {
      if (output.length < 2 * 1024 * 1024)
        output += data.toString().slice(0, 2 * 1024 * 1024 - output.length);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    const timer = setTimeout(async () => {
      timedOut = true;
      if (hang) {
        await writeFile(hang, 'capture');
        const asked = performance.now();
        while (
          child.exitCode === null &&
          !existsSync(hang + '.done') &&
          performance.now() - asked < 15000
        )
          await new Promise((r) => setTimeout(r, 250));
      }
      void stopChild(child);
    }, limit);
    child.on('error', (e) => {
      capture(String(e));
      clearTimeout(timer);
      children.delete(child);
      resolve(-1);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      children.delete(child);
      resolve(code);
    });
  });
  const stopped = code !== 0 && !timedOut && halted && halted !== name;
  const result = {
    name,
    status: code === 0 && !timedOut && !interrupted ? 'passed' : stopped ? 'skipped' : 'failed',
    code,
    durationMs: Math.round(performance.now() - started),
    ...(timedOut ? { reason: `Timed out after ${Math.round(limit / 1000)} s` } : {}),
    ...(stopped ? { reason: `Stopped because ${halted} failed` } : {}),
  };
  const skippedParts = await readFile(skippedSteps, 'utf8').catch(() => '');
  if (skippedParts.trim())
    result.skippedSteps = skippedParts
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
  if (timedOut) {
    result.lastLines = lastLines(output);
    if (hang) {
      const done = await readFile(hang + '.done', 'utf8').catch(() => null);
      result.screenshots = done ? JSON.parse(done).screenshots : 'The check saved no screenshots';
      await rm(hang, { force: true });
      await rm(hang + '.done', { force: true });
    }
  }
  report.checks.push(result);
  await writeFile(path.join(directory, fileName(name) + '.log'), output);
  console.log(
    `${result.status.toUpperCase()} ${name} (${(result.durationMs / 1000).toFixed(1)}s)` +
      (result.skippedSteps ? ` ${skippedNote(result)}` : ''),
  );
  if (result.status === 'failed') {
    console.log(output.slice(-5000));
    if (result.screenshots) console.log('Screenshots at the timeout:', result.screenshots);
    // Stop the checks running beside the first failure and start no more.
    if (known.includes(name) && !halted) {
      halted = name;
      void stopAll();
    }
  }
  return result.status === 'passed';
}
// "(skipped: install, VIRTUAL_CUT_OCR_DOWNLOADS not set; …)" for the parts a check skipped.
function skippedNote(r) {
  return `(skipped: ${r.skippedSteps.map((s) => `${s.step}, ${s.reason}`).join('; ')})`;
}
// A timed-out check also lists its screenshots; its last log lines are in report.json.
const reportLine = (r) =>
  `- ${r.status}: ${r.name}${r.skippedSteps ? ' ' + skippedNote(r) : ''}` +
  (r.reason ? ' — ' + r.reason : '') +
  (Array.isArray(r.screenshots) ? `. Screenshots: ${r.screenshots.join(', ')}` : '');
const skip = (name, reason) => {
  report.checks.push({ name, status: 'skipped', reason });
  console.log(`SKIPPED ${name}: ${reason}`);
  return false;
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
  if (profile === 'fast' || profile === 'all') {
    await run('lint', process.execPath, [
      path.join(root, 'node_modules/oxlint/bin/oxlint'),
      '--type-aware',
    ]);
    // The same files as npm run format:check, so formatting drift fails the fast gate.
    const formatCheck = manifest.scripts['format:check'];
    if (!formatCheck?.startsWith('prettier --check --cache '))
      throw new Error('Keep format:check as "prettier --check --cache <paths>" for the fast gate.');
    await run('format', process.execPath, [
      path.join(root, 'node_modules/prettier/bin/prettier.cjs'),
      '--check',
      '--cache',
      ...formatCheck.slice('prettier --check --cache '.length).split(' '),
    ]);
  }
  const ready = (name) => {
    const deps = dependencies[name] || [];
    const failedDependency = deps.find(
      (d) => !report.checks.some((r) => r.name === d && r.status === 'passed'),
    );
    if (!build || interrupted) return skip(name, interrupted ? 'Run interrupted' : 'Build failed');
    if (halted) return skip(name, `Not started because ${halted} failed`);
    if (failedDependency)
      return skip(name, `Prerequisite ${failedDependency} did not pass in this run`);
    if (!fast.includes(name) && (!report.tools.ffmpeg.available || !report.tools.ffprobe.available))
      return skip(name, 'FFmpeg and FFprobe are required');
    if (packaged && desktop.includes(name) && (!executable || !existsSync(executable)))
      return skip(name, 'Set VIRTUAL_CUT_TEST_EXECUTABLE to the packaged Windows application');
    return true;
  };
  const start = (name) => {
    if (fast.includes(name))
      return run(name, process.execPath, [
        ...(process.env.VIRTUAL_CUT_COVERAGE_DIR
          ? ['--import', './scripts/coverage-fast.mjs']
          : []),
        '--experimental-strip-types',
        '--test',
        `scripts/${name}`,
      ]);
    if (native.includes(name))
      return run(name, require('electron'), [`scripts/${name}`], { ELECTRON_RUN_AS_NODE: '1' });
    return run(name, process.execPath, [`scripts/${name}`]);
  };
  // Up to --jobs checks (default 4) run at once, in inventory order: a check starts once its
  // prerequisites have finished, after any earlier check sharing its fixture project, and
  // timing-sensitive checks run with nothing beside them. --jobs=1 is the serial order.
  // The first failure stops the checks beside it and skips the rest.
  const pending = known.filter((s) => wanted.has(s));
  const running = new Map();
  const lane = (name) => sharedFixtures.find((group) => group.includes(name));
  while (pending.length || running.size) {
    let started = false;
    for (const name of [...pending]) {
      if (running.size >= jobs || [...running.keys()].some((r) => exclusive.includes(r))) break;
      const waiting = (other) => pending.includes(other) || running.has(other);
      if ((dependencies[name] || []).some(waiting)) continue;
      const shared = lane(name);
      if (shared?.slice(0, shared.indexOf(name)).some(waiting)) continue;
      // Hold the queue for an exclusive check, so it is not starved by the others.
      if (exclusive.includes(name) && running.size) break;
      pending.splice(pending.indexOf(name), 1);
      started = true;
      if (ready(name) !== true) continue;
      running.set(
        name,
        start(name).finally(() => running.delete(name)),
      );
      if (exclusive.includes(name)) break;
    }
    if (!started && running.size) await Promise.race(running.values());
    else if (!started && pending.length) throw new Error(`Cannot schedule ${pending.join(', ')}`);
  }
} catch (error) {
  report.checks.push({ name: 'suite', status: 'failed', reason: String(error) });
} finally {
  await stopAll();
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
      report.checks.map(reportLine).join('\n'),
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
        report.checks.map(reportLine).join('\n') +
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
