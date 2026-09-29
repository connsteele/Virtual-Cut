import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { require, root, runNode } from './shared.mjs';
import { brandWindowsExecutable } from './brand-windows-executable.mjs';

if (process.platform !== 'win32')
  throw new Error('The Windows folder build must be assembled on Windows.');
await runNode(path.join(root, 'scripts/build.mjs'));

const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const outputRoot = process.env.VIRTUAL_CUT_PACKAGE_DIR
  ? path.resolve(process.env.VIRTUAL_CUT_PACKAGE_DIR)
  : path.join(root, 'release');
// Each package gets a new folder. Never remove an existing app or user files.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = path.join(
  outputRoot,
  `Virtual-Cut-${manifest.version}-win-${process.arch}-${stamp}`,
);
if (existsSync(destination)) throw new Error('The requested output folder already exists.');
await mkdir(destination, { recursive: true });
await cp(path.dirname(require('electron')), destination, {
  recursive: true,
  force: false,
  errorOnExist: true,
});
await rename(path.join(destination, 'electron.exe'), path.join(destination, 'Virtual Cut.exe'));
await brandWindowsExecutable(
  path.join(destination, 'Virtual Cut.exe'),
  path.join(root, 'public/icon.ico'),
  manifest,
);

const appDirectory = path.join(destination, 'resources', 'app');
await mkdir(appDirectory, { recursive: true });
const demoManifest = path.join(root, 'demo-media.local.json');
if (existsSync(demoManifest))
  await cp(demoManifest, path.join(appDirectory, 'demo-media.local.json'));
await cp(path.join(root, 'dist'), path.join(appDirectory, 'dist'), { recursive: true });
await cp(path.join(root, 'dist-electron'), path.join(appDirectory, 'dist-electron'), {
  recursive: true,
});
await writeFile(
  path.join(appDirectory, 'package.json'),
  JSON.stringify(
    {
      name: manifest.name,
      productName: manifest.productName,
      version: manifest.version,
      type: 'module',
      main: manifest.main,
    },
    null,
    2,
  ) + '\n',
);
await writeFile(
  path.join(destination, 'READ-ME.txt'),
  'Virtual Cut workflow preview\r\n\r\nLaunch Virtual Cut.exe. Keep every file in this folder together.\r\nF11 toggles fullscreen. Explore Media, Cut, Review, Library, and Selects.\r\nUse Open video for one completed recording and session-only drafts.\r\nFull-resolution demo videos use the G: folder configured in resources/app/demo-media.local.json. Keep that folder available.\r\nSample edits are saved locally; Preview options can reset them.\r\nExport, filing, Resolve handoff, Notion sync, and agent actions are previews.\r\nNo original footage is changed.\r\nThis is a local, unsigned preview build; installer, signing, and updates come later.\r\n',
);
console.log(`Desktop folder ready: ${destination}`);
