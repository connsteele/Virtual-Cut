import type { TranscriptionOptions as Options } from '../../electron/transcript-contracts';
import { Field } from './ui';
import s from './Workflow.module.css';
export const initialTranscriptionOptions: Options = {
  roles: ['game'],
  language: 'en',
  vocabulary: false,
};
export function TranscriptionOptions({
  value,
  onChange,
}: {
  value: Options;
  onChange: (value: Options) => void;
}) {
  return (
    <div className={s.pair}>
      <Field label="Transcribe audio">
        <select
          value={value.roles.length === 2 ? 'both' : value.roles[0]}
          onChange={(e) =>
            onChange({
              ...value,
              roles:
                e.target.value === 'both' ? ['game', 'mic'] : [e.target.value as 'game' | 'mic'],
            })
          }
        >
          <option value="game">Game dialogue</option>
          <option value="mic">Microphone notes</option>
          <option value="both">Game and microphone separately</option>
        </select>
      </Field>
      <Field label="Speech language">
        <select
          value={value.language}
          onChange={(e) => onChange({ ...value, language: e.target.value })}
        >
          <option value="">Detect automatically</option>
          <option value="en">English</option>
          <option value="ja">Japanese</option>
          <option value="es">Spanish</option>
          <option value="fr">French</option>
          <option value="de">German</option>
          <option value="ko">Korean</option>
          <option value="zh">Chinese</option>
        </select>
      </Field>
      <label>
        <input
          type="checkbox"
          checked={value.vocabulary}
          onChange={(e) => onChange({ ...value, vocabulary: e.target.checked })}
        />{' '}
        Use this batch’s names and game terms as recognition hints
      </label>
    </div>
  );
}
