import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
export const TRANSCRIPTION_PIPELINE = 'utterance-v1';
import type {
  AsrRuntime,
  TranscriptSegment,
  TranscriptionOptions,
} from './transcript-contracts.js' with { 'resolution-mode': 'import' };

export function validateTranscriptionOptions(value: TranscriptionOptions) {
  if (
    !value ||
    !Array.isArray(value.roles) ||
    !value.roles.length ||
    value.roles.length > 2 ||
    new Set(value.roles).size !== value.roles.length ||
    value.roles.some((r) => r !== 'game' && r !== 'mic') ||
    typeof value.language !== 'string' ||
    !/^(?:[a-z]{2,3})?$/.test(value.language) ||
    typeof value.vocabulary !== 'boolean' ||
    (value.device != null && !['auto', 'cpu', 'cuda'].includes(value.device))
  )
    throw new Error('Choose Game, Mic or both, and a supported language.');
}
export class TranscriptionRuntime {
  settings: AsrRuntime;
  private file: string;
  private gpuStatus?: Promise<{ available: boolean; message: string }>;
  private gpuChecking = false;
  /** A setup was chosen at some point, so missing files mean it was moved or deleted. */
  private chosen: boolean;
  constructor(
    profile: string,
    private toolsDirectory = '',
  ) {
    this.file = path.join(profile, 'transcription-runtime.json');
    let saved: Partial<AsrRuntime> = {};
    let packaged: Partial<AsrRuntime> = {};
    try {
      packaged = JSON.parse(
        readFileSync(path.join(toolsDirectory, 'asr-runtime.local.json'), 'utf8'),
      );
    } catch {
      /* Optional workstation review configuration. */
    }
    try {
      saved = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      /* First use. */
    }
    const bundled = path.resolve(toolsDirectory, 'asr');
    this.settings = {
      python:
        process.env.VIRTUAL_CUT_ASR_PYTHON ||
        saved.python ||
        packaged.python ||
        path.join(bundled, 'python.exe'),
      libraries:
        process.env.VIRTUAL_CUT_ASR_LIBRARIES ||
        saved.libraries ||
        packaged.libraries ||
        path.join(bundled, 'Lib', 'site-packages'),
      model:
        process.env.VIRTUAL_CUT_ASR_MODEL ||
        saved.model ||
        packaged.model ||
        path.join(bundled, 'model'),
      gpuLibraries:
        process.env.VIRTUAL_CUT_ASR_GPU_LIBRARIES || (saved.gpuLibraries ?? packaged.gpuLibraries),
      device: saved.device === 'cuda' || saved.device === 'cpu' ? saved.device : 'auto',
      threads: 4,
    };
    this.chosen = !!(process.env.VIRTUAL_CUT_ASR_PYTHON || saved.python || packaged.python);
  }
  /** The first required file that is absent right now, checked on every call. */
  get missing() {
    const c = this.settings;
    if (!existsSync(c.python)) return `Python was not found at ${c.python}.`;
    if (!existsSync(path.join(c.libraries, 'faster_whisper')))
      return `The speech libraries were not found in ${c.libraries}.`;
    if (!existsSync(path.join(c.model, 'model.bin')))
      return `The speech model was not found in ${c.model}.`;
    return '';
  }
  get configured() {
    return !this.missing;
  }
  /** Missing files of a setup that was chosen before, so moved or deleted outside the app. */
  get removed() {
    return this.chosen ? this.missing : '';
  }
  /** Why transcription cannot start: a first setup, or files moved or deleted outside the app. */
  get problem() {
    if (this.configured) return '';
    return this.removed
      ? `${this.removed} It may have been moved or deleted. Open Local transcription setup in the Transcript window to download it again, switch setups or choose the files.`
      : 'Set up local transcription in the Transcript window: download the local setup or choose an existing installation.';
  }
  configure(part: keyof AsrRuntime, value: string) {
    if (part === 'threads') throw new Error('Invalid runtime setting.');
    if (part === 'device' && !['auto', 'cpu', 'cuda'].includes(value))
      throw new Error('Choose Automatic, CPU or NVIDIA GPU.');
    if (part !== 'device' && (!path.isAbsolute(value) || !existsSync(value)))
      throw new Error('Choose an existing runtime location.');
    this.use({ ...this.settings, [part]: value });
  }
  /** Activate a complete setup atomically, after the native installer has validated it. */
  use(settings: AsrRuntime) {
    if (
      !settings ||
      !['auto', 'cpu', 'cuda'].includes(settings.device) ||
      settings.threads !== 4 ||
      ['python', 'libraries', 'model'].some(
        (key) =>
          typeof settings[key as keyof AsrRuntime] !== 'string' ||
          !path.isAbsolute(String(settings[key as keyof AsrRuntime])),
      ) ||
      (settings.gpuLibraries && !path.isAbsolute(settings.gpuLibraries))
    )
      throw new Error('Invalid speech runtime configuration.');
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.next', JSON.stringify(settings));
    renameSync(this.file + '.next', this.file);
    this.settings = { ...settings };
    this.chosen = true;
    this.gpuStatus = undefined;
  }
  inspectGpu(refresh = false) {
    // Never cache this answer: files can return, and a GPU result for files that were
    // deleted outside the app no longer applies.
    if (!this.configured) {
      if (!this.gpuChecking) this.gpuStatus = undefined;
      return Promise.resolve({
        available: false,
        message: 'The GPU check runs once the speech setup files are found.',
      });
    }
    if (refresh && !this.gpuChecking) this.gpuStatus = undefined;
    return (this.gpuStatus ??= (async () => {
      let result = { available: false, message: 'GPU check did not finish.' };
      this.gpuChecking = true;
      try {
        await this.execute(
          { ...this.settings, mode: 'probe' },
          AbortSignal.timeout(15000),
          (event) => {
            if (event.type === 'gpu')
              result = { available: !!event.available, message: event.message || '' };
          },
        );
      } catch (e) {
        result.message = String(e);
      } finally {
        this.gpuChecking = false;
      }
      return result;
    })());
  }
  async run(
    request: {
      source: string;
      track: number;
      offset: number;
      language: string;
      vocabulary: string;
      ffmpeg: string;
      wav: string;
      tempDirectory: string;
      device?: 'auto' | 'cpu' | 'cuda';
      batchSize?: number;
    },
    signal: AbortSignal,
    receive: (event: WorkerEvent) => void,
  ) {
    if (!this.configured) throw new Error(this.problem);
    return this.execute({ ...this.settings, ...request }, signal, receive);
  }
  private async execute(
    config: Record<string, unknown>,
    signal: AbortSignal,
    receive: (event: WorkerEvent) => void,
  ) {
    signal.throwIfAborted();
    const script = path.resolve(__dirname, '..', 'integrations', 'transcription', 'worker.py');
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        String(config.python),
        ['-B', '-u', script, '--guard', String(process.pid)],
        {
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            ...(config.tempDirectory
              ? { TEMP: String(config.tempDirectory), TMP: String(config.tempDirectory) }
              : {}),
            PYTHONUTF8: '1',
            PYTHONDONTWRITEBYTECODE: '1',
          },
        },
      );
      let pending = '',
        error = '',
        complete = false,
        protocolError: Error | undefined;
      const abort = () => child.kill();
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      child.on('error', reject);
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify(config) + '\n');
      child.stderr.on('data', (data) => {
        error = (error + data.toString()).slice(-3000);
      });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (data: string) => {
        pending += data;
        try {
          if (pending.length > 2 * 1024 * 1024)
            throw new Error('Speech worker response exceeded its size limit.');
          let index: number;
          while ((index = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, index);
            pending = pending.slice(index + 1);
            if (!line.trim()) continue;
            const event = JSON.parse(line) as WorkerEvent;
            if (event.type === 'error') error = event.message || 'Speech recognition failed.';
            if (event.type === 'complete') complete = true;
            receive(event);
          }
        } catch (e) {
          protocolError = e instanceof Error ? e : new Error(String(e));
          child.kill();
        }
      });
      child.on('close', (code) => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) reject(new Error('Transcription cancelled.'));
        else if (protocolError) reject(protocolError);
        else if (code !== 0 || !complete)
          reject(new Error(error || 'Speech worker stopped without a complete transcript.'));
        else resolve();
      });
    });
  }
}
export interface WorkerEvent {
  device?: 'cpu' | 'cuda';
  available?: boolean;
  peakMemoryBytes?: number;
  engine?: string;
  runtime?: string;
  type: 'worker' | 'stage' | 'info' | 'segment' | 'complete' | 'error' | 'gpu';
  pid?: number;
  guardPid?: number;
  message?: string;
  progress?: number;
  language?: string;
  languageProbability?: number;
  duration?: number;
  segment?: TranscriptSegment;
}
