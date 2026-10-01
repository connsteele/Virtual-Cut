import { appendFile, mkdir, readdir, readFile, lstat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { DiagnosticSummary } from './diagnostic-contracts.js' with {
  'resolution-mode': 'import',
};

const events = new Set([
  'session-start',
  'session-end',
  'operation-start',
  'operation-end',
  'operation-failed',
  'job-start',
  'job-end',
  'job-failed',
  'job-cancelled',
  'renderer-gone',
  'child-gone',
  'uncaught-error',
  'tool-version',
  'source-open',
  'reload',
  'play',
  'pause',
  'scan',
  'media-error',
  'preview-recovered',
  'media-read-failed',
  'destination-holds',
]);
const words = new Set([
  'inspect',
  'audio',
  'export',
  'save',
  'checkpoint',
  'autosave',
  'restore',
  'create',
  'open',
  'close',
  'import',
  'importDrop',
  'relink',
  'history',
  'batch',
  'select-batch',
  'delete-batch',
  'removeRecording',
  'job',
  'exportClip',
  'exportPlan',
  'acceptReview',
  'destinationPlan',
  'destinationFolders',
  'chooseDestination',
  'recover',
  'retainedMedia',
  'relinkExport',
  'fileQueue',
  'filingPlan',
  'cancelFiling',
  'ffmpeg',
  'ffprobe',
  'completed',
  'cancelled',
  'interrupted',
  'crashed',
  'oom',
  'killed',
  'launch-failed',
  'abnormal-exit',
  'clean-exit',
  'integrity-failure',
]);
const filePattern = /^session-[\dT-]+-[a-f\d-]{36}-\d+\.jsonl$/;
const MAX_BYTES = 1024 * 1024,
  MAX_FILES = 5,
  MAX_QUEUE = 256;
export function errorCode(error: unknown) {
  const code = (error as NodeJS.ErrnoException)?.code;
  return typeof code === 'string' && /^(E[A-Z0-9_]{2,35}|SQLITE_[A-Z_]+)$/.test(code)
    ? code
    : 'UNCLASSIFIED';
}
/** Strict fields: no raw paths, annotations, command arguments, messages or URLs. */
function safeFields(data: Record<string, unknown>, nested = false): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (
      ['sourceId', 'jobId', 'projectId', 'operationId', 'previewId', 'mediaId'].includes(key) &&
      typeof value === 'string' &&
      /^[a-f\d-]{36}$/i.test(value)
    )
      output[key] = value;
    if (
      [
        'rate',
        'direction',
        'position',
        'code',
        'elapsedMs',
        'exitCode',
        'count',
        'readyState',
        'networkState',
        'clipCount',
        'duration',
        'offset',
        'atMs',
        'target',
        'readStatus',
        'rangeStart',
        'rangeEnd',
        'readRequests',
        'readFailures',
        'readCancellations',
      ].includes(key) &&
      typeof value === 'number' &&
      Number.isFinite(value)
    )
      output[key] = Math.round(value * 1000) / 1000;
    if (
      ['operation', 'kind', 'reason', 'tool'].includes(key) &&
      typeof value === 'string' &&
      words.has(value)
    )
      output[key] = value;
    if (
      ['app', 'electron', 'chrome', 'node', 'version'].includes(key) &&
      typeof value === 'string' &&
      /^(?:N-)?[\d.]+(?:-[\w.+-]+)?$/i.test(value) &&
      value.length < 60
    )
      output[key] = value;
    if (
      key === 'errorCode' &&
      typeof value === 'string' &&
      /^(UNCLASSIFIED|E[A-Z0-9_]{2,35}|SQLITE_[A-Z_]+)$/.test(value)
    )
      output[key] = value;
    if (['packaged', 'paused', 'seeking'].includes(key) && typeof value === 'boolean')
      output[key] = value;
    if (
      key === 'fault' &&
      typeof value === 'string' &&
      [
        'demuxer-seek',
        'media-read',
        'media-decode',
        'media-unsupported',
        'play-rejected',
        'unknown',
      ].includes(value)
    )
      output[key] = value;
    if (
      key === 'readReason' &&
      typeof value === 'string' &&
      ['changed', 'range', 'open', 'stream'].includes(value)
    )
      output[key] = value;
    if (
      key === 'action' &&
      typeof value === 'string' &&
      [
        'source-open',
        'clips-changed',
        'seek',
        'seeked',
        'waiting',
        'stalled',
        'loaded',
        'reload',
        'error',
        'play',
        'pause',
        'scan',
        'command',
      ].includes(value)
    )
      output[key] = value;
    if (key === 'recent' && !nested && Array.isArray(value))
      output[key] = value
        .slice(-24)
        .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
        .map((item) => safeFields(item, true));
  }
  return output;
}
export class Diagnostics {
  readonly session = randomUUID();
  readonly directory: string;
  private prefix = `session-${new Date().toISOString().replace(/[:.Z]/g, '-')}-${this.session}`;
  private index = 0;
  private bytes = 0;
  private queue: string[] = [];
  private pending: Promise<void> = Promise.resolve();
  private flushing = false;
  private timer?: ReturnType<typeof setTimeout>;
  private recent: string[] = [];
  private rateWindow = 0;
  private rateCount = 0;
  dropped = 0;
  logging = true;
  constructor(
    profile: string,
    private limits = { bytes: MAX_BYTES, files: MAX_FILES },
  ) {
    this.directory = path.join(profile, 'diagnostics');
  }
  record(event: string, data: Record<string, unknown> = {}) {
    if (!events.has(event)) return;
    const now = Date.now();
    if (now - this.rateWindow >= 1000) {
      this.rateWindow = now;
      this.rateCount = 0;
    }
    if (++this.rateCount > 60 || this.queue.length >= MAX_QUEUE) {
      this.dropped++;
      return;
    }
    const line =
      JSON.stringify({
        at: new Date(now).toISOString(),
        session: this.session,
        level: /failed|error|gone/.test(event) ? 'error' : 'info',
        event,
        ...safeFields(data),
      }) + '\n';
    this.recent.push(line);
    if (this.recent.length > 100) this.recent.shift();
    this.queue.push(line);
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flush();
      }, 250);
      this.timer.unref();
    }
  }
  flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.flushing) return this.pending;
    const lines = this.queue.splice(0);
    if (!lines.length) return this.pending;
    this.flushing = true;
    this.pending = this.pending.then(async () => {
      try {
        await mkdir(this.directory, { recursive: true });
        for (const line of lines) {
          if (this.bytes + Buffer.byteLength(line) > this.limits.bytes) {
            this.index++;
            this.bytes = 0;
          }
          await appendFile(path.join(this.directory, `${this.prefix}-${this.index}.jsonl`), line, {
            encoding: 'utf8',
            mode: 0o600,
          });
          this.bytes += Buffer.byteLength(line);
        }
        const files = await this.files();
        await Promise.all(
          files
            .slice(this.limits.files)
            .map((f) => unlink(path.join(this.directory, f.name)).catch(() => {})),
        );
        this.logging = true;
      } catch {
        this.logging = false;
        this.dropped += lines.length;
      } finally {
        this.flushing = false;
        if (this.queue.length && !this.timer) {
          this.timer = setTimeout(() => {
            this.timer = undefined;
            void this.flush();
          }, 250);
          this.timer.unref();
        }
      }
    });
    return this.pending;
  }
  private async files() {
    const names = (await readdir(this.directory).catch(() => [])).filter((f) =>
      filePattern.test(f),
    );
    const files = await Promise.all(
      names.map(async (name) => ({
        name,
        info: await lstat(path.join(this.directory, name)).catch(() => null),
      })),
    );
    return files.filter((f) => f.info?.isFile()).sort((a, b) => b.info!.mtimeMs - a.info!.mtimeMs);
  }
  async summary(): Promise<DiagnosticSummary> {
    await this.flush();
    const lines: string[] = [];
    for (const f of (await this.files()).slice(0, MAX_FILES).reverse()) {
      if (f.info!.size > MAX_BYTES) continue;
      const raw = await readFile(path.join(this.directory, f.name), 'utf8').catch(() => '');
      for (const line of raw.split('\n')) {
        try {
          const item = JSON.parse(line);
          if (
            !events.has(item.event) ||
            typeof item.at !== 'string' ||
            !/^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(item.at)
          )
            continue;
          lines.push(
            JSON.stringify({
              at: item.at,
              event: item.event,
              session: /^[a-f\d-]{36}$/i.test(item.session) ? item.session : undefined,
              ...safeFields(item),
            }),
          );
        } catch {
          /* A torn last line or corrupt record is ignored. */
        }
      }
    }
    return {
      session: this.session,
      logging: this.logging,
      dropped: this.dropped,
      text: `Virtual Cut diagnostics\nSession: ${this.session}\nLocal logging: ${this.logging ? 'available' : 'unavailable; recent events held in memory'}\nDropped events this session: ${this.dropped}\nPaths, media, notes, transcripts, command arguments and raw error text are excluded. Job IDs match the project records. Nothing is uploaded.\n\n${(this.logging ? lines : this.recent).slice(-400).join('\n')}`,
    };
  }
}
