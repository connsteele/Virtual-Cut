# Version 0.3.4 feedback and playback assessment

September 30, 2026. This pass follows Connor's Notion callouts and the four supplied screen recordings. It does not change exported media or its timing.

## Changes

- Automatic saving waits until playback, reverse scanning and seeking have stopped and the project has been idle for two seconds. Holding a scrub or trim gesture also postpones saving, even if its position stops changing. Edits made during playback remain marked Unsaved changes until it stops. There is no periodic save during navigation. Save, project operations and normal close await in-flight work and capture the latest position; an already-started disk write can finish if playback starts afterward.
- Playback, scrubbing and selecting another recording do not create undo steps or clear Redo. Undo/Redo reverses clip/marker edits while keeping the current recording and viewing position. Position-only saves update the working project without making a rotating backup.
- Navigation does not flash the Saving status or create rotating save-history copies. Previously it generated repeated working-project database writes and snapshots; it did **not** create a new rolling backup file for each position event.
- Media's hide/show-both button comes first. Folder and trash actions live on each recording card in Media and Cut. Reveal accepts a registered project/source ID only and rejects missing sources. Removal retains its confirmation and protective save.
- Cut and Media reserve space for timeline and tools, allowing the picture to shrink. Controls stay visible with overlapping lanes instead of requiring the center viewer pane to scroll. Source/audio setup may scroll inside its own expanded panel.
- Double-clicking non-editable card space seeks to clip start or marker time in Cut and Review details. Field double-clicks retain text selection. Ctrl+wheel pans without seeking or zooming; Alt+wheel zooms.
- Remove the divider below Markers. Marker notes now use a multiline field; marker names remain single-line. The metrics tooltip explicitly defines dropped x / total y.

## Filmstrip accuracy

The importer generates eight 320-pixel-wide JPEGs, sampled at the midpoints of eight equal-duration bins. The timeline chooses the bin containing each displayed tile's center timestamp. Zoom changes tile locations but does not produce finer samples.

For the 432.283-second source in the screenshots, samples are about 54.035 seconds apart. A tile's image may represent a moment almost 27.018 seconds away from its center. A short title/black frame captured at that sample can therefore represent many seconds of unrelated action. This is a sparse-thumbnail limitation, not evidence that the video and audio clocks disagree.

An improved pipeline should request frames for the visible tile timestamps, cancel obsolete pan/zoom requests, limit background decode work and retain a bounded memory cache keyed by source fingerprint and source time. Existing coarse images can fill the initial view, but should not be presented as detailed samples after zoom. Accurate decoding may need to start at a preceding keyframe; it is not a free file lookup.

Persistent image files are optional. FFmpeg's [image2pipe output](https://ffmpeg.org/ffmpeg-formats.html#image2_002c-image2pipe) can send encoded frames through a pipe. A separate video decoder can also feed an in-memory [canvas](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawImage). Native background extraction is the first candidate to evaluate, with playback priority, low concurrency and bounded image URLs; a second full-resolution browser decoder could compete with the viewer. No new thumbnail pipeline is included in 0.3.4.

## High-speed stalls and the separate playback error

Connor reports usable 4× preview and stalls/catch-up at 8× and 16×. Sampled frames from the supplied FF recordings corroborate repeated pictures followed by jumps, increasingly pronounced at 16×. The current forward implementation sets the original video's native playbackRate to 8 or 16 and synchronizes separate prepared audio elements. A 4K60 source advances through 480 or 960 source frames per second at those rates. The renderer need not display every frame, but codec dependencies and audio corrections can still impose substantial work.

Decode saturation and repeated audio resynchronization are plausible mechanisms inferred from the implementation. They are not established as the terminal error's root cause. Benchmark representative source **copies** with audio isolated and with the save reduction, then evaluate bounded, cancellable sampled scanning above 4×. The existing VC-36 ticket remains open with P1 priority.

`playback bug.mp4` shows an Unable to play banner, a retained frame and a changing seek clock. Switching recordings reloads the media element, consistent with Connor's reported recovery. The generic error handler currently omits [MediaError code/message](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/error), so this evidence cannot distinguish decode, stream or resource failure. It also leaves readiness true after a terminal error. The new recovery ticket requires diagnostics, stopped transport/audio, honest readiness and retry/reload without changing recordings or losing edits. The error is **not claimed fixed** by this pass.

## Verification

`npm run test:review-fixes` creates an isolated project with copies of synthetic media, then checks native source reveal, removal cancellation, Cut/Review seeking, multiline notes, Ctrl+wheel pan, four overlapping lanes at wide/compact sizes, idle-only saving during continuous seeks/held scrubbing/forward and reverse playback, deferred edits, Undo/Redo, manual save and immediate close/reopen. It records measurements and screenshots under the configured G: work area. This is functional verification, not a representative 4K AV1 performance benchmark.

Existing native recording-removal/recovery, M1 feedback UI and Electron shell checks remain regression gates. Export encoding/copying was not modified; prior packet/timing evidence remains in milestone-2.md. The Notion guide retains unfinished Resolve and deeper checks and separates new review items from Connor's completed checks.

### Release evidence

- Packaged checks passed with Windows-only PATH and the packaged media tools: `G:\GPT\Work\virtual-cut\playback-feedback\checks-Up7CCK`. Continuous seeks caused zero working-project writes in 33 seconds and no extra history copies. Forward playback, reverse scan and a held scrub also caused no automatic writes. Edits waited until seeking stopped, then saved; manual save and immediate normal close/reopen retained the requested positions and edits. Undo skipped navigation, preserved the viewing position and retained Redo after further seeking. Source SHA-256 stayed unchanged.
- Four overlapping lanes plus zoom fit a 1600×1000 and a 1100×720 window: center pane scroll height equalled its client height (783 and 529 CSS pixels respectively), while the video area shrank from 321 to 51 pixels. Controls remained above the bottom navigation. Wide/compact screenshots were inspected.
- M1 native feedback passed in `G:\GPT\Work\virtual-cut\m1-feedback\native-MlZZkR`; existing editing/UI regressions passed in `ui-oVnL1H`. Recording removal/recovery and restricted source-location lookup passed in `G:\GPT\Work\virtual-cut\m2-followup\removal-rsRRlI`.
- Packaged shell/preload/navigation/focus checks passed in `G:\GPT\Work\virtual-cut\playback-feedback\packaged-idle-shell`. Build/type checks, lint, changed-file formatting and diff checks passed.
- App: `G:\GPT\Work\virtual-cut\playback-feedback\builds\Virtual-Cut-0.3.4-win-x64-2026-09-30T21-08-01-329Z\Virtual Cut.exe`.
- Notion: VC-41 tracks error recovery/diagnostics, VC-42 accurate zoom thumbnails, VC-43 later scan metrics. VC-36 is Ready/P1 after the reported high-speed failure; VC-38/39 are Done following Connor's checked results. M220–M223 and refreshed M215 are ready for user review. M212, M216–M217 and O01–O05 remain open.
