import { useEffect, useState } from 'react';
import { parsePosition, positionText } from './timelineRuler';
import s from './TranscriptWindow.module.css';

/** A time edited in place on a proposal (VC-155): the ruler's format, ±0.1 s / ±1 s nudges, Playhead. */
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
  const [text, setText] = useState(positionText(value));
  useEffect(() => setText(positionText(value)), [value]);
  const set = (seconds: number) => onChange(Math.max(0, Math.round(seconds * 1000) / 1000));
  return (
    <span className={s.timeField}>
      <input
        aria-label={name}
        className={s.inlineTime}
        value={text}
        spellCheck={false}
        title="hh:mm:ss.mmm, like the ruler; seconds work too"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const seconds = parsePosition(text);
          if (seconds == null) setText(positionText(value));
          else if (seconds !== value) onChange(seconds);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
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
