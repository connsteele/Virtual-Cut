import { useEffect, useState, type RefObject } from 'react';
import s from './Workflow.module.css';

type Counts = { total: number; dropped: number; fps: number | null; measured: boolean };
const empty: Counts = { total: 0, dropped: 0, fps: null, measured: false };

export function PlaybackMetrics({
  video,
  scanning,
}: {
  video: RefObject<HTMLVideoElement | null>;
  scanning: boolean;
}) {
  const [counts, setCounts] = useState(empty);
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let baseline: { time: number; total: number; dropped: number } | null = null;
    const read = () => {
      if (typeof v.getVideoPlaybackQuality !== 'function') return null;
      const q = v.getVideoPlaybackQuality();
      return Number.isFinite(q.totalVideoFrames) && Number.isFinite(q.droppedVideoFrames)
        ? { time: performance.now(), total: q.totalVideoFrames, dropped: q.droppedVideoFrames }
        : null;
    };
    const eligible = () => !v.paused && !v.seeking && v.playbackRate === 1 && v.readyState >= 3;
    const restart = () => {
      baseline = eligible() ? read() : null;
    };
    const suspend = () => {
      baseline = null;
      setCounts((old) => (old.fps === null ? old : { ...old, fps: null }));
    };
    const reset = () => {
      baseline = null;
      setCounts(empty);
    };
    setAvailable(read() !== null);
    const timer = setInterval(() => {
      const now = read();
      setAvailable(now !== null);
      if (!now || !eligible()) {
        suspend();
        return;
      }
      const before = baseline;
      baseline = now;
      if (!before || now.total < before.total || now.dropped < before.dropped) return;
      const total = now.total - before.total;
      const dropped = Math.min(total, now.dropped - before.dropped);
      const seconds = (now.time - before.time) / 1000;
      if (seconds <= 0) return;
      setCounts((old) => ({
        total: old.total + total,
        dropped: old.dropped + dropped,
        fps: (total - dropped) / seconds,
        measured: true,
      }));
    }, 500);
    const pauses = ['pause', 'seeking', 'waiting', 'ratechange'] as const;
    const resumes = ['playing', 'seeked'] as const;
    pauses.forEach((event) => v.addEventListener(event, suspend));
    resumes.forEach((event) => v.addEventListener(event, restart));
    v.addEventListener('emptied', reset);
    restart();
    return () => {
      clearInterval(timer);
      pauses.forEach((event) => v.removeEventListener(event, suspend));
      resumes.forEach((event) => v.removeEventListener(event, restart));
      v.removeEventListener('emptied', reset);
    };
  }, [video]);
  return (
    <span
      className={s.playbackMetrics}
      aria-label="Playback metrics"
      data-dropped={counts.measured ? counts.dropped : ''}
      data-total={counts.measured ? counts.total : ''}
      title="Browser-reported frames during uninterrupted 1× playback. FPS covers the last half-second; dropped/total counts accumulate for this source. Pause freezes the counts. Seeks, loading and faster/reverse scanning are excluded. Resets on source change or reload; these are preview metrics, not export measurements."
    >
      {!available
        ? 'Playback metrics unavailable'
        : scanning
          ? 'Scan · metrics paused'
          : `Playback ${counts.fps === null ? '—' : counts.fps.toFixed(1)} fps · Dropped ${counts.measured ? `${counts.dropped} / ${counts.total}` : '—'}`}
    </span>
  );
}
