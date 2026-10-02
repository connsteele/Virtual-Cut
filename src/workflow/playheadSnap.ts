/** Magnetic distance is measured in screen pixels, independent of timeline zoom. */
export function playheadSnap(value: number, target: number | null, span: number, width: number) {
  return target != null && width > 0 && span > 0 && (Math.abs(value - target) * width) / span <= 10
    ? target
    : value;
}

/** Nearest visible annotation boundary; ties choose the earlier time consistently. */
export function scrubSnap(
  value: number,
  targets: number[],
  start: number,
  end: number,
  width: number,
): number | null {
  if (!(width > 0) || !(end > start)) return null;
  const radius = (10 * (end - start)) / width;
  let nearest: number | null = null;
  let distance = radius;
  for (const target of targets) {
    if (!Number.isFinite(target) || target < start || target > end) continue;
    const delta = Math.abs(target - value);
    if (delta <= distance && (delta < distance || nearest == null || target < nearest)) {
      nearest = target;
      distance = delta;
    }
  }
  return nearest;
}

/** Freeze these at pointer-down; an annotation never attracts its own dragged edges. */
export function editTargets(
  playhead: number,
  markers: { id: string; time: number; end?: number }[],
  clips: { id: string; start: number; end: number }[],
  exclude: { marker?: string; clip?: string },
) {
  return [
    ...new Set([
      playhead,
      ...markers
        .filter((m) => m.id !== exclude.marker)
        .flatMap((m) => (m.end == null ? [m.time] : [m.time, m.end])),
      ...clips.filter((c) => c.id !== exclude.clip).flatMap((c) => [c.start, c.end]),
    ]),
  ];
}

/** Compare both ends of a moving range, retaining its duration and rejecting invalid alignments. */
export function editSnap(
  value: number,
  offsets: number[],
  targets: number[],
  start: number,
  end: number,
  width: number,
  valid: (value: number, offset: number, target: number) => boolean,
) {
  if (!(width > 0) || !(end > start)) return null;
  const radius = (10 * (end - start)) / width;
  const candidates = offsets
    .flatMap((offset) =>
      targets
        .filter(
          (target) =>
            Number.isFinite(target) &&
            target >= start &&
            target <= end &&
            Math.abs(value + offset - target) <= radius,
        )
        .map((target) => ({
          value: target - offset,
          target,
          offset,
          distance: Math.abs(value + offset - target),
        })),
    )
    .sort((a, b) => a.distance - b.distance || a.target - b.target || a.offset - b.offset);
  return candidates.find((c) => valid(c.value, c.offset, c.target)) ?? null;
}
