import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
    const bundled = path.join(toolsDirectory, 'asr');
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
        process.env.VIRTUAL_CUT_ASR_GPU_LIBRARIES || saved.gpuLibraries || packaged.gpuLibraries,
      device: saved.device === 'cuda' || saved.device === 'cpu' ? saved.device : 'auto',
      threads: 4,
    };
  }
  get configured() {
    const c = this.settings;
    return (
      existsSync(c.python) &&
      existsSync(path.join(c.libraries, 'faster_whisper')) &&
      existsSync(path.join(c.model, 'model.bin'))
    );
  }
  configure(part: keyof AsrRuntime, value: string) {
    if (part === 'threads') throw new Error('Invalid runtime setting.');
    if (part === 'device' && !['auto', 'cpu', 'cuda'].includes(value))
      throw new Error('Choose Automatic, CPU or NVIDIA GPU.');
    if (part !== 'device' && (!path.isAbsolute(value) || !existsSync(value)))
      throw new Error('Choose an existing runtime location.');
    Object.assign(this.settings, { [part]: value });
    this.gpuStatus = undefined;
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.settings));
  }
  inspectGpu() {
    return (this.gpuStatus ??= (async () => {
      if (!this.configured)
        return { available: false, message: 'Set up local speech recognition first.' };
      let result = { available: false, message: 'GPU check did not finish.' };
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
    if (!this.configured)
      throw new Error(
        'Set up local transcription in the Transcript window: choose Python, its speech libraries, and a downloaded faster-whisper model.',
      );
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
