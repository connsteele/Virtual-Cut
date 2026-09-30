/** One seek in flight. The wall clock determines scan speed; decoder work never
 * accumulates behind a rapid interval or prevents the user from stopping. */
export function startScan({
  video,
  direction,
  rate,
  offset,
  keys,
  range,
  onPosition,
  onEnd,
}: {
  video: HTMLVideoElement;
  direction: 1 | -1;
  rate: number;
  offset: number;
  keys: number[];
  range: () => { start: number; end: number; looping: boolean };
  onPosition: (position: number) => void;
  onEnd: () => void;
}) {
  video.pause();
  let origin = video.currentTime - offset,
    started = performance.now(),
    cancelled = false;
  let ended = false;
  const tick = () => {
    if (cancelled || video.seeking || video.readyState < 2) return;
    if (ended) {
      onEnd();
      return;
    }
    const { start, end, looping } = range();
    const span = end - start;
    if (!(span > 0)) {
      onEnd();
      return;
    }
    let target = origin + (direction * rate * (performance.now() - started)) / 1000;
    let wrapped = false;
    if (target < start || target >= end) {
      if (looping) {
        wrapped = true;
        target = start + ((((target - start) % span) + span) % span);
        origin = target;
        started = performance.now();
      } else {
        target = direction > 0 ? end - 0.001 : start;
        ended = true;
      }
    }
    // Fast scans decode nearby random-access frames. At normal reverse speeds,
    // retain frame-level movement so a long GOP does not freeze the preview.
    if (!ended && rate >= 4 && keys.length) {
      let lo = 0,
        hi = keys.length;
      while (lo < hi) {
        const m = (lo + hi) >>> 1;
        if (keys[m] < target) lo = m + 1;
        else hi = m;
      }
      const left = keys[Math.max(0, lo - 1)],
        right = keys[Math.min(lo, keys.length - 1)];
      const key = Math.abs(left - target) <= Math.abs(right - target) ? left : right;
      if (key >= start && key < end && Math.abs(key - target) <= Math.max(1, rate / 12)) {
        if (!wrapped && direction * (key - (video.currentTime - offset)) < 0) return;
        target = key;
      }
    }
    target = Math.max(start, Math.min(end - 0.001, target));
    if (Math.abs(video.currentTime - offset - target) < 0.001) return;
    video.currentTime = target + offset;
    onPosition(target);
  };
  const timer = setInterval(tick, 83);
  return {
    direction,
    rate,
    cancel() {
      cancelled = true;
      clearInterval(timer);
    },
  };
}
