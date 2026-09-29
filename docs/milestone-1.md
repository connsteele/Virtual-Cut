# Milestone 1 — durable project workspace

Implemented September 29, 2026 for user testing in version 0.2.0. Notion tickets VC-2, VC-3, VC-6, VC-7, VC-8, VC-9, and VC-10 define acceptance. Automated checks do not replace the user-testing gate.

## Storage and identity

- A user-selected `.vcut` SQLite file owns one project. The native process owns all database and file access. The app profile stores only recent-project references and preferences. Disposable media caches are separate and configurable; development/test caches belong on G:.
- Project, batch, source, clip, user-created marker, note, and job identities are UUIDs. Imported chapter IDs derive from their source UUID and intake chapter index. A source is referenced in place. Import never moves, remuxes, or modifies originals. Repeated imports of the same path and sampled content fingerprint reuse identity; changed footage creates a new source. Batches refer to sources explicitly.
- Sample mode retains its existing local preview state. It is never silently converted into a real project or mixed into a new project.
- SQLite transactions save edits and their undo records together. Concurrent edits are checked against their previous values. Worker results must not overwrite unsaved renderer edits. A project lock prevents two app instances from writing the same project.
- The schema and undo journal use version 1. Each edit is a validated before/after change set, with a monotonically increasing project revision; 100 undo entries are retained. Playback position and selected recording are separate from editorial history. A new edit clears the redo branch. Clip name/range/folder/note or marker changes invalidate accepted review. M2 export receipts must retain the project revision and exact clip/marker inputs they verified, and reject changed inputs. Source retirement must preserve the source record and annotation identities.
- Schema version and application identity are checked before opening a project for writes. Unknown future versions are refused, not migrated speculatively. Full migration/backup recovery is a separate M2 ticket.

## Time and annotations

- Editorial times are source-relative seconds, quantized to integer microseconds on save. Media stream timebases and original start timestamps are retained separately. No conversion uses rounded UI labels. Frame and keyframe navigation uses inspected presentation timestamps where available.
- Clip intervals are `[start, end)`. Overlap is allowed; a source marker can belong to multiple clips. Chapter starts become point markers, never implicit clips.
- Original chapter timestamps/names are retained as intake facts. A chapter outside the video span is excluded from the editable timeline instead of being shifted to zero. Positive source offsets map explicitly between the player's clock and source-relative edit time. Unsupported timestamp layouts produce an error and disable playback-based cutting.
- Requested edits remain separate from eventual verified export boundaries. Exports and physical filing are M2; M1 must not mark simulated filing as completed work in a real project.
- Original names, marker intake values, user notes, and revisions remain available. Meaningful edits invalidate prior review. Playback position is saved without adding undo entries.

## Native media jobs

- Persist inspection and audio-preview jobs; run FFprobe/FFmpeg as bounded child processes with hidden windows and argument arrays. Queued, running, cancelled, failed, interrupted, and completed states are explicit. After interruption, retry only from known inputs; never mistake partial cache output for completion.
- The project retains stream metadata, chapters, keyframes, audio roles, and source identity checks. Missing or changed media is surfaced and relinked through a native picker.
- Preview audio roles are explicit. Game, Mic, and Both audition uses derived audio caches when the browser cannot select native tracks. These caches are disposable preview assets, not exported clips or an archival mic copy.
- No transcription model or agent is started in this milestone. No proxy video is generated.

## Verification gates

Use disposable profiles and test media on G:. Verify project isolation/reopen, edit undo/redo, source preservation, repeated intake, missing/relinked media, worker cancel/retry, chapter point intake, audio-role persistence, keyboard focus, and compact/fullscreen layouts. Run build, lint, shell smoke, and focused project tests. Deliver a packaged app for Connor's User testing; do not mark the user-testing gate complete without that review.

## Test recipe

1. Open Projects, create a project, and choose a `.vcut` file, finished-clip destination, and preview cache. Nothing is imported merely by choosing the destination.
2. Import completed recordings into First batch; create another named batch and switch between them. Jobs reports inspection, audio preparation, errors, cancellation, and retry. Same-path repeated intake reuses the source.
3. Select a clip, set Q/W, split with S, rename it, and edit a marker or its note. Try overlap lanes and both selection modes. Undo/Redo should restore edits without stepping through seeks.
4. Expand Source & audio, check Game/Mic assignments, prepare selected audio, and audition Game/Mic/Both. The first stream defaults to Game; verify your OBS track setup.
5. Close the app, reopen the project from Recents, and verify clips, markers, intent, scratch notes, audio roles, active batch, selected recording, and source position. Moving a disposable source copy should offer Relink original without changing its identities.

## Verification and limits

- The packaged Windows 0.2.0 build passed project creation/intake, Cut editing, audio audition, project isolation, restart, and immediate-close save checks with the system PATH restricted to Windows directories, verifying its bundled media tools. Build/type checks, lint, the existing shell/workflow regression checks, and media access tests also passed.
- `npm run test:project` covers native storage, invalid edit rollback, conflicts, duplicate intake, source preservation, missing/relinked files, cancel/retry/interruption, real UI editing, project isolation/restart, audio monitoring, and timestamp-offset fixtures. All media and profiles are disposable.
- `npm run test:long` measures a separate 475.13-second 3840 × 2160 AV1 / two-FLAC-stream OBS copy. In the September 29 run, inspection plus game audio preparation took 12.3 seconds. Three seeks each completed within the one-second observation interval. Five seconds of playback advanced 5.09 seconds / 305 frames, with zero dropped frames and maximum measured preview-audio clock drift of 53 ms. These are local short-run measurements, not an hour-long or all-codec guarantee.
- The synthetic H.264 / AAC offset test maps a +4-second Matroska video start correctly, including source-relative marker placement. A shifted MP4 whose browser duration contradicts its stream timestamps is explicitly blocked from playback-based cutting. VFR packet spacing is retained and used for frame stepping.
- FFmpeg/FFprobe run locally, one job at a time. Preview audio is AAC at 192 kbps; original streams are untouched. Reverse is silent seek-based scanning. No video proxies or recognition model are created.
- Cache availability is required to open a project. Relinking uses size and sampled SHA-256 content checks; this is not a full-file archival integrity check. Missing/changed source status is refreshed while the workspace is open.
- Inspection indexes up to two million frame timestamps. Larger recordings report an explicit limit. Hour-long performance, arbitrary timestamp layouts, backup/migration recovery, and physical export/filing are not claimed by this milestone.
