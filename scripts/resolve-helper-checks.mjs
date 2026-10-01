import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, mkdtemp } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { require, root } from './shared.mjs';
import { testPath } from './test-paths.mjs';
const { installResolveHelper } = require('../dist-electron/resolve-helper.cjs');
const folder = testPath('resolve-helper');
await mkdir(folder, { recursive: true });
const dir = await mkdtemp(path.join(folder, 'native-'));
const bundled = path.join(root, 'integrations/resolve/Virtual Cut metadata.py');
const installed = await installResolveHelper(bundled, dir);
assert.equal(await readFile(installed, 'utf8'), await readFile(bundled, 'utf8'));
assert.equal(await installResolveHelper(bundled, dir), installed);
await writeFile(installed, '# User customized script');
await assert.rejects(() => installResolveHelper(bundled, dir), /changed/);
assert.equal(await readFile(installed, 'utf8'), '# User customized script');
const python = process.env.VIRTUAL_CUT_PYTHON || 'python';
await new Promise((resolve, reject) => {
  const child = spawn(python, ['-B', 'scripts/resolve-helper.test.py'], {
    cwd: root,
    windowsHide: true,
    stdio: 'inherit',
  });
  child.on('error', reject);
  child.on('exit', (code) =>
    code === 0 ? resolve() : reject(Error('Resolve helper tests failed')),
  );
});
console.log(
  'Resolve helper reconciliation, Unicode/multiline notes, ownership, collision, conflict, stale plans, rollback, VFR guard and installation preservation passed.',
);
