import { spawn } from 'node:child_process';
import path from 'node:path';
import { root, require, runNode } from './shared.mjs';
await runNode(path.join(root, 'scripts/build.mjs'));
for (const script of ['feedback-native-checks.mjs', 'recording-removal-checks.mjs'])
  await new Promise((resolve, reject) => {
    const child = spawn(require('electron'), [path.join(root, 'scripts', script)], {
      cwd: root,
      windowsHide: true,
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', TEMP: 'G:/GPT/Temp', TMP: 'G:/GPT/Temp' },
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(Error('Feedback native checks failed.')),
    );
  });
await runNode(path.join(root, 'scripts/feedback-ui-checks.mjs'));
