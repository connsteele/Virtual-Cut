# Desktop foundation

The original foundation is preserved behind **Preview options → Open previous foundation layouts** in sample mode. The default app now supports the [Milestone 1 project workspace](milestone-1.md) as well as the separate [desktop workflow preview](workflow-preview.md). The foundation details below describe the earlier layouts and native playback boundary, not the current project feature set.

## What works

- Native desktop window with the Virtual Legacy teal accent (`#04635F`).
- Resolve-inspired bottom navigation: Media, Cut, Review, Library, Selects.
- One main header with the current page name before the project picker and the selected layout in the Layouts button; no separate page-heading row or page taglines.
- Three switchable layout concepts: Studio, Library, Focus. Page and layout choices are saved on this device.
- A native project-folder picker. This sets a **session-only location**; it does not scan the folder or create a project database.
- **Open video:** A native file picker loads one completed MP4, M4V, MOV, MKV, or WebM recording for session-only playback. Container/codec compatibility still depends on Electron's built-in player; listing an extension is not a promise that every codec in it works.
- A 16:9 viewer with uncropped, contained playback; play/pause, restart, seek, volume/mute, and 0.5x–4x speed controls. Opening a new video does not autoplay. Playback position/settings follow layout changes; no session media is reopened automatically after quitting.
- Studio gives excess horizontal room around a height-limited video to the media pool and context/Notes/Agent panels. Compact windows preserve panel minimums and fit the video to the remaining area.
- A scratchpad saved on this device, shared across workspaces. It is not yet attached to a project, clip, or Notion page.
- A shared Agent panel showing the proposed Copilot and Agent modes. No provider or model is connected.
- A Windows folder build that launches without Node or a development server installed.

The project collections, editing timeline, and clip context remain placeholders. Project import, audio-track selection, cutting, review decisions, export, transcription, and model calls are separate future stages. Playback uses the file's default audio track; independently selecting or mixing game and mic tracks is not implemented. No media files are changed by this build.

## One-video demo

Choose **Open video** in the header, then select a completed recording. Use the seek bar and playback controls beneath the viewer. With the viewer itself focused, Space toggles playback, K pauses, and Left/Right seek five seconds; typing in notes or using a slider does not invoke those shortcuts. Full J/K/L shuttle and frame-accurate editing belong to the later cutting stage. No source frame rate is inferred from the displayed elapsed time.

Canceling the file picker preserves the current clip. An unsupported, missing, or changed file produces an error rather than a silent transcode. Files still being recorded should be opened after recording finishes. No folders are watched, no thumbnails/proxies are generated, and no speech model starts.

## Stack and boundaries

The renderer follows the preferences established in **Develop Footage Organizer**: React, TypeScript, Vite, CSS Modules, shared CSS variables, npm, ordinary components/hooks, and explicit service boundaries. There is no Tailwind or additional component framework.

| Location                | Responsibility                                                              |
| ----------------------- | --------------------------------------------------------------------------- |
| `src/`                  | React workspace, page/layout state, scratchpad, CSS Modules                 |
| `src/global.css`        | Shared colors, typography defaults, reset, focus treatment                  |
| `electron/contracts.ts` | Small typed desktop API shared with the renderer                            |
| `electron/preload.cts`  | Exposes app information, native folder/video pickers, and fullscreen        |
| `electron/main.cts`     | Native window, dialogs, permissions, and app asset loading                  |
| `electron/media.cts`    | Read-only, ranged streaming of the one explicitly selected video            |
| `scripts/`              | Development, build, smoke verification, Windows folder packaging            |
| `docs/`                 | Product decisions, research, layout review, and staged implementation notes |

The renderer has no direct Node, filesystem, or shell access. Production assets use a local `app://virtual-cut/` origin restricted to the built renderer directory. New windows, external navigation, embedded webviews, and permission requests are denied. Development serves Vite on loopback only.

Video access uses an opaque session URL at `media://video/<id>`. The native picker registers the path; the renderer cannot submit arbitrary paths. The stream handles GET/HEAD and single byte ranges, rechecks size/modification time, and releases its read-only handle on completion/cancellation. Selecting another file revokes the previous URL. Whole recordings are never loaded into a JavaScript buffer. The CSP permits this media origin explicitly. See Electron's [custom protocol documentation](https://www.electronjs.org/docs/latest/api/protocol) for the streaming privilege.

An HTTP backend is not needed for this shell. Future desktop operations should extend narrow typed commands and service modules. FFmpeg and faster-whisper will run in separately managed workers when their stages are implemented; the foundation starts neither one. Express remains the familiar choice if a later feature actually requires an HTTP service.

## Working locally

Use Node 22.12 or newer and npm:

```powershell
npm ci
npm run dev
```

React/CSS edits update through Vite. Electron source edits rebuild and restart the native window. Closing the window stops its development server. Development uses port 5173 and reports a conflict instead of choosing an unexpected port.

For production assets without a dev server:

```powershell
npm run build
npm start
```

For a standalone Windows folder:

```powershell
npm run package:win
```

Open `Virtual Cut.exe` in the timestamped `release/Virtual-Cut-...` folder. Keep the whole folder together. The executable has the approved app icon and Virtual Cut product name. This initial build is unsigned; an installer, signing, and updates are later packaging work. `VIRTUAL_CUT_PACKAGE_DIR` can override the output directory.

## Brand assets

The approved mark is the ivory Film Edge design with three top perforations and two bottom perforations. `src/assets/virtual-cut-logo.svg` is the single source used by the header, viewer, and About panel. `npm run brand:build` regenerates the deliverables in `design/brand` and the desktop/browser icons in `public`. Production builds also run this step automatically.

Sharp renders PNG sizes; the Windows ICO contains nine sizes from 16 through 256 pixels. The packaging step uses [resedit](https://github.com/jet2jet/resedit-js) to embed the icon and product name into the new package executable. The original Electron dependency is never patched. Resource editing happens before any future code-signing step.

## Verification

The compact-header/Studio update passed the full packaged Electron smoke, build, lint, and formatting checks. Verified page names in the top bar across all five pages, 2560 × 1375 content sizing with and without Notes, and a 1100 × 720 outer window. At the wide size, the 16:9 video uses the full stage height with less than two CSS pixels of horizontal slack; compact controls, keyboard focus, and bottom navigation remain accessible. Screenshots were inspected from hidden, muted test windows using the same disposable clip.

September 28, 2026: verified playback using a disposable copy of a 1.917-second Fortune's Weave recording (3840 × 2160 AV1 in MP4). The packaged app decoded frames and passed play/pause, seek, speed/mute, layout continuity, picker cancellation, unsupported-file recovery, and 16:9/compact-layout checks. Build, lint, formatting, byte-range/access tests, and the desktop shell smoke passed. Pausing a pending play request is treated as an ordinary interruption rather than a playback error. Tests used hidden, muted windows with disposable profiles; no original footage was played or modified. Audio was not auditioned, and this short sample is not a sustained-performance, long-file, or general codec compatibility benchmark.

```powershell
npm run build
npm run lint
npm run format:check
npm run test:smoke
npm run test:media
```

The Electron smoke test launches the actual app against production assets with an isolated profile. It checks the desktop bridge and security preferences, page/layout navigation, saved preferences and notes, folder-picker result handling, and compact-window layout. Folder-dialog responses are stubbed in the main process for repeatability; this does not exercise Windows dialog interaction.

Optional environment variables:

- `VIRTUAL_CUT_TEST_OUTPUT`: screenshot and test-profile directory.
- `VIRTUAL_CUT_TEST_EXECUTABLE`: path to a packaged `Virtual Cut.exe` to test instead of the development Electron runtime.
- `VIRTUAL_CUT_TEST_PROFILE`: explicit isolated profile directory; never use the normal app profile for tests.
- `VIRTUAL_CUT_TEST_VIDEO`: optional path to a disposable video copy. Adds decoded-frame, play/pause, seeking, mute/speed, 16:9 sizing, and layout-continuity checks to the smoke run.
- `VIRTUAL_CUT_TEST_BACKGROUND=1`: keeps the isolated test window hidden; captures its own content without capturing the user's desktop. Requires the smoke test's explicit separate profile. This lets verification run without taking foreground focus.
- `VIRTUAL_CUT_TEST_PLAYBACK_ONLY=1`: runs the focused playback checks after startup/isolation checks, skipping the general shell regression section; use with `VIRTUAL_CUT_TEST_VIDEO` when iterating on playback only.

For Connor's local runs, put test outputs and downloads on G:. Set process-scoped `TEMP`/`TMP` to `G:\GPT\Temp` for tools that use temporary storage. Normal app preferences remain in Electron's standard application-data location. Nothing here changes Windows-wide environment settings.

## Next build boundary

Review the [desktop workflow preview](workflow-preview.md) with real footage, then add persistent project records, media intake, and source probing. The new workspace gives each page its own arrangement; the old layout selector remains available for comparison. Validate broader original-media playback and audio-track selection before cutting/export. The review workflow is currently a sample simulation; production file operations are a separate implementation stage.
