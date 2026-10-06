import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { require, root, runNode } from './shared.mjs';
import { brandWindowsExecutable } from './brand-windows-executable.mjs';

if (process.env.VIRTUAL_CUT_COVERAGE_DIR)
  throw new Error(
    'Coverage builds are test-only and cannot be packaged. Unset VIRTUAL_CUT_COVERAGE_DIR.',
  );

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
await cp(path.join(root, 'integrations'), path.join(appDirectory, 'integrations'), {
  recursive: true,
});
// Electron main's runtime packages and their dependencies (VC-159). The renderer's
// packages are bundled by Vite; nothing else from node_modules is shipped.
const mainPackages = ['@modelcontextprotocol/server'];
const shipped = new Set();
async function shipPackage(name) {
  if (shipped.has(name)) return;
  shipped.add(name);
  const source = path.join(root, 'node_modules', ...name.split('/'));
  const info = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
  await cp(source, path.join(appDirectory, 'node_modules', ...name.split('/')), {
    recursive: true,
    errorOnExist: true,
  });
  for (const dependency of Object.keys(info.dependencies || {})) await shipPackage(dependency);
}
for (const name of mainPackages) await shipPackage(name);
const toolDirectory = path.join(destination, 'resources', 'tools');
await mkdir(toolDirectory, { recursive: true });
// Explicit local-review configuration only. Public packages never embed workstation paths.
if (process.env.VIRTUAL_CUT_ASR_REVIEW_CONFIG) {
  const config = JSON.parse(await readFile(process.env.VIRTUAL_CUT_ASR_REVIEW_CONFIG, 'utf8'));
  for (const key of [
    'python',
    'libraries',
    'model',
    ...(config.gpuLibraries ? ['gpuLibraries'] : []),
  ])
    if (
      typeof config[key] !== 'string' ||
      !path.isAbsolute(config[key]) ||
      !existsSync(config[key])
    )
      throw new Error(`Invalid local transcription review location: ${key}`);
  await writeFile(
    path.join(toolDirectory, 'asr-runtime.local.json'),
    JSON.stringify(
      {
        python: config.python,
        libraries: config.libraries,
        model: config.model,
        gpuLibraries: config.gpuLibraries,
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(destination, 'LOCAL-TRANSCRIPTION.txt'),
    'This local review build reuses the Python speech runtime, optional NVIDIA libraries and cached model on this workstation. Those files are not bundled. On another computer, open Transcript > Speech engine > Download speech engine, choose a folder and explicitly download the verified recognition engine/model. Your own Python installation remains supported under Advanced. Automatic prefers NVIDIA after a readiness check and falls back to CPU. Per-job CPU/NVIDIA choices are also available.\r\n',
  );
}
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
  'Virtual Cut - Milestone 3 test build\r\n\r\nLaunch Virtual Cut.exe. Keep every file in this folder together.\r\nProjects (beside the page name) creates or opens a .vcut project. Choose a finished-clip destination and a separate preview cache.\r\nImport files or a folder into a named batch, including nested folders. Media displays actual source folders; drag the separators to resize the folder and thumbnail panels. Delete batch can preserve work in another batch or remove exclusive app records and disposable previews; originals and shared work are retained. A protective manual save restores removed work and regenerates previews. Media jobs can be cancelled or retried from Jobs.\r\nEdits autosave every 10 minutes by default, after playback/seeking and edits settle. Save history changes the interval and offers optional saving after edits. Save / Ctrl+S immediately saves and creates a manual checkpoint; normal close also saves. Undo/Redo stays available after Save but starts fresh when reopening. A crash can lose changes since the last save. Save history lists and restores five autosaves and five manual copies beside the .vcut project; a verified pre-upgrade copy is also retained. Sources remain unchanged.\r\nBatch imports ask which audio tracks contain game sound and microphone notes. Both tracks prepare automatically. Source & audio setup allows per-recording changes. Listen: Game/Mic/Combined and Off/Overlay/Replace waveforms are beside playback.\r\nQ/W set in/out points; S splits the selected clip; M creates a Blue marker with its name ready to type; marker colors use the Resolve palette. H toggles Manipulate mode: drag a clip edge to trim or a circular marker to change its time; release commits one undo step and Escape cancels. Focus a marker and use arrows for frame steps, Shift+arrows for seconds. R renames; Backspace asks to delete; Enter confirms and Escape cancels. Selection follows playhead keeps the last clip through gaps. J scans backward; K/Space toggles play/pause; L starts at 1x then accelerates to 2x/4x/8x/16x. The loop button repeats the selected clip. Audio controls are grouped on the right; Ctrl+Up/Down changes items. F11 toggles fullscreen. Keyboard shortcuts is in the bottom bar.\r\nExport one selected clip from Cut or Review. Same as source is the default container; MP4/MKV overrides remain. Original video and game audio are copied with outward keyframe cuts and verified packet timing. Chapter names are embedded; a .vcut.json companion preserves colors and notes. Exports lists actual ranges and processing time and opens outputs in Explorer. Review > File queue copies accepted current clips into the reviewed destination folders, with confirmation of clean game audio. Per-item results become Done only after video, metadata and dates pass verification. Cancel remaining filing stops pending work; Jobs/Exports offer explicit retry. Library searches completed clips and their notes/markers, previews without the original recording, and relinks a moved matching video/companion pair. Handoff in the bottom bar shows the Resolve helper status/location, installs or updates it, and removes only an unchanged app-owned helper while preserving customized scripts and backups. It provides an explicit helper for Workspace > Scripts > Utility: select imported videos, Check selected clips, then Apply. It enriches chapter markers with multiline notes and colors, detects conflicting user edits and avoids duplicate markers. Clip notes/context remain in the companion and Library. Transcript opens a separate floating window. Transcript > Speech engine shows the one engine in use and offers Download speech engine: choose storage, review sizes and optional NVIDIA libraries, then explicitly download; a checked download is used straight away and a replaced downloaded engine can be deleted. Your own Python installation is under Advanced. A compatible NVIDIA driver remains a system prerequisite; recognition needs no account or audio upload. Imports offer opt-in local transcription for game audio, microphone audio or both; the option is off by default. Click a transcript word to seek, search original/corrected text, correct words or whole phrases, and review tentative Marker (legacy Mark), Note, Split or Clip start/end candidates before accepting them. Single-click seeks, double-click corrects, Escape closes the editor and J/K/L works outside typing controls. Cue filters and playback following work across pages. Automatic prefers a verified NVIDIA GPU with CPU fallback; device choice is available for each request. Undo is in the main editor. SRT and JSON transcript exports support source and completed-clip timing. Project and batch context supplies optional game terms and a video brief. Recognition runs only during an explicit job. Pause stops the worker; Resume restarts the track. Original recognition and corrections are retained separately. Speaker detection and automated agent correction remain future work.\r\nReview acceptance is tied to the exact reviewed clip, audio roles and annotations. Older accepted clips need one fresh acceptance. Destination planning supports existing/planned folders, multiple clips and full-path collision checks. Browsing does not create folders; filing creates regular destination folders only after confirmation, retaining originals. Diagnostics in the bottom bar opens bounded local logs or copies/saves a report; no automatic upload.\r\nThe separate sample workspace keeps its earlier prototype actions.\r\nFFmpeg and FFprobe are included in resources/tools for this local test build.\r\nThis is an unsigned local build; installer, signing, and updates come later.\r\n',
);
console.log(`Desktop folder ready: ${destination}`);
