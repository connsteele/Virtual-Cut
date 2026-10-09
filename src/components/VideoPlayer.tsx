import { useEffect, useRef, useState, type RefObject } from 'react';
import { FolderOpen, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import type { OpenedVideo } from '../../electron/contracts';
import styles from './VideoPlayer.module.css';
import { background } from '../workflow/background';

export interface PlaybackBookmark {
  id: string;
  time: number;
  rate: number;
  volume: number;
  muted: boolean;
  playing: boolean;
}

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

function isInterruptedPlay(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function VideoPlayer({
  video,
  bookmark,
  onOpen,
  opening,
  onStageHeightChange,
}: {
  video: OpenedVideo;
  bookmark: RefObject<PlaybackBookmark | null>;
  onOpen: () => void;
  opening: boolean;
  onStageHeightChange?: (height: number) => void;
}) {
  const element = useRef<HTMLVideoElement>(null);
  // Audio Chromium cannot play is heard from a lossless copy beside the muted video;
  // volume and mute then belong to that copy.
  const sound = useRef<HTMLAudioElement>(null);
  const output = () => (video.audio ? sound.current : element.current);
  const stage = useRef<HTMLDivElement>(null);
  const initial = useRef(bookmark.current?.id === video.id ? { ...bookmark.current } : null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(initial.current?.time ?? 0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [rate, setRate] = useState(initial.current?.rate ?? 1);
  const [volume, setVolume] = useState(initial.current?.volume ?? 0.7);
  const [muted, setMuted] = useState(initial.current?.muted ?? false);
  const [dimensions, setDimensions] = useState('');

  useEffect(() => {
    if (!onStageHeightChange || !stage.current) return;
    // Observe the available height, not the fitted video's size: resizing columns
    // must not feed their changing width back into the height calculation.
    const observer = new ResizeObserver(([entry]) => {
      onStageHeightChange(entry.contentRect.height);
    });
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, [onStageHeightChange]);

  useEffect(() => {
    const v = element.current!,
      a = sound.current;
    if (!a || !video.audio) return;
    const offset = video.audio.offset;
    const sync = () => {
      const at = v.currentTime - offset;
      if (v.paused || v.seeking || at < 0 || at >= a.duration) {
        a.pause();
        return;
      }
      if (a.playbackRate !== v.playbackRate) a.playbackRate = v.playbackRate;
      if (a.readyState >= 1 && !a.seeking && Math.abs(a.currentTime - at) > 0.12 * v.playbackRate)
        a.currentTime = at;
      if (a.paused) void a.play().catch(() => {});
    };
    const seek = () => {
      if (a.readyState >= 1) a.currentTime = Math.max(0, v.currentTime - offset);
      sync();
    };
    const events = ['play', 'pause', 'ratechange', 'seeking', 'ended'] as const;
    events.forEach((e) => v.addEventListener(e, sync));
    v.addEventListener('seeked', seek);
    const timer = setInterval(sync, 250);
    return () => {
      clearInterval(timer);
      events.forEach((e) => v.removeEventListener(e, sync));
      v.removeEventListener('seeked', seek);
      a.pause();
    };
  }, [video.audio]);

  useEffect(() => {
    const player = element.current!;
    if (player.getAttribute('src') !== video.url) player.src = video.url;
    return () => {
      if (player.readyState > 0) {
        const out = output() || player;
        bookmark.current = {
          id: video.id,
          time: player.currentTime,
          rate: player.playbackRate,
          volume: out.volume,
          muted: out.muted,
          playing: !player.paused && !player.ended,
        };
      }
      player.pause();
      player.removeAttribute('src');
      player.load();
    };
  }, [bookmark, video.id, video.url]);

  function seek(next: number) {
    const player = element.current;
    if (!player || !ready) return;
    player.currentTime = Math.max(0, Math.min(duration, next));
    setTime(player.currentTime);
    remember(player);
  }

  function remember(player: HTMLVideoElement) {
    if (player.readyState === 0) return;
    const out = output() || player;
    bookmark.current = {
      id: video.id,
      time: player.currentTime,
      rate: player.playbackRate,
      volume: out.volume,
      muted: out.muted,
      playing: !player.paused && !player.ended,
    };
  }

  async function togglePlay() {
    const player = element.current;
    if (!player || !ready) return;
    if (!player.paused) {
      player.pause();
      return;
    }
    try {
      await player.play();
    } catch (error) {
      // pause(), a seek, or unmounting can interrupt a pending play() promise.
      // These ordinary transport actions are not codec/file failures.
      if (!isInterruptedPlay(error))
        setError('Playback could not start. Try opening this video again.');
    }
  }

  return (
    <section
      className={styles.player}
      aria-label="Footage viewer"
      tabIndex={0}
      onKeyDown={(event) => {
        if (
          (event.target as HTMLElement).closest('input, select, button, textarea') ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey
        )
          return;
        if (event.key === ' ') {
          event.preventDefault();
          background(togglePlay());
        }
        if (event.key.toLowerCase() === 'k') element.current?.pause();
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          seek(time - 5);
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          seek(time + 5);
        }
      }}
    >
      <div className={styles.heading}>
        <div>
          <span className={styles.label}>VIEWER</span>
          <strong title={video.name}>{video.name}</strong>
        </div>
        <button
          onClick={onOpen}
          disabled={opening}
          title="Open another video"
          aria-label="Open another video"
        >
          <FolderOpen size={16} />
        </button>
      </div>
      <div ref={stage} className={styles.stage}>
        <div className={styles.frame}>
          <video
            ref={element}
            src={video.url}
            preload="metadata"
            playsInline
            aria-label={`Video: ${video.name}`}
            onLoadedMetadata={(event) => {
              const player = event.currentTarget;
              const length = Number.isFinite(player.duration) ? player.duration : 0;
              setDuration(length);
              setDimensions(`${player.videoWidth} × ${player.videoHeight}`);
              const out = output() || player;
              out.volume = initial.current?.volume ?? 0.7;
              out.muted = initial.current?.muted ?? false;
              if (video.audio) player.muted = true;
              player.playbackRate = initial.current?.rate ?? 1;
              if (initial.current) player.currentTime = Math.min(initial.current.time, length);
              setReady(length > 0 && player.videoWidth > 0);
              if (initial.current?.playing) {
                void player.play().catch((error: unknown) => {
                  if (!isInterruptedPlay(error)) setError('Press Play to resume this video.');
                });
              }
            }}
            onTimeUpdate={(event) => {
              setTime(event.currentTarget.currentTime);
              remember(event.currentTarget);
            }}
            onPlay={(event) => {
              setPlaying(true);
              setError('');
              remember(event.currentTarget);
            }}
            onPause={(event) => {
              setPlaying(false);
              remember(event.currentTarget);
            }}
            onEnded={(event) => {
              setPlaying(false);
              remember(event.currentTarget);
            }}
            onRateChange={(event) => {
              setRate(event.currentTarget.playbackRate);
              remember(event.currentTarget);
            }}
            onVolumeChange={(event) => {
              if (video.audio) return;
              setVolume(event.currentTarget.volume);
              setMuted(event.currentTarget.muted);
              remember(event.currentTarget);
            }}
            onError={() => {
              setReady(false);
              setPlaying(false);
              setError(
                'This video could not be played. The format may not be supported yet, or the file may have moved or changed. Try another video.',
              );
            }}
          />
          {video.audio && (
            <audio
              ref={sound}
              src={video.audio.url}
              preload="auto"
              onVolumeChange={(event) => {
                setVolume(event.currentTarget.volume);
                setMuted(event.currentTarget.muted);
                if (element.current) remember(element.current);
              }}
            />
          )}
          {error ? (
            <div className={styles.message} role="alert">
              {error}
            </div>
          ) : (
            !ready && (
              <div className={styles.message} role="status">
                Opening video…
              </div>
            )
          )}
        </div>
      </div>
      <div className={styles.controls}>
        <div className={styles.seekRow}>
          <output aria-label="Playback position">{formatTime(time)}</output>
          <input
            type="range"
            aria-label="Seek video"
            min={0}
            max={duration || 1}
            step={0.01}
            value={Math.min(time, duration)}
            disabled={!ready}
            onChange={(event) => seek(Number(event.target.value))}
            aria-valuetext={`${formatTime(time)} of ${formatTime(duration)}`}
          />
          <output aria-label="Video duration">{formatTime(duration)}</output>
        </div>
        <div className={styles.buttons}>
          <button
            disabled={!ready}
            onClick={() => seek(0)}
            aria-label="Restart video"
            title="Go to start"
          >
            <RotateCcw size={16} />
          </button>
          <button
            className={styles.play}
            disabled={!ready}
            onClick={() => background(togglePlay())}
            aria-label={playing ? 'Pause video' : 'Play video'}
          >
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <label className={styles.speed}>
            Speed{' '}
            <select
              aria-label="Playback speed"
              value={rate}
              disabled={!ready}
              onChange={(event) => {
                if (element.current) element.current.playbackRate = Number(event.target.value);
              }}
            >
              {[0.5, 1, 1.5, 2, 4].map((value) => (
                <option value={value} key={value}>
                  {value}×
                </option>
              ))}
            </select>
          </label>
          <div className={styles.volume}>
            <button
              disabled={!ready}
              aria-label={muted ? 'Unmute video' : 'Mute video'}
              onClick={() => {
                const out = output();
                if (out) out.muted = !muted;
              }}
            >
              {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
            </button>
            <input
              aria-label="Volume"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              disabled={!ready}
              onChange={(event) => {
                const out = output();
                if (out) out.volume = Number(event.target.value);
              }}
            />
          </div>
        </div>
      </div>
      <div className={styles.details}>
        <span>{dimensions || 'Single-video preview'}</span>
        <span>{video.audio ? 'Default audio track · lossless copy' : 'Default audio track'}</span>
      </div>
    </section>
  );
}
