import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  markerColors,
  markerColor,
  markerColorName,
  time,
  short,
  type Clip,
  type Marker,
  type Recording,
} from './model';
import type { AudioTrack } from '../../electron/workflow-types';
import { clipColor, layoutClips } from './clipLayout';
import { Button } from './ui';
import { fitViewport, zoomViewport, type TimelineViewport } from './timelineViewport';
import { ZoomIn, ZoomOut, ArrowLeft, ArrowRight, LocateFixed } from 'lucide-react';
import s from './Timeline.module.css';
import { useFilmstrip } from './useFilmstrip';
import { markerTime } from './markerTiming';

export function Timeline({
  recording,
  projectId,
  suspendFrames = false,
  markers,
  clips,
  selectedId,
  showClips,
  legend,
  onLegend,
  start: fullStart,
  end: fullEnd,
  current,
  onSeek,
  onSelect,
  selectedMarkerId,
  onMarkerSelect,
  onMarkerDeselect,
  onMarkerMove,
  waveMode = 'off',
  audioTracks = [],
  handleMode = false,
  trimEnabled = true,
  onTrim,
  onTrimActive,
  onScrubActive,
}: {
  recording: Recording;
  projectId?: string;
  suspendFrames?: boolean;
  markers: Marker[];
  clips: Clip[];
  selectedId?: string;
  showClips: boolean;
  legend: boolean;
  onLegend: () => void;
  start: number;
  end: number;
  current: number;
  onSeek: (time: number) => void;
  onSelect?: (id: string) => void;
  selectedMarkerId?: string;
  onMarkerSelect?: (id: string) => void;
  onMarkerDeselect?: () => void;
  onMarkerMove?: (id: string, time: number) => void;
  waveMode?: 'off' | 'overlay' | 'replace';
  audioTracks?: AudioTrack[];
  handleMode?: boolean;
  trimEnabled?: boolean;
  onTrim?: (id: string, edge: 'start' | 'end', value: number) => void;
  onTrimActive?: (active: boolean) => void;
  onScrubActive?: (active: boolean) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const markerDrag = useRef<{
    marker: Marker;
    x: number;
    value: number;
    pointer: number;
    recording: string;
    moved: boolean;
  } | null>(null);
  const [markerPreview, setMarkerPreview] = useState<{ id: string; time: number } | null>(null);
  const drag = useRef<{
    id: string;
    edge: 'start' | 'end';
    clip: Clip;
    value: number;
    pointer: number;
    recording: string;
  } | null>(null);
  const callbacks = useRef({ onTrimActive, onScrubActive });
  const [preview, setPreview] = useState<{
    id: string;
    edge: 'start' | 'end';
    value: number;
  } | null>(null);
  const [pointerFocus, setPointerFocus] = useState(false);
  useEffect(() => {
    callbacks.current = { onTrimActive, onScrubActive };
  }, [onTrimActive, onScrubActive]);
  useEffect(() => {
    const cancel = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (!drag.current && !markerDrag.current)) return;
      e.preventDefault();
      drag.current = null;
      setPreview(null);
      markerDrag.current = null;
      setMarkerPreview(null);
      callbacks.current.onTrimActive?.(false);
      pointer.current = null;
      callbacks.current.onScrubActive?.(false);
    };
    document.addEventListener('keydown', cancel);
    return () => {
      document.removeEventListener('keydown', cancel);
      drag.current = null;
      markerDrag.current = null;
      setMarkerPreview(null);
      pointer.current = null;
      setPreview(null);
      callbacks.current.onTrimActive?.(false);
      callbacks.current.onScrubActive?.(false);
    };
  }, [handleMode, recording.id, trimEnabled]);
  const [width, setWidth] = useState(0);
  const [keys, setKeys] = useState(
    () => localStorage.getItem('virtual-cut.keyframe-ticks') !== 'false',
  );
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    if (track.current) observer.observe(track.current);
    return () => observer.disconnect();
  }, []);
  const identity = `${recording.id}:${fullStart}:${fullEnd}`;
  const minimum = Math.max(0.1, 5 / (recording.fps || 30));
  const [viewport, setViewport] = useState<{ identity: string; view: TimelineViewport } | null>(
    null,
  );
  const view =
    viewport?.identity === identity
      ? fitViewport(viewport.view, fullStart, fullEnd, minimum)
      : { start: fullStart, end: fullEnd };
  const { start, end } = view;
  const span = Math.max(0.001, end - start),
    fullSpan = Math.max(0.001, fullEnd - fullStart);
  const zoomed = span < fullSpan - 0.00001;
  const changeView = (next: TimelineViewport) =>
    setViewport({ identity, view: fitViewport(next, fullStart, fullEnd, minimum) });
  const zoom = (
    factor: number,
    anchor = current >= start && current <= end ? current : start + span / 2,
  ) => {
    if (!drag.current && !markerDrag.current && pointer.current == null)
      changeView(zoomViewport(view, factor, anchor, fullStart, fullEnd, minimum));
  };
  const wheelState = useRef({ view, fullStart, fullEnd, minimum, identity });
  useEffect(() => {
    wheelState.current = { view, fullStart, fullEnd, minimum, identity };
  });
  useEffect(() => {
    const el = track.current!;
    const wheel = (e: WheelEvent) => {
      if (!e.altKey && !e.ctrlKey) return;
      e.preventDefault();
      if (drag.current || markerDrag.current || pointer.current != null) return;
      const state = wheelState.current,
        rect = el.getBoundingClientRect();
      const delta = e.deltaY || e.deltaX;
      if (!delta || !rect.width) return;
      const span = state.view.end - state.view.start;
      const anchor =
        state.view.start + Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * span;
      const next =
        e.ctrlKey || e.shiftKey
          ? fitViewport(
              {
                start: state.view.start + (Math.sign(delta) * span) / 4,
                end: state.view.end + (Math.sign(delta) * span) / 4,
              },
              state.fullStart,
              state.fullEnd,
              state.minimum,
            )
          : zoomViewport(
              state.view,
              delta < 0 ? 1.25 : 0.8,
              anchor,
              state.fullStart,
              state.fullEnd,
              state.minimum,
            );
      wheelState.current = { ...state, view: next };
      setViewport({ identity: state.identity, view: next });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  const displayClip = (c: Clip) =>
    preview?.id === c.id ? { ...c, [preview.edge]: preview.value } : c;
  const layout = layoutClips(showClips ? clips.map(displayClip) : [], start, end);
  const percent = (t: number) => `${100 * Math.max(0, Math.min(1, (t - start) / span))}%`;
  // Fill the visible range with bounded tiles; native previews use its nearest keyframes.
  const count = Math.max(1, Math.min(31, Math.ceil(width / 120)));
  const filmstrip = useFilmstrip(
    recording,
    projectId,
    start,
    end,
    count,
    suspendFrames,
    waveMode === 'replace' || width <= 0,
    !zoomed,
  );
  const frames = filmstrip.tiles.map((tile, i) => {
    if (filmstrip.native) return filmstrip.frames[i]?.data;
    const at = tile.requested;
    const index = Math.min(
      recording.frames.length - 1,
      Math.max(0, Math.floor((at / recording.duration) * recording.frames.length)),
    );
    return recording.frames[index];
  });
  function scrub(x: number) {
    const rect = track.current!.getBoundingClientRect();
    onSeek(start + Math.max(0, Math.min(1, (x - rect.left) / rect.width)) * span);
  }
  function moveMarker(x: number) {
    const d = markerDrag.current;
    if (!d || (!d.moved && Math.abs(x - d.x) < 3)) return;
    d.moved = true;
    const width = track.current!.getBoundingClientRect().width;
    d.value = markerTime(
      recording,
      Math.max(fullStart, Math.min(fullEnd, d.marker.time + ((x - d.x) / width) * span)),
    );
    setMarkerPreview({ id: d.marker.id, time: d.value });
    onSeek(d.value);
  }
  function finishMarker(commit: boolean) {
    const d = markerDrag.current;
    if (!d) return;
    markerDrag.current = null;
    setMarkerPreview(null);
    if (commit && d.moved && d.recording === recording.id && d.value !== d.marker.time)
      onMarkerMove?.(d.marker.id, d.value);
    onTrimActive?.(false);
  }
  function trimTime(c: Clip, edge: 'start' | 'end', value: number, step?: number) {
    const frame = 1 / (recording.fps || 30),
      min = Math.max(frame, 0.021);
    let snapped = Math.round(value / frame) * frame;
    const frames = recording.frameTimes;
    if (frames?.length) {
      const at = step ? c[edge] + Math.sign(step) * 0.000001 : value;
      let lo = 0,
        hi = frames.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (frames[mid] < at) lo = mid + 1;
        else hi = mid;
      }
      const right = frames[Math.min(lo, frames.length - 1)],
        left = frames[Math.max(0, lo - 1)];
      snapped = step
        ? step > 0
          ? right
          : left
        : Math.abs(right - at) < Math.abs(left - at)
          ? right
          : left;
    }
    if (value >= recording.duration) snapped = recording.duration;
    if (value <= 0) snapped = 0;
    return edge === 'start'
      ? Math.max(0, Math.min(c.end - min, snapped))
      : Math.min(recording.duration, Math.max(c.start + min, snapped));
  }
  function moveHandle(x: number) {
    const d = drag.current;
    if (!d) return;
    const rect = track.current!.getBoundingClientRect();
    d.value = trimTime(d.clip, d.edge, start + ((x - rect.left) / rect.width) * span);
    setPreview({ id: d.id, edge: d.edge, value: d.value });
    onSeek(d.value);
  }
  function finishHandle(commit: boolean) {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setPreview(null);
    if (commit && d.recording === recording.id && d.value !== d.clip[d.edge])
      onTrim?.(d.id, d.edge, d.value);
    callbacks.current.onTrimActive?.(false);
  }
  return (
    <div className={s.timeline} data-testid="combined-timeline">
      <div className={s.legendRow}>
        {legend && (
          <div className={s.legend} aria-label="Marker color key">
            {[...new Set(markers.map(markerColorName).concat('Blue'))].map((name) => (
              <span key={name}>
                <i style={{ background: markerColors[name] }} />
                {name}
              </span>
            ))}
          </div>
        )}
        <div className={s.zoomTools} role="group" aria-label="Timeline zoom">
          <Button
            aria-label="Zoom out timeline"
            disabled={!zoomed}
            title="Zoom out · Alt + wheel down"
            onClick={() => zoom(0.5)}
          >
            <ZoomOut size={13} />
          </Button>
          <span aria-label="Timeline zoom level">{(fullSpan / span).toFixed(1)}×</span>
          <Button
            aria-label="Zoom in timeline"
            disabled={span <= minimum + 0.00001}
            title="Zoom in · Alt + wheel up"
            onClick={() => zoom(2)}
          >
            <ZoomIn size={13} />
          </Button>
          <Button disabled={!zoomed} onClick={() => changeView({ start: fullStart, end: fullEnd })}>
            Fit full {fullStart === 0 && fullEnd === recording.duration ? 'recording' : 'clip'}
          </Button>
        </div>
        <Button
          aria-pressed={keys}
          title="The small ticks below the filmstrip mark keyframe positions"
          onClick={() => {
            setKeys(!keys);
            localStorage.setItem('virtual-cut.keyframe-ticks', String(!keys));
          }}
        >
          Keyframe ticks
        </Button>
        <Button onClick={onLegend} aria-pressed={legend} title="Show or hide marker color key">
          {legend ? 'Hide color key' : 'Color key'}
        </Button>
      </div>
      <div
        ref={track}
        className={s.track}
        data-pointer-focus={pointerFocus}
        data-testid="scrub-surface"
        role="slider"
        tabIndex={0}
        aria-label="Seek video"
        aria-valuemin={fullStart}
        aria-valuemax={fullEnd}
        aria-valuenow={Math.max(fullStart, Math.min(fullEnd, current))}
        aria-valuetext={time(current)}
        data-view-start={start}
        data-view-end={end}
        onDragStart={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (
            e.button !== 0 ||
            (e.target as HTMLElement).closest('[data-marker],[data-clip-handle]')
          )
            return;
          e.preventDefault();
          onMarkerDeselect?.();
          setPointerFocus(true);
          e.currentTarget.focus({ preventScroll: true });
          pointer.current = e.pointerId;
          onScrubActive?.(true);
          e.currentTarget.setPointerCapture(e.pointerId);
          scrub(e.clientX);
          const clip = (e.target as HTMLElement).closest<HTMLElement>('[data-clip]');
          if (clip?.dataset.clip) onSelect?.(clip.dataset.clip);
        }}
        onPointerMove={(e) => {
          if (markerDrag.current?.pointer === e.pointerId) {
            moveMarker(e.clientX);
            return;
          }
          if (drag.current?.pointer === e.pointerId) {
            moveHandle(e.clientX);
            return;
          }
          if (pointer.current === e.pointerId) scrub(e.clientX);
        }}
        onPointerUp={(e) => {
          if (markerDrag.current?.pointer === e.pointerId) {
            moveMarker(e.clientX);
            finishMarker(true);
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
            return;
          }
          if (drag.current?.pointer === e.pointerId) {
            moveHandle(e.clientX);
            finishHandle(true);
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
            return;
          }
          if (pointer.current !== e.pointerId) return;
          scrub(e.clientX);
          pointer.current = null;
          onScrubActive?.(false);
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          finishMarker(false);
          finishHandle(false);
          pointer.current = null;
          onScrubActive?.(false);
        }}
        onLostPointerCapture={() => {
          finishMarker(false);
          finishHandle(false);
          pointer.current = null;
          onScrubActive?.(false);
        }}
        onBlur={() => setPointerFocus(false)}
        onKeyDown={(e) => {
          if ((e.target as HTMLElement).closest('button') || e.ctrlKey || e.altKey || e.metaKey)
            return;
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            setPointerFocus(false);
            onSeek(
              current +
                (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 1 / (recording.fps || 30)),
            );
          }
        }}
      >
        <div className={s.ruler}>
          <span>{span < 10 ? time(start) : short(start)}</span>
          <span>{span < 10 ? time(start + span / 2) : short(start + span / 2)}</span>
          <span>{span < 10 ? time(end) : short(end)}</span>
        </div>
        <div className={s.markerLane} aria-label="Timeline markers">
          {markers
            .map((m) => (markerPreview?.id === m.id ? { ...m, time: markerPreview.time } : m))
            .filter((m) => m.time >= start && m.time < end)
            .map((m) => (
              <button
                key={m.id}
                data-marker={m.id}
                data-manipulate={handleMode}
                className={s.marker}
                style={{ left: percent(m.time), color: markerColor(m) }}
                title={`${m.category}: ${m.name} · ${time(m.time)}${handleMode ? ' · Drag or use Left/Right to move' : ''}`}
                aria-label={`Seek to marker: ${m.name}`}
                aria-pressed={m.id === selectedMarkerId}
                aria-disabled={handleMode && !trimEnabled}
                onPointerDown={(e) => {
                  if (!handleMode || !trimEnabled || !onMarkerMove || e.button !== 0) return;
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.focus({ preventScroll: true });
                  onTrimActive?.(true);
                  onMarkerSelect?.(m.id);
                  onSeek(m.time);
                  markerDrag.current = {
                    marker: m,
                    x: e.clientX,
                    value: m.time,
                    pointer: e.pointerId,
                    recording: recording.id,
                    moved: false,
                  };
                  track.current!.setPointerCapture(e.pointerId);
                }}
                onKeyDown={(e) => {
                  if (
                    !handleMode ||
                    !trimEnabled ||
                    !onMarkerMove ||
                    e.ctrlKey ||
                    e.metaKey ||
                    e.altKey ||
                    !['ArrowLeft', 'ArrowRight'].includes(e.key)
                  )
                    return;
                  e.preventDefault();
                  e.stopPropagation();
                  const direction = e.key === 'ArrowRight' ? 1 : -1;
                  const value = markerTime(
                    recording,
                    e.shiftKey ? m.time + direction : m.time,
                    e.shiftKey ? 0 : direction,
                  );
                  onMarkerSelect?.(m.id);
                  onSeek(value);
                  onMarkerMove(m.id, value);
                }}
                onClick={() => {
                  onMarkerSelect?.(m.id);
                  onSeek(m.time);
                }}
              >
                <span />
              </button>
            ))}
        </div>
        <div className={s.filmstrip} data-waveform-mode={waveMode}>
          {filmstrip.native && filmstrip.status && waveMode !== 'replace' && (
            <span className={s.frameStatus} role="status">
              {filmstrip.status}
            </span>
          )}
          <div
            className={s.frames}
            style={waveMode === 'replace' ? { visibility: 'hidden' } : undefined}
          >
            {frames.map((src, i) => (
              <div
                key={filmstrip.tiles[i].requested}
                data-tile-time={filmstrip.tiles[i].requested}
                style={{
                  left: `${(100 * (filmstrip.tiles[i].left - start)) / span}%`,
                  width: `${(100 * (filmstrip.tiles[i].right - filmstrip.tiles[i].left)) / span}%`,
                }}
                data-frame-time={filmstrip.frames[i]?.time}
                title={
                  filmstrip.frames[i]
                    ? `Keyframe ${time(filmstrip.frames[i].time)} · tile center ${time(filmstrip.frames[i].requested)}`
                    : undefined
                }
              >
                {src && <img src={src} alt="" draggable={false} />}
              </div>
            ))}
          </div>
          {waveMode !== 'off' && (
            <div
              className={`${s.waveforms} ${waveMode === 'overlay' ? s.waveOverlay : ''}`}
              aria-label="Audio waveforms"
            >
              {audioTracks.map((track) => {
                const label = track.index === recording.micTrack ? 'Mic' : 'Game',
                  data = track.waveform;
                const gain = data ? 1 / Math.max(0.01, ...data.peaks) : 1;
                const values = Array.from({ length: 512 }, (_, i) => {
                  const at = start + (i / 511) * span - track.offset;
                  if (!data || at < 0 || at >= data.duration) return 0;
                  const first = Math.floor((at / data.duration) * data.peaks.length),
                    last = Math.min(
                      data.peaks.length,
                      Math.max(
                        first + 1,
                        Math.ceil(((at + span / 511) / data.duration) * data.peaks.length),
                      ),
                    );
                  return Math.min(1, Math.max(...data.peaks.slice(first, last)) * gain);
                });
                const points =
                  values.map((v, i) => `${i},${25 - v * 23}`).join(' ') +
                  ' ' +
                  values.map((v, i) => `${511 - i},${25 + values[511 - i] * 23}`).join(' ');
                return (
                  <div
                    key={track.index}
                    className={s.waveLane}
                    data-waveform-track={track.index}
                    title="Waveform amplitude is scaled per track for visibility; listening volume is unchanged"
                  >
                    <span>
                      {label}
                      {!data ? ' · Preparing…' : ''}
                    </span>
                    {data && (
                      <svg
                        viewBox="0 0 511 50"
                        preserveAspectRatio="none"
                        role="img"
                        aria-label={`${label} waveform`}
                      >
                        <polygon points={points} />
                      </svg>
                    )}
                  </div>
                );
              })}
              {!audioTracks.length && <span>No audio track selected</span>}
            </div>
          )}
        </div>
        {keys && (
          <div className={s.ticks} aria-label="Keyframe positions" title="Keyframe positions">
            {(recording.keys || [])
              .filter((k) => k >= start && k <= end)
              .map((k) => (
                <i key={k} style={{ left: percent(k) }} />
              ))}
          </div>
        )}
        {showClips && (
          <div
            className={s.clips}
            aria-label="Clip selection"
            data-clip-lanes={layout.lanes}
            style={{ '--clip-lanes': layout.lanes } as CSSProperties}
          >
            {layout.overlaps.map((overlap) => (
              <div
                key={overlap.start}
                className={s.overlap}
                data-overlap-count={overlap.count}
                aria-label={`${overlap.count} overlapping clips: ${time(overlap.start)} to ${time(overlap.end)}`}
                title={`${overlap.count} overlapping clips · ${time(overlap.start)} – ${time(overlap.end)}`}
                style={{
                  left: percent(overlap.start),
                  width: `${(100 * (overlap.end - overlap.start)) / span}%`,
                }}
              />
            ))}
            {layout.items.map(({ clip, index, lane }) => {
              const c = displayClip(clip);
              return (
                <div
                  key={c.id}
                  data-clip-container={c.id}
                  data-clip-lane={lane}
                  className={s.clip}
                  data-selected={c.id === selectedId}
                  data-handle-mode={handleMode}
                  data-clipped-start={c.start < start}
                  data-clipped-end={c.end > end}
                  title={`${String(index + 1).padStart(2, '0')} · ${c.name} · ${time(c.start)} – ${time(c.end)}${layout.overlaps.some((o) => o.start < c.end && o.end > c.start) ? ' · Overlaps another clip' : ''}`}
                  style={
                    {
                      '--clip-color': clipColor(c.id),
                      '--clip-lane': lane,
                      left: percent(c.start),
                      width: `${(100 * (Math.min(end, c.end) - Math.max(start, c.start))) / span}%`,
                    } as CSSProperties
                  }
                >
                  <button
                    className={s.clipLabel}
                    data-clip={c.id}
                    aria-label={`Select clip: ${c.name}`}
                    aria-pressed={c.id === selectedId}
                    onClick={(e) => {
                      if (e.detail === 0) onSelect?.(c.id);
                    }}
                  >
                    <b>{String(index + 1).padStart(2, '0')}</b> <span>{c.name}</span>
                  </button>
                  {handleMode &&
                    (['start', 'end'] as const)
                      .filter((edge) => c[edge] >= start && c[edge] <= end)
                      .map((edge) => (
                        <button
                          key={edge}
                          className={s.handle}
                          data-clip-handle={edge}
                          title={`Trim ${edge === 'start' ? 'in' : 'out'} point · drag or use arrow keys`}
                          aria-label={`Trim ${edge} of ${c.name}`}
                          aria-disabled={!trimEnabled}
                          onPointerDown={(e) => {
                            if (e.button !== 0 || !trimEnabled) return;
                            e.preventDefault();
                            e.stopPropagation();
                            onTrimActive?.(true);
                            onSelect?.(c.id);
                            drag.current = {
                              id: c.id,
                              edge,
                              clip,
                              value: c[edge],
                              pointer: e.pointerId,
                              recording: recording.id,
                            };
                            // The track remains mounted if a zoomed trim moves the
                            // clip/edge outside the viewport during this gesture.
                            track.current!.setPointerCapture(e.pointerId);
                          }}
                          onPointerMove={(e) => {
                            if (drag.current?.pointer === e.pointerId) moveHandle(e.clientX);
                          }}
                          onPointerUp={(e) => {
                            if (drag.current?.pointer !== e.pointerId) return;
                            moveHandle(e.clientX);
                            finishHandle(true);
                            if (e.currentTarget.hasPointerCapture(e.pointerId))
                              e.currentTarget.releasePointerCapture(e.pointerId);
                          }}
                          onPointerCancel={() => finishHandle(false)}
                          onLostPointerCapture={() => finishHandle(false)}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (!trimEnabled) return;
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              finishHandle(false);
                            }
                            if (
                              ['ArrowLeft', 'ArrowRight'].includes(e.key) &&
                              !e.ctrlKey &&
                              !e.altKey &&
                              !e.metaKey
                            ) {
                              e.preventDefault();
                              e.stopPropagation();
                              onSelect?.(c.id);
                              onTrim?.(
                                c.id,
                                edge,
                                trimTime(
                                  c,
                                  edge,
                                  c[edge] +
                                    (e.key === 'ArrowRight' ? 1 : -1) / (recording.fps || 30),
                                  e.key === 'ArrowRight' ? 1 : -1,
                                ),
                              );
                            }
                          }}
                        />
                      ))}
                </div>
              );
            })}
          </div>
        )}
        {current >= start && current <= end && (
          <div className={s.playhead} style={{ left: percent(current) }} />
        )}
      </div>
      {zoomed && (
        <div className={s.panTools} role="group" aria-label="Timeline pan">
          <Button
            aria-label="Pan timeline left"
            disabled={start <= fullStart + 0.00001}
            onClick={() => changeView({ start: start - span * 0.75, end: end - span * 0.75 })}
          >
            <ArrowLeft size={13} />
          </Button>
          <input
            type="range"
            aria-label="Visible timeline start"
            min={fullStart}
            max={fullEnd - span}
            step={Math.max(0.00001, minimum / 4)}
            value={start}
            onChange={(e) =>
              changeView({ start: Number(e.target.value), end: Number(e.target.value) + span })
            }
          />
          <Button
            aria-label="Pan timeline right"
            disabled={end >= fullEnd - 0.00001}
            onClick={() => changeView({ start: start + span * 0.75, end: end + span * 0.75 })}
          >
            <ArrowRight size={13} />
          </Button>
          <Button
            aria-label="Show playhead in timeline"
            title="Center the visible range on the playhead"
            onClick={() => changeView({ start: current - span / 2, end: current + span / 2 })}
          >
            <LocateFixed size={13} />
          </Button>
        </div>
      )}
    </div>
  );
}
