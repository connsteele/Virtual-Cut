import { useState } from 'react';
import type { useProjectWorkspace } from './useProjectWorkspace';
import type { Recording } from './model';
import type { ImportAudio } from '../../electron/project-contracts';
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

export function ImportPanel({
  workspace: w,
  kind,
  onClose,
}: {
  workspace: Workspace;
  kind: 'files' | 'folder';
  onClose: () => void;
}) {
  const p = w.snapshot!,
    defaults = p.batches.find((b) => b.id === p.activeBatchId)?.audioDefaults;
  const [notes, setNotes] = useState(defaults?.mic != null),
    [game, setGame] = useState(defaults?.game ?? 1),
    [mic, setMic] = useState(defaults?.mic ?? 2);
  const audio: ImportAudio = { game, mic: notes ? mic : null };
  return (
    <Modal title="Batch audio setup" onClose={onClose}>
      <p>
        These settings apply to new recordings in this import and are remembered for this batch. You
        can adjust individual recordings in Source & audio setup.
      </p>
      {kind === 'folder' && <p>Folder import includes videos in all nested folders.</p>}
      <label className={s.tools}>
        <input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} />
        This batch has microphone audio notes
      </label>
      <div className={s.pair}>
        <Field label="Game audio track">
          <input
            aria-label="Batch game audio track"
            type="number"
            min={1}
            max={64}
            value={game}
            onChange={(e) => setGame(Number(e.target.value))}
          />
        </Field>
        {notes && (
          <Field label="Microphone notes track">
            <input
              aria-label="Batch microphone notes track"
              type="number"
              min={1}
              max={64}
              value={mic}
              onChange={(e) => setMic(Number(e.target.value))}
            />
          </Field>
        )}
      </div>
      <p className={s.muted}>
        Track numbers count audio tracks only, starting at 1. Recordings with a different track
        layout will be flagged for you to check.
      </p>
      <Button
        primary
        disabled={
          w.busy ||
          !Number.isInteger(game) ||
          game < 1 ||
          game > 64 ||
          (notes && (!Number.isInteger(mic) || mic < 1 || mic > 64 || game === mic))
        }
        onClick={() =>
          void w
            .run(() =>
              window.virtualCut!.project.import(p.project.id, p.activeBatchId, kind, audio),
            )
            .then((value) => {
              if (value) onClose();
            })
        }
      >
        Choose {kind === 'folder' ? 'folder' : 'files'}…
      </Button>
      {w.error && (
        <p role="alert" className={s.error}>
          {w.error}
        </p>
      )}
    </Modal>
  );
}

export function SaveHistory({
  workspace: w,
  onClose,
}: {
  workspace: Workspace;
  onClose: () => void;
}) {
  const [confirm, setConfirm] = useState(''),
    p = w.snapshot!;
  return (
    <Modal title="Save history" onClose={onClose}>
      <p>
        Your working project saves continuously. Five autosave copies and five manual checkpoints
        are kept beside the project file. Restoring first makes a manual checkpoint of your current
        work.
      </p>
      <div className={s.jobList}>
        {(p.saves || []).map((copy) => (
          <section className={s.clipTile} key={copy.id}>
            <strong>{copy.kind === 'auto' ? 'Autosave' : 'Manual save'}</strong>
            <p>{new Date(copy.created).toLocaleString()}</p>
            {confirm === copy.id ? (
              <div className={s.tools}>
                <span>Restore this state? Media jobs will pause.</span>
                <Button
                  onClick={() =>
                    void w
                      .run(() => window.virtualCut!.project.restore(p.project.id, copy.id))
                      .then((value) => {
                        if (value) onClose();
                      })
                  }
                >
                  Restore save
                </Button>
                <Button onClick={() => setConfirm('')}>Cancel</Button>
              </div>
            ) : (
              <Button onClick={() => setConfirm(copy.id)}>Restore…</Button>
            )}
          </section>
        ))}
      </div>
      {!p.saves?.length && (
        <p>
          A copy is kept after an edit, every two minutes of editing, and when closing. Use Save to
          make a manual checkpoint now.
        </p>
      )}
      {w.error && (
        <p role="alert" className={s.error}>
          {w.error}
        </p>
      )}
    </Modal>
  );
}

export function BatchTools({ workspace: w }: { workspace: Workspace }) {
  const [creating, setCreating] = useState(false),
    [name, setName] = useState(''),
    [jobs, setJobs] = useState(false),
    [deleting, setDeleting] = useState(false),
    [targetId, setTargetId] = useState(''),
    [importing, setImporting] = useState<'files' | 'folder' | null>(null);
  const p = w.snapshot;
  if (!p) return null;
  const api = window.virtualCut!.project;
  const pending = p.jobs.filter((j) => j.state !== 'succeeded');
  return (
    <>
      <select
        aria-label="Current batch"
        value={p.activeBatchId}
        disabled={w.blocking}
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
      <Button disabled={w.blocking} onClick={() => setCreating(true)}>
        New batch
      </Button>
      <Button
        disabled={w.blocking}
        onClick={() => {
          setTargetId(p.batches.find((b) => b.id !== p.activeBatchId)?.id || '');
          setDeleting(true);
        }}
      >
        Delete batch…
      </Button>
      <Button disabled={w.blocking} onClick={() => setImporting('files')}>
        Import files
      </Button>
      <Button disabled={w.blocking} onClick={() => setImporting('folder')}>
        Import folder
      </Button>
      <Button onClick={() => setJobs(true)}>
        Jobs {pending.length > 0 ? `· ${pending.length}` : ''}
      </Button>
      {importing && (
        <ImportPanel workspace={w} kind={importing} onClose={() => setImporting(null)} />
      )}
      {deleting && (
        <Modal title="Delete batch" onClose={() => setDeleting(false)}>
          <p>Delete “{p.batches.find((b) => b.id === p.activeBatchId)?.name}”?</p>
          <p>
            This removes the batch grouping. Recordings, clips, markers and source files are kept.
            Recordings shared with other batches stay there.
          </p>
          {p.batches.length > 1 ? (
            <Field label="Keep recordings belonging only to this batch in">
              <select
                aria-label="Keep recordings in batch"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
              >
                {p.batches
                  .filter((b) => b.id !== p.activeBatchId)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </Field>
          ) : (
            <p>An Unbatched group will keep all its recordings accessible.</p>
          )}
          <p className={s.muted}>
            A manual save is made first. Use Save history to restore this batch.
          </p>
          <div className={s.tools}>
            <Button
              primary
              disabled={w.busy}
              onClick={() =>
                void w
                  .run(() => api.deleteBatch(p.project.id, p.activeBatchId, targetId || undefined))
                  .then((value) => {
                    if (value) setDeleting(false);
                  })
              }
            >
              Delete batch
            </Button>
            <Button onClick={() => setDeleting(false)}>Cancel</Button>
          </div>
          {w.error && (
            <p role="alert" className={s.error}>
              {w.error}
            </p>
          )}
        </Modal>
      )}
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
      <summary>Source & audio setup · {r.availability}</summary>
      <p className={s.pathText}>{r.sourcePath}</p>
      {r.error && <p className={s.error}>{r.error}</p>}
      {r.audioWarning && (
        <p role="status" className={s.error}>
          {r.audioWarning}
        </p>
      )}
      <Button disabled={w.busy} onClick={() => void w.run(() => api.relink(p.project.id, r.id))}>
        Relink original…
      </Button>
      {r.availability === 'ready' && (
        <>
          <div className={s.pair}>
            {(['game', 'mic'] as const).map((role) => (
              <Field
                key={role}
                label={role === 'game' ? 'Game audio track' : 'Microphone notes track'}
              >
                <select
                  aria-label={`${role} audio track`}
                  value={r[`${role}Track`] ?? ''}
                  onChange={(e) => {
                    const value = e.target.value === '' ? null : Number(e.target.value),
                      other = role === 'game' ? 'micTrack' : 'gameTrack';
                    onChange({
                      [`${role}Track`]: value,
                      audioWarning: '',
                      ...(value != null && r[other] === value ? { [other]: null } : {}),
                    });
                  }}
                >
                  <option value="">None</option>
                  {tracks.map((t, i) => (
                    <option key={t.index} value={t.index}>
                      {i + 1} · {t.title || t.codec} · {t.channels} ch
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
          <p className={s.muted}>
            Selected tracks prepare automatically for listening and waveforms. Preparation makes
            local preview copies so the player can hear separate tracks; your original recording is
            unchanged.
          </p>
          <Button
            disabled={w.busy || !tracks.length}
            onClick={() => void w.run(() => api.audio(p.project.id, r.id))}
          >
            Retry audio preparation
          </Button>
          {!tracks.length && <p className={s.muted}>No audio streams in this recording.</p>}
        </>
      )}
    </details>
  );
}
