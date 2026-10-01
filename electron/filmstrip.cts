import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import type { NativeSource } from './project-store.cjs';
import type { FilmstripFrame } from './project-contracts.js' with { 'resolution-mode': 'import' };

export function nearestKey(keys: number[], at: number) {
  let lo = 0,
    hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (keys[mid] < at) lo = mid + 1;
    else hi = mid;
  }
  const before = keys[Math.max(0, lo - 1)],
    after = keys[Math.min(keys.length - 1, lo)];
  return at - before <= after - at ? before : after;
}

// One native decoder at a time; no output file, no persistent image cache.
function decode(
  tool: string,
  source: NativeSource,
  time: number,
  offset: number,
  signal: AbortSignal,
) {
  return new Promise<{ time: number; data: string }>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Cancelled'));
      return;
    }
    const absolute = time + offset;
    const child = spawn(
      tool,
      [
        '-hide_banner',
        '-loglevel',
        'info',
        '-nostdin',
        '-copyts',
        '-threads',
        '1',
        '-skip_frame',
        'nokey',
        '-seek_timestamp',
        '1',
        '-noaccurate_seek',
        '-ss',
        String(Math.max(0, absolute - 0.00001)),
        '-i',
        source.file,
        '-map',
        '0:V:0',
        '-an',
        '-sn',
        '-dn',
        '-frames:v',
        '1',
        '-vf',
        `select=gte(t\\,${absolute - 0.00001}),scale=240:136:force_original_aspect_ratio=decrease,showinfo`,
        '-filter_threads',
        '1',
        '-threads',
        '1',
        '-fps_mode',
        'passthrough',
        '-c:v',
        'mjpeg',
        '-q:v',
        '5',
        '-f',
        'image2pipe',
        'pipe:1',
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let size = 0,
      log = '',
      failure = '',
      finished = false;
    const chunks: Buffer[] = [];
    const cancel = () => child.kill();
    signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => {
      failure = 'Filmstrip frame timed out.';
      cancel();
    }, 8000);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 256 * 1024) {
        failure = 'Filmstrip frame exceeded its memory limit.';
        cancel();
      } else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      log = (log + chunk.toString()).slice(-32000);
    });
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      if (error) {
        reject(error);
        return;
      }
      const base = /config in time_base:\s*(\d+)\/(\d+)/.exec(log);
      const frame = /n:\s*0\s+pts:\s*(-?\d+).*?iskey:\s*(\d+)/.exec(log);
      const actual =
        base && frame ? (Number(frame[1]) * Number(base[1])) / Number(base[2]) - offset : NaN;
      const bytes = Buffer.concat(chunks);
      if (signal.aborted) reject(new Error('Cancelled'));
      else if (failure) reject(new Error(failure));
      else if (
        !Number.isFinite(actual) ||
        frame?.[2] !== '1' ||
        Math.abs(actual - time) > 0.002 ||
        bytes.length < 100 ||
        bytes[0] !== 255 ||
        bytes[1] !== 216
      )
        reject(
          new Error(
            `The requested keyframe ${time} could not be verified (decoded ${actual}, key ${frame?.[2]}, ${bytes.length} bytes).`,
          ),
        );
      else resolve({ time: actual, data: 'data:image/jpeg;base64,' + bytes.toString('base64') });
    };
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (code !== 0 && !signal.aborted && !failure) failure = 'Filmstrip decoding failed.';
      finish();
    });
  });
}

export class FilmstripCache {
  private cache = new Map<string, { time: number; data: string }>();
  private bytes = 0;
  private current: { token: string; controller: AbortController } | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  cancel(token: string, release = false) {
    if (this.current?.token !== token) return;
    this.current.controller.abort();
    if (release) this.clear();
  }
  clear() {
    this.current?.controller.abort();
    this.current = null;
    this.cache.clear();
    this.bytes = 0;
  }
  async close() {
    this.clear();
    await this.tail.catch(() => {});
  }
  stats() {
    return { entries: this.cache.size, bytes: this.bytes };
  }
  request(
    tool: string,
    source: NativeSource,
    offset: number,
    keys: number[],
    targets: number[],
    token: string,
  ) {
    this.current?.controller.abort();
    const job = { token, controller: new AbortController() };
    this.current = job;
    const work = this.tail
      .catch(() => {})
      .then(async () => {
        const { signal } = job.controller;
        if (signal.aborted || this.current !== job) throw new Error('Cancelled');
        // Project-scoped LRU: switching sources cancels work, not completed images.
        // Include path/clock/render shape so a relink cannot reuse a different decode.
        const identity = JSON.stringify([
          source.id,
          source.file,
          source.fingerprint,
          source.bytes,
          source.modified,
          offset,
          '240x136-jpeg-v1',
        ]);
        const check = async () => {
          const info = await stat(source.file);
          if (signal.aborted) throw new Error('Cancelled');
          if (info.size !== source.bytes || info.mtimeMs !== source.modified) {
            this.clear();
            throw new Error('The source changed. Relink or inspect it again.');
          }
        };
        await check();
        const result: FilmstripFrame[] = [];
        for (const requested of targets) {
          if (signal.aborted) throw new Error('Cancelled');
          const at = nearestKey(keys, requested);
          if (!Number.isFinite(at)) throw new Error('Keyframe index is unavailable.');
          const key = `${identity}:${at}`;
          const frame = this.cache.get(key) || (await decode(tool, source, at, offset, signal));
          if (signal.aborted) throw new Error('Cancelled');
          if (this.cache.delete(key)) this.bytes -= frame.data.length * 2;
          this.cache.set(key, frame);
          this.bytes += frame.data.length * 2;
          while (this.cache.size > 192 || this.bytes > 8 * 1024 * 1024) {
            const first = this.cache.keys().next().value!;
            this.bytes -= this.cache.get(first)!.data.length * 2;
            this.cache.delete(first);
          }
          result.push({ requested, ...frame });
        }
        await check();
        return result;
      });
    this.tail = work;
    return work;
  }
}
