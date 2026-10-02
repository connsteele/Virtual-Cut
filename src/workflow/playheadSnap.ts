/** Magnetic distance is measured in screen pixels, independent of timeline zoom. */
export function playheadSnap(value: number, target: number | null, span: number, width: number) {
  return target != null && width > 0 && span > 0 && (Math.abs(value - target) * width) / span <= 10
    ? target
    : value;
}
