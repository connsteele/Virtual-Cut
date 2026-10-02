# Virtual Cut — design decisions

Updated: September 29, 2026

This is the planning record for Virtual Cut. Confirmed preferences are distinct from proposed implementation details. It does not indicate that these features have been implemented.

## Confirmed by Connor

- **Name:** Virtual Cut, a Virtual Legacy application.
- **Platform and editing destination:** Windows and DaVinci Resolve.
- **Product direction:** A single desktop application encompassing source footage, LosslessCut-style cutting and markup, agent review, human review, and organization. The existing Footage Organizer workflow is valued and should inform the Review page.
- **Desktop direction:** Package the full application in Electron while retaining the familiar React/TypeScript/HTML/CSS stack. Heavy media operations belong in native media workers such as FFmpeg.
- **Cut intent:** Test and implement an optional intent note attached to a cut. Preserve the user's wording and distinguish it from the agent's interpretation.
- **Agent modes:** Both copilot and full agent modes, available throughout the application's pages. Agent-produced clips enter human review.
- **Brand accent:** Use the supplied Virtual Legacy teal. The dominant sampled swatch color is **#04635F**, RGB **4, 99, 95**. The reference image is saved at `references/virtual-legacy-teal.png`.
- **Visible branding:** Use the app name Virtual Cut. Remove the Virtual Legacy name from the viewer, footer, and About dialog; keep the supplied teal palette. The approved logo is Film Edge round 3 D with **three holes on top and two on the bottom**. Preserve its narrow front blade, slimmer rear blade, overlapping tip, and transparent gaps around the film. Colors: ivory film `#EDE6D8`, front blade `#71D7CD`, rear blade `#489F96`. The application uses `src/assets/virtual-cut-logo.svg`; final exports are in `design/brand`.
- **Page navigation:** Adopt a persistent **bottom page navigation strip inspired by DaVinci Resolve**. Connor specifically selected the bottom strip used to move between pages. The supplied reference is saved at `references/resolve-bottom-page-strip.png`.
- **Layout direction:** Connor generally favors Studio, while Library and Focus may fit specific workflows. Give each page an arrangement suited to its job, as in Resolve. The working direction is Studio for Cut and folder-grouped cards with expanding previews for Review; exact panel sizing and visibility remain to be reviewed.
- **Viewer proportions:** Most footage will be 16:9. Optimize the viewing area around that ratio, while containing other aspect ratios without cropping or distortion. Sources refers to imported recordings/the media pool.
- **Workspace space:** Put the current page name in the main header to the left of the project picker; remove the extra heading row and page taglines. In Studio, use spare width beside a height-limited 16:9 viewer for the media pool and context panels.
- **Resolve Edit page inspiration — September 29, 2026:** Connor spends 90% or more of his Resolve time on Edit. Adopt a compact colored source-marker strip immediately below the viewer and centered transport buttons beneath it. Prioritize forward play, reverse/rewind, fast-forward, and keyboard-first J/K/L operation. Support marker colors locally; preserving them in Resolve is preferred, with default-blue embedded chapters acceptable initially. Richer Resolve handoff is later work; see `docs/layout-concepts.md` for verified current limitations and proposals.
- **LosslessCut inspiration — September 29, 2026:** Add previous/next keyframe seeking and a current-frame screenshot feature. Favor clear colored range blocks with visible boundaries, distinct point markers, a compact batch-file list with rapid hotkey navigation, and a useful overview of planned clips and markers. Use Ctrl + Up / Down to navigate the active page’s items (confirmed in the M1 feedback pass). The segments list is inspiration, not a required one-for-one copy; markers remain metadata rather than standalone video exports. Combine these with the Review preferences below. Detailed confirmed preferences and proposed frame-capture behavior are in `docs/layout-concepts.md`.
- **Footage Organizer inspiration — September 29, 2026:** Preserve clip cards grouped under their intended destination folders, the way checked-off clips clear from the active review stack, and marker tools beside an expanded video preview. Integrate details better and improve choosing existing destinations and creating new folders within the hierarchy; dragging cards is insufficient as the primary assignment method. These interactions mainly belong on Review and can inform other pages where useful.
- **Project/batch organization:** Retain projects with batches inside them, sharing the project's destination hierarchy and context. Make project and batch headers/navigation more compact and remove repetitive explanatory text. A searchable destination picker with inline new-folder creation and multi-clip assignment is proposed in `docs/layout-concepts.md`, not yet an approved or implemented interaction.
- **Model preference for this development conversation:** Astra should lead reasoning and research. The September 28 model audit found that earlier discussion and helpers used Sol; the audit response used GPT-6 Astra with Extra high reasoning. Use Astra for any future authorized research helpers. This records a development preference, not an already-implemented model configuration inside Virtual Cut.
- **Development storage:** Large task scratch files, test previews, downloads, and other engineering intermediates belong on G: in the approved work/temp locations. Original footage and final deliverables remain in their requested project destinations. Do not relocate app profiles or installations. The application's user-configurable proxy location has the more specific rule below.

## Confirmed cutting workflow and defaults

Connor supplied detailed answers and reference folders after the initial engineering questionnaire.

- **Capture:** OBS or ShadowPlay, both manual and DVR/replay recording. A play session often lasts an hour or more; recording is intermittent and individual files vary. A short manual recording may intentionally cover an entire scene; longer recordings may contain general gameplay. Treat these as contextual hints, not automatic editorial decisions.
- **Batch workflow:** Capture, cut and mark up batches, then name/file them within the video project before Resolve editing. The supplied `_Review` files have been cut/marked but have not completed agent/human review.
- **Automatic marker intake:** Automatically import recorded OBS chapters as **point markers at their start times**. Their chapter end timestamps do not instruct Virtual Cut to split recordings. A human or explicitly requested agent action can turn a point into a cut boundary or range.
- **Markers and ranges:** Keep point markers and exportable named ranges distinct. Support converting a point into a range using Alt-drag left/right or explicit timing fields. Shift-drag in Manipulate remains an alias. Preserve named source markers and cut intent as user context. Do not mistake container chapter duration for an intentional note range.
- **Playback:** Prioritize J/K/L navigation and scene identification. Connor reports fluid original 4K AV1 playback around 4x in existing apps; 8x can become choppy. This is the user's observed baseline, not a Virtual Cut benchmark. Thumbnail strips are useful for coarse recognition but are not the primary interaction.
- **Keyframe cuts:** Enabled by default, with an option to change behavior. Favor the nearest usable boundary outward: start at or before the chosen in-point, end at or after the chosen out-point, bounded by available source media. Connor already adds desired editorial padding; do not add a second arbitrary padding interval. Store requested and verified actual ranges separately. Adjacent exports may share boundary footage after outward snapping.
- **Audio intake:** Ask which track, if any, contains microphone notes. Audio track 1 is intended to contain game audio. Explicit track roles and audition controls are necessary; matching codecs do not identify content.
- **Audio monitoring:** Game audio by default; allow listening to either track or both together.
- **Audio export:** Export game audio only, as output audio track 1. Exclude microphone-note audio from exported clips. This supersedes the earlier suggestion to copy all original audio tracks. Verification must compare the retained streams against their intended sources and separately verify that excluded mic streams are absent. A microphone already mixed into the game track requires a clean recording track to meet this guarantee.
- **Microphone removal stage:** Remove microphone streams when creating the exported clip; a filing-stage remux may be used for already-cut imports. The original can retain its mic audio until explicit source cleanup. Export need not wait for transcription while that source remains available. Copy the original video and selected game-audio streams and verify the resulting file; do not silently rewrite the only original or treat a pure file move as an audio-removal operation.
- **Proxies — deferred feature:** Development is explicitly deferred and is not an initial-release requirement. Record a GitHub feature request with codec research as a prerequisite. Evaluate Connor's suggested DNxHR SQ and ProRes 422 alongside lighter alternatives before selecting profiles. Eventual preferences remain optional 1080p generation, disabled by default, with selectable placement and a `Virtual Cut Proxies` folder under the project's Video directory as the proposed default. Development/test scratch remains on G:.
- **Source retirement:** Let the user review verified clips and markers, then explicitly choose to delete sources. Exported library clips must remain usable after source removal. Keep source identity, range mappings, approved annotations, and provenance records after media deletion. Remaining source-dependent work must be resolved or clearly identified before retirement.
- **Microphone retention after source retirement:** Connor selected **transcripts/notes only**. Do not retain a separate microphone-audio archive. Complete and review wanted mic transcription before the original audio is removed; cleanup must account for temporary extracted mic audio and any proxies containing it. Deleting mic audio removes the ability to listen to it or retranscribe it later.
- **Chronological ordering:** Preserve the source-derived timestamp plus cut offset so earlier pieces of a recording sort before later pieces. Timestamp propagation is part of export verification and must survive subsequent marker publication and filing. See the inspection note for the exact current LosslessCut behavior.
- **Sorting destinations:** Connor uses Explorer's **Date** column and believes he uses **Date modified** in Resolve. These are now the UI acceptance targets. Generic Explorer Date is distinct from Date modified and needs a direct UI check; the shell metadata probe returned it blank for the inspected examples while Date modified and Media created were populated.

## Keyboard preferences

**Saving — September 30, 2026:** Connor approved compact saved state with session-only Undo, adjustable time-based autosave with a 10-minute default, and optional saving after edits. Manual Save remains immediate and preserves live Undo; reopen starts fresh Undo. Automatic saving waits for playback/seeking/manipulation to stop. Normal close saves. Crash recovery returns the last saved edit state, while source/job facts and export receipts remain independently durable. This supersedes prior continuous-edit saving and cross-session Undo. See `docs/save-policy.md`.

Provide configurable bindings and use Connor's familiar bindings in the initial preset:

| Action                                  | Preferred keys                                                            |
| --------------------------------------- | ------------------------------------------------------------------------- |
| Shuttle playback                        | J / K / L                                                                 |
| Split current range                     | S; B is LosslessCut's existing binding and may remain an alias            |
| Set selected clip in / out              | Q / W                                                                     |
| Create point marker                     | M                                                                         |
| Export                                  | E                                                                         |
| Delete current file workflow            | D, with configurable behavior; source deletion remains an explicit action |
| Previous / next item in the active page | Ctrl + Up / Down                                                          |
| Convert point to range                  | Alt-drag left/right; timing fields                                        |

The app uses R to rename the selected clip or marker; Backspace requests inline deletion, Enter confirms, and Escape cancels. Ctrl+S makes a manual checkpoint beside continuous saves. Selection follows playhead retains the last clip through gaps; direct marker clicks take priority. These shortcuts do not intercept text editing.

**Transport clarification — September 29, 2026:** K (the earlier J mention was a typo) and Space toggle Play/Pause. J retains silent reverse scan. L starts forward at 1× from pause, then accelerates to 2× and 4×. Play/Pause shares one button; the active transport command highlights teal. The player can loop the selected clip's current In/Out range. Audio listening choices, status, volume and waveform display form one right-aligned group. Media bins represent actual source folders; Review's folders remain planned destinations. Batch removal can preserve work or remove exclusive app records and derived previews with a recovery checkpoint; original recordings and shared work are retained.

Connor previously used Backspace in LosslessCut to remove a range endpoint after chapter import. Importing OBS markers directly as points removes that corrective step. The marker and clip card workflow now implements selection and typing-field guards.

## Transcript feature requested for exploration

- Searchable, timestamped game-dialogue transcripts, with click-to-seek navigation.
- **Local transcription is strongly preferred and is the default product direction.** No paid cloud speech service is required for transcription. Agent correction afterward is optional; its provider and any associated costs remain separate from the local speech engine.
- **Selected speech engine:** faster-whisper. Prototype with Whisper large-v3 and measure quality, source-time alignment, and resource use on representative recordings. Other speech engines remain fallback research rather than a required comparison before implementation.
- **No idle transcription model:** Start its worker only for an explicitly requested transcription operation, including a user-started batch or authorized agent workflow. Stop the worker and its children when transcription completes, is cancelled, fails, or the app exits. Pausing must also unload by ending the worker. Retain model files on disk for reuse, but no resident recognition process or model allocation while idle. Require crash cleanup and visible status confirmed by actual process exit. The proposed Windows Job Object design and unperformed acceptance checks are recorded in `research/local-transcription.md` in the repository.
- Separate microphone-note transcripts and game-dialogue transcripts so personal observations are not attributed to game characters.
- Game/project context and an editable glossary for character names, places, items, and other proper nouns.
- Agent assistance to identify likely recognition errors; preserve the original recognition output and make corrections reviewable. Game knowledge is a spelling/context aid, not permission to invent dialogue.
- Transcript spans, approved corrections, notes, and glossary terms should retain source timestamps and usable links to retained clips after export and source retirement.
- Both transcription location and mic-audio retention are settled: local recognition, and transcripts/notes only after source retirement. Agent correction may run later on the stored text without preserving mic audio.

## Spoken microphone cues

**Uncued speech — confirmed September 29, 2026:** Microphone speech without a deliberate Mark/Note/Cut cue generally explains why Connor is recording. Retain it as timestamped recording context and use it as evidence for proposed names, organization, and capture intent. Keep the original transcript and optional corrected/searchable versions. Context is not an automatic point marker, cut, or Notion publication. Preserve relevant links through subclips, and do not reclassify a continuation of an explicit note merely because the speaker paused.

Connor requested three cues: **Mark** turns the following spoken thought into a point marker; **Cut** identifies a split point; **Note** captures a thought associated with a clip and timecode, likely for Notion. Preserve the original recognized text for Mark and Note, with separate optional agent passes for context correction and for a shorter or more structured, searchable version.

The [spoken-cue feature plan](feature-requests/spoken-cues.md) records these meanings and proposed timing, detection, review, clip-linking, and staged implementation behavior. Detection from recorded mic audio belongs after an explicitly started transcription job; it does not require an always-running listener. Timing defaults and handling of pauses or ambiguous command words still need validation on sample recordings. This feature is not yet implemented.

## Timeline interaction correction — 0.3.20

Connor approved separate selection, editing and seeking. Single-click marker/clip selects; double-click seeks to start. Mouse scrubbing begins only on the dedicated ruler or filmstrip/waveform surface. Empty edit lanes deselect. Manipulate dragging and keyboard retiming leave the playhead fixed, making it a useful snap reference. Points are circles and range endpoints are split circles while H is enabled, including Alt-drag conversion. H off uses pointed shapes. The dedicated ruler has adaptive labels; Position accepts elapsed seconds or HH:MM:SS.mmm with Enter/Escape. No timecode overlay/replace mode is introduced. This supersedes the earlier edit-preview-follow behavior.

## Current proposals, awaiting further UI discussion

- Neutral charcoal surfaces with the supplied teal for primary accents; lighter related tones where small controls require greater contrast.
- Bottom page controls with icons and readable labels, a clear active state, and an application-wide position.
- Candidate workspaces: Media, Cut, Review, Library, Selects, plus a project Home entry. The final page lineup and order are not settled.
- Switching pages should preserve the open project, drafts, selections, and playback positions where relevant. Background export/agent jobs continue and retain visible status.
- A persistent, collapsible agent panel and contextual notes panel across pages.
- Source recordings, selected cut ranges, verified exported ranges, markers, intent, and review decisions should share stable project records.

## Open engineering validation

- Reproduce the current timestamp propagation and verify actual sorting in Explorer Date and the user's Resolve column. Preserve timestamp provenance and distinguish inferred capture chronology from compatibility file dates.
- Validate the selected faster-whisper engine on real game and mic audio, including silence, proper nouns, long recordings, and useful seek positions. Measure model loading and GPU competition with playback. Add an alignment stage only if timestamp quality requires it. Verify worker teardown on normal completion, cancellation, failure, app exit, and forced app termination before claiming no idle recognition resources.
- Keep original recognized text alongside accepted corrections. Preserve source/clip links when corrections change tokenization. A glossary can improve names; uncertain or unheard dialogue must not be manufactured. Unvoiced on-screen dialogue requires separate screen-text extraction if added later.
- Do not require a cloud account to obtain or search a local transcript. Optional agent correction is a separate action; this preference does not configure or authorize paid model calls by itself.
- Proxy development and codec selection are deferred to [GitHub issue #1](https://github.com/connsteele/Virtual-Cut/issues/1).

## Repository

The application repository is `F:\Repos\Virtual-Cut` with remote `https://github.com/connsteele/Virtual-Cut.git`. The current decisions are also stored under `docs/design-decisions.md` there; local-transcription research and a local copy of the published deferred proxy request accompany them. No implementation or model benchmark is claimed by these planning documents.

## Engineering proof still required

The inspected reference batch has 44 raw recordings and 47 exports, all 3840x2160 AV1 at 60 fps with two stereo FLAC audio streams. Raw durations range from about 1.92 to 385.08 seconds, so this batch does not establish performance with hour-long individual recordings. Detailed findings are in `MEDIA_INSPECTION.md`.

Test original-media opening, sustained playback and 4x shuttle against Connor's current experience, random seeking, frame navigation, independent/mixed track audition, outward keyframe boundaries, point-marker intake, marker transfer into Resolve, game-only export, chronological date propagation, and interruption recovery. Include adjacent/overlapping ranges and source removal after review. Add an hour-long representative source when available. Measure preview/original time and frame correspondence if a proxy is used. This inspection did not run playback, cutting, or deletion tests.

## Manipulation snapping — October 1, 2026

Connor requested optional snapping to the playhead for dragged clip edges, range endpoints and marker positions. Snap starts enabled and remembers the local setting. Capture the frame-aligned playhead at gesture start; retiming leaves it stationary (0.3.20). Use a ten-screen-pixel threshold across zoom levels. Whole-range movement may align the nearer endpoint while preserving duration. Source bounds and positive ranges take precedence over snapping. A teal guide confirms alignment; normal seeking, numeric editing and keyboard frame nudges are unaffected. Alt-drag converts a point to a range even outside Manipulate. Keep range endpoints in their normal split shape, with a thin centered translucent band and no inline title or pointer-selection outline; retain accessible names, hover information and keyboard focus.

## Readout and scrub snapping — 0.3.21

Position offers remembered elapsed time and zero-based frame numbers. Indexed frame timestamps take precedence for VFR; nominal-FPS fallback is labelled estimated. Mode changes do not seek. Numeric entry remains direct. With Snap on, ruler/filmstrip dragging aligns to the nearest visible point marker, range endpoint or shown clip endpoint within ten screen pixels. This applies with H on or off and does not edit annotations or create Undo. Out-of-view boundaries are ineligible; equal-distance targets prefer earlier time. A guide clears on release/cancel.

## VC-26 follow-up — 0.3.22

Manipulation also snaps to peer point/range/clip boundaries, excluding the dragged annotation and freezing targets for the gesture. Range End can be removed without losing Start or metadata. Review must identify trimming relative to the whole source even when name, folder and markers are unchanged, and its tree starts visible.

The Resolve helper offers a whole-Media-Pool companion scan and retains selected-only checking. It traverses Resolve bins and tests adjacent companion paths; it never recursively scans disk folders. Only matched supported exports incur full identity verification. A batch manifest remains an alternative if actual discovery becomes a bottleneck.

Connor explicitly requires that project cleanup **never delete full exports**. Preserve completed videos and companion metadata permanently across both deletion choices, as well as source footage. Cleanup may remove verified same-project save copies and known disposable previews only. Present the exact file list; retain shared, linked, changed, unknown or unproven files. Never recursively delete the user-selected cache/destination directory. A currently open project is saved and closed before inspection; Cancel deletes nothing and leaves it closed. Settings, helper installations and shared diagnostics are outside project cleanup.

## Storage visibility — 0.3.23

Connor requested expandable cleanup categories with counts and storage usage below Preview cache. Group repeated types, show single entries directly, and explain retained-file reasons. A valid retained save may recover its checkpoint after deleting the main project; unverified or pending saves have no recovery guarantee.

Measure only the active project when Projects opens or the user explicitly refreshes. No polling, video decoding/hashing, autosave or arbitrary media-tree scans. Show saves by kind, preview types, delivered videos/companions, and separately referenced sources; deduplicate paths/aliases and expose missing/skipped locations. Counts describe measured files, not exclusive cleanup ownership. Preserve all completed exports. Closed checkpoint reads avoid incidental SQLite support files; recovery of a live project still includes concurrent committed work.
