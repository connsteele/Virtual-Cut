import type { Marker, Recording } from './model';

export function markerTime(recording: Recording, value: number, step = 0) {
  const frame = 1 / (recording.fps || 30);
  let snapped = Math.round(value / frame) * frame;
  const frames = recording.frameTimes;
  if (frames?.length) {
    const target = value + (step ? Math.sign(step) * 0.000001 : 0);
    let lo = 0,
      hi = frames.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (frames[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const left = frames[Math.max(0, lo - 1)],
      right = frames[Math.min(lo, frames.length - 1)];
    snapped = step
      ? step > 0
        ? right
        : left
      : Math.abs(right - target) < Math.abs(left - target)
        ? right
        : left;
  } else if (step) snapped += Math.sign(step) * frame;
  return Math.max(0, Math.min(Math.max(0, recording.duration - frame), snapped));
}

export function adjustMarker(
  recording: Recording,
  marker: Marker,
  edge: 'move' | 'start' | 'end' | 'extend',
  value: number,
) {
  const frame = Math.min(recording.duration, 1 / (recording.fps || 30));
  const boundary = value >= recording.duration ? recording.duration : markerTime(recording, value);
  if (edge === 'extend') {
    const time = Math.min(marker.time, boundary, Math.max(0, recording.duration - frame));
    return {
      time,
      end: Math.min(recording.duration, Math.max(marker.time, boundary, time + frame)),
    };
  }
  if (edge === 'end')
    return {
      time: marker.time,
      end: Math.min(recording.duration, Math.max(marker.time + frame, boundary)),
    };
  if (edge === 'start' && marker.end != null)
    return {
      time: Math.max(0, Math.min(marker.end - Math.min(frame, marker.end), boundary)),
      end: marker.end,
    };
  const duration = marker.end == null ? 0 : marker.end - marker.time;
  const time = Math.max(0, Math.min(recording.duration - (duration || frame), boundary));
  return { time, ...(marker.end != null ? { end: time + duration } : {}) };
}

/** Pixel padding keeps split endpoints and point markers independently clickable. */
export function layoutMarkers(markers: Marker[], start: number, end: number, width: number) {
  const padding = (24 / (width > 0 ? width : 600)) * (end - start);
  const lanes: number[] = [];
  const items = markers
    .filter((m) => m.time < end && (m.end ?? m.time) >= start)
    .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))
    .map((marker) => {
      const left = Math.max(start, marker.time);
      const right = Math.min(end, marker.end ?? marker.time);
      let lane = lanes.findIndex((until) => until + padding <= left);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = right;
      return { marker, lane };
    });
  return { items, lanes: Math.max(1, lanes.length) };
}
