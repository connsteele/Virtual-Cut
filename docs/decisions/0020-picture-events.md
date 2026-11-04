# 0020. One background picture pass per recording, events kept beside the model

- Status: Proposed
- Sources: VC-180, the visual data spike (Seeing the Footage, D2, accepted October 10), decision
  [0019](0019-job-lanes.md), the Sprint 10 refinement

## Context

Agents (VC-171), the Split snap (VC-165) and later the frame index (VC-135) need to know where a
recording goes black, freezes, cuts hard or fades, across the whole recording. The snap decoded
5 s around each Split on demand. Decoding a whole 4K60 AV1 recording takes minutes, shares the GPU
with playback, transcription and other GPU work on the PC, and must not slow what Connor waits on.

## Decision

- **One pass per recording and source fingerprint**, queued after import as background work in
  the media lane. It starts after the recording's transcript, inspection and audio preparation.
- **What it reads:** per frame, on a 480 px picture, the mean brightness (`signalstats`), the share
  of dark pixels (`blackframe`, the snap's 10% / 92% rule) and the cut score (`scdet`), plus
  FFmpeg's still pictures (`freezedetect`, 0.5 s). The app builds black, still, strong-cut (score
  15 or more) and fade events (no cut scoring 8 or more within it) from those values, so where chunks fall never changes them.
- **How it decodes:** 30 s chunks with 0.5 s of pre-roll and 1 s of post-roll. One NVDEC worker
  while Connor works; NVDEC plus up to three CPU workers when the PC is idle (5 minutes without
  input by Electron's system idle time, and no preview playing). With no NVIDIA decoder for the
  recording, CPU workers only, and only when idle. CPU workers stop as soon as input returns.
- **When it waits:** paused while any transcription runs and while a preview plays. It gives way to
  every other media job (user work first, then background work) and carries on from the chunks it
  has read. "Analyse picture now" (a recording card, or the batch in Jobs) ranks it behind work the
  user started and ahead of other background work, under the same rules.
- **Where events live:** the project's `picture_events` table, keyed by recording and source
  fingerprint, with a version. Not in the editable model, never in Undo, removed with the
  recording. Per-frame values are stored compactly (time, brightness and cut score, about 6 bytes a
  frame).
- **Readers:** the Split snap uses stored black screens instead of decoding its window, with the
  same answer. VC-171 reads the same events.

## Alternatives considered

- FFmpeg's `blackdetect` and `freezedetect` events per chunk: black screens and stills restarted at
  every chunk edge (the spike found stills differing by one or two). Blacks now come from per-frame
  values; stills crossing a chunk edge are joined from the next chunk's pre-roll.
- A fixed GPU/CPU split of the recording: slower than a chunk queue that balances itself (spike).
- Two NVDEC sessions: the RTX 4090 has one AV1 decode engine.
- Running beside transcription: NVDEC made a transcription 11–27% slower, the CPU path about twice
  as slow (spike).

## Consequences

Imports start one more background job per recording. Recordings imported before this change get
their events from "Analyse picture now". NVDEC scales inside the decoder, so a cut score or a
still's brightness can differ in the last place between decoders; event kinds and times match.
Checks run with `VIRTUAL_CUT_PICTURE_PASS=manual` so imports elsewhere in the suite don't start
picture passes. A new reader of picture events should go through `ProjectStore.pictureEvents`.
