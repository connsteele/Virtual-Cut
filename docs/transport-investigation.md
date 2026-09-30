# Viewer and fast-playback follow-up — 0.3.6

## Viewer resizing

Connor's seven-second switching recording shows the timeline growing briefly and squeezing the video. A newly mounted timeline initially assumed a 640-pixel width. In a much wider viewer, those initial six tiles used their width to determine their height, until ResizeObserver supplied the real width and tile count. This happened again on source/range changes. The filmstrip now reserves 64 pixels (48 in compact-height windows) before measurement or decoding. Video and transition images fit the stage directly in CSS, without a delayed height-to-width update.

Wide (1800×1100) and compact (1100×720) checks observed unchanged stage height through repeated source switches, and fixed filmstrip height throughout. Different intentional controls/lane counts can still require different space; thumbnail loading does not.

## Measured playback findings

All tests used a disposable copy of a 166.5-second 3840×2160 AV1/60 source with two FLAC tracks. Originals were never imported into the test project.

- At 4×, the old independent preview-audio synchronizer made 148 seeks in five seconds; at 8×, 196 seeks. Its fixed 0.12 source-second tolerance becomes only 15 ms of wall time at 8×. Repeatedly assigning playbackRate also added unnecessary work. The new code sets rates only when they change, scales the tolerance with speed, avoids correcting an unfinished seek and bounds corrections. Audio pauses above 4× and during sampled scans. On the same copied source, the new 1×/2×/4× checks needed zero corrections after the initial seek.
- Removing Virtual Cut's UI/audio synchronization did not remove the separate 16× stall. An isolated offscreen Electron video window opening the file directly advanced 88.10 source seconds in eight wall seconds (128 nominal), with two buffering waits. Our existing byte-range stream advanced 88.69; Electron native file fetching advanced 88.78. This rules out our custom delivery as the distinguishing cause in this reproduction. Disabling embedded audio tracks also retained the stall.
- Chromium's diagnostic log reported **D3D11VideoDecoder**, platform decoding active, and **DEMUXER_UNDERFLOW**. The entire source was reported buffered during the freeze. This establishes an internal playback-pipeline underflow, not a download wait or proof of disk slowness. It does not establish the exact Chromium/driver defect.
- In the normal hidden app window, requestVideoFrameCallback is presentation-throttled; do not interpret its one-per-second callbacks as actual decode FPS. The isolated delivery comparison used an offscreen 60 Hz rendering window. Browser decode/drop counts and source-time advancement were measured separately.

Evidence: `G:\GPT\Work\virtual-cut\transport-investigation\benchmark-FBQC3r`, `delivery-dNnkyM`, `delivery-obllxp`, and final packaged `regression-u0HWsf`.

## LosslessCut comparison

Inspected upstream commit `70f2663a7a7c995903701acd2f616d057f4fdc2f` (3.69.0, Electron dependency ^42.10.0; this app uses 44.4.5). Its [normal player](https://github.com/mifi/lossless-cut/blob/70f2663a7a7c995903701acd2f616d057f4fdc2f/src/renderer/src/hooks/useVideo.ts) uses the native video element and playbackRate, coalescing pending seeks. It also has an [FFmpeg-assisted player](https://github.com/mifi/lossless-cut/blob/70f2663a7a7c995903701acd2f616d057f4fdc2f/src/renderer/src/MediaSourcePlayer.tsx) for stream combinations the normal player cannot handle. We have not measured Connor's installed LosslessCut version/settings on this copy; therefore the difference cannot honestly be attributed to one setting or runtime version yet. No dependency downgrade, hardware-disable flag or proxy generation was introduced.

## Mitigation and recovery

Native forward playback remains active while it advances. At 4× or faster, roughly 0.6 seconds without source-time progress switches the session to a clearly labeled **forward scan**. Scanning uses elapsed wall time and at most one outstanding seek, choosing nearby indexed keyframes at faster rates. Sparse keyframes fall back to the target timestamp. Reverse uses the same bounded scheduler. Pause cancels scheduling immediately; K/Space or L from pause starts at 1×. Loop bounds are read as they change; source timestamps and exports are unaffected. Sampling intentionally skips pictures and remains limited by seek/decode speed; it is not a promise to display every frame at 16×.

The actual terminal error from Connor's earlier `playback bug.mp4` has not been reproduced with a diagnostic code. The error path is hardened: stop scan/audio activity, disable editing readiness, retain local code/message/time/rate/state details and offer **Reload preview** at the same position. A deterministic error-event check verifies recovery; it is not proof of reproducing the original decoder failure. VC-41 remains open for that evidence.

## Review callouts

M224–M227 passed their functional checks. Follow-ups: Media sort stays right aligned, list dates share the title row, source actions share the duration row, filmstrip status is centered, and explicit Save/Ctrl+S suppresses the intermediate automatic Saved notice.

## Verification

Build/type checks and lint passed. `transport-regression-checks.mjs` passed against the final packaged app using Windows-only PATH and bundled media tools (`transport-investigation\regression-u0HWsf`). It exercises the real controls at 1×/2×/4×/8×/16× on copied 4K footage, adaptive scanning, 16× reverse, no overlapping scan seeks, pause/resume, same-position preview reload, stable source switches, compact list geometry and manual-save notices. `scan-playback.test.mjs` passed its slow pending seek, elapsed-time catch-up, source offset, loop-bound changes and cancellation checks.

Existing playback/marker checks passed (`m2-followup\playback-ui-1Uhq8P`), as did filmstrip UI (`filmstrip\ui-lb33u4`) and autosave/Undo/viewer checks (`playback-feedback\checks-3pXS84`), including zero saves during 33 seconds of continuous seeking and no center-pane scrolling with three overlapping lanes in a compact window. Packaged shell/preload/navigation checks passed (`transport-investigation\packaged-shell`). Wide and compact screenshots were inspected. All paths are under `G:\GPT\Work\virtual-cut`. Export code was unchanged; this pass does not replace the existing packet/timing evidence or the remaining manual Resolve checks.

The original audio-correction benchmark is retained in `transport-investigation.mjs`; it requires `VIRTUAL_CUT_BASELINE_EXECUTABLE` pointing to packaged 0.3.5. Current behavior is verified through the real transport controls in the regression script.
