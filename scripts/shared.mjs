import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const require = createRequire(import.meta.url);

export function electronEnvironment(extra = {}) {
  const env = { ...process.env, ...extra };
  // Editors may set this for their own Node utilities. A desktop launch needs
  // Electron's browser process, not its alternate command-line Node mode.
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

export async function runNode(script, args = []) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`${path.basename(script)} failed (${signal ?? code}).`)),
    );
  });
}

export function tsc(args) {
  return runNode(require.resolve('typescript/bin/tsc'), args);
}

export function assertBuilt() {
  for (const file of ['dist/index.html', 'dist-electron/main.cjs', 'dist-electron/preload.cjs']) {
    if (!existsSync(path.join(root, file)))
      throw new Error('Build Virtual Cut first with npm run build.');
  }
}

/** Stop only a child started by this launcher, including Electron helpers. */
export async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', () => {
        child.kill();
        resolve();
      });
      killer.once('exit', resolve);
    });
  } else {
    child.kill('SIGTERM');
  }
}
