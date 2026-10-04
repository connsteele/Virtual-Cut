import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranscriptApi } from '../../electron/transcript-contracts';
import type {
  SpeechSetupAction,
  SpeechSetupLocation,
  SpeechSetupState,
} from '../../electron/speech-setup-contracts';
import { Button, Field } from './ui';
import s from './TranscriptWindow.module.css';
import { background } from './background';
import { useWindowFocus } from './useWindowFocus';

type Runtime = Awaited<ReturnType<TranscriptApi['runtime']>>;
const size = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GB`;
const name = (location: SpeechSetupLocation) =>
  location.kind === 'downloaded' ? 'Virtual Cut speech engine' : 'Your own Python installation';
/** The one button that returns to the previous engine, named by what it returns to. */
const switchBack = (current: SpeechSetupLocation, other: SpeechSetupLocation) =>
  other.kind === 'downloaded'
    ? current.kind === 'downloaded'
      ? undefined
      : 'Use the downloaded engine again'
    : current.kind === 'manual'
      ? 'Use my previous installation again'
      : 'Use my own installation again';

/**
 * One speech engine: its status and location, a download that is used as soon as it
 * passes its check, and your own Python installation tucked under Advanced.
 */
export function SpeechSetup({
  api,
  runtime,
  onRuntimeChanged,
}: {
  api: TranscriptApi;
  runtime?: Runtime;
  onRuntimeChanged: (refresh?: boolean) => Promise<void>;
}) {
  const [state, setState] = useState<SpeechSetupState>();
  const [gpu, setGpu] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const previous = useRef<SpeechSetupState['state']>(undefined);
  const refresh = useCallback(async () => {
    const next = await api.speechSetup('status');
    // A download that just finished is already in use: say so and recheck the engine.
    if (previous.current === 'installing' && next.state !== 'installing') {
      setNotice(next.message);
      await onRuntimeChanged(true);
    }
    previous.current = next.state;
    setState(next);
  }, [api, onRuntimeChanged]);
  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
  }, [refresh]);
  useWindowFocus(useCallback(() => background(refresh()), [refresh]));
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
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await task();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const selectedGpu = state && state.state !== 'idle' ? state.includeGpu : gpu;
  const act = (action: SpeechSetupAction) =>
    run(async () => {
      const next = await api.speechSetup(action, selectedGpu);
      previous.current = next.state;
      setState(next);
      if (['activate', 'restore', 'remove-other'].includes(action)) {
        setNotice(next.notice ?? next.message);
        await onRuntimeChanged(true);
      }
    });
  const configure = (
    part: Parameters<TranscriptApi['configure']>[0],
    device?: Runtime['settings']['device'],
  ) =>
    run(async () => {
      await api.configure(part, device);
      await onRuntimeChanged();
      await refresh();
    });
  const installing = state?.state === 'installing';
  const current = state?.current,
    other = state?.other;
  const known = !!runtime && (runtime.configured || !!runtime.removed);
  const status = installing
    ? 'Installing…'
    : runtime?.configured
      ? 'Ready'
      : runtime?.removed
        ? 'Files missing'
        : 'Not installed';
  const back = current && other?.available ? switchBack(current, other) : undefined;
  const ownInUse = current?.kind === 'manual' && known;
  return (
    <>
      <div className={s.engine} aria-label={`Speech engine: ${status}`}>
        <div className={s.engineHeader}>
          <strong>{current && known ? name(current) : 'Speech engine'}</strong>
          <span className={`${s.chip} ${runtime?.configured ? s.chipReady : s.chipWarn}`}>
            {status}
          </span>
        </div>
        {current && known && (
          <>
            {current.kind === 'downloaded' ? (
              <p className={s.path}>{current.folder}</p>
            ) : (
              <p className={s.path}>
                Python {current.python}
                <br />
                Model {current.model}
              </p>
            )}
            <div className={s.toolbar}>
              <Button disabled={busy} onClick={() => background(act('reveal-current'))}>
                Open folder
              </Button>
            </div>
          </>
        )}
        {runtime?.removed && (
          <p className={s.error} role="alert" aria-label="Speech engine files missing">
            {runtime.removed} It may have been moved or deleted. Download it again below
            {back ? `, or ${back[0].toLowerCase()}${back.slice(1)} under Advanced` : ''}.
          </p>
        )}
        {!known && (
          <p>
            Download the speech engine to transcribe on this computer. Recognition runs locally; no
            audio is uploaded.
          </p>
        )}
        {runtime?.configured && <p role="status">{runtime.gpu?.message}</p>}
      </div>
      <Field label="Recognition device">
        <select
          value={runtime?.settings.device || 'auto'}
          disabled={busy}
          onChange={(e) =>
            background(configure('device', e.target.value as Runtime['settings']['device']))
          }
        >
          <option value="auto">Automatic · prefer NVIDIA GPU</option>
          <option value="cpu">CPU · lower memory use</option>
          <option value="cuda">NVIDIA CUDA · requires compatible CUDA libraries</option>
        </select>
      </Field>
      <section aria-label="Download speech engine" className={s.install}>
        <label>
          <input
            type="checkbox"
            checked={selectedGpu}
            disabled={busy || installing}
            onChange={(e) => {
              setGpu(e.target.checked);
              setState(undefined);
            }}
          />{' '}
          Include NVIDIA acceleration (compatible NVIDIA driver required)
        </label>
        <div className={s.toolbar}>
          <Button
            primary={!runtime?.configured}
            disabled={busy || installing}
            onClick={() => background(act('plan'))}
          >
            {current?.kind === 'downloaded' && known
              ? 'Download a new copy…'
              : 'Download speech engine…'}
          </Button>
        </div>
        <p className={s.muted}>
          You choose where it goes; nothing downloads until you confirm. Once it passes its check,
          it is used straight away.
        </p>
        {state &&
          ['planned', 'installing', 'failed', 'cancelled', 'ready'].includes(state.state) && (
            <>
              <p className={s.muted}>{state.version}</p>
              <p className={s.path}>{state.folder}</p>
              {state.state !== 'ready' && (
                <p>
                  Download: {size(state.downloadBytes)} · Installed: {size(state.installedBytes)}
                  <br />
                  Space needed: {size(state.requiredBytes)} · Available:{' '}
                  {size(state.availableBytes)}
                </p>
              )}
              <p role="status">{state.message}</p>
              {installing && (
                <>
                  <progress
                    aria-label="Speech engine download progress"
                    max={state.downloadBytes}
                    value={state.downloadedBytes}
                  />
                  <p className={s.muted}>{size(state.downloadedBytes)} downloaded</p>
                  <Button disabled={busy} onClick={() => background(act('cancel'))}>
                    Cancel download
                  </Button>
                </>
              )}
              {state.state === 'planned' && (
                <Button
                  primary
                  disabled={busy || state.availableBytes < state.requiredBytes}
                  onClick={() => background(act('start'))}
                >
                  Download and install
                </Button>
              )}
              {state.state === 'ready' && (
                <Button primary disabled={busy} onClick={() => background(act('activate'))}>
                  Use this engine
                </Button>
              )}
            </>
          )}
      </section>
      {notice && <p role="status">{notice}</p>}
      {other?.kind === 'downloaded' && state?.otherBytes != null && (
        <div className={s.engine} aria-label="Previous speech engine">
          <p>
            The previous downloaded engine is still on disk and no longer used.
            <br />
            <span className={s.path}>{other.folder}</span>
          </p>
          <div className={s.toolbar}>
            <Button disabled={busy || installing} onClick={() => background(act('reveal-other'))}>
              Open folder
            </Button>
            <Button disabled={busy || installing} onClick={() => background(act('remove-other'))}>
              Delete previous engine ({size(state.otherBytes)})
            </Button>
          </div>
        </div>
      )}
      <details className={s.advanced} open={ownInUse}>
        <summary>Advanced: use my own Python installation</summary>
        <p>
          Install Python 3.12, faster-whisper 1.2.1 with CTranslate2 4.8.2, and a faster-whisper
          model, then choose their locations below. NVIDIA acceleration also needs CUDA 12 cuBLAS
          and cuDNN 9. Automatic uses the GPU when ready and falls back to CPU if its startup check
          fails; an explicit NVIDIA selection reports a failure instead.
        </p>
        <div className={s.toolbar}>
          {(['python', 'engine', 'gpu', 'model'] as const).map((topic) => (
            <Button
              key={topic}
              onClick={() => background(api.setupHelp(topic).catch((e) => setError(String(e))))}
            >
              {topic === 'gpu'
                ? 'GPU installation guide'
                : `${topic[0].toUpperCase()}${topic.slice(1)} download / instructions`}
            </Button>
          ))}
        </div>
        {(['python', 'libraries', 'model', 'gpuLibraries'] as const).map((part) => (
          <div className={s.setupRow} key={part}>
            <Button disabled={busy || installing} onClick={() => background(configure(part))}>
              Choose {part === 'gpuLibraries' ? 'GPU runtime' : part}…
            </Button>
            <span>{runtime?.settings[part]}</span>
          </div>
        ))}
        {back && (
          <div className={s.toolbar}>
            <Button disabled={busy || installing} onClick={() => background(act('restore'))}>
              {back}
            </Button>
          </div>
        )}
        <p className={s.muted}>
          Choosing your own files replaces the downloaded engine for transcription; the downloaded
          engine is kept so you can switch back here.
        </p>
      </details>
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
          Opening this window loads no speech model, and the recognition worker exits after each
          job. A failed or cancelled download removes its incomplete folder; the engine in use is
          kept. After an unexpected app exit, an incomplete download folder may remain. The engine
          is shared by every project and every Virtual Cut version, and project cleanup keeps it.
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
    </>
  );
}
