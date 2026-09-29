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

**Current state: interactive desktop preview.** Playback and local draft editing work. Exporting clips, filing footage, Resolve handoff, Notion sync, and agent actions remain previews or simulations. Real project persistence and batch import come later.

The local test setup uses six complete 4K AV1 recordings with original audio. Private footage and preview images are excluded from this repository. On a fresh checkout, use **Open video**, or configure the local sample media described in the [workflow preview guide](docs/workflow-preview.md).

## Run the app

With Node 22.12+ installed:

```powershell
npm ci
npm run dev
```

For a standalone desktop folder, run `npm run package:win`, then open `Virtual Cut.exe` inside the generated `release/Virtual-Cut-...` directory. Keep the folder's files together.

The app launches maximized. Press **F11** or the fullscreen button to hide/show the window frame. The bottom page strip stays visible. **Preview options** in the upper right can reset sample edits or open the earlier Studio/Library/Focus foundation layouts.

Use **Open video** to choose one completed recording. It opens paused in the new viewer; try J/K/L, draft clips, markers, and capture intent. Local-video drafts last for this session. Sample edits and scratch notes are saved locally. Codec support depends on Electron's player; audio uses the default track and track selection comes later. Sources remain unchanged.

- [Foundation guide: architecture, commands, verification, and current limits](docs/foundation.md)
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
