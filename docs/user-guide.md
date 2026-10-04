# Using Virtual Cut

A reference for the current workspace controls and behavior, moved from the README on October 3, 2026. Version-specific changes are in the [changelog](../CHANGELOG.md); confirmed product decisions are in [design decisions](design-decisions.md) and [decision records](decisions/README.md).

## Sample media

The local test setup uses six complete 4K AV1 recordings with original audio. Private footage and preview images are excluded from this repository. On a fresh checkout, use **Open video**, or configure the local sample media described in the [workflow preview guide](workflow-preview.md).

## Window and projects

The app launches maximized. Press **F11** or the fullscreen button to hide/show the window frame. The bottom page strip stays visible. **Preview options** in the upper right can reset sample edits or open the earlier Studio/Library/Focus foundation layouts.

Choose **Projects** beside the page name to create a `.vcut` project. Choose its file, finished-clip destination, and a separate preview-cache folder. Use **Import files** or **Import folder** to register completed recordings in the current batch; folder import includes nested folders. Media shows their actual source-folder hierarchy, with descendant filtering and recording counts. Review retains planned clip destinations. Projects save automatically; **Jobs** shows inspection/audio progress, errors, cancellation, and retry.

**Delete batch…** offers two choices with confirmation and a protective manual save: remove the grouping while keeping work accessible in another batch (or Unbatched), or remove the batch's exclusive app records and disposable previews. Shared recordings and original videos are preserved. Removing app data clears edit Undo history; Save history recovers the project records and regenerates missing previews. Files in use may remain in the cache and are reported.

## Editing, audio and playback

In Cut, **Q/W** set the selected clip's in/out points, **S** splits it, and **M** creates and selects a marker. **H · Manipulate** toggles draggable clip edges and circular marker handles. Drag changes a clip edge or marker time while the playhead stays fixed; release commits one undo step, and Escape cancels. Focus a marker and use Left/Right for frame nudges or Shift+Left/Right for about one second. Handles use inspected frame times when available and cannot cross each other or the source boundaries. Click a card or timeline bar to select a clip; selection-follow keeps the last clip selected through gaps. **R** selects the name for fast renaming; **Backspace** requests deletion, **Enter** confirms and **Escape** cancels. Editing shortcuts leave typing fields alone. **Ctrl+Z / Ctrl+Shift+Z** undo/redo and **Ctrl+Up/Down** navigate the active page's items. **Keyboard shortcuts** in the bottom bar provides a reference.

Batch imports ask about microphone notes and remember audio track assignments. Individual recordings can override them in **Source & audio setup**. Assigned tracks prepare automatically for **Listen: Game / Mic / Combined**, with **Off / Overlay / Replace filmstrip** waveform options beside playback. Waveforms show separate labelled tracks, with amplitude scaled for visibility. Small filmstrip ticks are keyframe positions and can be hidden. Volume starts at 100%. Prepared audio is a disposable listening cache; exports will use original source streams. Original video decoding depends on Electron's codec support; reverse playback is a silent seek-based scan.

**K / Space** toggles Play/Pause. **J** scans backward; **L** starts forward at 1× from pause and advances to 2× / 4× / 6× / 8× / 16× on repeated presses. Preview audio plays through 6× and pauses above it. Reverse uses the same steps and is a silent sampled scan. The active transport highlights teal. **Loop selected clip** repeats its In/Out range and follows the current clip selection; it is disabled without a valid range. Listening choices, audio status, volume and waveforms are grouped on the right of the viewer. The viewer header distinguishes source FPS from measured playback FPS and dropped/total frames. Counts include uninterrupted 1× playback, exclude seeks/loading/scanning, freeze on pause and reset on source changes/reloads. They describe preview playback, not exported media; high-speed preview can skip frames or mute audio.

On **Media**, the left edge has separate folder-tree and media-pool toggles plus a hide/show-both control. Panel widths and visibility persist. **Trash icons on each source card** in Media and Cut remove that recording's batch membership; shared recordings retain their other batches and edits. An exclusive recording's app entries are removed after a protective manual save. Originals, previews and finished exports remain on disk. This operation clears edit Undo; use **Save history** to restore the recording and its edits. The adjacent folder icon opens Explorer at that recording's original file.

## Saving and history

**Save / Ctrl+S** saves immediately and makes a compact manual checkpoint. **Save history** includes autosave settings: a 10-minute default interval and optional **Also save after edits**, both remembered on this device. Automatic saves wait for playback/seeking/manipulation to stop and changes to settle. Normal close saves current work; an unexpected exit can lose edits since the last save. Undo stays in memory across saves and resets on project reopen. Five autosaves and five manual saves are retained in the adjacent `.vcut.saves` folder; restore first protects current work. Existing rolling saves are compacted on upgrade; pre-upgrade copies remain separate. See [save policy and measurements](save-policy.md).

The separate sample workspace still offers **Open video** for a session-only draft. Sample edits use localStorage; real projects use SQLite and do not share the sample scratchpad.
