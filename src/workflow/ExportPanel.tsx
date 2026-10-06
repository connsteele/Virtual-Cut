import { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import type {
  ExportContainerChoice,
  ExportPlan,
  SubtitleRole,
} from '../../electron/export-contracts';
import { SubtitleChoice } from './SubtitleChoice';
import { JobTime } from './JobTime';
import type { useProjectWorkspace } from './useProjectWorkspace';
import { Button, Field, Modal } from './ui';
import s from './Workflow.module.css';
import { background } from './background';
type Workspace = ReturnType<typeof useProjectWorkspace>;
const range = (r: { start: number; end: number }) =>
  `${r.start.toFixed(3)} → ${r.end.toFixed(3)} s`;
export function ExportPanel({
  workspace: w,
  clipId,
  onClose,
  onQueued,
}: {
  workspace: Workspace;
  clipId: string;
  onClose: () => void;
  onQueued: () => void;
}) {
  const clip = w.model.clips.find((c) => c.id === clipId),
    recording = w.model.recordings.find((r) => r.id === clip?.rid);
  const [container, setContainer] = useState<ExportContainerChoice>('source'),
    [plan, setPlan] = useState<ExportPlan>(),
    [error, setError] = useState(''),
    [preparing, setPreparing] = useState(true),
    [confirmed, setConfirmed] = useState(false),
    [subtitles, setSubtitles] = useState<SubtitleRole[]>([]);
  const available = (clip && w.snapshot!.transcriptRoles?.[clip.rid]) || [];
  const projectId = w.snapshot!.project.id,
    flush = w.flush;
  useEffect(() => {
    let active = true;
    window.dispatchEvent(new Event('virtual-cut-pause-workspace'));
    void flush()
      .then(() => window.virtualCut!.project.exportPlan(projectId, clipId, container))
      .then((value) => {
        if (active) {
          setPlan(value);
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (active) setPreparing(false);
      });
    return () => {
      active = false;
    };
  }, [clipId, container, projectId, flush]);
  return (
    <Modal title="Export selected clip" onClose={onClose}>
      <h3>{clip?.name || 'Clip'}</h3>
      <Field label="Video container">
        <select
          aria-label="Export container"
          value={container}
          disabled={w.busy}
          onChange={(e) => {
            setContainer(e.target.value as ExportContainerChoice);
            setPlan(undefined);
            setPreparing(true);
            setError('');
          }}
        >
          <option value="source">
            Same as source
            {recording?.sourcePath
              ? ` (${recording.sourcePath.split('.').at(-1)?.toUpperCase()})`
              : ''}
          </option>
          <option value="mp4">MP4</option>
          <option value="mkv">MKV</option>
        </select>
      </Field>
      {preparing && <p role="status">Checking the cut range…</p>}
      {plan && (
        <div className={s.saveTableWrap}>
          <table className={s.saveTable} aria-label="Export ranges">
            <tbody>
              <tr>
                <th>Requested</th>
                <td>{range(plan.requested)}</td>
              </tr>
              <tr>
                <th>Outward cut</th>
                <td>{range(plan.planned)}</td>
              </tr>
              <tr>
                <th>Audio</th>
                <td>
                  Game track{' '}
                  {(recording?.audioTracks?.findIndex((t) => t.index === plan.gameTrack) ?? 0) + 1}{' '}
                  → output audio track 1
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p>
        The original video and selected game audio are copied. Cuts expand to the nearest usable
        keyframes. Final packet timing and the actual range are checked before the output is
        published.
      </p>
      <label className={s.tools}>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        The chosen game track is clean, with no microphone mixed into it.
      </label>
      <p className={s.muted}>
        A companion .vcut.json file preserves colors, notes, folder intent and source details.
        Chapter names and times are embedded in the video. Resolve color and note transfer still
        needs manual review.
      </p>
      <SubtitleChoice available={available} value={subtitles} onChange={setSubtitles} />
      {plan && ['mp4', 'mov', 'm4v'].includes(plan.container) && (
        <p className={s.muted}>
          {plan.container.toUpperCase()} may add a neutral “Clip start” chapter so the first real
          marker keeps its time.
        </p>
      )}
      <Button
        primary
        disabled={!plan || preparing || !confirmed || w.busy}
        onClick={() =>
          background(
            w
              .run(
                () =>
                  window.virtualCut!.project.exportClip(
                    projectId,
                    plan!.id,
                    confirmed,
                    subtitles.filter((r) => available.includes(r)),
                  ),
                true,
              )
              .then((value) => {
                if (value) onQueued();
              }),
          )
        }
      >
        Choose output file…
      </Button>
      {(error || w.error) && (
        <p role="alert" className={s.error}>
          {error || w.error}
        </p>
      )}
    </Modal>
  );
}
export function ExportHistory({
  workspace: w,
  onClose,
  onHandoff,
}: {
  workspace: Workspace;
  onClose: () => void;
  onHandoff: () => void;
}) {
  const p = w.snapshot!,
    records = p.exports.filter((e) => e.state !== 'planned');
  useEffect(() => {
    window.dispatchEvent(new Event('virtual-cut-pause-workspace'));
  }, []);
  return (
    <Modal title="Exports" onClose={onClose}>
      <p>
        Verified exports remain in this history when you undo edits or restore a save. Use File
        queue in Review to complete accepted clips in their planned folders.
      </p>
      <Button onClick={onHandoff}>Handoff to Resolve…</Button>
      <div className={s.saveTableWrap}>
        <table className={s.saveTable} aria-label="Export history">
          <thead>
            <tr>
              <th>Clip</th>
              <th>Status / range</th>
              <th>Time</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.map((e) => (
              <tr key={e.plan.id}>
                <td>
                  {e.plan.name}
                  <br />
                  <span className={s.muted}>
                    {new Date(e.updated).toLocaleString()}
                    {!e.current && ' · Earlier edits'}
                  </span>
                </td>
                <td>
                  <strong>{e.state === 'verified' ? 'Verified' : e.state}</strong>
                  <br />
                  {e.verification && (
                    <span>
                      {range(e.verification.actual)}
                      <br />
                    </span>
                  )}
                  <span className={s.muted}>{e.message}</span>
                </td>
                <td>
                  <JobTime
                    started={e.started}
                    elapsedMs={e.elapsedMs}
                    running={e.state === 'running'}
                  />
                </td>
                <td>
                  <div className={s.tools}>
                    {e.state === 'verified' ? (
                      <>
                        <Button
                          aria-label={`Show video: ${e.plan.name}`}
                          onClick={() =>
                            background(
                              w.run(
                                () =>
                                  window.virtualCut!.project.revealExport(
                                    p.project.id,
                                    e.plan.id,
                                    'video',
                                  ),
                                true,
                              ),
                            )
                          }
                        >
                          <FolderOpen size={15} />
                          Video
                        </Button>
                        <Button
                          onClick={() =>
                            background(
                              w.run(
                                () =>
                                  window.virtualCut!.project.revealExport(
                                    p.project.id,
                                    e.plan.id,
                                    'metadata',
                                  ),
                                true,
                              ),
                            )
                          }
                        >
                          Metadata
                        </Button>
                      </>
                    ) : (
                      p.jobs.some((j) => j.id === e.plan.id) && (
                        <Button
                          disabled={w.busy}
                          onClick={() =>
                            background(
                              w.run(
                                () =>
                                  window.virtualCut!.project.job(
                                    p.project.id,
                                    e.plan.id,
                                    ['queued', 'running'].includes(e.state) ? 'cancel' : 'retry',
                                  ),
                                true,
                              ),
                            )
                          }
                        >
                          {['queued', 'running'].includes(e.state) ? 'Cancel' : 'Retry'}
                        </Button>
                      )
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!records.length && (
        <p className={s.muted}>Export a selected clip from Cut or its Review details.</p>
      )}
      {w.error && (
        <p role="alert" className={s.error}>
          {w.error}
        </p>
      )}
    </Modal>
  );
}
