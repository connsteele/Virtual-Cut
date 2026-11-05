/**
 * The look tool's planner (VC-172, decision 0022): which pictures one call sends and at what
 * size, fitted to the per-call caps. Pure: no decoding and no files. electron/look.cts renders
 * the plan with FFmpeg and sends the pictures as image blocks.
 */

/** Image cost follows pixels: one token per started 28 px cell, across and down. */
export const CELL = 28;
export const LOOK_CAPS = {
  moments: 8,
  images: 16,
  tokens: 8000,
  side: 1988,
  text: 100_000,
} as const;
/** Strip tiles fit inside 252x140 (9 x 5 cells). */
export const TILE = { width: 9 * CELL, height: 5 * CELL, most: 16, least: 2 } as const;
/** Whole frames, as boxes of whole cells; 16:9 recordings fill the width. */
export const FRAME_SIZES = {
  '1080p': [69, 39],
  '720p': [46, 26],
  '540p': [35, 20],
  '360p': [23, 13],
} as const;
export type FrameSize = keyof typeof FRAME_SIZES;
const ladder: FrameSize[] = ['1080p', '720p', '540p', '360p'];
/** Whole frames each size may send per call before the rest step down. */
export const FRAMES_PER_CALL: Partial<Record<FrameSize, number>> = { '1080p': 2, '720p': 6 };
/** Strip tiles come from the keyframe nearest each tile time when it is this close. */
export const KEYFRAME_REACH = 2;
/** A crop is not shrunk below this many pixels on its longer side. */
const SMALLEST_CROP = 224;

export class LookError extends Error {}

export interface LookMoment {
  kind: 'strip' | 'frames' | 'crop';
  start_seconds?: number;
  end_seconds?: number;
  tiles?: number;
  times?: number[];
  size?: '720p' | '1080p';
  at_seconds?: number;
  box?: number[];
  box_units?: 'screen_text' | 'fraction';
}

export interface LookRecording {
  title: string;
  duration: number;
  width: number;
  height: number;
  /** Keyframe times in recording seconds, ascending. */
  keys: readonly number[];
  /** Every frame's time in recording seconds, ascending; may be empty. */
  frameTimes: readonly number[];
  /** Size of the frames get_screen_text boxes refer to, when its text has been read. */
  screenTextFrame?: { width: number; height: number };
}

export interface PlannedImage {
  /** Which moment of the call (0-based) asked for it. */
  moment: number;
  kind: 'tile' | 'frame' | 'crop';
  /** Tile number in its strip (1-based) and the strip's tile count. */
  tile?: { index: number; of: number };
  /** The time asked for, and the time decoded: a keyframe for most tiles, else a frame. */
  requested: number;
  at: number;
  /** Decode the keyframe at `at` only (fast), rather than an exact frame. */
  keyframe: boolean;
  /** Output size in pixels. */
  width: number;
  height: number;
  size?: FrameSize;
  /** Region of the source frame, in source pixels, for crops. */
  crop?: { x: number; y: number; width: number; height: number };
  /** Crop shrunk to fit a cap. */
  scaled?: boolean;
  tokens: number;
}

export interface LookPlan {
  images: PlannedImage[];
  notes: string[];
}

export function imageTokens(width: number, height: number) {
  return Math.ceil(width / CELL) * Math.ceil(height / CELL);
}

/** The largest size of a source inside a box, keeping its shape and never enlarging it. */
export function fitInside(width: number, height: number, boxWidth: number, boxHeight: number) {
  const scale = Math.min(boxWidth / width, boxHeight / height, 1);
  return {
    width: Math.max(1, Math.floor(width * scale + 1e-6)),
    height: Math.max(1, Math.floor(height * scale + 1e-6)),
  };
}

function frameSize(r: LookRecording, size: FrameSize) {
  const [w, h] = FRAME_SIZES[size];
  return fitInside(r.width, r.height, w * CELL, h * CELL);
}

/** Index of the value nearest `at` in an ascending list. */
function nearestIndex(values: readonly number[], at: number) {
  let lo = 0,
    hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid] < at) lo = mid + 1;
    else hi = mid;
  }
  const before = Math.max(0, lo - 1),
    after = Math.min(values.length - 1, lo);
  return at - values[before] <= values[after] - at ? before : after;
}
/** The recording's frame nearest a time (the time itself when no frame index exists). */
export function onFrame(times: readonly number[], at: number) {
  return times.length ? times[nearestIndex(times, at)] : at;
}

/** m:ss.s, or h:mm:ss.s from an hour on. */
export function clock(seconds: number) {
  const tenths = Math.max(0, Math.round(seconds * 10));
  const s = Math.floor(tenths / 10),
    h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    rest = `${String(s % 60).padStart(2, '0')}.${tenths % 10}`;
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

const inside = (r: LookRecording, t: unknown, what: string) => {
  if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > r.duration)
    throw new LookError(`${what} must be a time in seconds from 0 to ${r.duration.toFixed(3)}.`);
  return t;
};

/**
 * A crop's region in source pixels. Screen text boxes are padded by half the text height (at
 * least 1% of the frame), then the region grows to whole 28 px cells where the frame allows,
 * which shows a little more around it at no extra cost.
 */
export function cropRegion(r: LookRecording, moment: LookMoment, n: number) {
  const box = moment.box;
  const where = `Moment ${n + 1}`;
  if (!Array.isArray(box) || box.length !== 4 || box.some((v) => !Number.isFinite(v)))
    throw new LookError(`${where}: give box as [x0, y0, x1, y1].`);
  let [x0, y0, x1, y1] = box;
  if (!(x1 > x0 && y1 > y0)) throw new LookError(`${where}: box needs x1 > x0 and y1 > y0.`);
  let sx: number, sy: number;
  if (moment.box_units === 'fraction') {
    if (box.some((v) => v < 0 || v > 1))
      throw new LookError(`${where}: a fraction box uses values from 0 to 1.`);
    sx = r.width;
    sy = r.height;
  } else if (moment.box_units === 'screen_text') {
    const frame = r.screenTextFrame;
    if (!frame)
      throw new LookError(
        `${where}: this recording's screen text has not been read, so give a fraction box ` +
          '(box_units "fraction").',
      );
    const pad = Math.max((y1 - y0) / 2, frame.height / 100);
    x0 = Math.max(0, x0 - pad);
    y0 = Math.max(0, y0 - pad);
    x1 = Math.min(frame.width, x1 + pad);
    y1 = Math.min(frame.height, y1 + pad);
    if (!(x1 > x0 && y1 > y0))
      throw new LookError(
        `${where}: that box is outside the ${frame.width}x${frame.height} frame.`,
      );
    sx = r.width / frame.width;
    sy = r.height / frame.height;
  } else throw new LookError(`${where}: say box_units, "screen_text" or "fraction".`);
  const grow = (from: number, to: number, limit: number) => {
    const length = Math.min(limit, Math.max(CELL, Math.ceil((to - from) / CELL) * CELL));
    const start = Math.min(limit - length, Math.max(0, Math.round((from + to - length) / 2)));
    return [start, length];
  };
  const [x, width] = grow(Math.floor(x0 * sx), Math.ceil(x1 * sx), r.width);
  const [y, height] = grow(Math.floor(y0 * sy), Math.ceil(y1 * sy), r.height);
  return { x, y, width, height };
}

function cropOutput(region: { width: number; height: number }, scale = 1) {
  const box = Math.min(scale, LOOK_CAPS.side / Math.max(region.width, region.height));
  return fitInside(region.width, region.height, region.width * box, region.height * box);
}

/** Times of a strip's tiles: the middle of each equal part of the range. */
export function tileTimes(start: number, end: number, count: number) {
  const step = (end - start) / count;
  return Array.from({ length: count }, (_, i) => start + (i + 0.5) * step);
}

function tileImages(
  r: LookRecording,
  moment: number,
  strip: { start: number; end: number; count: number },
): PlannedImage[] {
  const size = fitInside(r.width, r.height, TILE.width, TILE.height);
  const spacing = (strip.end - strip.start) / strip.count;
  const reach = Math.min(spacing / 2, KEYFRAME_REACH);
  return tileTimes(strip.start, strip.end, strip.count).map((t, i) => {
    const key = r.keys.length ? r.keys[nearestIndex(r.keys, t)] : NaN;
    const keyframe = Math.abs(key - t) <= reach;
    return {
      moment,
      kind: 'tile' as const,
      tile: { index: i + 1, of: strip.count },
      requested: t,
      at: keyframe ? key : onFrame(r.frameTimes, t),
      keyframe,
      ...size,
      tokens: imageTokens(size.width, size.height),
    };
  });
}

/**
 * One call's pictures, in the order asked, fitted to the caps: at most 2 frames at 1080p and 6
 * at 720p (the rest step down a size), at most 16 pictures (strips give up tiles first, down to
 * 2 each, then the last pictures are left out), and about 8,000 image tokens (the largest
 * frame or crop steps down until it fits). Every fitting is described in a note.
 */
export function planLook(r: LookRecording, moments: readonly LookMoment[]): LookPlan {
  if (!Array.isArray(moments) || moments.length < 1)
    throw new LookError('Give at least one moment to look at.');
  if (moments.length > LOOK_CAPS.moments)
    throw new LookError(`Give at most ${LOOK_CAPS.moments} moments in one call.`);
  if (!(r.width > 0 && r.height > 0))
    throw new LookError('The size of this recording is unknown, so it cannot be shown.');
  const notes: string[] = [];
  type Slot =
    | { kind: 'strip'; moment: number; start: number; end: number; count: number }
    | { kind: 'frame'; moment: number; t: number; size: FrameSize }
    | {
        kind: 'crop';
        moment: number;
        t: number;
        region: { x: number; y: number; width: number; height: number };
      };
  const slots: Slot[] = [];
  moments.forEach((m, n) => {
    const where = `Moment ${n + 1}`;
    if (m.kind === 'strip') {
      const start = inside(r, m.start_seconds ?? 0, `${where}: start_seconds`);
      const end = Math.min(r.duration, m.end_seconds ?? r.duration);
      if (!(end > start)) throw new LookError(`${where}: end_seconds must be after start_seconds.`);
      const count = m.tiles ?? TILE.most;
      if (!Number.isInteger(count) || count < TILE.least || count > TILE.most)
        throw new LookError(`${where}: tiles is a whole number from 2 to 16.`);
      slots.push({ kind: 'strip', moment: n, start, end, count });
    } else if (m.kind === 'frames') {
      if (!Array.isArray(m.times) || !m.times.length)
        throw new LookError(`${where}: give times, the seconds of each frame.`);
      const size = m.size ?? '720p';
      if (size !== '720p' && size !== '1080p')
        throw new LookError(`${where}: size is "720p" or "1080p".`);
      for (const t of m.times)
        slots.push({ kind: 'frame', moment: n, t: inside(r, t, `${where}: times`), size });
    } else if (m.kind === 'crop') {
      const t = inside(r, m.at_seconds, `${where}: at_seconds`);
      slots.push({ kind: 'crop', moment: n, t, region: cropRegion(r, m, n) });
    } else throw new LookError(`${where}: kind is "strip", "frames" or "crop".`);
  });

  // Frames over a size's per-call count step down a size.
  for (const size of ladder) {
    const most = FRAMES_PER_CALL[size];
    const of = slots.filter(
      (s): s is Extract<Slot, { kind: 'frame' }> => s.kind === 'frame' && s.size === size,
    );
    if (most === undefined || of.length <= most) continue;
    const lower = ladder[ladder.indexOf(size) + 1];
    for (const s of of.slice(most)) s.size = lower;
    notes.push(
      `${of.length} frames at ${size} asked; ${most} a call are sent at ${size}, the rest at ${lower}.`,
    );
  }

  // At most 16 pictures: strips give up tiles first, then the last pictures are left out.
  const count = () => slots.reduce((n, s) => n + (s.kind === 'strip' ? s.count : 1), 0);
  const asked = count();
  const strips = slots.filter((s): s is Extract<Slot, { kind: 'strip' }> => s.kind === 'strip');
  const tilesAsked = strips.map((s) => s.count);
  while (count() > LOOK_CAPS.images) {
    const most = strips.reduce<(typeof strips)[number] | undefined>(
      (best, s) => (s.count > TILE.least && (!best || s.count > best.count) ? s : best),
      undefined,
    );
    if (!most) break;
    most.count--;
  }
  strips.forEach((s, i) => {
    if (s.count !== tilesAsked[i])
      notes.push(
        `Strip of moment ${s.moment + 1} fitted to ${s.count} tiles (${tilesAsked[i]} asked), ` +
          `${LOOK_CAPS.images} pictures a call.`,
      );
  });
  const left: string[] = [];
  while (count() > LOOK_CAPS.images) {
    let last = slots.length - 1;
    while (last >= 0 && slots[last].kind === 'strip') last--;
    if (last < 0) break;
    const [s] = slots.splice(last, 1) as Exclude<Slot, { kind: 'strip' }>[];
    left.unshift(`${s.kind} at ${clock(s.t)} (moment ${s.moment + 1})`);
  }
  if (left.length)
    notes.push(
      `${asked} pictures asked; ${LOOK_CAPS.images} a call. Left out, ask again for them: ${left.join(', ')}.`,
    );

  const images: PlannedImage[] = slots.flatMap((s): PlannedImage[] => {
    if (s.kind === 'strip') return tileImages(r, s.moment, s);
    if (s.kind === 'frame') {
      const size = frameSize(r, s.size);
      return [
        {
          moment: s.moment,
          kind: 'frame',
          requested: s.t,
          at: onFrame(r.frameTimes, s.t),
          keyframe: false,
          ...size,
          size: s.size,
          tokens: imageTokens(size.width, size.height),
        },
      ];
    }
    const out = cropOutput(s.region);
    return [
      {
        moment: s.moment,
        kind: 'crop',
        requested: s.t,
        at: onFrame(r.frameTimes, s.t),
        keyframe: false,
        ...out,
        crop: s.region,
        scaled: out.width < s.region.width,
        tokens: imageTokens(out.width, out.height),
      },
    ];
  });
  if (images.some((i) => i.kind === 'crop' && i.scaled))
    notes.push(`Crops larger than ${LOOK_CAPS.side} px on a side are scaled down to fit.`);

  // About 8,000 image tokens: the largest frame or crop steps down until the call fits.
  const total = () => images.reduce((n, i) => n + i.tokens, 0);
  const tokensAsked = total();
  const shrunk = new Set<PlannedImage>();
  while (total() > LOOK_CAPS.tokens) {
    let pick: PlannedImage | undefined;
    for (const i of images)
      if (
        (i.kind === 'frame' && i.size !== '360p') ||
        (i.kind === 'crop' && Math.max(i.width, i.height) > SMALLEST_CROP)
      )
        if (!pick || i.tokens >= pick.tokens) pick = i;
    if (!pick) break;
    if (pick.kind === 'frame') {
      pick.size = ladder[ladder.indexOf(pick.size!) + 1];
      Object.assign(pick, frameSize(r, pick.size));
    } else {
      const smaller = Math.max(SMALLEST_CROP / Math.max(pick.width, pick.height), 0.75);
      Object.assign(
        pick,
        fitInside(pick.width, pick.height, pick.width * smaller, pick.height * smaller),
      );
      pick.scaled = true;
    }
    pick.tokens = imageTokens(pick.width, pick.height);
    shrunk.add(pick);
  }
  if (shrunk.size)
    notes.push(
      `About ${tokensAsked.toLocaleString('en-US')} image tokens asked; about ` +
        `${LOOK_CAPS.tokens.toLocaleString('en-US')} a call, so ` +
        [...shrunk]
          .map((i) =>
            i.kind === 'frame'
              ? `the frame at ${clock(i.requested)} is sent at ${i.size}`
              : `the crop at ${clock(i.requested)} is sent at ${i.width}x${i.height}`,
          )
          .join(', ') +
        '.',
    );
  return { images, notes };
}

/**
 * A small picture hash for dropping near-duplicates: the mean grey of each of 64 x 36 cells of
 * a BGRA picture.
 */
export const HASH = { across: 64, down: 36 } as const;
export function pictureHash(bgra: Uint8Array, width: number, height: number) {
  const out = new Uint8Array(HASH.across * HASH.down);
  const sums = new Float64Array(out.length),
    counts = new Uint32Array(out.length);
  for (let y = 0; y < height; y++) {
    const row = Math.min(HASH.down - 1, Math.floor((y * HASH.down) / height)) * HASH.across;
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      const cell = row + Math.min(HASH.across - 1, Math.floor((x * HASH.across) / width));
      sums[cell] += 0.114 * bgra[p] + 0.587 * bgra[p + 1] + 0.299 * bgra[p + 2];
      counts[cell]++;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = counts[i] ? Math.round(sums[i] / counts[i]) : 0;
  return out;
}
/**
 * Near-duplicates differ by at most 1.5 grey levels on average and 12 in any cell, so a
 * changed subtitle or name plate keeps its picture.
 */
export function nearDuplicate(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > 12) return false;
    sum += d;
  }
  return sum / a.length <= 1.5;
}

// 5 x 7 glyphs for burned-in times, one row per string, '#' lit.
const GLYPHS: Record<string, string[]> = {
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ':': ['.....', '..#..', '..#..', '.....', '..#..', '..#..', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
};
/**
 * Burns a time into the bottom-left corner of a BGRA picture: white figures at twice the glyph
 * size on a dark box.
 */
export function burnTime(bgra: Uint8Array, width: number, height: number, text: string) {
  const scale = 2,
    pad = 3,
    advance = 6 * scale;
  const boxWidth = Math.min(width, text.length * advance - scale + 2 * pad),
    boxHeight = Math.min(height, 7 * scale + 2 * pad);
  const top = height - boxHeight;
  for (let y = top; y < height; y++)
    for (let x = 0; x < boxWidth; x++) {
      const p = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) bgra[p + c] = Math.round(bgra[p + c] * 0.25);
    }
  [...text].forEach((ch, i) => {
    const glyph = GLYPHS[ch];
    if (!glyph) return;
    for (let gy = 0; gy < 7; gy++)
      for (let gx = 0; gx < 5; gx++) {
        if (glyph[gy][gx] !== '#') continue;
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) {
            const x = pad + i * advance + gx * scale + dx,
              y = top + pad + gy * scale + dy;
            if (x >= width || y >= height) continue;
            const p = (y * width + x) * 4;
            bgra[p] = bgra[p + 1] = bgra[p + 2] = 255;
          }
      }
  });
}
