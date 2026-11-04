import { useCallback, useEffect, useState } from 'react';
import type { TranscriptApi } from '../../electron/transcript-contracts';
import type {
  ScreenTextCheck,
  ScreenTextSetupAction,
  ScreenTextSetupState,
} from '../../electron/screen-text-setup-contracts';
import { Button } from './ui';
import s from './TranscriptWindow.module.css';
import { background } from './background';
import { useWindowFocus } from './useWindowFocus';

const size = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GB`;
const clock = (iso: string) => {
  const at = new Date(iso);
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return at.toDateString() === new Date().toDateString()
    ? `today at ${time}`
    : `${at.toLocaleDateString()} at ${time}`;
};
function CheckResult({ check }: { check: ScreenTextCheck }) {
  if (!check.ok)
    return (
      <p className={s.error} role="alert">
        {check.error}
      </p>
    );
  return (
    <>
      <p role="status">
        {check.gpu
          ? `Reads on the graphics card (DirectML). Test image read in ${(check.ms / 1000).toFixed(2)} s.`
          : 'The graphics card could not be used (DirectML unavailable), so screen text is read on the processor. Reading takes several times longer.'}
      </p>
      <p className={s.muted}>Checked {clock(check.at)}.</p>
    </>
  );
}

/**
 * The screen text engine (VC-192, prototype M395): its status and folder, a test image check,
 * a download that is used as soon as it passes its check, and the previous engine, kept until
 * it is deleted. Opening it starts nothing; the check runs after a download or on request.
 */
export function ScreenTextSetup({ api }: { api: TranscriptApi }) {
  const [state, setState] = useState<ScreenTextSetupState>();
  const [busy, setBusy] = useState<ScreenTextSetupAction | ''>(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const refresh = useCallback(async () => setState(await api.screenTextSetup('status')), [api]);
  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
  }, [refresh]);
  useWindowFocus(useCallback(() => background(refresh()), [refresh]));
  const working = state?.state === 'installing' || state?.state === 'checking';
  useEffect(() => {
    if (!working) return;
    let pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      void api
        .screenTextSetup('status')
        .then((next) => {
          // A download that just passed its check is already in use: say so.
          if (!['installing', 'checking'].includes(next.state)) setNotice(next.message);
          setState(next);
        })
        .catch((e) => setError(String(e)))
        .finally(() => {
          pending = false;
        });
    }, 1000);
    return () => clearInterval(timer);
  }, [working, api]);
  const act = (action: ScreenTextSetupAction) =>
    background(
      (async () => {
        setBusy(action);
        setError('');
        setNotice('');
        try {
          const next = await api.screenTextSetup(action);
          setState(next);
          if (next.notice) setNotice(next.notice);
        } catch (e) {
          setError(String(e));
        } finally {
          setBusy('');
        }
      })(),
    );
  const current = state?.current,
    other = state?.other;
  const installed = !!current;
  const ready = installed && !state?.problem;
  const checking = !!state?.checking || busy === 'check';
  const status = working
    ? state?.state === 'checking'
      ? 'Checking…'
      : 'Installing…'
    : ready
      ? state?.check?.ok && !state.check.gpu
        ? 'Ready · processor'
        : 'Ready'
      : installed
        ? 'Files missing'
        : 'Not installed';
  const chipReady = status === 'Ready';
  const showPlan =
    state && ['planned', 'installing', 'checking', 'failed', 'cancelled'].includes(state.state);
  return (
    <section
      id="screen-text-setup"
      className={s.card}
      aria-label="Screen text engine settings"
      tabIndex={-1}
    >
      <h2>Screen text engine</h2>
      <div className={s.engine} aria-label={`Screen text engine: ${status}`}>
        <div className={s.engineHeader}>
          <strong>
            {installed && current.downloaded
              ? 'Virtual Cut screen text engine'
              : 'Screen text engine'}
          </strong>
          <span className={`${s.chip} ${chipReady ? s.chipReady : s.chipWarn}`}>{status}</span>
        </div>
        {installed ? (
          <>
            <p className={s.path}>{current.folder}</p>
            {state.overridden && (
              <p className={s.muted}>
                Set by VIRTUAL_CUT_OCR_RUNTIME (development). A download here is used once that
                setting is cleared.
              </p>
            )}
            {state.problem ? (
              <p className={s.error} role="alert" aria-label="Screen text engine files missing">
                {state.problem.replace(
                  'Open Screen text engine to download it again.',
                  'Download it again below.',
                )}
              </p>
            ) : (
              state.check && <CheckResult check={state.check} />
            )}
            <div className={s.toolbar}>
              <Button disabled={!!busy} onClick={() => act('reveal-current')}>
                Open folder
              </Button>
              {!state.problem && (
                <Button disabled={!!busy || checking || working} onClick={() => act('check')}>
                  {checking ? 'Checking…' : 'Check again'}
                </Button>
              )}
            </div>
          </>
        ) : (
          <p>
            Download the screen text engine to read the text that appears on screen in your
            recordings. Reading runs on this computer; no pictures are uploaded.
          </p>
        )}
      </div>
      <section aria-label="Download screen text engine" className={s.install}>
        <div className={s.toolbar}>
          <Button primary={!ready} disabled={!!busy || working} onClick={() => act('plan')}>
            {installed && current.downloaded && !state.overridden
              ? 'Download a new copy…'
              : 'Download screen text engine…'}
          </Button>
        </div>
        <p className={s.muted}>
          You choose where it goes; nothing downloads until you confirm. Once it passes its check,
          it is used straight away.
        </p>
        {showPlan && (
          <>
            <p className={s.muted}>{state.version}</p>
            <p className={s.path}>{state.folder}</p>
            {state.state !== 'checking' && (
              <p>
                Download: {size(state.downloadBytes)} · Installed: {size(state.installedBytes)}
                <br />
                Space needed: {size(state.requiredBytes)} · Available: {size(state.availableBytes)}
              </p>
            )}
            <p role="status">{state.message}</p>
            {state.state === 'installing' && (
              <>
                <progress
                  aria-label="Screen text engine download progress"
                  max={state.downloadBytes}
                  value={state.downloadedBytes}
                />
                <p className={s.muted}>{size(state.downloadedBytes)} downloaded</p>
                <Button disabled={!!busy} onClick={() => act('cancel')}>
                  Cancel download
                </Button>
              </>
            )}
            {state.state === 'checking' && (
              <progress aria-label="Checking the screen text engine" />
            )}
            {state.state === 'planned' && (
              <Button
                primary
                disabled={!!busy || state.availableBytes < state.requiredBytes}
                onClick={() => act('start')}
              >
                Download and install
              </Button>
            )}
          </>
        )}
        {state?.state === 'ready' && (
          <>
            <p role="status">{state.message}</p>
            <Button primary disabled={!!busy} onClick={() => act('activate')}>
              Use this engine
            </Button>
          </>
        )}
      </section>
      {notice && <p role="status">{notice}</p>}
      {other && other.folder !== current?.folder && other.available && (
        <div className={s.engine} aria-label="Previous screen text engine">
          <p>
            The previous {other.downloaded ? 'downloaded ' : ''}engine is still on disk and no
            longer used.
            <br />
            <span className={s.path}>{other.folder}</span>
          </p>
          <div className={s.toolbar}>
            <Button disabled={!!busy || working} onClick={() => act('reveal-other')}>
              Open folder
            </Button>
            <Button disabled={!!busy || working} onClick={() => act('restore')}>
              Use the previous engine again
            </Button>
            {other.downloaded && state.otherBytes != null && (
              <Button disabled={!!busy || working} onClick={() => act('remove-other')}>
                Delete previous engine ({size(state.otherBytes)})
              </Button>
            )}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      <details className={s.help}>
        <summary>Sources, licenses and storage</summary>
        <p>
          Python 3.12.10 (PSF license), RapidOCR 3.9.2 with the PP-OCRv6 small models (Apache 2.0),
          ONNX Runtime DirectML 1.24.4 (MIT), OpenCV 5 (Apache 2.0), NumPy, Pillow, Shapely and
          small helpers (BSD, MIT and similar). Downloads come from Python.org and PyPI and are
          verified against a pinned manifest. Dependency license files remain in the installed
          libraries. Installation archives are removed after extraction.
        </p>
        <p>
          Opening this window loads nothing; the check and the reading pass start the engine only
          while they run. A failed or cancelled download removes its incomplete folder; the engine
          in use is kept. The engine is shared by every project and every Virtual Cut version, and
          project cleanup keeps it.
        </p>
      </details>
    </section>
  );
}
