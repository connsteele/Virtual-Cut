# Agent apps

How agent apps such as Claude Code or Claude Desktop connect to Virtual Cut, what they read and propose, and how you review their proposals. Split out of the [user guide](user-guide.md) in Sprint 10 so each topic is its own paragraph. See decisions [0014](decisions/0014-agent-access-boundary.md), [0015](decisions/0015-agent-proposals.md), [0016](decisions/0016-mic-intents-and-proposal-card.md), [0018](decisions/0018-batch-records.md) and [0020](decisions/0020-picture-events.md).

## Connecting

**Agent** in the header opens Agent access. The switch (off by default) lets agent apps such as Claude Code or Claude Desktop connect through MCP; **Pair with <project>** shows the command or settings block for each app, and **Revoke** cuts one off. Every read and proposal is listed under Activity.

## What an agent reads and proposes

A paired app reads the open project: the screen, batches with their game and brief, transcripts, and existing markers, clips and notes. It can also propose markers, timed notes, splits and clip ranges.

It can also ask where a recording's picture changes (`get_visual_events`): black screens, still pictures, hard cuts and fades between two times, as short text lines in recording seconds, read from the events the picture pass stored ([decision 0020](decisions/0020-picture-events.md)). Bursts of cuts under half a second apart come as one line, and a whole hour costs an agent a few thousand tokens at most. The agent never runs video tools itself. Until a recording's picture has been read, the answer says so (waiting, reading with its percent, failed, or not read yet: press **Analyse picture now**, the scan icon on its card), so an agent never mistakes an unread recording for one without scene changes.

Before proposing, an agent reads the intent guide (`get_intent_guide`): Split and Clip start/end are commands, and everything else you say is read as a marker, general context, a note for your video notes, or an edit instruction. A recording with no commentary is proposed from the game alone, recurring moments such as an MVP screen get clips only for the first few, and a part of one continuous scene becomes a range marker rather than a clip. Tagged notes (a `.txt` beside a recording, see [the intent guide](intent-guide.md)) give it your own examples.

## Proposal cards

Proposals change nothing: each waits in the transcript window on a proposal card, the same card spoken cues use, between the phrases at its time and under the **Needs review** chip.

Line 1 shows who proposed it (**Spoken**, **Agent**, or both when an agent reworked a spoken cue), the kind and the intents, with **Accept**, **Reject**, **Details** and **Edit** at the right; line 2 the name and the time code. **Details** shows the note, the reason and the transcript lines it cited; **Edit** turns the name, time and note into fields in place. Keys on a focused card: A accept, R reject, D details, E edit, N/P next or previous card.

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
