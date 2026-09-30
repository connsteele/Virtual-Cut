import { spawn } from 'node:child_process';
import path from 'node:path';
import { root, require, runNode } from './shared.mjs';
await runNode(path.join(root, 'scripts/build.mjs'));
await new Promise((resolve, reject) => {
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', '--test', path.join(root, 'scripts/timeline-viewport.test.mjs')],
    { cwd: root, windowsHide: true, stdio: 'inherit' },
  );
  child.on('error', reject);
  child.on('exit', (code) =>
    code === 0 ? resolve() : reject(Error('Timeline viewport checks failed.')),
  );
});
await new Promise((resolve, reject) => {
  const child = spawn(
    require('electron'),
    [path.join(root, 'scripts/intake-zoom-native-checks.mjs')],
    {
      cwd: root,
      windowsHide: true,
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', TEMP: 'G:/GPT/Temp', TMP: 'G:/GPT/Temp' },
    },
  );
  child.on('error', reject);
  child.on('exit', (code) =>
    code === 0 ? resolve() : reject(Error('Drop intake native checks failed.')),
  );
});
await runNode(path.join(root, 'scripts/intake-zoom-ui-checks.mjs'));
