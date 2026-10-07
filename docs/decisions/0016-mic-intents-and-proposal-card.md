# 0016. Free mic speech becomes intent proposals on one proposal card

- Status: Proposed
- Sources: VC-155, VC-128, the October 6 cue decision of record (TALK-CUES), Sprint 6 prototype
  rounds 1–6 (card PROTO-CARD)

## Context

Connor found that only Split felt right as a spoken cue; free talk felt best for everything else.
The cue decision of record keeps Split and Clip start/end as commands and turns all other mic
speech into proposals tagged by intent ({marker}, {general}, {notion}, {edit}), always reviewed.
Decision 0015 gave agents a way to propose, but the cue card had been built for local recognition
and showed every field at once, and spoken cues and agent proposals looked different.

## Decision

- **Guide:** a versioned mic intent guide ships with Virtual Cut (`electron/intent-guide.ts`,
  readable copy in `docs/intent-guide.md`). Agents read it through `get_intent_guide`, with the
  user's layer: labelled lines from tagged notes beside the project's recordings (never the
  recording being worked on), decisions on earlier proposals, and a habits profile. No assistant's
  memory holds the meaning of the intents.
- **Proposal shape:** a proposal carries any number of intents, a Notion target for {notion}
  (new, expands an existing note, duplicate of one), an end for a range marker that labels part of
  a continuous scene, and optionally the spoken cue it reworks (`refines`).
- **One card:** spoken cues and agent proposals share one card with the same lines in the same
  places: who proposed it, the kind and intents, with Accept, Reject, Details and Edit at the
  right; the name, then the time code; what an agent changed, the Notion target or a composite
  note's sources when there are any. Details open below. Edit turns the name, time and note into
  fields in place. A proposal that reworks a spoken cue replaces it: one card tagged Spoken and
  Agent that shows what was heard first and each change; accepting it settles both.
- **Reopen:** decided proposals fold to one line in place. Reopen puts a proposal back in review
  and takes back what accepting made: the marker, note, clip, or the split (its clips become one
  again under the old name). It is an ordinary edit, so Undo reverses it. A split whose clips
  changed since cannot be reopened; Undo still can.
- **Measurement:** `scripts/intent-score.mjs` scores proposals and decisions against tagged notes
  per intent, Split cut points against where the note says the cut belongs, and false proposals
  on speech marked to ignore.

## Alternatives considered

- **Keep Marker and Note as cue words:** they felt worse than free talk and still needed an
  agent to write a useful note.
- **A separate edit box on the card:** Connor preferred editing the fields where they are.
- **Reopen only for rejected proposals:** accepted proposals would disappear from review, which
  Connor did not want.

## Consequences

- Every accepted, moved, retitled, rejected or reopened proposal is a labelled example.
- Tagged notes stay plain files the user owns; the scorer and the guide read the same format.
- The ready-made intent pass after a mic transcript (VC-157) and sending Notion notes to Notion
  build on this; neither is part of it.
