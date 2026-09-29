import { spawn } from 'node:child_process';
import { assertBuilt, electronEnvironment, require, root, stopChild } from './shared.mjs';

assertBuilt();
const env = electronEnvironment();
delete env.VIRTUAL_CUT_DEV_URL;
const child = spawn(require('electron'), [root], {
  cwd: root,
  stdio: 'inherit',
  env,
  windowsHide: true,
});
child.once('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 0;
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    await stopChild(child);
    process.exit(0);
  });
