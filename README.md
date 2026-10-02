<p align="center">
  <img src="design/brand/github-banner.png" alt="Virtual Cut — a footage workspace for Windows. Cut, mark, review and organize." width="1280">
</p>

**Virtual Cut** is a Windows desktop workspace for working through recorded footage: find moments, make clips, keep contextual markers, and review where everything belongs. Built with Electron, React, TypeScript, and CSS Modules, with an explicit DaVinci Resolve marker-metadata helper.

## The workspace

**Current branch: M3 audio intelligence, 0.4.0 first review.** Explicit local transcription, separate game/microphone results, a floating word-seeking transcript window, original-preserving corrections, reviewed spoken cues, and project/batch game and video context are implemented for review. Recognition quality and the remaining M3 boundaries are documented in [the review guide](docs/m3-review.md) and [engineering notes](docs/m3-implementation.md). This workstation build uses an installed local speech runtime; portable provisioning, optional speaker detection and automated agent correction are not included. M2 remains accepted.

| Page        | Current preview                                                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Media**   | Browse recordings in a thumbnail grid or list beside the viewer.                                                                                                                            |
| **Cut**     | J/K/L playback, frame and keyframe steps, scrubbing, editable clips and markers, and frame capture. Overlapping clips have separate rows, consistent colors, and clear selected boundaries. |
| **Review**  | Folder-grouped clip cards, inline previews, pending-change indicators, and an Accept / Hold / Queue / Done workflow.                                                                        |
| **Library** | Search completed clips and annotations, preview independently of originals, and relink moved outputs. The sample workspace retains its glossary and connections prototype.                  |
| **Selects** | A prototype for assembling selects and string-outs; further development is deferred.                                                                                                        |

**Accepted M2 baseline (0.3.23).** Create and reopen saved projects, import named batches, inspect streams and chapter markers, choose Game/Mic audio, and save Cut edits with undo/redo. Export one selected clip from Cut or Review: original video plus game audio, source container by default, outward keyframe cuts, verified packet timing, embedded chapter names/times and a portable annotation file. Export history records actual ranges and processing time, and preserves receipts across undo and save restoration. Media accepts one or many dropped videos with batch audio setup and skipped-file feedback. The timeline supports cursor zoom, panning and a full-extent reset across Media, Cut and Review. Media panels resize and hide independently; markers use Resolve's named palette and start Blue with their name ready to type. Review now files accepted current clips into their planned folders with durable results, cancellation/retry and verified Done. Library previews completed outputs even with originals offline and supports matching-pair relinking. An explicit Resolve helper enriches imported chapter markers with multiline notes and named colors while preserving conflicting user edits. Clip notes/context remain in the companion and Library. Connor reported a successful representative batch through save/reopen, completed playback and Resolve handoff; M281–M286 refinements are accepted. Older compatibility observations and the first hosted CI run remain explicit follow-ups. At that baseline transcription, Notion sync and agents remained planned; M3 progress is described above. The sample workspace keeps its prototype actions separately. See the [M2 implementation and review scope](docs/milestone-2.md).

The local test setup uses six complete 4K AV1 recordings with original audio. Private footage and preview images are excluded from this repository. On a fresh checkout, use **Open video**, or configure the local sample media described in the [workflow preview guide](docs/workflow-preview.md).

## Run the app

Version 0.4.1 refines **Transcript** to project controls and optional transcription to each import's audio setup. Use Projects for game/brief context and **Batch context** for inheritance or overrides. Recognition only starts after an explicit request; opening saved transcripts does not load a model. The separate window supports word seeking, search, corrections, cue review and JSON/SRT export. See [M301–M308](docs/m3-review.md) for the prepared local review project, observed CPU timings and known recognition errors.

Version 0.3.23 groups cleanup files with expandable counts and explains retained saves. Projects shows a storage breakdown below Preview cache, measured only when the panel opens or Refresh is clicked. Sources and all completed outputs/companions remain protected. M281–M286 passed; see [the M2 closeout and explicit follow-ups](docs/m2-closeout.md).

Version 0.3.22 adds peer annotation snapping, the range End remove button, Trim signals in Review, a default-open tree, readable filing timings, clickable filing destinations, whole-Media-Pool Resolve discovery and reviewed project deletion. Cleanup always preserves source footage, completed exports and companions. See [the current review additions](docs/review-0.3.22.md). M279/M280 and the reported VC-26 workflow are accepted; only changed behaviors need another look.

Version 0.3.21 adds clock/frame readout icons and playhead snapping to annotation boundaries while scrubbing, independent of Manipulate. See [the current review additions](docs/review-0.3.21.md). M276–M278 are accepted. The engineering coverage baseline is documented in [testing](docs/testing.md).

Version 0.3.18 adds range markers with split endpoints, translucent spans, overlap lanes, numeric timing and H-mode movement/resizing. Shift+M creates a range; Shift-drag extends a point. It also fixes inspector scroll interference and reuses bounded Library overviews. Update the Resolve helper for range-duration handoff. See [the current review additions](docs/review-0.3.18.md).

Version 0.3.17 adds Library filmstrip/keyframes/game waveforms, clearer Review labels, a full Handoff page and generated chapter cleanup.

Version 0.3.16 adds Review Date modified sorting, global-order folder runs, current Done locations after relink, and a dedicated Resolve Handoff panel with helper status and safe removal. See [the current review additions](docs/review-0.3.16.md).

Version 0.3.15 orders Cut clips and marker cards chronologically, puts bulk destination changes above Review cards, adds individual filing cancellation, and fixes Library focus loss during file verification. Library gives playback the available height with expandable details. See [the preceding review follow-up](docs/review-0.3.15.md) and [the preceding recovery/diagnostics work](docs/review-0.3.14.md).

Version 0.3.13 adds reviewed batch filing, the completed Library, an explicit Resolve metadata helper, and Review-to-Cut playhead preservation. See [filing, recovery and Resolve handoff](docs/filing-and-library.md) for the review workflow and verification limits.

Version 0.3.12 replaces persisted Undo snapshots with a bounded session journal and compact saves. Autosave defaults to ten minutes, with adjustable intervals and optional saving after edits. Manual Save keeps Undo; reopening starts a fresh Undo history. Existing projects and rolling saves are upgraded safely. See [save policy](docs/save-policy.md) for behavior, migration and measured storage reductions.

Version 0.3.11 addresses the latest marker stacking and Review folder-picker/tree/source-title feedback. Project recovery now includes verified backups before a schema upgrade, interruption notices and Recover from save into a separate project. See [project recovery](docs/project-recovery.md) for compatibility, retention and validation boundaries.

Version 0.3.10 adds automatic destination holds, selectable/resizable Review folders, source links to Cut, Explorer access and marker dragging in Manipulate mode. It builds on the persistent local diagnostics and exact-content review acceptance introduced in 0.3.9. Plans can assign several clips to existing or proposed folders without creating directories or filing media. Existing accepted clips from older versions require one fresh acceptance. See [review planning and diagnostics](docs/review-planning.md) for behavior, verification and remaining M2 work.

Version 0.3.8 retains recent filmstrip images across recording switches and keeps overlapping tiles aligned while panning. The bounded memory cache favors recent overviews, requests only missing visible slots, and releases images on eviction or project close. See [filmstrip reuse](docs/filmstrip-reuse.md) for behavior, limits and verification.

Version 0.3.7 compacts thumbnail actions into the duration row and stacks list dates when the media pool is narrow. Playback and exports are unchanged. The [review follow-up](docs/review-0.3.6-followup.md) records the logging audit, confirmed Resolve note/color transfer gap, filmstrip reuse plans and preliminary 6× audio measurements.

Version 0.3.6 stabilizes viewer size during source changes, reduces fast-playback audio corrections and switches a stalled fast preview to bounded frame scanning. Preview errors offer a same-position reload with local diagnostics. M225–M227 layout/save-notice follow-ups are included. See [the playback investigation](docs/transport-investigation.md) for measured causes, the LosslessCut comparison and remaining limits.

Version 0.3.5 adds Media dates and sorting (Date oldest-first by default; Intake time and Name also available). Registered project timelines generate nearest-keyframe tiles for the full or zoomed view directly into a bounded memory cache, with no dynamic image files. Hover a tile for its actual source time. Background generation waits while playing/seeking. Saved now appears briefly after a real save. See [dates and filmstrip behavior](docs/filmstrip-feedback.md) for storage, timing and verification details.

Version 0.3.4 waits to autosave until playback/seeking has stopped and changes have settled for two seconds. Pending clip/marker edits also wait while playing or holding a scrub/trim gesture. Save, project operations and normal close capture the latest position. Navigation creates no undo steps; Undo/Redo reverses edits without resetting the viewing position. Cut's viewer shrinks to fit overlapping lanes and controls. Double-click a clip or marker card outside its fields to seek; the same behavior is available in expanded Review details. Ctrl+wheel pans a zoomed timeline, while Alt+wheel zooms. Marker notes accept Enter for multiple lines; names stay single-line. See [the playback/filmstrip assessment](docs/playback-feedback.md) for the remaining high-speed and thumbnail limitations.

With Node 22.12+ installed:

```powershell
npm ci
npm run dev
```

Development needs FFmpeg and FFprobe on PATH (or `VIRTUAL_CUT_FFMPEG` / `VIRTUAL_CUT_FFPROBE` pointing to the executables). For a standalone desktop folder, run `npm run package:win`, then open `Virtual Cut.exe` inside the generated `release/Virtual-Cut-...` directory. The local Windows package includes the media tools. Keep the folder's files together; set `VIRTUAL_CUT_PACKAGE_DIR` to choose a different output location.

The app launches maximized. Press **F11** or the fullscreen button to hide/show the window frame. The bottom page strip stays visible. **Preview options** in the upper right can reset sample edits or open the earlier Studio/Library/Focus foundation layouts.

Choose **Projects** beside the page name to create a `.vcut` project. Choose its file, finished-clip destination, and a separate preview-cache folder. Use **Import files** or **Import folder** to register completed recordings in the current batch; folder import includes nested folders. Media shows their actual source-folder hierarchy, with descendant filtering and recording counts. Review retains planned clip destinations. Projects save automatically; **Jobs** shows inspection/audio progress, errors, cancellation, and retry.

**Delete batch…** offers two choices with confirmation and a protective manual save: remove the grouping while keeping work accessible in another batch (or Unbatched), or remove the batch's exclusive app records and disposable previews. Shared recordings and original videos are preserved. Removing app data clears edit Undo history; Save history recovers the project records and regenerates missing previews. Files in use may remain in the cache and are reported.

In Cut, **Q/W** set the selected clip's in/out points, **S** splits it, and **M** creates and selects a marker. **H · Manipulate** toggles draggable clip edges and circular marker handles. Drag changes a clip edge or marker time while the playhead stays fixed; release commits one undo step, and Escape cancels. Focus a marker and use Left/Right for frame nudges or Shift+Left/Right for about one second. Handles use inspected frame times when available and cannot cross each other or the source boundaries. Click a card or timeline bar to select a clip; selection-follow keeps the last clip selected through gaps. **R** selects the name for fast renaming; **Backspace** requests deletion, **Enter** confirms and **Escape** cancels. Editing shortcuts leave typing fields alone. **Ctrl+Z / Ctrl+Shift+Z** undo/redo and **Ctrl+Up/Down** navigate the active page's items. **Keyboard shortcuts** in the bottom bar provides a reference.

Batch imports ask about microphone notes and remember audio track assignments. Individual recordings can override them in **Source & audio setup**. Assigned tracks prepare automatically for **Listen: Game / Mic / Combined**, with **Off / Overlay / Replace filmstrip** waveform options beside playback. Waveforms show separate labelled tracks, with amplitude scaled for visibility. Small filmstrip ticks are keyframe positions and can be hidden. Volume starts at 100%. Prepared audio is a disposable listening cache; exports will use original source streams. Original video decoding depends on Electron's codec support; reverse playback is a silent seek-based scan.

**K / Space** toggles Play/Pause. **J** scans backward; **L** starts forward at 1× from pause and advances to 2× / 4× / 8× / 16× on repeated presses. Reverse uses the same steps and is a silent sampled scan. The active transport highlights teal. **Loop selected clip** repeats its In/Out range and follows the current clip selection; it is disabled without a valid range. Listening choices, audio status, volume and waveforms are grouped on the right of the viewer. The viewer header distinguishes source FPS from measured playback FPS and dropped/total frames. Counts include uninterrupted 1× playback, exclude seeks/loading/scanning, freeze on pause and reset on source changes/reloads. They describe preview playback, not exported media; high-speed preview can skip frames or mute audio.

On **Media**, the left edge has separate folder-tree and media-pool toggles plus a hide/show-both control. Panel widths and visibility persist. **Trash icons on each source card** in Media and Cut remove that recording's batch membership; shared recordings retain their other batches and edits. An exclusive recording's app entries are removed after a protective manual save. Originals, previews and finished exports remain on disk. This operation clears edit Undo; use **Save history** to restore the recording and its edits. The adjacent folder icon opens Explorer at that recording's original file.

**Save / Ctrl+S** saves immediately and makes a compact manual checkpoint. **Save history** includes autosave settings: a 10-minute default interval and optional **Also save after edits**, both remembered on this device. Automatic saves wait for playback/seeking/manipulation to stop and changes to settle. Normal close saves current work; an unexpected exit can lose edits since the last save. Undo stays in memory across saves and resets on project reopen. Five autosaves and five manual saves are retained in the adjacent `.vcut.saves` folder; restore first protects current work. Existing rolling saves are compacted on upgrade; pre-upgrade copies remain separate. See [save policy and measurements](docs/save-policy.md).

The separate sample workspace still offers **Open video** for a session-only draft. Sample edits use localStorage; real projects use SQLite and do not share the sample scratchpad.

- [Foundation guide: architecture, commands, verification, and current limits](docs/foundation.md)
- [Regression gates: fast, native, desktop and packaged tests](docs/testing.md)
- [Review planning, automatic destination holds and Manipulate mode](docs/review-planning.md)
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

### Latest review iteration — 0.3.19

Cut has a remembered **Snap** toggle beside **H · Manipulate**, enabled initially. Dragged clip edges, marker positions and range edges snap within ten screen pixels of the playhead, other points, range endpoints and clip endpoints captured at drag start. An annotation never attracts itself. Moving a whole range can align either endpoint while retaining duration. Existing frame and source bounds still apply; Escape cancels and a completed gesture is one Undo. Alt-drag a point marker left or right to create a range, including with Manipulate off. Range spans are thin, centered and text-free, with consistent split endpoint shapes. Verified cached Library revisits prepare timing data before switching the viewer. See [0.3.19 review notes](docs/review-0.3.19.md).
