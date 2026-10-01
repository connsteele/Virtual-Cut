# Review iteration 0.3.17

## Delivered

- VC-55: Library now prepares an output-relative keyframe index and game waveform from the verified finished video. The original may be offline. Thumbnails use the bounded memory filmstrip worker and zoom controls. Playback uses embedded audio; no unavailable Mic selector is presented. Silent/no-audio files, cancellation and source switches are covered. Preparation remains asynchronous and may take time on long files; there is no image sequence or PCM file on disk and no preview data in saves.
- VC-58/59: Clip date, Group Folder Clips, Split Groups by Sort and Original destination labels. Date controls and displayed clip dates explain source Date modified plus requested In.
- VC-57: Handoff is a full workspace page at the right of the bottom navigation. Exports routes to it. Existing helper install/update/location/protected-removal behavior is retained.
- VC-67: Selected marker cards scroll back into view when retiming changes chronological order. Text-field editing is protected from scroll interference.
- VC-68: New version 3 companions explicitly identify generated leading chapters. The helper can remove an unchanged generated Clip start at frame zero, while retaining actual markers, user edits and ambiguous/legacy cases. Failed application rolls back the removal along with other changes.

## Clip start limitation

MP4/MOV chapter tracks need a leading chapter to retain the delayed first marker's position. A generated experiment with a marker at 1 second, without an anchor, was read back at zero by FFprobe. Consequently the placeholder still appears during ordinary import, before the helper runs. New exports plus the updated helper provide cleanup; older companions are deliberately preserved and need a fresh export for this behavior. MKV has no generated anchor. A first real marker sharing frame zero remains conflict-protected. Direct-import behavior and live Resolve acceptance remain open under VC-68/M268.

## Manual review additions

### M264 — Library filmstrip and game waveforms

Preview finished clips in Library. Try Off, Overlay and Replace filmstrip; zoom/reset; seek a marker; switch clips and pages; use J/K/L immediately after selection. Try a small window and an offline-original test pair. Expect output-relative pictures, keyframe ticks and the exported game waveform, stable keyboard behavior and visible controls. Silent/no-audio cases are covered automatically, and are useful to try when available.

### M265 — Review wording

Try Clip date oldest/newest, both grouping modes, date hover text and Original destination on Done. Labels should be clear; date and grouping behavior should match the previously accepted behavior.

### M266 — Handoff workspace page

Open Handoff from bottom navigation and Exports. Check selected-page highlighting, compact scrolling, helper status/update/location and optional Keep helper/removal/reinstall. Installation changes no Resolve project.

### M267 — Marker inspector tracking

Use H/Manipulate to drag a selected marker earlier/later across enough markers to move its card offscreen. On release, the selected chronological card should be visible. Try Undo/Redo and typing in its name/note; fields should keep focus.

### M268 — Generated chapter cleanup in Resolve

Update the helper from Handoff. Use fresh disposable MP4 and MKV exports: delayed first marker, marker at zero, no markers, genuine marker named Clip start, multiline notes/colors. Inspect ordinary import separately, then Check/Apply and repeat. MP4's generated leading chapter can appear before Apply; the planned removal should remove only that unchanged placeholder. Real marker timing/notes/colors remain, repeated Apply adds nothing, and edited/older markers are preserved. Save/reopen and new-timeline inheritance still belong to M249's deeper checks.

## Verification

Build/type checks and lint pass. Native checks cover offline originals, finished-file hash/date preservation, audio peaks, silent/no-audio media, filmstrip extraction and cancellation. Export checks cover copied packet timing, version 3 companions and legacy receipt compatibility. Python checks cover generated-anchor removal, user/genuine/legacy preservation, idempotency, conflicts and rollback. Electron checks exercise Library zoom/waveforms/JKL/relink/layout, Handoff controls, marker inspector tracking, startup/preload and playback recovery. Final report paths are recorded in the Notion guide and the external verification summary.

The compact assertion now checks a usable video and that the full timeline/transport/details fit, rather than preserving the pre-filmstrip picture-height assumption. This is a focused regression pass, not the full 34-script inventory. Coverage remains unmeasured (VC-50). M2 still needs the remaining real Resolve/container checks, representative production batch, diagnostics investigation and first hosted CI run.

Evidence: `G:\GPT\Work\virtual-cut\review-0.3.17\verification-summary.json` aggregates ten passing selected scripts across corrected packaged runs. Final package: `G:\GPT\Work\virtual-cut\review-0.3.17\builds\Virtual-Cut-0.3.17-win-x64-2026-10-01T22-36-51-595Z\Virtual Cut.exe`. The final CSS alignment adjustment was separately checked in wide/compact hidden Electron; functional behavior is unchanged from the tested package.
