import { createReadStream, readFileSync } from 'node:fs';
import {
  access,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { AsrRuntime } from './transcript-contracts.js' with { 'resolution-mode': 'import' };
import type { SpeechSetupState } from './speech-setup-contracts.js' with {
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

export async function verifyArtifact(file: string, artifact: Pick<Artifact, 'sha256' | 'bytes'>) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  if (bytes !== artifact.bytes || hash.digest('hex') !== artifact.sha256)
    throw new Error(
      'Download verification failed. Retry setup; the existing runtime is unchanged.',
    );
}
// In-memory state and polling are independent of project saves and transcript sessions.
export class SpeechSetup {
  private manifest?: Manifest;
  private root = '';
  private owned = '';
  private controller?: AbortController;
  private task?: Promise<void>;
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
      operation: 'install' | 'completed' | 'cancelled' | 'activate' | 'restore',
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
  async status() {
    try {
      await readFile(path.join(this.profile, 'speech-previous-runtime.json'));
      this.state.canRestore = true;
    } catch {
      this.state.canRestore = false;
    }
    return { ...this.state };
  }
  async plan(folder: string, includeGpu: boolean) {
    if (this.controller) throw new Error('Wait for the current setup or cancel it.');
    if (process.platform !== 'win32' || process.arch !== 'x64')
      throw new Error('Managed speech setup currently supports Windows x64.');
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
          : 'Ready to download. Existing setup and saved transcripts are kept.',
    };
    return this.status();
  }
  start() {
    if (this.controller || this.state.state !== 'planned' || !this.manifest)
      throw new Error('Choose a setup folder first.');
    const controller = (this.controller = new AbortController());
    this.state.state = 'installing';
    this.state.message = 'Preparing installation…';
    this.report('install');
    this.task = this.install(controller.signal)
      .catch(async (error) => {
        this.state.state = controller.signal.aborted ? 'cancelled' : 'failed';
        this.state.message = controller.signal.aborted
          ? 'Setup cancelled. Existing setup is unchanged.'
          : String(error);
        this.report(
          controller.signal.aborted ? 'cancelled' : 'install',
          controller.signal.aborted ? undefined : error,
        );
        try {
          await this.removeOwnedFolder();
        } catch {
          this.state.message += ' Some incomplete files remain in the displayed setup folder.';
        }
      })
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
      throw new Error(`Download failed (${response.status}). Retry setup.`);
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
      throw new Error('Download verification failed. Retry setup.');
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
      throw new Error('Choose a folder without redirected setup directories.');
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
    this.state.message =
      'Installation checked. Choose Use this setup to activate it. No speech model was loaded.';
    await this.rememberCandidate();
    this.report('completed');
  }
  async activate() {
    if (this.state.state !== 'ready' || this.controller)
      throw new Error('Finish installing before activating the setup.');
    const receipt = JSON.parse(
      await readFile(path.join(this.state.folder, '.virtual-cut-speech-install.json'), 'utf8'),
    );
    if (
      receipt.owner !== this.owned ||
      receipt.manifest !== this.manifest?.id ||
      receipt.complete !== true
    )
      throw new Error('The checked setup is no longer available. Choose a setup folder and retry.');
    const candidate = this.candidate();
    await Promise.all([
      access(candidate.python),
      access(path.join(candidate.libraries, 'faster_whisper')),
      access(path.join(candidate.model, 'model.bin')),
    ]);
    await mkdir(this.profile, { recursive: true });
    await writeFile(
      path.join(this.profile, 'speech-previous-runtime.json'),
      JSON.stringify(this.runtime.settings),
    );
    this.runtime.use(candidate);
    this.state.state = 'activated';
    this.state.message = 'New setup is active. The previous setup is still available.';
    await this.rememberCandidate();
    this.report('activate');
    return this.status();
  }
  async restore() {
    if (this.controller) throw new Error('Finish or cancel setup first.');
    const previous = JSON.parse(
      await readFile(path.join(this.profile, 'speech-previous-runtime.json'), 'utf8'),
    ) as AsrRuntime;
    const current = { ...this.runtime.settings };
    this.runtime.use(previous);
    await writeFile(
      path.join(this.profile, 'speech-previous-runtime.json'),
      JSON.stringify(current),
    );
    this.state.message = 'Previous setup restored. Downloaded software and transcripts are kept.';
    if (this.state.folder) {
      this.state.state =
        this.runtime.settings.python === this.candidate().python ? 'activated' : 'ready';
      await this.rememberCandidate();
    }
    this.report('restore');
    return this.status();
  }
}
