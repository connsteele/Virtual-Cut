// Reconcile a complete run and explicit retries without hiding the original failures.
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { coverageReport } from './coverage-report.mjs';

const [output, ...inputs] = process.argv.slice(2);
if (!output || inputs.length < 2)
  throw new Error('Usage: coverage-merge.mjs OUTPUT RUN_DIRECTORY RETRY_DIRECTORY [...]');
const runs = await Promise.all(
  inputs.map(async (directory) => ({
    directory,
    suite: JSON.parse(await readFile(path.join(directory, 'report.json'), 'utf8')),
    sources: JSON.parse(await readFile(path.join(directory, 'coverage/sources.json'), 'utf8')),
    baseline: JSON.parse(await readFile(path.join(directory, 'coverage/baseline.json'), 'utf8')),
  })),
);
for (const run of runs) {
  assert.deepEqual(run.sources, runs[0].sources, 'Cannot combine different application sources');
  assert.deepEqual(run.baseline, runs[0].baseline, 'Cannot combine different instrumentation');
}
const selected = new Map();
const superseded = [];
for (const [index, run] of runs.entries())
  for (const check of run.suite.checks) {
    if (selected.has(check.name)) superseded.push(selected.get(check.name));
    selected.set(check.name, { ...check, run: index, evidence: run.directory });
  }
await mkdir(path.join(output, 'raw'), { recursive: true });
assert.equal((await readdir(path.join(output, 'raw'))).length, 0, 'Output must be new');
for (const [index, run] of runs.entries()) {
  const raw = path.join(run.directory, 'coverage/raw');
  for (const file of await readdir(raw)) {
    if (!file.endsWith('.json')) continue;
    const record = JSON.parse(await readFile(path.join(raw, file), 'utf8'));
    if (selected.get(record.check)?.run !== index) continue;
    // PIDs can be reused between runs; scope identities to their source run.
    record.pid = `${index}:${record.pid}`;
    await writeFile(path.join(output, 'raw', `${index}-${file}`), JSON.stringify(record));
  }
}
await writeFile(path.join(output, 'baseline.json'), JSON.stringify(runs[0].baseline));
await writeFile(path.join(output, 'sources.json'), JSON.stringify(runs[0].sources));
const suiteFile = path.join(output, 'reconciled-tests.json');
await writeFile(
  suiteFile,
  JSON.stringify(
    {
      description: 'Latest explicit attempt per check; original reports retained.',
      inputs,
      superseded,
      checks: [...selected.values()],
    },
    null,
    2,
  ),
);
await coverageReport(output, suiteFile, process.env.VIRTUAL_CUT_COVERAGE_GATES);
