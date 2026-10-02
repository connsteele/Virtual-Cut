# Review iteration 0.3.19

## Delivered

- VC-69: remembered Snap toggle beside H/Manipulate, initially enabled. Clip edges, point positions and range endpoints snap within ten screen pixels to the frame-aligned playhead captured at gesture start. Moving a range can align its nearer endpoint while preserving duration. Source bounds and positive duration take precedence; Escape cancels, and each completed gesture produces one Undo.
- M269 refinements: Alt-drag a point left or right into a range, even with Manipulate off. Shift-drag in Manipulate remains an alias. Thin centered translucent bands contain no text; split endpoint shapes stay consistent. Pointer grabs have no selection outline; keyboard focus and accessible/hover labels remain.
- M272 refinement: a verified cached Library revisit prepares its timing data before switching the viewer. Timeline width is established before painting, so it can request the cached overview immediately. Existing bounded image/index/waveform caches remain in memory; no new disk thumbnails or saved preview data are introduced. New, evicted or resized overviews can still need generation.

## Manual review

- **M273:** Enable H and Snap. Place the playhead, drag both clip edges, marker points and range endpoints close to it. Expect a teal alignment guide and exact frame alignment. Moving a range by its band preserves duration and can align either endpoint. Check at full extent and zoomed in. Turn Snap off, compare, restart and confirm the setting is remembered. Try crossing the opposite edge/source limits, Escape, Undo and Redo.
- **M274:** With H off, Alt-drag a point left/right into a range. The original point becomes the opposite endpoint. Check thin centered text-free bands, consistent endpoint shapes, overlapping ranges, pointer selection and keyboard focus. H still moves/resizes ranges.
- **M275:** Let Library clips A and B finish loading full overviews, then revisit A/B. Cached revisits should not briefly show Loading filmstrip. Verify immediate J/K/L after selection, zoom/reset and compact layout. Verification still happens before switching; new or evicted views can load normally.

Connor checked M269–M272. Inspector scroll priority (VC-67) and explicit helper anchor cleanup (VC-68) are accepted. Range handoff/colors/overlaps passed in Resolve. Ordinary MP4 chapter import can still expose Clip start until helper Apply. Preserve all original callouts/screenshots. Broader Library parity is VC-70, Later, explicitly outside M2.

## Remaining M2 gates

VC-50 is the next distinct engineering pass: original-TypeScript-mapped renderer/native coverage with untouched files, missing-process detection, per-area reports and measured critical-module thresholds. No percentage is available yet. VC-26 representative-batch acceptance and the remaining M254/M249/M212/M217/O01–O05 hands-on checks stay open. VC-41's rare terminal read-error root cause is not reproduced; recovery is accepted and M230 is conditional on a natural recurrence. First hosted CI remains pending a future authorized push. These do not become passed through synthetic tests or this UI iteration.

## Verification

Build, lint, focused generated-media and packaged desktop evidence are recorded in the external verification summary and Notion guide. Tests use disposable projects/profiles on G: and do not touch original footage. This is a focused pass within the 36-script inventory, not a claim of full-suite or measured code coverage.

Evidence paths: `G:\GPT\Work\virtual-cut\review-0.3.19\final-reports\run-ZyUuXd\report.json` and `G:\GPT\Work\virtual-cut\review-0.3.19\final-library\run-G1n4S5\report.json`. The first packaged run passed snapping/ranges, memory/unit, generated native prerequisites, playback and startup; its Library placeholder assertion exposed a test timing error. The corrected check waits for the requested viewer and fully loaded overview before observing a revisit. The final Library run uses the delivery package. This preserves failed evidence rather than rewriting it.
