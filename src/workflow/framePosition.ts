import type { Recording } from './model';

type Source = Pick<Recording, 'frameTimes' | 'fps' | 'duration'>;

/** Zero-based source frame ordinal. Indexed VFR timestamps take precedence over FPS. */
export function framePosition(source: Source, time: number): number {
  const frames = source.frameTimes;
  if (frames?.length) {
    let lo = 0,
      hi = frames.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (frames[mid] <= time + 1e-7) lo = mid + 1;
      else hi = mid;
    }
    return Math.max(0, lo - 1);
  }
  return Math.max(
    0,
    Math.min(
      Math.ceil(source.duration * (source.fps || 30)) - 1,
      Math.floor(time * (source.fps || 30) + 1e-7),
    ),
  );
}

export function parseFramePosition(source: Source, text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const frame = Number(text);
  if (!Number.isSafeInteger(frame)) return null;
  if (source.frameTimes?.length) return source.frameTimes[frame] ?? null;
  const time = frame / (source.fps || 30);
  return time < source.duration ? time : null;
}
