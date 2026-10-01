# Chronological cards and Review follow-up — 0.3.15

## Changes

- Cut clip cards sort by source In time. Timeline numbers use the same ordering. Marker cards in Cut, Review details and completed Library sort by timestamp. Equal times retain their existing relative order. These are sorted copies: stored order, identifiers, identity colors and edit history remain intact. Clips and markers remain separate groups.
- A sticky selection bar above Review cards provides **Select visible**, a selected count, **Change destination…**, and **Clear selection**. Bulk actions use selected cards in the current batch/filter. The destination dialog lists the chosen clips and explains that it changes the filing plan, requires acceptance again, and leaves already finished files in place. Assigning the folder is one undoable edit.
- Filing Progress has an individual **Cancel** action for every queued/running item, alongside cancellation of all remaining work. The existing native job cancellation controls the chosen writer only. Completed results stay intact and cancelled items retain explicit Retry.
- Library verification formerly disabled the clicked card. Delaying the native response reproduced the reported shortcut failure in the packaged 0.3.14 app. The card now remains focusable, with an accessible busy state and duplicate activation suppressed. J/K/L are ignored while verification is pending; source-workspace transport no longer handles keys on the completed Library page. Once ready, card focus remains and one keypress issues one Library command. Text fields retain ordinary typing.
- The Library viewer fills the available height. **Clip details & markers** opens a bounded panel below it; its contents scroll independently. The empty filmstrip row is collapsed when there is no thumbnail provider or waveform to show, while the ruler/marker seek lane remains. Real thumbnails/audio/keyframes for completed Library media remain VC-55.

## Review notes incorporated

Connor passed M251–M253 and M255–M257. M254 failed again and needs a focused recheck. M256 confirms the intended Date modified chronology in both Explorer and Resolve; keep Date created as the actual export creation time. M257 confirms matching audio/video timing and the intended distinction between requested Cut loop bounds and outward finished-file bounds.

New board follow-ups:

- **VC-58:** finished Date modified sorting and a choice between one group per folder or contiguous folder runs preserving global name/date order. The tree remains unique per folder.
- **VC-59:** reflect a relinked Done revision's actual filed location in Review, preserving its original planned destination and historical receipt.

M249/Resolve helper, M212 compatibility, M217 playback metrics, deeper O checks, coverage measurement and the representative M2 production batch remain open. The original demuxer failure remains an investigation; passing recovery tests do not identify its cause.

## Verification

Focused Electron tests cover out-of-order clip creation, retiming and renumbering, preserved colors/IDs/saved ordering, marker reorder with Undo/Redo, bulk assignment as one history action, and no planned-folder creation. Native filing tests cancel one queued item and one active writer while a peer completes and verifies normally. Library tests delay real native verification, exercise focus and transport, protect Search typing, and inspect wide/compact layouts. Final packaged evidence and launch path are recorded in the Notion review guide.

Build/type checks, lint, formatting and all eight selected native/Electron regression scripts passed. The packaged run covers native filing/recovery, editing fixtures, destination safety/diagnostics, filing/Library UI, startup/preload/navigation, editing/Undo, playback/recovery and chronological/bulk Review controls. An additional final Library run checks actual J/K/L key events typed into Search, alongside delayed verification and native cancellation. Wide/compact screenshots were inspected.

- Main report: `G:\GPT\Work\virtual-cut\review-0.3.15\packaged-reports\run-cM6gGS\report.json`
- Final Library report: `G:\GPT\Work\virtual-cut\review-0.3.15\final-library\run-xV3cdN\report.json`
- Old-build reproduction: `G:\GPT\Work\virtual-cut\review-0.3.15\baseline\run-UzrVfn\report.json` (expected Library shortcut failure on 0.3.14).
- Build: `G:\GPT\Work\virtual-cut\review-0.3.15\builds\Virtual-Cut-0.3.15-win-x64-2026-10-01T19-34-35-931Z\Virtual Cut.exe`

The Notion guide retains 77 checked items, 41 callouts and 35 images, adds M258–M260, and leaves M254 open for human recheck. These are selected regression checks, not a new full-suite or code-coverage measurement.
