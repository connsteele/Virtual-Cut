import { spawn } from 'node:child_process';
import { require, root, runNode } from './shared.mjs';
await runNode('scripts/build.mjs');
await new Promise((resolve, reject) => {
  const child = spawn(require('electron'), ['scripts/review-planning-native.mjs'], {
    cwd: root,
    windowsHide: true,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', TEMP: 'G:/GPT/Temp', TMP: 'G:/GPT/Temp' },
  });
  child.on('error', reject);
  child.on('exit', (code) =>
    code === 0 ? resolve() : reject(Error(`Review native checks failed: ${code}`)),
  );
});
await runNode('scripts/review-planning-ui.mjs');
