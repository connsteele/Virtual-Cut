# M3 audio intelligence

## Context and recognition

Project game identity, vocabulary and optional video brief are small editorial records. Batches can inherit, override or explicitly clear game context; briefs can also append. These changes use normal session Undo and timed/manual saves.

Local transcription is explicit. Imports offer one opt-in prompt; existing sources can be transcribed later. Game and microphone tracks are separate jobs. The native queue freezes the selected batch context before running. Content-addressed context revisions are stored once in SQLite, with references from jobs and transcript records. Repeated matching requests reuse the existing job/result.

Recognition runs in a disposable Python process using faster-whisper. A separate guard owns a Windows Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, monitors the app process handle, and assigns the recognition process before sending its request. Completion, cancellation, failure and parent exit release the worker and its children. Extracted 16 kHz mono audio goes into the project's disposable preview directory and is removed. Downloaded model files remain reusable on disk.

The validated runtime is faster-whisper 1.2.1 / CTranslate2 4.8.2, Whisper large-v3, CPU int8 or NVIDIA float16. Imports and later transcription offer Automatic / NVIDIA / CPU. Automatic checks compatible NVIDIA libraries and warms the model encoder before recognition, falling back to CPU on startup failure with a retained explanation. Explicit NVIDIA selection reports failure. Runtime locations are native settings, never supplied by an arbitrary renderer path. From 0.4.7, optional managed setup downloads a pinned engine/model into a native-selected folder, with integrity checks, explicit activation and previous-setup restoration. Existing installations remain supported. See [runtime isolation and upgrades](../integrations/transcription/README.md).

The `utterance-v1` pipeline scans 60-second PCM windows with speech detection and recognizes bounded speech spans independently, preserving each span's source offset. This avoids the severe early word anchors observed when sparse speech was concatenated across silence. Vocabulary hints are opt-in and can improve names or introduce incorrect expected words. They are not an agent correction pass. Pause retains partial recognition for inspection and exits; Resume restarts that track, replacing only its incomplete run. Completed originals are immutable.

## Persistence and editing

Schema 4 adds transcript metadata, immutable segments and context revisions. Original recognition stays outside Model, renderer workspace polling and Undo. Manual corrections and cue decisions are small editorial records. A word correction preserves its anchor; changing word count requires a phrase correction with phrase timing explicitly shown. Old recognition remains available. Before upgrading an older project, the existing migration mechanism makes a verified pre-upgrade copy. Older apps reject schema 4.

The transcript window is a separate sandboxed Electron window. It has a narrow IPC interface; broad project/file access remains restricted to the main editor. Word seeking controls the existing viewer. Editorial commands go through the main editor's flush/merge/Undo path and reject stale correction values. Closing the transcript window does not end a requested recognition job or discard edits.

Cue extraction is conservative and microphone-only. Mark, Note, Split (also Cut), Clip start/in and Clip end/out at the beginning of a phrase are tentative candidates; ordinary grammatical uses such as “Mark is…” are excluded. Continuations remain with a candidate across pauses until the next cue, with reviewable text. Mark creates a point marker, Note creates a local timed note, and Split divides a selected intersecting clip. Clip boundary pairs create one range and two linked review decisions in one Undo step. Repeated or missing boundaries are left unresolved. Every candidate requires acceptance; its proposed time can be adjusted first. This is not semantic agent understanding.

Manual corrections also feed candidate detection without replacing the original recognition. A reviewed cue is matched across reruns by source, stream, type and a 0.5-second timing tolerance to avoid duplicate actions; larger ASR shifts still require review. Decisions retain the spoken anchor separately from the accepted position. Relative instructions such as “before the transition” require choosing the intended position; interpreting those instructions belongs to agent integration.

Single-click selects/seeks a word, double-click edits, and Escape closes the editor. J/K/L is forwarded to the main viewer only outside typing controls. Follow playback changes transcript pages in both directions; search, cue filtering, manual paging, wheel browsing and correction suspend it. Cue filters search the entire recognition, not just the visible page. Reading uses bounded SQLite pages, with no live statement retained across generator yields. Recording cards reuse existing job snapshots for game/mic progress; they add no polling or recognition work.

The local review package can explicitly reference an existing workstation runtime through `VIRTUAL_CUT_ASR_REVIEW_CONFIG`. These paths are not embedded in normal public packages. No model is loaded by opening the app or searching a saved transcript. Version 0.4.7 adds an optional managed download rather than embedding several gigabytes of Python, dependencies and model files in each app build. Clean second-computer compatibility still needs acceptance.

VC-91 keeps one page lookup per active reader context. Frequent position updates do
not cancel the previous lookup; source/transcript, editing and filter changes still
invalidate its result. An isolated-seek test had missed the starvation path. A
continuous 140 ms position stream with 350 ms native lookup latency fails before
the fix and passes afterward in both directions. Actual source playback across a
page boundary and late-result isolation after switching cue filters are included.
These checks establish a failure path, not the exact latency in Connor's session.

## Boundaries

VC-80 retains search, selected recognition, page/filter, highlighted word, original
display and scroll when the transcript window is closed normally and reopened in
the same open project. A small cache holds at most eight recording views. It writes
only on source changes or normal window close; there are no position/poll writes.
The native controller supplies an opaque lifetime that changes on project reopen
or app restart. Unavailable storage and stale transcripts fall back to a fresh view.
Correction/cue drafts, transcript bodies, jobs and project edits are excluded.
The native close path, page-two restoration, draft exclusion and project-reopen reset
passed hidden Electron checks. An initial test used Playwright's forced page disposal,
which skips the ordinary close lifecycle; it was corrected to use BrowserWindow.close.
Evidence: `review-0.4.4/reading-state/run-xAGDdt/transcript-review/run-B8qBSi` on G:.

VC-85 labels the native transcript save dialog by source or verified completed-clip
scope and suggests a Windows-safe filename containing the selected name, scope and
audio role. The SRT tooltip uses the selected timing scope. Domain and hidden Electron
checks passed both scopes, actual verified ranges and refusal to overwrite a video's
companion. Evidence: `review-0.4.4/export-scope/run-JHmJOr/report.json` on G:.

VC-84 accepts punctuated first-person requests for a note/marker (including the
reported “Mark, can I get a note…” form) and explicit colon-prefixed context.
Ordinary name references and requests addressed to Mark remain excluded. All
results are uncertain microphone candidates requiring review; no annotation is
created by detection. Positive/negative phrase cases and rejection/rerun preservation
passed domain checks. This tests wording rules, not broader acoustic recognition.

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

## Automatic device readiness — 0.4.5 (VC-87)

Import and floating Transcript options share a lightweight GPU readiness check
before allowing Automatic/NVIDIA requests to start. A missing GPU requires an
explicit choice to continue on CPU for that request. Native probes are cached and
coalesce concurrent calls; Check again invalidates a completed result. The narrow
IPC contract accepts only an optional boolean refresh flag. No model is loaded and
no continuous check runs. Device changes and refreshes reset the CPU choice, with
stale asynchronous results ignored.

Jobs retain actual CPU/CUDA and fallback details through progress, completion,
session reads and persistence. The worker reports fallback before CPU model loading.
GPU readiness cannot guarantee later model startup or free VRAM; that remaining
failure uses the existing Automatic fallback and visible job explanation.

The 0.4.4 review configuration had omitted the installed NVIDIA library folder;
0.4.5 restores it. A real Automatic run using only the packaged configuration
verified CUDA startup on a disposable synthetic sample. Final native, Electron
transcript/import and shell checks passed. See [0.4.5 evidence and review](review-0.4.5.md)
for paths and scope; speech-stack integration remains deferred.

## Transcript layout and Marker cue — 0.4.6 (VC-88)

The floating native/document title identifies Transcription. Recording, Transcribe
and settings share one row; selectors precede related actions and override inherited
Field margins locally to align their bottoms. Model/provenance and instructions are
available in expandable Help. There is no reserved blank space before phrases.
Existing reading-state storage, keyboard guards and editorial commands are unchanged.

Marker is the recommended spoken word, mapped to the existing `mark` cue kind.
Guarded legacy Mark remains supported, so cue IDs, accepted/rejected decisions,
rerun matching and Undo need no migration. Both are uncertain microphone-only
candidates requiring review. Ordinary grammar and game dialogue remain excluded.
This reduces a naming ambiguity but does not prove acoustic recognition accuracy.
The consolidated [0.4.6 review](review-0.4.6.md) separates new UI/speech checks from
previous passes and the remaining M3 production work.

## References

- [Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- [faster-whisper implementation](https://github.com/SYSTRAN/faster-whisper/blob/master/faster_whisper/transcribe.py)

The review guide and evidence reports distinguish real recognition runs, synthetic behavior tests, and checks requiring Connor's review.
