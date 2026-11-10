# Agent apps

How agent apps such as Claude Code or Claude Desktop connect to Virtual Cut, what they read and propose, and how you review their proposals. Split out of the [user guide](user-guide.md) in Sprint 10 so each topic is its own paragraph. See decisions [0014](decisions/0014-agent-access-boundary.md), [0015](decisions/0015-agent-proposals.md), [0016](decisions/0016-mic-intents-and-proposal-card.md), [0018](decisions/0018-batch-records.md), [0020](decisions/0020-picture-events.md) and [0026](decisions/0026-agent-changes-and-amends.md).

## Connecting

**Agent** in the header opens Agent access. The switch (off by default) lets agent apps such as Claude Code or Claude Desktop connect through MCP; **Pair with <project>** shows the command or settings block for each app, and **Revoke** cuts one off. Every read and proposal is listed under Activity.

**Allow pictures** (off by default, one switch for every paired app, including apps you pair later) decides whether agent apps may receive pictures of your recordings through `look`. Pictures go to each app's AI provider and are kept under that provider's data settings. The switch takes effect at once: the next look from any app is refused while it is off, and a look already running finishes. Only you change it here; no agent or tool call can. Each paired app shows the pictures it received today and their estimated tokens, and Activity lists every look with its picture count and tokens, or "refused: pictures are off". Virtual Cut stores no pictures, only these counts.

## What an agent reads and proposes

A paired app reads the open project: the screen, batches with their game and brief, transcripts, and existing markers, clips and notes. It can also propose markers, timed notes, splits and clip ranges.

It can also ask where a recording's picture changes (`get_visual_events`): black screens, still pictures, hard cuts and fades between two times, as short text lines in recording seconds, read from the events the picture pass stored ([decision 0020](decisions/0020-picture-events.md)). Bursts of cuts under half a second apart come as one line, and a whole hour costs an agent a few thousand tokens at most. The agent never runs video tools itself. Until a recording's picture has been read, the answer says so (waiting, reading with its percent, failed, or not read yet: press **Analyse picture now**, the scan icon on its card), so an agent never mistakes an unread recording for one without scene changes.

It can read the text the screen showed (`get_screen_text`): every piece of text the screen text pass found between two times ([decision 0021](decisions/0021-screen-text.md)). By default text that appeared and went together in one screen area is one short line, in reading order: whole seconds, a plain position such as "bottom centre", then the text (a name plate with its dialogue, a HUD panel, a menu). `detail` lists every piece on its own line with its box on the 1080p frame, keyframes and confidence. Nothing is labelled: the agent judges what a line is from where and how long it stayed up and the game's layout. It can filter by time, screen area, time on screen, lines that are only numbers and the engine's confidence (`min_confidence: 0.85` skips most HUD icons and half-visible text); pages hold 200 lines with a count per screen area. Busy games show a lot of text (a 34-minute Fire Emblem battle is about 53k tokens whole, 18k with `min_seconds: 2`), so agents read time windows. Until the screen text has been read, the answer says where the pass stands, as for picture events, or that the screen text engine is not installed, and `get_context` says per recording whether screen text is ready.

It can look at the picture (`look`), but only while **Allow pictures** is on in the Agent panel (one switch for every paired app, off until you turn it on); otherwise the call is refused, says that pictures are off and that you turn them on in the Agent panel, and Activity lists it as refused ([decision 0022](decisions/0022-look-pictures.md)). One call checks up to 8 moments of one recording, each a **strip** (a time range as up to 16 small 252x140 tiles with the time burned into each, taken from the recording's filmstrip where a keyframe is close enough), **frames** (exact times at 720p, about 1,200 image tokens each and up to 6 a call, or 1080p for detail, about 2,700 tokens and up to 2) or a **crop** at the recording's full detail (a box from `get_screen_text` detail, padded a little, or a box in fractions of the frame). A call sends at most 16 pictures and about 8,000 image tokens, no side over 1988 px; a bigger request is fitted (fewer tiles, smaller sizes) and the answer says what changed. Every picture comes after a line with the recording and its time, and a picture nearly the same as one already in the call is left out. Virtual Cut decodes the pictures into memory with FFmpeg on the CPU and sends them as images: nothing is written to disk, and Activity keeps the recording, the times, the picture count and the estimated image tokens, never the pictures. The pictures leave your PC and are kept by the agent app under its own data settings (Claude Code also keeps a copy on disk).

After Virtual Cut is updated, an agent reads the release notes (`get_whats_new`): for every version, the tools and fields that are new or changed, what to do differently now, known gaps, the intent guide version, what changed for you, and whether the notes are final or still a draft. It gets every version since that paired app last read them, which Virtual Cut remembers per pairing, or since a version it names. The server instructions say when a paired app has notes it hasn't read. It works without an open project, and the What's new window's Paired agents box shows what each app last read ([decision 0027](decisions/0027-whats-new.md)).

Before proposing, an agent reads the intent guide (`get_intent_guide`): Split and Clip start/end are commands, and everything else you say is read as a marker, general context, a note for your video notes, or an edit instruction. A recording with no commentary is proposed from the game alone, recurring moments such as an MVP screen get clips only for the first few, and a part of one continuous scene becomes a range marker rather than a clip. Tagged notes (a `.txt` beside a recording, see [the intent guide](intent-guide.md)) give it your own examples.

## Proposal cards

Proposals change nothing: each waits in the transcript window on a proposal card, the same card spoken cues use, between the phrases at its time and under the **Needs review** chip.

Line 1 shows who proposed it (**Spoken**, **Agent**, or both when an agent reworked a spoken cue), the kind and the intents, with **Accept**, **Reject**, **Details** and **Edit** at the right; line 2 the name and the time code. **Details** shows the note, the reason and the transcript lines it cited; **Edit** turns the name, time and note into fields in place. Keys on a focused card: A accept, R reject, D details, E edit, N/P next or previous card.

An agent's marker, range marker or clip range can carry a marker color, one of Resolve's 16, for example from the color key in your brief. The card shows it after the time code (Blue when the agent gave none, the default for new markers); **Edit** shows it as a color dropdown, and **Accept** keeps the color shown. A clip range's color is used if you keep it as a range marker. The agent reads back the color it proposed, the color you kept and whether you changed it.

An agent can also take back its own proposals that are still waiting, for example a first pass you corrected before it sends the second. A withdrawn card leaves the transcript window; it stays in the batch record as withdrawn by the agent, never as one of your rejections. Proposals you already accepted or rejected can't be withdrawn.

An agent can also propose changes to markers and clips already in the project: a new name, position or range, marker color, Resolve clip color, note, or a trim of a clip's start or end. A **Change marker** or **Change clip** card shows the item as accepting would leave it, with the changes as chips (**Changes** · Name · Color ◆ Blue → ◆ Green); **Details** opens a **Changes** table of before and after, and **Edit** changes the After column, with a color list that shows each color's swatch. **Changed since proposed** means you edited the item after the agent looked; a card whose item you deleted can only be rejected. Accepting edits the item like you would, so **Ctrl+Z** in the editor puts it back and returns the card to review, and **Reopen** restores the old values.

Instead of withdrawing a waiting card to fix it, an agent amends it in place: the card shows **Amended** with what changed, and **Details** shows the previous version against the new one and every version, newest first, with the agent's reasons. You still decide the card once. A clip range can also carry a Resolve clip color, used when you accept it as a clip; its marker color is used if you keep it as a range marker. Each card's kind has an icon beside it: a diamond for markers, an arrow for range markers, a film strip for clip ranges, scissors for Splits, a speech bubble for timed notes and an N for Notion notes, with a small pencil on a change ([decision 0026](decisions/0026-agent-changes-and-amends.md)).

An agent's clip range offers two accepts: **Accept as clip** (A) makes the clip, **Accept as range marker** (M) keeps the same span, name and note as a range marker instead. An agent's range marker works the other way round: **Accept as range marker** (A) or **Accept as clip** (C). The agent reads that change back.

## Microphone and game together

The transcript picker also offers **Both · Microphone and game**: microphone and game lines in one time-ordered list, each with a coloured edge and a **Mic** or **Game** label, with the cards between them, so the game dialogue behind a proposal sits right beside it. The window opens on Both while a recording has proposals waiting, and on Microphone otherwise. Editing a line corrects that line's own transcript; search, **Original** and the chips cover both, and Export needs Microphone or Game picked.

## Changing a proposal's times

Each time field shows the full ruler time, with **−1 s**, **−0.1 s**, **Playhead**, **+0.1 s** and **+1 s** in one row under it; with the field focused, ↑/↓ nudge 0.1 s and Shift+↑/↓ 1 s. The card's preview on the Cut timeline follows each nudge before you accept.

A picked card's preview also has grips: drag a range's start or end, or a marker's or Split's line, and it snaps like any edge in Cut (Esc while dragging puts it back). Dropping it sets the card's times as a nudge would, the new times light up and the proposed ones show beside them (**was …**), and accepting uses the new times; Ctrl+Z on the card undoes the drop. Hovering a card never gives its preview grips.

## Previews on the Cut timeline

Every pending proposal for the recording on screen, spoken or from an agent, also shows dimmed on the Cut timeline in its proposer's colour: a striped band in the ruler for range markers and clip ranges, a marker shape in the ruler for markers (outlined for notes), and a line through the track for Splits, with a count such as **3 proposals waiting** beside the position. Apart from a picked card's grips, the previews are read-only and clicks pass through to the timeline.

Hovering a card, or picking it (click the card itself or its time code, or reach it with Tab, N or P; it gets a full outline, and Esc lets it go), brings its preview to full strength and names it. Picking a card whose proposal is outside a zoomed-in view pans the view to it without moving the playhead; hovering never moves the view. A spoken Split's line sits where its card suggests cutting (the black-screen snap) once that is measured.

## Deciding and reasons

Decided proposals fold to one line with **Reopen**, which takes back what accepting made; **Ctrl+Z** in the editor also reverses a decision.

The proposal you decided last asks why on a second line, and skipping it never blocks you: after a reject, one tap on **Wrong moment**, **Not needed**, **Wrong intent** or **Other…** (a short line), or keys 1–4; after an accept, it shows what you kept (the intent, how far you moved it, a retitle or kind change) and takes an optional line, saved with Enter. Esc skips. Decided from the keyboard, the line takes focus, and answering or skipping moves on to the next card waiting, as N would. A reason given stays on the folded line, with **Change**.

The agent reads your decisions back, including how far you moved each one, your reason, and what you changed later in Cut to what accepting made (a marker dragged into a range, a retitle, a delete).

## Batch record

Each batch also keeps a batch record (`get_batch_record`): the agent's first pass, frozen when its proposals land, beside the state at the batch's latest export or filing, with how each accepted proposal differs from what was proposed (moved, dragged, retitled), what you added yourself, what you changed after accepting and what you cut away. It holds times, names and notes only, in Virtual Cut's own settings folder, outside the project and Undo ([decision 0018](decisions/0018-batch-records.md)).
