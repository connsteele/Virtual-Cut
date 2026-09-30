# Standalone editing tools — version 0.3.3

September 30, 2026. VC-38 and VC-39 from the non-milestone backlog are implemented for user review. Duration markers remain a separate task. VC-40 now records the future game-transcript handoff to Resolve; importing subtitles is not assumed to provide Resolve's transcript editing features.

## Dropping footage into Media

Drop one or many saved video files anywhere on the Media page, including its empty state or with either/both panels hidden. The target names the active batch. Confirm the existing batch audio setup before registration. Cancel leaves the batch unchanged. The regular file/folder pickers remain available; dropped folders direct users to Import folder.

Preload obtains native paths only from Electron File objects. Main validates supported file types, readable files and duplicates within the drop, and holds one opaque offer for ten minutes. It is bound to the project and batch, can be discarded, and is consumed once. The renderer never receives new native paths from this operation. Generated File objects with a fabricated path cannot grant access.

The summary lists skipped entries (first twenty reasons), and valid files continue through the existing registration, duplicate reuse, audio defaults and inspection jobs. Extension validation cannot prove a media file is decodable; inspection failures still appear in Jobs. Original files are never moved or modified by intake. File drops outside Media are blocked from navigating Chromium.

## Timeline viewport

- Alt + wheel zooms around the cursor. Zoom buttons center on the visible playhead, or the visible range midpoint if the playhead is outside it.
- Alt + Shift + wheel pans. Left/right pan buttons and a keyboard range slider provide alternatives.
- Fit full recording resets Media/Cut to the full source. Fit full clip resets expanded Review to its clip bounds. Show playhead centers the visible range without seeking.
- Five source frames (at least 0.1 s) is the minimum visible span. Source changes reset the viewport. Ruler labels include milliseconds when looking at less than ten seconds.
- Clip/marker times, playback bounds and export plans remain independent of this viewport. Filmstrip samples, waveforms, keyframes, markers, overlap lanes, scrubbing and drag handles use the visible source range.
- Offscreen clip endpoints use continuation edges and cannot become false trim handles. Drag capture belongs to the stable timeline surface, so moving an edge outside the view still commits once; Escape cancels. The playhead is hidden when outside the view rather than misrepresented at a boundary.
- Filmstrip detail is limited by cached source thumbnails. Zoom does not generate extra video frames or change audio.

Wrapped audio controls retain their height; compact viewers scroll instead of overlapping Source & audio setup.

## Verification and review

`npm run test:tools` builds the app, checks viewport bounds/cursor anchoring, creates disposable eight-second footage with separated game/mic signals, verifies drop offer boundaries, and runs Electron UI checks. All media, profiles and captures use `G:\GPT\Work\virtual-cut\standalone-tools`. FFmpeg/FFprobe are required for fixture creation and inspection.

UI checks feed Chromium native-backed File objects through DataTransfer, exercising preload path extraction and main registration. They cover invalid/mixed files, cancellation, duplicates, remembered mic setup, hidden panels, forged-path rejection, cursor zoom, ordinary wheel behavior, keyboard pan, waveform transitions, marker alignment and deselection, overlap lanes, trimmed-edge visibility, drag commit/cancel, Undo, selected-clip looping, source resets, bounded Review and compact layout. Actual Explorer drag gestures and long-footage use remain Connor's M218/M219 review checks. Existing M212–M217 and O01–O05 are retained in Notion.

Version 0.3.3 passed build/type checks, lint, formatting, the new intake/viewport suite, the M1 feedback regressions and native removal checks. Packaged intake/zoom, playback/marker and shell checks also passed with Windows-only PATH, exercising bundled media tools. Wide and compact captures were inspected. Evidence:

- Native intake fixture and boundaries: `G:\GPT\Work\virtual-cut\standalone-tools\native-3Q596J`.
- Packaged drop/zoom: `G:\GPT\Work\virtual-cut\standalone-tools\ui-LCVyl5`.
- Packaged shell: `G:\GPT\Work\virtual-cut\standalone-tools\packaged-shell`.
- Packaged playback/markers: `G:\GPT\Work\virtual-cut\m2-followup\playback-ui-x5geeU`.
- M1 feedback: `G:\GPT\Work\virtual-cut\m1-feedback\ui-GLaBYX`; native removal: `G:\GPT\Work\virtual-cut\m2-followup\removal-RSh4yC`.

Build location and local checkpoint are recorded in the current Notion review guide. Automated results leave M218/M219 and the unfinished earlier checks unticked for Connor's review. Previous export packet/timing evidence remains in `docs/milestone-2.md`; this pass does not change the export implementation.
