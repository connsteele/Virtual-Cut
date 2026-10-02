# M3 audio intelligence

## Context and recognition

Project game identity, vocabulary and optional video brief are small editorial records. Batches can inherit, override or explicitly clear game context; briefs can also append. These changes use normal session Undo and timed/manual saves.

Local transcription is explicit. Imports offer one opt-in prompt; existing sources can be transcribed later. Game and microphone tracks are separate jobs. The native queue freezes the selected batch context before running. Content-addressed context revisions are stored once in SQLite, with references from jobs and transcript records. Repeated matching requests reuse the existing job/result.

Recognition runs in a disposable Python process using faster-whisper. A separate guard owns a Windows Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, monitors the app process handle, and assigns the recognition process before sending its request. Completion, cancellation, failure and parent exit release the worker and its children. Extracted 16 kHz mono audio goes into the project's disposable preview directory and is removed. Downloaded model files remain reusable on disk.

The current validated runtime is faster-whisper 1.2.1 / CTranslate2 4.8.2, Whisper large-v3, CPU int8, four threads. CUDA is optional and requires compatible libraries; CPU measurements do not establish GPU performance. Runtime locations are native settings, never supplied by an arbitrary renderer path. The packaged application supports a separately installed local runtime.

## Persistence and editing

Schema 4 adds transcript metadata, immutable segments and context revisions. Original recognition stays outside Model, renderer workspace polling and Undo. Manual corrections and cue decisions are small editorial records. A word correction preserves its anchor; changing word count requires a phrase correction with phrase timing explicitly shown. Old recognition remains available. Before upgrading an older project, the existing migration mechanism makes a verified pre-upgrade copy. Older apps reject schema 4.

The transcript window is a separate sandboxed Electron window. It has a narrow IPC interface; broad project/file access remains restricted to the main editor. Word seeking controls the existing viewer. Editorial commands go through the main editor's flush/merge/Undo path and reject stale correction values. Closing the transcript window does not end a requested recognition job or discard edits.

Cue extraction is conservative and microphone-only. Mark, Note and Cut at the beginning of a phrase are tentative candidates; ordinary grammatical uses such as “Mark is…” are excluded. Continuations remain with a candidate across pauses until the next cue, with reviewable text. Mark creates a point marker, Note creates a local timed note, and Cut splits exactly one intersecting clip. All require acceptance and use ordinary Undo. This is not semantic agent understanding.

## Boundaries

Floating transcript windows are included; docking is excluded by user decision. Automated context-aware name correction belongs to early M4 (VC-24). Speaker detection remains last-priority, explicit follow-up work. Recognition confidence and timings are estimates requiring representative audio review; an automated integration pass is not a claim of transcription accuracy.

## References

- [Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- [faster-whisper implementation](https://github.com/SYSTRAN/faster-whisper/blob/master/faster_whisper/transcribe.py)

The review guide and evidence reports distinguish real recognition runs, synthetic behavior tests, and checks requiring Connor's review.
