import { useEffect, useRef, useState } from 'react';
import { LocateFixed } from 'lucide-react';
import { parsePosition, positionText } from './timelineRuler';
import s from './TranscriptWindow.module.css';

/** The nudges under a time field, left to right (VC-174). */
const nudges = [-1, -0.1, null, 0.1, 1] as const;

/**
 * A time edited in place on a proposal (VC-155): the ruler's format, wide enough for any time,
 * with −1 s, −0.1 s, Playhead, +0.1 s and +1 s in one row under it (VC-174). With the field
 * focused, ↑/↓ nudge 0.1 s and Shift+↑/↓ 1 s. A jump button beside the field goes to the time as
 * edited; the two sit centered over the row.
 */
export function TimeField({
  name,
  value,
  playhead,
  onChange,
  onSeek,
  seekTitle,
}: {
  name: string;
  value: number;
  playhead: number;
  onChange: (seconds: number) => void;
  /** Go to the time as edited, before anything is accepted. */
  onSeek: (seconds: number) => void;
  seekTitle: string;
}) {
  const [text, setText] = useState(positionText(value));
  // The last time set here: held keys can nudge again before the new value comes back.
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
    setText(positionText(value));
  }, [value]);
  const set = (seconds: number) => {
    latest.current = Math.max(0, Math.round(seconds * 1000) / 1000);
    setText(positionText(latest.current));
    onChange(latest.current);
  };
  return (
    <span className={s.timeField}>
      <span className={s.timeTop}>
        <input
          aria-label={name}
          className={s.inlineTime}
          value={text}
          spellCheck={false}
          title="hh:mm:ss.mmm, like the ruler; seconds work too. ↑/↓ nudge 0.1 s, Shift for 1 s"
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const seconds = parsePosition(text);
            if (seconds == null) setText(positionText(value));
            else if (seconds !== value) onChange(seconds);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.ctrlKey && !e.altKey) {
              // From what is typed, when it reads as a time; otherwise from the current value.
              const step = (e.shiftKey ? 1 : 0.1) * (e.key === 'ArrowUp' ? 1 : -1);
              set((parsePosition(e.currentTarget.value) ?? latest.current) + step);
              e.preventDefault();
            }
          }}
        />
        <button
          type="button"
          className={s.timeJump}
          title={seekTitle}
          aria-label={`${name} go to`}
          onClick={() => onSeek(parsePosition(text) ?? latest.current)}
        >
          <LocateFixed size={15} aria-hidden />
        </button>
      </span>
      <span className={s.nudge}>
        {nudges.map((n) =>
          n == null ? (
            <button
              key="playhead"
              type="button"
              aria-label={`${name} to playhead`}
              onClick={() => set(playhead)}
            >
              Playhead
            </button>
          ) : (
            <button
              key={n}
              type="button"
              aria-label={`${name} ${n > 0 ? '+' : '−'}${Math.abs(n)} s`}
              onClick={() => set(latest.current + n)}
            >
              {n > 0 ? '+' : '−'}
              {Math.abs(n)} s
            </button>
          ),
        )}
      </span>
    </span>
  );
}
