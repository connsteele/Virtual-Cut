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

/** A range overlapping a clip by less than this, and mostly outside it, is a neighbour's stub. */
export const neighbourStub = 1;

/**
 * The markers a clip's outputs carry (VC-208). An outward keyframe cut pads a clip with footage
 * that belongs to its neighbours, so markers are chosen by the clip's own range, not the padding.
 * Ranges are clipped to that range; a range that overlaps it by under about a second and lies
 * mostly outside belongs to the neighbouring clip and is dropped. `atIn` marks a marker whose
 * own start is at the clip's in-point (within half a frame), which the companion places at
 * frame 0. A range cut at the in-point keeps its true position there, so it never lands on the
 * same frame as a marker that starts at the in-point (the Resolve helper refuses such a clip).
 */
export function clipMarkers(
  markers: Marker[],
  own: { start: number; end: number },
  frameDuration: number,
): { marker: Marker; start: number; end?: number; atIn: boolean }[] {
  const tolerance = frameDuration / 2;
  return markers.flatMap((marker) => {
    if (marker.end == null) {
      if (marker.time < own.start - tolerance || marker.time >= own.end) return [];
      const start = Math.max(marker.time, own.start);
      return [{ marker, start, atIn: Math.abs(marker.time - own.start) <= tolerance }];
    }
    const start = Math.max(marker.time, own.start),
      end = Math.min(marker.end, own.end),
      inside = end - start,
      outside = marker.end - marker.time - inside;
    if (inside <= 0 || (inside < neighbourStub && outside > inside)) return [];
    return [{ marker, start, end, atIn: Math.abs(marker.time - own.start) <= tolerance }];
  });
}
