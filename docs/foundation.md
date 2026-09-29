# Desktop foundation

This is the first build stage of Virtual Cut: a launchable Windows Electron app and a workspace shell to evaluate before media features are built.

## What works

- Native desktop window with the Virtual Legacy teal accent (`#04635F`).
- Resolve-inspired bottom navigation: Media, Cut, Review, Library, Selects.
- Three switchable layout concepts: Studio, Library, Focus. Page and layout choices are saved on this device.
- A native project-folder picker. This sets a **session-only location**; it does not scan the folder or create a project database.
- A scratchpad saved on this device, shared across workspaces. It is not yet attached to a project, clip, or Notion page.
- A shared Agent panel showing the proposed Copilot and Agent modes. No provider or model is connected.
- A Windows folder build that launches without Node or a development server installed.

The footage collections, viewer, timeline, and clip context are layout placeholders. Media playback, cutting, import, review decisions, export, transcription, and model calls are separate future stages. No media files are changed by this build.

## Stack and boundaries

The renderer follows the preferences established in **Develop Footage Organizer**: React, TypeScript, Vite, CSS Modules, shared CSS variables, npm, ordinary components/hooks, and explicit service boundaries. There is no Tailwind or additional component framework.

| Location                | Responsibility                                                              |
| ----------------------- | --------------------------------------------------------------------------- |
| `src/`                  | React workspace, page/layout state, scratchpad, CSS Modules                 |
| `src/global.css`        | Shared colors, typography defaults, reset, focus treatment                  |
| `electron/contracts.ts` | Small typed desktop API shared with the renderer                            |
| `electron/preload.cts`  | Exposes only app information and the folder picker                          |
| `electron/main.cts`     | Native window, dialogs, permissions, and app asset loading                  |
| `scripts/`              | Development, build, smoke verification, Windows folder packaging            |
| `docs/`                 | Product decisions, research, layout review, and staged implementation notes |

The renderer has no direct Node, filesystem, or shell access. Production assets use a local `app://virtual-cut/` origin restricted to the built renderer directory. New windows, external navigation, embedded webviews, and permission requests are denied. Development serves Vite on loopback only.

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

```powershell
npm run build
npm run lint
npm run format:check
npm run test:smoke
```

The Electron smoke test launches the actual app against production assets with an isolated profile. It checks the desktop bridge and security preferences, page/layout navigation, saved preferences and notes, folder-picker result handling, and compact-window layout. Folder-dialog responses are stubbed in the main process for repeatability; this does not exercise Windows dialog interaction.

Optional environment variables:

- `VIRTUAL_CUT_TEST_OUTPUT`: screenshot and test-profile directory.
- `VIRTUAL_CUT_TEST_EXECUTABLE`: path to a packaged `Virtual Cut.exe` to test instead of the development Electron runtime.
- `VIRTUAL_CUT_TEST_PROFILE`: explicit isolated profile directory; never use the normal app profile for tests.

For Connor's local runs, put test outputs and downloads on G:. Set process-scoped `TEMP`/`TMP` to `G:\GPT\Temp` for tools that use temporary storage. Normal app preferences remain in Electron's standard application-data location. Nothing here changes Windows-wide environment settings.

## Next build boundary

Review the [layout concepts](layout-concepts.md), then add a persistent project record and read-only media intake. Validate original-media playback and audio-track selection before building cutting/export. Preserve the established Footage Organizer review behavior when that page is implemented. The full roadmap and open media-engine checks remain in the planning documents; this shell does not establish their feasibility through testing.
