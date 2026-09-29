import { useState } from 'react';
import type { useProjectWorkspace } from './useProjectWorkspace';
import type { Recording } from './model';
import { Button, Field, Modal } from './ui';
import s from './Workflow.module.css';

type Workspace = ReturnType<typeof useProjectWorkspace>;
export function ProjectPanel({
  workspace: w,
  onClose,
}: {
  workspace: Workspace;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const api = window.virtualCut?.project;
  async function open(action: () => ReturnType<NonNullable<typeof api>['open']>) {
    const value = await w.run(action);
    if (value) onClose();
  }
  return (
    <Modal title="Projects" onClose={onClose}>
      <Field label="New project name">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
      </Field>
      <p className={s.muted}>
        Choose a project file, a destination for finished clips, and a folder for disposable
        previews. Recordings stay in their original locations.
      </p>
      <div className={s.tools}>
        <Button
          primary
          disabled={!api || !name.trim() || w.busy}
          onClick={() => void open(() => api!.create(name))}
        >
          Create project
        </Button>
        <Button disabled={!api || w.busy} onClick={() => void open(() => api!.open())}>
          Open project file…
        </Button>
      </div>
      {w.error && (
        <p role="alert" className={s.error}>
          {w.error}
        </p>
      )}
      {w.snapshot && (
        <section className={s.projectInfo}>
          <h3>{w.snapshot.project.name}</h3>
          <dl>
            <dt>Project</dt>
            <dd>{w.snapshot.project.file}</dd>
            <dt>Clip destination</dt>
            <dd>{w.snapshot.project.destination}</dd>
            <dt>Preview cache</dt>
            <dd>{w.snapshot.project.cache}</dd>
          </dl>
          <Button disabled={w.busy} onClick={() => void w.sample().then(onClose)}>
            Close project · return to sample
          </Button>
        </section>
      )}
      <h3>Recent projects</h3>
      <div className={s.folderList}>
        {w.recents.map((p) => (
          <Button
            key={p.id}
            disabled={w.busy}
            title={p.file}
            onClick={() => void open(() => api!.open(p.id))}
          >
            {p.name}
          </Button>
        ))}
      </div>
      {!w.recents.length && <p className={s.muted}>Your saved projects will appear here.</p>}
    </Modal>
  );
}

export function BatchTools({ workspace: w }: { workspace: Workspace }) {
  const [creating, setCreating] = useState(false),
    [name, setName] = useState(''),
    [jobs, setJobs] = useState(false);
  const p = w.snapshot;
  if (!p) return null;
  const api = window.virtualCut!.project;
  const pending = p.jobs.filter((j) => j.state !== 'succeeded');
  return (
    <>
      <select
        aria-label="Current batch"
        value={p.activeBatchId}
        disabled={w.busy}
        onChange={(e) => {
          const id = e.target.value;
          void w.run(() => api.selectBatch(p.project.id, id));
        }}
      >
        {p.batches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <Button disabled={w.busy} onClick={() => setCreating(true)}>
        New batch
      </Button>
      <Button
        disabled={w.busy}
        onClick={() => void w.run(() => api.import(p.project.id, p.activeBatchId, 'files'))}
      >
        Import files
      </Button>
      <Button
        disabled={w.busy}
        onClick={() => void w.run(() => api.import(p.project.id, p.activeBatchId, 'folder'))}
      >
        Import folder
      </Button>
      <Button onClick={() => setJobs(true)}>
        Jobs {pending.length > 0 ? `· ${pending.length}` : ''}
      </Button>
      {creating && (
        <Modal title="New batch" onClose={() => setCreating(false)}>
          <Field label="Batch name">
            <input
              autoFocus
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Button
            primary
            disabled={!name.trim() || w.busy}
            onClick={() =>
              void w
                .run(() => api.batch(p.project.id, name))
                .then((value) => {
                  if (value) {
                    setCreating(false);
                    setName('');
                  }
                })
            }
          >
            Create batch
          </Button>
        </Modal>
      )}
      {jobs && (
        <Modal title="Media jobs" onClose={() => setJobs(false)}>
          <p className={s.muted}>
            Inspection and audio previews run one at a time. Interrupted work can be retried after
            reopening the project.
          </p>
          <div className={s.jobList}>
            {p.jobs.map((j) => (
              <section key={j.id} className={s.clipTile}>
                <strong>
                  {w.model.recordings.find((r) => r.id === j.sourceId)?.title || 'Import'}
                </strong>
                <p>
                  {j.kind === 'inspect' ? 'Media inspection' : `Audio track ${j.track}`} · {j.state}
                </p>
                {j.state === 'running' && <progress value={j.progress} max={1} />}
                <p className={s.muted}>{j.message}</p>
                {['queued', 'running'].includes(j.state) && (
                  <Button
                    disabled={w.busy}
                    onClick={() => void w.run(() => api.job(p.project.id, j.id, 'cancel'))}
                  >
                    Cancel job
                  </Button>
                )}
                {['failed', 'cancelled', 'interrupted'].includes(j.state) && (
                  <Button
                    disabled={w.busy}
                    onClick={() => void w.run(() => api.job(p.project.id, j.id, 'retry'))}
                  >
                    Retry job
                  </Button>
                )}
              </section>
            ))}
          </div>
          {!p.jobs.length && <p>No media jobs yet.</p>}
        </Modal>
      )}
    </>
  );
}

export function RecordingTools({
  recording: r,
  workspace: w,
  onChange,
}: {
  recording: Recording;
  workspace: Workspace;
  onChange: (patch: Partial<Recording>) => void;
}) {
  const p = w.snapshot;
  if (!p) return null;
  const api = window.virtualCut!.project;
  const tracks = r.audioTracks || [];
  return (
    <details className={s.recordingTools} open={r.availability !== 'ready'}>
      <summary>Source & audio · {r.availability}</summary>
      <p className={s.pathText}>{r.sourcePath}</p>
      {r.error && <p className={s.error}>{r.error}</p>}
      <Button disabled={w.busy} onClick={() => void w.run(() => api.relink(p.project.id, r.id))}>
        Relink original…
      </Button>
      {r.availability === 'ready' && (
        <>
          <div className={s.pair}>
            {(['game', 'mic'] as const).map((role) => (
              <Field key={role} label={role === 'game' ? 'Game track' : 'Microphone track'}>
                <select
                  aria-label={`${role} audio track`}
                  value={r[`${role}Track`] ?? ''}
                  onChange={(e) => {
                    const value = e.target.value === '' ? null : Number(e.target.value),
                      other = role === 'game' ? 'micTrack' : 'gameTrack';
                    onChange({
                      [`${role}Track`]: value,
                      ...(value != null && r[other] === value ? { [other]: null } : {}),
                    });
                  }}
                >
                  <option value="">None</option>
                  {tracks.map((t) => (
                    <option key={t.index} value={t.index}>
                      {t.index} · {t.title || t.codec} · {t.channels} ch
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
          <p className={s.muted}>
            Track roles are your choice. Preview audio is prepared locally; source audio is
            unchanged.
          </p>
          <div className={s.tools} aria-label="Audio monitoring">
            {(['game', 'mic', 'both'] as const).map((mode) => (
              <Button
                key={mode}
                aria-pressed={(r.monitor || 'game') === mode}
                disabled={
                  mode === 'game'
                    ? r.gameTrack == null
                    : mode === 'mic'
                      ? r.micTrack == null
                      : r.gameTrack == null || r.micTrack == null
                }
                onClick={() => onChange({ monitor: mode })}
              >
                {mode === 'mic' ? 'Mic' : mode === 'game' ? 'Game' : 'Both'}
              </Button>
            ))}
          </div>
          <Button
            disabled={w.busy || !tracks.length}
            onClick={() => void w.run(() => api.audio(p.project.id, r.id))}
          >
            Prepare selected audio
          </Button>
          {!tracks.length && <p className={s.muted}>No audio streams in this recording.</p>}
        </>
      )}
    </details>
  );
}
