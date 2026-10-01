# Review planning and diagnostics — 0.3.10

## M235/M236 follow-up

The project destination is the root for finished videos; Review assigns subfolders beneath it. Review's tree has selectable folder rows and a separate expansion arrow. Selecting a parent includes its descendants. Drag its separator or use Left/Right to resize; double-click restores the default width. Review details have a Source link that opens the original recording and selected clip in Cut. Destination selection can open Windows Explorer; a planned child opens its nearest existing parent without creating anything.

Destination conflicts automatically show Held and a reason on every affected review card, count in Held, and disable acceptance. Unsaved filename duplicates are checked immediately across all batches. Native path/source/existing-file checks follow settled saves; changed targets remain held while checking. Existing files are refreshed within roughly three seconds while the workspace is open and checked afresh before acceptance. The overview button is now Destination plan. Fixing an automatic issue releases only that issue; manual holds remain. Changing a peer's target into a collision invalidates prior acceptance. An unchanged accepted clip temporarily blocked by an external filesystem issue can return to Queue once that issue clears. No file operation is authorized by this derived state alone; VC-22 must check again before writing.

Automatic destination state lives outside editorial history. Rechecking it creates no playhead saves or undo entries. Diagnostic logs record changes in destination-hold count with the project ID, without filenames or notes.

## Manipulate mode

H on Cut toggles Manipulate. Clip edges retain trim handles; point markers become circles with a horizontal drag cursor. Dragging previews a frame-snapped time, commits once on release and preserves the marker's name, note and color. Escape, pointer cancellation, leaving the source or disabling the mode cancel the move. A focused marker supports Left/Right for one frame and Shift+Left/Right for approximately one second. Edits invalidate acceptance for clips on that recording. Gesture previews suppress autosaving until released. Existing range-marker work remains separate.

## Review decisions (VC-11)

Acceptance records a native SHA-256 signature of the reviewed clip name, range, destination, note, source identity/availability, audio roles, recording context and markers. Editing any of those removes the affected clip from Queue. Playback position, listening mode, prepared previews and hold-reason wording are not export-content changes. Undo can restore acceptance only with the exact reviewed content. Held work remains in Remaining, and Done is reserved for verified filing. Batch filing is still separate M2 work.

Older accepted clips have no revision signature and return to Remaining once. Their edits are retained. Current acceptance and hold reasons persist across reopening. Destination checks run natively before acceptance, including duplicate targets across batches; changing a target later requires another check before future filing.

## Destinations (VC-14)

Review's Destination action browses immediate child folders under the configured project destination, searches the visible children and allows a planned child folder. Select several review cards to assign them together. The full intended folder path is visible. Destination plan lists every proposed filename, following the source container, and lets you jump to the corresponding review card even in another batch.

Checks reject invalid/reserved Windows names, paths outside the project root, directory links/junctions, unavailable sources/destinations, duplicate case-insensitive targets, source-equals-target and existing output/companion files. Resolve a conflict by renaming the clip or assigning a different folder; its automatic hold updates. Existing files are never overwritten by planning. No directory or media file is created, moved or removed by these controls.

This is a point-in-time check. The future filing executor must check again at execution and publish without overwriting newly occupied targets. Done/filing execution is not implemented by this update.

## Diagnostics (VC-19)

Diagnostics in the bottom bar provides Copy diagnostics, Open logs and Save diagnostic report. It displays local log availability and omitted-event count. The report includes recent events and tool/app versions; nothing is uploaded automatically.

Native logging records operation/job start, success and failure, source changes/reloads, playback/scan transitions, media errors and process termination. Session, operation, source and job IDs correlate events. Routine successful autosaves and per-frame/seek/audio corrections are not logged. Job-specific full failure messages remain in Jobs; support logs exclude raw messages, filenames, paths, notes, transcripts, command arguments and media.

Logs remain in the normal app profile's `diagnostics` directory. Production limits are five 1 MiB files, a 256-event pending queue and at most 60 events per second. Writes are asynchronous and batched; disk failures use a bounded recent-event memory buffer and do not block editing. Reports revalidate persisted records and ignore malformed/torn lines. Normal exit attempts a bounded flush; abrupt termination can lose the last buffered events. Export reports contain at most 400 recent records. Saving a report requires a new filename.

The broader crash/disk-exhaustion and production-batch gates remain in VC-51; the focused suite verifies storage failure handling rather than filling a real drive. Long high-speed overhead and real-machine review remain explicit review tasks.

## Verification and M2 test intake

`npm run test:review-planning` builds the app, exercises native persistence/path/log boundaries, and runs the actual Electron workflow with disposable source media and a disposable profile. It checks exact acceptance, undo/redo, reopen, holds, stale edits, collisions, original-file preservation, no folder creation, bounded logs, malformed records, unavailable log storage, report redaction/export, cross-batch review navigation and wide/compact keyboard access.

VC-49 now has a [unified fast/native/desktop/packaged runner](testing.md), a maintained inventory and Windows CI configuration. VC-50 tracks a trustworthy source-mapped renderer/native coverage baseline, including untouched files; VC-51 tracks M2 failure/recovery gates. No coverage percentage is claimed yet.

Connor accepted M232/M233 (VC-45/46). The filmstrip cache retains fixed caps and its accepted zoom-reuse behavior. VC-52 tracks a prolonged total-process/GPU memory measurement; explicit image-cache limits alone do not measure Chromium's full memory footprint. Reduce retained zoom levels if that measurement shows meaningful pressure.

### 0.3.10 verification

Final build/type checks, lint and diff checks passed. All 25 maintained test scripts passed across the broad desktop run and focused packaged follow-up. The first desktop report (`run-c5ewb0`) correctly failed the filmstrip native gate because its old default depended on a missing local gameplay copy, and skipped its two dependent UI checks. The fixture now defaults to generated footage; native and both UI checks passed on the final package. That original failed report is retained rather than relabelled.

The final packaged run (`run-IDj0ZF`) passed shell/preload/security/navigation, actual export with bundled tools, filmstrip accuracy and reuse, and Review/diagnostics/marker interactions with fresh native fixtures. New checks include marker drag/one-step undo/redo/cancel/frame nudge, no intermediate persistence, folder resizing/parent filtering/Source navigation, automatic duplicate holds and exact peer-acceptance undo/redo. Wide and compact screenshots were inspected; interaction suites reported no renderer errors. A missing packaged executable was explicitly checked: incomplete report, skipped UI check, exit code 2.

Reports, bounded logs and UI screenshots are retained at `G:\GPT\Work\virtual-cut\review-planning\release-0.3.10`, outside the test runner's five-run disposable retention. Package: `G:\GPT\Work\virtual-cut\review-planning\builds\Virtual-Cut-0.3.10-win-x64-2026-10-01T03-55-34-204Z\Virtual Cut.exe`.

Windows CI is configured but has not run on the hosted service. No source-coverage percentage is claimed (VC-50). Prolonged real 4K playback, Resolve metadata and production fault/recovery gates retain their existing manual/board checks; synthetic success does not replace them.

### Historical 0.3.9 verified build evidence

Build/type checking, lint and diff checks passed. Evidence is under `G:\GPT\Work\virtual-cut`:

- Focused native review/path/log checks: `review-planning\native-mCYw6U`.
- Packaged review/diagnostics, cross-batch navigation, compact keyboard access and inspected screenshots: `review-planning\ui-WHMfn2`.
- Packaged shell/preload/navigation: `review-planning\shell-039` (before the final tool-version format fix); the final package also passed the full new UI workflow and real export.
- Project persistence/undo/recovery: `milestone-1\native-7gnlgX`, `milestone-1\ui-N3EGtr`; timing fixture `milestone-1\timing-AYrjzU`.
- Feedback and removal regressions: `m1-feedback\native-BP7bJs`, `m1-feedback\ui-ZqPcdp`, `m2-followup\removal-WHLGxv`.
- Export packet/timing and source preservation: `m2\native-nLbQKO`, `m2-feedback\native-X5EmpL`. Development export UI: `m2\ui-hd1zGt`; final packaged export UI: `m2\ui-usaDId`.

Packaged checks used Windows-only PATH; bundled FFmpeg/FFprobe reported `N-118616-g3e9777dc75-20250304`. Test sources and profiles were disposable. Final package: `review-planning\builds\Virtual-Cut-0.3.9-win-x64-2026-10-01T02-07-23-413Z\Virtual Cut.exe`.
