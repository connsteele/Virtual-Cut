import { useCallback, useEffect, useState } from 'react';
import type { TranscriptApi } from '../../electron/transcript-contracts';
import type { SpeechSetupAction, SpeechSetupState } from '../../electron/speech-setup-contracts';
import { Button } from './ui';
import s from './TranscriptWindow.module.css';

const size = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GB`;
export function SpeechSetup({
  api,
  onActivated,
}: {
  api: TranscriptApi;
  onActivated: () => Promise<void>;
}) {
  const [state, setState] = useState<SpeechSetupState>();
  const [gpu, setGpu] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setState(await api.speechSetup('status'));
  }, [api]);
  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
  }, [refresh]);
  useEffect(() => {
    if (state?.state !== 'installing') return;
    let pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      void refresh()
        .catch((e) => setError(String(e)))
        .finally(() => {
          pending = false;
        });
    }, 1000);
    return () => clearInterval(timer);
  }, [state?.state, refresh]);
  const act = async (action: SpeechSetupAction) => {
    setBusy(true);
    setError('');
    try {
      setState(await api.speechSetup(action, gpu));
      if (action === 'activate' || action === 'restore') await onActivated();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const installing = state?.state === 'installing';
  return (
    <section aria-label="Download local speech setup" className={s.install}>
      <h3>Download local speech setup</h3>
      <p>
        Install a separate, tested recognition engine and large-v3 model in a folder you choose.
        Downloading needs an internet connection; transcription runs locally. No account or audio
        upload is needed.
      </p>
      <label>
        <input
          type="checkbox"
          checked={gpu}
          disabled={busy || installing}
          onChange={(e) => {
            setGpu(e.target.checked);
            setState(undefined);
          }}
        />{' '}
        Include NVIDIA acceleration libraries (compatible NVIDIA driver required)
      </label>
      <div className={s.toolbar}>
        <Button disabled={busy || installing} onClick={() => void act('plan')}>
          Choose setup folder…
        </Button>
        {state?.canRestore && (
          <Button disabled={busy || installing} onClick={() => void act('restore')}>
            Restore previous setup
          </Button>
        )}
      </div>
      {state && state.state !== 'idle' && (
        <>
          <p className={s.muted}>{state.version}</p>
          <p className={s.path}>{state.folder}</p>
          <p>
            Download: {size(state.downloadBytes)} · Installed: {size(state.installedBytes)}
            <br />
            Space needed: {size(state.requiredBytes)} · Available: {size(state.availableBytes)}
          </p>
          <p role="status">{state.message}</p>
          {installing && (
            <>
              <progress
                aria-label="Speech setup download progress"
                max={state.downloadBytes}
                value={state.downloadedBytes}
              />
              <p className={s.muted}>{size(state.downloadedBytes)} downloaded</p>
              <Button disabled={busy} onClick={() => void act('cancel')}>
                Cancel setup
              </Button>
            </>
          )}
          {state.state === 'planned' && (
            <Button
              primary
              disabled={busy || state.availableBytes < state.requiredBytes}
              onClick={() => void act('start')}
            >
              Download and install
            </Button>
          )}
          {state.state === 'ready' && (
            <Button primary disabled={busy} onClick={() => void act('activate')}>
              Use this setup
            </Button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      <details className={s.help}>
        <summary>Sources, licenses and storage</summary>
        <p>
          Python 3.12.10 (PSF license), faster-whisper 1.2.1 / CTranslate2 4.8.2 (MIT), and the
          Systran large-v3 model (MIT). Optional cuBLAS uses NVIDIA’s license. Downloads come from
          Python.org, PyPI and Hugging Face and are verified against a pinned manifest. Dependency
          license files remain in the installed libraries. Installation archives are removed after
          extraction.
        </p>
        <p>
          Opening this window loads no speech model. Failed or cancelled setup removes its
          incomplete folder; a working setup is kept. After an unexpected app exit, an incomplete
          install folder may remain. Completed setups are shared across projects and are kept by
          project cleanup.
        </p>
        <div className={s.toolbar}>
          {(['python', 'engine', 'gpu', 'model'] as const).map((topic) => (
            <Button
              key={topic}
              onClick={() => void api.setupHelp(topic).catch((e) => setError(String(e)))}
            >
              {topic} source / license
            </Button>
          ))}
        </div>
      </details>
    </section>
  );
}
