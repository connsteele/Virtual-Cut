/**
 * Picture events for a whole recording (VC-180): per-frame brightness plus black screens,
 * still pictures, strong cuts and fades, found once by a background pass and kept outside the
 * editable model (decision 0020). The pass decodes the recording in chunks, on the NVIDIA
 * decoder and, when the PC is idle, on CPU workers too. Every rule here works on per-frame
 * values, so where the chunks fall, and which decoder read a chunk, never changes the events.
 *
 * Black screens use the Split snap's rule (VC-165): at least 92% of the picture darker than
 * 10% brightness for 0.1 s or more, measured on a 480 px wide picture, so the snap can read
 * them instead of decoding its window again.
 */
export const VISUAL_VERSION = 1;
/** Width the picture is scaled to before measuring, as the snap does. */
export const VISUAL_WIDTH = 480;
/** Seconds of recording per chunk; each decoder takes the next free chunk. */
export const VISUAL_CHUNK = 30;
/** Decoded before a chunk so its first frame has the frames it is compared with. */
export const VISUAL_PRE_ROLL = 0.5;
/** Decoded after a chunk so a still picture starting near its end is measured in full. */
export const VISUAL_POST_ROLL = 1;
/** blackdetect's pixel threshold 0.10 of the limited range (16 + 0.10 × 219, truncated). */
export const BLACK_PIXEL = 38;
export const BLACK_PICTURE = 92;
export const BLACK_MIN = 0.1;
export const STILL_MIN = 0.5;
/** scdet scores from 15 up matched on every decoder path in the spike (D2); lower ones did not. */
export const STRONG_CUT = 15;
export const FADE_DELTA = 40;
export const FADE_WINDOW = 1;

export type VisualDecoder = 'gpu' | 'cpu';
/** What the pass uses right now, or used over its run. */
export type VisualUse = 'gpu' | 'gpu+cpu' | 'cpu';

export type VisualEvent =
  | { kind: 'black'; start: number; end: number; toEnd?: boolean }
  | { kind: 'still'; start: number; end: number; brightness: number; toEnd?: boolean }
  | { kind: 'cut'; start: number; score: number }
  | { kind: 'fade'; start: number; end: number; from: number; to: number };

/** Stored once per recording and source fingerprint. Times are recording seconds. */
export interface VisualEvents {
  version: number;
  events: VisualEvent[];
  /** Per-frame values in frame order: time, mean brightness 0-255 and scdet's cut score 0-100,
   * rounded to whole numbers (about 6 bytes a frame). */
  frames: { times: Float32Array; brightness: Uint8Array; cut: Uint8Array };
  use: VisualUse;
  /** Time the pass ran, not counting pauses. */
  elapsedMs: number;
  created: string;
}
export interface VisualSummary {
  use: VisualUse;
  elapsedMs: number;
  frames: number;
  counts: Record<VisualEvent['kind'], number>;
}

/** Per-frame values of one chunk, plus the still pictures FFmpeg reported in it. */
export interface ChunkStats {
  index: number;
  /** The chunk's own span; frames outside it were decoded only as pre- or post-roll. */
  start: number;
  end: number;
  times: number[];
  brightness: number[];
  black: number[];
  cut: number[];
  /** freezedetect intervals in recording time; `end` is missing when still on screen at the
   * end of what was decoded. */
  stills: { start: number; end?: number }[];
  /** First and last decoded frame times (pre- and post-roll included). */
  decodedFrom: number;
  decodedTo: number;
}

export interface Chunk {
  index: number;
  start: number;
  end: number;
}
export function chunkPlan(duration: number, size = VISUAL_CHUNK): Chunk[] {
  const count = Math.max(1, Math.ceil(duration / size - 1e-9));
  return Array.from({ length: count }, (_, index) => ({
    index,
    start: index * size,
    end: index === count - 1 ? Infinity : (index + 1) * size,
  }));
}

/** Picture height for a 480 px width, even, keeping the recording's shape. */
export function visualHeight(width?: number, height?: number) {
  if (!width || !height) return 270;
  return Math.max(2, Math.round((VISUAL_WIDTH * height) / width / 2) * 2);
}

/** NVDEC decoder name for a recording's codec, when FFmpeg has one. */
export function gpuDecoder(codec?: string) {
  const name = (codec || '').toLowerCase();
  const known: Record<string, string> = {
    av1: 'av1_cuvid',
    h264: 'h264_cuvid',
    hevc: 'hevc_cuvid',
    vp9: 'vp9_cuvid',
    vp8: 'vp8_cuvid',
    mpeg2video: 'mpeg2_cuvid',
  };
  return known[name];
}

export const VISUAL_FILTER =
  `format=yuv420p,signalstats,blackframe=amount=0:threshold=${BLACK_PIXEL},` +
  `scdet=threshold=100,freezedetect=n=-60dB:d=${STILL_MIN},metadata=mode=print:file='pipe\\:1'`;

/** FFmpeg arguments for one chunk, in file time (`offset` is the first video timestamp). */
export function chunkArgs(options: {
  file: string;
  chunk: Chunk;
  offset: number;
  duration: number;
  decoder: VisualDecoder;
  gpu?: string;
  height: number;
  threads?: number;
}) {
  const { chunk, offset, duration } = options;
  const from = Math.max(0, chunk.start - VISUAL_PRE_ROLL);
  const to = Math.min(duration + 1, chunk.end + VISUAL_POST_ROLL);
  const input =
    options.decoder === 'gpu'
      ? ['-c:v', options.gpu!, '-resize', `${VISUAL_WIDTH}x${options.height}`]
      : [];
  const scale =
    options.decoder === 'gpu' ? '' : `scale=${VISUAL_WIDTH}:${options.height}:flags=area,`;
  return [
    '-hide_banner',
    '-nostdin',
    '-nostats',
    '-loglevel',
    'error',
    '-copyts',
    ...(options.threads ? ['-threads', String(options.threads)] : []),
    ...input,
    '-ss',
    (offset + from).toFixed(6),
    '-t',
    (to - from).toFixed(6),
    '-i',
    options.file,
    '-map',
    '0:V:0',
    '-an',
    '-sn',
    '-dn',
    '-vf',
    scale + VISUAL_FILTER,
    '-f',
    'null',
    '-',
  ];
}

/** Reads `metadata=mode=print` lines of one chunk; keeps the chunk's own frames. */
export class ChunkReader {
  private frame: {
    t: number;
    y?: number;
    black?: number;
    cut?: number;
  } | null = null;
  private stills: { start: number; end?: number }[] = [];
  readonly stats: ChunkStats;
  private chunk: Chunk;
  private offset: number;
  constructor(chunk: Chunk, offset: number) {
    this.chunk = chunk;
    this.offset = offset;
    this.stats = {
      index: chunk.index,
      start: chunk.start,
      end: chunk.end,
      times: [],
      brightness: [],
      black: [],
      cut: [],
      stills: this.stills,
      decodedFrom: Infinity,
      decodedTo: -Infinity,
    };
  }
  /** Recording time of the last frame read, for progress. */
  last = -Infinity;
  line(text: string) {
    const line = text.trim();
    if (line.startsWith('frame:')) {
      this.flush();
      const t = Number(/pts_time:(-?[\d.]+)/.exec(line)?.[1]) - this.offset;
      if (!Number.isFinite(t)) throw new Error('The picture pass returned a frame without a time.');
      this.frame = { t };
      this.last = t;
      return;
    }
    const eq = line.indexOf('=');
    if (eq < 0 || !this.frame) return;
    const key = line.slice(0, eq),
      value = Number(line.slice(eq + 1));
    if (key === 'lavfi.signalstats.YAVG') this.frame.y = value;
    else if (key === 'lavfi.blackframe.pblack') this.frame.black = value;
    else if (key === 'lavfi.scd.score') this.frame.cut = value;
    else if (key === 'lavfi.freezedetect.freeze_start') {
      const open = this.stills.at(-1);
      if (!open || open.end != null) this.stills.push({ start: value - this.offset });
    } else if (key === 'lavfi.freezedetect.freeze_end') {
      const open = this.stills.at(-1);
      if (open && open.end == null) open.end = value - this.offset;
    }
  }
  private flush() {
    const f = this.frame;
    this.frame = null;
    if (!f) return;
    this.stats.decodedFrom = Math.min(this.stats.decodedFrom, f.t);
    this.stats.decodedTo = Math.max(this.stats.decodedTo, f.t);
    if (f.t < this.chunk.start - 1e-6 || f.t >= this.chunk.end - 1e-6) return;
    if (f.y == null || f.black == null || f.cut == null)
      throw new Error('The picture pass returned incomplete frame values.');
    const s = this.stats;
    if (s.times.length && f.t <= s.times.at(-1)! + 1e-6) return;
    s.times.push(f.t);
    s.brightness.push(f.y);
    s.black.push(f.black);
    s.cut.push(f.cut);
  }
  finish() {
    this.flush();
    return this.stats;
  }
}

const round = (n: number, places = 3) => Math.round(n * 10 ** places) / 10 ** places;

/**
 * Still pictures across chunk edges. Each chunk owns the stills that start inside it. A still
 * that is still on screen when its chunk's decoding stopped continues in the next chunk, whose
 * pre-roll overlaps it: its end is the end of the next chunk's still that began before that
 * chunk's own span.
 */
export function joinStills(chunks: ChunkStats[], duration: number) {
  const ordered = [...chunks].sort((a, b) => a.index - b.index);
  const out: { start: number; end: number; toEnd?: boolean }[] = [];
  for (let k = 0; k < ordered.length; k++) {
    const chunk = ordered[k];
    for (const still of ordered[k].stills) {
      if (still.start < chunk.start - 1e-6 || still.start >= chunk.end - 1e-6) continue;
      let end = still.end;
      for (let next = k + 1; end == null && next < ordered.length; next++) {
        // The still that began before the next chunk's own span and lasts into it.
        const span = ordered[next].start;
        const carry = ordered[next].stills
          .filter((s) => s.start < span - 1e-6 && (s.end == null || s.end >= span - 1e-6))
          .at(-1);
        if (!carry) break;
        end = carry.end;
      }
      if (end == null) out.push({ start: still.start, end: duration, toEnd: true });
      else out.push({ start: still.start, end });
    }
  }
  return out;
}

/** Joins chunk values into the recording's frames (in time order, each frame once). */
export function joinFrames(chunks: ChunkStats[]) {
  const ordered = [...chunks].sort((a, b) => a.index - b.index);
  const times: number[] = [],
    brightness: number[] = [],
    black: number[] = [],
    cut: number[] = [];
  for (const c of ordered)
    c.times.forEach((t, i) => {
      if (times.length && t <= times.at(-1)! + 1e-6) return;
      times.push(t);
      brightness.push(c.brightness[i]);
      black.push(c.black[i]);
      cut.push(c.cut[i]);
    });
  return { times, brightness, black, cut };
}

/** The recording's picture events from its joined frames and still pictures. */
export function buildEvents(
  frames: ReturnType<typeof joinFrames>,
  stillRuns: ReturnType<typeof joinStills>,
  duration: number,
): VisualEvent[] {
  const { times, brightness, black, cut } = frames;
  const n = times.length;
  const events: VisualEvent[] = [];
  // Black: a run of frames with at least 92% dark pixels, from its first frame to the first
  // frame that is not black, kept when 0.1 s or longer (blackdetect's rule).
  const blacks: { start: number; end: number; toEnd?: boolean }[] = [];
  for (let i = 0; i < n;) {
    if (black[i] < BLACK_PICTURE) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < n && black[j + 1] >= BLACK_PICTURE) j++;
    const toEnd = j + 1 >= n;
    const end = toEnd ? duration : times[j + 1];
    if (end - times[i] >= BLACK_MIN - 1e-6)
      blacks.push({ start: times[i], end, ...(toEnd ? { toEnd } : {}) });
    i = j + 1;
  }
  for (const b of blacks)
    events.push({
      kind: 'black',
      start: round(b.start),
      end: round(b.end),
      ...(b.toEnd ? { toEnd: true } : {}),
    });
  const nearBlack = (s: number, e: number, margin: number) =>
    blacks.some((b) => s <= b.end + margin && e >= b.start - margin);
  const mean = (s: number, e: number) => {
    let sum = 0,
      count = 0;
    for (let i = lowerBound(times, s); i < n && times[i] < e; i++) {
      sum += brightness[i];
      count++;
    }
    return count ? sum / count : 0;
  };
  // Still: FFmpeg freezedetect (0.5 s or longer). A still that is a black screen adds nothing.
  for (const still of stillRuns) {
    if (blacks.some((b) => b.start <= still.start + 0.2 && b.end >= still.end - 0.2)) continue;
    events.push({
      kind: 'still',
      start: round(still.start),
      end: round(still.end),
      brightness: Math.round(mean(still.start, still.end)),
      ...(still.toEnd ? { toEnd: true } : {}),
    });
  }
  // Strong cut: scdet score 15 or more, except where a black screen starts or ends.
  const cuts: number[] = [];
  for (let i = 0; i < n; i++)
    if (cut[i] >= STRONG_CUT && !nearBlack(times[i], times[i], 0.1)) {
      cuts.push(times[i]);
      events.push({ kind: 'cut', start: round(times[i]), score: round(cut[i], 1) });
    }
  // Fade: brightness moving by 40 or more within 1 s with no hard cut (fades, flashes, pop-ups),
  // away from black screens, which already say the picture went dark.
  for (let i = 0; i < n;) {
    const t0 = times[i],
      y0 = brightness[i];
    let j = i;
    while (j + 1 < n && times[j + 1] - t0 <= FADE_WINDOW + 1e-6) j++;
    const y1 = brightness[j];
    if (Math.abs(y1 - y0) < FADE_DELTA) {
      i++;
      continue;
    }
    let k = j;
    while (k + 1 < n && (brightness[k + 1] - brightness[k]) * (y1 - y0) > 0) k++;
    let a = i;
    while (a < k && Math.abs(brightness[a + 1] - y0) < 1) a++;
    const s = times[a],
      e = times[k];
    const nearCut = cuts.some((c) => s - 0.1 <= c && c <= e + 0.1);
    if (!nearCut && !nearBlack(s, e, 0.3))
      events.push({
        kind: 'fade',
        start: round(s),
        end: round(e),
        from: Math.round(brightness[a]),
        to: Math.round(brightness[k]),
      });
    i = k + 1;
  }
  const order = { black: 0, still: 1, cut: 2, fade: 3 };
  return events.sort((a, b) => a.start - b.start || order[a.kind] - order[b.kind]);
}

function lowerBound(values: readonly number[], at: number) {
  let lo = 0,
    hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < at) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function summarize(stored: Pick<VisualEvents, 'events' | 'use' | 'elapsedMs' | 'frames'>) {
  const counts = { black: 0, still: 0, cut: 0, fade: 0 };
  for (const e of stored.events) counts[e.kind]++;
  return {
    use: stored.use,
    elapsedMs: stored.elapsedMs,
    frames: stored.frames.times.length,
    counts,
  } satisfies VisualSummary;
}

/** Plain-text lines for one event, as agents will read them (VC-171). */
export function eventLine(e: VisualEvent) {
  const span = 'end' in e ? `${e.start.toFixed(2)}-${e.end.toFixed(2)}` : e.start.toFixed(2);
  if (e.kind === 'black') return `${span}  black  ${(e.end - e.start).toFixed(1)}s`;
  if (e.kind === 'still')
    return `${span}  still picture  ${(e.end - e.start).toFixed(1)}s  brightness ${e.brightness}`;
  if (e.kind === 'cut') return `${span}  cut  score ${e.score.toFixed(1)}`;
  return `${span}  ${e.to < e.from ? 'darker' : 'brighter'}  brightness ${e.from} -> ${e.to}`;
}
