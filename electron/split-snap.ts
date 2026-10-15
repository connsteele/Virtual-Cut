/**
 * Split snap (VC-165): a spoken Split is often said a few seconds after the scene change it
 * means. When a black or loading screen of 0.3 s or more ends in the 5 s before the word (or
 * is still on screen up to 1 s after it), the cue card suggests cutting where that screen ends.
 * Otherwise the spoken time stands. Measured on two labelled recordings (decision of record,
 * 10 Oct): 25 of 26 Splits on target, against 12 for the spoken time. Cue words and cue
 * detection are untouched; this only proposes a position.
 */
export const SNAP_LOOK_BACK = 5;
export const SNAP_LOOK_AHEAD = 1;
export const SNAP_MIN_BLACK = 0.3;
/** Decoded before the window so a black ending at its start still measures its full 0.3 s. */
export const SNAP_PRE_ROLL = 0.4;
/** How far past the window a black that is still on screen is followed to find its end. */
export const SNAP_FOLLOW = 10;
/** FFmpeg blackdetect as measured: short blacks are found, a HUD doesn't stop a fade counting. */
export const SNAP_FILTER = 'scale=480:-2:flags=area,blackdetect=d=0.1:pic_th=0.92';

export interface BlackScreen {
  start: number;
  /** Undefined while the black runs past the end of what was decoded. */
  end?: number;
}

export interface SplitSnap {
  /** The heard time of the word (the spoken anchor). */
  spoken: number;
  /** Where the cut is suggested: the first frame after the black screen. */
  time: number;
  blackStart: number;
  blackEnd: number;
}

/** FFmpeg arguments that print blackdetect's events for `duration` s from `start` (file time). */
export function snapArgs(file: string, start: number, duration: number) {
  return [
    '-hide_banner',
    '-nostdin',
    '-nostats',
    '-loglevel',
    'error',
    '-copyts',
    '-threads',
    '4',
    '-ss',
    start.toFixed(6),
    '-t',
    duration.toFixed(6),
    '-i',
    file,
    '-map',
    '0:V:0',
    '-an',
    '-sn',
    '-dn',
    '-vf',
    `${SNAP_FILTER},metadata=mode=print:file='pipe\\:1'`,
    '-f',
    'null',
    '-',
  ];
}

/** Decode range for one Split, in recording seconds. */
export function snapWindow(spoken: number, duration: number) {
  const start = Math.max(0, spoken - SNAP_LOOK_BACK - SNAP_PRE_ROLL);
  const end = Math.min(duration, spoken + SNAP_LOOK_AHEAD);
  return { start, end };
}

/**
 * Black screens from FFmpeg `metadata=mode=print` output of blackdetect, in source seconds
 * (subtract `offset`, the recording's first video timestamp, to get recording time).
 */
export function readBlacks(lines: string[], offset = 0): BlackScreen[] {
  const blacks: BlackScreen[] = [];
  for (const line of lines) {
    const match = /^lavfi\.black_(start|end)=(-?[\d.]+)\s*$/.exec(line.trim());
    if (!match) continue;
    const at = Number(match[2]) - offset;
    if (!Number.isFinite(at)) continue;
    const open = blacks.at(-1);
    if (match[1] === 'start') {
      if (!open || open.end != null) blacks.push({ start: at });
    } else if (open && open.end == null && at > open.start) open.end = at;
    else if (!open || open.end != null) blacks.push({ start: -Infinity, end: at });
  }
  return blacks;
}

/**
 * The latest qualifying black screen for a Split heard at `spoken`: one that ends inside
 * [spoken - 5 s, spoken + 1 s], or is on screen at the word. `follow` gives the end of a black
 * still running when decoding stopped. Returns null when the spoken time should stand.
 */
export function chooseSnap(
  spoken: number,
  blacks: BlackScreen[],
  decodedFrom: number,
  follow?: number | null,
): SplitSnap | null {
  let best: { start: number; end: number } | null = null;
  for (const black of blacks) {
    const start = Math.max(black.start, decodedFrom);
    const end = black.end ?? follow;
    if (end == null || end - start < SNAP_MIN_BLACK - 1e-6) continue;
    const endsInWindow = end >= spoken - SNAP_LOOK_BACK && end <= spoken + SNAP_LOOK_AHEAD;
    const atWord = start <= spoken && spoken <= end;
    if ((endsInWindow || atWord) && (!best || end > best.end)) best = { start, end };
  }
  if (!best) return null;
  return { spoken, time: best.end, blackStart: best.start, blackEnd: best.end };
}

/** Move a time onto the nearest inspected frame when one is within half a frame at 60 fps. */
export function onFrame(time: number, frameTimes?: readonly number[]) {
  if (!frameTimes?.length) return time;
  let lo = 0,
    hi = frameTimes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frameTimes[mid] < time) lo = mid + 1;
    else hi = mid;
  }
  const near = [frameTimes[lo], frameTimes[lo - 1]].filter((t) => t != null);
  const best = near.reduce((a, b) => (Math.abs(b - time) < Math.abs(a - time) ? b : a));
  return Math.abs(best - time) <= 1 / 120 ? best : time;
}
