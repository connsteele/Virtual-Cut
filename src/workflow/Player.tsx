import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import {
  Camera,
  ChevronsLeft,
  ChevronsRight,
  FastForward,
  Pause,
  Play,
  Rewind,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
  Volume2,
} from 'lucide-react';
import { time, type Recording, type Marker, type Clip } from './model';
import { Button, Modal } from './ui';
import { Timeline } from './Timeline';
import s from './Workflow.module.css';
export interface Transport {
  seek: (time: number) => void;
  command: (key: string) => void;
  current: () => number;
}
export function Player({
  recording: r,
  markers,
  clips,
  bounds,
  selectedId,
  showClips = true,
  legend = true,
  onLegend = () => {},
  onPosition,
  onDuration,
  onSelect,
  onFrame,
  onEnded,
  autoPlay = false,
  ref,
}: {
  recording: Recording;
  markers: Marker[];
  clips: Clip[];
  bounds?: { start: number; end: number };
  selectedId?: string;
  showClips?: boolean;
  legend?: boolean;
  onLegend?: () => void;
  onPosition?: (time: number) => void;
  onDuration?: (duration: number) => void;
  onSelect?: (id: string) => void;
  onFrame?: (url: string) => void;
  onEnded?: () => void;
  autoPlay?: boolean;
  ref?: Ref<Transport>;
}) {
  const video = useRef<HTMLVideoElement>(null),
    stage = useRef<HTMLDivElement>(null),
    reverse = useRef<ReturnType<typeof setInterval> | null>(null),
    speed = useRef(1);
  const [current, setCurrent] = useState(r.position),
    [duration, setDuration] = useState(r.duration),
    [status, setStatus] = useState('Paused'),
    [error, setError] = useState(''),
    [ready, setReady] = useState(false),
    [snapshot, setSnapshot] = useState(''),
    [fit, setFit] = useState<number>(),
    [volume, setVolume] = useState(0.7);
  const a = bounds?.start || 0,
    z = bounds?.end || duration;
  const callbacks = useRef({ onPosition, onDuration, onEnded });
  useEffect(() => {
    callbacks.current = { onPosition, onDuration, onEnded };
  }, [onPosition, onDuration, onEnded]);
  const stop = () => {
    if (reverse.current) clearInterval(reverse.current);
    reverse.current = null;
    video.current?.pause();
    setStatus('Paused');
  };
  const seek = (t: number) => {
    const v = video.current;
    if (!v || !Number.isFinite(z) || z <= 0) return;
    v.currentTime = Math.max(a, Math.min(z - 0.001, t));
    setCurrent(v.currentTime);
    callbacks.current.onPosition?.(v.currentTime);
  };
  const forward = (rate: number) => {
    const v = video.current;
    if (!v || !ready) return;
    if (reverse.current) clearInterval(reverse.current);
    reverse.current = null;
    if (v.currentTime >= z - 0.04) seek(a);
    speed.current = rate;
    v.playbackRate = rate;
    void v
      .play()
      .then(() => setStatus(`${rate}× forward`))
      .catch((e) => {
        if (e.name !== 'AbortError')
          setError('Playback could not start. Try opening this video again.');
      });
  };
  function command(key: string) {
    const v = video.current;
    if (!v || !ready) return;
    if (key === 'k') {
      stop();
      return;
    }
    if (key === 'l') {
      forward(!v.paused ? Math.min(4, speed.current * 2) : 1);
      return;
    }
    if (key === ' ') {
      if (!v.paused || reverse.current) stop();
      else forward(1);
      return;
    }
    if (key === 'j') {
      const rate = reverse.current ? Math.min(4, speed.current * 2) : 1;
      stop();
      speed.current = rate;
      setStatus(`${rate}× reverse scan`);
      reverse.current = setInterval(() => {
        if (v.currentTime <= a + 0.01) {
          stop();
          return;
        }
        seek(v.currentTime - rate / 12);
      }, 83);
      return;
    }
    stop();
    const boundaries = [...new Set([a, z, ...clips.flatMap((c) => [c.start, c.end])])]
      .filter((t) => t >= a && t <= z)
      .sort((x, y) => x - y);
    const epsilon = r.fps ? 0.5 / r.fps : 0.01;
    if (key === 'start')
      seek([...boundaries].reverse().find((t) => t < v.currentTime - epsilon) ?? a);
    if (key === 'end') seek(boundaries.find((t) => t > v.currentTime + epsilon) ?? z);
    if (key === 'frame-prev' && r.fps) seek(v.currentTime - 1 / r.fps);
    if (key === 'frame-next' && r.fps) seek(v.currentTime + 1 / r.fps);
    if (key === 'key-prev')
      seek([...(r.keys || [])].reverse().find((k) => k < v.currentTime - 0.04 && k >= a) ?? a);
    if (key === 'key-next')
      seek(r.keys?.find((k) => k > v.currentTime + 0.04 && k <= z) ?? z - 0.001);
  }
  useImperativeHandle(ref, () => ({
    seek,
    command,
    current: () => video.current?.currentTime || 0,
  }));
  useEffect(() => {
    const v = video.current!;
    return () => {
      if (reverse.current) clearInterval(reverse.current);
      v.pause();
    };
  }, []);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setFit((entry.contentRect.height * 16) / 9));
    if (stage.current) observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const pause = () => {
      if (document.hidden) {
        if (reverse.current) clearInterval(reverse.current);
        reverse.current = null;
        video.current?.pause();
        setStatus('Paused');
      }
    };
    document.addEventListener('visibilitychange', pause);
    return () => document.removeEventListener('visibilitychange', pause);
  }, []);
  function capture() {
    const v = video.current;
    if (!v || v.readyState < 2) return;
    try {
      const c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext('2d')!.drawImage(v, 0, 0);
      setSnapshot(c.toDataURL('image/png'));
      stop();
    } catch {
      setError('Frame capture is unavailable for this media source.');
    }
  }
  return (
    <section
      className={s.player}
      aria-label="Footage viewer"
      onKeyDown={(e) => {
        if (
          (e.target as HTMLElement).closest(
            'input:not([type=range]),textarea,select,[contenteditable=true]',
          ) ||
          e.ctrlKey ||
          e.metaKey ||
          e.altKey
        )
          return;
        if (
          ['j', 'k', 'l', ' '].includes(e.key.toLowerCase()) &&
          !(e.key === ' ' && (e.target as HTMLElement).closest('button'))
        ) {
          e.preventDefault();
          command(e.key.toLowerCase());
        }
      }}
    >
      <div className={s.viewerHeading}>
        <strong title={r.title}>{r.title}</strong>
        <span>
          {r.fullResolution
            ? `${r.width} × ${r.height} · ${r.codec?.toUpperCase()} · ${r.fps?.toFixed(2)} fps`
            : r.sample
              ? 'Sample footage'
              : 'Local video · session only'}
        </span>
      </div>
      <div ref={stage} className={s.stage} data-video-stage>
        <video
          crossOrigin="anonymous"
          ref={video}
          src={r.url}
          poster={r.pinned || r.poster || undefined}
          playsInline
          preload="metadata"
          muted={r.sample && !r.fullResolution}
          style={{ maxWidth: fit }}
          aria-label={`Video: ${r.title}`}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            const d = Number.isFinite(v.duration) ? v.duration : 0;
            setDuration(d);
            setReady(d > 0);
            v.volume = volume;
            v.currentTime = Math.max(a, Math.min((bounds?.end || d) - 0.001, r.position));
            callbacks.current.onDuration?.(d);
            if (autoPlay)
              void v
                .play()
                .then(() => setStatus('Sequence playback'))
                .catch(() => {});
          }}
          onError={() =>
            setError(
              r.sample
                ? 'Sample media is unavailable in this checkout. Use Open video to preview your own footage.'
                : 'Unable to play this file. Its codec may be unsupported, or the file may have changed.',
            )
          }
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            setCurrent(v.currentTime);
            callbacks.current.onPosition?.(v.currentTime);
            if (v.currentTime >= z - 0.045 && !v.paused) {
              v.pause();
              setStatus('Paused');
              callbacks.current.onEnded?.();
            }
          }}
          onEnded={() => {
            setStatus('Paused');
            callbacks.current.onEnded?.();
          }}
        />
      </div>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <Timeline
        recording={r}
        markers={markers}
        clips={clips}
        selectedId={selectedId}
        showClips={showClips}
        legend={legend}
        onLegend={onLegend}
        start={a}
        end={z}
        current={current}
        onSeek={(t) => {
          stop();
          seek(t);
        }}
        onSelect={onSelect}
      />
      <div className={s.playbackBar} role="group" aria-label="Playback controls">
        <div className={s.clock}>
          <span title="Elapsed time / duration" aria-label="Playback time">
            {time(current - a)} / {time(z - a)}
          </span>
          <span title="Time in the original source recording">Source {time(r.base + current)}</span>
        </div>
        <div className={s.transport}>
          <Button
            disabled={!ready}
            onClick={() => command('start')}
            aria-label="Previous clip boundary"
          >
            <SkipBack size={17} />
          </Button>
          <Button
            disabled={!ready || !r.keys?.length}
            onClick={() => command('key-prev')}
            aria-label="Previous keyframe"
            title={r.keys ? 'Previous keyframe' : 'Keyframe indexing comes later for local footage'}
          >
            <ChevronsLeft size={16} /> KF
          </Button>
          <Button
            disabled={!ready || !r.fps}
            onClick={() => command('frame-prev')}
            aria-label="Previous frame"
            title={r.fps ? 'Previous frame' : 'Source frame rate has not been probed'}
          >
            <StepBack size={17} />
          </Button>
          <Button disabled={!ready} onClick={() => command('j')} aria-label="Reverse · J">
            <Rewind size={17} />
          </Button>
          <Button disabled={!ready} onClick={() => command('k')} aria-label="Pause · K">
            <Pause size={17} />
          </Button>
          <Button
            disabled={!ready}
            primary
            onClick={() => forward(1)}
            aria-label="Play forward · L"
          >
            <Play size={18} />
          </Button>
          <Button disabled={!ready} onClick={() => command('l')} aria-label="Faster forward">
            <FastForward size={17} />
          </Button>
          <Button
            disabled={!ready || !r.fps}
            onClick={() => command('frame-next')}
            aria-label="Next frame"
          >
            <StepForward size={17} />
          </Button>
          <Button
            disabled={!ready || !r.keys?.length}
            onClick={() => command('key-next')}
            aria-label="Next keyframe"
          >
            KF <ChevronsRight size={16} />
          </Button>
          <Button disabled={!ready} onClick={() => command('end')} aria-label="Next clip boundary">
            <SkipForward size={17} />
          </Button>
          <Button disabled={!ready} onClick={capture} aria-label="Capture current frame">
            <Camera size={17} />
          </Button>
        </div>
        <div className={s.playbackStatus}>
          <span title="J: reverse · K: pause · L: play / faster" aria-label="Playback status">
            {status}
          </span>
          {(!r.sample || r.fullResolution) && (
            <label>
              <Volume2 size={14} />
              <input
                aria-label="Volume"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(e) => {
                  setVolume(Number(e.target.value));
                  if (video.current) video.current.volume = Number(e.target.value);
                }}
              />
            </label>
          )}
        </div>
      </div>
      {snapshot && (
        <Modal title="Current frame" onClose={() => setSnapshot('')}>
          <img className={s.capture} src={snapshot} alt="Captured video frame" />
          <p className={s.muted}>Source {time(r.base + current)}</p>
          {onFrame && (
            <Button
              primary
              onClick={() => {
                onFrame(snapshot);
                setSnapshot('');
              }}
            >
              Use as thumbnail
            </Button>
          )}
        </Modal>
      )}
    </section>
  );
}
