import { spawn } from 'node:child_process';
import path from 'node:path';
import { root, require, runNode, skippedStep } from './shared.mjs';
await runNode(path.join(root, 'scripts/build.mjs'));
async function native(script) {
  await new Promise((resolve, reject) => {
    const child = spawn(require('electron'), [path.join(root, 'scripts', script)], {
      cwd: root,
      windowsHide: true,
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(Error('Export checks failed.'))));
  });
}
await native('export-native-checks.mjs');
await native('export-feedback-native.mjs');
if (process.env.VIRTUAL_CUT_REAL_EXPORT === '1') await native('export-real-check.mjs');
else skippedStep('real export', 'VIRTUAL_CUT_REAL_EXPORT not 1');
await runNode(path.join(root, 'scripts/export-ui-checks.mjs'));
