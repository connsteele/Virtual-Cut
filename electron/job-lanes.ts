import type { MediaJob } from './project-contracts.js';

// VC-145: jobs run in two lanes so a long transcription never holds up media work.
// The speech lane runs transcription. The media lane runs inspection, audio preparation,
// export and filing; filmstrips (and later the VC-180 visual pass) fill the media lane
// when it has nothing else to start.
export type JobLane = 'speech' | 'media';
export const jobLanes: readonly JobLane[] = ['speech', 'media'];

export function laneOf(kind: MediaJob['kind']): JobLane {
  return kind === 'transcribe' ? 'speech' : 'media';
}

// Kinds that write a recording's own files in the preview cache (frames, frame index,
// audio copies, waveforms, transcripts). Exports read the recording and write elsewhere.
const writesRecording = new Set<MediaJob['kind']>(['inspect', 'audio', 'transcribe']);
// Work a transcription of the same recording waits for.
const preparesRecording = new Set<MediaJob['kind']>(['inspect', 'audio']);

/** Work the user started (Import, Export, Transcribe, Retry) goes ahead of background work. */
export function isUserJob(job: MediaJob) {
  return job.origin !== 'background';
}

/** Why a queued job cannot start yet, or undefined when it can. */
export function heldBy(job: MediaJob, jobs: readonly MediaJob[], running: readonly MediaJob[]) {
  if (!writesRecording.has(job.kind)) return undefined;
  const same = (j: MediaJob) => j.id !== job.id && j.sourceId === job.sourceId;
  // Never two jobs writing the same recording's files at once, across lanes.
  const writer = running.find((j) => same(j) && writesRecording.has(j.kind));
  if (writer) return writer;
  // A transcription waits for that recording's inspection and audio preparation,
  // including work still queued behind other media jobs.
  if (job.kind === 'transcribe')
    return jobs.find(
      (j) => same(j) && preparesRecording.has(j.kind) && ['queued', 'running'].includes(j.state),
    );
  return undefined;
}

/**
 * The next job to start in a lane. `jobs` is the project's job list oldest first;
 * `running` holds the job each lane is running now.
 */
export function nextJob(
  lane: JobLane,
  jobs: readonly MediaJob[],
  running: readonly MediaJob[],
): MediaJob | undefined {
  if (running.some((j) => laneOf(j.kind) === lane)) return undefined;
  const ready = jobs.filter(
    (j) => j.state === 'queued' && laneOf(j.kind) === lane && !heldBy(j, jobs, running),
  );
  return ready.find(isUserJob) || ready[0];
}
