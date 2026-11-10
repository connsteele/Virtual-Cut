# Changelog

Version history for Virtual Cut, newest first. Entries were moved verbatim from the README on October 3, 2026; each version's detailed review notes, evidence and manual-acceptance status remain in `docs/review-<version>.md` and the milestone documents linked below. Builds are unsigned portable Windows folders.

## 0.4.30 — Work from the first batch: clips, clip colors, agent edits and faster scrubbing (November 10, 2026)

Sprint 14, the first of M5, acts on Connor's first real batch. Importing a recording no longer makes
a whole-recording clip; every clip is cut on purpose, and Cut offers a one-click Whole recording
clip. Clips can carry a Resolve clip color that the Resolve helper applies. Exports keep only a
clip's own markers instead of its neighbours' padding, and every chosen SRT is written, naming its
transcript, with an empty one when a clip has no speech. Agents can propose changes to markers and
clips that already exist and amend their own pending cards (decision 0026). Scrubbing keeps up on
4K recordings, and Settings has a Fastest scrubbing option. A What's new window opens from the
version number, and agents read the same notes with `get_whats_new` (decision 0027). The intent
guide reaches version 6: the first batch's lessons, and one guide for every game. Two spikes ended
in recommendations: proxies (five Triage tickets) and scrubbing. See [the 0.4.30
review](docs/review-0.4.30.md).

## 0.4.29 — Fast playback without echo beside the Transcript window (November 6, 2026)

A hotfix during the first real batch. At 2x and faster, Cut playback stuttered and the sound
repeated like an echo while the Transcript window was open. Each time the 4K picture stalled, the
listening tracks ran ahead and were pulled back to it, replaying a slice of sound. Now a track
waits while the picture stalls or while it is ahead, and only skips forward to catch up, so a
stall is a short gap instead of a repeat. The Transcript window also redraws far less work on
each playhead update: looking up corrections once per change instead of searching every
correction for every word cut its busy time while playing from about 75% to about 2% on a dense
page. The stutter itself came from the highlighted word fading as it moved, about 8 times a
second: the open window never stopped drawing, which starved the 4K picture's decoding. Words
now change highlight without a fade, and on Connor's PC 2x and 4x play at full speed beside the
window. Pausing records how often the audio waited or moved in the diagnostics log. See [the
0.4.29 review](docs/review-0.4.29.md).

## 0.4.28 — Agents withdraw proposals and suggest marker colors (November 6, 2026)

A hotfix during the first real batch. Agent apps can take back their own proposals still waiting
for review with a new `withdraw_proposals` tool, for example a first pass the creator corrected
before the second: the cards leave the transcript window and stay in the batch record as
withdrawn by the agent, never as the user's rejections, and accepted or rejected proposals can't be
withdrawn (decision 0024). Marker, range marker and clip range proposals can carry one of
Resolve's 16 marker colors: the card shows it, Edit changes it in a dropdown, Accept keeps it, and
the agent reads back the color it proposed and the color kept (decision 0025). The transcript
window's counts now update when proposals arrive or leave. See [the 0.4.28
review](docs/review-0.4.28.md).

## 0.4.27 — Ready for the first real batch (November 6, 2026)

Sprint 13. Double-clicking a word in the Transcript window while Follow playback is on now opens
the editor on that word: a seek from clicking a word no longer scrolls the list under the
pointer, and Follow carries on once playback moves off it. When SRT subtitles are chosen and the
finished video carries a start timecode, export and filing also write a `.timecode.srt` copy
shifted to that timecode, for Resolve's Import from Subtitles; the result line says when a video
has none (OBS recordings don't). The Resolve helper's Check and Apply now also set each matching
clip's Resolve transcript from its game dialogue export on Resolve Studio 21.1.2 or later, only on
clips that have none, so transcripts no longer need importing clip by clip (decision 0023 amends
0009). Passing desktop checks now say in the suite report which parts they skipped. See [the
0.4.27 review](docs/review-0.4.27.md).

## 0.4.26 — Agents can look at pictures, and names spelled the game's way (November 5, 2026)

Sprint 12. Agent apps can ask to see moments of a recording with a new `look` tool: a strip of
small tiles across a range, 720p or 1080p frames, or a full-detail crop of a box such as a screen
text line, several moments in one call and at most about 8,000 image tokens a call. Virtual Cut
renders the pictures in memory and stores none. Pictures go out only while the new Allow pictures
switch in the Agent panel is on; it is one switch for every paired app and starts off. Activity
and each paired app show how many pictures were sent and their estimated tokens. Intent guide
version 4 encourages looking when a picture would make the work better and asks for several
moments in one call. A game's names and terms get a Heard as list (Cai heard as Kai), and every
whole-word match in its game and mic transcripts becomes the game's spelling as an ordinary,
undoable correction, with an offer to apply new rows to transcripts already made. See [the 0.4.26
review](docs/review-0.4.26.md).

## 0.4.25 — Screen text and cleaner microphone transcripts (November 5, 2026)

Sprint 11. After its picture pass, each recording gets a background screen text pass that reads
the text on its keyframes with a local engine on the graphics card and stores each line as facts
only: its text, where it sat, when it was up and how sure the engine was, for any game and with
no per-game setup. The thumbnail badge and Jobs show it, and a Screen text engine card in the
Transcript window downloads, checks and switches the engine. Agents read the lines through
`get_screen_text`, grouped by default, and intent guide version 3 tells them how to use them.
Microphone transcripts drop short invented lines such as "Thank you." over a cough, and game
names now reach recognition by default with a guard against invented phrases. See [the 0.4.25
review](docs/review-0.4.25.md).

## 0.4.24 — Job lanes and picture events (November 4, 2026)

Sprint 10. Media jobs run in their own lane, so an import, an inspection or an export starts
while a transcription runs, and work you start goes ahead of work the app queued by itself. After
its transcript, each recording gets one background picture pass that finds every black screen,
still picture, hard cut and fade, pausing for transcriptions and preview playback and using the
CPU as well only when the PC is idle; a scan icon starts it by hand and the thumbnail shows its
progress. Agents read those events as text through `get_visual_events` instead of running FFmpeg
themselves. Behind the scenes, desktop checks run four at a time (the suite with coverage went
from 542 s to 276 s in this delivery), scripts read local settings from `.env`, and no script falls back to
`G:\GPT` any more. See [the 0.4.24 review](docs/review-0.4.24.md).

## 0.4.23 — Card edits, reasons and faster builds (November 3, 2026)

Sprint 9. A proposal card's time fields show the full ruler time, with −1 s, −0.1 s, Playhead,
+0.1 s and +1 s in one row under each, arrow-key nudges and a button that jumps to the edited
time; the timeline preview follows every nudge. A picked card's preview has grips, so a range's
edges or a marker's or Split's line can be dragged on the Cut timeline, snapping like any edge;
the card shows the new time beside the proposed one and accepting uses it. After a decision the
card asks why: one tap for a reject reason, and an accept lists what you kept or changed. Agents
read the reasons, and later changes to what accepting made, through `get_proposal_decisions` and
the batch record. The intent guide (version 2) adds continuous scenes as range markers, the 5 s
Split rule, recordings without commentary and recurring moments. Builds and checks are faster:
TypeScript 7, type-aware oxlint and a Prettier cache take the fast gate from about 22 s to about
6 s. See [the 0.4.23 review](docs/review-0.4.23.md).

## 0.4.22 — Review tools ahead of real batches (October 16, 2026)

Sprint 8. Pending proposals now show dimmed on the Cut timeline in their proposer's colour: a
striped band in the ruler for ranges, a marker shape for markers and notes, and a line through
the track for Splits. Hovering or picking a card in the Transcript window lights its preview, and
a pick pans a zoomed view to it. An agent's clip range can be accepted as a range marker, and an agent's
range marker as a clip; the decision keeps the change of kind for the agent and the batch record.
The Transcript window's new Both view reads mic and game lines together in time order, with the
cards between them, and opens there while proposals wait. See [the 0.4.22
review](docs/review-0.4.22.md).

## 0.4.21 — Ready for real batches (October 15, 2026)

Each export or filing now saves a batch record: the agent's first pass beside what was exported,
with your own additions, changes after accepting and the spans cut away. Agents read it with
`get_batch_record`. A spoken Split whose black screen ended in the 5 s before it now suggests
cutting where the black ends, with the spoken time beside it. Transcription runs at batch 8 by
default, about twice as fast with the same result; vocabulary hints stay at batch 1. See [the
0.4.21 review](docs/review-0.4.21.md) and [decision 0018](docs/decisions/0018-batch-records.md).

Review round (test builds 0.4.21-2 to -4): Transcript opens the recording on screen, not the
last one clicked, and its window title reads "Transcript · <recording> · Virtual Cut"; a batch
record follows each export to its end instead of saying "queued".

## 0.4.20 — Lossless audio, ALAC included (October 9, 2026)

ALAC recordings play with sound everywhere. Each track's listening copy is now lossless: audio
the player can play as recorded (AAC, FLAC and others) is copied packet for packet, and ALAC or
PCM becomes FLAC with the recording's own sample rate and bit depth, checked sample for sample
against the original. Export and filing carry that same FLAC for ALAC/PCM recordings, so filed
clips play in the Library, and Open video makes a temporary FLAC copy for ALAC files. Projects
remake their older AAC copies once when opened. See [the 0.4.20 review](docs/review-0.4.20.md)
and [decision 0017](docs/decisions/0017-lossless-audio-copies.md).

## 0.4.19 — One proposal card and mic intents (October 7, 2026)

Sprint 6. Spoken cues and agent proposals now share one card in the transcript window, with
the same lines in the same places: who proposed it, the kind and intents, Accept, Reject,
Details and Edit at the right, then the name and time code. Edit changes the fields in place,
with nudges and Playhead. Decided proposals fold to one line with Reopen, which takes back what
accepting made. An agent that reworks a spoken cue shows one card tagged Spoken and Agent with
what changed. Agents read the mic intent guide (`get_intent_guide`) with your tagged notes and
earlier decisions, and can propose several intents, Notion notes and range markers.
`scripts/intent-score.mjs` scores proposals and decisions against tagged notes. See
[the 0.4.19 review](docs/review-0.4.19.md) and
[decision 0016](docs/decisions/0016-mic-intents-and-proposal-card.md).

Review round (test builds 0.4.19-2 to -5): a proposal that cites a spoken cue's line is one
Spoken + Agent card even when the agent leaves out `refines`; Reopen works after you changed the
result by hand, and the card says Changed since; range markers jump to their start or end; card
times read like the ruler, and Ctrl+Z undoes the last change on a card. `get_proposal_decisions`
returns the cited line ids, and the scorer places composite notes by their own lines.

## 0.4.18 — Agent proposals on the cue card (October 7, 2026)

Sprint 5. Paired agent apps can now propose markers, timed notes, splits and clip ranges with
`submit_proposals`, each with a reason, an intent tag and the transcript lines it rests on.
Proposals change nothing: they wait in the transcript window as Agent cards between the phrases
at their time and under Needs review, and are accepted, moved, retitled or rejected exactly like
spoken cues; Undo returns a decision to review. `get_proposal_decisions` reads the choices back,
including how far each one moved. Proposals are kept outside the project's Undo history, so
projects upgrade to saved format 6 after a verified copy. See
[the 0.4.18 review](docs/review-0.4.18.md) and
[decision 0015](docs/decisions/0015-agent-proposals.md).

## 0.4.17 — Agent apps can read the open project (October 6, 2026)

Sprint 4, the first M4 build. The Agent button in the header opens Agent access: a switch
(off by default) lets agent apps such as Claude Code or Claude Desktop connect through MCP, and
Pair with <project> shows the one command (Claude Code) or settings block (Claude Desktop) that
connects that app. The agent can read what's on screen, the project and batch summaries with
game and brief, the context packet, transcript lines between two times and existing markers,
clips, notes and cue decisions. Nothing can change through it, and it never sees file paths or
media. Every read is listed under Activity; Revoke cuts an app off at once. See
[the 0.4.17 review](docs/review-0.4.17.md) and
[decision 0014](docs/decisions/0014-agent-access-boundary.md).

## 0.4.16 — Transcript rows, subtitles with exports and a game picker (October 6, 2026)

Sprint 3. The transcript reads as dense timed rows with a line for each pause of 10 s or more.
Double-clicking a word turns it into a field in the line (Enter saves, Escape cancels, the
original is kept), and Edit phrase on hover edits a whole line the same way. Export and filing
offer a Transcript section: SRT subtitles beside the video, cut to the verified clip and named
after it (`<video>.srt`, `<video>.mic.srt`), and transcript history (original words,
corrections, word timing) in the `.vcut.json` companion. A fixture and steps check subtitle
import in Resolve by hand. Project and batch context get a searchable game picker that
remembers games across projects. See [the 0.4.16 review](docs/review-0.4.16.md).

## 0.4.15 — One transcript toolbar, Help and smoother reverse scan (October 5, 2026)

Sprint 2. The transcript window's four stacked rows become one toolbar row: recording,
transcript (beside search), search with Original, Follow, an Export menu, the speech engine and
Transcribe. Filter chips with counts replace the Show dropdown, and the Export menu holds the
format and timing. The bottom bar's F11 hint becomes a Help button that lists the spoken cues.
Reverse scan seeks again as soon as each seek lands instead of every 83 ms, which shows about
twice as many pictures at 1× and 2× and five times as many at 4×. `npm run deliver` now runs a
delivery end to end. See [the 0.4.15 review](docs/review-0.4.15.md).

## 0.4.14 — Filmstrips without the loading flash (October 5, 2026)

Sprint 1. Zooming and panning a recording that has its filmstrip file no longer flash
"Loading filmstrip…": new tiles fill in over the nearest thumbnails already loaded, and the text
appears only if tiles take longer than 300 ms. Recording cards show "Making filmstrip…" until
their filmstrip is ready, and the bottom bar shows the app version. See
[the 0.4.14 review](docs/review-0.4.14.md).

## 0.4.13 — Filmstrips made at import (October 5, 2026)

Each recording's filmstrip is now made once, in one keyframe-only pass that runs in the background
after import whenever no other job is waiting, and kept in the project's preview cache (about
12–24 MB per hour of footage). Zooming and panning then show thumbnails without decoding. Any job
you start goes ahead of filmstrip making. Changing, removing or relinking one recording no longer
clears every other recording's thumbnails. See
[the 0.4.13 review](docs/review-0.4.13.md).

## 0.4.12 — 6× preview and transcript position fix (October 4, 2026)

J and L gain a 6× step (1×, 2×, 4×, 6×, 8×, 16×) for forward and reverse, with preview audio
playing through 6× and pausing above it. The transcript window now follows a pause or seek made
right after playback instead of sometimes staying on the previous page. The desktop test suite
runs in about 6 minutes instead of 28, and FFmpeg and FFprobe start directly on Windows while
still stopping with the app. See [the 0.4.12 review](docs/review-0.4.12.md).

## 0.4.11 — One speech engine (October 3, 2026)

The speech setup panel now manages a single speech engine: one card with its status and location,
a download that is used as soon as it passes its check, an offer to delete a replaced downloaded
engine, and your own Python installation under Advanced. The two-setup switch is gone. See
[the 0.4.11 review](docs/review-0.4.11.md).

## 0.4.10 — Speech setup files removed outside the app (October 3, 2026)

The Transcript window now notices speech setup files that were moved or deleted in Explorer: it
rechecks whenever it regains focus, names the missing file, stops reporting an earlier GPU check
as ready, and keeps Start transcription disabled with the reason shown. A deleted download no
longer offers Use this setup, and a setup with missing files cannot be switched to. See
[the 0.4.10 review](docs/review-0.4.10.md).

## 0.4.9 — M320 speech setup clarity (October 3, 2026)

The local speech setup panel shows which setup is in use and where, lists the other setup you can
switch to with a button that names it, and gives accurate messages after switching. The folder
picker starts beside your downloaded setup, or in `%LOCALAPPDATA%\Virtual Cut` on a first setup.
Switching while a download is only planned no longer offers to use that unfinished folder. See
[the 0.4.9 review](docs/review-0.4.9.md).

## 0.4.8 — M3 engineering iteration (October 3, 2026)

Long projects keep saving and reopening: inspected frame and keyframe timestamps move out of
the editable project into their own table (saved format 5, with a verified pre-upgrade copy).
A 16-hour project that previously could not open now opens, saves and reopens, and the
project snapshot takes about 1 ms instead of hundreds. The app refreshes on native change
notifications and window focus instead of polling every second. Promise error handling is
enforced by lint, which also fixed Copy diagnostics reporting success before the clipboard
write finished. The hosted CI workflow can start jobs again. See [the 0.4.8 review](docs/review-0.4.8.md).

## 0.4.7 — M3 review (October 3, 2026)

**Latest review: 0.4.7.** Optional local speech setup now downloads and verifies the
tested recognition engine, model and optional NVIDIA libraries into a chosen folder.
Size/free-space planning happens before the download; activation and previous-setup
restoration are explicit. Follow playback also advances through pages while source
position updates continue. See [the current review](docs/review-0.4.7.md) for M320–M321 and
the remaining M3 checks. The floating Transcription window retains compact, aligned
controls, Select transcript wording and expandable help. **Marker** is the preferred
spoken microphone cue; guarded legacy Mark and existing decisions remain compatible.
Connor's M318–M319 and M316 results are accepted; the current guide preserves those
passes and separates the latest layout/help/export requests from delivered features.
GPU readiness warnings, explicit CPU continuation and retained
device/fallback details from 0.4.5 remain available.
Local crash capture remains available; the original unexpected exit is still under
investigation. Earlier release summaries retain their original verification scope.

### Research note — speaker pipeline (October 3, 2026)

**Speaker pipeline research — October 3.** The [GPU comparison](docs/research/whisperx-gpu-study.md)
selects optional WhisperX alignment and game-only speaker adapters with preserved utterance recognition.
Its faster full pipeline has sparse-dialogue timing regressions and is not the app default.
This is research for VC-81. Connor deferred these stack changes to later M3;
speaker controls are not in 0.4.7. Speaker identification is planned for game audio only.

## 0.4.6 — M3 review

Compact transcription controls and the preferred spoken **Marker** cue (legacy Mark decisions remain compatible); native GPU readiness recovery checks. See [0.4.6 review](docs/review-0.4.6.md).

## 0.4.5 — M3 review

Warns before CPU fallback and retains transcription device status; corrected runtime configuration. See [0.4.5 review](docs/review-0.4.5.md).

## 0.4.4 — M3 review

Transcript workflow iteration: reading state preserved within an open project, paired clip titles from either cue boundary, cue context spans reviewed separately from titles, deliberate punctuated microphone cues, and export labels by timing scope. See [0.4.4 review](docs/review-0.4.4.md).

## 0.4.3 — M3 review

Local crash capture and transcript-window diagnostics. See [0.4.3 review](docs/review-0.4.3.md).

## 0.4.2 — M3 review

A correction editor is dismissed when another word is selected; recorded M3 desktop review results. See [0.4.2 review](docs/review-0.4.2.md).

## 0.4.1 — M3 review

Version 0.4.1 refines **Transcript** to project controls and optional transcription to each import's audio setup. Use Projects for game/brief context and **Batch context** for inheritance or overrides. Recognition only starts after an explicit request; opening saved transcripts does not load a model. The separate window supports word seeking, search, corrections, cue review and JSON/SRT export. See [M301–M308](docs/m3-review.md) for the prepared local review project, observed CPU timings and known recognition errors.

## 0.4.0 — M3 first review

**Current branch: M3 audio intelligence, 0.4.0 first review.** Explicit local transcription, separate game/microphone results, a floating word-seeking transcript window, original-preserving corrections, reviewed spoken cues, and project/batch game and video context are implemented for review. Recognition quality and the remaining M3 boundaries are documented in [the review guide](docs/m3-review.md) and [engineering notes](docs/m3-implementation.md). Version 0.4.7 adds optional managed recognition provisioning. Speaker detection remains deferred in M3; automated agent correction belongs to M4. M2 remains accepted.

## 0.3.23 — M2 accepted

**Accepted M2 baseline (0.3.23).** Create and reopen saved projects, import named batches, inspect streams and chapter markers, choose Game/Mic audio, and save Cut edits with undo/redo. Export one selected clip from Cut or Review: original video plus game audio, source container by default, outward keyframe cuts, verified packet timing, embedded chapter names/times and a portable annotation file. Export history records actual ranges and processing time, and preserves receipts across undo and save restoration. Media accepts one or many dropped videos with batch audio setup and skipped-file feedback. The timeline supports cursor zoom, panning and a full-extent reset across Media, Cut and Review. Media panels resize and hide independently; markers use Resolve's named palette and start Blue with their name ready to type. Review now files accepted current clips into their planned folders with durable results, cancellation/retry and verified Done. Library previews completed outputs even with originals offline and supports matching-pair relinking. An explicit Resolve helper enriches imported chapter markers with multiline notes and named colors while preserving conflicting user edits. Clip notes/context remain in the companion and Library. Connor reported a successful representative batch through save/reopen, completed playback and Resolve handoff; M281–M286 refinements are accepted. Older compatibility observations and the first hosted CI run remain explicit follow-ups. At that baseline transcription, Notion sync and agents remained planned; M3 progress is described above. The sample workspace keeps its prototype actions separately. See the [M2 implementation and review scope](docs/milestone-2.md).

Version 0.3.23 groups cleanup files with expandable counts and explains retained saves. Projects shows a storage breakdown below Preview cache, measured only when the panel opens or Refresh is clicked. Sources and all completed outputs/companions remain protected. M281–M286 passed; see [the M2 closeout and explicit follow-ups](docs/m2-closeout.md).

## 0.3.22

Version 0.3.22 adds peer annotation snapping, the range End remove button, Trim signals in Review, a default-open tree, readable filing timings, clickable filing destinations, whole-Media-Pool Resolve discovery and reviewed project deletion. Cleanup always preserves source footage, completed exports and companions. See [the current review additions](docs/review-0.3.22.md). M279/M280 and the reported VC-26 workflow are accepted; only changed behaviors need another look.

## 0.3.21

Version 0.3.21 adds clock/frame readout icons and playhead snapping to annotation boundaries while scrubbing, independent of Manipulate. See [the current review additions](docs/review-0.3.21.md). M276–M278 are accepted. The engineering coverage baseline is documented in [testing](docs/testing.md).

## 0.3.20

Separates timeline selection and retiming from seeking. See [0.3.20 review](docs/review-0.3.20.md).

## 0.3.19

Cut has a remembered **Snap** toggle beside **H · Manipulate**, enabled initially. Dragged clip edges, marker positions and range edges snap within ten screen pixels of the playhead, other points, range endpoints and clip endpoints captured at drag start. An annotation never attracts itself. Moving a whole range can align either endpoint while retaining duration. Existing frame and source bounds still apply; Escape cancels and a completed gesture is one Undo. Alt-drag a point marker left or right to create a range, including with Manipulate off. Range spans are thin, centered and text-free, with consistent split endpoint shapes. Verified cached Library revisits prepare timing data before switching the viewer. See [0.3.19 review notes](docs/review-0.3.19.md).

## 0.3.18

Version 0.3.18 adds range markers with split endpoints, translucent spans, overlap lanes, numeric timing and H-mode movement/resizing. Shift+M creates a range; Shift-drag extends a point. It also fixes inspector scroll interference and reuses bounded Library overviews. Update the Resolve helper for range-duration handoff. See [the current review additions](docs/review-0.3.18.md).

## 0.3.17

Version 0.3.17 adds Library filmstrip/keyframes/game waveforms, clearer Review labels, a full Handoff page and generated chapter cleanup.

## 0.3.16

Version 0.3.16 adds Review Date modified sorting, global-order folder runs, current Done locations after relink, and a dedicated Resolve Handoff panel with helper status and safe removal. See [the current review additions](docs/review-0.3.16.md).

## 0.3.15

Version 0.3.15 orders Cut clips and marker cards chronologically, puts bulk destination changes above Review cards, adds individual filing cancellation, and fixes Library focus loss during file verification. Library gives playback the available height with expandable details. See [the preceding review follow-up](docs/review-0.3.15.md) and [the preceding recovery/diagnostics work](docs/review-0.3.14.md).

## 0.3.14

Preview recovery diagnostics and M2 review usability. See [0.3.14 review](docs/review-0.3.14.md).

## 0.3.13

Version 0.3.13 adds reviewed batch filing, the completed Library, an explicit Resolve metadata helper, and Review-to-Cut playhead preservation. See [filing, recovery and Resolve handoff](docs/filing-and-library.md) for the review workflow and verification limits.

## 0.3.12

Version 0.3.12 replaces persisted Undo snapshots with a bounded session journal and compact saves. Autosave defaults to ten minutes, with adjustable intervals and optional saving after edits. Manual Save keeps Undo; reopening starts a fresh Undo history. Existing projects and rolling saves are upgraded safely. See [save policy](docs/save-policy.md) for behavior, migration and measured storage reductions.

## 0.3.11

Version 0.3.11 addresses the latest marker stacking and Review folder-picker/tree/source-title feedback. Project recovery now includes verified backups before a schema upgrade, interruption notices and Recover from save into a separate project. See [project recovery](docs/project-recovery.md) for compatibility, retention and validation boundaries.

## 0.3.10

Version 0.3.10 adds automatic destination holds, selectable/resizable Review folders, source links to Cut, Explorer access and marker dragging in Manipulate mode. It builds on the persistent local diagnostics and exact-content review acceptance introduced in 0.3.9. Plans can assign several clips to existing or proposed folders without creating directories or filing media. Existing accepted clips from older versions require one fresh acceptance. See [review planning and diagnostics](docs/review-planning.md) for behavior, verification and remaining M2 work.

## 0.3.9

Persistent local diagnostics and reviewed destination planning. See [review planning and diagnostics](docs/review-planning.md).

## 0.3.8

Version 0.3.8 retains recent filmstrip images across recording switches and keeps overlapping tiles aligned while panning. The bounded memory cache favors recent overviews, requests only missing visible slots, and releases images on eviction or project close. See [filmstrip reuse](docs/filmstrip-reuse.md) for behavior, limits and verification.

## 0.3.7

Version 0.3.7 compacts thumbnail actions into the duration row and stacks list dates when the media pool is narrow. Playback and exports are unchanged. The [review follow-up](docs/review-0.3.6-followup.md) records the logging audit, confirmed Resolve note/color transfer gap, filmstrip reuse plans and preliminary 6× audio measurements.

## 0.3.6

Version 0.3.6 stabilizes viewer size during source changes, reduces fast-playback audio corrections and switches a stalled fast preview to bounded frame scanning. Preview errors offer a same-position reload with local diagnostics. M225–M227 layout/save-notice follow-ups are included. See [the playback investigation](docs/transport-investigation.md) for measured causes, the LosslessCut comparison and remaining limits.

## 0.3.5

Version 0.3.5 adds Media dates and sorting (Date oldest-first by default; Intake time and Name also available). Registered project timelines generate nearest-keyframe tiles for the full or zoomed view directly into a bounded memory cache, with no dynamic image files. Hover a tile for its actual source time. Background generation waits while playing/seeking. Saved now appears briefly after a real save. See [dates and filmstrip behavior](docs/filmstrip-feedback.md) for storage, timing and verification details.

## 0.3.4

Version 0.3.4 waits to autosave until playback/seeking has stopped and changes have settled for two seconds. Pending clip/marker edits also wait while playing or holding a scrub/trim gesture. Save, project operations and normal close capture the latest position. Navigation creates no undo steps; Undo/Redo reverses edits without resetting the viewing position. Cut's viewer shrinks to fit overlapping lanes and controls. Double-click a clip or marker card outside its fields to seek; the same behavior is available in expanded Review details. Ctrl+wheel pans a zoomed timeline, while Alt+wheel zooms. Marker notes accept Enter for multiple lines; names stay single-line. See [the playback/filmstrip assessment](docs/playback-feedback.md) for the remaining high-speed and thumbnail limitations.

## Earlier versions

- **0.3.0–0.3.3 (M2 start):** verified lossless single-clip export, Media drop intake and timeline zoom. See [Milestone 2](docs/milestone-2.md) and [standalone tools](docs/standalone-tools.md).
- **0.2.x (M1):** persistent projects, batch intake, audio roles and Cut edits. See [Milestone 1](docs/milestone-1.md).
- **0.1.x:** desktop foundation and workflow preview. See [foundation](docs/foundation.md) and [workflow preview](docs/workflow-preview.md).
