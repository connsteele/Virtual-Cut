import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { electronEnvironment, require, root, stopChild, tsc } from './shared.mjs';

let server;
let watcher;
let desktop;
let timer;
let stopping = false;
let rebuilding = false;
let rebuildAgain = false;

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  watcher?.close();
  await stopChild(desktop);
  await server?.close();
  process.exit(code);
}

async function launchDesktop() {
  const previous = desktop;
  desktop = undefined;
  await stopChild(previous);
  if (stopping) return;
  const launched = spawn(require('electron'), [root], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    env: electronEnvironment({ VIRTUAL_CUT_DEV_URL: 'http://127.0.0.1:5173/' }),
  });
  desktop = launched;
  launched.once('error', (error) => {
    console.error(error);
    void stop(1);
  });
  launched.once('exit', (code) => {
    if (desktop === launched) void stop(code ?? 0);
  });
}

async function rebuildDesktop() {
  if (rebuilding) {
    rebuildAgain = true;
    return;
  }
  rebuilding = true;
  do {
    rebuildAgain = false;
    try {
      await tsc(['--project', 'tsconfig.electron.json']);
      await launchDesktop();
    } catch (error) {
      console.error(error);
      console.log('Waiting for the next Electron source change.');
    }
  } while (rebuildAgain && !stopping);
  rebuilding = false;
}

for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    void stop();
  });

try {
  await tsc(['--project', 'tsconfig.electron.json']);
  server = await createServer();
  await server.listen();
  server.printUrls();
  await launchDesktop();
  watcher = watch(path.join(root, 'electron'), { recursive: true }, (_event, file) => {
    if (file && !/\.(?:cts|ts)$/.test(file)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void rebuildDesktop();
    }, 180);
  });
} catch (error) {
  console.error(error);
  await stop(1);
}
