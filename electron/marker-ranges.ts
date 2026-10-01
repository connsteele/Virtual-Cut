import type { Marker } from './workflow-types.js';

export function markerIntersects(m: Marker, start: number, end: number) {
  return m.end != null ? m.time < end && m.end > start : m.time >= start - 0.000001 && m.time < end;
}

/** Intersect a range with retained footage, then express it in output-relative time. */
export function relativeMarker(m: Marker, start: number, end: number): Marker {
  return {
    ...m,
    time: Math.max(0, m.time - start),
    ...(m.end != null ? { end: Math.min(end, m.end) - start } : {}),
  };
}
