# Virtual Cut 0.3.21 review

M276–M278 passed Connor's review. Range marker appearance/interaction follow-ups are accepted (VC-35). This iteration adds:

- Clock and film icons beside Position, with a remembered time/frame choice. Frames are zero-based source/output frame numbers, not SMPTE timecode. Indexed timestamps handle variable frame rate; without an index the tooltip explicitly calls the number an estimate from nominal FPS. Enter seeks; Escape/blur cancels. Switching formats does not seek or edit anything.
- Eight pixels of space below the position/format toolbar and above the ruler.
- Snapping while scrubbing on either the ruler or filmstrip/waveforms. Nearby point markers, range starts/ends and visible clip starts/ends are targets, whether Manipulate is on or off. Nearest visible boundary within ten screen pixels wins. Numeric entry and keyboard stepping stay exact. No clip/marker edit or Undo entry is created by scrubbing.

## Focused review

- **M279 — Position format and spacing:** Use the clock/film buttons by mouse and Tab/Enter. Compare time and frames at a recognizable frame; enter a frame number, cancel another entry, and try an invalid/out-of-range number. Toggle without moving the playhead. Check wide/compact layout and the gap above the ruler.
- **M280 — Playhead snapping:** Drag the ruler and filmstrip near a point, both range ends and both clip ends. Repeat with H on/off, zoomed, waveforms replacing the strip and Snap off. Expect a teal alignment guide during snapping and no edit to annotations. Manipulate retiming must still leave the playhead fixed.

## M2 completion route

VC-50 measures application coverage and establishes critical-module gates. Keep engineering evidence separate from manual acceptance. VC-26 is the representative project batch through export, accepted filing, Library and Resolve. Use that pass to finish remaining M254 viewer/typing, M249 repeat/reopen/timeline, M212 container/tail compatibility, M217 metrics and applicable O01–O05 checks. M230/VC-41 needs diagnostic evidence only if the rare terminal playback failure recurs. First hosted CI remains pending a future authorized push.

Preserve originals during production-batch review. M3 transcription, M4 agents and M5 Connections/glossary are unchanged; deferred Library parity/verification speed are not new M2 gates.

## Delivery evidence

Package: `G:\GPT\Work\virtual-cut\review-0.3.21\builds\Virtual-Cut-0.3.21-win-x64-2026-10-02T03-41-55-561Z\Virtual Cut.exe`.

VC-50's complete reconciled baseline includes all 37 maintained scripts, original TypeScript locations and untouched files. Combined line/function/branch coverage is 84.53% / 77.00% / 77.69%; all nine critical-module gates pass. See [coverage](coverage.md) for renderer/native totals, exact evidence, exclusions and remaining holes. Initial compact layout failures were fixed while retaining the existing viewer-size assertions; close/reopen collector omissions were caught and fixed. Failed attempts remain in the evidence history.

Wide/compact Cut and Library screenshots were inspected. At compact height, surrounding controls/margins tighten so four overlapping clips still leave a visible viewer. The requested Position/ruler gap remains. Packaging rebuilds normally; emitted application files contain no coverage collector or counters. Build, lint and focused delivery checks are recorded in `G:\GPT\Work\virtual-cut\review-0.3.21\verification-summary.json`.

All six selected scripts passed against the delivery package: coverage-pipeline proof, timeline/frame units, snapping units, feedback native preparation, Electron startup and the playback/save/layout follow-up. Package report: `G:\GPT\Work\virtual-cut\review-0.3.21\packaged-checks\run-NKo9b5\report.json`. Full inventory evidence remains the measured run plus explicit corrections above, not a claim that all 37 were rerun against the package. First hosted CI and human M279/M280/production acceptance remain pending.
