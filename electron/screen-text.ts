/**
 * Screen text for a whole recording (VC-141): every piece of text the screen showed, read once
 * by a background pass and kept outside the editable model (decision 0021).
 *
 * The pass reads each keyframe (about one a second) as a whole frame scaled to 1080p, with
 * RapidOCR on DirectML and the spike's settings. Keyframes inside a still picture found by the
 * picture pass (VC-180) are not read again. The same text in the same place on consecutive
 * keyframes joins into one line.
 *
 * Facts only: text, box, first and last time, how many keyframes showed it and the engine's
 * confidence. Nothing here decides what text means (speaker, item, damage number); agents do
 * that with the game's context. Nothing here knows about any one game.
 */
import type { VisualEvent } from './visual-events.js';

export const SCREEN_TEXT_VERSION = 1;
/** Frames are read at this height (or their own, when smaller). */
export const SCREEN_TEXT_HEIGHT = 1080;
/** Boxes that overlap at least this much (intersection over union) are the same place. */
export const SAME_PLACE = 0.5;
/**
 * A line still joins after this many keyframes without it (the engine misses a line now and
 * then); a longer absence starts a new line.
 */
export const MISSED_KEYFRAMES = 1;

export type Box = [number, number, number, number];
/** One reading of one keyframe, as the worker returns it (box in the read frame's pixels). */
export interface ReadLine {
  text: string;
  box: Box;
  score: number;
}
/** One piece of text that stayed in one place. Times are recording seconds. */
export interface ScreenTextLine {
  text: string;
  /** Where it sat on the read frame: [x0, y0, x1, y1] pixels, the union of its readings. */
  box: Box;
  /** First and last keyframe that showed it. */
  first: number;
  last: number;
  /** Keyframes that showed it. */
  seen: number;
  /** The engine's mean confidence over its readings, 0 to 1. */
  score: number;
}
/** Stored once per recording and source fingerprint. */
export interface ScreenText {
  version: number;
  /** Size of the frames the boxes refer to. */
  width: number;
  height: number;
  lines: ScreenTextLine[];
  /** Keyframes in the recording, and how many were read; the rest were inside a still picture. */
  keyframes: number;
  read: number;
  /** Whether DirectML ran the engine on the graphics card. */
  gpu: boolean;
  /** Time the pass ran, not counting pauses. */
  elapsedMs: number;
  peakMemoryBytes?: number;
  created: string;
}
export interface ScreenTextSummary {
  lines: number;
  keyframes: number;
  read: number;
  gpu: boolean;
  elapsedMs: number;
}
export function summarizeText(stored: Omit<ScreenText, 'lines'> & { lines: { length: number } }) {
  return {
    lines: stored.lines.length,
    keyframes: stored.keyframes,
    read: stored.read,
    gpu: stored.gpu,
    elapsedMs: stored.elapsedMs,
  } satisfies ScreenTextSummary;
}

/** Size the frames are read at: 1080p for anything taller, keeping the shape, even numbers. */
export function readSize(width?: number, height?: number) {
  const w = width || 1920,
    h = height || 1080;
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  if (h <= SCREEN_TEXT_HEIGHT) return { width: even(w), height: even(h) };
  return { width: even((w * SCREEN_TEXT_HEIGHT) / h), height: SCREEN_TEXT_HEIGHT };
}

/** Keyframes closer than this to the last one taken are skipped: recorders differ (OBS writes one
 * a second, NVIDIA capture two), and one a second is enough for text people can read. */
export const KEYFRAME_GAP = 0.9;
const KEYFRAME_CAP = `select='isnan(prev_selected_t)+gte(t-prev_selected_t,${KEYFRAME_GAP})'`;
/**
 * FFmpeg arguments for the keyframes from `from` recording seconds on (`offset` is the first
 * video timestamp): keyframes only, at most one per KEYFRAME_GAP, file timestamps kept, each
 * logged by showinfo, raw bgr24
 * frames of `size` on stdout. Decoding only keyframes is cheap on the CPU (about 90 a second
 * for 4K AV1), so the pass never takes the GPU decoder from playback.
 */
export function keyframeArgs(options: {
  file: string;
  offset: number;
  from: number;
  size: { width: number; height: number };
  sourceHeight?: number;
}) {
  const scale =
    options.sourceHeight && options.sourceHeight === options.size.height
      ? ''
      : `,scale=${options.size.width}:${options.size.height}:flags=area`;
  return [
    '-hide_banner',
    '-nostdin',
    '-nostats',
    '-loglevel',
    'info',
    '-skip_frame',
    'nokey',
    '-copyts',
    ...(options.from > 0 ? ['-ss', (options.offset + options.from).toFixed(6)] : []),
    '-i',
    options.file,
    '-map',
    '0:V:0',
    '-an',
    '-sn',
    '-dn',
    '-fps_mode',
    'passthrough',
    '-vf',
    `${KEYFRAME_CAP},showinfo${scale}`,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'bgr24',
    '-',
  ];
}

/**
 * Spans in file time where the picture pass found the picture unchanged (still pictures), so a
 * keyframe inside one reads the same as the last keyframe read in it.
 */
export function unchangedSpans(events: readonly VisualEvent[] | undefined, offset: number) {
  return (events || [])
    .filter((e): e is Extract<VisualEvent, { kind: 'still' }> => e.kind === 'still')
    .map((e) => [offset + e.start, offset + e.end] as [number, number]);
}

/** Text as compared: trimmed, inner whitespace collapsed. Nothing else is changed. */
export function sameText(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}
export function overlap(a: Box, b: Box) {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  const area = (x: Box) => Math.max(0, x[2] - x[0]) * Math.max(0, x[3] - x[1]);
  return inter / (area(a) + area(b) - inter);
}

interface Open extends ScreenTextLine {
  /** Index of the last keyframe that showed it; its last reading's box. */
  at: number;
  lastBox: Box;
  scores: number;
  readings: number;
}

/**
 * Joins keyframe readings into lines. Feed keyframes in time order: `frame` with what the engine
 * found, `same` for a keyframe whose picture had not changed since the last one read.
 */
export class LineJoiner {
  private open: Open[] = [];
  private closed: ScreenTextLine[] = [];
  private index = -1;
  keyframes = 0;
  read = 0;
  /** Recording seconds of the last keyframe taken; a resumed pass starts after it. */
  last = -Infinity;
  frame(time: number, lines: readonly ReadLine[]) {
    this.step(time);
    this.read++;
    const taken = new Set<Open>();
    for (const line of lines) {
      const text = sameText(line.text);
      if (!text) continue;
      let best: Open | undefined,
        bestOverlap = SAME_PLACE;
      for (const o of this.open) {
        if (taken.has(o) || o.text !== text || o.at === this.index) continue;
        const v = overlap(o.lastBox, line.box);
        if (v >= bestOverlap) {
          best = o;
          bestOverlap = v;
        }
      }
      if (best) {
        taken.add(best);
        best.at = this.index;
        best.last = time;
        best.seen++;
        best.lastBox = line.box;
        best.box = [
          Math.min(best.box[0], line.box[0]),
          Math.min(best.box[1], line.box[1]),
          Math.max(best.box[2], line.box[2]),
          Math.max(best.box[3], line.box[3]),
        ];
        best.scores += line.score;
        best.readings++;
      } else {
        const fresh: Open = {
          text,
          box: [...line.box] as Box,
          first: time,
          last: time,
          seen: 1,
          score: line.score,
          at: this.index,
          lastBox: line.box,
          scores: line.score,
          readings: 1,
        };
        taken.add(fresh);
        this.open.push(fresh);
      }
    }
  }
  /** A keyframe whose picture had not changed: every line on screen stays. */
  same(time: number) {
    this.step(time);
    for (const o of this.open)
      if (o.at === this.index - 1) {
        o.at = this.index;
        o.last = time;
        o.seen++;
      }
  }
  private step(time: number) {
    if (!(time > this.last)) throw new Error('Keyframes must come in time order.');
    this.index++;
    this.keyframes++;
    this.last = time;
    const keep: Open[] = [];
    for (const o of this.open)
      if (this.index - o.at > MISSED_KEYFRAMES + 1) this.closed.push(done(o));
      else keep.push(o);
    this.open = keep;
  }
  /** Every line so far, in order of first appearance, then top to bottom, left to right. */
  lines() {
    return [...this.closed, ...this.open.map(done)].sort(
      (a, b) => a.first - b.first || a.box[1] - b.box[1] || a.box[0] - b.box[0],
    );
  }
}
function done(o: Open): ScreenTextLine {
  return {
    text: o.text,
    box: o.box,
    first: o.first,
    last: o.last,
    seen: o.seen,
    score: Math.round((o.scores / o.readings) * 1000) / 1000,
  };
}
