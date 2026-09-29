# Workspace layout concepts

Open **Layouts** in the top bar to compare three arrangements. They share project selection, page navigation, and the Notes/Agent panel. Layout and last page are remembered on the device.

## Studio — recommended starting point

Sources on the left, a large viewer and future timeline in the center, and clip context on the right. Opening Notes or Agent replaces the context panel. On compact windows, that drawer hides the source rail to preserve working space.

Best for cutting, markers, and contextual review. Its tradeoff is the width occupied by persistent panels. Resizable panels can follow after choosing the preferred arrangement.

During playback, Studio sizes the center column to the width its available video height can use at 16:9. Surplus width expands the media pool and context/Notes/Agent panels equally. Compact windows retain the panels' baseline widths and fit the preview inside the remaining space. Footage is never cropped or stretched to fill a panel.

## Library — browse and review

A folder rail on the left, a broad collection area in the center, and preview/context on the right. A compact window prioritizes the collection and requested drawer.

Best for many clips and filing decisions. The smaller viewer is less suitable for precision cutting. Footage Organizer's actual review interactions will migrate later; this is a structural preview.

## Focus — watch and think

The viewer fills most of the window, with a shorter timeline beneath it. Permanent source/context panels are tucked away. Notes and Agent remain available from the top bar.

Best for watching scenes and sustained transcript review. Its tradeoff is reduced visibility of the batch.

## Shared decisions

- Supplied teal `#04635F`, neutral charcoal, and brighter teal `#71D7CD` for focus/small accents. White text on the brand fill is readable; dark teal alone is insufficient for small text on charcoal.
- Native Windows title bar, snap, and window controls initially.
- Media, Cut, Review, Library, and Selects in a persistent bottom strip with icons and labels. Page names remain reviewable.
- The current page name sits in the top bar between the app branding and project picker. There is no second page-heading row or page tagline. The Layouts button also shows the selected layout.
- Notes and Agent share a drawer on every page. Agent mode selection previews the concept and performs no model calls.
- CSS Modules and shared global variables follow **Develop Footage Organizer** preferences.
- Connor favors Studio generally and sees uses for the other layouts. Each page should eventually use a layout suited to its job, as in Resolve; final page assignments remain to be reviewed. The foundation's layout switch remains a global comparison control for now.
- Size the viewing area around predominantly 16:9 footage. The one-video demo fits a 16:9 frame to the available area, containing other aspect ratios without stretching or cropping.
- “Sources” means imported media/the media pool. The UI now calls the left panel Media pool; one preview file is session-only and is not a persistent import.
- Playback controls operate on the selected video. Future editing controls remain placeholders; no fabricated recordings or progress.

## Resolve Edit page reference — September 29, 2026

Connor spends 90% or more of his Resolve time on the Edit page. Use its source/viewer marker placement and compact centered transport controls as the next playback/markup reference.

Confirmed preferences:

- Put a thin source-position/marker strip immediately under the viewer, using small colored flag/pin shapes similar to Resolve. Keep it close to the footage and visually distinct from the future editing timeline.
- Place a compact transport group directly below that strip, centered under the viewer. Play, reverse/rewind, and fast-forward are priority functions. J/K/L is the primary interaction; buttons expose the same playback behavior.
- Support selectable marker colors within Virtual Cut. Preserving colors in Resolve is desirable; the existing embedded-chapter path's default-blue result is an acceptable initial fallback. Richer handoff can follow later.

Proposed interaction details:

- Click a marker to seek/select; show its title/time on hover and its complete text in Clip context. Keep labels available alongside color so color is not the only way to identify an item. Do not assign personal meanings to colors without Connor choosing them.
- Prefer Resolve's named marker palette for interoperability; keep brand teal for app controls. Save each marker's color in the project independently of export format limitations.
- Use J for reverse shuttle, K for pause, and L for forward shuttle, with repeated presses stepping through speeds and a visible direction/rate indicator. Start by validating 1x, 2x, and 4x; 8x is a later measured option. Match opposite-direction and held-key behavior to an explicit transport specification before implementation. Suppress shortcuts while typing or operating text fields.
- Keep source point markers, cut boundaries, and range selections distinct. A cut must not look like an ordinary marker just because both have a timestamp.

Engineering notes:

- `F:\Repos\losslesscut-embed-markers\README.md` records successful chapter-name/time transfer to Resolve 21.1 and explicitly excludes color transfer. This establishes the current path's limitation, not that all containers or future handoffs are limited to blue.
- The installed Blackmagic scripting API declares `MarkerColor` and `AddMarker(frameId, color, name, note, duration, customData)` on media-pool clips, timeline items, and timelines. A later explicit Resolve handoff could apply the chosen colors and richer notes using a companion metadata file. Validate clip identity, frame offsets, duplicate handling, embedded-marker reconciliation, and preservation of human changes before offering it.
- Reverse is a media-engine task as well as a shortcut task. The current HTML video player cannot be assumed to support negative playback rates; [MDN documents the limitation](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/playbackRate). Prototype and measure reverse on disposable 4K AV1 footage. If repeated seeking is used initially, describe and test it as reverse scanning; smooth reverse playback may need a decoding/frame-cache path. Do not make proxy generation a prerequisite or silently enable it.

Next priority: transport placement and J/K/L behavior, including a reverse feasibility check, then the marker strip and editable colored markers. These are recorded requirements, not newly implemented controls.

## LosslessCut reference — September 29, 2026

Connor highlighted five elements in a LosslessCut screenshot: the left batch list, clear range blocks and point markers below the viewer, keyframe-seek controls beside playback, the current-frame screenshot button, and the right-hand segments list. These complement the Resolve Edit page preferences above and the Footage Organizer Review direction below.

### Confirmed preferences and requested features

- **Keyframe seeking:** Provide direct previous/next keyframe navigation near the transport controls. Distinguish it from ordinary frame stepping and continuous J/K/L shuttle. Keep the existing outward keyframe-cut policy separate from the act of seeking.
- **Clear ranges and markers:** Use conspicuous colored blocks for clip ranges, visible start/end boundaries, and visually distinct point-marker pins/flags. The active item must remain obvious against the dark UI. Retain Resolve's convenient placement close beneath the viewer while taking LosslessCut's range clarity as the visual reference.
- **Capture current frame:** Add a dedicated screenshot/frame-capture button. This is an explicit feature request, not an implemented control in the current build.
- **Fast batch navigation:** Show actual recordings in a compact, readable list with a clear current-row selection. Allow rapid previous/next navigation by keyboard. Use Connor's previously chosen Ctrl + Shift + Up / Down bindings in the initial configurable preset.
- **Segments/annotation overview:** A concise list of planned clips and markers is useful for reviewing work and selecting an item. Use the screenshot as inspiration; copying its entire panel or command set is not required.

### Proposed behavior to carry into the combined design

- Synchronize selection between the source strip and the range/marker list. Use the same item color and identifying label in both. Show in/out and duration for a range, one timestamp for a point, and a short editable name. Expose which ranges are included in the export plan.
- Keep point markers and exported video clips distinct even when listed together. A point marker can travel as metadata on relevant retained clips; it does not become a zero-duration video export. Existing source-to-clip marker mapping remains necessary.
- Preserve each recording's playback position and draft ranges/markers when navigating the batch. Batch navigation must not clear unsaved intent or treat removal from a list as deletion from disk. Keyboard shortcuts must respect typing focus.
- Proposed frame-capture default: save the displayed source frame as a PNG at source resolution, with the clip name and source timestamp in its suggested filename. Capture footage pixels rather than application chrome; keep its source/time association. Destination, exact shortcut, overwrite handling, and decoded-frame accuracy will be settled with the implementation. No shortcut is assigned yet.
- Working Cut-page direction: batch list on the left; footage in the center; a readable source/range/marker strip directly underneath; compact centered transport plus adjacent keyframe controls; frame capture nearby; planned ranges and marker details in the right-side workspace. Review uses the folder-grouped card workflow below. Exact panel sizing and sharing space with Notes/Agent remain to be tested.

The common preference is quick visual orientation and low-friction navigation: which recording is open, which ranges are selected, where a marker lands, and what will be exported should be easy to identify without opening several dialogs. J/K/L remains the next playback priority. These additions are product requirements and design proposals; this update changes no app controls.

## Footage Organizer reference — September 29, 2026

Connor supplied four screenshots of the real project and batch workflow. The folder-grouped review cards are the preferred starting point for Review. The existing project/batch pages are too verbose; retain their structure and useful decisions while reducing persistent headings, instructions, and metadata.

### Confirmed preferences

- **Cards within destination folders:** Keep clips visibly grouped under the folder they are intended to enter. The hierarchy communicates the proposed organization before filing, and completed review should clear items from the active stack.
- **Expanded preview with adjacent markers:** Keep playback and marker tools together within the selected clip's review context. Preserve the predominantly 16:9 viewer and accessible marker names/timestamps.
- **Better-integrated details:** Improve how clip details relate to the card, preview, and decisions rather than carrying over the current separate Details panel unchanged.
- **Easier directory assignment and creation:** Make it straightforward to choose an existing destination or place a clip in a new folder within the existing project hierarchy. Dragging cards can remain available, but its current implementation is not sufficient as the primary workflow.
- **Projects contain batches:** Preserve this organization. A project's folder library and conventions are shared across batches; earlier decisions remain available. Reduce the verbosity of project/batch navigation and headers.
- **Primary home is Review:** Reuse suitable interactions elsewhere, while giving each page an arrangement suited to its work.

### Proposed Review arrangement and interactions

1. **Compact project and batch navigation.** Keep the page name and project switcher in the shared top bar. Add a compact batch selector and concise remaining/held/queued progress in the Review toolbar. Put long root paths, setup guidance, and less-used import/export actions in project settings or an overflow menu. Important errors and unsaved changes must remain visible.
2. **Folder groups as the main workspace.** Show the intended project-relative path and clip count on each group. Cards expose the proposed name, destination control, duration, and review/hold actions. Original names and agent reasons remain accessible; show comparisons when reviewing a changed value without permanently repeating every field on every card.
3. **Expand one clip in place.** Keep its heading and destination visible above a 16:9 preview. Place marker editing, capture intent, notes, and relevant agent reasoning beside the player, with technical metadata and history collapsed. Reuse the transport and marker components from Cut. Exact tabs/sections and their interaction with the global Notes/Agent drawer remain a prototype decision; avoid duplicate editors for the same value.
4. **Assign folders without dragging.** Clicking the card's destination opens a searchable hierarchy rooted in the project's footage folder. Show the full relative path for identically named folders. Support browsing and a recent-destinations shortcut. In the selected parent, provide **New folder here**: enter a name, preview the resulting path, and assign the clip in one flow. The proposed group then appears immediately. Support applying the destination to selected clips together. Dragging is an optional shortcut to visible groups; keyboard selection must provide an equivalent path.
5. **Keep planning separate from filing.** Choosing or creating a destination updates the saved plan; create the physical folder when filing. Preserve the existing review progression: Reviewed clears the clip from Remaining, eligible clips enter the move queue, and an explicit filing action applies verified changes. Held clips remain excluded; Filed reflects a completed operation. Make returning to a checked-off item easy. Changing reviewed names, destinations, or markers must invalidate the affected approval so stale decisions cannot silently enter a filing operation.

The Organizer README confirms that current check-off behavior already separates review from physical filing. Preserve original values, user notes, holds, and marker decisions while simplifying their presentation. Directory controls must validate Windows names and collisions and clearly distinguish an existing folder from a planned new one; avoid silently creating alternate project structures.

### How the three references combine

| Page | Working design direction |
| --- | --- |
| Media | Project/batch intake and recording inventory; reuse compact batch navigation and shared project context. |
| Cut | Studio viewer and timeline focus; Resolve transport/marker placement plus LosslessCut range clarity, keyframe controls, screenshots, and rapid batch navigation. |
| Review | Footage Organizer's destination-folder groups, clip cards, review progress, and expanded preview with adjacent markers; improve folder assignment and integrate details. |
| Library | Browse/search the filed collection; reuse folder navigation, clip previews, and contextual marker tools without forcing a pending-review queue onto browsing. |
| Selects | Later work; reuse playback and range tools, with layout driven by arranging selected footage. |

These are recorded preferences and proposed interactions. No Review page, persistent batch model, or folder picker has been implemented by this documentation update.

## Feedback for the next iteration

1. Does Studio leave enough room for the viewer at normal Windows scaling?
2. Should source collections remain visible while Notes/Agent is open?
3. Validate the working page assignments above using real footage and review batches.
4. Test the integrated card details and destination/new-folder flow, including multiple selected clips and keyboard navigation.
5. Is the timeline height appropriate, and which panels should be resizable?
