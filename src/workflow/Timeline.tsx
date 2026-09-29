import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { colors, time, short, type Clip, type Marker, type Recording } from './model';
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
}) {
  const track = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    if (track.current) observer.observe(track.current);
    return () => observer.disconnect();
  }, []);
  const span = Math.max(0.001, end - start);
  const layout = layoutClips(showClips ? clips : [], start, end);
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
  return (
    <div className={s.timeline} data-testid="combined-timeline">
      <div className={s.legendRow}>
        {legend && (
          <div className={s.legend} aria-label="Marker color key">
            {Object.entries(colors).map(([name, color]) => (
              <span key={name}>
                <i style={{ background: color }} />
                {name}
              </span>
            ))}
          </div>
        )}
        <Button onClick={onLegend} aria-pressed={legend} title="Show or hide marker color key">
          {legend ? 'Hide color key' : 'Color key'}
        </Button>
      </div>
      <div
        ref={track}
        className={s.track}
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
          if (e.button !== 0 || (e.target as HTMLElement).closest('[data-marker]')) return;
          e.preventDefault();
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
        onKeyDown={(e) => {
          if ((e.target as HTMLElement).closest('button') || e.ctrlKey || e.altKey || e.metaKey)
            return;
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
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
                style={{ left: percent(m.time), color: colors[m.category] }}
                title={`${m.category}: ${m.name} · ${time(m.time)}`}
                aria-label={`Seek to marker: ${m.name}`}
                onClick={() => onSeek(m.time)}
              >
                <span />
              </button>
            ))}
        </div>
        <div className={s.frames}>
          {frames.map((src, i) => (
            <div key={i}>{src && <img src={src} alt="" draggable={false} />}</div>
          ))}
        </div>
        <div className={s.ticks}>
          {(recording.keys || [])
            .filter((k) => k >= start && k <= end)
            .map((k) => (
              <i key={k} style={{ left: percent(k) }} />
            ))}
        </div>
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
            {layout.items.map(({ clip: c, index, lane }) => (
              <button
                key={c.id}
                data-clip={c.id}
                data-clip-lane={lane}
                className={s.clip}
                aria-pressed={c.id === selectedId}
                aria-label={`Select clip: ${c.name}`}
                title={`${String(index + 1).padStart(2, '0')} · ${c.name} · ${time(c.start)} – ${time(c.end)}${layout.overlaps.some((o) => o.start < c.end && o.end > c.start) ? ' · Overlaps another clip' : ''}`}
                style={
                  {
                    '--clip-color': clipColor(c.id),
                    '--clip-lane': lane,
                    left: percent(c.start),
                    width: `${(100 * (Math.min(end, c.end) - Math.max(start, c.start))) / span}%`,
                  } as CSSProperties
                }
                onClick={(e) => {
                  if (e.detail === 0) onSelect?.(c.id);
                }}
              >
                <b>{String(index + 1).padStart(2, '0')}</b> <span>{c.name}</span>
              </button>
            ))}
          </div>
        )}
        <div className={s.playhead} style={{ left: percent(current) }} />
      </div>
    </div>
  );
}
