import type { Recording } from './model';

export function markerTime(recording: Recording, value: number, step = 0) {
  const frame = 1 / (recording.fps || 30);
  let snapped = Math.round(value / frame) * frame;
  const frames = recording.frameTimes;
  if (frames?.length) {
    const target = value + (step ? Math.sign(step) * 0.000001 : 0);
    let lo = 0,
      hi = frames.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (frames[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const left = frames[Math.max(0, lo - 1)],
      right = frames[Math.min(lo, frames.length - 1)];
    snapped = step
      ? step > 0
        ? right
        : left
      : Math.abs(right - target) < Math.abs(left - target)
        ? right
        : left;
  } else if (step) snapped += Math.sign(step) * frame;
  return Math.max(0, Math.min(Math.max(0, recording.duration - frame), snapped));
}
