# 0019. Transcription and media work run in separate lanes

- Status: Proposed
- Sources: VC-145, the October 4 overnight audit, Sprint 10 refinement

## Context

Every job ran one at a time, oldest first, so an import's inspection or an export waited behind a
long transcription. The footage evidence work (VC-140, starting with the VC-180 visual pass) adds
more long jobs.

## Decision

- **Two lanes:** the speech lane runs transcription; the media lane runs inspection, audio
  preparation, export and filing. Filmstrips fill the media lane when it has nothing to start,
  and the VC-180 picture pass joins the media lane as background work with its own pause rules
  ([0020](0020-picture-events.md)). Each lane runs one job at a time.
- **User work first:** within a lane, work the user started (Import, Relink, Export, filing,
  Transcribe, Prepare audio, Retry, Resume) goes ahead of work the app queued by itself (audio
  preparation after inspection or on opening, transcription chosen at import). Oldest first
  within each group. Jobs saved before this change count as user work.
- **Per-recording lock across lanes:** inspection and audio preparation never run while that
  recording is being transcribed, and a transcription waits for its recording's queued or running
  inspection and audio preparation. Exports read the recording and write elsewhere, so they run
  beside its transcription. A held job is skipped, never blocking the rest of its lane.
- Cancel, pause, close, restore and removal stop the running job in its own lane; restart
  recovery and job history are unchanged. The rules live in `electron/job-lanes.ts`.

## Consequences

An export runs at the same time as a transcription and shares the machine with it; the measured
slowdown is in the VC-145 evidence. A new long job kind picks its lane in `laneOf` and, if it
writes a recording's files, joins `writesRecording`.
