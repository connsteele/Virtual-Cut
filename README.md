# Virtual Cut

Virtual Legacy's Windows footage workspace for cutting, markup, review, organization, and Resolve handoff.

The desktop foundation and a single-video playback demo are implemented: an Electron app with React, TypeScript, Vite, **CSS Modules**, and npm. It includes three interactive layout concepts, bottom page navigation, a native folder picker, local scratch notes, and read-only playback of one selected video. Project import, editing, and agent features are planned for later build stages.

## Run the app

With Node 22.12+ installed:

```powershell
npm ci
npm run dev
```

For a standalone desktop folder, run `npm run package:win`, then open `Virtual Cut.exe` inside the generated `release/Virtual-Cut-...` directory. Keep the folder's files together.

Use **Layouts** in the app to compare **Studio**, **Library**, and **Focus**. Each keeps the Resolve-inspired bottom strip and shared Notes/Agent panel.

Use **Open video** to choose one completed recording. It opens paused in a 16:9 viewer, with seeking, volume, and speed controls. Selection lasts for this session; no project setup, copying, conversion, or source changes are required. Codec support depends on Electron's player; audio uses the default track and track selection comes later.

- [Foundation guide: architecture, commands, verification, and current limits](docs/foundation.md)
- [Layout concepts and review questions](docs/layout-concepts.md)

## Planning

- [Product flow, feature set, and staged build plan in Notion](https://app.notion.com/p/3ea7c5227a808000819af5c03bcfae3c)
- [Design decisions](docs/design-decisions.md)
- [Local transcription research](docs/research/local-transcription.md)
- [Spoken microphone cues: Mark, Cut, Note](docs/feature-requests/spoken-cues.md)
- [Deferred proxy feature request — GitHub issue #1](https://github.com/connsteele/Virtual-Cut/issues/1) ([local request](docs/feature-requests/proxies.md))

Planning documents describe the agreed direction and open validation work. The implemented scope is recorded separately in the foundation guide.
