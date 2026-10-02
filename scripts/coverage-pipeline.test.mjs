import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import coverageLibrary from 'istanbul-lib-coverage';
import { instrument } from './coverage-build.mjs';
import { checkGates, validateCollectors } from './coverage-report.mjs';
const { createCoverageMap } = coverageLibrary;

test('a real unexecuted branch fails its coverage gate; untouched source stays in the denominator', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const file = path.join(root, 'src/coverage-proof.ts');
  const source = 'function choose(value) { return value ? 1 : 2; } choose(true);';
  const result = instrument(source, file);
  const untouched = instrument(
    'function neverCalled() { return 5; }',
    path.join(root, 'src/untouched-proof.ts'),
  );
  const context = vm.createContext({});
  vm.runInContext(result.code, context);
  const map = createCoverageMap({
    [file]: result.coverage,
    [untouched.coverage.path]: untouched.coverage,
  });
  map.merge(context.__coverage__);
  assert.equal(map.fileCoverageFor(file).toSummary().branches.pct, 50);
  assert.equal(checkGates(map, { 'src/coverage-proof.ts': { branches: 100 } }).length, 1);
  assert.equal(checkGates(map, { 'src/coverage-proof.ts': { branches: 50 } }).length, 0);
  assert.equal(map.fileCoverageFor(untouched.coverage.path).toSummary().functions.pct, 0);
});
test('missing renderer, preload, native and launch reports fail validation', () => {
  const record = { check: 'smoke.mjs', pid: 42, expected: ['main', 'renderer', 'preload'] };
  assert.equal(validateCollectors([record], [{ name: 'smoke.mjs', status: 'passed' }]).length, 3);
  assert.equal(validateCollectors([], [{ name: 'smoke.mjs', status: 'passed' }]).length, 1);
  assert.equal(
    validateCollectors([], [{ name: 'filing-native-checks.mjs', status: 'passed' }]).length,
    1,
  );
});
