# Review planning and diagnostics — 0.3.9

## Review decisions (VC-11)

Acceptance records a native SHA-256 signature of the reviewed clip name, range, destination, note, source identity/availability, audio roles, recording context and markers. Editing any of those removes the affected clip from Queue. Playback position, listening mode, prepared previews and hold-reason wording are not export-content changes. Undo can restore acceptance only with the exact reviewed content. Held work remains in Remaining, and Done is reserved for verified filing. Batch filing is still separate M2 work.

Older accepted clips have no revision signature and return to Remaining once. Their edits are retained. Current acceptance and hold reasons persist across reopening. Destination checks run natively before acceptance, including duplicate targets across batches; changing a target later requires another check before future filing.

## Destinations (VC-14)

Review's Destination action browses immediate child folders under the configured project destination, searches the visible children and allows a planned child folder. Select several review cards to assign them together. The full intended folder path is visible. Check destinations lists every proposed filename, following the source container, and lets you jump to the corresponding review card even in another batch.

Checks reject invalid/reserved Windows names, paths outside the project root, directory links/junctions, unavailable sources/destinations, duplicate case-insensitive targets, source-equals-target and existing output/companion files. Resolve a conflict by renaming the clip or assigning a different folder, then check again. Existing files are never overwritten by planning. No directory or media file is created, moved or removed by these controls.

This is a point-in-time check. The future filing executor must check again at execution and publish without overwriting newly occupied targets. Done/filing execution is not implemented by this update.

## Diagnostics (VC-19)

Diagnostics in the bottom bar provides Copy diagnostics, Open logs and Save diagnostic report. It displays local log availability and omitted-event count. The report includes recent events and tool/app versions; nothing is uploaded automatically.

Native logging records operation/job start, success and failure, source changes/reloads, playback/scan transitions, media errors and process termination. Session, operation, source and job IDs correlate events. Routine successful autosaves and per-frame/seek/audio corrections are not logged. Job-specific full failure messages remain in Jobs; support logs exclude raw messages, filenames, paths, notes, transcripts, command arguments and media.

Logs remain in the normal app profile's `diagnostics` directory. Production limits are five 1 MiB files, a 256-event pending queue and at most 60 events per second. Writes are asynchronous and batched; disk failures use a bounded recent-event memory buffer and do not block editing. Reports revalidate persisted records and ignore malformed/torn lines. Normal exit attempts a bounded flush; abrupt termination can lose the last buffered events. Export reports contain at most 400 recent records. Saving a report requires a new filename.

The broader crash/disk-exhaustion and production-batch gates remain in VC-51; the focused suite verifies storage failure handling rather than filling a real drive. Long high-speed overhead and real-machine review remain explicit review tasks.

## Verification and M2 test intake

`npm run test:review-planning` builds the app, exercises native persistence/path/log boundaries, and runs the actual Electron workflow with disposable source media and a disposable profile. It checks exact acceptance, undo/redo, reopen, holds, stale edits, collisions, original-file preservation, no folder creation, bounded logs, malformed records, unavailable log storage, report redaction/export, cross-batch review navigation and wide/compact keyboard access.

The project, feedback, export and shell suites remain separate regression checks. The new suite is not a code-coverage measurement. VC-49 tracks a unified fast/native/packaged runner; VC-50 tracks a trustworthy source-mapped renderer/native coverage baseline, including untouched files; VC-51 tracks M2 failure/recovery gates. No coverage percentage is claimed yet.

Connor accepted M232/M233 (VC-45/46). The filmstrip cache retains fixed caps and its accepted zoom-reuse behavior. VC-52 tracks a prolonged total-process/GPU memory measurement; explicit image-cache limits alone do not measure Chromium's full memory footprint. Reduce retained zoom levels if that measurement shows meaningful pressure.

### Verified build evidence

Build/type checking, lint and diff checks passed. Evidence is under `G:\GPT\Work\virtual-cut`:

- Focused native review/path/log checks: `review-planning\native-mCYw6U`.
- Packaged review/diagnostics, cross-batch navigation, compact keyboard access and inspected screenshots: `review-planning\ui-WHMfn2`.
- Packaged shell/preload/navigation: `review-planning\shell-039` (before the final tool-version format fix); the final package also passed the full new UI workflow and real export.
- Project persistence/undo/recovery: `milestone-1\native-7gnlgX`, `milestone-1\ui-N3EGtr`; timing fixture `milestone-1\timing-AYrjzU`.
- Feedback and removal regressions: `m1-feedback\native-BP7bJs`, `m1-feedback\ui-ZqPcdp`, `m2-followup\removal-WHLGxv`.
- Export packet/timing and source preservation: `m2\native-nLbQKO`, `m2-feedback\native-X5EmpL`. Development export UI: `m2\ui-hd1zGt`; final packaged export UI: `m2\ui-usaDId`.

Packaged checks used Windows-only PATH; bundled FFmpeg/FFprobe reported `N-118616-g3e9777dc75-20250304`. Test sources and profiles were disposable. Final package: `review-planning\builds\Virtual-Cut-0.3.9-win-x64-2026-10-01T02-07-23-413Z\Virtual Cut.exe`.
