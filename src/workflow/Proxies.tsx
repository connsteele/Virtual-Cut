import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { useProjectWorkspace } from './useProjectWorkspace';
import type { Recording } from './model';
import type { MediaJob, ProjectSnapshot } from '../../electron/project-contracts';
import {
  proxySettings,
  type ProxyOnImport,
  type ProxySettings,
} from '../../electron/proxy-settings';
import type { ProxyHeight } from '../../electron/proxy-record';
import { Button, Modal } from './ui';
import { storageSize } from './ProjectStorage';
import { background } from './background';
import s from './Workflow.module.css';
import p from './Proxies.module.css';

// VC-237: making proxies. Each recording card has a proxy chip (its state, and a menu to make,
// stop, remove or show it); the Proxies button beside Transcript opens the batch's proxy status
// and the project's proxy settings. Playing proxies (the Original/Proxy switch) is VC-238.

type Workspace = ReturnType<typeof useProjectWorkspace>;

/** Asks Jobs to open (BatchTools owns the Jobs window). */
export const openJobsEvent = 'virtual-cut-open-jobs';

/** A recording's newest proxy job, if any. */
function proxyJob(snapshot: ProjectSnapshot, sourceId: string): MediaJob | undefined {
  return snapshot.jobs.find((j) => j.sourceId === sourceId && j.kind === 'proxy');
}

export type ChipState = 'ready' | 'making' | 'waiting' | 'paused' | 'missing' | 'failed' | 'none';

/** What a recording's chip says, from its proxy as of this snapshot and its newest proxy job. */
export function proxyChip(snapshot: ProjectSnapshot, r: Recording) {
  const proxy = r.proxy || { state: 'none' as const };
  const job = proxyJob(snapshot, r.id);
  const percent = `${Math.floor((proxy.progress ?? job?.progress ?? 0) * 100)}%`;
  if (proxy.state === 'making') {
    if (job?.state === 'running')
      return { state: 'making' as ChipState, label: `Proxy ${percent}`, detail: job.message, job };
    if (job && job.progress > 0)
      return {
        state: 'paused' as ChipState,
        label: `Proxy ${percent} · paused`,
        detail: job.message,
        job,
      };
    return {
      state: 'waiting' as ChipState,
      label: 'Proxy waiting',
      detail: job?.message || 'Waiting',
      job,
    };
  }
  if (proxy.state === 'ready')
    return {
      state: 'ready' as ChipState,
      label: `Proxy ${proxy.height}p`,
      detail: `Proxy ready · ${proxy.width} × ${proxy.height} · H.264${proxy.bytes ? ` · ${storageSize(proxy.bytes)}` : ''}`,
      job,
    };
  if (proxy.state === 'missing')
    return {
      state: 'missing' as ChipState,
      label: 'Proxy missing',
      detail: 'The proxy file is gone or changed. Make it again, or forget it.',
      job,
    };
  if (job?.state === 'failed')
    return {
      state: 'failed' as ChipState,
      label: 'Proxy failed',
      detail: `Proxy failed: ${job.message}`,
      job,
    };
  return { state: 'none' as ChipState, label: '+ Proxy', detail: 'No proxy', job };
}

/** Whether a recording can have a proxy at all (imported, ready, not a sample or kept clip). */
function proxyable(r: Recording) {
  return r.availability === 'ready' && !r.retained && !r.sample;
}

type MenuItem = { id: string; label: string; run: () => void };

/** A small menu under its button; arrow keys move, Escape closes and returns focus. */
function ChipMenu({
  items,
  label,
  onClose,
}: {
  items: MenuItem[];
  label: string;
  onClose: (focusButton: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const away = (e: PointerEvent) => {
      if (!ref.current?.parentElement?.contains(e.target as Node)) onClose(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [onClose]);
  const keys = (e: KeyboardEvent) => {
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button') || [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // The page's own arrow and transport keys stay out of the menu.
      e.preventDefault();
      e.stopPropagation();
      const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    } else if (e.key === 'Tab') onClose(false);
    // Enter and Space choose the item; the page's transport keys wait until the menu closes.
    else e.stopPropagation();
  };
  return (
    <div ref={ref} className={p.menu} role="menu" aria-label={label} onKeyDown={keys}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          data-proxy-action={item.id}
          onClick={() => {
            onClose(false);
            item.run();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** The proxy chip in a recording card's icon row, with its menu. */
export function ProxyChip({
  recording: r,
  workspace: w,
}: {
  recording: Recording;
  workspace: Workspace;
}) {
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const snapshot = w.snapshot;
  if (!snapshot || !proxyable(r)) return null;
  const settings = proxySettings(snapshot.proxies);
  if (settings.onImport === 'never') return null;
  const api = window.virtualCut!.project;
  const id = snapshot.project.id;
  const chip = proxyChip(snapshot, r);
  const make = (again: boolean) =>
    background(w.run(() => api.makeProxies(id, [r.id], again), true));
  const items: MenuItem[] =
    chip.state === 'ready'
      ? [
          { id: 'remake', label: 'Make proxy again', run: () => make(true) },
          { id: 'remove', label: 'Remove proxy…', run: () => setRemoving(true) },
          {
            id: 'reveal',
            label: 'Show proxy in folder',
            run: () => background(w.run(() => api.revealProxy(id, r.id), true)),
          },
        ]
      : chip.state === 'missing'
        ? [
            { id: 'remake', label: 'Make proxy again', run: () => make(true) },
            {
              id: 'forget',
              label: 'Forget the missing proxy',
              run: () => background(w.run(() => api.removeProxy(id, r.id), true)),
            },
          ]
        : ['making', 'waiting', 'paused'].includes(chip.state)
          ? [
              {
                id: 'stop',
                label: 'Stop making proxy',
                run: () =>
                  chip.job && background(w.run(() => api.job(id, chip.job!.id, 'cancel'), true)),
              },
              {
                id: 'jobs',
                label: 'Show in Jobs',
                run: () => window.dispatchEvent(new Event(openJobsEvent)),
              },
            ]
          : [
              {
                id: 'make',
                label: `Make proxy (${settings.height}p)`,
                run: () => make(chip.state === 'failed'),
              },
            ];
  const close = (focusButton: boolean) => {
    setOpen(false);
    if (focusButton) button.current?.focus();
  };
  return (
    <span className={p.chipWrap}>
      <button
        ref={button}
        type="button"
        className={`${p.chip} ${p[chip.state]}`}
        data-proxy-state={chip.state}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${chip.label}: ${r.title}. ${chip.detail}`}
        title={chip.detail}
        disabled={w.blocking}
        onClick={() => setOpen(!open)}
      >
        {chip.label}
      </button>
      {open && <ChipMenu items={items} label={`Proxy for ${r.title}`} onClose={close} />}
      {removing && (
        <Modal title="Remove proxy" onClose={() => setRemoving(false)}>
          <p>
            Remove the {r.proxy?.height}p proxy of “{r.title}”
            {r.proxy?.bytes ? ` (${storageSize(r.proxy.bytes)})` : ''} from the project cache?
          </p>
          <p className={s.muted}>
            The recording, its clips, exports and companions are not touched. You can make the proxy
            again from this chip.
          </p>
          <div className={s.tools}>
            <Button
              primary
              disabled={w.busy}
              onClick={() =>
                background(
                  w
                    .run(() => api.removeProxy(id, r.id))
                    .then((value) => {
                      if (value) setRemoving(false);
                    }),
                )
              }
            >
              Remove proxy
            </Button>
            <Button disabled={w.busy} onClick={() => setRemoving(false)}>
              Cancel
            </Button>
          </div>
          {w.error && (
            <p role="alert" className={s.error}>
              {w.error}
            </p>
          )}
        </Modal>
      )}
    </span>
  );
}

const onImportChoices: { value: ProxyOnImport; label: string; detail: string }[] = [
  {
    value: 'ask',
    label: 'Off: only when I ask',
    detail:
      'The import checkbox starts unticked. Make proxies later from this window or a recording’s chip. Default.',
  },
  {
    value: 'import',
    label: 'On: tick the import checkbox',
    detail: 'The import checkbox starts ticked; you can still untick it for one import.',
  },
  {
    value: 'never',
    label: 'Never',
    detail: 'Hides the proxy chips and the import checkbox for this project.',
  },
];
const heightChoices: { value: ProxyHeight; label: string; detail: string }[] = [
  {
    value: 1080,
    label: '1080p',
    detail:
      'Sharper while moving. About 2.4 GB per footage hour on calm footage, up to about 5 GB on busy footage.',
  },
  {
    value: 720,
    label: '720p',
    detail: 'About half the disk; drags and plays the same or slightly faster.',
  },
];

/** The Proxies button beside Transcript, and the Proxies window it opens. */
export function ProxiesButton({ workspace: w }: { workspace: Workspace }) {
  const [open, setOpen] = useState(false);
  const snapshot = w.snapshot;
  if (!snapshot) return null;
  return (
    <>
      <Button aria-haspopup="dialog" onClick={() => setOpen(true)}>
        Proxies
      </Button>
      {open && <ProxiesPanel workspace={w} onClose={() => setOpen(false)} />}
    </>
  );
}

function ProxiesPanel({ workspace: w, onClose }: { workspace: Workspace; onClose: () => void }) {
  const snapshot = w.snapshot!;
  const api = window.virtualCut!.project;
  const id = snapshot.project.id;
  const settings = proxySettings(snapshot.proxies);
  const batch = snapshot.batches.find((b) => b.id === snapshot.activeBatchId);
  const recordings = snapshot.model.recordings.filter(
    (r) => r.batchIds?.includes(snapshot.activeBatchId) && proxyable(r),
  );
  const chips = recordings.map((r) => ({ r, chip: proxyChip(snapshot, r) }));
  // Recordings without a proxy at the project's size, and not being made.
  const wanted = chips.filter(
    ({ r, chip }) =>
      ['none', 'missing', 'failed'].includes(chip.state) ||
      (chip.state === 'ready' && r.proxy?.height !== settings.height),
  );
  const stored = snapshot.model.recordings.filter((r) => r.proxy?.state === 'ready');
  const bytes = stored.reduce((n, r) => n + (r.proxy?.bytes || 0), 0);
  // The choice shows at once; the saved settings replace it when the snapshot comes back.
  const [chosen, setChosen] = useState<ProxySettings | null>(null);
  useEffect(() => setChosen(null), [snapshot.proxies?.onImport, snapshot.proxies?.height]);
  const shown = chosen || settings;
  const change = (next: Partial<ProxySettings>) => {
    const value = { ...shown, ...next };
    setChosen(value);
    background(w.run(() => api.setProxySettings(id, value), true));
  };
  return (
    <Modal title="Proxies" onClose={onClose} className={p.panel}>
      <h4>{batch?.name || 'This batch'}</h4>
      {settings.onImport === 'never' ? (
        <p className={s.muted}>Proxies are off for this project. Choose another setting below.</p>
      ) : (
        <>
          {chips.length ? (
            <ul className={p.list} aria-label="Proxies in this batch">
              {chips.map(({ r, chip }) => (
                <li key={r.id} data-proxy-row={chip.state}>
                  <span>{r.title}</span>
                  <span className={`${p.chip} ${p[chip.state]} ${p.static}`} title={chip.detail}>
                    {chip.label}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={s.muted}>No recordings in this batch are ready for a proxy yet.</p>
          )}
          <p className={s.tools}>
            <Button
              disabled={w.blocking || !wanted.length}
              onClick={() =>
                background(
                  w.run(() =>
                    api.makeProxies(
                      id,
                      wanted.map(({ r }) => r.id),
                    ),
                  ),
                )
              }
            >
              Make proxies for this batch
            </Button>
            <span className={s.muted}>
              {wanted.length
                ? `${wanted.length} recording${wanted.length === 1 ? '' : 's'} without a ${settings.height}p proxy. Runs in the media lane and pauses while a preview plays or a transcription runs.`
                : `Every recording in this batch has a ${settings.height}p proxy, or is having one made.`}
            </span>
          </p>
        </>
      )}
      <h4>Settings for this project</h4>
      <fieldset className={p.options}>
        <legend>Make proxies on import</legend>
        {onImportChoices.map((choice) => (
          <label key={choice.value}>
            <input
              type="radio"
              name="proxy-on-import"
              checked={shown.onImport === choice.value}
              disabled={w.blocking}
              onChange={() => change({ onImport: choice.value })}
            />
            <span>
              {choice.label}
              <small>{choice.detail}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className={p.options}>
        <legend>Size</legend>
        {heightChoices.map((choice) => (
          <label key={choice.value}>
            <input
              type="radio"
              name="proxy-height"
              checked={shown.height === choice.value}
              disabled={w.blocking}
              onChange={() => change({ height: choice.value })}
            />
            <span>
              {choice.label}
              <small>{choice.detail}</small>
            </span>
          </label>
        ))}
        <small className={s.muted}>
          New proxies are made at this size. Existing ones stay as they are until you make them
          again.
        </small>
      </fieldset>
      <div className={p.facts}>
        <span>
          <b>Format</b> H.264, a keyframe on every source keyframe and at least every 0.5 s, no
          audio
        </span>
        <span>
          <b>Time</b> about 7–9 minutes per footage hour on an NVIDIA GPU
        </span>
        <span>
          <b>Stored</b> in the project’s cache folder · {stored.length}{' '}
          {stored.length === 1 ? 'proxy' : 'proxies'}, {storageSize(bytes)} now
        </span>
      </div>
      {w.error && (
        <p role="alert" className={s.error}>
          {w.error}
        </p>
      )}
      <div className={s.tools}>
        <Button onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}
