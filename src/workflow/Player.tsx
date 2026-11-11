import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react';
import {
  Camera,
  ChevronDown,
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
import { Timeline, type GapControls } from './Timeline';
import { gapJoins, skipTarget } from '../../electron/clip-gaps';
import { PlaybackMetrics } from './PlaybackMetrics';
import { startScan } from './scanPlayback';
import { fastScrubbing } from './SettingsPanel';
import { audioSyncStep } from './audioSync';
import type { PlaybackDiagnostic, PlaybackTrace } from '../../electron/diagnostic-contracts';
import s from './Workflow.module.css';
/** J and L speed steps. Preview audio follows forward playback up to `audioLimit`. */
const speeds = [1, 2, 4, 6, 8, 16],
  audioLimit = 6;
const faster = (rate: number) => speeds.find((step) => step > rate) ?? speeds.at(-1)!;
/** When the info tag on the picture shows (VC-238): always, only while the picture stands still,
 * or never. Remembered for the app, like the waveform choice. */
type InfoMode = 'always' | 'paused' | 'never';
const infoModes: [InfoMode, string][] = [
  ['always', 'Always'],
  ['paused', 'When paused'],
  ['never', 'Never'],
];
const infoKey = 'virtual-cut.viewer-info',
  infoFlashKey = 'virtual-cut.viewer-info-flash';
function readSetting(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeSetting(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* The choice still holds for this window. */
  }
}
/** The codec as people write it: H.264 and H.265 with the dot, others in capitals. */
const codecName = (codec?: string) =>
  codec === 'h264' ? 'H.264' : codec === 'hevc' ? 'H.265' : codec?.toUpperCase() || '';
export interface Transport {
  seek: (time: number) => void;
  command: (key: string) => void;
  current: () => number;
}
export function Player({
  recording: r,
  projectId,
  markers,
  clips,
  bounds,
  selectedId,
  showClips = true,
  legend = true,
  onLegend = () => {},
  onPosition,
  onActivityChange,
  onDuration,
  onPlayable,
  onSelect,
  handleMode = false,
  snapEnabled = false,
  trimEnabled = true,
  onTrim,
  onTrimActive,
  selectedMarkerId,
  onMarkerSelect,
  onMarkerDeselect,
  onMarkerMove,
  onAudioChange,
  audioStatus,
  onFrame,
  onEnded,
  onSourceOpen,
  autoPlay = false,
  proposals,
  proposalFocus,
  proposalReveal,
  onProposalAdjust,
  gaps,
  skipGaps = false,
  onGapSkipped,
  viewerSource = 'proxy',
  onViewerSource,
  ref,
}: {
  recording: Recording;
  projectId?: string;
  markers: Marker[];
  clips: Clip[];
  bounds?: { start: number; end: number };
  selectedId?: string;
  showClips?: boolean;
  legend?: boolean;
  onLegend?: () => void;
  onPosition?: (time: number) => void;
  onActivityChange?: (active: boolean) => void;
  onDuration?: (duration: number) => void;
  onPlayable?: (ready: boolean) => void;
  onSelect?: (id: string) => void;
  handleMode?: boolean;
  snapEnabled?: boolean;
  trimEnabled?: boolean;
  onTrim?: (id: string, edge: 'start' | 'end', value: number) => void;
  onTrimActive?: (active: boolean) => void;
  selectedMarkerId?: string;
  onMarkerSelect?: (id: string) => void;
  onMarkerDeselect?: () => void;
  onMarkerMove?: (id: string, time: number, end?: number) => void;
  onAudioChange?: (patch: Partial<Recording>) => void;
  audioStatus?: string;
  onFrame?: (url: string) => void;
  onEnded?: () => void;
  onSourceOpen?: () => void;
  autoPlay?: boolean;
  proposals?: import('../../electron/proposal-previews').ProposalPreview[];
  proposalFocus?: string | null;
  proposalReveal?: boolean;
  onProposalAdjust?: (card: string, at: { start: number; end?: number }) => void;
  /** VC-212: gap selection, edits and the in-progress gap, handed to the timeline. */
  gaps?: GapControls;
  /** Forward playback plays one clip as exported, jumping over its gaps (Shift+G). */
  skipGaps?: boolean;
  onGapSkipped?: (clipId: string, number: number, removed: number) => void;
  /** The project's Original/Proxy switch (VC-238). Without `onViewerSource` the viewer has no
   * switch and always plays `recording.url` (completed exports). */
  viewerSource?: 'original' | 'proxy';
  onViewerSource?: (source: 'original' | 'proxy') => void;
  ref?: Ref<Transport>;
}) {
  // Proxy means proxy everywhere, paused frames included; a recording without a usable proxy
  // shows its original, and the switch says so (VC-238).
  const proxy = r.proxy?.state === 'ready' && r.proxy.url ? r.proxy : undefined;
  const onProxy = !!onViewerSource && viewerSource === 'proxy' && !!proxy;
  const src = onProxy ? proxy!.url! : r.url;
  // A proxy starts at the recording's first frame, so its clock has no offset.
  const clockOffset = onProxy ? 0 : r.sourcePath ? Math.max(0, r.sourceStart || 0) : 0;
  /** What the video element has loaded, so a source switch keeps the playhead (VC-238). */
  const loaded = useRef<{ id: string; offset: number } | null>(null),
    resume = useRef<{ rate: number; status: string } | null>(null);
  const [sourceNote, setSourceNote] = useState('');
  const [infoMode, setInfoMode] = useState<InfoMode>(() => {
      const saved = readSetting(infoKey);
      return saved === 'paused' || saved === 'never' ? saved : 'always';
    }),
    [infoFlash, setInfoFlash] = useState(() => readSetting(infoFlashKey) !== 'false'),
    [infoOpen, setInfoOpen] = useState(false),
    [flashing, setFlashing] = useState(false),
    [dragging, setDragging] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined),
    infoMenu = useRef<HTMLSpanElement>(null);
  /** Shows the tag for 2 s when the source changes, even under When paused and Never. */
  const flashInfo = () => {
    if (!infoFlash) return;
    clearTimeout(flashTimer.current);
    setFlashing(true);
    flashTimer.current = setTimeout(() => setFlashing(false), 2000);
  };
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  useEffect(() => {
    if (!infoOpen) return;
    infoMenu.current?.querySelector<HTMLElement>('[role=menu] button')?.focus();
    const close = (e: PointerEvent) => {
      if (!infoMenu.current?.contains(e.target as Node)) setInfoOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [infoOpen]);
  const video = useRef<HTMLVideoElement>(null),
    audio = useRef(new Map<number, HTMLAudioElement>()),
    scan = useRef<ReturnType<typeof startScan> | null>(null),
    speed = useRef(1);
  const playRequest = useRef(0),
    retryPosition = useRef<number | null>(null);
  const previewId = useRef(crypto.randomUUID()),
    recent = useRef<PlaybackTrace[]>([]),
    awaitingRecovery = useRef(false);
  // Separate-audio sync since the last play, reported with the pause diagnostic (VC-29 note 28).
  const audioSync = useRef({
    holds: 0,
    seeksBack: 0,
    seeksForward: 0,
    waits: 0,
    stalledMs: 0,
    stalledSince: 0,
  });
  const gestures = useRef({ scrub: false, trim: false });
  // Scrubbing (VC-202): one seek in flight; the newest target waits behind it and replaces any
  // older waiting one. A fast drag seeks the nearest keyframe, which decodes in one step; a
  // slow one seeks exact frames. The exact frame always follows when the pointer rests for
  // 100 ms or lets go. The first seek of a drag is exact, so a click lands on its frame at once.
  const scrubbing = useRef<{
    target: number;
    moved: boolean;
    queued: { position: number; exact: boolean } | null;
    settling: boolean;
    fast: boolean;
    rest?: ReturnType<typeof setTimeout>;
  }>({ target: 0, moved: false, queued: null, settling: false, fast: false });
  // A demuxer-seek fault reloads the preview once by itself before the error shows (VC-41).
  const autoReloadAt = useRef(-Infinity);
  const [activity, setActivity] = useState(false);
  const reportActivity = useCallback(() => {
    const v = video.current;
    const active = !!(
      gestures.current.scrub ||
      gestures.current.trim ||
      scan.current ||
      (v && !v.error && (!v.paused || v.seeking))
    );
    setActivity(active);
    onActivityChange?.(active);
  }, [onActivityChange]);
  useEffect(() => {
    const v = video.current!;
    const events = ['play', 'pause', 'seeking', 'seeked', 'ended', 'emptied'] as const;
    events.forEach((event) => v.addEventListener(event, reportActivity));
    reportActivity();
    return () => {
      events.forEach((event) => v.removeEventListener(event, reportActivity));
      onActivityChange?.(false);
    };
  }, [reportActivity, onActivityChange]);
  const [current, setCurrent] = useState(r.position),
    [duration, setDuration] = useState(r.duration),
    [status, setStatus] = useState('Paused'),
    [loopEnabled, setLoopEnabled] = useState(false),
    [seekAction, setSeekAction] = useState(''),
    [error, setError] = useState(''),
    [errorDetails, setErrorDetails] = useState(''),
    [ready, setReady] = useState(false),
    [snapshot, setSnapshot] = useState(''),
    [snapshotThumbnail, setSnapshotThumbnail] = useState(''),
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
    // Original/Proxy on the same recording: carry the shown frame's position, and keep forward
    // playback going once the other file is ready.
    const switching = loaded.current?.id === r.id && v.readyState >= 1 && !v.error;
    const position = switching ? Math.max(0, v.currentTime - loaded.current!.offset) : r.position;
    resume.current =
      switching && !v.paused && !scan.current
        ? {
            rate: speed.current,
            status: status === 'Sequence playback' ? status : `${speed.current}× forward`,
          }
        : null;
    loaded.current = { id: r.id, offset: clockOffset };
    if (switching) flashInfo();
    scan.current?.cancel();
    scan.current = null;
    playRequest.current++;
    retryPosition.current = switching ? position : null;
    awaitingRecovery.current = false;
    previewId.current = crypto.randomUUID();
    recent.current = [];
    v.pause();
    speed.current = 1;
    v.playbackRate = 1;
    setReady(false);
    setError('');
    setErrorDetails('');
    setStatus('Paused');
    if (!switching) setLoopEnabled(false);
    setCurrent(position);
    setDuration(r.duration);
    v.src = src;
    v.load();
    // URL grants remain stable for edits and undo, so they never reload media.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);
  function revealFrame() {
    const v = video.current!;
    if (v.seeking || v.readyState < 2) return;
    if (awaitingRecovery.current) {
      awaitingRecovery.current = false;
      window.virtualCut?.diagnostics?.playback({
        ...playbackDetails(),
        event: 'preview-recovered',
      });
    }
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
  // The info tag: Always, When paused (hidden while playing, scanning or dragging) or Never,
  // with a 2 s flash when the source changes.
  const tagShown =
    flashing || infoMode === 'always' || (infoMode === 'paused' && !playing && !dragging);
  const reversePlaying = status.includes('reverse');
  const fastPlaying = status.includes('forward') && speed.current > 1;
  const trace = useCallback(
    (action: PlaybackTrace['action'], details: Partial<PlaybackTrace> = {}) => {
      const entry = {
        action,
        atMs: Math.round(performance.now()),
        position: Math.max(0, (video.current?.currentTime || 0) - clockOffset),
        ...details,
      };
      // Coalesce pointer movement, and keep only bounded in-memory breadcrumbs.
      // They are written with failures/reloads, never on every playback frame.
      const last = recent.current.at(-1);
      if (last?.action === action && entry.atMs - last.atMs < 150)
        recent.current[recent.current.length - 1] = { ...last, ...entry };
      else recent.current = [...recent.current.slice(-23), entry];
    },
    [clockOffset],
  );
  function playbackDetails(): Omit<PlaybackDiagnostic, 'event'> {
    const v = video.current!;
    return {
      sourceId: r.id,
      projectId,
      previewId: previewId.current,
      position: Math.max(0, v.currentTime - clockOffset),
      rate: speed.current,
      readyState: v.readyState,
      networkState: v.networkState,
      paused: v.paused,
      seeking: v.seeking,
      duration,
      offset: clockOffset,
      ...(onProxy ? { proxy: true } : {}),
      clipCount: clips.length,
      recent: [...recent.current],
    };
  }
  useEffect(() => {
    trace('source-open');
    window.virtualCut?.diagnostics?.playback({
      event: 'source-open',
      sourceId: r.id,
      projectId,
      previewId: previewId.current,
      ...(onProxy ? { proxy: true } : {}),
    });
  }, [r.id, src, onProxy, projectId, trace]);
  useEffect(() => {
    trace('clips-changed', { clipCount: clips.length });
  }, [clips.length, trace, r.id]);
  useEffect(() => {
    trace(status === 'Paused' ? 'pause' : status.includes('scan') ? 'scan' : 'play', {
      rate: speed.current,
    });
    const sync = audioSync.current;
    if (sync.stalledSince) sync.stalledMs += performance.now() - sync.stalledSince;
    window.virtualCut?.diagnostics?.playback({
      event: status === 'Paused' ? 'pause' : status.includes('scan') ? 'scan' : 'play',
      sourceId: r.id,
      rate: speed.current,
      direction: status.includes('reverse') ? -1 : 1,
      ...(status === 'Paused'
        ? {
            audioHolds: sync.holds,
            audioSeeksBack: sync.seeksBack,
            audioSeeksForward: sync.seeksForward,
            videoWaits: sync.waits,
            stalledMs: Math.round(sync.stalledMs),
          }
        : {}),
    });
    audioSync.current = {
      holds: 0,
      seeksBack: 0,
      seeksForward: 0,
      waits: 0,
      stalledMs: 0,
      stalledSince: 0,
    };
  }, [status, r.id, trace]);
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
  // Project recordings always play their track copies beside the muted video. An opened
  // local video does too when its audio needed a lossless copy (ALAC, PCM).
  const separateAudio =
    (!!r.sourcePath && !r.retained) || (!r.sourcePath && monitored.some((t) => t.previewUrl));
  useEffect(() => {
    if (!separateAudio) return;
    const v = video.current!,
      elements = audio.current;
    const lastCorrection = new Map<number, number>();
    const starting = new Set<HTMLAudioElement>();
    // Tracks held until the picture catches up (audioSyncStep, VC-29 note 28).
    const holding = new Set<number>();
    let waiting = false,
      lastVideoTime = v.currentTime,
      progressed = performance.now();
    const sync = () => {
      const now = performance.now(),
        stats = audioSync.current;
      if (v.paused || v.seeking || v.currentTime !== lastVideoTime) {
        lastVideoTime = v.currentTime;
        progressed = now;
      }
      const stalled = waiting || now - progressed > 150;
      if (stalled && !v.paused && !v.seeking) {
        if (!stats.stalledSince) stats.stalledSince = now;
      } else if (stats.stalledSince) {
        stats.stalledMs += now - stats.stalledSince;
        stats.stalledSince = 0;
      }
      for (const track of monitored) {
        const a = audio.current.get(track.index);
        if (!a) continue;
        const time = v.currentTime - clockOffset - track.offset;
        a.volume = volume;
        if (
          time < 0 ||
          time >= a.duration ||
          v.paused ||
          v.seeking ||
          scan.current ||
          v.playbackRate > audioLimit
        ) {
          holding.delete(track.index);
          a.pause();
          continue;
        }
        if (a.playbackRate !== v.playbackRate) a.playbackRate = v.playbackRate;
        if (a.seeking) continue;
        if (a.readyState >= 1) {
          const drift = a.currentTime - time,
            step = audioSyncStep({
              drift,
              rate: v.playbackRate,
              stalled,
              holding: holding.has(track.index),
              spaced: now - (lastCorrection.get(track.index) ?? -Infinity) > 350,
            });
          if (step === 'seek') {
            a.currentTime = Math.max(0, time);
            lastCorrection.set(track.index, now);
            holding.delete(track.index);
            if (drift > 0) stats.seeksBack++;
            else stats.seeksForward++;
          } else if (step === 'hold' && !holding.has(track.index)) {
            holding.add(track.index);
            stats.holds++;
          } else if (step === 'release') holding.delete(track.index);
        }
        if (holding.has(track.index)) {
          if (!a.paused) a.pause();
          continue;
        }
        if (a.paused && !starting.has(a)) {
          starting.add(a);
          void a
            .play()
            .catch(() => {})
            .finally(() => starting.delete(a));
        }
      }
    };
    const onWaiting = () => {
      waiting = true;
      audioSync.current.waits++;
      sync();
    };
    const onPlaying = () => {
      waiting = false;
      sync();
    };
    const seekAudio = () => {
      if (scan.current || v.playbackRate > audioLimit) {
        sync();
        return;
      }
      waiting = false;
      holding.clear();
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
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('playing', onPlaying);
    const timer = setInterval(sync, 50);
    sync();
    return () => {
      clearInterval(timer);
      events.forEach((e) => v.removeEventListener(e, e === 'seeked' ? seekAudio : sync));
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('playing', onPlaying);
      elements.forEach((a) => a.pause());
    };
    // The key includes all selected stream URLs and timing offsets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioKey, volume, separateAudio, clockOffset]);
  useEffect(() => {
    callbacks.current = { onPosition, onDuration, onEnded };
  }, [onPosition, onDuration, onEnded]);
  const stop = () => {
    playRequest.current++;
    scan.current?.cancel();
    scan.current = null;
    video.current?.pause();
    reportActivity();
    setStatus('Paused');
  };
  useEffect(() => {
    if (!seekAction) return;
    const timer = setTimeout(() => setSeekAction(''), 350);
    return () => clearTimeout(timer);
  }, [seekAction]);
  const seek = (t: number) => {
    const v = video.current;
    if (!v || v.error || !Number.isFinite(t) || !Number.isFinite(z) || z <= 0) return;
    const position = Math.max(a, Math.min(z - 0.001, t));
    scrubbing.current.queued = null;
    scrubbing.current.settling = false;
    trace('seek', { target: position });
    v.currentTime = position + clockOffset;
    reportActivity();
    setCurrent(position);
    callbacks.current.onPosition?.(position);
  };
  /** The keyframe nearest `t` inside the bounds, or `t` itself when none is within 2 s. */
  function nearestKey(t: number) {
    const keys = r.keys;
    if (!keys?.length) return t;
    let lo = 0,
      hi = keys.length;
    while (lo < hi) {
      const m = (lo + hi) >>> 1;
      if (keys[m] < t) lo = m + 1;
      else hi = m;
    }
    const left = keys[Math.max(0, lo - 1)],
      right = keys[Math.min(lo, keys.length - 1)];
    const key = Math.abs(left - t) <= Math.abs(right - t) ? left : right;
    return key >= a && key < z && Math.abs(key - t) <= 2 ? key : t;
  }
  /** Starts a scrub seek unless the video already shows the frame; true when one started.
   * Only a pointer that has run more than one keyframe interval ahead of the shown frame
   * seeks a keyframe. A slow drag seeks exact frames, so holding still never jumps the picture
   * to another moment, such as across a scene cut (Connor, 0.4.30-53). */
  function startScrubSeek(position: number, exact: boolean) {
    const v = video.current;
    if (!v || v.error) return false;
    const shown = v.currentTime - clockOffset;
    const keys = r.keys || [];
    const interval =
      keys.length > 1 ? Math.max(0.25, (keys.at(-1)! - keys[0]) / (keys.length - 1)) : Infinity;
    let target = position;
    // Fastest scrubbing (Settings) seeks a keyframe on every move, as 0.4.30-53 did. A proxy
    // always seeks exact frames: with a keyframe every 0.5 s they decode faster than snapping
    // to the original's keyframes would show (62 against 39 pictures a second, VC-238).
    if (!onProxy && !exact && (scrubbing.current.fast || Math.abs(position - shown) > interval))
      target = nearestKey(position);
    if (Math.abs(shown - target) < 0.0005) target = position;
    if (Math.abs(shown - target) < 0.0005) return false;
    trace('seek', { target });
    v.currentTime = target + clockOffset;
    return true;
  }
  function requestScrubSeek(position: number, exact: boolean) {
    const v = video.current;
    if (!v || v.error) return;
    const state = scrubbing.current;
    if (v.seeking) {
      // The decoder is behind: wait. The last decoded frame stays up; a low-resolution
      // filmstrip tile in its place looked like broken footage (Connor, 0.4.30-52).
      state.queued = { position, exact };
      return;
    }
    state.queued = null;
    startScrubSeek(position, exact);
  }
  function scrubTo(t: number) {
    if (!Number.isFinite(t) || !Number.isFinite(z) || z <= 0) return;
    const state = scrubbing.current;
    const position = Math.max(a, Math.min(z - 0.001, t));
    state.target = position;
    // The playhead follows the pointer; the project and Transcript hear about it on release.
    setCurrent(position);
    clearTimeout(state.rest);
    const exact = !state.moved;
    state.moved = true;
    requestScrubSeek(position, exact);
    if (!exact) state.rest = setTimeout(() => requestScrubSeek(state.target, true), 100);
  }
  function scrubActive(active: boolean) {
    const state = scrubbing.current;
    setDragging(active);
    if (active) {
      stop();
      gestures.current.scrub = true;
      state.moved = false;
      state.settling = false;
      state.fast = fastScrubbing();
    } else if (gestures.current.scrub) {
      gestures.current.scrub = false;
      clearTimeout(state.rest);
      if (state.moved) {
        state.settling = true;
        requestScrubSeek(state.target, true);
        callbacks.current.onPosition?.(state.target);
        if (!video.current?.seeking) state.settling = false;
      }
      state.moved = false;
    }
    reportActivity();
  }
  useEffect(() => () => clearTimeout(scrubbing.current.rest), []);
  // VC-212: with Skip gaps on, forward playback jumps over gaps to where the export resumes,
  // however playback got into one (Connor, 2026-11-11 03:37). A selected clip under the playhead
  // plays as it exports: only its gaps count. With no clip selected, overlapping gaps skip to the
  // soonest end, and a gap the playhead lands inside then plays. Scans, scrubbing and a paused
  // playhead are left alone.
  const skipKey = JSON.stringify(clips.map((c) => [c.id, c.start, c.end, c.gaps]));
  const skipClips = useMemo(
    () =>
      skipGaps && showClips
        ? [...clips]
            .sort((a, b) => a.start - b.start)
            .map((c) => ({
              id: c.id,
              start: c.start,
              end: c.end,
              spans: gapJoins(c, r.keys || [])
                .filter((j) => !j.short)
                .map((j) => ({ out: j.out, back: j.back, number: j.number, removed: j.removed })),
            }))
        : [],
    // The clip list is rebuilt on every render; only what skipping reads should restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [skipGaps, showClips, skipKey, r.keys],
  );
  const skipped = useRef(onGapSkipped),
    skipSelected = useRef(selectedId),
    // Gaps a no-selection skip landed inside: they play rather than skip again. Kept outside the
    // timer so a re-render after the jump cannot forget them (Connor, 2026-11-11 03:43).
    skipLanded = useRef<{ out: number; back: number }[]>([]);
  useEffect(() => {
    skipped.current = onGapSkipped;
    skipSelected.current = selectedId;
  }, [onGapSkipped, selectedId]);
  useEffect(() => {
    if (!skipClips.some((c) => c.spans.length)) return;
    // Gaps the playhead landed inside after a skip with no clip selected: those play until the
    // playhead leaves them, so one skip goes to the soonest end and no further.
    const timer = setInterval(() => {
      const v = video.current;
      if (!v || v.paused || v.seeking || scan.current || gestures.current.scrub) return;
      const position = v.currentTime - clockOffset;
      // A landed gap plays until the playhead passes its end (or is moved well before it).
      skipLanded.current = skipLanded.current.filter(
        (x) => position < x.back && position >= x.out - 2,
      );
      const next = skipTarget(skipClips, position, skipSelected.current, skipLanded.current);
      if (!next) return;
      skipLanded.current = next.landed;
      seek(next.back);
      skipped.current?.(next.clipId, next.number, next.removed);
    }, 16);
    return () => clearInterval(timer);
    // seek is stable for the life of the preview; the clips change with their gaps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipClips, clockOffset]);
  useEffect(() => {
    if (!looping) return;
    const timer = setInterval(() => {
      const v = video.current;
      if (!v || v.paused || v.seeking || scan.current) return;
      if (v.currentTime - clockOffset >= loopEnd) seek(loopStart);
    }, 16);
    return () => clearInterval(timer);
    // Loop bounds change with selection and trimming; seek clamps to the source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [looping, loopStart, loopEnd, clockOffset]);
  const forward = (rate: number) => {
    const v = video.current;
    if (!v || !ready) return;
    scan.current?.cancel();
    scan.current = null;
    const position = v.currentTime - clockOffset;
    if (looping && (position < loopStart || position >= loopEnd - 0.001)) seek(loopStart);
    else if (position >= z - 0.04) seek(a);
    speed.current = rate;
    v.playbackRate = rate;
    const request = ++playRequest.current;
    void v
      .play()
      .then(() => {
        if (request === playRequest.current && !v.paused) setStatus(`${rate}× forward`);
      })
      .catch((e) => {
        if (request === playRequest.current && e.name !== 'AbortError') {
          trace('error');
          window.virtualCut?.diagnostics?.playback({
            ...playbackDetails(),
            event: 'media-error',
            fault: 'play-rejected',
            code: v.error?.code,
          });
          setErrorDetails(
            JSON.stringify({ ...playbackDetails(), message: String(e.message || e) }, null, 2),
          );
          stop();
          setReady(false);
          setError('Playback could not start. Reload the preview to try again.');
        }
      });
  };
  function beginScan(direction: 1 | -1, rate: number) {
    stop();
    speed.current = rate;
    scan.current = startScan({
      video: video.current!,
      direction,
      rate,
      offset: clockOffset,
      keys: r.keys || [],
      range: () => {
        const loop = loopBounds.current;
        return loop.looping ? loop : { start: a, end: z, looping: false };
      },
      onPosition: (position) => {
        setCurrent(position);
        callbacks.current.onPosition?.(position);
      },
      onEnd: () => {
        stop();
        if (direction > 0) callbacks.current.onEnded?.();
      },
    });
    setStatus(`${rate}× ${direction > 0 ? 'forward' : 'reverse'} scan`);
    reportActivity();
  }
  const scanFallback = useRef(beginScan);
  useLayoutEffect(() => {
    scanFallback.current = beginScan;
  });
  useEffect(() => {
    const v = video.current!;
    let last = v.currentTime,
      advanced = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      if (
        v.paused ||
        v.seeking ||
        v.error ||
        v.playbackRate < 4 ||
        scan.current ||
        Math.abs(v.currentTime - last) > 0.01
      ) {
        last = v.currentTime;
        advanced = now;
      } else if (now - advanced > 550) {
        // Direct native playback is retained while it keeps up. A starved fast
        // decoder switches to bounded scans rather than leaving a frozen viewer.
        scanFallback.current(1, speed.current);
        advanced = now;
      }
    }, 100);
    return () => clearInterval(timer);
  }, [src]);
  useEffect(() => {
    if (!sourceNote) return;
    const timer = setTimeout(() => setSourceNote(''), 2500);
    return () => clearTimeout(timer);
  }, [sourceNote]);
  /** The Original/Proxy switch and P (VC-238). Proxy is refused, with a note on the picture,
   * when this recording has no usable proxy; the project's choice is left as it was. */
  function chooseSource(next: 'original' | 'proxy') {
    if (!onViewerSource) return;
    if (next === 'proxy' && !proxy) {
      setSourceNote(
        r.proxy?.state === 'making'
          ? 'The proxy is not ready yet'
          : r.proxy?.state === 'missing'
            ? 'The proxy file is missing'
            : 'No proxy for this recording',
      );
      flashInfo();
      return;
    }
    setSourceNote('');
    onViewerSource(next);
  }
  function command(key: string) {
    const v = video.current;
    if (key === 'p') {
      chooseSource(onProxy ? 'original' : 'proxy');
      return;
    }
    if (!v || !ready) return;
    trace('command', { rate: speed.current });
    if (key === 'pause') {
      stop();
      return;
    }
    if (key === 'l') {
      const rate = !v.paused || scan.current?.direction === 1 ? faster(speed.current) : 1;
      if (scan.current?.direction === 1) beginScan(1, rate);
      else forward(rate);
      return;
    }
    if (key === ' ' || key === 'k') {
      if (!v.paused || scan.current) stop();
      else forward(1);
      return;
    }
    if (key === 'j') {
      const rate = scan.current?.direction === -1 ? faster(speed.current) : 1;
      if (
        looping &&
        (v.currentTime - clockOffset < loopStart || v.currentTime - clockOffset >= loopEnd)
      )
        seek(loopEnd - 0.001);
      beginScan(-1, rate);
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
      scan.current?.cancel();
      v.pause();
    };
  }, []);
  useEffect(() => {
    const pause = () => {
      if (document.hidden) {
        playRequest.current++;
        scan.current?.cancel();
        scan.current = null;
        video.current?.pause();
        reportActivity();
        setStatus('Paused');
      }
    };
    document.addEventListener('visibilitychange', pause);
    return () => document.removeEventListener('visibilitychange', pause);
  }, [reportActivity]);
  /** Reloads the media at `position`, paused at 1×, keeping edits. */
  function reloadPreview(position: number, automatic: boolean) {
    const v = video.current!;
    stop();
    trace('reload');
    window.virtualCut?.diagnostics?.playback({
      ...playbackDetails(),
      event: 'reload',
      sourceId: r.id,
      position: Math.max(0, position),
      ...(automatic ? { automatic } : {}),
    });
    retryPosition.current = Math.max(a, Math.min(z - 0.001, position));
    speed.current = 1;
    v.playbackRate = 1;
    scrubbing.current.queued = null;
    scrubbing.current.settling = false;
    setError('');
    setErrorDetails('');
    setReady(false);
    awaitingRecovery.current = true;
    v.load();
  }
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
          e.stopPropagation();
          command(e.key.toLowerCase());
        }
      }}
    >
      <div className={s.viewerHeading}>
        {onSourceOpen ? (
          <button
            className={s.viewerSource}
            title={`Open source in Cut: ${r.title}`}
            onClick={onSourceOpen}
          >
            {r.title}
          </button>
        ) : (
          <strong title={r.title}>{r.title}</strong>
        )}
        <div className={s.viewerFacts}>
          <PlaybackMetrics key={src} video={video} scanning={reversePlaying || fastPlaying} />
          <span className={s.infoMenu} ref={infoMenu}>
            <button
              type="button"
              className={s.infoButton}
              aria-haspopup="menu"
              aria-expanded={infoOpen}
              title="When the info tag on the picture shows"
              onClick={() => setInfoOpen(!infoOpen)}
            >
              Info: {infoModes.find(([m]) => m === infoMode)![1]} <ChevronDown size={12} />
            </button>
            {infoOpen && (
              <div
                className={s.infoPopup}
                role="menu"
                aria-label="Info tag on the picture"
                onKeyDown={(e) => {
                  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('button')];
                  const at = items.indexOf(document.activeElement as HTMLElement);
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    setInfoOpen(false);
                    infoMenu.current?.querySelector<HTMLElement>('button')?.focus();
                  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    const step = e.key === 'ArrowDown' ? 1 : -1;
                    items[(at + step + items.length) % items.length]?.focus();
                  }
                }}
              >
                <span className={s.infoHead}>Info tag on the picture</span>
                {infoModes.map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    role="menuitemradio"
                    aria-checked={infoMode === mode}
                    onClick={() => {
                      setInfoMode(mode);
                      writeSetting(infoKey, mode);
                      setInfoOpen(false);
                    }}
                  >
                    <span className={s.infoCheck}>{infoMode === mode ? '✓' : ''}</span>
                    {label}
                    {mode === 'paused' && <small>hides while playing</small>}
                  </button>
                ))}
                <span className={s.infoSep} />
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={infoFlash}
                  onClick={() => {
                    setInfoFlash(!infoFlash);
                    writeSetting(infoFlashKey, String(!infoFlash));
                  }}
                >
                  <span className={s.infoCheck}>{infoFlash ? '✓' : ''}</span>
                  Show briefly when the source changes
                </button>
              </div>
            )}
          </span>
          {onViewerSource && (
            <div className={s.sourceSwitch} role="group" aria-label="Viewer source">
              <button
                type="button"
                aria-pressed={!onProxy}
                title="Show the original recording (P)"
                onClick={() => chooseSource('original')}
              >
                Original
              </button>
              <button
                type="button"
                className={s.sourceProxy}
                aria-pressed={onProxy}
                disabled={!proxy}
                title={proxy ? 'Show the proxy (P)' : 'This recording has no usable proxy'}
                onClick={() => chooseSource('proxy')}
              >
                Proxy <kbd>P</kbd>
              </button>
            </div>
          )}
        </div>
      </div>
      <div className={s.stage} data-video-stage>
        <span
          className={`${s.viewerTag} ${onProxy ? s.viewerTagProxy : ''} ${tagShown ? '' : s.viewerTagHidden}`}
          data-viewer-source={onProxy ? 'proxy' : 'original'}
          data-shown={tagShown}
          role="status"
          aria-label="Shown in the viewer"
        >
          {onViewerSource && <b>{onProxy ? 'Proxy' : 'Original'}</b>}
          {onProxy
            ? `${proxy!.width} × ${proxy!.height} · ${codecName(proxy!.codec)} · ${r.fps?.toFixed(2)} fps`
            : r.fullResolution
              ? `${r.width} × ${r.height} · ${codecName(r.codec)} · ${r.fps?.toFixed(2)} fps`
              : r.sample
                ? 'Sample footage'
                : 'Local video · session only'}
          {!onProxy &&
            onViewerSource &&
            viewerSource === 'proxy' &&
            !sourceNote &&
            (r.proxy?.state === 'making'
              ? ' · proxy not ready yet'
              : r.proxy?.state === 'missing'
                ? ' · proxy file missing'
                : '')}
          {sourceNote && ` · ${sourceNote}`}
        </span>
        {onViewerSource && r.proxy?.state === 'making' && (
          <div className={s.proxyMaking} role="status">
            <span>Making proxy · {Math.round((r.proxy.progress || 0) * 100)}%</span>
            <span className={s.proxyProgress}>
              <i style={{ width: `${Math.round((r.proxy.progress || 0) * 100)}%` }} />
            </span>
            <span>The original plays meanwhile</span>
          </div>
        )}
        <video
          crossOrigin="anonymous"
          ref={video}
          playsInline
          preload="metadata"
          muted={separateAudio || (r.sample && !r.fullResolution)}
          aria-label={`Video: ${r.title}`}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            trace('loaded');
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
              Math.max(
                a,
                Math.min((bounds?.end || d) - 0.001, retryPosition.current ?? r.position),
              ) + clockOffset;
            const retry = retryPosition.current !== null;
            retryPosition.current = null;
            callbacks.current.onDuration?.(d);
            const carry = resume.current;
            resume.current = null;
            if (carry) {
              speed.current = carry.rate;
              v.playbackRate = carry.rate;
              const request = ++playRequest.current;
              void v
                .play()
                .then(() => {
                  if (request === playRequest.current && !v.paused) setStatus(carry.status);
                })
                .catch(() => {});
            }
            if (autoPlay && !retry)
              void v
                .play()
                .then(() => setStatus('Sequence playback'))
                .catch(() => {});
          }}
          onLoadedData={revealFrame}
          onSeeking={() => trace('seek')}
          onSeeked={() => {
            trace('seeked');
            const state = scrubbing.current;
            const queued = state.queued;
            state.queued = null;
            if (queued && startScrubSeek(queued.position, queued.exact)) return;
            if (state.settling) {
              state.settling = false;
              const v = video.current!;
              setCurrent(Math.max(0, v.currentTime - clockOffset));
            }
            revealFrame();
          }}
          onWaiting={() => trace('waiting')}
          onStalled={() => trace('stalled')}
          onError={(e) => {
            const v = e.currentTarget;
            const scrubTarget = gestures.current.scrub || scrubbing.current.settling;
            gestures.current = { scrub: false, trim: false };
            clearTimeout(scrubbing.current.rest);
            trace('error');
            const fault = v.error?.message.includes('demuxer seek failed')
              ? 'demuxer-seek'
              : v.error?.code === 2
                ? 'media-read'
                : v.error?.code === 3
                  ? 'media-decode'
                  : v.error?.code === 4
                    ? 'media-unsupported'
                    : 'unknown';
            window.virtualCut?.diagnostics?.playback({
              ...playbackDetails(),
              event: 'media-error',
              code: v.error?.code,
              fault,
            });
            // A demuxer-seek fault has always cleared with a reload (VC-41). Do that once by
            // itself at the spot asked for; a second fault within 10 s shows the error.
            if (
              fault === 'demuxer-seek' &&
              !r.sample &&
              performance.now() - autoReloadAt.current > 10000
            ) {
              autoReloadAt.current = performance.now();
              reloadPreview(
                scrubTarget ? scrubbing.current.target : v.currentTime - clockOffset,
                true,
              );
              return;
            }
            setErrorDetails(
              JSON.stringify(
                {
                  ...playbackDetails(),
                  code: v.error?.code ?? null,
                  message: v.error?.message ?? 'Media error event',
                  sourceTime: Math.max(0, v.currentTime - clockOffset),
                  rate: speed.current,
                  readyState: v.readyState,
                  networkState: v.networkState,
                },
                null,
                2,
              ),
            );
            stop();
            setReady(false);
            const code = e.currentTarget.error?.code;
            setError(
              r.sample
                ? 'Sample media is unavailable in this checkout. Use Open video to preview your own footage.'
                : `Playback stopped${code ? ` (media error ${code})` : ''}. Reload the preview to try again.`,
            );
          }}
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            // While scrubbing, the playhead stays under the pointer, not on the keyframe shown.
            if (gestures.current.scrub || scrubbing.current.settling) return;
            const position = Math.max(0, v.currentTime - clockOffset);
            if (looping && !v.paused && !v.seeking && !scan.current && position >= loopEnd) {
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
            if (looping && !scan.current) {
              seek(loopStart);
              forward(speed.current);
              return;
            }
            setStatus('Paused');
            callbacks.current.onEnded?.();
          }}
        />
        {holdFrame && (
          <img className={s.transitionFrame} src={holdFrame} alt="" aria-hidden="true" />
        )}
        {error && (
          <div className={s.playbackFailure} role="alert">
            <div className={s.playbackFailureCard}>
              <strong>Preview stopped</strong>
              <p>{error}</p>
              {!r.sample && (
                <Button
                  primary
                  className={s.reloadPreview}
                  onClick={() => {
                    const v = video.current!;
                    reloadPreview(v.currentTime - clockOffset, false);
                  }}
                >
                  Reload preview
                </Button>
              )}
              {errorDetails && (
                <details>
                  <summary>Error details</summary>
                  <pre>{errorDetails}</pre>
                </details>
              )}
              <p className={s.muted}>
                For troubleshooting, use Diagnostics in the bottom bar → Copy diagnostics.
              </p>
            </div>
          </div>
        )}
      </div>
      {separateAudio &&
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
      <Timeline
        key={`${r.id}:${a}:${z}`}
        recording={r}
        projectId={projectId}
        suspendFrames={activity}
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
          if (gestures.current.scrub) {
            scrubTo(t);
            return;
          }
          stop();
          seek(t);
        }}
        onSelect={onSelect}
        handleMode={handleMode}
        snapEnabled={snapEnabled}
        trimEnabled={trimEnabled}
        onTrim={onTrim}
        onTrimActive={(active) => {
          gestures.current.trim = active;
          if (active) stop();
          reportActivity();
          onTrimActive?.(active);
        }}
        onScrubActive={scrubActive}
        selectedMarkerId={selectedMarkerId}
        onMarkerSelect={onMarkerSelect}
        onMarkerDeselect={onMarkerDeselect}
        onMarkerMove={onMarkerMove}
        waveMode={waveMode}
        audioTracks={r.sourcePath ? monitored : []}
        proposals={proposals}
        proposalFocus={proposalFocus}
        proposalReveal={proposalReveal}
        onProposalAdjust={onProposalAdjust}
        {...gaps}
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
            title="J: reverse scan · 1× / 2× / 4× / 6× / 8× / 16× · silent, sampled frames"
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
            title="L: forward / faster · 1× / 2× / 4× / 6× / 8× / 16× · stalled fast playback switches to sampled scanning; audio pauses above 6×"
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
          {r.sourcePath && !r.retained && (
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
                {reversePlaying ||
                status.includes('scan') ||
                (fastPlaying && speed.current > audioLimit)
                  ? 'Audio paused while scanning'
                  : audioStatus ||
                    (monitored.some((t) => !t.previewUrl)
                      ? 'Preparing audio…'
                      : monitored.length
                        ? 'Audio ready'
                        : 'No track selected')}
              </span>
            </>
          )}
          {r.retained && (
            <span className={s.audioLabel} title={audioStatus}>
              {(audioStatus
                ? audioStatus.startsWith('Preview details unavailable')
                  ? 'Preview details unavailable'
                  : 'Preparing game audio…'
                : '') || (r.gameTrack == null ? 'No audio in this file' : 'Game audio')}
            </span>
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
