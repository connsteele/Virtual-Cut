import type { SubtitleRole, TranscriptOutputs } from '../../electron/export-contracts';
import s from './Workflow.module.css';

const roles: { role: SubtitleRole; label: string; file: string }[] = [
  { role: 'game', label: 'Game dialogue', file: '.srt' },
  { role: 'mic', label: 'Microphone notes', file: '.mic.srt' },
];
export const noTranscript: TranscriptOutputs = { roles: [], srt: false, companion: false };
/** Only roles with a finished transcript are sent; nothing is sent without an output chosen. */
export const chosenTranscript = (value: TranscriptOutputs, available: readonly SubtitleRole[]) => {
  const picked = value.roles.filter((r) => available.includes(r));
  return picked.length && (value.srt || value.companion)
    ? { ...value, roles: picked }
    : noTranscript;
};

/**
 * The transcript option offered with video export and filing (VC-94, VC-154). Everything is cut
 * to the verified clip and comes from the latest finished transcript; nothing is transcribed
 * again.
 */
export function TranscriptChoice({
  available,
  value,
  onChange,
  missingNote,
}: {
  /** Roles with a finished transcript for the recording(s) being exported. */
  available: readonly SubtitleRole[];
  value: TranscriptOutputs;
  onChange: (value: TranscriptOutputs) => void;
  /** Shown when only some of the clips have a finished transcript. */
  missingNote?: string;
}) {
  const any = value.roles.some((r) => available.includes(r));
  return (
    <fieldset className={s.subtitleChoice}>
      <legend>Transcript</legend>
      {roles.map(({ role, label }) => {
        const ready = available.includes(role);
        return (
          <label key={role} className={s.tools}>
            <input
              type="checkbox"
              aria-label={`${label} transcript`}
              checked={ready && value.roles.includes(role)}
              disabled={!ready}
              onChange={(e) =>
                onChange({
                  ...value,
                  roles: e.target.checked
                    ? [...value.roles, role]
                    : value.roles.filter((r) => r !== role),
                })
              }
            />
            {label}
            {!ready && (
              <span className={s.muted}>no finished {label.toLowerCase()} transcript</span>
            )}
          </label>
        );
      })}
      <div className={s.subtitleOutputs}>
        <label className={s.tools}>
          <input
            type="checkbox"
            aria-label="SRT subtitles beside the video"
            checked={value.srt}
            disabled={!any}
            onChange={(e) => onChange({ ...value, srt: e.target.checked })}
          />
          SRT subtitles beside the video
          <span className={s.muted}>
            {roles
              .filter((r) => value.roles.includes(r.role) && available.includes(r.role))
              .map((r) => `<video>${r.file}`)
              .join(', ') || 'choose a transcript above'}
          </span>
        </label>
        <label className={s.tools}>
          <input
            type="checkbox"
            aria-label="Transcript history in the companion"
            checked={value.companion}
            disabled={!any}
            onChange={(e) => onChange({ ...value, companion: e.target.checked })}
          />
          Transcript history in the .vcut.json companion
          <span className={s.muted}>original words, corrections and word timing</span>
        </label>
      </div>
      <p className={s.muted}>
        Cut to the clip's verified range from the latest finished transcript. Nothing is transcribed
        again, and an existing file is never replaced.
        {missingNote ? ` ${missingNote}` : ''}
      </p>
    </fieldset>
  );
}
