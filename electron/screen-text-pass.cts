import { spawn } from 'node:child_process';
import type { ReadLine } from './screen-text.js';
import { SCREEN_TEXT_WORKER, type ScreenTextRuntimeSettings } from './screen-text-runtime.cjs';

/** What the worker sends for each keyframe (VC-141). Times are file seconds. */
export type KeyframeReading =
  { time: number; lines: ReadLine[]; ms: number } | { time: number; same: true };
export interface PassResult {
  frames: number;
  read: number;
  ms: number;
  gpu: boolean;
  peakMemoryBytes?: number;
}

/**
 * Runs the screen text worker over a recording's keyframes behind its guard (a kill-on-close
 * Job Object, as the speech worker's), so closing or crashing the app, or aborting, ends the
 * reader and its FFmpeg. Calls `frame` for each keyframe in time order.
 */
export function readKeyframes(
  engine: ScreenTextRuntimeSettings,
  video: {
    ffmpeg: string;
    args: string[];
    width: number;
    height: number;
    same: [number, number][];
    after?: number;
  },
  frame: (reading: KeyframeReading) => void,
  signal: AbortSignal,
  started?: (pids: { worker: number; guard: number }) => void,
) {
  signal.throwIfAborted();
  return new Promise<PassResult>((resolve, reject) => {
    const child = spawn(
      engine.python,
      ['-I', '-B', SCREEN_TEXT_WORKER, engine.libraries, '--guard', String(process.pid)],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      },
    );
    let pending = '',
      errorText = '',
      result: PassResult | undefined,
      failure: Error | undefined;
    const stop = () => child.kill();
    signal.addEventListener('abort', stop, { once: true });
    child.on('error', (e) => (failure ??= e));
    child.stdin.on('error', () => {});
    child.stdin.write(JSON.stringify({ id: 1, op: 'read', video }) + '\n');
    child.stderr.on('data', (d) => (errorText = (errorText + d.toString()).slice(-3000)));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (data: string) => {
      pending += data;
      try {
        if (pending.length > 8 * 1024 * 1024)
          throw new Error('Screen text worker response exceeded its size limit.');
        let i: number;
        while ((i = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, i).trim();
          pending = pending.slice(i + 1);
          if (!line) continue;
          const reply = JSON.parse(line) as {
            id: number | null;
            ok?: boolean;
            error?: string;
            frame?: KeyframeReading;
            worker?: number;
            guard?: number;
          } & Partial<PassResult>;
          if (reply.worker && reply.guard) started?.({ worker: reply.worker, guard: reply.guard });
          else if (reply.frame) frame(reply.frame);
          else if (reply.ok === false) {
            failure ??= new Error(reply.error || 'The screen text engine stopped.');
            child.stdin.end();
          } else if (reply.ok && reply.frames != null) {
            result = {
              frames: reply.frames,
              read: reply.read ?? 0,
              ms: reply.ms ?? 0,
              gpu: !!reply.gpu,
              peakMemoryBytes: reply.peakMemoryBytes ?? undefined,
            };
            child.stdin.end();
          }
        }
      } catch (e) {
        failure ??= e instanceof Error ? e : new Error(String(e));
        child.kill();
      }
    });
    child.on('close', (code) => {
      signal.removeEventListener('abort', stop);
      if (signal.aborted)
        reject(signal.reason instanceof Error ? signal.reason : new Error('Cancelled'));
      else if (failure) reject(failure);
      else if (!result)
        reject(
          new Error(
            lastLine(errorText) ||
              `The screen text engine stopped without finishing (exit ${code}).`,
          ),
        );
      else resolve(result);
    });
  });
}
function lastLine(text: string) {
  return text.trim().split(/\r?\n/).pop()?.slice(0, 500) || '';
}
