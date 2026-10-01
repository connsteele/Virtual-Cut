import { spawn } from 'node:child_process';
import { require, root } from './shared.mjs';
import path from 'node:path';

// Project checkpoints use Electron's bundled SQLite API, including backup().
await new Promise((resolve, reject) => {
  const child = spawn(require('electron'), [path.join(root, 'scripts/filmstrip-checks.mjs')], {
    cwd: root,
    windowsHide: true,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', TEMP: 'G:/GPT/Temp', TMP: 'G:/GPT/Temp' },
  });
  child.on('error', reject);
  child.on('exit', (code) =>
    code === 0 ? resolve() : reject(new Error(`Native filmstrip checks failed (${code}).`)),
  );
});
