import { spawn } from 'node:child_process';
import {
  mkdir,
  readFile,
  writeFile,
  mkdtemp,
  readdir,
  stat,
  unlink,
  symlink,
  rmdir,
} from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { require, root } from './shared.mjs';
import { testPath } from './test-paths.mjs';
const {
  installResolveHelper,
  resolveHelperStatus,
  removeResolveHelper,
} = require('../dist-electron/resolve-helper.cjs');
const folder = testPath('resolve-helper');
await mkdir(folder, { recursive: true });
const dir = await mkdtemp(path.join(folder, 'native-'));
const bundled = path.join(root, 'integrations/resolve/Virtual Cut metadata.py');
assert.equal((await resolveHelperStatus(bundled, dir)).state, 'missing');
const installed = await installResolveHelper(bundled, dir);
assert.equal(await readFile(installed, 'utf8'), await readFile(bundled, 'utf8'));
assert.equal(await installResolveHelper(bundled, dir), installed);
assert.equal((await resolveHelperStatus(bundled, dir)).state, 'installed');
await writeFile(path.join(dir, 'Other script.py'), '# unrelated');
const updatedBundle = path.join(dir, 'next.py');
await writeFile(updatedBundle, (await readFile(bundled, 'utf8')) + '\n# Updated bundle fixture\n');
assert.equal((await resolveHelperStatus(updatedBundle, dir)).state, 'outdated');
await installResolveHelper(updatedBundle, dir);
const backup = (await readdir(dir)).find((n) => n.includes('.previous-'));
assert.equal(await readFile(path.join(dir, backup), 'utf8'), await readFile(bundled, 'utf8'));
assert.equal((await removeResolveHelper(updatedBundle, dir)).state, 'missing');
assert.equal(await stat(installed).catch(() => null), null);
assert.equal(await stat(installed + '.vcut-install.json').catch(() => null), null);
assert.equal(await readFile(path.join(dir, 'Other script.py'), 'utf8'), '# unrelated');
assert.equal(await readFile(path.join(dir, backup), 'utf8'), await readFile(bundled, 'utf8'));
await writeFile(installed, await readFile(bundled));
assert.equal((await resolveHelperStatus(bundled, dir)).state, 'unmanaged');
await assert.rejects(() => removeResolveHelper(bundled, dir), /preserved/);
await installResolveHelper(bundled, dir);
assert.equal((await resolveHelperStatus(bundled, dir)).state, 'installed');
await writeFile(installed, '# User customized script');
assert.equal((await resolveHelperStatus(bundled, dir)).state, 'customized');
await assert.rejects(() => removeResolveHelper(bundled, dir), /preserved/);
await assert.rejects(() => installResolveHelper(bundled, dir), /changed/);
assert.equal(await readFile(installed, 'utf8'), '# User customized script');
await writeFile(installed + '.vcut-install.json', 'invalid JSON');
assert.equal((await resolveHelperStatus(bundled, dir)).state, 'customized');
await assert.rejects(() => removeResolveHelper(bundled, dir), /preserved/);
await unlink(installed);
const linkTarget = path.join(dir, 'other-scripts');
await mkdir(linkTarget);
await writeFile(path.join(linkTarget, 'preserved.py'), '# unrelated linked directory');
await symlink(linkTarget, installed, 'junction');
await assert.rejects(() => removeResolveHelper(bundled, dir), /link/);
assert.equal(await readFile(path.join(dir, 'Other script.py'), 'utf8'), '# unrelated');
assert.equal(
  await readFile(path.join(linkTarget, 'preserved.py'), 'utf8'),
  '# unrelated linked directory',
);
await rmdir(installed);
const linkedDir = path.join(dir, 'linked');
await symlink(dir, linkedDir, 'junction');
await assert.rejects(() => installResolveHelper(bundled, linkedDir), /link/);
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
