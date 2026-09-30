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
import s from './Timeline.module.css';

export function Timeline({
  recording,
  markers,
  clips,
  selectedId,
  showClips,
  legend,
  onLegend,
  start,
  end,
  current,
  onSeek,
  onSelect,
  selectedMarkerId,
  onMarkerSelect,
  onMarkerDeselect,
  waveMode = 'off',
  audioTracks = [],
  handleMode = false,
  trimEnabled = true,
  onTrim,
  onTrimActive,
}: {
  recording: Recording;
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
  waveMode?: 'off' | 'overlay' | 'replace';
  audioTracks?: AudioTrack[];
  handleMode?: boolean;
  trimEnabled?: boolean;
  onTrim?: (id: string, edge: 'start' | 'end', value: number) => void;
  onTrimActive?: (active: boolean) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const drag = useRef<{
    id: string;
    edge: 'start' | 'end';
    clip: Clip;
    value: number;
    pointer: number;
    recording: string;
  } | null>(null);
  const callbacks = useRef({ onTrimActive });
  const [preview, setPreview] = useState<{
    id: string;
    edge: 'start' | 'end';
    value: number;
  } | null>(null);
  const [pointerFocus, setPointerFocus] = useState(false);
  useEffect(() => {
    callbacks.current = { onTrimActive };
  }, [onTrimActive]);
  useEffect(() => {
    const cancel = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !drag.current) return;
      e.preventDefault();
      drag.current = null;
      setPreview(null);
      callbacks.current.onTrimActive?.(false);
    };
    document.addEventListener('keydown', cancel);
    return () => {
      document.removeEventListener('keydown', cancel);
      drag.current = null;
      setPreview(null);
      callbacks.current.onTrimActive?.(false);
    };
  }, [handleMode, recording.id, trimEnabled]);
  const [width, setWidth] = useState(640);
  const [keys, setKeys] = useState(
    () => localStorage.getItem('virtual-cut.keyframe-ticks') !== 'false',
  );
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    if (track.current) observer.observe(track.current);
    return () => observer.disconnect();
  }, []);
  const span = Math.max(0.001, end - start);
  const displayClip = (c: Clip) =>
    preview?.id === c.id ? { ...c, [preview.edge]: preview.value } : c;
  const layout = layoutClips(showClips ? clips.map(displayClip) : [], start, end);
  const percent = (t: number) => `${100 * Math.max(0, Math.min(1, (t - start) / span))}%`;
  // Enough whole 16:9 tiles to fill the strip; sample the nearest available source thumbnail.
  const count = Math.max(1, Math.ceil(width / 120));
  const frames = Array.from({ length: count }, (_, i) => {
    const at = start + ((i + 0.5) / count) * span;
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
        aria-valuemin={start}
        aria-valuemax={end}
        aria-valuenow={Math.max(start, Math.min(end, current))}
        aria-valuetext={time(current)}
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
          e.currentTarget.setPointerCapture(e.pointerId);
          scrub(e.clientX);
          const clip = (e.target as HTMLElement).closest<HTMLElement>('[data-clip]');
          if (clip?.dataset.clip) onSelect?.(clip.dataset.clip);
        }}
        onPointerMove={(e) => {
          if (pointer.current === e.pointerId) scrub(e.clientX);
        }}
        onPointerUp={(e) => {
          if (pointer.current !== e.pointerId) return;
          scrub(e.clientX);
          pointer.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          pointer.current = null;
        }}
        onLostPointerCapture={() => {
          pointer.current = null;
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
          <span>{short(start)}</span>
          <span>{short(start + span / 2)}</span>
          <span>{short(end)}</span>
        </div>
        <div className={s.markerLane} aria-label="Timeline markers">
          {markers
            .filter((m) => m.time >= start && m.time < end)
            .map((m) => (
              <button
                key={m.id}
                data-marker={m.id}
                className={s.marker}
                style={{ left: percent(m.time), color: markerColor(m) }}
                title={`${m.category}: ${m.name} · ${time(m.time)}`}
                aria-label={`Seek to marker: ${m.name}`}
                aria-pressed={m.id === selectedMarkerId}
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
          <div
            className={s.frames}
            style={waveMode === 'replace' ? { visibility: 'hidden' } : undefined}
          >
            {frames.map((src, i) => (
              <div key={i}>{src && <img src={src} alt="" draggable={false} />}</div>
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
                    (['start', 'end'] as const).map((edge) => (
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
                          e.currentTarget.setPointerCapture(e.pointerId);
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
                                c[edge] + (e.key === 'ArrowRight' ? 1 : -1) / (recording.fps || 30),
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
        <div className={s.playhead} style={{ left: percent(current) }} />
      </div>
    </div>
  );
}
