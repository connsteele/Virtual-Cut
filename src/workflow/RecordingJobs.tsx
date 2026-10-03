import type { MediaJob } from '../../electron/project-contracts';
import s from './Workflow.module.css';

export function jobLabel(job: MediaJob) {
  if (job.kind === 'inspect') return 'Inspect media and prepare timeline';
  if (job.kind === 'export') return 'Export clip';
  if (job.kind === 'transcribe') return `${job.role === 'mic' ? 'Mic' : 'Game'} transcription`;
  return `Prepare audio preview · track ${job.track}`;
}

/** Uses the existing project job snapshot; no additional polling or media work. */
export function RecordingTranscription({ jobs, sourceId }: { jobs: MediaJob[]; sourceId: string }) {
  const latest = new Map<string, MediaJob>();
  for (const job of jobs) {
    if (job.sourceId !== sourceId || job.kind !== 'transcribe') continue;
    const key = job.role || String(job.track);
    const previous = latest.get(key);
    const priority = (item: MediaJob) =>
      item.state === 'running' ? 2 : item.state === 'queued' ? 1 : 0;
    if (
      !previous ||
      priority(job) > priority(previous) ||
      (priority(job) === priority(previous) && job.updated > previous.updated)
    )
      latest.set(key, job);
  }
  if (!latest.size) return null;
  return (
    <div className={s.recordingTranscription}>
      {[...latest.values()].map((job) => (
        <div key={job.id}>
          <small>
            {jobLabel(job)} · {job.state === 'succeeded' ? 'ready' : job.state}
            {job.device && ` · ${job.device === 'cuda' ? 'NVIDIA GPU' : 'CPU'}`}
            {job.deviceMessage && ' · GPU fallback'}
          </small>
          {job.state === 'running' && (
            <progress aria-label={jobLabel(job)} value={job.progress} max={1} />
          )}
          {job.state === 'running' && <small className={s.muted}>{job.message}</small>}
        </div>
      ))}
    </div>
  );
}
