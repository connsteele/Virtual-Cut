# Reviewed filing and the completed Library — 0.3.13

This candidate completes the manual M2 feature path: import, cut/annotate, review destinations, accept, file, find completed clips, and explicitly enrich imported Resolve markers. Connor's representative production batch and remaining compatibility acceptance are still required.

## File accepted clips

Review's **File queue** checks accepted, current, unheld clips in the active batch. It shows final paths, requested ranges, outward keyframe cuts and blocking issues. Confirm that every selected game track is clean before starting. The source container is used; unsupported layouts fail explicitly. Existing files are never overwritten. Change a name or destination to resolve a collision.

Filing makes a manual checkpoint before queue execution. Browsing and planning create no folders; confirmed filing creates regular directories under the configured finished-video root. Native validation rechecks review signatures, source identity, root identity and directory boundaries before publication. Duplicate submissions, stale decisions and junction targets are blocked. Native job logs retain per-item failures and timings.

The existing packet-copy verification remains intact: original video and selected game audio, common A/V timestamp rebasing, exact packet payload/sequence and timing comparisons, chapter checks, and decoded start/end checks. Preview audio and playback corrections do not enter exports. Both the final video and `.vcut.json` are verified, including SHA-256, exact metadata and Date modified, before a native filing receipt becomes complete and the matching reviewed clip shows **Done**.

Receipts remain outside editorial Undo and save restoration. Later edits stop matching Done; the earlier completed output stays in Library. Finished files remain separate from originals and the preview cache.

## Cancellation and interruption

Close the panel to continue background filing. **Cancel remaining filing** cancels pending items before aborting an active writer. Jobs and Exports retain failed/cancelled/interrupted entries for explicit retry; reopening never retries automatically.

Stages are created beside the destination, so source and destination may be on different volumes without requiring a cross-volume move. Publication uses exclusive hard links and requires a supporting filesystem, normally local NTFS. A persistent verified hash allows retry to recognize its own published video and finish a missing companion. It refuses a different file or metadata. The lock is recovered only for this export identity and a dead process; retry clears only this identity's known private stage files. An interrupted item is not Done.

Completed-output recovery currently requires the original to remain available until the filing operation finishes. Completed Library playback does not. Filesystem inspection and publication are separate operations; junction checks reduce ordinary replacement risks but are not a hardened boundary against a hostile process continuously changing the filesystem.

## Library

The real-project Library lists complete native filing receipts, with search across names, folders, source relationships, clip/context notes and marker text. It filters by destination folder and seeks to retained marker positions. It previews the finished video directly, even when the source is offline. Snapshot polling performs cheap file/size/date checks; opening a preview verifies the full video hash and exact companion, so large files may take time to check.

Move a finished video and its adjacent companion together, then use **Relink…** to choose the video. A different video, missing/changed companion, changed expected date or source-file target is refused. The updated native path survives reopening. Relinking does not move files or rewrite metadata.

The sample workspace keeps its glossary/graph prototype. Transcription, agents, source deletion and direct timeline handoff remain later work.

## Resolve marker metadata

Normal video import carries chapter names/times; it does not automatically read `.vcut.json`. In **Exports**, expand **Resolve marker notes and colors** and install the bundled helper. It installs one known script under the user's Resolve Utility scripts directory. Existing unrelated/customized scripts are preserved; app-owned updates retain a previous copy. The installer does not apply annotations.

After saving work in Resolve, select the imported media-pool videos. Run **Workspace → Scripts → Utility → Virtual Cut metadata** (restart Resolve if the new menu entry is not visible). **Check selected clips** builds a read-only plan. **Apply marker metadata** rechecks the project, selection, matching video hash, companion and marker snapshot before applying names, multiline notes and named colors. It saves the project after successful application.

The helper enriches an unedited matching Blue chapter marker rather than duplicating it. It records marker ownership and detects later user changes. Conflicting existing notes/colors, timing edits, ambiguous matches and markers sharing a frame block that clip. Failed writes attempt to restore the touched marker snapshot and report any recovery failure. Constant-rate new markers use the frame containing their timestamp; variable-rate clips and older companions without uniform packet-timing evidence require existing matching chapter positions. A neutral Clip start chapter is preserved.

Clip-level notes and recording context remain in the companion and Library; this helper does not place them in a Resolve clip-note field. Point-marker duration is one frame. Range markers and transcript handoff remain separate requests. Use the helper before creating a new timeline from the imported clips; existing timeline instances are not updated by the helper.

## Evidence and remaining review

- Maintained native filing tests cover current acceptance, duplicate submission, packets, Unicode/multiline notes, dates, original hashes, Done, Undo/restore/reopen, offline originals, moved-pair relink, cancellation, post-plan collisions and a directory replaced by a junction. A separate writer is forcibly terminated after publishing only the video; explicit retry recovers the pair and its private stages while preserving an unrelated file.
- Electron checks cover Library search/marker seeking, actual accepted filing and Done, wide/compact layout, keyboard focus, and Review-to-Cut preserving the preview's source-relative playhead.
- The helper has five Python reconciliation tests covering identity, ownership, conflicts, repeat application, stale plans, rollback and variable-rate guards, plus native install preservation.
- Live Resolve Studio 21.1 on generated 60 fps footage enriched frames 33 and 74 with multiline Unicode notes and Blue/Red colors. Save/reopen retained those fields; repeat application added nothing; a newly created timeline inherited them. The actual helper window opened and its read-only repeat check reported zero changes/conflicts. The original user project, timeline, playhead and media folder were restored. The earlier user export files were unavailable, so the chapter timings were reconstructed on generated footage.
- Evidence is under `G:\GPT\Work\virtual-cut\m2-completion`: `full-reports/run-rnPnlb`, `focused-reports/run-0NL2Ts`, and `resolve-validation`. The broad run's two outdated UI expectations were corrected and passed in the focused run. Final packaged verification is recorded in `verification-summary.json` there.

Keep M243–M245 save review, M212's remaining Resolve/MKV-tail acceptance, M217 and O01–O05 deep checks. M230 stays deferred. VC-50 code coverage is still unmeasured; scenario counts are not coverage. Hosted CI and a representative real production batch remain open gates. No milestone acceptance is inferred from synthetic tests.
