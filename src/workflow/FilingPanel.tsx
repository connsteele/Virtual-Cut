import { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import type { FilingPlan } from '../../electron/export-contracts';
import type { useProjectWorkspace } from './useProjectWorkspace';
import { Button, Modal } from './ui';
import { JobTime } from './JobTime';
import s from './Workflow.module.css';
type Workspace = ReturnType<typeof useProjectWorkspace>;
const range = (r?: { start: number; end: number }) =>
  r ? `In: ${r.start.toFixed(3)} · Out: ${r.end.toFixed(3)} s` : 'Unavailable';
export function FilingPanel({
  workspace: w,
  onClose,
  onLibrary,
}: {
  workspace: Workspace;
  onClose: () => void;
  onLibrary: () => void;
}) {
  const p = w.snapshot!,
    [plan, setPlan] = useState<FilingPlan>(),
    [queueId, setQueueId] = useState(''),
    [showProgress, setShowProgress] = useState(() =>
      p.exports.some((e) => e.filing && ['queued', 'running'].includes(e.state)),
    ),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(''),
    [checking, setChecking] = useState(true);
  const id = p.project.id,
    batchId = p.activeBatchId,
    flush = w.flush;
  useEffect(() => {
    let active = true;
    window.dispatchEvent(new Event('virtual-cut-pause-workspace'));
    void flush()
      .then(() => window.virtualCut!.project.filingPlan(id, batchId))
      .then((value) => {
        if (active) setPlan(value);
      })
      .catch((e) => {
        if (active) setError(String(e.message || e));
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [id, batchId, flush]);
  const records = p.exports.filter(
    (e) =>
      e.filing &&
      (queueId ? e.filing.queueId === queueId : showProgress || e.filing.batchId === batchId) &&
      e.state !== 'planned',
  );
  const pending = records.some((e) => ['queued', 'running'].includes(e.state));
  return (
    <Modal title="File accepted clips" onClose={onClose} className={s.filingModal}>
      <p>
        Copy the accepted clips into their chosen folders using the source container. Each video
        keeps its original video and clean game audio. The requested cuts expand to usable
        keyframes; names, markers, notes and source details travel with the companion file.
      </p>
      <div className={s.tools}>
        <Button aria-pressed={!showProgress} onClick={() => setShowProgress(false)}>
          Plan
        </Button>
        <Button aria-pressed={showProgress} onClick={() => setShowProgress(true)}>
          Progress · {records.length}
        </Button>
      </div>
      {!showProgress && (
        <>
          <p className={s.muted}>
            Destination:{' '}
            <Button
              className={s.destinationLink}
              title="Open destination in Explorer"
              onClick={() =>
                void w.run(() => window.virtualCut!.project.revealDestination(id, ''), true)
              }
            >
              {plan?.root || p.project.destination}
            </Button>
          </p>
          {checking && <p role="status">Checking accepted clips and destinations…</p>}
          {plan && (
            <div className={s.saveTableWrap}>
              <table className={`${s.saveTable} ${s.filingTable}`} aria-label="Filing plan">
                <thead>
                  <tr>
                    <th>
                      Clip
                      <br />
                      Destination
                    </th>
                    <th>
                      Requested
                      <br />
                      Outward cut
                    </th>
                    <th>Checks</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.map((row) => (
                    <tr key={row.clipId}>
                      <td>
                        <strong>{row.name}</strong>
                        <br />
                        <Button
                          className={s.destinationLink}
                          title="Open destination in Explorer (nearest existing parent if not created yet)"
                          onClick={() =>
                            void w.run(
                              () => window.virtualCut!.project.revealDestination(id, row.folder),
                              true,
                            )
                          }
                        >
                          {row.path}
                        </Button>
                      </td>
                      <td>
                        {range(row.requested)}
                        <br />
                        {range(row.planned)}
                      </td>
                      <td>
                        {row.issues.length
                          ? row.issues.map((issue) => (
                              <p key={issue} className={s.error}>
                                {issue}
                              </p>
                            ))
                          : 'Ready'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!plan.rows.length && <p>No accepted clips are waiting in this batch.</p>}
            </div>
          )}
          <label className={s.tools}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Every selected game track is clean, with no microphone mixed into it.
          </label>
          <p className={s.muted}>
            Filing saves this accepted plan before starting. Original recordings stay in place. Done
            appears only after the finished video, companion and dates are verified.
          </p>
          <Button
            primary
            disabled={
              checking ||
              w.busy ||
              !confirmed ||
              !plan?.rows.length ||
              plan.rows.some((row) => row.issues.length)
            }
            onClick={() =>
              void w
                .run(() => window.virtualCut!.project.fileQueue(id, plan!.id, confirmed), true)
                .then((value) => {
                  if (value) {
                    setQueueId(plan!.id);
                    setShowProgress(true);
                  }
                })
            }
          >
            File {plan?.rows.length || 0} accepted clips
          </Button>
        </>
      )}
      {showProgress && !records.length && <p>No filing work in this project yet.</p>}
      {showProgress && !!records.length && (
        <>
          <h3>{queueId ? 'This filing queue' : 'Recent filing work'}</h3>
          <div className={s.saveTableWrap}>
            <table className={s.saveTable} aria-label="Filing progress">
              <thead>
                <tr>
                  <th>Clip</th>
                  <th>Status</th>
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
                      <Button
                        className={s.destinationLink}
                        title="Open filing destination in Explorer (nearest existing parent if not created yet)"
                        onClick={() =>
                          void w.run(
                            () =>
                              e.state === 'verified'
                                ? window.virtualCut!.project.revealExport(id, e.plan.id, 'video')
                                : window.virtualCut!.project.revealDestination(
                                    id,
                                    e.filing!.folder,
                                  ),
                            true,
                          )
                        }
                      >
                        {e.output || e.filing!.folder || p.project.destination}
                      </Button>
                    </td>
                    <td>
                      <strong>{e.filing?.state === 'complete' ? 'Done' : e.state}</strong>
                      <br />
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
                      {e.state === 'verified' ? (
                        <Button
                          aria-label={`Show filed clip: ${e.plan.name}`}
                          onClick={() =>
                            void w.run(
                              () => window.virtualCut!.project.revealExport(id, e.plan.id, 'video'),
                              true,
                            )
                          }
                        >
                          <FolderOpen size={16} />
                        </Button>
                      ) : ['failed', 'interrupted', 'cancelled'].includes(e.state) ? (
                        <Button
                          disabled={w.busy}
                          onClick={() =>
                            void w.run(
                              () => window.virtualCut!.project.job(id, e.plan.id, 'retry'),
                              true,
                            )
                          }
                        >
                          Retry
                        </Button>
                      ) : ['queued', 'running'].includes(e.state) ? (
                        <Button
                          aria-label={`Cancel filing: ${e.plan.name}`}
                          disabled={w.busy}
                          onClick={() =>
                            void w.run(
                              () => window.virtualCut!.project.job(id, e.plan.id, 'cancel'),
                              true,
                            )
                          }
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pending && (
            <Button
              className={s.dangerButton}
              disabled={w.busy}
              onClick={() =>
                void w.run(async () => {
                  let result;
                  for (const q of new Set(
                    records
                      .filter((e) => ['queued', 'running'].includes(e.state))
                      .map((e) => e.filing!.queueId),
                  ))
                    result = await window.virtualCut!.project.cancelFiling(id, q);
                  return result;
                }, true)
              }
            >
              Cancel remaining filing
            </Button>
          )}
          <Button onClick={onLibrary}>Open Library</Button>
          <p className={s.muted}>
            You can close this panel while filing continues. Cancelled or interrupted items stay
            here and in Jobs for an explicit retry.
          </p>
        </>
      )}
      {(error || w.error) && (
        <p role="alert" className={s.error}>
          {error || w.error}
        </p>
      )}
    </Modal>
  );
}
