# Desktop workflow preview

September 29, 2026: UI iteration 03 updates the native React workspace inside the Electron app, using CSS Modules. It opens maximized; F11 toggles fullscreen. It is a UI feedback build, with a shared editable sample model instead of a project database.

## Try the pages

| Page    | Working interactions                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Media   | Switch recordings, two-column thumbnail/list browser beside the viewer, destination-based sample bins, recording context, open selection in Cut.                                                                                                                                                                                                                                                                                                            |
| Cut     | Full-frame thumbnail strip with flags above it and a hideable color key; J/K/L playback; drag anywhere to scrub; sample frame/keyframe steps; current-frame capture and session thumbnail; per-recording clips/markers; selected-clip Q/W bounds and S split; Selection follows playhead toggle; rename and delete clips; M marker; category and glossary links; nearby delete confirmation; hide/show batch thumbnails; Ctrl+Shift+Up/Down for recordings. |
| Review  | Folder-grouped cards; Details expands the inline viewer and marker tools; expansion animation and scroll assistance; rename and notes; Accept/Hold; Remaining/Held/Queue/Done filters; pending-change chips; amber held cards with reasons; tree folder picker, new draft folder, bulk destination assignment; simulated filing. Editing reviewed content clears its acceptance.                                                                            |
| Library | Clips, glossary, and connections; search aliases and marker names; editable definitions and links; Cai, friends, Castor, Centurio, Bertrand, Dagsion and Blaze Arts examples; nested folder graph with images, top-four expansion, sorting and Back; columns and topics; jump from markers to footage; local notes with reference-only Notion URLs.                                                                                                         |
| Selects | Add clips or a batch, reorder by buttons or drag, edit source bounds, handles, play a sequence, source ordering, selects/string-out modes; simulated create/append to a named Resolve timeline with exact-range duplicate checks.                                                                                                                                                                                                                           |

Notes and the proposed Copilot/Agent panel are available from every page. Agent requests are previews: no provider is connected and no local model starts.

## What persists

- Sample clip decisions, marker edits, glossary/graph changes, linked sample notes, sequence entries, and simulated timeline contents are stored in the app's local preview state.
- The scratchpad remains shared with the earlier foundation layouts.
- One real recording can be opened through the native picker. Its access URL, clips, markers, context, and frame captures are **session only**. Opening another local video replaces that session recording.
- Captured thumbnails are session only. They are not stored as large images in browser preferences.
- Preview options → Reset sample changes restores the initial sample. Scratch notes are retained.

No source files, timestamps, directory structure, Resolve projects, or Notion pages are modified. A chosen project directory is a session location only. Nothing scans that folder or imports a production project yet.

## Playback and current boundaries

The demo now uses six complete **3840 × 2160 AV1** recordings with their original audio, copied unchanged to G: for testing. Three come from Supports and the other three come from separate folders:

| Folder                   | Clip                                                | Duration |
| ------------------------ | --------------------------------------------------- | -------- |
| Supports                 | Cai × Peter C                                       | 2:46     |
| Supports                 | Cai × Tialla C                                      | 2:08     |
| Supports                 | Peter × Tialla C                                    | 1:53     |
| Mechanics/Blaze Arts     | Cai unlocks Blaze Arts                              | 1:05     |
| General Gameplay/Dagsion | Cai explores limited early Dagison city access      | 0:24     |
| Narrative/Act 1/Cai      | Cai, Castor and Centurio discuss Cai and their past | 3:04     |

Together these provide about 11 minutes 25 seconds of footage. Durations, frame rates, keyframe timestamps and embedded chapter points were measured from the copied files. Initial clips cover each whole file; imported chapter markers remain points. No synthetic marker titles or old excerpt offsets are carried across. The default audio track plays normally. The videos were neither resized nor re-encoded.

Local recording frame/keyframe buttons remain disabled until source probing is implemented. Native forward playback supports 1×, 2×, and 4× shuttle; reverse is a seek-based scan, not smooth reverse audio/video decoding. Timeline trimming edits a draft only; actual lossless/keyframe export is not implemented.

Timeline thumbnails are sampled scene references, not a frame-accurate thumbnail for every seek position. Graph concept images are editable footage references; portrait upload and State of the Realm-inspired refinements are deferred.

Current-frame capture opens an image preview and can set a session thumbnail. File saving, native clipboard export, alternate audio tracks, waveform generation, transcription, batch import, proxy generation, and persisted real projects remain later work. Library footage references are still images from the referenced files, not grants to open arbitrary paths. Resolve collection proposals and timeline handoffs are explicitly simulated.

Demo timestamps are relative to each complete copied clip. This is not yet the production timestamp/export preservation implementation.

## Code and local assets

- `src/workflow/model.ts`: sample entities, explicit links, persistence, and review invalidation.
- `src/workflow/Workbench.tsx`: page composition and selected-clip draft actions.
- `src/workflow/Timeline.tsx`: pointer-captured scrubbing, complete frames, marker flags and clip selection.
- `src/workflow/FolderGraph.tsx`: grouped and nested concept exploration, ranking and expansion.
- `src/workflow/ReviewSignals.tsx`: pending-change summaries and hold reasons.
- `src/workflow/Player.tsx`: shared viewer, transport, timeline, and capture.
- `src/workflow/Library.tsx`: glossary and graph views.
- `src/workflow/Workflow.module.css`: desktop page layouts.
- `src/App.tsx`: switches between workflow preview and preserved foundation layouts.

The renderer still has no Node/filesystem/shell access. Fullscreen uses a trusted, typed IPC command. Media uses bounded byte-range responses. The six demo files use a separate native allowlist; picker-selected media remains limited to one opaque URL and does not revoke the demo files. Screenshot canvas access is permitted only for the app and its configured local development origin.

Private media is intentionally excluded from Git. Small poster/filmstrip/reference JPGs remain under `public/demo/`. Full-resolution videos stay at `G:\GPT\Work\virtual-cut\full-resolution-demo\videos` (about 1.3 GiB) and are not repeatedly copied into build outputs. The ignored `demo-media.local.json` records their root and six filenames. Packaging copies this native configuration, so this local preview build requires that G: folder to remain available. No personal absolute paths are included in the tracked application code. On a new checkout, supply that local manifest and preview images, or use Open video.

`src/workflow/demo-recordings.json` holds the measured demo metadata. `electron/demo-media.cts` validates the local allowlist and serves only its explicitly selected files. The new preview state key is `virtual-cut.workflow-preview.full-resolution.v1`; the previous excerpt demo state is retained separately to avoid applying its annotations to different footage. Scratchpad notes are unchanged.

## Verification

Viewer spacing follow-up: elapsed/duration and source time sit to the left of the centered transport, with playback status and volume on the right in one compact row. Narrow viewers wrap into two tidy rows. The permanent J/K/L reminder is now a status tooltip; the shortcuts and transport tooltips remain available.

Verified the packaged spacing update in Cut, Media and Review at wide and compact sizes, plus intermediate widths around the wrap threshold. Checked readout/control bounds, centered transport, keyboard focus, J/K/L playback and volume. The wide playback bar is 38 CSS pixels tall. Build and lint passed; captures and measurements are under `G:\GPT\Work\virtual-cut\viewer-spacing`.

Overlap follow-up: intersecting clips occupy separate compact rows, with translucent identity colors matched to the Clips panel. Shared time spans have subtle hatching. The selected clip has a bright full-range outline and end caps; selection does not rearrange rows. Touching or separated clips share a row. Colors persist across renaming and timing edits without changing stored clip data. `src/workflow/clipLayout.ts` supplies the interval layout and colors.

Build, lint and `node scripts/overlap-checks.mjs` passed. The focused Electron check covers partial, contained, identical and touching ranges; unobstructed start/end extents; pointer and keyboard selection; stable colors; scrubbing; and wide/compact layouts. Evidence and disposable profiles are under `G:\GPT\Work\virtual-cut\overlaps`. Existing saved edits are retained.

Iteration 03 verification: build and lint passed. The packaged workflow check played all six full-resolution files, then exercised pointer scrubbing followed by Q/W/S, selection with follow disabled, clip boundaries, rename/delete confirmation, batch navigation after scrubbing, marker lanes, held reasons, pending-name review, top-four graph expansion/sorting/Back, and migration of an existing draft. The existing Review/Library/Selects/persistence/local-video regression also passed. Final layout checks covered all five pages at 2560×1440 and 1100×720, plus the full expanded Review viewer and transport. Hidden-window layout checks use reduced motion so suspended native smooth scrolling does not affect geometry assertions; expansion animation remains enabled for ordinary use. Screenshots and disposable profiles are under `G:\GPT\Work\virtual-cut\iteration-03`.

`npm run test:workflow` launches actual Electron with a disposable profile on G:, exercises the sample workflow and local playback, and saves wide/compact screenshots. It checks marker confirmation, review queue transitions and destination planning, glossary aliases/links, duplicate handling, restart persistence, source-file preservation, frame capture, and fullscreen IPC. `npm run test:smoke` retains the foundation-layout regression checks. `npm run test:media` checks byte ranges, revocation, the canvas origin boundary, and native demo allowlist access. The workflow check verifies decoding, seeking and playback of all six full-resolution copies. Native file picker results are stubbed for repeatability.

The preview model is deliberately separate from future production project storage. The next build boundary is a persistent real project/media record and source probing, followed by cutting/export and review/file operations.

September 29 verification: build, lint, formatting, native foundation smoke, media-access tests, and packaged workflow smoke passed. Inspected wide and compact page captures. The packaged workflow check also exercised sequence advancement, 3840 × 2160 AV1 playback/frame capture from a disposable fixture, session-only drafts, and unchanged fixture bytes. A final packaged check confirmed that an expanded Review card and its viewer are fully within the scroll viewport. No original project footage was modified. This remains a short playback check, not a sustained-performance benchmark.

Full-resolution demo verification: all six complete 4K AV1 copies decoded, sought and played in the packaged app. Their copy hashes match the original files. Native allowlist tests, foundation smoke, build, lint and formatting passed. The updated workflow check passed across all five pages at wide and compact sizes, including measured keyframe stepping, chapter-point editing, sequence advancement, frame capture and opening a separate video without losing demo access. Automated playback was muted. This checks functionality, not sustained performance or audible quality.
