# UI iteration 03 — feedback and implementation

September 29, 2026. Captured after Connor tried the six full-resolution videos in the Electron workflow preview. Connor subsequently authorized this iteration. The implementation covers the shared player, selected-clip editing, Cut/Media layouts, Review, and the grouped Library graph. These remain draft UI operations, with no source-file modifications.

**Later clarification:** Connor meant FFXVI's **State of the Realm** character map more than Active Time Lore. Further inspiration from either system is deferred until he has tried this graph. The ATL analysis below is historical research, not an instruction to implement contextual panels in this pass.

**Follow-up reference research:** Connor supplied a video of The Grand Cast and authorized downloading it for analysis. [The visual findings and proposed adaptations](research/state-of-the-realm-grand-cast.md) are recorded separately for the next design discussion; they do not alter this iteration's implemented scope.

## Graph and glossary

Confirmed direction from the folder-card mockup:

- Show the focused node within its containing folder/group, with a visual and its name.
- Draw connections to related nodes grouped within their folders. Groups can contain nodes directly or nested groups, as with Mechanics → Combat / Unique.
- Use the available horizontal space. Show the four most relevant connections to the focused node per group initially; allow expansion and alternate sorting.
- Give nodes useful visual identities, with improved folder-card styling consistent with Virtual Cut.
- **Inspiration clarified:** State of the Realm is the intended character-map reference. Discuss specific adaptations after this iteration; no story-versioning or additional contextual lore panels now.
- **Graph organization confirmed:** use concept groups linked to footage folders. Characters → Cai and Mechanics → Combat → Blaze Arts organize glossary concepts independently of physical storage. Changing graph membership does not move source files.

Proposed behavior, pending feedback:

- Selecting a related entry makes it the focus; Back and a short navigation trail preserve the route through the graph. A details area exposes the entry's definition, relationships, notes and linked footage.
- Offer a contextual glossary panel from Cut and Review with entries linked to the current clip or marker. This uses explicit project links without requiring an agent on every seek.
- Rank the initial four using explicit relationships to the focus and shared linked footage/markers, with a visible explanation and stable ordering. Allow pinning and name/connection-count sorting. Do not silently equate global popularity with relevance.
- Use assigned portraits, uploaded images or captured frames for entries; footage nodes use their chosen thumbnails. Image selection remains user-editable.
- Start with contextual visual cards and shared glossary entries. Revisit story-progress versions only if a later workflow calls for them.

Reference: Square Enix's GDC presentation, [Designing Active Time Lore for Final Fantasy XVI](https://gdcvault.com/play/1034418/Designing-Active-Time-Lore-for), describes presenting lore relevant to the player's current moment.

## Active Time Lore analysis and application

Official descriptions emphasize a short list of relevant entries, concise explanations and access during the current scene. PlayStation's [developer interview](https://blog.playstation.com/2023/05/22/how-square-enix-built-final-fantasy-xvis-fantastical-believable-lived-in-world/) describes context-sensitive characters, factions and nations; its [hands-on report with developer comments](https://blog.playstation.com/2023/02/28/hands-on-with-final-fantasy-xvi-new-gameplay-details/) describes on-demand access during a scene. The GDC session above identifies understanding the current moment as the design goal.

Recommended translation to Virtual Cut (design proposals):

1. **Context near the footage:** an on-demand panel in Cut and Review shows a compact set of glossary entries explicitly linked to the current clip, selected marker or annotated interval. It preserves playback position and editing state.
2. **Recognizable, concise cards:** portrait/image, name, kind and a brief summary first; definitions, aliases, related entries and linked notes expand when needed.
3. **Useful evidence:** each entry exposes relevant clips and timestamped markers, with an explanation such as 'linked to this marker' or 'appears in this clip.' Selecting evidence opens the corresponding footage position.
4. **One shared glossary:** the context panel, Library glossary and grouped graph use the same entry IDs. 'Explore connections' opens that entry in the graph; Back returns to the footage context.
5. **Stable while reading:** pin an entry; avoid automatically replacing an open detail card as playback advances. Context relevance initially comes from saved user links and reviewed metadata. Agent suggestions can be reviewed separately later.
6. **Project knowledge over story simulation:** collect the definitions and editing observations useful to this project. Act/chapter filters can help find footage later; maintaining multiple spoiler-aware lore versions is not necessary for this UI pass.

Example: a Cai/Peter support clip exposes their cards; Cai's card opens grouped links to friends, Dagsion and Blaze Arts. Blaze Arts then offers linked Cai and Leda footage and notes. These relationships should remain inspectable and editable.

## Shared timeline, playback and navigation

Confirmed:

- Clicking and dragging anywhere on the timeline should move the playhead immediately and scrub continuously, including when starting away from the current playhead. Timeline images must not start browser image drags.
- Filmstrip thumbnails must show the complete frame. The existing very wide, vertically cropped images are unsuitable.
- Put Resolve-like marker flags in a dedicated lane above the filmstrip. They must remain visually distinct from frame images.
- Put the category legend above that marker lane, using square color swatches. The legend can be hidden independently.
- Keep keyframe-step controls adjacent to frame-step controls on each side of playback.
- Provide hover tooltips for every transport action, including boundary-jump controls.
- Boundary navigation should visit clip starts and ends in the current recording instead of jumping directly to the recording's start/end.
- J/K/L controls playback of the active viewer. Move the hint out of the batch list and label it as playback rather than Shuttle.
- Repair Ctrl+Shift+Up/Down batch navigation, including after scrubbing and interacting with viewer controls.

Implementation findings from code inspection (not yet a full reproduction):

- Player.tsx contains both a custom timeline and an almost transparent native range input over part of it. Workflow.module.css makes that input mostly opaque on `:focus-visible`. This explains the extra slider pictured after keyboard interaction.
- Workbench's key handler excludes every input, including that seek slider. Editing and batch shortcuts can therefore stop responding after the slider takes focus. Text fields must still retain normal typing behavior.
- Filmstrip images use `object-fit: cover`, filling only four highly stretched slots, and retain default image drag behavior. The track supports a click handler but not a unified pointer-drag gesture.
- Start/end transport commands currently use the player bounds; in Cut these are the entire recording. Several transport buttons have accessible labels without hover titles.

Proposed implementation: one pointer-captured scrubbing surface and one keyboard-accessible timeline, consistent shortcut ownership, complete 16:9 thumbnail tiles, and a shared marker lane. A keyboard focus indicator must never appear as a second playback timeline. Preserve source-relative positions and marker timing.

## Cutting and Cut page

Confirmed:

- Use Q for in, W for out, S for split. Remove I/O bindings and labels.
- Splitting should divide a clip at the playhead; trimming should change its bounds. Fix the focus/slider issue rather than presenting another timeline.
- Add clip deletion with nearby confirmation, like marker deletion.
- Remove per-clip include/export checkboxes. The retained clip list represents what the user wants to keep.
- Add an obvious way to rename a clip on Cut.
- Give batch cards more width and larger images in thumbnail mode. Keep the video centered and retain useful timeline width. Compact list mode can remain narrower.

**Selection behavior confirmed:** Q/W/S operate on the selected clip. Provide a **Selection follows playhead** toggle, inspired by Resolve. When enabled, the clip beneath the playhead becomes selected. When disabled, scrubbing retains explicit selection and the user needs a direct way to choose a clip.

Proposed details for the next prototype:

- Clicking a clip block or its Clips-panel card selects it; use matching strong outlines in both places. Keep text editing and selection distinct.
- Default Selection follows playhead to on, with a visible toggle and saved preference. This default is a proposal; both modes are required.
- Keep timeline scrubbing usable with either setting. Q/W/S must consistently use the selected clip instead of S applying a separate first-match search.
- Split requires the playhead inside the selected clip. Invalid commands should give concise feedback without switching the selection behind the user's back.
- Resolve gaps, exact shared boundaries and overlapping ranges deterministically. Text fields keep ordinary typing; viewer/seek focus must not swallow editing shortcuts.

Proposed boundary buttons: previous/next chronological clip boundary, skipping a duplicate timestamp where adjacent clips meet. In Review, boundaries are those of the clip being reviewed. Tooltips should describe the scope.

Deletion removes the draft clip, not source media. Its linked annotations and source timestamps must not be accidentally discarded. Existing source keyframe/export timing decisions remain in force; UI behavior changes are not an implementation of lossless export.

## Media

- Reorient thumbnail and list browsing to use horizontal screen space and restore viewer height.
- Try a two-column thumbnail browser beside the viewer, with folder navigation to its left. Use the same browser region for list view. Keep recording context collapsible or in the side inspector.
- Replace the current wide, largely empty browser band above the viewer.

## Review

Confirmed:

- Restore concise per-card indications of work to review: name changes, folder/move changes, pending markers, and questions.
- Keep inline expanding previews and adjacent marker tools. Preserve the clean expansion and automatic visibility assistance.
- Remove the large clip-range bar from the Review viewer. Retain the complete-frame filmstrip, marker lane and compact transport.
- Reduce unused space around the viewer by sizing the preview and adjacent details together for the available height/width.
- Use the tree folder navigator; remove the alternate flat list navigator.
- Give held cards a muted yellow/amber background and a visible hold reason.
- Rename Filed to Done. Order filters as Remaining, Held, Queue, Done, All.
- Held clips also belong in Remaining and remain excluded from Queue until released and accepted.

Footage Organizer code was checked: ClipRow.tsx derives Rename / Move / Rename + move / Update markers from proposed versus current values, shows pending marker counts, and exposes review questions. Its Review.tsx keeps unreviewed held items in Remaining. Transfer that useful information without restoring its verbose page chrome.

Proposals:

- Make status chips actionable so Name, Destination or Markers opens the relevant part of Details.
- Derive chips from actual outstanding changes, not from the mere presence of markers or a name.
- Hold opens a nearby reason control with quick reasons and optional free text; retain a fast hold action. Display the saved reason on the collapsed card.
- Done remains a completed-operation state, with simulation clearly identified in the current preview. Accept still sends eligible clips to Queue.

## Selects

Defer further Selects development until the main Cut, Media, Review and Library workflows are in place. Preserve the current prototype; do not extend Resolve handoff or string-out features in this iteration.

## Proposed implementation order

1. Repair shared timeline gestures, focus, shortcuts and cutting actions.
2. Introduce the complete-frame filmstrip, marker lane, legend, transport ordering/tooltips and boundary navigation.
3. Add Cut clip rename/delete and responsive batch sizing; rework Media horizontally.
4. Restore Review change summaries, hold reasons, filters/tree and compact viewer.
5. Prototype the folder-grouped graph linked to the existing glossary, with Cai, friends, Castor, Centurio, Bertrand, Dagsion and Blaze Arts. Defer the proposed contextual glossary panel.

## Clarification status

1. **Answered:** concept groups linked to footage folders.
2. **Answered:** Q/W/S affect the selected clip. Add explicit selection and a Selection follows playhead toggle.
3. **Answered and corrected:** State of the Realm is the intended inspiration. Further discussion is deferred. No story-versioning requirement.

## Implemented in this pass

### Overlap follow-up

Overlapping clips now use separate compact timeline rows, stable translucent colors and a hatched shared region. Selected clips retain their full visible extents, bright outline and end caps. Matching swatches connect the timeline to the Clips panel. Selection never changes row placement; adjacent clips can share a row. Partial, nested and identical overlaps were verified in actual Electron at wide and compact sizes, along with selection and scrubbing. Existing draft timing and saved edits are unchanged.

### Initial iteration

- A single pointer-captured scrub surface replaces the invisible native seek slider. Full-frame thumbnails, separate marker flags, a hideable color key, adjacent frame/keyframe steps, and clip-boundary navigation are shared between pages.
- Q/W/S use the selected clip. Explicit card/timeline selection, persistent Selection follows playhead, direct names, and confirmed deletion are available. All retained clips appear in the export plan.
- Wider Cut thumbnails; horizontal Media layout with two-column thumbnails or a list beside the player.
- Review derives Name/Move/Markers indicators from original versus draft values, shows amber held cards with editable reasons, includes held clips in Remaining, and uses Remaining/Held/Queue/Done/All. The folder picker is a searchable tree. Inline previews keep the shared marker strip without the Cut clip bar.
- Library uses connected folder cards, nested concept groups, four entries initially per leaf group, expansion, relevance/name/connections sorting, Back navigation and editable glossary images/groups. Ranking is deterministic: direct relationships first, then shared neighboring links. Images are footage references; custom portrait uploads, pinned graph nodes and a visual navigation trail remain future refinements.
- Existing saved sample edits are migrated without resetting them. No ATL panel, Selects extension, production export, or external integration was added.
