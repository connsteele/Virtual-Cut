import { availableParallelism } from 'node:os';
import { launchTool } from './media-inspection.cjs';
import {
  ChunkReader,
  chunkArgs,
  chunkPlan,
  type Chunk,
  type ChunkStats,
  type VisualDecoder,
} from './visual-events.js';

/** What the pass may use at this moment; read again at every chunk and every second. */
export interface PassAllowance {
  gpu: boolean;
  cpu: number;
}

/** Chunks already read, kept while a pass waits so it carries on where it stopped. */
export interface PassProgress {
  chunks: Map<number, ChunkStats>;
  /** Time spent reading, over every earlier run of this pass (kept by the caller). */
  elapsedMs: number;
  used: Set<VisualDecoder>;
}

export interface PassOptions {
  ffmpeg: string;
  file: string;
  offset: number;
  duration: number;
  height: number;
  /** NVDEC decoder for the recording's codec, if there is one to try. */
  gpu?: string;
  chunkSeconds?: number;
  allowance: () => PassAllowance;
  progress: (fraction: number) => void;
  /** The NVIDIA decoder could not read a chunk; it is not tried again for this recording. */
  gpuFailed?: (error: Error) => void;
  signal: AbortSignal;
}

/** CPU workers when the PC is idle: 8 threads each, at most 3 (the spike's best queue). */
export function cpuWorkers() {
  return Math.max(1, Math.min(3, Math.floor(availableParallelism() / 8)));
}

/**
 * Reads every chunk of a recording with the decoders allowed, each taking the next free
 * chunk (D2: one NVDEC worker plus CPU workers on a 30 s chunk queue). CPU workers stop
 * mid-chunk when they are no longer allowed; their chunk goes back on the queue.
 */
export async function runPass(options: PassOptions, done: PassProgress) {
  const plan = chunkPlan(options.duration, options.chunkSeconds);
  const flying = new Map<
    number,
    { decoder: VisualDecoder; controller: AbortController; reader: ChunkReader; chunk: Chunk }
  >();
  let gpuBroken = !options.gpu;
  let failure: Error | undefined;
  const report = () => {
    let read = 0;
    for (const c of done.chunks.values())
      read += Math.min(plan[c.index].end, options.duration) - plan[c.index].start;
    for (const f of flying.values())
      read += Math.max(0, Math.min(f.reader.last, f.chunk.end) - f.chunk.start);
    options.progress(Math.min(0.99, read / Math.max(options.duration, 0.001)));
  };
  const pending = () => plan.filter((c) => !done.chunks.has(c.index) && !flying.has(c.index));
  const start = (decoder: VisualDecoder) => {
    const chunk = pending()[0];
    if (!chunk) return false;
    const controller = new AbortController();
    const reader = new ChunkReader(chunk, options.offset);
    const job = { decoder, controller, reader, chunk };
    flying.set(chunk.index, job);
    const stop = () => controller.abort();
    options.signal.addEventListener('abort', stop, { once: true });
    const args = chunkArgs({
      file: options.file,
      chunk,
      offset: options.offset,
      duration: options.duration,
      decoder,
      gpu: options.gpu,
      height: options.height,
      threads: decoder === 'cpu' ? 8 : undefined,
    });
    let ticks = 0;
    void launchTool(options.ffmpeg, args, controller.signal, (line) => {
      reader.line(line);
      if (++ticks % 2000 === 0) report();
    })
      .then(() => {
        const stats = reader.finish();
        if (!stats.times.length) throw new Error('The picture pass read no frames in a chunk.');
        done.chunks.set(chunk.index, stats);
        done.used.add(decoder);
      })
      .catch((e: Error) => {
        if (controller.signal.aborted) return;
        if (decoder === 'gpu') {
          gpuBroken = true;
          options.gpuFailed?.(e);
        } else failure ??= e;
      })
      .finally(() => {
        options.signal.removeEventListener('abort', stop);
        flying.delete(chunk.index);
        report();
        wake();
      });
    return true;
  };
  let wake = () => {};
  try {
    for (;;) {
      if (options.signal.aborted) throw new Error('Cancelled');
      if (failure) throw failure;
      if (done.chunks.size === plan.length) break;
      const allowed = options.allowance();
      const gpu = allowed.gpu && !gpuBroken;
      // CPU workers that are no longer allowed stop now; their chunks go back on the queue.
      const cpu = [...flying.values()].filter((f) => f.decoder === 'cpu');
      for (const f of cpu.slice(allowed.cpu)) f.controller.abort();
      if (!gpu) for (const f of flying.values()) if (f.decoder === 'gpu') f.controller.abort();
      if (gpu && ![...flying.values()].some((f) => f.decoder === 'gpu')) start('gpu');
      while ([...flying.values()].filter((f) => f.decoder === 'cpu').length < allowed.cpu)
        if (!start('cpu')) break;
      // With no decoder allowed the pass idles; the job lanes pause it (pictureYields).
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1000);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  } finally {
    for (const f of flying.values()) f.controller.abort();
    while (flying.size) await new Promise((r) => setTimeout(r, 10));
  }
  return [...done.chunks.values()];
}

/** Whether FFmpeg's NVDEC decoder reads this file (a fraction of a second of it). */
export async function gpuReads(
  ffmpeg: string,
  file: string,
  decoder: string,
  offset: number,
  signal: AbortSignal,
) {
  try {
    await launchTool(
      ffmpeg,
      [
        '-hide_banner',
        '-nostdin',
        '-loglevel',
        'error',
        '-c:v',
        decoder,
        '-resize',
        '64x36',
        '-ss',
        offset.toFixed(6),
        '-t',
        '0.2',
        '-i',
        file,
        '-map',
        '0:V:0',
        '-an',
        '-f',
        'null',
        '-',
      ],
      AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    );
    return true;
  } catch {
    signal.throwIfAborted();
    return false;
  }
}
