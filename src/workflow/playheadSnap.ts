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
