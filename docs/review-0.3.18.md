# Review iteration 0.3.18

## Delivered

- VC-35: Point markers optionally have an exclusive end. Shift+M or Range marker creates a named range; Make range / Make point marker converts it without replacing its identity. H/Manipulate moves the body or resizes split endpoints; Shift-drag extends a point marker. Start/End fields, source bounds, frame snapping, one-step gesture Undo and Escape cancellation are supported.
- Ranges use translucent color spans and split handles/half circles. Overlaps get independent lanes; the viewer shrinks with the timeline. Review includes ranges intersecting a clip even when their start lies before it. Completed Library uses the retained portion.
- New version 4 companions preserve original source extents and the portion inside the actual outward export. Chapters remain navigation hints. The updated explicit Resolve helper transfers durations for verified constant-frame-rate outputs and protects edited durations. Same-frame collisions and unverified VFR ranges produce conflicts. Generated MP4 anchors remain identified for safe helper cleanup.
- M267: Position snapshot refreshes no longer pull the inspector back after manual scrolling. Intentional selection/retiming still reveals its card.
- M264: Visited Library full overviews reuse memory across clip selections. Zoom details are discarded on leaving that view. Verified output indices/peaks reuse up to six outputs / 8 MiB serialized estimate; image storage stays within 192 tiles / approximately 24 MiB accounted image memory. Each selection still verifies the finished pair. Leaving Library or changing project clears thumbnail memory. No preview images or waveforms are added to disk or saves. Eager generation during filing is deferred pending representative performance measurement.

## Manual review

- **M269:** Create/edit/convert range markers, drag both endpoints and body, overlap points/ranges, zoom, compact layout, Undo/Redo, Escape and save/reopen. Test without creating clips too.
- **M270:** Scroll manually away from the selected card, then play/pause/seek. The panel should stay where placed; intentional selection/retiming still reveals its card.
- **M271:** Update the helper; export disposable MP4/MKV with internal and edge-crossing ranges. Compare Library and Resolve Check/Apply, names/notes/colors/start/duration, repeat/reopen and new timeline inheritance. Preserve conflicts/user edits. Provide paired outputs/companions for the reported small container placement difference.
- **M272:** Visit Library A/B/A at full extent; try zoom/reset and an offline original. Full overviews reuse while cached; zoom details do not remain cached for later visits. Verification/eviction/new window extent can still require work.

M264–M268 retain Connor's functional passes and original callouts. VC-57/58/59 are Done. Earlier deep checks remain open; these new manual checks are not marked passed by automation.

## MP4 anchor and frame timing

The current MP4/MOV chapter writer needs a leading chapter to preserve a delayed first real chapter. The preceding generated 1-second experiment read back at zero without an anchor. MKV needs no anchor. Connor confirmed the updated helper removes the synthetic MP4 marker. Ordinary import before Apply still exposes it.

This pass found MKV's rounded packet duration could incorrectly fail the constant-rate proof. Version 4 validates each packet timestamp against the rational nominal frame grid, as well as packet duration/gap tolerances. This supports duration conversion without treating rounded milliseconds as an exact frame duration. It does not prove the cause of Connor's specific small MP4/MKV placement difference; that remains in M271.

## Verification and limits

The focused native tests cover range validation, compact save/reopen, MP4/MKV packet verification, edge intersections, original/retained/container extents, source hashes and constant-rate evidence. Python helper tests cover duration, repeat application, edited-duration preservation, VFR conflict and invalid bounds. Desktop checks cover actual gestures, numeric editing, conversion, inspector scrolling, compact layout, Library reuse/JKL/relink and existing playback recovery/startup behavior.

Final evidence and packaged build are recorded in the Notion guide and external verification summary. The maintained inventory is 36 scripts; this is a focused regression run, not a full inventory pass. Coverage remains unmeasured under VC-50. Live Resolve range-duration acceptance remains M271; synthetic helper tests do not substitute for it. Representative batch, remaining container/hardware/recovery checks, VC-41 diagnosis and first hosted CI remain M2 gates.

Final packaged run: `G:\GPT\Work\virtual-cut\review-0.3.18\final-reports\run-0SOaij\report.json`. All twelve selected maintained scripts plus build/type checks passed. Lint and formatting of changed/new files passed; the repository-wide formatter still flags the pre-existing `scripts/filmstrip-checks.mjs`. Wide/compact range and Library screenshots were inspected. Synthetic Library preview preparation measured 277 ms initially and 1 ms on verified revisit; this is not a long-file benchmark. The real generated MP4/MKV companions also produced matching helper plans at frame/duration pairs `(0,30), (36,30), (75,45), (60,1)` at 30 fps.

Build: `G:\GPT\Work\virtual-cut\review-0.3.18\builds\Virtual-Cut-0.3.18-win-x64-2026-10-01T23-25-02-109Z\Virtual Cut.exe`. Keep its folder together. Earlier development reports are preserved, including corrected version assertions, compact input overflow and a Library test search-filter mistake.
