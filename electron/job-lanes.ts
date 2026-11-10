import type { MediaJob } from './project-contracts.js';

// VC-145: jobs run in two lanes so a long transcription never holds up media work.
// The speech lane runs transcription. The media lane runs inspection, audio preparation,
// export, filing, the VC-180 picture pass and the VC-141 screen text pass; filmstrips fill the
// media lane when it has nothing else to start.
export type JobLane = 'speech' | 'media';
export const jobLanes: readonly JobLane[] = ['speech', 'media'];

export function laneOf(kind: MediaJob['kind']): JobLane {
  return kind === 'transcribe' ? 'speech' : 'media';
}

// Kinds that write a recording's own files in the preview cache (frames, frame index,
// audio copies, waveforms, transcripts). Exports and the picture pass read the recording and
// write elsewhere.
const writesRecording = new Set<MediaJob['kind']>(['inspect', 'audio', 'transcribe']);
// Work a transcription of the same recording waits for.
const preparesRecording = new Set<MediaJob['kind']>(['inspect', 'audio']);

/**
 * The passes over a whole recording: picture events (VC-180), screen text (VC-141) and playback
 * proxies (VC-237). They keep what they have read or made when they give way, and follow the
 * same pause rules, so a proxy leaves the decoder to playback like the picture pass.
 */
export function isPass(job: Pick<MediaJob, 'kind'>) {
  return job.kind === 'visual' || job.kind === 'text' || job.kind === 'proxy';
}

/** Work the user started (Import, Export, Transcribe, Retry) goes ahead of background work. */
export function isUserJob(job: MediaJob) {
  return job.origin !== 'background';
}

/**
 * Order within a lane, lowest first: work the user started, then a picture pass the user asked
 * for ("Analyse picture now"), then background work, then background picture passes.
 */
export function rank(job: MediaJob) {
  if (isPass(job)) return isUserJob(job) ? 1 : 3;
  return isUserJob(job) ? 0 : 2;
}

/** What the picture pass may use (VC-180). */
export interface PictureConditions {
  /** A preview is playing in the app; the GPU decoder stays with playback. */
  previewPlaying: boolean;
  /** No keyboard or mouse input for 5 minutes and no preview playing. */
  idle: boolean;
  /** An NVIDIA decoder reads this recording; undefined until it has been tried. */
  gpu?: (job: MediaJob) => boolean | undefined;
}
export const workingConditions: PictureConditions = { previewPlaying: false, idle: false };

/** Why a picture pass waits, as Jobs shows it, or undefined when it may run. */
export function pictureHold(
  job: MediaJob,
  jobs: readonly MediaJob[],
  running: readonly MediaJob[],
  conditions: PictureConditions,
) {
  const same = (j: MediaJob) => j.id !== job.id && j.sourceId === job.sourceId;
  // It starts after the recording's transcript and its inspection and audio preparation.
  const before = jobs.find(
    (j) => same(j) && writesRecording.has(j.kind) && ['queued', 'running'].includes(j.state),
  );
  if (before)
    return before.kind === 'transcribe'
      ? 'Waiting for this recording’s transcript'
      : 'Waiting for this recording’s inspection';
  // Screen text skips unchanged keyframes using the picture pass's values, so it follows it.
  if (
    job.kind === 'text' &&
    jobs.some((j) => same(j) && j.kind === 'visual' && ['queued', 'running'].includes(j.state))
  )
    return 'Waiting for this recording’s picture events';
  if (running.some((j) => j.kind === 'transcribe')) return 'Paused: transcription running';
  if (conditions.previewPlaying) return 'Paused: preview playing';
  // Screen text decodes keyframes on the CPU and reads them on the GPU (DirectML), so it never
  // waits for an NVIDIA decoder.
  if (job.kind === 'text') return undefined;
  if (conditions.gpu?.(job) === false && !conditions.idle)
    return 'Waiting for the PC to be idle (no NVIDIA decoder)';
  return undefined;
}

/** What a running picture pass uses: the GPU decoder, plus CPU workers when the PC is idle. */
export function pictureUse(job: MediaJob, conditions: PictureConditions) {
  const gpu = conditions.gpu?.(job) !== false;
  if (gpu) return conditions.idle ? ('gpu+cpu' as const) : ('gpu' as const);
  return conditions.idle ? ('cpu' as const) : undefined;
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
  conditions: PictureConditions = workingConditions,
): MediaJob | undefined {
  if (running.some((j) => laneOf(j.kind) === lane)) return undefined;
  return readyJobs(lane, jobs, running, conditions)[0];
}

/** Jobs that could start in a lane, best first (lower rank, then oldest). */
export function readyJobs(
  lane: JobLane,
  jobs: readonly MediaJob[],
  running: readonly MediaJob[],
  conditions: PictureConditions = workingConditions,
) {
  const ready = jobs.filter(
    (j) =>
      j.state === 'queued' &&
      laneOf(j.kind) === lane &&
      !heldBy(j, jobs, running) &&
      !(isPass(j) && pictureHold(j, jobs, running, conditions)),
  );
  return ready
    .map((job, order) => ({ job, order }))
    .sort((a, b) => rank(a.job) - rank(b.job) || a.order - b.order)
    .map((x) => x.job);
}

/**
 * Whether a running picture pass should give way: its hold applies again, or work that ranks
 * ahead of it is ready in its lane. It keeps the chunks it has read and carries on later.
 */
export function pictureYields(
  pass: MediaJob,
  jobs: readonly MediaJob[],
  running: readonly MediaJob[],
  conditions: PictureConditions,
) {
  const others = running.filter((j) => j.id !== pass.id);
  const hold = pictureHold(pass, jobs, others, conditions);
  if (hold) return hold;
  if (pass.kind === 'visual' && !pictureUse(pass, conditions))
    return 'Waiting for the PC to be idle (no NVIDIA decoder)';
  const ahead = readyJobs('media', jobs, others, conditions).find(
    (j) => j.id !== pass.id && rank(j) < rank(pass),
  );
  return ahead ? 'Waiting for other media work' : undefined;
}
