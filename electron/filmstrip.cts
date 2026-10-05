import { spawn } from 'node:child_process';
import { constants, setPriority } from 'node:os';
import { open, readFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { NativeSource } from './project-store.cjs';
import type { FilmstripFrame } from './project-contracts.js' with { 'resolution-mode': 'import' };

const SHAPE = '240x136-jpeg-v1';
const MAGIC = Buffer.from('VCFS1\n');
// Whole-recording tile sets loaded for serving; an hour of footage is about 12-24 MB.
const STORED_BYTES = 96 * 1024 * 1024;

/** One file of keyframe tiles per recording, beside its other previews in the project cache. */
export function filmstripFile(cache: string, source: NativeSource) {
  return path.join(cache, `${source.id}-${source.fingerprint}-filmstrip.bin`);
}
function sourceIdentity(source: NativeSource, offset: number) {
  return JSON.stringify([
    source.id,
    source.file,
    source.fingerprint,
    source.bytes,
    source.modified,
    offset,
    SHAPE,
  ]);
}
type TileSet = { identity: string; times: number[]; tiles: Buffer[]; bytes: number };

function nearestIndex(keys: number[], at: number) {
  let lo = 0,
    hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (keys[mid] < at) lo = mid + 1;
    else hi = mid;
  }
  const before = Math.max(0, lo - 1),
    after = Math.min(keys.length - 1, lo);
  return at - keys[before] <= keys[after] - at ? before : after;
}
export function nearestKey(keys: number[], at: number) {
  return keys[nearestIndex(keys, at)];
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

// End of the JPEG starting at `start`, or -1 while it is incomplete. Header segments are skipped
// by length, so only the entropy-coded data is scanned for the end marker.
function jpegEnd(buf: Buffer, start: number) {
  if (buf.length < start + 2) return -1;
  if (buf[start] !== 0xff || buf[start + 1] !== 0xd8)
    throw new Error('The filmstrip pass produced an unreadable image.');
  let i = start + 2;
  for (;;) {
    if (i + 4 > buf.length) return -1;
    if (buf[i] !== 0xff) throw new Error('The filmstrip pass produced an unreadable image.');
    if (buf[i + 1] === 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    i += 2 + buf.readUInt16BE(i + 2);
    if (marker === 0xda) break;
  }
  for (; i + 1 < buf.length; i++) {
    if (buf[i] !== 0xff) continue;
    const next = buf[i + 1];
    if (next === 0xd9) return i + 2;
    if (next !== 0x00 && next !== 0xff && (next < 0xd0 || next > 0xd7))
      throw new Error('The filmstrip pass produced an unreadable image.');
  }
  return -1;
}

/**
 * Every keyframe thumbnail of one recording from a single decode that skips all other frames.
 * CPU decoding on a few threads at below-normal priority, leaving the GPU decoder to playback.
 * Each thumbnail's time comes from FFmpeg's frame info and must match the keyframe index.
 */
export function sweepKeyframes(
  tool: string,
  source: NativeSource,
  offset: number,
  keys: number[],
  signal: AbortSignal,
  threads = 4,
) {
  return new Promise<{ times: number[]; tiles: Buffer[] }>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Cancelled'));
      return;
    }
    const child = spawn(
      tool,
      [
        '-hide_banner',
        '-loglevel',
        'info',
        '-nostdin',
        '-copyts',
        '-threads',
        String(threads),
        '-skip_frame',
        'nokey',
        '-i',
        source.file,
        '-map',
        '0:V:0',
        '-an',
        '-sn',
        '-dn',
        '-vf',
        'scale=240:136:force_original_aspect_ratio=decrease,showinfo',
        '-filter_threads',
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
    try {
      if (child.pid) setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {
      // Priority is a courtesy; the pass still yields to every queued job.
    }
    const tiles: Buffer[] = [],
      times: number[] = [];
    let pending: Buffer = Buffer.alloc(0),
      lines = '',
      log = '',
      base = 0,
      bytes = 0,
      failure = '',
      finished = false;
    const cancel = () => child.kill();
    signal.addEventListener('abort', cancel, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      try {
        for (let end = jpegEnd(pending, 0); end > 0; end = jpegEnd(pending, 0)) {
          tiles.push(Buffer.from(pending.subarray(0, end)));
          bytes += end;
          pending = pending.subarray(end);
        }
      } catch (e) {
        failure = (e as Error).message;
        cancel();
      }
      if (bytes > STORED_BYTES) {
        failure = 'The filmstrip for this recording exceeded its memory limit.';
        cancel();
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = lines + chunk.toString();
      const parts = text.split(/\r?\n/);
      lines = parts.pop()!;
      log = (log + text).slice(-4000);
      for (const line of parts) {
        const timeBase = /config in time_base:\s*(\d+)\/(\d+)/.exec(line);
        if (timeBase && !base) base = Number(timeBase[1]) / Number(timeBase[2]);
        const frame = /n:\s*\d+\s+pts:\s*(-?\d+).*?iskey:\s*(\d+)/.exec(line);
        if (frame) times.push(frame[2] === '1' && base ? Number(frame[1]) * base - offset : NaN);
      }
    });
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener('abort', cancel);
      if (signal.aborted) return reject(new Error('Cancelled'));
      if (error || failure) return reject(error || new Error(failure));
      if (pending.length || tiles.length !== times.length)
        return reject(new Error('The filmstrip pass output could not be matched to its frames.'));
      const kept = { times: [] as number[], tiles: [] as Buffer[] };
      tiles.forEach((tile, n) => {
        const at = times[n];
        if (
          Number.isFinite(at) &&
          Math.abs(nearestKey(keys, at) - at) <= 0.002 &&
          !(at <= kept.times[kept.times.length - 1] + 0.000001)
        ) {
          kept.times.push(at);
          kept.tiles.push(tile);
        }
      });
      if (!kept.tiles.length) reject(new Error('No keyframe thumbnails could be verified.'));
      else resolve(kept);
    };
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (code !== 0 && !signal.aborted && !failure)
        failure = `The filmstrip pass failed: ${log.trim().split(/\r?\n/).pop() || code}`;
      finish();
    });
  });
}

/** Writes a recording's tile file atomically: magic, header length, JSON header, then JPEGs. */
export async function writeTileFile(
  file: string,
  source: NativeSource,
  offset: number,
  set: { times: number[]; tiles: Buffer[] },
) {
  const header = Buffer.from(
    JSON.stringify({
      identity: sourceIdentity(source, offset),
      times: set.times,
      sizes: set.tiles.map((t) => t.length),
    }),
  );
  const length = Buffer.alloc(4);
  length.writeUInt32LE(header.length);
  const partial = file.replace(/\.bin$/, '.partial.bin');
  const handle = await open(partial, 'w');
  try {
    await handle.writeFile(Buffer.concat([MAGIC, length, header, ...set.tiles]));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(partial, file).catch(async (e) => {
    await unlink(partial).catch(() => {});
    throw e;
  });
}

/** A recording's tiles, `null` when there is no file, or 'stale' for another source state. */
export async function readTileFile(
  file: string,
  source: NativeSource,
  offset: number,
): Promise<TileSet | 'stale' | null> {
  const data = await readFile(file).catch(() => null);
  if (!data) return null;
  try {
    if (!data.subarray(0, MAGIC.length).equals(MAGIC)) return 'stale';
    const start = MAGIC.length + 4,
      length = data.readUInt32LE(MAGIC.length),
      header = JSON.parse(data.subarray(start, start + length).toString()) as {
        identity: string;
        times: number[];
        sizes: number[];
      };
    const identity = sourceIdentity(source, offset);
    if (
      header.identity !== identity ||
      !Array.isArray(header.times) ||
      !Array.isArray(header.sizes) ||
      header.times.length !== header.sizes.length ||
      header.times.some((t, n) => !Number.isFinite(t) || (n > 0 && t <= header.times[n - 1])) ||
      header.sizes.reduce((a, b) => a + b, 0) !== data.length - start - length
    )
      return 'stale';
    const tiles: Buffer[] = [];
    let at = start + length;
    for (const size of header.sizes) {
      tiles.push(data.subarray(at, at + size));
      at += size;
    }
    return { identity, times: header.times, tiles, bytes: data.length };
  } catch {
    return 'stale';
  }
}

export class FilmstripCache {
  private cache = new Map<string, { time: number; data: string }>();
  private bytes = 0;
  // Whole tile sets read from each recording's tile file, least recently used first.
  private stored = new Map<string, TileSet>();
  private storedBytes = 0;
  private current: { token: string; controller: AbortController; sourceId: string } | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  /** Told when a recording has no usable tile file, so it can be made next. */
  onMissing?: (sourceId: string) => void;
  cancel(token: string, release = false) {
    if (this.current?.token !== token) return;
    this.current.controller.abort();
    if (release) this.forget(this.current.sourceId);
  }
  clear() {
    this.current?.controller.abort();
    this.current = null;
    this.cache.clear();
    this.bytes = 0;
    this.stored.clear();
    this.storedBytes = 0;
  }
  /** Drops one recording's thumbnails and leaves every other recording's in place. */
  forget(sourceId: string) {
    const prefix = `${sourceId}\n`;
    for (const [key, frame] of this.cache)
      if (key.startsWith(prefix)) {
        this.bytes -= frame.data.length * 2;
        this.cache.delete(key);
      }
    const set = this.stored.get(sourceId);
    if (set) this.storedBytes -= set.bytes;
    this.stored.delete(sourceId);
  }
  async close() {
    this.clear();
    await this.tail.catch(() => {});
  }
  stats() {
    return {
      entries: this.cache.size,
      bytes: this.bytes,
      stored: this.stored.size,
      storedBytes: this.storedBytes,
    };
  }
  /** Keeps a recording's whole tile set in memory, within the stored-tiles budget. */
  keep(sourceId: string, set: TileSet) {
    this.forgetStored(sourceId);
    this.stored.set(sourceId, set);
    this.storedBytes += set.bytes;
    while (this.storedBytes > STORED_BYTES && this.stored.size > 1)
      this.forgetStored(this.stored.keys().next().value!);
  }
  private forgetStored(sourceId: string) {
    const set = this.stored.get(sourceId);
    if (!set) return;
    this.storedBytes -= set.bytes;
    this.stored.delete(sourceId);
  }
  private async tileSet(source: NativeSource, offset: number, file?: string) {
    const known = this.stored.get(source.id);
    if (known?.identity === sourceIdentity(source, offset)) {
      this.stored.delete(source.id);
      this.stored.set(source.id, known);
      return known;
    }
    if (!file) return undefined;
    const read = await readTileFile(file, source, offset);
    if (read === 'stale') await unlink(file).catch(() => {});
    if (!read || read === 'stale') {
      this.onMissing?.(source.id);
      return undefined;
    }
    this.keep(source.id, read);
    return read;
  }
  request(
    tool: string,
    source: NativeSource,
    offset: number,
    keys: number[],
    targets: number[],
    token: string,
    file?: string,
  ) {
    this.current?.controller.abort();
    const job = { token, controller: new AbortController(), sourceId: source.id };
    this.current = job;
    const work = this.tail
      .catch(() => {})
      .then(async () => {
        const { signal } = job.controller;
        if (signal.aborted || this.current !== job) throw new Error('Cancelled');
        // Project-scoped LRU: switching sources cancels work, not completed images.
        // Include path/clock/render shape so a relink cannot reuse a different decode.
        const identity = sourceIdentity(source, offset);
        const check = async () => {
          const info = await stat(source.file);
          if (signal.aborted) throw new Error('Cancelled');
          if (info.size !== source.bytes || info.mtimeMs !== source.modified) {
            this.forget(source.id);
            throw new Error('The source changed. Relink or inspect it again.');
          }
        };
        await check();
        const set = await this.tileSet(source, offset, file);
        if (signal.aborted) throw new Error('Cancelled');
        const result: FilmstripFrame[] = [];
        for (const requested of targets) {
          if (signal.aborted) throw new Error('Cancelled');
          const at = nearestKey(keys, requested);
          if (!Number.isFinite(at)) throw new Error('Keyframe index is unavailable.');
          if (set) {
            const index = nearestIndex(set.times, at);
            if (Math.abs(set.times[index] - at) <= 0.002) {
              result.push({
                requested,
                time: set.times[index],
                data: 'data:image/jpeg;base64,' + set.tiles[index].toString('base64'),
                stored: true,
              });
              continue;
            }
          }
          const key = `${source.id}\n${identity}:${at}`;
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
