# 0015. Agent proposals wait on the cue card and are decided like spoken cues

- Status: Proposed
- Sources: VC-161, VC-162, the October 6 refinement (OR-READY: training happens in the app), Sprint 5

## Context

Connor wants Claude's understanding of his intents trained while Claude works inside Virtual Cut, with his accept, move and reject choices as labelled examples. Decision 0014 kept MCP read-only and reserved proposals for this stage. The transcript window already reviews spoken-cue candidates on a cue card, and those decisions already save and undo with the project.

## Decision

- **Store:** agent proposals live in their own table, `agent_proposals` (project schema 6), outside the editable model and the Undo journal, beside the transcript tables. They are append-only and keep provenance: agent app and model, reason, intent tag, and the cited transcript lines with their text as it read on arrival. Opening an older project upgrades it after the usual verified pre-upgrade copy. Restoring a save copy keeps today's proposals and brings back any the copy holds; removing a recording removes its proposals.
- **Kinds:** marker, timed note, split and clip range, the kinds the cue card already applies. The intent tags marker, general, notion and edit ride along as provenance; general and notion proposals arrive as notes until VC-155 gives intents their own shape.
- **Submit:** `submit_proposals` checks a whole call against the open project and refuses all of it, naming the field, when a proposal falls outside the recording, cites a transcript that is no longer current or a line it does not hold, or repeats a pending proposal of the same kind, time and title. A recording keeps at most 2,000 proposals.
- **Decide:** proposals show as Agent cards in the transcript window, placed by time between phrases and counted under the cue filters. Accepting does what accepting a spoken cue of that kind does; the decision is a cue decision with `proposalId`, the chosen position, end, title and note, and the time it was made. It saves and undoes with the project, so Undo returns a proposal to review.
- **Read back:** `get_proposal_decisions` returns each proposal with its status and, when accepted, what was chosen and how far it moved. It is read-only.
- **Boundary:** the tool is annotated as not read-only but non-destructive. Nothing an agent submits changes markers, clips, notes or files until the user accepts it in Virtual Cut, and 0014's other limits stand.

## Alternatives considered

- **Proposals inside the model:** every submission would become an Undo step and a save, and undoing an edit could silently drop an agent's proposals.
- **A separate review list:** a second place to decide would split training data from the spoken cues the user already reviews on the cue card.

## Consequences

- Each decision is a labelled example for VC-128 scoring and the VC-155 intent guide.
- Older Virtual Cut versions cannot open a project once it is upgraded to schema 6; the pre-upgrade copy in Save history can.
- Full agent mode (VC-32) still needs its own grant in Virtual Cut's UI.
