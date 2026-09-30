<p align="center">
  <img src="design/brand/github-banner.png" alt="Virtual Cut — a footage workspace for Windows. Cut, mark, review and organize." width="1280">
</p>

**Virtual Cut** is a Windows desktop workspace for working through recorded footage: find moments, make clips, keep contextual markers, and review where everything belongs. Built with Electron, React, TypeScript, and CSS Modules, with DaVinci Resolve handoff as a planned destination.

## The workspace

| Page        | Current preview                                                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Media**   | Browse recordings in a thumbnail grid or list beside the viewer.                                                                                                                            |
| **Cut**     | J/K/L playback, frame and keyframe steps, scrubbing, editable clips and markers, and frame capture. Overlapping clips have separate rows, consistent colors, and clear selected boundaries. |
| **Review**  | Folder-grouped clip cards, inline previews, pending-change indicators, and an Accept / Hold / Queue / Done workflow.                                                                        |
| **Library** | Search footage, edit a shared glossary, and explore connections between characters, locations, mechanics, clips, and markers.                                                               |
| **Selects** | A prototype for assembling selects and string-outs; further development is deferred.                                                                                                        |

**Current state: the first Milestone 2 export slice, ready for user testing (0.3.4).** Create and reopen saved projects, import named batches, inspect streams and chapter markers, choose Game/Mic audio, and save Cut edits with undo/redo. Export one selected clip from Cut or Review: original video plus game audio, source container by default, outward keyframe cuts, verified packet timing, embedded chapter names/times and a portable annotation file. Export history records actual ranges and processing time, and preserves receipts across undo and save restoration. Media accepts one or many dropped videos with batch audio setup and skipped-file feedback. The timeline supports cursor zoom, panning and a full-extent reset across Media, Cut and Review. Media panels resize and hide independently; markers use Resolve's named palette and start Blue with their name ready to type. Batch filing, richer Resolve metadata transfer, transcription, Notion sync, and agents remain planned. The sample workspace keeps its prototype actions separately. See the [M2 implementation and review scope](docs/milestone-2.md).

The local test setup uses six complete 4K AV1 recordings with original audio. Private footage and preview images are excluded from this repository. On a fresh checkout, use **Open video**, or configure the local sample media described in the [workflow preview guide](docs/workflow-preview.md).

## Run the app

Version 0.3.4 reduces playhead-only saves to a 30-second cadence while navigating, plus a save after two seconds at rest. Clip/marker edits retain their short save delay; Save, project operations and normal close capture the latest position. Cut's viewer shrinks to fit overlapping lanes and controls. Double-click a clip or marker card outside its fields to seek; the same behavior is available in expanded Review details. Ctrl+wheel pans a zoomed timeline, while Alt+wheel zooms. Marker notes accept Enter for multiple lines; names stay single-line. See [the playback/filmstrip assessment](docs/playback-feedback.md) for the remaining high-speed and thumbnail limitations.

With Node 22.12+ installed:

```powershell
npm ci
npm run dev
```

Development needs FFmpeg and FFprobe on PATH (or `VIRTUAL_CUT_FFMPEG` / `VIRTUAL_CUT_FFPROBE` pointing to the executables). For a standalone desktop folder, run `npm run package:win`, then open `Virtual Cut.exe` inside the generated `release/Virtual-Cut-...` directory. The local Windows package includes the media tools. Keep the folder's files together; set `VIRTUAL_CUT_PACKAGE_DIR` to choose a different output location.

The app launches maximized. Press **F11** or the fullscreen button to hide/show the window frame. The bottom page strip stays visible. **Preview options** in the upper right can reset sample edits or open the earlier Studio/Library/Focus foundation layouts.

Choose **Projects** beside the page name to create a `.vcut` project. Choose its file, finished-clip destination, and a separate preview-cache folder. Use **Import files** or **Import folder** to register completed recordings in the current batch; folder import includes nested folders. Media shows their actual source-folder hierarchy, with descendant filtering and recording counts. Review retains planned clip destinations. Projects save automatically; **Jobs** shows inspection/audio progress, errors, cancellation, and retry.

**Delete batch…** offers two choices with confirmation and a protective manual save: remove the grouping while keeping work accessible in another batch (or Unbatched), or remove the batch's exclusive app records and disposable previews. Shared recordings and original videos are preserved. Removing app data clears edit Undo history; Save history recovers the project records and regenerates missing previews. Files in use may remain in the cache and are reported.

In Cut, **Q/W** set the selected clip's in/out points, **S** splits it, and **M** creates and selects a marker. **H · Handles** toggles draggable clip edges; drag adjusts the in/out point and previews its frame, release commits one undo step, and Escape cancels. Handles use inspected frame times when available and cannot cross each other or the source boundaries. Click a card or timeline bar to select a clip; selection-follow keeps the last clip selected through gaps. **R** selects the name for fast renaming; **Backspace** requests deletion, **Enter** confirms and **Escape** cancels. Editing shortcuts leave typing fields alone. **Ctrl+Z / Ctrl+Shift+Z** undo/redo and **Ctrl+Up/Down** navigate the active page's items. **Keyboard shortcuts** in the bottom bar provides a reference.

Batch imports ask about microphone notes and remember audio track assignments. Individual recordings can override them in **Source & audio setup**. Assigned tracks prepare automatically for **Listen: Game / Mic / Combined**, with **Off / Overlay / Replace filmstrip** waveform options beside playback. Waveforms show separate labelled tracks, with amplitude scaled for visibility. Small filmstrip ticks are keyframe positions and can be hidden. Volume starts at 100%. Prepared audio is a disposable listening cache; exports will use original source streams. Original video decoding depends on Electron's codec support; reverse playback is a silent seek-based scan.

**K / Space** toggles Play/Pause. **J** scans backward; **L** starts forward at 1× from pause and advances to 2× / 4× / 8× / 16× on repeated presses. Reverse uses the same steps and is a silent sampled scan. The active transport highlights teal. **Loop selected clip** repeats its In/Out range and follows the current clip selection; it is disabled without a valid range. Listening choices, audio status, volume and waveforms are grouped on the right of the viewer. The viewer header distinguishes source FPS from measured playback FPS and dropped/total frames. Counts include uninterrupted 1× playback, exclude seeks/loading/scanning, freeze on pause and reset on source changes/reloads. They describe preview playback, not exported media; high-speed preview can skip frames or mute audio.

On **Media**, the left edge has separate folder-tree and media-pool toggles plus a hide/show-both control. Panel widths and visibility persist. **Trash icons on each source card** in Media and Cut remove that recording's batch membership; shared recordings retain their other batches and edits. An exclusive recording's app entries are removed after a protective manual save. Originals, previews and finished exports remain on disk. This operation clears edit Undo; use **Save history** to restore the recording and its edits. The adjacent folder icon opens Explorer at that recording's original file.

**Save / Ctrl+S** creates a manual checkpoint alongside continuous project saving. **Save history** lists save type, date and time in a compact table with Restore and open-folder actions. It restores one of five autosave copies or five manual checkpoints; restore first protects current work with another manual checkpoint. Copies live beside the project file in its `.vcut.saves` folder. Autosave copies are made after edits at most every two minutes, and when closing if the working state has changed.

The separate sample workspace still offers **Open video** for a session-only draft. Sample edits use localStorage; real projects use SQLite and do not share the sample scratchpad.

- [Foundation guide: architecture, commands, verification, and current limits](docs/foundation.md)
- [Milestone 1: storage, timing, verification, and test recipe](docs/milestone-1.md)
- [Desktop workflow preview: interactions and limitations](docs/workflow-preview.md)
- [Layout concepts and review questions](docs/layout-concepts.md)

## Branding

The Film Edge mark combines overlapping teal blades with ivory film, using three perforations above and two below. The same SVG drives the app header, desktop icons, and repository artwork.

[SVG logo](design/brand/virtual-cut-logo.svg) · [Transparent PNG](design/brand/virtual-cut-logo.png) · [App icon](design/brand/virtual-cut-app-icon.png) · [Brand assets and palette](design/brand/README.md)

## Planning

- [Product flow, feature set, and staged build plan in Notion](https://app.notion.com/p/3ea7c5227a808000819af5c03bcfae3c)
- [Design decisions](docs/design-decisions.md)
- [Local transcription research](docs/research/local-transcription.md)
- [Spoken microphone cues: Mark, Cut, Note](docs/feature-requests/spoken-cues.md)
- [Deferred proxy feature request — GitHub issue #1](https://github.com/connsteele/Virtual-Cut/issues/1) ([local request](docs/feature-requests/proxies.md))

Planning documents describe the agreed direction and open validation work. The implemented scope is recorded separately in the foundation guide.
