import { useEffect, useState } from 'react';
import s from './TranscriptWindow.module.css';

/** A time edited in place on a proposal (VC-155): seconds, ±0.1 s / ±1 s nudges and Playhead. */
export function TimeField({
  name,
  value,
  playhead,
  onChange,
}: {
  name: string;
  value: number;
  playhead: number;
  onChange: (seconds: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const set = (seconds: number) => onChange(Math.max(0, Math.round(seconds * 1000) / 1000));
  return (
    <span className={s.timeField}>
      <input
        aria-label={name}
        className={s.inlineTime}
        type="number"
        min={0}
        step="0.001"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.trim() && Number.isFinite(Number(e.target.value)))
            onChange(Number(e.target.value));
        }}
      />
      <span className={s.nudge}>
        {[-1, -0.1, 0.1, 1].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${name} ${n > 0 ? '+' : '−'}${Math.abs(n)} s`}
            onClick={() => set(value + n)}
          >
            {n > 0 ? '+' : '−'}
            {Math.abs(n)}
          </button>
        ))}
        <button type="button" aria-label={`${name} to playhead`} onClick={() => set(playhead)}>
          Playhead
        </button>
      </span>
    </span>
  );
}
