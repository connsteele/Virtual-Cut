import type { SubtitleRole } from '../../electron/export-contracts';
import s from './Workflow.module.css';

const roles: { role: SubtitleRole; label: string; file: string }[] = [
  { role: 'game', label: 'Game dialogue', file: '.srt' },
  { role: 'mic', label: 'Microphone notes', file: '.mic.srt' },
];

/**
 * The transcript option offered with video export and filing (VC-94). Each SRT is cut to the
 * verified clip and named after the video; nothing is transcribed again.
 */
export function SubtitleChoice({
  available,
  value,
  onChange,
  missingNote,
}: {
  /** Roles with a finished transcript for the recording(s) being exported. */
  available: SubtitleRole[];
  value: SubtitleRole[];
  onChange: (value: SubtitleRole[]) => void;
  /** Shown when only some of the clips have a finished transcript. */
  missingNote?: string;
}) {
  return (
    <fieldset className={s.subtitleChoice}>
      <legend>Subtitles (SRT)</legend>
      {roles.map(({ role, label, file }) => {
        const ready = available.includes(role);
        return (
          <label key={role} className={s.tools}>
            <input
              type="checkbox"
              aria-label={`${label} subtitles`}
              checked={ready && value.includes(role)}
              disabled={!ready}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, role] : value.filter((r) => r !== role))
              }
            />
            {label}
            <span className={s.muted}>
              {ready ? `saved as <video>${file}` : `no finished ${label.toLowerCase()} transcript`}
            </span>
          </label>
        );
      })}
      <p className={s.muted}>
        Written beside the video from the latest finished transcript and cut to the clip's verified
        range. Nothing is transcribed again, and an existing file is never replaced.
        {missingNote ? ` ${missingNote}` : ''}
      </p>
    </fieldset>
  );
}
