import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
const toolDirectory = path.join(destination, 'resources', 'tools');
await mkdir(toolDirectory, { recursive: true });
const versions = [];
for (const name of ['ffmpeg', 'ffprobe']) {
  const override = process.env[name === 'ffmpeg' ? 'VIRTUAL_CUT_FFMPEG' : 'VIRTUAL_CUT_FFPROBE'];
  const executable =
    override ||
    execFileSync('where.exe', [name], { encoding: 'utf8', windowsHide: true })
      .trim()
      .split(/\r?\n/)[0];
  await cp(executable, path.join(toolDirectory, name + '.exe'));
  versions.push(execFileSync(executable, ['-version'], { encoding: 'utf8', windowsHide: true }));
  const license = path.resolve(path.dirname(executable), '..', 'LICENSE.txt');
  if (existsSync(license)) await cp(license, path.join(toolDirectory, 'FFmpeg-LICENSE.txt'));
}
await writeFile(path.join(toolDirectory, 'BUILD-INFO.txt'), versions.join('\r\n'));
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
  'Virtual Cut - Milestone 1 test build\r\n\r\nLaunch Virtual Cut.exe. Keep every file in this folder together.\r\nProjects (beside the page name) creates or opens a .vcut project. Choose a finished-clip destination and a separate preview cache.\r\nImport files or a folder into a named batch. Media jobs can be cancelled or retried from Jobs.\r\nCut edits and project notes save automatically. Undo/Redo works across reopening. Sources remain unchanged.\r\nSource & audio selects Game/Mic roles. Game preview audio is prepared on intake; use Prepare selected audio after changing roles.\r\nQ/W set in/out points; S splits the selected clip; M adds a marker. J/K/L controls playback; Ctrl+Shift+Up/Down changes recordings. F11 toggles fullscreen.\r\nExport, physical filing, Resolve handoff, transcription, and agents are later milestones.\r\nThe separate sample workspace keeps its earlier prototype actions.\r\nFFmpeg and FFprobe are included in resources/tools for this local test build.\r\nThis is an unsigned local build; installer, signing, and updates come later.\r\n',
);
console.log(`Desktop folder ready: ${destination}`);
