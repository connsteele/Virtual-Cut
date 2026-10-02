import { useState } from 'react';
import { JobTime } from './JobTime';
import { FolderOpen, Trash2 } from 'lucide-react';
import type { useProjectWorkspace } from './useProjectWorkspace';
import type { Recording } from './model';
import type {
  DroppedImport,
  ImportAudio,
  ProjectDeletionPlan,
} from '../../electron/project-contracts';
import { Button, Field, Modal } from './ui';
import { CleanupFiles, ProjectStorage, storageSize as size } from './ProjectStorage';
import s from './Workflow.module.css';
import { ContextEditor, defaultContext } from './ContextEditor';

type Workspace = ReturnType<typeof useProjectWorkspace>;
export function ProjectPanel({
  workspace: w,
  onClose,
}: {
  workspace: Workspace;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [newContext, setNewContext] = useState(defaultContext('project'));
  const [deletion, setDeletion] = useState<ProjectDeletionPlan>();
  const [checkingDelete, setCheckingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleted, setDeleted] = useState('');
  const api = window.virtualCut?.project;
  async function prepareDelete(id: string) {
    setCheckingDelete(true);
    setDeleteError('');
    setDeleted('');
    try {
      if (w.snapshot?.project.id === id) await w.sample();
      setDeletion(await api!.deletionPlan(id));
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setCheckingDelete(false);
    }
  }
  async function remove(cleanup: boolean) {
    if (!deletion) return;
    await w.run(async () => {
      const result = await api!.deleteProject(deletion.id, deletion.token, cleanup);
      setDeleted(
        `Deleted ${result.removed} files (${size(result.bytes)}). Source footage, completed exports and their companions were preserved.`,
      );
      setDeletion(undefined);
    });
  }
  async function open(action: () => ReturnType<NonNullable<typeof api>['open']>) {
    const value = await w.run(action);
    if (value) onClose();
  }
  if (deletion)
    return (
      <Modal
        title={`Delete project: ${deletion.name}`}
        onClose={() => !w.busy && setDeletion(undefined)}
      >
        <p>
          The project is closed. Delete removes its project file and Recent entry. Cleanup also
          removes the verified save copies and disposable previews listed below. This cannot be
          undone.
        </p>
        <p>
          <strong>
            Source footage, completed exports and .vcut.json companions are always kept.
          </strong>{' '}
          Shared or unrecognized files, installed helpers, app settings and diagnostics are kept.
        </p>
        <p>
          {deletion.files.filter((f) => f.kind === 'save').length} save copies (including
          before-upgrade copies) · {deletion.files.filter((f) => f.kind === 'preview').length}{' '}
          disposable previews · {size(deletion.files.reduce((sum, f) => sum + f.bytes, 0))} with
          cleanup.
        </p>
        <section aria-label="Files to delete">
          <h4>Files to delete</h4>
          <CleanupFiles
            items={deletion.files.map((f) => ({
              path: f.path,
              group: {
                project: 'Project file',
                save: 'Save copies',
                preview: 'Disposable previews',
              }[f.kind],
              detail: size(f.bytes),
            }))}
          />
        </section>
        {!!deletion.retained.length && (
          <details>
            <summary>Retained files or folders · {deletion.retained.length}</summary>
            <p className={s.muted}>
              A retained, valid save can still recover its checkpoint through Recover from save.
              Open or unverified saves are kept conservatively; their recovery is not guaranteed.
              Previews can be regenerated from available media.
            </p>
            <CleanupFiles
              items={deletion.retainedDetails.map((f) => ({ ...f, detail: f.reason }))}
            />
          </details>
        )}
        {w.error && (
          <p role="alert" className={s.error}>
            {w.error}
          </p>
        )}
        <div className={s.tools}>
          <Button className={s.dangerButton} disabled={w.busy} onClick={() => void remove(false)}>
            Delete without cleanup
          </Button>
          <Button className={s.dangerButton} disabled={w.busy} onClick={() => void remove(true)}>
            Delete with cleanup
          </Button>
          <Button disabled={w.busy} onClick={() => setDeletion(undefined)}>
            Cancel
          </Button>
        </div>
      </Modal>
    );
  return (
    <Modal title="Projects" onClose={onClose}>
      <Field label="New project name">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
      </Field>
      <p className={s.muted}>
        Choose a project file, a root folder for finished videos, and a folder for disposable
        previews. Review assigns subfolders beneath the finished-video root. Recordings stay in
        their original locations.
      </p>
      <details>
        <summary>New project game and video brief (optional)</summary>
        <ContextEditor value={newContext} onChange={setNewContext} />
      </details>
      <div className={s.tools}>
        <Button
          primary
          disabled={!api || !name.trim() || w.busy}
          onClick={() =>
            void open(async () => {
              const created = await api!.create(name);
              if (!created) return null;
              await api!.save(created.project.id, created.model, {
                ...created.model,
                contexts: [newContext],
              });
              return api!.checkpoint(created.project.id);
            })
          }
        >
          Create project
        </Button>
        <Button disabled={!api || w.busy} onClick={() => void open(() => api!.open())}>
          Open project file…
        </Button>
        <Button disabled={!api || w.busy} onClick={() => void open(() => api!.recover())}>
          Recover from save…
        </Button>
      </div>
      <p className={s.muted}>
        Recovery opens a checkpoint from the project's .saves folder as a separate project. Choose a
        new filename to keep the original project and its saves intact.
      </p>
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
            <dt>Finished videos root</dt>
            <dd>{w.snapshot.project.destination}</dd>
            <dt>Preview cache</dt>
            <dd>{w.snapshot.project.cache}</dd>
          </dl>
          <ProjectStorage key={w.snapshot.project.id} id={w.snapshot.project.id} />
          <details>
            <summary>Project game and video brief</summary>
            <ContextEditor
              value={w.model.contexts?.find((c) => c.id === 'project') || defaultContext('project')}
              onChange={(context) =>
                w.setModel((model) => ({
                  ...model,
                  contexts: [...(model.contexts || []).filter((c) => c.id !== 'project'), context],
                }))
              }
            />
          </details>
          <Button disabled={w.busy} onClick={() => void w.sample().then(onClose)}>
            Close project · return to sample
          </Button>
        </section>
      )}
      <h3>Recent projects</h3>
      {checkingDelete && <p role="status">Saving and checking project files…</p>}
      {deleteError && (
        <p role="alert" className={s.error}>
          {deleteError}
        </p>
      )}
      {deleted && <p role="status">{deleted}</p>}
      <div className={s.folderList}>
        {w.recents.map((p) => (
          <div className={s.projectRow} key={p.id}>
            <Button
              disabled={w.busy || checkingDelete}
              title={p.file}
              onClick={() => void open(() => api!.open(p.id))}
            >
              {p.name}
            </Button>
            <Button
              aria-label={`Delete project: ${p.name}`}
              disabled={w.busy || checkingDelete}
              onClick={() => void prepareDelete(p.id)}
            >
              <Trash2 size={16} />
            </Button>
          </div>
        ))}
      </div>
      {!w.recents.length && <p className={s.muted}>Your saved projects will appear here.</p>}
    </Modal>
  );
}

export function ImportPanel({
  workspace: w,
  kind,
  drop,
  onClose,
}: {
  workspace: Workspace;
  kind: 'files' | 'folder';
  drop?: DroppedImport;
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
      {drop && (
        <section aria-label="Dropped files summary">
          <p>
            <strong>
              {drop.count
                ? `${drop.count} video ${drop.count === 1 ? 'file' : 'files'} ready to import.`
                : 'No supported video files found.'}
            </strong>{' '}
            {drop.skipped > 0 && `${drop.skipped} skipped.`}
          </p>
          <p className={s.muted}>
            Existing recordings are reused. Files stay in their original locations. Inspection jobs
            check their media and audio tracks after import.
          </p>
          {!!drop.issues.length && (
            <details open={!drop.count || undefined}>
              <summary>Skipped files</summary>
              <ul>
                {drop.issues.map((item, i) => (
                  <li key={i}>
                    {item.name}: {item.reason}
                  </li>
                ))}
              </ul>
              {drop.skipped > drop.issues.length && (
                <p>Showing the first {drop.issues.length} skipped files.</p>
              )}
            </details>
          )}
        </section>
      )}
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
          (!!drop && !drop.count) ||
          !Number.isInteger(game) ||
          game < 1 ||
          game > 64 ||
          (notes && (!Number.isInteger(mic) || mic < 1 || mic > 64 || game === mic))
        }
        onClick={() =>
          void w
            .run(() =>
              drop
                ? window.virtualCut!.project.importDrop(
                    p.project.id,
                    p.activeBatchId,
                    drop.token,
                    audio,
                  )
                : window.virtualCut!.project.import(p.project.id, p.activeBatchId, kind, audio),
            )
            .then((value) => {
              if (value) onClose();
            })
        }
      >
        {drop
          ? `Import ${drop.count} ${drop.count === 1 ? 'video' : 'videos'}`
          : `Choose ${kind === 'folder' ? 'folder' : 'files'}…`}
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
        Save or Ctrl+S saves immediately. Autosave waits until playback, seeking and edits stop.
        Closing normally also saves. Undo stays available after saving and resets when you reopen.
      </p>
      <fieldset className={s.autosaveSettings}>
        <legend>Autosave</legend>
        <Field label="Save every">
          <select
            aria-label="Autosave interval"
            value={w.autosave.minutes}
            onChange={(e) =>
              w.configureAutosave({ ...w.autosave, minutes: Number(e.target.value) })
            }
          >
            {[1, 2, 5, 10, 15, 30, 60, 120].map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} minutes{minutes === 10 ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </Field>
        <label>
          <input
            type="checkbox"
            checked={w.autosave.afterEdits}
            onChange={(e) => w.configureAutosave({ ...w.autosave, afterEdits: e.target.checked })}
          />
          Also save after edits
        </label>
        <p className={s.muted}>
          Applies to all projects on this device. An unexpected exit can lose changes since the last
          save; use Ctrl+S when you need a checkpoint. Moving the playhead alone does not trigger
          saving after edits.
        </p>
      </fieldset>
      <p>
        Five autosave copies and five manual saves are kept beside the project. Copies from before a
        format upgrade are kept separately. Restoring first saves your current work.
      </p>
      <div className={s.saveTableWrap}>
        <table className={s.saveTable} aria-label="Save history">
          <thead>
            <tr>
              <th>Type</th>
              <th>Date</th>
              <th>Time</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {[...(p.saves || [])]
              .sort((a, b) => b.created.localeCompare(a.created))
              .map((copy) => (
                <tr key={copy.id}>
                  <td>
                    {copy.kind === 'auto'
                      ? 'Autosave'
                      : copy.kind === 'migration'
                        ? 'Before upgrade'
                        : 'Manual save'}
                  </td>
                  <td>
                    <time dateTime={copy.created}>
                      {new Date(copy.created).toLocaleDateString()}
                    </time>
                  </td>
                  <td>
                    <time dateTime={copy.created}>
                      {new Date(copy.created).toLocaleTimeString()}
                    </time>
                  </td>
                  <td>
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
                      <div className={s.tools}>
                        <Button onClick={() => setConfirm(copy.id)}>Restore…</Button>
                        <Button
                          aria-label={`Open save folder: ${new Date(copy.created).toLocaleString()}`}
                          title="Open save folder"
                          onClick={() =>
                            void w.run(() =>
                              window.virtualCut!.project.revealSave(p.project.id, copy.id),
                            )
                          }
                        >
                          <FolderOpen size={15} />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!p.saves?.length && <p>No save copies yet. Use Save to make a manual checkpoint now.</p>}
      {w.error && (
        <p role="alert" className={s.error}>
          {w.error}
        </p>
      )}
    </Modal>
  );
}

export function BatchTools({ workspace: w }: { workspace: Workspace }) {
  const [contextOpen, setContextOpen] = useState(false);
  const [creating, setCreating] = useState(false),
    [name, setName] = useState(''),
    [jobs, setJobs] = useState(false),
    [deleting, setDeleting] = useState(false),
    [targetId, setTargetId] = useState(''),
    [deleteMode, setDeleteMode] = useState<'preserve' | 'remove'>('preserve'),
    [cleanupNotice, setCleanupNotice] = useState(''),
    [importing, setImporting] = useState<'files' | 'folder' | null>(null);
  const p = w.snapshot;
  if (!p) return null;
  const api = window.virtualCut!.project;
  const pending = p.jobs.filter((j) => j.state !== 'succeeded');
  const exclusive = p.model.recordings.filter(
    (r) => r.batchIds?.includes(p.activeBatchId) && r.batchIds.length === 1,
  );
  const exclusiveIds = new Set(exclusive.map((r) => r.id));
  const shared = p.model.recordings.filter(
    (r) => r.batchIds?.includes(p.activeBatchId) && r.batchIds.length > 1,
  );
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
      <Button disabled={w.blocking} onClick={() => setContextOpen(true)}>
        Batch context
      </Button>
      {contextOpen && (
        <Modal title="Batch game and video brief" onClose={() => setContextOpen(false)}>
          <ContextEditor
            contexts={w.model.contexts}
            value={
              w.model.contexts?.find((c) => c.id === p.activeBatchId) ||
              defaultContext(p.activeBatchId)
            }
            onChange={(context) =>
              w.setModel((model) => ({
                ...model,
                contexts: [
                  ...(model.contexts || []).filter((c) => c.id !== p.activeBatchId),
                  context,
                ],
              }))
            }
          />
          <Button onClick={() => setContextOpen(false)}>Done</Button>
        </Modal>
      )}
      <Button
        disabled={w.blocking}
        onClick={() => {
          setTargetId(p.batches.find((b) => b.id !== p.activeBatchId)?.id || '');
          setDeleteMode('preserve');
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
      {cleanupNotice && (
        <span role="status" className={s.muted}>
          {cleanupNotice}{' '}
          <Button aria-label="Dismiss cleanup status" onClick={() => setCleanupNotice('')}>
            ×
          </Button>
        </span>
      )}
      {importing && (
        <ImportPanel workspace={w} kind={importing} onClose={() => setImporting(null)} />
      )}
      {deleting && (
        <Modal title="Delete batch" onClose={() => setDeleting(false)}>
          <p>Delete “{p.batches.find((b) => b.id === p.activeBatchId)?.name}”?</p>
          <Field label="Batch removal">
            <select
              aria-label="Batch removal"
              value={deleteMode}
              onChange={(e) => setDeleteMode(e.target.value as typeof deleteMode)}
            >
              <option value="preserve">Remove grouping · keep recordings and edits</option>
              <option value="remove">Remove batch and its app data</option>
            </select>
          </Field>
          {deleteMode === 'remove' ? (
            <>
              <p>
                Remove {exclusive.length} exclusive recordings from this project, including{' '}
                {p.model.clips.filter((c) => exclusiveIds.has(c.rid)).length} clips,{' '}
                {exclusive.reduce((n, r) => n + (p.model.markers[r.id]?.length || 0), 0)} markers,
                their notes and {p.jobs.filter((j) => exclusiveIds.has(j.sourceId)).length} media
                jobs. Their disposable audio and image previews are cleaned up.
              </p>
              <p>
                {shared.length} shared recordings and their edits stay in other batches. Original
                video files are never deleted.
              </p>
            </>
          ) : (
            <p>
              This removes the batch grouping. Recordings, clips, markers and source files are kept.
              Recordings shared with other batches stay there.
            </p>
          )}
          {deleteMode === 'preserve' &&
            (p.batches.length > 1 ? (
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
            ))}
          <p className={s.muted}>
            A manual save is made first. Use Save history to restore this batch.
            {deleteMode === 'remove' &&
              ' Earlier saves are retained; previews can be regenerated. Cleanup clears edit Undo history. Files in use may remain in the preview cache.'}
          </p>
          <div className={s.tools}>
            <Button
              primary
              disabled={w.busy}
              onClick={() =>
                void w
                  .run(() =>
                    api.deleteBatch(
                      p.project.id,
                      p.activeBatchId,
                      targetId || undefined,
                      deleteMode,
                    ),
                  )
                  .then((value) => {
                    if (value) {
                      setDeleting(false);
                      if (value.cleanup)
                        setCleanupNotice(
                          `Batch removed. ${value.cleanup.cacheFilesRemoved} preview files removed.${value.cleanup.cacheFilesRetained || value.cleanup.cacheCleanupIncomplete ? ' Some previews remain in use or could not be removed.' : ''}`,
                        );
                    }
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
            Inspection, audio previews and exports run one at a time. Interrupted work can be
            retried after reopening the project.
          </p>
          <div className={s.jobList}>
            {p.jobs.map((j) => (
              <section key={j.id} className={`${s.clipTile} ${s.jobCard}`}>
                <div className={s.jobDetails}>
                  <strong>
                    {w.model.recordings.find((r) => r.id === j.sourceId)?.title || 'Import'}
                  </strong>
                  <p>
                    {j.kind === 'inspect'
                      ? 'Media inspection'
                      : j.kind === 'export'
                        ? 'Clip export'
                        : `Audio track ${j.track}`}{' '}
                    · {j.state} ·{' '}
                    <JobTime
                      started={j.started}
                      elapsedMs={j.elapsedMs}
                      running={j.state === 'running'}
                    />
                  </p>
                  {j.state === 'running' && <progress value={j.progress} max={1} />}
                  <p className={s.muted}>{j.message}</p>
                </div>
                <div className={s.tools}>
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
                </div>
              </section>
            ))}
          </div>
          {!p.jobs.length && <p>No media jobs yet.</p>}
        </Modal>
      )}
    </>
  );
}

export function RemoveRecordingButton({
  recording: r,
  workspace: w,
  icon = false,
}: {
  recording: Recording;
  workspace: Workspace;
  icon?: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  const p = w.snapshot;
  if (!p || !r.batchIds?.includes(p.activeBatchId)) return null;
  const shared = r.batchIds.some((id) => id !== p.activeBatchId);
  const clips = w.model.clips.filter((c) => c.rid === r.id).length;
  const markers = w.model.markers[r.id]?.length || 0;
  return (
    <>
      <Button
        disabled={w.blocking}
        aria-label={icon ? `Remove from batch: ${r.title}` : undefined}
        onClick={() => setConfirm(true)}
      >
        {icon ? <Trash2 size={15} /> : 'Remove from batch…'}
      </Button>
      {confirm && (
        <Modal title="Remove recording from batch" onClose={() => setConfirm(false)}>
          <p>
            Remove “{r.title}” from “{p.batches.find((b) => b.id === p.activeBatchId)?.name}”?
          </p>
          <p>
            {shared
              ? 'This recording and its edits stay available in its other batches.'
              : `Its ${clips} clip(s), ${markers} marker(s) and recording notes will be removed from this project.`}
          </p>
          <p>Original video files and finished exports are never moved or deleted.</p>
          <p className={s.muted}>
            A manual save is made first. Use Save history to restore the recording and its edits.
            This clears the current edit Undo history.
          </p>
          <div className={s.tools}>
            <Button
              primary
              disabled={w.busy}
              onClick={() =>
                void w
                  .run(() =>
                    window.virtualCut!.project.removeRecording(p.project.id, p.activeBatchId, r.id),
                  )
                  .then((value) => {
                    if (value) setConfirm(false);
                  })
              }
            >
              Remove recording
            </Button>
            <Button disabled={w.busy} onClick={() => setConfirm(false)}>
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
    </>
  );
}

export function RecordingActions({
  recording: r,
  workspace: w,
}: {
  recording: Recording;
  workspace: Workspace;
}) {
  const p = w.snapshot;
  if (!p) return null;
  return (
    <div
      className={s.sourceActions}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <Button
        disabled={w.blocking}
        aria-label={`Show source in Explorer: ${r.title}`}
        onClick={() =>
          void w.run(() => window.virtualCut!.project.revealSource(p.project.id, r.id), true)
        }
      >
        <FolderOpen size={15} />
      </Button>
      <RemoveRecordingButton recording={r} workspace={w} icon />
    </div>
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
      <div className={s.tools}>
        <Button disabled={w.busy} onClick={() => void w.run(() => api.relink(p.project.id, r.id))}>
          Relink original…
        </Button>
      </div>
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
