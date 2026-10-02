import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import coverageLibrary from 'istanbul-lib-coverage';
import reportLibrary from 'istanbul-lib-report';
import reports from 'istanbul-reports';
import { native, desktop, fast } from './test-inventory.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createCoverageMap } = coverageLibrary;
const { createContext } = reportLibrary;
export function validateCollectors(records, checks) {
  const errors = [];
  for (const expectation of records.filter((r) => r.expected))
    for (const kind of expectation.expected)
      if (
        !records.some(
          (r) =>
            r.pid === expectation.pid &&
            r.check === expectation.check &&
            r.kind === kind &&
            r.complete &&
            Object.keys(r.coverage || {}).length,
        )
      )
        errors.push(`Missing ${kind}: ${expectation.check}, process ${expectation.pid}`);
  for (const check of checks) {
    if (check.status !== 'passed') {
      errors.push(`Test did not pass: ${check.name}`);
      continue;
    }
    if (desktop.includes(check.name) && !records.some((r) => r.check === check.name && r.expected))
      errors.push(`Missing launch manifest: ${check.name}`);
    if (
      check.name !== 'coverage-pipeline.test.mjs' &&
      (native.includes(check.name) || fast.includes(check.name)) &&
      !records.some(
        (r) =>
          r.check === check.name &&
          r.kind === 'native' &&
          r.complete &&
          Object.keys(r.coverage || {}).length,
      )
    )
      errors.push(`Missing native/unit coverage: ${check.name}`);
  }
  return errors;
}
export function checkGates(map, gates) {
  const errors = [];
  for (const [file, minimum] of Object.entries(gates)) {
    const full = path.resolve(root, file);
    if (!map.files().includes(full)) {
      errors.push(`Missing critical module ${file}`);
      continue;
    }
    const summary = map.fileCoverageFor(full).toSummary().data;
    for (const [metric, threshold] of Object.entries(minimum))
      if (summary[metric].pct < threshold)
        errors.push(`${file} ${metric}: ${summary[metric].pct}% < ${threshold}%`);
  }
  return errors;
}
export async function coverageReport(directory, suiteFile, gateFile) {
  const suite = JSON.parse(await readFile(suiteFile, 'utf8'));
  const records = await Promise.all(
    (await readdir(path.join(directory, 'raw')))
      .filter((f) => f.endsWith('.json'))
      .map(async (file) => JSON.parse(await readFile(path.join(directory, 'raw', file), 'utf8'))),
  );
  const errors = validateCollectors(records, suite.checks);
  const baseline = JSON.parse(await readFile(path.join(directory, 'baseline.json'), 'utf8'));
  const map = createCoverageMap(baseline);
  for (const record of records)
    if (record.coverage) {
      // Prefer an exit snapshot (includes shutdown); otherwise use the desktop final read.
      if (
        record.kind === 'native' &&
        !record.complete &&
        records.some((r) => r.kind === 'main' && r.pid === record.pid && r.check === record.check)
      )
        continue;
      if (
        record.kind === 'main' &&
        records.some(
          (r) =>
            r.kind === 'native' && r.complete && r.pid === record.pid && r.check === record.check,
        )
      )
        continue;
      for (const file of Object.keys(record.coverage)) {
        if (!baseline[file]) {
          errors.push(`Unexpected/unmapped application source ${file}`);
          continue;
        }
        map.merge({ [file]: record.coverage[file] });
      }
    }
  const fullInventory = [...fast, ...native, ...desktop].every((name) =>
    suite.checks.some((c) => c.name === name && c.status === 'passed'),
  );
  if (gateFile && fullInventory)
    errors.push(...checkGates(map, JSON.parse(await readFile(gateFile, 'utf8'))));
  const summaries = {};
  for (const [area, filter] of Object.entries({
    renderer: (file) => file.startsWith(path.join(root, 'src') + path.sep),
    native: (file) => file.startsWith(path.join(root, 'electron') + path.sep),
    combined: () => true,
  })) {
    const selected = createCoverageMap({});
    map
      .files()
      .filter(filter)
      .forEach((file) => selected.addFileCoverage(map.fileCoverageFor(file)));
    const output = path.join(directory, area);
    await mkdir(output, { recursive: true });
    const context = createContext({
      dir: output,
      coverageMap: selected,
      sourceFinder: (file) => readFileSync(file, 'utf8'),
    });
    for (const kind of ['html', 'json', 'json-summary', 'lcovonly'])
      reports.create(kind).execute(context);
    summaries[area] = selected.getCoverageSummary().data;
  }
  const result = {
    status: errors.length ? 'failed' : fullInventory ? 'complete' : 'focused',
    suiteFile,
    gatesApplied: !!gateFile && fullInventory,
    summaries,
    errors,
    partialProcesses: records
      .filter(
        (r) =>
          r.coverage &&
          !r.complete &&
          !records.some(
            (final) =>
              final.kind === 'main' &&
              final.pid === r.pid &&
              final.check === r.check &&
              final.complete,
          ),
      )
      .map(({ check, pid }) => ({ check, pid })),
    sourceFiles: map.files().length,
    inventory: Object.keys(baseline),
  };
  await writeFile(path.join(directory, 'summary.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: result.status, summaries, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
  return result;
}
import { readFileSync } from 'node:fs';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await coverageReport(process.argv[2], process.argv[3], process.argv[4]);
