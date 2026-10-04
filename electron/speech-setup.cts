import { createReadStream, existsSync, readFileSync } from 'node:fs';
import {
  access,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { AsrRuntime } from './transcript-contracts.js' with { 'resolution-mode': 'import' };
import type { SpeechSetupLocation, SpeechSetupState } from './speech-setup-contracts.js' with {
  'resolution-mode': 'import',
};
import type { TranscriptionRuntime } from './transcription-runtime.cjs';

interface Artifact {
  name: string;
  url: string;
  sha256: string;
  bytes: number;
  expandedBytes: number;
  kind: 'python' | 'wheel' | 'gpu' | 'model';
  package?: string;
  version?: string;
}
interface Manifest {
  id: string;
  python: string;
  engine: string;
  model: string;
  artifacts: Artifact[];
}
const integration = path.resolve(__dirname, '..', 'integrations', 'transcription');

/** Recognize a runtime this installer created; anything else is a manual setup. */
export function describeRuntime(settings: AsrRuntime): SpeechSetupLocation {
  const install = path.dirname(path.dirname(settings.python));
  const downloaded =
    /^install-[0-9a-f-]{36}$/.test(path.basename(install)) &&
    path.basename(path.dirname(install)) === 'Virtual Cut speech' &&
    settings.python === path.join(install, 'python', 'python.exe') &&
    settings.libraries === path.join(install, 'libraries') &&
    settings.model === path.join(install, 'model');
  return {
    kind: downloaded ? 'downloaded' : 'manual',
    folder: downloaded ? install : path.dirname(settings.python),
    python: settings.python,
    model: settings.model,
    available:
      existsSync(settings.python) &&
      existsSync(path.join(settings.libraries, 'faster_whisper')) &&
      existsSync(path.join(settings.model, 'model.bin')),
  };
}
const label = (location: SpeechSetupLocation | undefined) =>
  location?.kind === 'downloaded' ? 'the downloaded engine' : 'your own installation';
const capital = (text: string) => text[0].toUpperCase() + text.slice(1);
async function folderBytes(folder: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) total += await folderBytes(full);
    else if (entry.isFile()) total += (await stat(full)).size;
  }
  return total;
}

export async function verifyArtifact(file: string, artifact: Pick<Artifact, 'sha256' | 'bytes'>) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  if (bytes !== artifact.bytes || hash.digest('hex') !== artifact.sha256)
    throw new Error(
      'Download verification failed. Retry the download; the engine in use is unchanged.',
    );
}
// In-memory state and polling are independent of project saves and transcript sessions.
export class SpeechSetup {
  private manifest?: Manifest;
  private root = '';
  private owned = '';
  private controller?: AbortController;
  private task?: Promise<void>;
  private sizes = new Map<string, number>();
  private state: SpeechSetupState = {
    state: 'idle',
    version: '',
    folder: '',
    includeGpu: true,
    downloadBytes: 0,
    installedBytes: 0,
    requiredBytes: 0,
    availableBytes: 0,
    downloadedBytes: 0,
    message: '',
    canRestore: false,
  };
  constructor(
    private profile: string,
    private runtime: TranscriptionRuntime,
    private report: (
      operation: 'install' | 'completed' | 'cancelled' | 'activate' | 'restore' | 'remove',
      error?: unknown,
    ) => void = () => {},
  ) {
    // Only small app metadata is read here. No directory scan, download, or model load.
    try {
      const saved = JSON.parse(
        readFileSync(path.join(profile, 'speech-setup-candidate.json'), 'utf8'),
      );
      const manifest = JSON.parse(
        readFileSync(path.join(integration, 'runtime-manifest.json'), 'utf8'),
      ) as Manifest;
      if (
        !['ready', 'activated'].includes(saved.state?.state) ||
        saved.manifest !== manifest.id ||
        typeof saved.root !== 'string' ||
        !path.isAbsolute(saved.root) ||
        !/^install-[0-9a-f-]{36}$/.test(saved.owner) ||
        saved.state.folder !== path.join(saved.root, 'Virtual Cut speech', saved.owner)
      )
        throw new Error('Old or invalid candidate.');
      this.root = saved.root;
      this.owned = saved.owner;
      this.manifest = manifest;
      this.state = saved.state;
    } catch {
      /* First use, an older manifest, or unavailable metadata: keep manual setup usable. */
    }
  }
  private async rememberCandidate() {
    await mkdir(this.profile, { recursive: true });
    const file = path.join(this.profile, 'speech-setup-candidate.json');
    await writeFile(
      file + '.next',
      JSON.stringify({
        root: this.root,
        owner: this.owned,
        manifest: this.manifest?.id,
        state: this.state,
      }),
    );
    await rename(file + '.next', file);
  }
  private async previous(): Promise<AsrRuntime | undefined> {
    try {
      return JSON.parse(
        await readFile(path.join(this.profile, 'speech-previous-runtime.json'), 'utf8'),
      ) as AsrRuntime;
    } catch {
      return undefined;
    }
  }
  /** The checked download is still on disk (it can be deleted or moved outside the app). */
  private async candidatePresent() {
    const candidate = this.candidate();
    const files = [
      path.join(this.state.folder, '.virtual-cut-speech-install.json'),
      candidate.python,
      path.join(candidate.libraries, 'faster_whisper'),
      path.join(candidate.model, 'model.bin'),
    ];
    const found = await Promise.all(
      files.map((file) =>
        access(file).then(
          () => true,
          () => false,
        ),
      ),
    );
    return found.every(Boolean);
  }
  async status() {
    const previous = await this.previous();
    this.state.canRestore = !!previous;
    this.state.current = describeRuntime(this.runtime.settings);
    this.state.other = previous ? describeRuntime(previous) : undefined;
    this.state.otherBytes = undefined;
    const other = this.state.other;
    if (other?.kind === 'downloaded' && other.available && !this.inUse(other.folder)) {
      if (!this.sizes.has(other.folder))
        this.sizes.set(other.folder, await folderBytes(other.folder).catch(() => 0));
      this.state.otherBytes = this.sizes.get(other.folder);
    }
    // Report a removed download without forgetting it, so it recovers if the files return.
    if (['ready', 'activated'].includes(this.state.state) && !(await this.candidatePresent()))
      return {
        ...this.state,
        state: 'missing' as const,
        message:
          "This downloaded engine's files were moved or deleted outside Virtual Cut. Download it again.",
      };
    return { ...this.state };
  }
  /**
   * Where the folder picker starts: beside a downloaded setup (in use first), then the
   * last folder chosen here, then a per-user location shared by every app version.
   */
  async suggestedFolder() {
    const previous = await this.previous();
    for (const location of [
      describeRuntime(this.runtime.settings),
      previous && describeRuntime(previous),
    ])
      if (location?.kind === 'downloaded') return path.dirname(path.dirname(location.folder));
    if (this.root) return this.root;
    return path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
      'Virtual Cut',
    );
  }
  async plan(folder: string, includeGpu: boolean) {
    if (this.controller) throw new Error('Wait for the current download or cancel it.');
    if (process.platform !== 'win32' || process.arch !== 'x64')
      throw new Error('The speech engine download currently supports Windows x64.');
    this.manifest = JSON.parse(
      await readFile(path.join(integration, 'runtime-manifest.json'), 'utf8'),
    );
    this.root = await realpath(folder);
    const files = this.manifest!.artifacts.filter((a) => includeGpu || a.kind !== 'gpu');
    const download = files.reduce((sum, a) => sum + a.bytes, 0);
    const installed = files.reduce((sum, a) => sum + a.expandedBytes, 0);
    // One archive at a time is removed after extraction. Keep a reserve for filesystem overhead.
    const required =
      installed +
      Math.max(...files.filter((a) => a.kind !== 'model').map((a) => a.bytes)) +
      512 * 1024 * 1024;
    const space = await statfs(this.root);
    const available = space.bavail * space.bsize;
    this.owned = `install-${randomUUID()}`;
    this.state = {
      ...this.state,
      state: 'planned',
      version: `${this.manifest!.engine} · Python ${this.manifest!.python} · ${this.manifest!.model}`,
      folder: path.join(this.root, 'Virtual Cut speech', this.owned),
      includeGpu,
      downloadBytes: download,
      installedBytes: installed,
      requiredBytes: required,
      availableBytes: available,
      downloadedBytes: 0,
      message:
        available < required
          ? 'Not enough free space. Choose another folder.'
          : 'Ready to download. The engine in use and your transcripts are kept.',
    };
    return this.status();
  }
  start() {
    if (this.controller || this.state.state !== 'planned' || !this.manifest)
      throw new Error('Choose where to download the speech engine first.');
    const controller = (this.controller = new AbortController());
    this.state.state = 'installing';
    this.state.message = 'Preparing installation…';
    this.report('install');
    this.task = this.install(controller.signal)
      // A checked engine is used straight away; the previous one is kept until deleted.
      .then(
        async () => {
          try {
            await this.useCandidate();
          } catch (error) {
            this.state.message = `The speech engine was installed and checked, but could not be switched to: ${String(error)}`;
            this.report('activate', error);
          }
        },
        async (error) => {
          this.state.state = controller.signal.aborted ? 'cancelled' : 'failed';
          this.state.message = controller.signal.aborted
            ? 'Download cancelled. The speech engine in use is unchanged.'
            : String(error);
          this.report(
            controller.signal.aborted ? 'cancelled' : 'install',
            controller.signal.aborted ? undefined : error,
          );
          try {
            await this.removeOwnedFolder();
          } catch {
            this.state.message += ' Some incomplete files remain in the download folder shown.';
          }
        },
      )
      .finally(() => {
        this.controller = undefined;
      });
    return this.status();
  }
  async cancel() {
    this.controller?.abort();
    await this.task;
    return this.status();
  }
  private async removeOwnedFolder() {
    // Never recursively remove a chosen root, existing runtime, or a computed unverified path.
    const expected = path.join(await realpath(this.root), 'Virtual Cut speech', this.owned);
    if (this.state.folder !== expected || !/^install-[0-9a-f-]{36}$/.test(this.owned))
      throw new Error('Invalid setup cleanup path.');
    let actual: string;
    try {
      actual = await realpath(expected);
    } catch {
      return;
    }
    if (actual.toLowerCase() !== expected.toLowerCase())
      throw new Error('Setup folder was redirected.');
    const marker = JSON.parse(
      await readFile(path.join(actual, '.virtual-cut-speech-install.json'), 'utf8'),
    );
    if (marker.owner !== this.owned) throw new Error('Setup ownership changed.');
    await rm(actual, { recursive: true });
  }
  private async download(artifact: Artifact, destination: string, signal: AbortSignal) {
    this.state.message = `Downloading ${artifact.kind === 'model' ? 'speech model' : 'speech software'}: ${artifact.name}`;
    const response = await fetch(artifact.url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(30 * 60 * 1000)]),
    });
    if (!response.ok || !response.body)
      throw new Error(`Download failed (${response.status}). Retry the download.`);
    const file = await open(destination + '.part', 'wx');
    const reader = response.body.getReader();
    const hash = createHash('sha256');
    let bytes = 0;
    try {
      for (;;) {
        const { value: chunk, done } = await reader.read();
        if (done) break;
        signal.throwIfAborted();
        bytes += chunk.length;
        if (bytes > artifact.bytes) throw new Error('Download exceeded its expected size.');
        hash.update(chunk);
        let offset = 0;
        while (offset < chunk.length) {
          const result = await file.write(chunk, offset, chunk.length - offset);
          if (!result.bytesWritten) throw new Error('Could not write downloaded speech files.');
          offset += result.bytesWritten;
        }
        this.state.downloadedBytes += chunk.length;
      }
    } finally {
      await reader.cancel().catch(() => {});
      await file.close();
    }
    if (bytes !== artifact.bytes || hash.digest('hex') !== artifact.sha256)
      throw new Error('Download verification failed. Retry the download.');
    await rename(destination + '.part', destination);
  }
  private async process(
    executable: string,
    args: string[],
    signal: AbortSignal,
    request?: unknown,
  ) {
    signal.throwIfAborted();
    return new Promise<string>((resolve, reject) => {
      const child = spawn(executable, args, {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          TEMP: this.state.folder,
          TMP: this.state.folder,
          PYTHONDONTWRITEBYTECODE: '1',
          PYTHONUTF8: '1',
        },
      });
      let output = '',
        error = '';
      const abort = () => child.kill();
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      child.on('error', (e) => {
        signal.removeEventListener('abort', abort);
        reject(e);
      });
      child.stdout.on('data', (data) => {
        output = (output + String(data)).slice(-8000);
      });
      child.stderr.on('data', (data) => {
        error = (error + String(data)).slice(-3000);
      });
      child.stdin.on('error', () => {});
      child.stdin.end(request ? JSON.stringify(request) + '\n' : undefined);
      child.on('close', (code) => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) reject(new Error('Setup cancelled.'));
        else if (code)
          reject(new Error(`Speech software could not be installed or loaded. ${error}`));
        else resolve(output);
      });
    });
  }
  private candidate(): AsrRuntime {
    return {
      python: path.join(this.state.folder, 'python', 'python.exe'),
      libraries: path.join(this.state.folder, 'libraries'),
      model: path.join(this.state.folder, 'model'),
      gpuLibraries: this.state.includeGpu ? path.join(this.state.folder, 'libraries') : '',
      device: 'auto',
      threads: 4,
    };
  }
  private async install(signal: AbortSignal) {
    const space = await statfs(this.root);
    if (space.bavail * space.bsize < this.state.requiredBytes)
      throw new Error('Not enough free space. Choose another folder.');
    const parent = path.join(this.root, 'Virtual Cut speech');
    await mkdir(parent, { recursive: true });
    if ((await realpath(parent)).toLowerCase() !== parent.toLowerCase())
      throw new Error('Choose a folder without redirected folders inside it.');
    await mkdir(this.state.folder);
    await writeFile(
      path.join(this.state.folder, '.virtual-cut-speech-install.json'),
      JSON.stringify({ owner: this.owned, manifest: this.manifest!.id, complete: false }),
    );
    const downloads = path.join(this.state.folder, 'downloads');
    await mkdir(downloads);
    await mkdir(path.join(this.state.folder, 'model'));
    const candidate = this.candidate();
    for (const artifact of this.manifest!.artifacts.filter(
      (a) => this.state.includeGpu || a.kind !== 'gpu',
    )) {
      signal.throwIfAborted();
      const target = path.join(
        artifact.kind === 'model' ? candidate.model : downloads,
        artifact.name,
      );
      await this.download(artifact, target, signal);
      if (artifact.kind === 'model') continue;
      this.state.message = 'Installing verified speech software…';
      if (artifact.kind === 'python')
        await this.process(
          path.join(
            process.env.SystemRoot || 'C:/Windows',
            'System32',
            'WindowsPowerShell',
            'v1.0',
            'powershell.exe',
          ),
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            path.join(integration, 'unpack-python.ps1'),
            '-Archive',
            target,
            '-Destination',
            path.dirname(candidate.python),
          ],
          signal,
        );
      else
        await this.process(
          candidate.python,
          ['-I', '-B', path.join(integration, 'install-runtime.py')],
          signal,
          { mode: 'unpack', archive: target, destination: candidate.libraries },
        );
      await rm(target);
    }
    this.state.message = 'Checking speech libraries and model files…';
    const versions = Object.fromEntries(
      this.manifest!.artifacts.filter(
        (a) => a.package && (this.state.includeGpu || a.kind !== 'gpu'),
      ).map((a) => [a.package!, a.version!]),
    );
    await this.process(
      candidate.python,
      ['-I', '-B', path.join(integration, 'install-runtime.py')],
      signal,
      { mode: 'validate', libraries: candidate.libraries, model: candidate.model, versions },
    );
    signal.throwIfAborted();
    await rm(downloads, { recursive: true });
    await writeFile(
      path.join(this.state.folder, 'runtime-manifest.json'),
      JSON.stringify(this.manifest, null, 2),
    );
    await writeFile(
      path.join(this.state.folder, '.virtual-cut-speech-install.json'),
      JSON.stringify({ owner: this.owned, manifest: this.manifest!.id, complete: true }),
    );
    this.state.state = 'ready';
    this.state.message = 'Installation checked. No speech model was loaded.';
    await this.rememberCandidate();
    this.report('completed');
  }
  /** A checked engine that could not be switched to automatically can be used here. */
  async activate() {
    if (this.state.state !== 'ready' || this.controller)
      throw new Error('Finish installing before using the speech engine.');
    return this.useCandidate();
  }
  private async useCandidate() {
    if (!(await this.candidatePresent()))
      throw new Error(
        "This downloaded engine's files were moved or deleted outside Virtual Cut. Download it again.",
      );
    const receipt = JSON.parse(
      await readFile(path.join(this.state.folder, '.virtual-cut-speech-install.json'), 'utf8'),
    );
    if (
      receipt.owner !== this.owned ||
      receipt.manifest !== this.manifest?.id ||
      receipt.complete !== true
    )
      throw new Error('The checked speech engine is no longer available. Download it again.');
    const candidate = this.candidate();
    await Promise.all([
      access(candidate.python),
      access(path.join(candidate.libraries, 'faster_whisper')),
      access(path.join(candidate.model, 'model.bin')),
    ]);
    await mkdir(this.profile, { recursive: true });
    const replaced = describeRuntime(this.runtime.settings);
    // Only a working engine is worth keeping as the previous one.
    if (replaced.available) await this.rememberPrevious(this.runtime.settings);
    else await rm(path.join(this.profile, 'speech-previous-runtime.json'), { force: true });
    this.runtime.use(candidate);
    this.state.state = 'activated';
    this.state.message = !replaced.available
      ? 'The speech engine is installed and in use.'
      : replaced.kind === 'downloaded'
        ? 'The new speech engine is installed and in use. The previous engine is kept until you delete it.'
        : 'The speech engine is installed and in use. Your own installation is unchanged; you can switch back under Advanced.';
    await this.rememberCandidate();
    this.report('activate');
    return this.status();
  }
  private async rememberPrevious(settings: AsrRuntime) {
    await mkdir(this.profile, { recursive: true });
    const file = path.join(this.profile, 'speech-previous-runtime.json');
    await writeFile(file + '.next', JSON.stringify(settings));
    await rename(file + '.next', file);
  }
  /** Choosing your own files replaces a downloaded engine; keep it so you can return. */
  async beforeOwnInstallation() {
    const current = describeRuntime(this.runtime.settings);
    if (current.kind === 'downloaded' && current.available)
      await this.rememberPrevious(this.runtime.settings);
  }
  /** Whether the engine in use reads any file from this folder. */
  private inUse(folder: string) {
    const c = this.runtime.settings;
    return [c.python, c.libraries, c.model, c.gpuLibraries].some((file) => {
      if (!file) return false;
      const relative = path.relative(folder, file);
      return !relative.startsWith('..') && !path.isAbsolute(relative);
    });
  }
  /** Delete a kept downloaded engine. Never touches your own installation or the one in use. */
  async removeOther() {
    if (this.controller) throw new Error('Finish or cancel the download first.');
    const previous = await this.previous();
    const other = previous && describeRuntime(previous);
    if (!other || other.kind !== 'downloaded')
      throw new Error('There is no unused downloaded engine to delete.');
    if (this.inUse(other.folder))
      throw new Error('That engine is still in use, so it was not deleted.');
    // The folder must still be the installer's own, not redirected elsewhere.
    const actual = await realpath(other.folder);
    if (actual.toLowerCase() !== other.folder.toLowerCase())
      throw new Error('That engine folder was redirected, so it was not deleted.');
    const receipt = await readFile(path.join(actual, '.virtual-cut-speech-install.json'), 'utf8')
      .then((text) => JSON.parse(text) as { owner?: string })
      .catch(() => undefined);
    if (receipt?.owner !== path.basename(actual))
      throw new Error('That folder was not created by Virtual Cut, so it was not deleted.');
    const bytes = this.sizes.get(other.folder) ?? (await folderBytes(actual));
    await rm(actual, { recursive: true });
    await rm(path.join(this.profile, 'speech-previous-runtime.json'), { force: true });
    this.sizes.delete(other.folder);
    if (this.state.folder === other.folder) {
      this.state.state = 'idle';
      this.state.folder = '';
      await rm(path.join(this.profile, 'speech-setup-candidate.json'), { force: true });
    }
    this.report('remove');
    return this.reply(
      `Deleted the previous speech engine and freed ${(bytes / 1024 ** 3).toFixed(2)} GB.`,
    );
  }
  async restore() {
    if (this.controller) throw new Error('Finish or cancel the download first.');
    const previous = JSON.parse(
      await readFile(path.join(this.profile, 'speech-previous-runtime.json'), 'utf8'),
    ) as AsrRuntime;
    if (!describeRuntime(previous).available)
      throw new Error(
        "The previous engine's files were moved or deleted, so the current one stays in use.",
      );
    const current = { ...this.runtime.settings };
    this.runtime.use(previous);
    await writeFile(
      path.join(this.profile, 'speech-previous-runtime.json'),
      JSON.stringify(current),
    );
    const now = describeRuntime(previous),
      kept = describeRuntime(current);
    const message = `Now using ${label(now)}. ${
      !kept.available
        ? "The previous engine's files are missing, so you can't switch back to it."
        : `${capital(now.kind === kept.kind ? 'your previous installation' : label(kept))} is kept, so you can switch back.`
    }`;
    // Only an installed candidate changes between ready and active; a planned or
    // failed download stays as it was.
    if (this.state.folder && ['ready', 'activated'].includes(this.state.state)) {
      this.state.state =
        this.runtime.settings.python === this.candidate().python ? 'activated' : 'ready';
      await this.rememberCandidate();
    }
    this.report('restore');
    return this.reply(message);
  }
  /** Answer an action without overwriting the message of a download in progress or planned. */
  private async reply(message: string) {
    if (!['planned', 'installing', 'failed', 'cancelled'].includes(this.state.state))
      this.state.message = message;
    return { ...(await this.status()), notice: message };
  }
}
