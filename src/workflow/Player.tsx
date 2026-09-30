import { useEffect, useLayoutEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import {
  Camera,
  ChevronsLeft,
  ChevronsRight,
  FastForward,
  Pause,
  Play,
  Rewind,
  Repeat2,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
  Volume2,
} from 'lucide-react';
import { time, type Recording, type Marker, type Clip } from './model';
import { Button, Modal } from './ui';
import { Timeline } from './Timeline';
import { PlaybackMetrics } from './PlaybackMetrics';
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
  onPlayable,
  onSelect,
  handleMode = false,
  trimEnabled = true,
  onTrim,
  onTrimActive,
  selectedMarkerId,
  onMarkerSelect,
  onMarkerDeselect,
  onAudioChange,
  audioStatus,
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
  onPlayable?: (ready: boolean) => void;
  onSelect?: (id: string) => void;
  handleMode?: boolean;
  trimEnabled?: boolean;
  onTrim?: (id: string, edge: 'start' | 'end', value: number) => void;
  onTrimActive?: (active: boolean) => void;
  selectedMarkerId?: string;
  onMarkerSelect?: (id: string) => void;
  onMarkerDeselect?: () => void;
  onAudioChange?: (patch: Partial<Recording>) => void;
  audioStatus?: string;
  onFrame?: (url: string) => void;
  onEnded?: () => void;
  autoPlay?: boolean;
  ref?: Ref<Transport>;
}) {
  const video = useRef<HTMLVideoElement>(null),
    audio = useRef(new Map<number, HTMLAudioElement>()),
    stage = useRef<HTMLDivElement>(null),
    reverse = useRef<ReturnType<typeof setInterval> | null>(null),
    speed = useRef(1);
  const [current, setCurrent] = useState(r.position),
    [duration, setDuration] = useState(r.duration),
    [status, setStatus] = useState('Paused'),
    [loopEnabled, setLoopEnabled] = useState(false),
    [seekAction, setSeekAction] = useState(''),
    [error, setError] = useState(''),
    [ready, setReady] = useState(false),
    [snapshot, setSnapshot] = useState(''),
    [snapshotThumbnail, setSnapshotThumbnail] = useState(''),
    [fit, setFit] = useState<number>(),
    [volume, setVolume] = useState(1),
    [holdFrame, setHoldFrame] = useState(''),
    [waveMode, setWaveMode] = useState<'off' | 'overlay' | 'replace'>(() => {
      const saved = localStorage.getItem('virtual-cut.waveforms');
      return saved === 'overlay' || saved === 'replace' ? saved : 'off';
    });
  const frameCallback = useRef<number | null>(null);
  useLayoutEffect(() => {
    const v = video.current!;
    // Keep the last decoded frame visible while loading the next source. Thumbnail
    // posters belong in the browser; they must never flash through the viewer.
    if (v.readyState >= 2) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(1280, v.videoWidth);
        canvas.height = Math.round((canvas.width * v.videoHeight) / v.videoWidth);
        canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height);
        setHoldFrame(canvas.toDataURL('image/jpeg', 0.9));
      } catch {
        setHoldFrame('');
      }
    }
    if (frameCallback.current != null) v.cancelVideoFrameCallback(frameCallback.current);
    if (reverse.current) clearInterval(reverse.current);
    reverse.current = null;
    v.pause();
    speed.current = 1;
    v.playbackRate = 1;
    setReady(false);
    setError('');
    setStatus('Paused');
    setLoopEnabled(false);
    setCurrent(r.position);
    setDuration(r.duration);
    v.src = r.url;
    v.load();
    // URL grants remain stable for edits and undo, so they never reload media.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.url]);
  function revealFrame() {
    const v = video.current!;
    if (v.seeking || v.readyState < 2) return;
    if (frameCallback.current != null) v.cancelVideoFrameCallback(frameCallback.current);
    frameCallback.current = v.requestVideoFrameCallback(() => {
      setHoldFrame('');
      frameCallback.current = null;
    });
    // Paused players can already have presented the sought frame before this event.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!v.seeking && v.readyState >= 2) setHoldFrame('');
      }),
    );
  }
  const a = bounds?.start || 0,
    z = bounds?.end || duration;
  const selectedClip = clips.find((clip) => clip.id === selectedId);
  const loopRange = bounds || selectedClip;
  const loopStart = Math.max(a, loopRange?.start ?? a),
    loopEnd = Math.min(z, loopRange?.end ?? z);
  const canLoop = !!loopRange && loopEnd > loopStart + 0.02;
  const looping = loopEnabled && canLoop;
  const loopBounds = useRef({ looping, start: loopStart, end: loopEnd });
  useLayoutEffect(() => {
    loopBounds.current = { looping, start: loopStart, end: loopEnd };
  }, [looping, loopStart, loopEnd]);
  const playing = status !== 'Paused';
  const reversePlaying = status.includes('reverse');
  const fastPlaying = status.includes('forward') && speed.current > 1;
  const clockOffset = r.sourcePath ? Math.max(0, r.sourceStart || 0) : 0;
  const callbacks = useRef({ onPosition, onDuration, onEnded });
  useEffect(() => {
    onPlayable?.(ready);
    return () => onPlayable?.(false);
  }, [ready, onPlayable]);
  const monitored = (r.audioTracks || []).filter(
    (t) =>
      (r.monitor !== 'mic' && t.index === r.gameTrack) ||
      (r.monitor !== 'game' && r.monitor != null && t.index === r.micTrack),
  );
  const audioKey = monitored.map((t) => `${t.index}:${t.previewUrl || ''}:${t.offset}`).join('|');
  useEffect(() => {
    if (!r.sourcePath) return;
    const v = video.current!,
      elements = audio.current;
    const sync = () => {
      for (const track of monitored) {
        const a = audio.current.get(track.index);
        if (!a) continue;
        const time = v.currentTime - clockOffset - track.offset;
        a.volume = volume;
        a.playbackRate = v.playbackRate;
        if (time < 0 || time >= a.duration || v.paused || v.seeking || reverse.current) {
          a.pause();
          continue;
        }
        if (a.readyState >= 1 && Math.abs(a.currentTime - time) > 0.12)
          a.currentTime = Math.max(0, time);
        if (a.paused) void a.play().catch(() => {});
      }
    };
    const seekAudio = () => {
      for (const track of monitored) {
        const a = audio.current.get(track.index);
        if (a && a.readyState >= 1)
          a.currentTime = Math.max(
            0,
            Math.min(a.duration, v.currentTime - clockOffset - track.offset),
          );
      }
      sync();
    };
    const events = ['play', 'pause', 'ratechange', 'seeking', 'seeked', 'ended'] as const;
    events.forEach((e) => v.addEventListener(e, e === 'seeked' ? seekAudio : sync));
    const timer = setInterval(sync, 50);
    sync();
    return () => {
      clearInterval(timer);
      events.forEach((e) => v.removeEventListener(e, e === 'seeked' ? seekAudio : sync));
      elements.forEach((a) => a.pause());
    };
    // The key includes all selected stream URLs and timing offsets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioKey, volume, r.sourcePath, clockOffset]);
  useEffect(() => {
    callbacks.current = { onPosition, onDuration, onEnded };
  }, [onPosition, onDuration, onEnded]);
  const stop = () => {
    if (reverse.current) clearInterval(reverse.current);
    reverse.current = null;
    video.current?.pause();
    setStatus('Paused');
  };
  useEffect(() => {
    if (!seekAction) return;
    const timer = setTimeout(() => setSeekAction(''), 350);
    return () => clearTimeout(timer);
  }, [seekAction]);
  const seek = (t: number) => {
    const v = video.current;
    if (!v || !Number.isFinite(z) || z <= 0) return;
    const position = Math.max(a, Math.min(z - 0.001, t));
    v.currentTime = position + clockOffset;
    setCurrent(position);
    callbacks.current.onPosition?.(position);
  };
  useEffect(() => {
    if (!looping) return;
    const timer = setInterval(() => {
      const v = video.current;
      if (!v || v.paused || v.seeking || reverse.current) return;
      if (v.currentTime - clockOffset >= loopEnd) seek(loopStart);
    }, 16);
    return () => clearInterval(timer);
    // Loop bounds change with selection and trimming; seek clamps to the source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [looping, loopStart, loopEnd, clockOffset]);
  const forward = (rate: number) => {
    const v = video.current;
    if (!v || !ready) return;
    if (reverse.current) clearInterval(reverse.current);
    reverse.current = null;
    const position = v.currentTime - clockOffset;
    if (looping && (position < loopStart || position >= loopEnd - 0.001)) seek(loopStart);
    else if (position >= z - 0.04) seek(a);
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
    if (key === 'pause') {
      stop();
      return;
    }
    if (key === 'l') {
      forward(!v.paused ? Math.min(16, speed.current * 2) : 1);
      return;
    }
    if (key === ' ' || key === 'k') {
      if (!v.paused || reverse.current) stop();
      else forward(1);
      return;
    }
    if (key === 'j') {
      const rate = reverse.current ? Math.min(16, speed.current * 2) : 1;
      stop();
      speed.current = rate;
      setStatus(`${rate}× reverse scan`);
      if (
        looping &&
        (v.currentTime - clockOffset < loopStart || v.currentTime - clockOffset >= loopEnd)
      )
        seek(loopEnd - 0.001);
      reverse.current = setInterval(() => {
        const loop = loopBounds.current;
        if (loop.looping && v.currentTime - clockOffset - rate / 12 <= loop.start) {
          seek(loop.end - 0.001);
          return;
        }
        if (v.currentTime - clockOffset <= a + 0.01) {
          stop();
          return;
        }
        seek(v.currentTime - clockOffset - rate / 12);
      }, 83);
      return;
    }
    stop();
    setSeekAction(key);
    const position = v.currentTime - clockOffset;
    const boundaries = [...new Set([a, z, ...clips.flatMap((c) => [c.start, c.end])])]
      .filter((t) => t >= a && t <= z)
      .sort((x, y) => x - y);
    const epsilon = r.fps ? 0.5 / r.fps : 0.01;
    if (key === 'start') seek([...boundaries].reverse().find((t) => t < position - epsilon) ?? a);
    if (key === 'end') seek(boundaries.find((t) => t > position + epsilon) ?? z);
    if (key === 'frame-prev' || key === 'frame-next') {
      const frames = r.frameTimes;
      if (frames?.length) {
        let low = 0,
          high = frames.length;
        const target = position + (key === 'frame-next' ? 0.0001 : -0.0001);
        while (low < high) {
          const mid = (low + high) >>> 1;
          if (frames[mid] < target) low = mid + 1;
          else high = mid;
        }
        const frame =
          frames[key === 'frame-next' ? Math.min(low, frames.length - 1) : Math.max(0, low - 1)];
        seek(frame);
      } else if (r.fps) seek(position + (key === 'frame-next' ? 1 : -1) / r.fps);
    }
    if (key === 'key-prev')
      seek([...(r.keys || [])].reverse().find((k) => k < position - 0.04 && k >= a) ?? a);
    if (key === 'key-next') seek(r.keys?.find((k) => k > position + 0.04 && k <= z) ?? z - 0.001);
  }
  useImperativeHandle(ref, () => ({
    seek,
    command,
    current: () => Math.max(0, (video.current?.currentTime || 0) - clockOffset),
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
      const preview = document.createElement('canvas');
      preview.width = Math.min(960, c.width);
      preview.height = Math.round((c.height * preview.width) / c.width);
      preview.getContext('2d')!.drawImage(c, 0, 0, preview.width, preview.height);
      setSnapshotThumbnail(preview.toDataURL('image/jpeg', 0.86));
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
          e.repeat ||
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
        <div className={s.viewerFacts}>
          <PlaybackMetrics key={r.url} video={video} scanning={reversePlaying || fastPlaying} />
          <span>
            {r.fullResolution
              ? `${r.width} × ${r.height} · ${r.codec?.toUpperCase()} · Source ${r.fps?.toFixed(2)} fps`
              : r.sample
                ? 'Sample footage'
                : 'Local video · session only'}
          </span>
        </div>
      </div>
      <div ref={stage} className={s.stage} data-video-stage>
        <video
          crossOrigin="anonymous"
          ref={video}
          playsInline
          preload="metadata"
          muted={!!r.sourcePath || (r.sample && !r.fullResolution)}
          style={{ maxWidth: fit }}
          aria-label={`Video: ${r.title}`}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            const d = r.sourcePath ? r.duration : Number.isFinite(v.duration) ? v.duration : 0;
            if (
              r.sourcePath &&
              ((r.sourceStart || 0) < -0.001 ||
                (Number.isFinite(v.duration) && v.duration + 0.15 < clockOffset + d))
            ) {
              setError(
                'This file’s timestamp offset is not supported by the built-in player. Playback editing is disabled to protect source timing.',
              );
              setReady(false);
              return;
            }
            setDuration(d);
            setReady(d > 0);
            v.volume = volume;
            v.currentTime =
              Math.max(a, Math.min((bounds?.end || d) - 0.001, r.position)) + clockOffset;
            callbacks.current.onDuration?.(d);
            if (autoPlay)
              void v
                .play()
                .then(() => setStatus('Sequence playback'))
                .catch(() => {});
          }}
          onLoadedData={revealFrame}
          onSeeked={revealFrame}
          onError={() =>
            setError(
              r.sample
                ? 'Sample media is unavailable in this checkout. Use Open video to preview your own footage.'
                : 'Unable to play this file. Its codec may be unsupported, or the file may have changed.',
            )
          }
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            const position = Math.max(0, v.currentTime - clockOffset);
            if (looping && !v.paused && !v.seeking && !reverse.current && position >= loopEnd) {
              // Wrap before notifying selection-follow: the neighboring clip at
              // the out-point must not take over the loop on a delayed update.
              seek(loopStart);
              return;
            }
            setCurrent(position);
            callbacks.current.onPosition?.(position);
            if (!looping && position >= z - 0.045 && !v.paused) {
              v.pause();
              setStatus('Paused');
              callbacks.current.onEnded?.();
            }
          }}
          onEnded={() => {
            if (looping && !reverse.current) {
              seek(loopStart);
              forward(speed.current);
              return;
            }
            setStatus('Paused');
            callbacks.current.onEnded?.();
          }}
        />
        {holdFrame && (
          <img
            className={s.transitionFrame}
            src={holdFrame}
            alt=""
            style={{ maxWidth: fit }}
            aria-hidden="true"
          />
        )}
      </div>
      {r.sourcePath &&
        monitored
          .filter((t) => t.previewUrl)
          .map((t) => (
            <audio
              key={`${r.id}-${t.index}`}
              data-audio-track={t.index}
              ref={(el) => {
                if (el) audio.current.set(t.index, el);
                else audio.current.delete(t.index);
              }}
              src={t.previewUrl}
              preload="auto"
              crossOrigin="anonymous"
            />
          ))}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <Timeline
        key={`${r.id}:${a}:${z}`}
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
        handleMode={handleMode}
        trimEnabled={trimEnabled}
        onTrim={onTrim}
        onTrimActive={(active) => {
          if (active) stop();
          onTrimActive?.(active);
        }}
        selectedMarkerId={selectedMarkerId}
        onMarkerSelect={onMarkerSelect}
        onMarkerDeselect={onMarkerDeselect}
        waveMode={waveMode}
        audioTracks={monitored}
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
            primary={seekAction === 'start'}
            aria-label="Previous clip boundary"
          >
            <SkipBack size={17} />
          </Button>
          <Button
            disabled={!ready || !r.keys?.length}
            onClick={() => command('key-prev')}
            primary={seekAction === 'key-prev'}
            aria-label="Previous keyframe"
            title={r.keys ? 'Previous keyframe' : 'Keyframe indexing comes later for local footage'}
          >
            <ChevronsLeft size={16} /> KF
          </Button>
          <Button
            disabled={!ready || !r.fps}
            onClick={() => command('frame-prev')}
            primary={seekAction === 'frame-prev'}
            aria-label="Previous frame"
            title={r.fps ? 'Previous frame' : 'Source frame rate has not been probed'}
          >
            <StepBack size={17} />
          </Button>
          <Button
            disabled={!ready}
            primary={reversePlaying}
            onClick={() => command('j')}
            aria-label="Reverse · J"
            title="J: reverse scan · 1× / 2× / 4× / 8× / 16× · silent, sampled frames"
          >
            <Rewind size={17} />
          </Button>
          <Button
            disabled={!ready}
            primary={playing && !reversePlaying && !fastPlaying}
            onClick={() => command('k')}
            aria-label={playing ? 'Pause · K / Space' : 'Play · K / Space'}
            data-play-pause
          >
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </Button>
          <Button
            disabled={!ready}
            primary={fastPlaying}
            onClick={() => command('l')}
            aria-label="Forward / faster · L"
            title="L: forward / faster · 1× / 2× / 4× / 8× / 16× · high-speed preview may skip frames or mute audio"
          >
            <FastForward size={17} />
          </Button>
          <Button
            disabled={!ready || !r.fps}
            onClick={() => command('frame-next')}
            primary={seekAction === 'frame-next'}
            aria-label="Next frame"
          >
            <StepForward size={17} />
          </Button>
          <Button
            disabled={!ready || !r.keys?.length}
            onClick={() => command('key-next')}
            primary={seekAction === 'key-next'}
            aria-label="Next keyframe"
          >
            KF <ChevronsRight size={16} />
          </Button>
          <Button
            disabled={!ready}
            primary={seekAction === 'end'}
            onClick={() => command('end')}
            aria-label="Next clip boundary"
          >
            <SkipForward size={17} />
          </Button>
          <Button disabled={!ready} onClick={capture} aria-label="Capture current frame">
            <Camera size={17} />
          </Button>
          <Button
            disabled={!ready || !canLoop}
            aria-label="Loop selected clip"
            aria-pressed={looping}
            title={canLoop ? 'Loop selected clip' : 'Select a clip to loop'}
            onClick={() => setLoopEnabled(!looping)}
          >
            <Repeat2 size={17} />
          </Button>
        </div>
        <div className={s.playbackStatus}>
          <span
            title="J: reverse · K: play / pause · L: forward / faster"
            aria-label="Playback status"
          >
            {status}
          </span>
        </div>
      </div>
      {(!r.sample || r.fullResolution) && (
        <div className={s.audioControls} role="group" aria-label="Preview audio controls">
          {r.sourcePath && (
            <>
              <span className={s.audioLabel}>Listen</span>
              <div className={s.listenChoices} role="group" aria-label="Listen to">
                {(['game', 'mic', 'both'] as const).map((mode) => (
                  <Button
                    key={mode}
                    aria-pressed={(r.monitor || 'game') === mode}
                    disabled={
                      mode === 'game'
                        ? r.gameTrack == null
                        : mode === 'mic'
                          ? r.micTrack == null
                          : r.gameTrack == null || r.micTrack == null
                    }
                    onClick={() => onAudioChange?.({ monitor: mode })}
                  >
                    {mode === 'game' ? 'Game' : mode === 'mic' ? 'Mic' : 'Combined'}
                  </Button>
                ))}
              </div>
              <span role="status" className={s.audioReady} title={audioStatus}>
                {audioStatus ||
                  (monitored.some((t) => !t.previewUrl)
                    ? 'Preparing audio…'
                    : monitored.length
                      ? 'Audio ready'
                      : 'No track selected')}
              </span>
            </>
          )}
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
          {r.sourcePath && (
            <label>
              Waveforms{' '}
              <select
                aria-label="Waveform display"
                value={waveMode}
                onChange={(e) => {
                  const mode = e.target.value as typeof waveMode;
                  setWaveMode(mode);
                  localStorage.setItem('virtual-cut.waveforms', mode);
                }}
              >
                <option value="off">Off</option>
                <option value="overlay">Overlay</option>
                <option value="replace">Replace filmstrip</option>
              </select>
            </label>
          )}
        </div>
      )}
      {snapshot && (
        <Modal title="Current frame" onClose={() => setSnapshot('')}>
          <img className={s.capture} src={snapshot} alt="Captured video frame" />
          <p className={s.muted}>Source {time(r.base + current)}</p>
          {onFrame && (
            <Button
              primary
              onClick={() => {
                onFrame(snapshotThumbnail);
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
