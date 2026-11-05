import { existsSync, readFileSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { ScreenTextRuntime } from './screen-text-runtime.cjs';
import {
  SCREEN_TEXT_MODELS,
  SCREEN_TEXT_WORKER,
  screenTextLayout,
} from './screen-text-runtime.cjs';
import { downloadArtifact, folderBytes, runSetupProcess, verifyArtifact } from './speech-setup.cjs';
import type {
  ScreenTextCheck,
  ScreenTextLocation,
  ScreenTextSetupState,
} from './screen-text-setup-contracts.js' with { 'resolution-mode': 'import' };

/**
 * Download, check, use, switch back to and delete the screen text engine (VC-192). It follows
 * the speech engine's setup (electron/speech-setup.cts) and shares its download and process
 * helpers: you choose the folder, nothing downloads until you confirm, every file is checked
 * against a pinned manifest, and an engine that reads its test image is used straight away.
 * The previous engine is kept until it is deleted here. There is no "own Python" option;
 * development points VIRTUAL_CUT_OCR_RUNTIME at an install folder instead.
 */
interface Artifact {
  name: string;
  url: string;
  sha256: string;
  bytes: number;
  expandedBytes: number;
  kind: 'python' | 'wheel';
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
const integration = path.resolve(__dirname, '..', 'integrations', 'screen-text');
const transcription = path.resolve(__dirname, '..', 'integrations', 'transcription');
const PARENT = 'Virtual Cut screen text';
const MARKER = '.virtual-cut-screen-text-install.json';
const OWNER = /^install-[0-9a-f-]{36}$/;
/** What the neutral test image says; a different reading means the engine is not working. */
const CHECK_TEXT = /virtual\s*cut/i;

const readManifest = async () =>
  JSON.parse(await readFile(path.join(integration, 'runtime-manifest.json'), 'utf8')) as Manifest;

/** Whether a folder is one this installer created (by its place and name; the receipt is checked on delete). */
const isDownloaded = (folder: string) =>
  OWNER.test(path.basename(folder)) && path.basename(path.dirname(folder)) === PARENT;
const complete = (folder: string) => {
  const c = screenTextLayout(folder);
  return (
    existsSync(c.python) &&
    SCREEN_TEXT_MODELS.every((name) =>
      existsSync(path.join(c.libraries, 'rapidocr', 'models', name)),
    )
  );
};
export const describeScreenText = (folder: string): ScreenTextLocation => ({
  folder,
  downloaded: isDownloaded(folder),
  available: complete(folder),
});

/**
 * Read the test image with the engine in `folder` (worker.py `check`). Starts its own worker,
 * which exits when its input ends; the reply says whether DirectML ran both models.
 */
export async function checkScreenText(
  folder: string,
  signal: AbortSignal,
): Promise<ScreenTextCheck> {
  const c = screenTextLayout(folder);
  const at = new Date().toISOString();
  try {
    const output = await runSetupProcess(
      c.python,
      ['-I', '-B', SCREEN_TEXT_WORKER, c.libraries],
      AbortSignal.any([signal, AbortSignal.timeout(2 * 60 * 1000)]),
      os.tmpdir(),
      { id: 1, op: 'check' },
    );
    const reply = output
      .split(/\r?\n/)
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((r) => r.id === 1);
    if (!reply) throw new Error('The engine gave no answer.');
    if (!reply.ok) throw new Error(String(reply.error || 'The engine reported an error.'));
    if (!CHECK_TEXT.test(String(reply.text)))
      throw new Error(`It read “${String(reply.text)}” instead of the test text.`);
    return { folder, ok: true, gpu: reply.gpu === true, ms: Number(reply.ms) || 0, at };
  } catch (error) {
    if (signal.aborted) throw error;
    const message = (error instanceof Error ? error.message : String(error)).trim();
    return {
      folder,
      ok: false,
      gpu: false,
      ms: 0,
      at,
      error: `The test image could not be read: ${message.split(/\r?\n/).slice(-3).join(' ')}`,
    };
  }
}

export class ScreenTextSetup {
  private manifest?: Manifest;
  private root = '';
  private owned = '';
  private controller?: AbortController;
  /** The running install, for checks and shutdown. */
  task?: Promise<void>;
  private checkTask?: Promise<ScreenTextCheck>;
  private checkController?: AbortController;
  private sizes = new Map<string, number>();
  private state: Omit<ScreenTextSetupState, 'overridden' | 'problem' | 'checking'> = {
    state: 'idle',
    version: '',
    folder: '',
    downloadBytes: 0,
    installedBytes: 0,
    requiredBytes: 0,
    availableBytes: 0,
    downloadedBytes: 0,
    message: '',
  };
  constructor(
    private profile: string,
    private runtime: ScreenTextRuntime,
    private report: (
      operation:
        'install' | 'completed' | 'cancelled' | 'activate' | 'restore' | 'remove' | 'check',
      error?: unknown,
    ) => void = () => {},
  ) {
    // Only small app metadata is read here: no scan, no download, no engine start.
    try {
      const saved = JSON.parse(readFileSync(this.file('setup-candidate'), 'utf8'));
      const manifest = JSON.parse(
        readFileSync(path.join(integration, 'runtime-manifest.json'), 'utf8'),
      ) as Manifest;
      if (
        !['ready', 'activated'].includes(saved.state?.state) ||
        saved.manifest !== manifest.id ||
        typeof saved.root !== 'string' ||
        !path.isAbsolute(saved.root) ||
        !OWNER.test(saved.owner) ||
        saved.state.folder !== path.join(saved.root, PARENT, saved.owner)
      )
        throw new Error('Old or invalid candidate.');
      this.root = saved.root;
      this.owned = saved.owner;
      this.manifest = manifest;
      this.state = saved.state;
    } catch {
      /* First use, an older manifest, or unreadable metadata. */
    }
  }
  private file(name: 'setup-candidate' | 'previous-runtime' | 'check') {
    return path.join(this.profile, `screen-text-${name}.json`);
  }
  private async save(name: 'setup-candidate' | 'previous-runtime' | 'check', value: unknown) {
    await mkdir(this.profile, { recursive: true });
    const file = this.file(name);
    await writeFile(file + '.next', JSON.stringify(value));
    await rename(file + '.next', file);
  }
  private rememberCandidate() {
    return this.save('setup-candidate', {
      root: this.root,
      owner: this.owned,
      manifest: this.manifest?.id,
      state: this.state,
    });
  }
  private async previous(): Promise<string> {
    try {
      const value = JSON.parse(await readFile(this.file('previous-runtime'), 'utf8')) as {
        folder?: unknown;
      };
      return typeof value.folder === 'string' && path.isAbsolute(value.folder) ? value.folder : '';
    } catch {
      return '';
    }
  }
  private async lastCheck(folder: string): Promise<ScreenTextCheck | undefined> {
    try {
      const value = JSON.parse(await readFile(this.file('check'), 'utf8')) as ScreenTextCheck;
      return value.folder === folder ? value : undefined;
    } catch {
      return undefined;
    }
  }
  /** The checked download is still on disk (it can be deleted or moved outside the app). */
  private async candidatePresent() {
    return existsSync(path.join(this.state.folder, MARKER)) && complete(this.state.folder);
  }
  async status(): Promise<ScreenTextSetupState> {
    const folder = this.runtime.settings.folder;
    const previous = await this.previous();
    const other = previous ? describeScreenText(previous) : undefined;
    let otherBytes: number | undefined;
    if (other?.downloaded && other.available && other.folder !== folder) {
      if (!this.sizes.has(other.folder))
        this.sizes.set(other.folder, await folderBytes(other.folder).catch(() => 0));
      otherBytes = this.sizes.get(other.folder);
    }
    const known = this.runtime.configured || !!this.runtime.removed;
    const result: ScreenTextSetupState = {
      ...this.state,
      current: known ? describeScreenText(folder) : undefined,
      other,
      otherBytes,
      overridden: this.runtime.overridden,
      problem: this.runtime.problem,
      check: await this.lastCheck(folder),
      checking: !!this.checkTask,
    };
    // Report a removed download without forgetting it, so it recovers if the files return.
    if (['ready', 'activated'].includes(this.state.state) && !(await this.candidatePresent()))
      return {
        ...result,
        state: 'missing',
        message:
          "This downloaded engine's files were moved or deleted outside Virtual Cut. Download it again.",
      };
    return result;
  }
  /**
   * Where the folder picker starts: beside a downloaded engine (in use first), then the last
   * folder chosen here, then the per-user folder the speech engine also suggests.
   */
  async suggestedFolder() {
    for (const folder of [this.runtime.settings.folder, await this.previous()])
      if (folder && isDownloaded(folder)) return path.dirname(path.dirname(folder));
    if (this.root) return this.root;
    return path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
      'Virtual Cut',
    );
  }
  async plan(folder: string) {
    if (this.controller) throw new Error('Wait for the current download or cancel it.');
    if (process.platform !== 'win32' || process.arch !== 'x64')
      throw new Error('The screen text engine download currently supports Windows x64.');
    this.manifest = await readManifest();
    this.root = await realpath(folder);
    const files = this.manifest.artifacts;
    const download = files.reduce((sum, a) => sum + a.bytes, 0);
    const installed = files.reduce((sum, a) => sum + a.expandedBytes, 0);
    // One archive at a time is removed after extraction. Keep a reserve for filesystem overhead.
    const required = installed + Math.max(...files.map((a) => a.bytes)) + 512 * 1024 * 1024;
    const space = await statfs(this.root);
    const available = space.bavail * space.bsize;
    this.owned = `install-${randomUUID()}`;
    this.state = {
      ...this.state,
      state: 'planned',
      version: `${this.manifest.engine} · ${this.manifest.model} · Python ${this.manifest.python}`,
      folder: path.join(this.root, PARENT, this.owned),
      downloadBytes: download,
      installedBytes: installed,
      requiredBytes: required,
      availableBytes: available,
      downloadedBytes: 0,
      message:
        available < required
          ? 'Not enough free space. Choose another folder.'
          : 'Ready to download. The engine in use and your recordings are kept.',
    };
    return this.status();
  }
  start() {
    if (this.controller || this.state.state !== 'planned' || !this.manifest)
      throw new Error('Choose where to download the screen text engine first.');
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
            this.state.message = `The screen text engine was installed and checked, but could not be switched to: ${String(error)}`;
            this.report('activate', error);
          }
        },
        async (error) => {
          this.state.state = controller.signal.aborted ? 'cancelled' : 'failed';
          this.state.message = controller.signal.aborted
            ? 'Download cancelled. The screen text engine in use is unchanged.'
            : error instanceof Error
              ? error.message
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
  /** Stop a download or a running check (a check is also stopped when the app closes). */
  async cancel() {
    this.controller?.abort();
    this.checkController?.abort();
    await this.task;
    await this.checkTask?.catch(() => {});
    return this.status();
  }
  private async removeOwnedFolder() {
    // Never recursively remove a chosen root, an engine in use, or an unverified path.
    const expected = path.join(await realpath(this.root), PARENT, this.owned);
    if (this.state.folder !== expected || !OWNER.test(this.owned))
      throw new Error('Invalid setup cleanup path.');
    let actual: string;
    try {
      actual = await realpath(expected);
    } catch {
      return;
    }
    if (actual.toLowerCase() !== expected.toLowerCase())
      throw new Error('Setup folder was redirected.');
    const marker = JSON.parse(await readFile(path.join(actual, MARKER), 'utf8'));
    if (marker.owner !== this.owned) throw new Error('Setup ownership changed.');
    await rm(actual, { recursive: true });
  }
  /**
   * One pinned file. VIRTUAL_CUT_OCR_DOWNLOADS (checks and development) names a folder of the
   * same files to copy instead of downloading; both are checked against the manifest.
   */
  private async fetchArtifact(artifact: Artifact, destination: string, signal: AbortSignal) {
    this.state.message = `Downloading screen text software: ${artifact.name}`;
    const local = process.env.VIRTUAL_CUT_OCR_DOWNLOADS
      ? path.join(process.env.VIRTUAL_CUT_OCR_DOWNLOADS, artifact.name)
      : '';
    if (local && existsSync(local)) {
      await copyFile(local, destination + '.part');
      await verifyArtifact(destination + '.part', artifact);
      await rename(destination + '.part', destination);
      this.state.downloadedBytes += artifact.bytes;
      signal.throwIfAborted();
      return;
    }
    await downloadArtifact(artifact, destination, signal, (bytes) => {
      this.state.downloadedBytes += bytes;
    });
  }
  private step(executable: string, args: string[], signal: AbortSignal, request?: unknown) {
    return runSetupProcess(executable, args, signal, this.state.folder, request).catch((error) => {
      throw signal.aborted
        ? error
        : new Error(`Screen text software could not be installed. ${error.message}`);
    });
  }
  private async install(signal: AbortSignal) {
    const space = await statfs(this.root);
    if (space.bavail * space.bsize < this.state.requiredBytes)
      throw new Error('Not enough free space. Choose another folder.');
    const parent = path.join(this.root, PARENT);
    await mkdir(parent, { recursive: true });
    if ((await realpath(parent)).toLowerCase() !== parent.toLowerCase())
      throw new Error('Choose a folder without redirected folders inside it.');
    await mkdir(this.state.folder);
    await writeFile(
      path.join(this.state.folder, MARKER),
      JSON.stringify({ owner: this.owned, manifest: this.manifest!.id, complete: false }),
    );
    const downloads = path.join(this.state.folder, 'downloads');
    await mkdir(downloads);
    const candidate = screenTextLayout(this.state.folder);
    // Python first: the wheels are unpacked with it.
    for (const artifact of this.manifest!.artifacts) {
      signal.throwIfAborted();
      const target = path.join(downloads, artifact.name);
      await this.fetchArtifact(artifact, target, signal);
      this.state.message = 'Installing verified screen text software…';
      if (artifact.kind === 'python')
        await this.step(
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
            path.join(transcription, 'unpack-python.ps1'),
            '-Archive',
            target,
            '-Destination',
            path.dirname(candidate.python),
          ],
          signal,
        );
      else
        await this.step(
          candidate.python,
          ['-I', '-B', path.join(transcription, 'install-runtime.py')],
          signal,
          { mode: 'unpack', archive: target, destination: candidate.libraries },
        );
      await rm(target);
    }
    await rm(downloads, { recursive: true });
    this.state.message = 'Checking installed versions…';
    const versions = Object.fromEntries(
      this.manifest!.artifacts.filter((a) => a.package).map((a) => [a.package!, a.version!]),
    );
    const found = JSON.parse(
      await this.step(
        candidate.python,
        [
          '-I',
          '-B',
          '-c',
          'import json,sys; sys.path.insert(0, sys.argv[1]); import importlib.metadata as m; ' +
            'print(json.dumps({p: m.version(p) for p in json.loads(sys.stdin.readline())}))',
          candidate.libraries,
        ],
        signal,
        Object.keys(versions),
      ),
    ) as Record<string, string>;
    for (const [name, version] of Object.entries(versions))
      if (found[name] !== version)
        throw new Error(`Installed dependency version mismatch: ${name}. Retry the download.`);
    signal.throwIfAborted();
    this.state.state = 'checking';
    this.state.message = 'Checking: reading a test image…';
    const check = await checkScreenText(this.state.folder, signal);
    signal.throwIfAborted();
    if (!check.ok) throw new Error(check.error);
    await this.save('check', check);
    await writeFile(
      path.join(this.state.folder, 'runtime-manifest.json'),
      JSON.stringify(this.manifest, null, 2),
    );
    await writeFile(
      path.join(this.state.folder, MARKER),
      JSON.stringify({ owner: this.owned, manifest: this.manifest!.id, complete: true }),
    );
    this.state.state = 'ready';
    this.state.message = 'Installation checked.';
    await this.rememberCandidate();
    this.report('completed');
  }
  /** A checked engine that could not be switched to automatically can be used here. */
  async activate() {
    if (this.state.state !== 'ready' || this.controller)
      throw new Error('Finish installing before using the screen text engine.');
    return this.useCandidate();
  }
  private async useCandidate() {
    if (!(await this.candidatePresent()))
      throw new Error(
        "This downloaded engine's files were moved or deleted outside Virtual Cut. Download it again.",
      );
    const receipt = JSON.parse(await readFile(path.join(this.state.folder, MARKER), 'utf8'));
    if (
      receipt.owner !== this.owned ||
      receipt.manifest !== this.manifest?.id ||
      receipt.complete !== true
    )
      throw new Error('The checked screen text engine is no longer available. Download it again.');
    // The engine setup chose before is the one worth returning to (not a development folder).
    const replaced = this.runtime.savedFolder;
    if (replaced && replaced !== this.state.folder && complete(replaced))
      await this.save('previous-runtime', { folder: replaced });
    else await rm(this.file('previous-runtime'), { force: true });
    this.runtime.use(this.state.folder);
    this.state.state = 'activated';
    this.state.message = this.runtime.overridden
      ? 'The screen text engine is installed. VIRTUAL_CUT_OCR_RUNTIME still chooses the engine until it is cleared.'
      : replaced && replaced !== this.state.folder && complete(replaced)
        ? 'The new screen text engine is installed and in use. The previous engine is kept until you delete it.'
        : 'The screen text engine is installed and in use.';
    await this.rememberCandidate();
    this.report('activate');
    return this.reply(this.state.message);
  }
  /** Read the test image with the engine in use, and remember the answer. */
  async check() {
    if (!this.runtime.configured) throw new Error(this.runtime.problem);
    if (!this.checkTask) {
      const folder = this.runtime.settings.folder;
      this.checkController = new AbortController();
      this.checkTask = checkScreenText(folder, this.checkController.signal);
      try {
        const result = await this.checkTask;
        await this.save('check', result);
        this.report('check', result.ok ? undefined : result.error);
      } finally {
        this.checkTask = undefined;
        this.checkController = undefined;
      }
    } else await this.checkTask;
    return this.status();
  }
  /** Switch to the previous engine; the one in use becomes the previous one. */
  async restore() {
    if (this.controller) throw new Error('Finish or cancel the download first.');
    const previous = await this.previous();
    if (!previous) throw new Error('There is no previous screen text engine.');
    if (!complete(previous))
      throw new Error(
        "The previous engine's files were moved or deleted, so the current one stays in use.",
      );
    const current = this.runtime.savedFolder;
    this.runtime.use(previous);
    if (current) await this.save('previous-runtime', { folder: current });
    else await rm(this.file('previous-runtime'), { force: true });
    if (this.state.folder && ['ready', 'activated'].includes(this.state.state)) {
      this.state.state = previous === this.state.folder ? 'activated' : 'ready';
      await this.rememberCandidate();
    }
    this.report('restore');
    return this.reply(
      `Now using the previous screen text engine. ${
        current && complete(current)
          ? 'The other one is kept, so you can switch back.'
          : "The other engine's files are missing, so you can't switch back to it."
      }${this.runtime.overridden ? ' VIRTUAL_CUT_OCR_RUNTIME still chooses the engine until it is cleared.' : ''}`,
    );
  }
  /** Delete a kept downloaded engine. Never touches the engine in use or a folder it didn't create. */
  async removeOther() {
    if (this.controller) throw new Error('Finish or cancel the download first.');
    const other = await this.previous();
    if (!other || !isDownloaded(other))
      throw new Error('There is no unused downloaded engine to delete.');
    const inUse = [this.runtime.settings.folder, this.runtime.savedFolder].some((folder) => {
      const relative = folder ? path.relative(other, folder) : '..';
      return !relative.startsWith('..') && !path.isAbsolute(relative);
    });
    if (inUse) throw new Error('That engine is still in use, so it was not deleted.');
    // The folder must still be the installer's own, not redirected elsewhere.
    const actual = await realpath(other);
    if (actual.toLowerCase() !== other.toLowerCase())
      throw new Error('That engine folder was redirected, so it was not deleted.');
    const receipt = await readFile(path.join(actual, MARKER), 'utf8')
      .then((text) => JSON.parse(text) as { owner?: string })
      .catch(() => undefined);
    if (receipt?.owner !== path.basename(actual))
      throw new Error('That folder was not created by Virtual Cut, so it was not deleted.');
    const bytes = this.sizes.get(other) ?? (await folderBytes(actual));
    await rm(actual, { recursive: true });
    await rm(this.file('previous-runtime'), { force: true });
    this.sizes.delete(other);
    if (this.state.folder === other) {
      this.state = { ...this.state, state: 'idle', folder: '' };
      await rm(this.file('setup-candidate'), { force: true });
    }
    this.report('remove');
    return this.reply(
      `Deleted the previous screen text engine and freed ${(bytes / 1024 ** 3).toFixed(2)} GB.`,
    );
  }
  /** Answer an action without overwriting the message of a download in progress or planned. */
  private async reply(message: string) {
    if (!['planned', 'installing', 'checking', 'failed', 'cancelled'].includes(this.state.state))
      this.state.message = message;
    return { ...(await this.status()), notice: message };
  }
}
