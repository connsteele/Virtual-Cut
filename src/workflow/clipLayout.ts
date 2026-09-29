import type { Clip } from './model';

// Clip identity colors are independent of marker categories and stay stable after edits.
const palette = ['#73cdc2', '#dfb578', '#9ab6ef', '#c5a1da', '#b9c97e', '#dc9eab'];
export function clipColor(id: string) {
  let hash = 0;
  for (const char of id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

export function layoutClips(clips: Clip[], start: number, end: number) {
  const visible = clips
    .map((clip, index) => ({
      clip,
      index,
      start: Math.max(start, clip.start),
      end: Math.min(end, clip.end),
    }))
    .filter((item) => item.end > item.start);
  const laneEnds: number[] = [];
  const items = [...visible]
    .sort((a, b) => a.start - b.start || a.index - b.index)
    .map((item) => {
      // Touching boundaries share a row; a genuine overlap always gets its own row.
      let lane = laneEnds.findIndex((until) => until <= item.start);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = item.end;
      return { ...item, lane };
    })
    .sort((a, b) => a.index - b.index);
  const changes = new Map<number, number>();
  for (const item of visible) {
    changes.set(item.start, (changes.get(item.start) || 0) + 1);
    changes.set(item.end, (changes.get(item.end) || 0) - 1);
  }
  const points = [...changes.keys()].sort((a, b) => a - b);
  const overlaps: { start: number; end: number; count: number }[] = [];
  let active = 0;
  for (let i = 0; i < points.length - 1; i++) {
    active += changes.get(points[i])!;
    if (active > 1) overlaps.push({ start: points[i], end: points[i + 1], count: active });
  }
  return { items, overlaps, lanes: Math.max(1, laneEnds.length) };
}
