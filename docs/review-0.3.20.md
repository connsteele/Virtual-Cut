# Review iteration 0.3.20

## Delivered

- Manipulate retiming leaves the playhead stationary, including pointer-down, drag, release and keyboard marker nudges. Snapping still uses the frame-aligned playhead and ten screen pixels of tolerance. Escape cancels; a completed gesture remains one Undo.
- Timeline marker and clip single-clicks select without seeking. Empty edit lanes deselect without seeking. Double-click seeks to the start. The ruler and filmstrip/waveform surface support mouse scrubbing; keyboard transport remains available. Inspector marker titles now follow the same single/double-click distinction.
- Manipulate points remain circles; range endpoints remain split circles throughout Alt-drag conversion. H off restores pointed markers. Thin translucent bands and overlap lanes remain.
- A 34-pixel dedicated ruler uses zoom-dependent major/minor ticks. The larger Position field accepts seconds, MM:SS.mmm or HH:MM:SS.mmm. Enter seeks, Escape or leaving the field cancels, and invalid/out-of-bounds input is rejected. This is elapsed recording time, not frame timecode. Review bounds apply; Library uses time within the completed output.
- Inspector focus on a button no longer triggers a card-centering scroll between pointer-down and click. Timeline selection/retiming still reveals the corresponding card.

## Manual review

- **M276 — Stationary playhead and selection:** Place the playhead, enable H and Snap, and drag point markers, range bodies/ends and both clip ends. The playhead must stay put during the complete edit while nearby boundaries align. Check Snap off, zoom, Escape and Undo/Redo. Single clicks select without seeking, including inspector titles/cards; empty lanes deselect. Double-click seeks to start in both H states. Scrub the ruler/filmstrip and check selection-follow on/off.
- **M277 — Manipulate shapes:** Alt-drag points left and right with H on. Both endpoints must use split circles during and after conversion. Toggle H off/on; compare pointed/circular forms, overlap lanes, pointer selection and keyboard focus. Alt-drag also works with H off.
- **M278 — Ruler and exact position:** Check readable labels at full extent and zoomed, wide and compact windows. Enter seconds or HH:MM:SS.mmm in Position, press Enter, and compare the viewer. Check Escape, invalid values and Review bounds. Check waveforms in Overlay/Replace and Library seeking. Viewer and controls must fit without outer scrolling.

## Review intake and remaining scope

M274 and M275 are accepted; M273's old moving-preview behavior is superseded by M276. VC-55 is Done. VC-71 records Library verification latency for Later, preserving file verification and changed-file guarantees. VC-69 remains in User testing for this correction; VC-35's range behavior and handoff already passed, with the appearance refinement above for review.

VC-50 measured coverage, VC-26 representative batch acceptance, deeper M254/M249/M212/M217/O01–O05 checks, conditional VC-41 natural playback recurrence and first hosted CI remain separate. No coverage percentage or milestone completion is claimed here.

## Verification

Build/type checks, lint, focused generated-media tests, packaged interaction checks and wide/compact screenshots are recorded in `G:\GPT\Work\virtual-cut\review-0.3.20\verification-summary.json`. Original footage and existing project data are not used by these tests. The first development run exposed inspector focus scrolling before a conversion click; that correction is covered by the range desktop gate. Evidence from failed runs is retained.
