# Version 0.3.5 — dates and memory filmstrip

September 30, 2026. Implements Connor's latest Media screenshots and VC-42, plus the M220 save-status callout. M220, M221, M223 and M215 are accepted by Connor; M222's double-click seeking is accepted, with multiline marker notes carried forward separately. Export copying/timing and the outstanding high-speed playback recovery work are unchanged.

## Media dates and sort

Media cards show the registered source file's **Date modified**, with local date/time under the thumbnail title or to the right of a wide list title. Narrow lists wrap the date beneath the title. Hover identifies the date field and separately shows intake time. No capture date is inferred from names or filesystem metadata.

The shared thumbnail/list sort offers Date, Intake time and Name in both directions. Date oldest-first is the initial default; the preference survives page/app changes. Filtering and Ctrl+Up/Down follow the displayed order. Unknown dates/intake values sort last in either direction, with stable ties. Intake means first registration in this project, retained on duplicate imports and relinks. Older projects lack this new fact and explicitly say it was not recorded.

Media panels now reserve 520 CSS pixels for the viewer where the window permits, instead of 320. At compact widths this avoids transport/audio wrapping away the video height; saved preferred panel widths return when space permits.

## Filmstrip contract

- Full recording, zoomed ranges and Review clip bounds request tile-center source times, up to 32 tiles. Each resolves to the nearest indexed keyframe (earlier on an exact tie). This is a keyframe preview, not an exact still for every pixel/time on the timeline. Long keyframe gaps can produce repetition; hover shows the verified keyframe time and requested tile center.
- The native service validates registered source/project IDs and a bounded finite timestamp list. The renderer cannot provide file paths or arbitrary tool arguments.
- A single background FFmpeg decoder emits a scaled JPEG through stdout; no dynamic timeline image is written to disk. `-copyts`, absolute timestamp seeking, explicit original-clock selection and `showinfo` verify the decoded frame's actual PTS and keyframe flag. Nonzero-start inputs retain source-relative times. A wrong frame is rejected, never silently substituted.
- A 250 ms settling delay avoids work for intermediate pan/zoom sizes. Playback, reverse scanning, seeking and held gestures cancel/defer generation. The newest view replaces obsolete work. Requests do not block the project-edit IPC queue.
- The main-process LRU stores at most 96 compressed frames and 8 MiB of data-URL string storage, whichever limit is reached first. Renderer state contains at most one batch of 32 tiles; browser-decoded surfaces are additional memory. Source identity changes, unmount/release, recording/batch removal, relink, restore and project close clear native cached frames. Active tools are killed on cancellation, with an 8-second per-frame timeout and bounded output buffers.
- The stable Media-pool poster is separate: new imports now generate one cached poster instead of eight coarse filmstrip images. Existing legacy cache files remain untouched and their middle poster is reused. Audio/waveform caches are unchanged. Timeline zoom/pan produces no files.
- Sample/demo mode still uses its supplied static preview assets; the new pipeline applies to registered project media.

FFmpeg reference: [input seeking and timestamp options](https://ffmpeg.org/ffmpeg.html), [skip_frame codec option](https://ffmpeg.org/ffmpeg-codecs.html), [image2pipe](https://ffmpeg.org/ffmpeg-formats.html#image2_002c-image2pipe).

## Save confirmation

Saved appears only after an actual renderer-requested working-project save and disappears after 3.5 seconds. Polling the current snapshot does not retrigger it. Manual save made uses the same timeout. Unsaved changes, Saving and Not saved remain meaningful states. The status area reserves width to avoid moving header buttons. Immediate Undo also recognizes pending editorial edits; navigation remains outside Undo/Redo.

## Verification

All fixtures and media copies are under `G:\GPT\Work\virtual-cut\filmstrip`; originals are not used by these tests.

- `scripts/filmstrip-checks.mjs` (Electron Node mode after build): synthetic H.264 and a +5-second source clock; disposable 3840×2160 AV1 copy; exact keyframe PTS; cold/warm cache; rapid request replacement; active cancellation/recovery; changed-source invalidation; source hashes; no generated timeline images; memory eviction; native ID/time validation; single persistent poster; source Date modified and intake persistence/duplicate import.
- Evidence `native-xNI3r1`: 16 synthetic tiles 550 ms, four offset-source tiles 143 ms, 16 4K AV1 whole-view tiles 1,612 ms, 16 new zoom tiles 1,534 ms. Warm requests 0–1 ms. Stress reached 96 cache entries / 2,014,000 bytes, within both limits. These are local measurements on one copied AV1 recording, not a guarantee for every codec, source or storage device.
- `scripts/filmstrip-ui-checks.mjs`: real hidden Electron with disposable profile, dates/order/intake/name, keyboard navigation, data-URL tiles, zoom/source selection, scrubbing over tiles, deferral during playback, idle Saved/manual-save timeout and wide/compact screenshots. Development evidence `ui-y2ATjN` inspected.
- Existing review-fixes regression checks cover autosave, Undo/Redo, source actions, overlapping lanes, marker notes and immediate close/reopen. Packaged shell and final UI evidence are recorded in the Notion review guide.

### Release evidence

- Packaged filmstrip/date/save UI passed with Windows-only PATH and bundled tools: `G:\GPT\Work\virtual-cut\filmstrip\ui-T1f2i4`.
- Packaged desktop shell, preload isolation, navigation, preferences and compact-window checks passed: `G:\GPT\Work\virtual-cut\filmstrip\packaged-shell`.
- Autosave/Undo/viewer regression: `G:\GPT\Work\virtual-cut\playback-feedback\checks-bGJtCX`, including zero automatic writes during 33 seconds of continuous seeking. Native audio/import/cleanup and save recovery: `G:\GPT\Work\virtual-cut\m1-feedback\native-XDEyrc`. Both passed; source hashes stayed unchanged.
- Build/type checks, lint, changed-file formatting and diff checks passed. Stable sorting with unknown dates last was checked in both directions.
- App: `G:\GPT\Work\virtual-cut\filmstrip\builds\Virtual-Cut-0.3.5-win-x64-2026-09-30T22-03-12-297Z\Virtual Cut.exe`. Keep the folder together.

New user checks: M224 multiline notes (split from M222), M225 dates/sort, M226 keyframe filmstrip, M227 brief save message. Keep M212, M216, M217 and O01–O05 open. Automated passes do not tick those user review boxes.
