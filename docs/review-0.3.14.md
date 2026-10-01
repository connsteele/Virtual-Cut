# Playback recovery and M2 review follow-up — 0.3.14

## Reported playback failure

Connor reported `PIPELINE_ERROR_READ: FFmpegDemuxer: demuxer seek failed` after deleting all clips from a recording and trying to play. The existing local diagnostic session confirms a media error at source position 1.431 seconds, followed by a reload and successful playback. It did not capture the preceding seeks, clip-count transitions or native read outcomes. This is evidence of a failed read/seek in the media pipeline; it does not establish that deleting clips caused it or that the source is damaged. Clip deletion changes project records only.

The expandable browser error detail predates the persisted diagnostic system. Version 0.3.13's session log captured this failure but omitted raw messages by design. Its diagnostic files were small and subject to the existing retention cap.

## Recovery and diagnostics

- A failed preview now dims the viewer and places a large **Reload preview** button in its center. The viewer keeps its size. Details remain expandable, transport is disabled until recovery, and reloading restores the same position paused at 1×.
- Each preview keeps the latest 24 seek, transport, loading and clip-count events in memory. Pointer bursts coalesce. Failures and reloads attach this history, a preview identifier, classified fault, duration, offset, clip count and media readiness. It is not a per-frame disk trace.
- Native reads count requests, cancellations and failures and expose the most recent byte range/status. Changed files, invalid ranges, open failures and unexpected stream failures record a bounded diagnostic event. Normal seek cancellations do not become read-error reports.
- A successfully loaded frame after reload records `preview-recovered`. **Diagnostics → Copy diagnostics** includes the session context. Raw paths, media URLs, annotation text and arbitrary error messages remain excluded from persistent reports. Local error details retain the browser message.
- Existing limits remain five approximately 1 MB log files, a bounded write queue and event-rate limiting. Logs stay outside project saves; there is no automatic upload.

The original demuxer failure has not been reproduced. VC-41 remains open for diagnosis. The delete-all-clips regression uses generated media; a separate injected media error verifies recovery and logging without pretending to reproduce the underlying failure.

## Review and Library refinements

- Review offers clip-name/folder-name sorting alongside Tree, clickable destination group headers, and a distinct **Done** state. Folder grouping is retained; clip-name mode orders groups by their first matching clip. Explorer opens the nearest existing parent for a planned folder without creating it.
- **File queue** sits beside Exports. A persistent filing indicator opens the progress view across pages; Plan and Progress tabs let users return to active work and its red **Cancel remaining filing** action. Plan headings separate clip/destination and requested/outward cuts with explicit In/Out labels. An outward cut remains a planned range until verification.
- Library handles J/K/L immediately after selecting a card. Player keyboard events no longer bubble into a second workspace command. A missing completed output has a centered relink action, and the picker starts at the finished-video root. Verified relinks update folder labels/filters to the current output location while retaining original filing provenance.

Library filmstrip/keyframe/audio controls (VC-55), automatic matching within the destination root (VC-56), and a clearer Resolve Handoff area/helper lifecycle (VC-57) are separate follow-ups. M249 remains open. M250's source-position check passed; dates and real-batch playback acceptance are separate checks instead of being inferred from its checkbox.

## Verification

Build/type checks, lint and all seven selected native/Electron scripts passed against the packaged build. They cover ordinary/failed media reads, diagnostic retention and sanitization, delete-all playback, one-command keyboard handling, centered recovery at wide/compact sizes, same-position reload, filing progress reopening, destination reveal, Library shortcuts and relinked folder persistence. Wide/compact screenshots were inspected. These complement the prior M2 tests; they do not close remaining real-footage audio, date or Resolve acceptance.

Packaged report: `G:\GPT\Work\virtual-cut\review-0.3.14\packaged-reports\run-O8FwNU\report.json`. A final relink-error visibility fix also passed native filing and Electron checks, including wrong-file rejection, picker start folder and successful matching-pair recovery: `final-reports\run-trqtf2\report.json` beneath the same task directory. Read errors retain the grant's original project ID even if another project opens before an old stream finishes.

Final build: `G:\GPT\Work\virtual-cut\review-0.3.14\builds\Virtual-Cut-0.3.14-win-x64-2026-10-01T18-19-18-997Z\Virtual Cut.exe`. The current Notion guide adds M251–M255 focused review and separates dates/audio into M256/M257, preserving all 71 previously checked items and 35 callouts. M243–M245 acceptance closes VC-5; it does not close the playback-read investigation.
