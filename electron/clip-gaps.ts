// Gaps inside a clip (VC-212, decision 0028): spans cut out of the middle of a clip that still
// exports as one file. Pure helpers shared by the Cut page, the export plan and the companion.
import type { Clip, ClipGap } from './workflow-types.js';

/** A gap shorter than this is a mis-press and is not made. */
export const MIN_GAP = 0.1;
/** A gap reaching this close to the clip's start or end trims the clip instead. */
export const EDGE_SNAP = 0.05;
const EPS = 0.000001;

/** Index of the first key at or after `t` (keys sorted ascending). */
function atOrAfter(keys: readonly number[], t: number) {
  let lo = 0,
    hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (keys[mid] < t - EPS) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
export function keyAtOrAfter(keys: readonly number[], t: number) {
  return keys[atOrAfter(keys, t)];
}
export function keyAtOrBefore(keys: readonly number[], t: number): number | undefined {
  const i = atOrAfter(keys, t);
  if (i < keys.length && Math.abs(keys[i] - t) <= EPS) return keys[i];
  return i > 0 ? keys[i - 1] : undefined;
}

export interface GapJoin {
  gap: ClipGap;
  /** 1-based, in time order: "Gap 1". */
  number: number;
  /** The piece before the gap ends here: the keyframe at or after the gap's start. */
  out: number;
  /** The piece after the gap starts here: the keyframe at or before the gap's end. */
  back: number;
  /** Seconds the export leaves out; 0 for a gap too short to remove anything. */
  removed: number;
  /** No whole keyframe interval inside: the gap removes nothing until it is widened. */
  short: boolean;
}

export function sortedGaps(clip: Pick<Clip, 'gaps'>): ClipGap[] {
  return [...(clip.gaps || [])].sort((a, b) => a.start - b.start);
}

/**
 * Where each gap's joins land. Video is copied, so the piece before a gap ends on a keyframe and
 * the piece after starts on one: each end of a gap keeps up to one keyframe interval. Without a
 * keyframe index (still indexing) the gap is taken as marked.
 */
export function gapJoins(clip: Pick<Clip, 'gaps'>, keys: readonly number[] = []): GapJoin[] {
  return sortedGaps(clip).map((gap, i) => {
    const out = keys.length ? (keyAtOrAfter(keys, gap.start) ?? Infinity) : gap.start;
    const back = keys.length ? (keyAtOrBefore(keys, gap.end) ?? -Infinity) : gap.end;
    const short = !(back > out + EPS);
    return { gap, number: i + 1, out, back, removed: short ? 0 : back - out, short };
  });
}

export interface Piece {
  start: number;
  end: number;
}
/**
 * The source spans a clip exports, in order. The outer bounds are the clip's outward keyframes
 * (as every export plans them); each gap that removes something splits the range at its joins.
 */
export function clipPieces(
  clip: Pick<Clip, 'start' | 'end' | 'gaps'>,
  keys: readonly number[] = [],
  duration = Infinity,
  outer?: Piece,
): Piece[] {
  const start =
    outer?.start ?? (keys.length ? (keyAtOrBefore(keys, clip.start) ?? clip.start) : clip.start);
  const end =
    outer?.end ??
    (keys.length ? (keyAtOrAfter(keys, clip.end) ?? Math.min(duration, clip.end)) : clip.end);
  const pieces: Piece[] = [];
  let from = start;
  for (const j of gapJoins(clip, keys)) {
    if (j.short) continue;
    pieces.push({ start: from, end: j.out });
    from = j.back;
  }
  pieces.push({ start: from, end });
  return pieces.filter((p) => p.end > p.start + EPS);
}
export const piecesLength = (pieces: readonly Piece[]) =>
  pieces.reduce((n, p) => n + (p.end - p.start), 0);
/** A source time on the exported clip's clock, or null when the time is left out. */
export function toPieceTime(pieces: readonly Piece[], t: number): number | null {
  let at = 0;
  for (const p of pieces) {
    if (t >= p.start - EPS && t < p.end - EPS) return at + Math.max(0, t - p.start);
    at += p.end - p.start;
  }
  return null;
}

export type GapOutcome =
  'added' | 'merged' | 'trimmed-start' | 'trimmed-end' | 'too-short' | 'whole' | 'outside';
/**
 * Adds a gap from `a` to `b` (either order). A gap touching the clip's start or end trims the
 * clip instead; overlapping or touching gaps merge into one.
 */
export function withGap(
  clip: Clip,
  a: number,
  b: number,
  id: string,
): { clip: Clip; outcome: GapOutcome; gap?: ClipGap } {
  let start = Math.max(clip.start, Math.min(a, b)),
    end = Math.min(clip.end, Math.max(a, b));
  if (Math.max(a, b) <= clip.start || Math.min(a, b) >= clip.end)
    return { clip, outcome: 'outside' };
  if (end - start < MIN_GAP) return { clip, outcome: 'too-short' };
  const atStart = start <= clip.start + EDGE_SNAP,
    atEnd = end >= clip.end - EDGE_SNAP;
  if (atStart && atEnd) return { clip, outcome: 'whole' };
  let gaps = sortedGaps(clip);
  if (atStart || atEnd) {
    // Trimming past a gap swallows it; a gap the new edge lands in moves the edge past it.
    let edge = atStart ? end : start;
    for (const g of atStart ? gaps : [...gaps].reverse())
      if (atStart ? g.start < edge + EDGE_SNAP : g.end > edge - EDGE_SNAP)
        edge = atStart ? Math.max(edge, g.end) : Math.min(edge, g.start);
    gaps = gaps.filter((g) => (atStart ? g.start >= edge + EDGE_SNAP : g.end <= edge - EDGE_SNAP));
    const next: Clip = { ...clip, ...(atStart ? { start: edge } : { end: edge }), gaps };
    if (!gaps.length) delete next.gaps;
    return { clip: next, outcome: atStart ? 'trimmed-start' : 'trimmed-end' };
  }
  let merged = false;
  gaps = gaps.filter((g) => {
    if (g.end < start || g.start > end) return true;
    start = Math.min(start, g.start);
    end = Math.max(end, g.end);
    merged = true;
    return false;
  });
  const gap = { id, start, end };
  return {
    clip: { ...clip, gaps: [...gaps, gap].sort((x, y) => x.start - y.start) },
    outcome: merged ? 'merged' : 'added',
    gap,
  };
}
export function withoutGap(clip: Clip, id: string): Clip {
  const gaps = (clip.gaps || []).filter((g) => g.id !== id);
  const next: Clip = { ...clip, gaps };
  if (!gaps.length) delete next.gaps;
  return next;
}
/**
 * Moves one edge of a gap, or the whole gap ('move', by `delta`), kept inside the clip, clear of
 * its edges and of the gaps either side.
 */
export function adjustGap(
  clip: Clip,
  id: string,
  edge: 'start' | 'end' | 'move',
  value: number,
): Clip {
  const gaps = sortedGaps(clip),
    i = gaps.findIndex((g) => g.id === id);
  if (i < 0) return clip;
  const g = gaps[i],
    lo = (gaps[i - 1]?.end ?? clip.start + EDGE_SNAP) + EPS * 10,
    hi = (gaps[i + 1]?.start ?? clip.end - EDGE_SNAP) - EPS * 10;
  let { start, end } = g;
  if (edge === 'start') start = Math.max(lo, Math.min(end - MIN_GAP, value));
  else if (edge === 'end') end = Math.min(hi, Math.max(start + MIN_GAP, value));
  else {
    const length = end - start;
    start = Math.max(lo, Math.min(hi - length, value));
    end = start + length;
  }
  return { ...clip, gaps: gaps.map((x) => (x.id === id ? { ...x, start, end } : x)) };
}
/**
 * Splits a clip at `t`. Inside a gap, the two clips meet the gap's edges and the gap becomes the
 * space between them. Each clip keeps its own gaps. Null when `t` is too close to an edge.
 */
export function splitWithGaps(clip: Clip, t: number, min = 0.02): [Clip, Clip] | null {
  const gaps = sortedGaps(clip),
    inside = gaps.find((g) => t >= g.start && t < g.end);
  const firstEnd = inside ? inside.start : t,
    secondStart = inside ? inside.end : t;
  if (firstEnd - clip.start < min || clip.end - secondStart < min) return null;
  const first: Clip = { ...clip, end: firstEnd, gaps: gaps.filter((g) => g.end <= firstEnd) },
    second: Clip = {
      ...clip,
      start: secondStart,
      gaps: gaps.filter((g) => g.start >= secondStart),
    };
  for (const c of [first, second]) if (!c.gaps?.length) delete c.gaps;
  return [first, second];
}
/** The gap under a source time, if any. */
export function gapAt(clip: Pick<Clip, 'gaps'>, t: number) {
  return (clip.gaps || []).find((g) => t >= g.start && t < g.end);
}
