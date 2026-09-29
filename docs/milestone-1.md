# Milestone 1 — durable project workspace

Implemented September 29, 2026 for user testing; the feedback pass is version 0.2.1. Notion tickets VC-2, VC-3, VC-6, VC-7, VC-8, VC-9, and VC-10 define acceptance. Automated checks do not replace the user-testing gate.

## Storage and identity

- A user-selected `.vcut` SQLite file owns one project. The native process owns all database and file access. The app profile stores only recent-project references and preferences. Disposable media caches are separate and configurable; development/test caches belong on G:.
- Project, batch, source, clip, user-created marker, note, and job identities are UUIDs. Imported chapter IDs derive from their source UUID and intake chapter index. A source is referenced in place. Import never moves, remuxes, or modifies originals. Repeated imports of the same path and sampled content fingerprint reuse identity; changed footage creates a new source. Batches refer to sources explicitly.
- Sample mode retains its existing local preview state. It is never silently converted into a real project or mixed into a new project.
- SQLite transactions save edits and their undo records together. Concurrent edits are checked against their previous values. Worker results must not overwrite unsaved renderer edits. A project lock prevents two app instances from writing the same project.
- The schema and undo journal use version 1. Each edit is a validated before/after change set, with a monotonically increasing project revision; 100 undo entries are retained. Playback position and selected recording are separate from editorial history. A new edit clears the redo branch. Clip name/range/folder/note or marker changes invalidate accepted review. M2 export receipts must retain the project revision and exact clip/marker inputs they verified, and reject changed inputs. Source retirement must preserve the source record and annotation identities.
- Schema version and application identity are checked before opening a project for writes. Unknown future versions are refused, not migrated speculatively. Version 0.2.1 adds five verified SQLite autosave copies and five manual checkpoints beside the project, with in-app restoration and a protective checkpoint before restore. Full migration and corrupt-project recovery remain M2.

## Time and annotations

- Editorial times are source-relative seconds, quantized to integer microseconds on save. Media stream timebases and original start timestamps are retained separately. No conversion uses rounded UI labels. Frame and keyframe navigation uses inspected presentation timestamps where available.
- Clip intervals are `[start, end)`. Overlap is allowed; a source marker can belong to multiple clips. Chapter starts become point markers, never implicit clips.
- Original chapter timestamps/names are retained as intake facts. A chapter outside the video span is excluded from the editable timeline instead of being shifted to zero. Positive source offsets map explicitly between the player's clock and source-relative edit time. Unsupported timestamp layouts produce an error and disable playback-based cutting.
- Requested edits remain separate from eventual verified export boundaries. Exports and physical filing are M2; M1 must not mark simulated filing as completed work in a real project.
- Original names, marker intake values, user notes, and revisions remain available. Meaningful edits invalidate prior review. Playback position is saved without adding undo entries.

## Native media jobs

- Persist inspection and audio-preview jobs; run FFprobe/FFmpeg as bounded child processes with hidden windows and argument arrays. Queued, running, cancelled, failed, interrupted, and completed states are explicit. After interruption, retry only from known inputs; never mistake partial cache output for completion.
- The project retains stream metadata, chapters, keyframes, audio roles, and source identity checks. Missing or changed media is surfaced and relinked through a native picker.
- Preview audio roles are explicit. Game, Mic, and Combined listening uses derived audio caches when the browser cannot select native tracks. These caches are disposable preview assets, not exported clips or an archival mic copy.
- No transcription model or agent is started in this milestone. No proxy video is generated.

## Verification gates

Use disposable profiles and test media on G:. Verify project isolation/reopen, edit undo/redo, source preservation, repeated intake, missing/relinked media, worker cancel/retry, chapter point intake, audio-role persistence, keyboard focus, and compact/fullscreen layouts. Run build, lint, shell smoke, and focused project tests. Deliver a packaged app for Connor's User testing; do not mark the user-testing gate complete without that review.

## Test recipe

1. Open Projects, create a project, and choose a `.vcut` file, finished-clip destination, and preview cache. Nothing is imported merely by choosing the destination.
2. Import completed recordings into First batch; create another named batch and switch between them. Jobs reports inspection, audio preparation, errors, cancellation, and retry. Same-path repeated intake reuses the source.
3. Select a clip, set Q/W, split with S, rename it, and edit a marker or its note. Try overlap lanes and both selection modes. Undo/Redo should restore edits without stepping through seeks.
4. Confirm the batch import’s game/microphone audio track numbers. Both assigned tracks prepare automatically; recordings with a missing track are flagged. Audition Game/Mic/Combined beside playback and try Off/Overlay/Replace waveforms. Expand Source & audio setup for individual overrides.
5. Close the app, reopen the project from Recents, and verify clips, markers, intent, scratch notes, audio roles, active batch, selected recording, and source position. Moving a disposable source copy should offer Relink original without changing its identities.
6. Make a manual Save / Ctrl+S checkpoint, change a clip name, then restore the checkpoint in Save history. Try R to rename a selected clip or marker, Backspace followed by Enter/Escape, and Ctrl+Up/Down navigation. With selection-follow enabled, leave a clip into a gap and extend it using W.

## Verification and limits

- The packaged Windows 0.2.0 build passed project creation/intake, Cut editing, audio audition, project isolation, restart, and immediate-close save checks with the system PATH restricted to Windows directories, verifying its bundled media tools. Build/type checks, lint, the existing shell/workflow regression checks, and media access tests also passed.
- `npm run test:project` covers native storage, invalid edit rollback, conflicts, duplicate intake, source preservation, missing/relinked files, cancel/retry/interruption, real UI editing, project isolation/restart, audio monitoring, and timestamp-offset fixtures. All media and profiles are disposable.
- `npm run test:long` measures a separate 475.13-second 3840 × 2160 AV1 / two-FLAC-stream OBS copy. In the 0.2.1 September 29 run, inspection plus game audio preparation took 12.12 seconds. Three seeks completed in 115 ms / 1000 ms / 1000 ms observation intervals. Five seconds of playback advanced 5.11 seconds / 307 frames, with zero dropped frames and maximum measured preview-audio clock difference of 52 ms. These are local short-run measurements, not an hour-long or all-codec guarantee.
- The synthetic H.264 / AAC offset test maps a +4-second Matroska video start correctly, including source-relative marker placement. A shifted MP4 whose browser duration contradicts its stream timestamps is explicitly blocked from playback-based cutting. VFR packet spacing is retained and used for frame stepping.
- FFmpeg/FFprobe run locally, one job at a time. Preview audio is AAC at 192 kbps; original streams are untouched. Reverse is silent seek-based scanning. No video proxies or recognition model are created.
- Cache availability is required to open a project. Relinking uses size and sampled SHA-256 content checks; this is not a full-file archival integrity check. Missing/changed source status is refreshed while the workspace is open.
- Inspection indexes up to two million frame timestamps. Larger recordings report an explicit limit. Hour-long performance, arbitrary timestamp layouts, full migration/corrupt-project recovery, and physical export/filing are not claimed by this milestone.

## M1 feedback pass — version 0.2.1

- Save / Ctrl+S creates a separate manual checkpoint; Save history restores actual SQLite copies. Five autosaves and five manual checkpoints rotate independently. Each copy is integrity-checked before publication. Restore validates project identity and schema, pauses native jobs, saves current work first, and clears stale undo entries. Cache media and sources remain separate.
- Imports ask about microphone notes and use one-based audio stream order for batch defaults, with per-recording overrides and an explicit missing-track warning. Source inspection and role changes prepare assigned tracks automatically. Cancel/retry remains available in Jobs.
- Audio jobs create bounded 2048-bin real waveform peaks while preparing AAC listening copies; temporary mono PCM is deleted. Renderer waveforms respect source-relative stream offsets and the Listen selection. Combined shows separate labelled Game/Mic lanes. Pooling preserves peaks at small display widths; each track is scaled for visibility without altering listening volume.
- Entire clip cards select; R focuses and selects a clip/marker name. Backspace opens inline confirmation, Enter confirms, Escape cancels; typing fields retain their normal keyboard behavior. New markers select automatically; direct marker clicks take priority over selection-follow. Following retains the previous clip through gaps and reveals cards only when needed.
- Undo uses the existing video element and stable native URL grants. Changing sources holds the last decoded frame while loading the new one, without a thumbnail poster. Deletion undo preserves collection ordering. Volume defaults to 100%; accepted Review buttons show green.
- `npm run test:feedback` exercises save rotation/restoration, batch defaults, mismatched tracks, auto audio preparation, distinct real track waveforms, marker priority, keyboard guards, gap trimming, undo without media reload, source transitions and compact layouts. Existing project, timing, shell, workflow, media and long-source checks remain regression gates.
- Connor reports no noticeable audio drift. Deferred Notion ticket VC-34 measures long-session preview synchronization only if needed. M2 VC-13 requires copying original stream timing, shifting A/V timestamps together when rebasing, and verifying output/source packet timing and a sync fixture; preview AAC and clock correction must never feed final exports. This pass does not claim final exports are implemented.

## Version 0.2.1 packaged handoff

- Build: `G:\GPT\Work\virtual-cut\m1-feedback\builds\Virtual-Cut-0.2.1-win-x64-2026-09-29T23-37-44-340Z\Virtual Cut.exe`. Close the older app window before opening this portable copy. Keep the folder's files together.
- Build/type checks, lint, media access tests, native project checks, shell/workflow checks, timestamp-offset checks, long-source playback and new feedback regressions passed. The final packaged project and feedback UI checks ran with only Windows directories on PATH, confirming the included FFmpeg/FFprobe.
- Evidence: packaged project `G:\GPT\Work\virtual-cut\milestone-1\ui-sNC4sg`; packaged feedback `G:\GPT\Work\virtual-cut\m1-feedback\ui-k31c7e`; native feedback `G:\GPT\Work\virtual-cut\m1-feedback\native-WySADH`; native project `G:\GPT\Work\virtual-cut\milestone-1\native-dJFX0t`; timing `G:\GPT\Work\virtual-cut\milestone-1\timing-M6pXIK`; long-source `G:\GPT\Work\virtual-cut\milestone-1\long-YoDFpD`.
- Tests used isolated app profiles and disposable source copies on G:. No original I: footage or user project data was changed. Connor's hands-on acceptance remains open. Exports/physical filing are M2; transcription and agent integration remain later milestones.
