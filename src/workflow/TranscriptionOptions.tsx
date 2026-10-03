import { useEffect, useState } from 'react';
import type { TranscriptApi } from '../../electron/transcript-contracts';
import type { TranscriptionOptions as Options } from '../../electron/transcript-contracts';
import { Button, Field } from './ui';
import s from './Workflow.module.css';
import d from './TranscriptionOptions.module.css';
export const initialTranscriptionOptions: Options = {
  roles: ['game', 'mic'],
  device: 'auto',
  language: 'en',
  vocabulary: false,
};
export function TranscriptionOptions({
  value,
  onChange,
  onReadyChange,
}: {
  value: Options;
  onChange: (value: Options) => void;
  onReadyChange: (ready: boolean) => void;
}) {
  const device = value.device || 'auto';
  const [attempt, setAttempt] = useState(0);
  const [allowCpu, setAllowCpu] = useState(false);
  const [checked, setChecked] = useState<{
    device: string;
    attempt: number;
    runtime?: Awaited<ReturnType<TranscriptApi['runtime']>>;
    error?: string;
  }>();
  useEffect(() => {
    if (device === 'cpu') return;
    let alive = true;
    void window
      .virtualCut!.transcript.runtime(attempt > 0)
      .then((runtime) => {
        if (alive) setChecked({ device, attempt, runtime });
      })
      .catch((error) => {
        if (alive) setChecked({ device, attempt, error: String(error) });
      });
    return () => {
      alive = false;
    };
  }, [device, attempt]);
  const result = checked?.device === device && checked.attempt === attempt ? checked : undefined;
  const ready =
    device === 'cpu' ||
    !!(
      result?.runtime?.configured &&
      (result.runtime.gpu?.available || (device === 'auto' && allowCpu))
    );
  useEffect(() => onReadyChange(ready), [onReadyChange, ready, device, attempt]);
  return (
    <>
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
          Processing device
          <select
            aria-label="Processing device"
            value={value.device || 'auto'}
            onChange={(e) => {
              setAllowCpu(false);
              onReadyChange(false);
              onChange({ ...value, device: e.target.value as Options['device'] });
            }}
          >
            <option value="auto">Automatic · prefer NVIDIA GPU</option>
            <option value="cuda">NVIDIA GPU</option>
            <option value="cpu">CPU</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={value.vocabulary}
            onChange={(e) => onChange({ ...value, vocabulary: e.target.checked })}
          />{' '}
          Use this batch’s names and game terms as recognition hints
        </label>
      </div>
      {device !== 'cpu' && (
        <section
          aria-label="Transcription device readiness"
          className={`${d.status} ${result && !result.runtime?.gpu?.available ? d.warning : ''}`}
        >
          <p role={result && !result.runtime?.gpu?.available ? 'alert' : 'status'}>
            {!result
              ? 'Checking NVIDIA GPU availability…'
              : result.error
                ? 'GPU availability could not be checked. Check again, or choose CPU.'
                : !result.runtime?.configured
                  ? 'Local transcription is not ready. Open Transcript settings to set up speech recognition.'
                  : result.runtime.gpu?.available
                    ? 'NVIDIA GPU is available. Recognition will check model startup when the job begins.'
                    : device === 'auto'
                      ? 'NVIDIA GPU is unavailable. Automatic will use CPU, which can take much longer.'
                      : 'NVIDIA GPU is unavailable. Set up the GPU runtime in Transcript settings, or choose CPU.'}
          </p>
          {result && !result.runtime?.gpu?.available && (
            <>
              <details>
                <summary>GPU check details</summary>
                <p>{result.error || result.runtime?.gpu?.message}</p>
              </details>
              {device === 'auto' && result.runtime?.configured && (
                <label>
                  <input
                    type="checkbox"
                    checked={allowCpu}
                    onChange={(e) => setAllowCpu(e.target.checked)}
                  />{' '}
                  Continue this request on CPU
                </label>
              )}
            </>
          )}
          {result && (
            <Button
              onClick={() => {
                setAllowCpu(false);
                onReadyChange(false);
                setAttempt(attempt + 1);
              }}
            >
              Check again
            </Button>
          )}
        </section>
      )}
    </>
  );
}
