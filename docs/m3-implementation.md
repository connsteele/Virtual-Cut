# M3 audio intelligence

## Context and recognition

Project game identity, vocabulary and optional video brief are small editorial records. Batches can inherit, override or explicitly clear game context; briefs can also append. These changes use normal session Undo and timed/manual saves.

Local transcription is explicit. Imports offer one opt-in prompt; existing sources can be transcribed later. Game and microphone tracks are separate jobs. The native queue freezes the selected batch context before running. Content-addressed context revisions are stored once in SQLite, with references from jobs and transcript records. Repeated matching requests reuse the existing job/result.

Recognition runs in a disposable Python process using faster-whisper. A separate guard owns a Windows Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, monitors the app process handle, and assigns the recognition process before sending its request. Completion, cancellation, failure and parent exit release the worker and its children. Extracted 16 kHz mono audio goes into the project's disposable preview directory and is removed. Downloaded model files remain reusable on disk.

The validated runtime is faster-whisper 1.2.1 / CTranslate2 4.8.2, Whisper large-v3, CPU int8 or NVIDIA float16. Imports and later transcription offer Automatic / NVIDIA / CPU. Automatic checks compatible NVIDIA libraries and warms the model encoder before recognition, falling back to CPU on startup failure with a retained explanation. Explicit NVIDIA selection reports failure. Runtime locations are native settings, never supplied by an arbitrary renderer path. Setup links to official installation instructions. The review package still requires a separately installed local runtime; a portable managed installer remains open work. See [runtime isolation and upgrades](../integrations/transcription/README.md).

The `utterance-v1` pipeline scans 60-second PCM windows with speech detection and recognizes bounded speech spans independently, preserving each span's source offset. This avoids the severe early word anchors observed when sparse speech was concatenated across silence. Vocabulary hints are opt-in and can improve names or introduce incorrect expected words. They are not an agent correction pass. Pause retains partial recognition for inspection and exits; Resume restarts that track, replacing only its incomplete run. Completed originals are immutable.

## Persistence and editing

Schema 4 adds transcript metadata, immutable segments and context revisions. Original recognition stays outside Model, renderer workspace polling and Undo. Manual corrections and cue decisions are small editorial records. A word correction preserves its anchor; changing word count requires a phrase correction with phrase timing explicitly shown. Old recognition remains available. Before upgrading an older project, the existing migration mechanism makes a verified pre-upgrade copy. Older apps reject schema 4.

The transcript window is a separate sandboxed Electron window. It has a narrow IPC interface; broad project/file access remains restricted to the main editor. Word seeking controls the existing viewer. Editorial commands go through the main editor's flush/merge/Undo path and reject stale correction values. Closing the transcript window does not end a requested recognition job or discard edits.

Cue extraction is conservative and microphone-only. Mark, Note, Split (also Cut), Clip start/in and Clip end/out at the beginning of a phrase are tentative candidates; ordinary grammatical uses such as “Mark is…” are excluded. Continuations remain with a candidate across pauses until the next cue, with reviewable text. Mark creates a point marker, Note creates a local timed note, and Split divides a selected intersecting clip. Clip boundary pairs create one range and two linked review decisions in one Undo step. Repeated or missing boundaries are left unresolved. Every candidate requires acceptance; its proposed time can be adjusted first. This is not semantic agent understanding.

Manual corrections also feed candidate detection without replacing the original recognition. A reviewed cue is matched across reruns by source, stream, type and a 0.5-second timing tolerance to avoid duplicate actions; larger ASR shifts still require review. Decisions retain the spoken anchor separately from the accepted position. Relative instructions such as “before the transition” require choosing the intended position; interpreting those instructions belongs to agent integration.

Single-click selects/seeks a word, double-click edits, and Escape closes the editor. J/K/L is forwarded to the main viewer only outside typing controls. Follow playback changes transcript pages in both directions; search, cue filtering, manual paging, wheel browsing and correction suspend it. Cue filters search the entire recognition, not just the visible page. Reading uses bounded SQLite pages, with no live statement retained across generator yields. Recording cards reuse existing job snapshots for game/mic progress; they add no polling or recognition work.

The local review package can explicitly reference an existing workstation runtime through `VIRTUAL_CUT_ASR_REVIEW_CONFIG`. These paths are not embedded in normal public packages. No model is loaded by opening the app or searching a saved transcript. This review build is not a self-contained Python/model installer.

## Boundaries

VC-83 keeps a separate reviewed title and context text, exposes the included source
span, and allows choosing the last included phrase. Silence does not shorten the
proposal. Bounded context parts are derived on read; recognition stays immutable.
Paired boundary editors share the start cue's context. Accepted annotations retain
small transcript/phrase/span provenance in their cue decisions, with ordinary Undo
and saves. Native commands reject foreign phrases and changed context proposals.
Hidden Electron checks passed context selection, seeking, typing guards and compact
layout. The first malformed-record test incorrectly expected an optional null value
to fail; its corrected case and all ten domain tests passed afterward. The original
failed report is retained under `review-0.4.4/cue-context/run-NSAtPs`; both desktop
checks there passed, and the final paired-context follow-up passed in `run-Kjo2vi`.

VC-82 initializes a paired clip's title from the start cue when opened from either
boundary. Reviewed title overrides remain explicit; both decisions and the new clip
still share one Undo step. Domain checks and the hidden Electron transcript review
passed both boundary flows, including Undo/Redo. Evidence:
`G:\GPT\Work\virtual-cut\review-0.4.4\cue-titles\run-wbPVRz\report.json`.

Floating transcript windows are included; docking is excluded by user decision. Automated context-aware name correction belongs to early M4 (VC-24). Speaker detection remains last-priority, explicit follow-up work. Recognition confidence and timings are estimates requiring representative audio review; an automated integration pass is not a claim of transcription accuracy.

## References

- [Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- [faster-whisper implementation](https://github.com/SYSTRAN/faster-whisper/blob/master/faster_whisper/transcribe.py)

The review guide and evidence reports distinguish real recognition runs, synthetic behavior tests, and checks requiring Connor's review.
