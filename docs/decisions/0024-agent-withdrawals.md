# 0024. Agents withdraw their own pending proposals

- Status: Proposed
- Amends: [0015](0015-agent-proposals.md) (proposals are append-only)
- Sources: Connor during the first real batch (VC-29, 2026-11-06: a corrected second pass left
  every stale first-pass card to reject by hand), VC-201, batch feedback note 43

## Context

Agent proposals wait on cue cards until the user accepts or rejects them, and a rejection is a
training label (VC-173, VC-182). When the creator corrects an agent and it runs a second pass,
the first pass's stale cards stay in Needs review and can only be cleared one Reject at a time.
Rejecting them would also label them wrongly: the user did not judge them, the agent dropped
them.

## Decision

- **A `withdraw_proposals` MCP tool** takes proposal ids (up to 200) and an optional reason of up
  to 300 characters.
- **Only the calling app's own proposals still waiting.** An id the user accepted or rejected, or
  one another paired app submitted, refuses the whole call and names it; nothing changes.
- **Withdrawn is its own state, on the proposal.** The proposal store marks it withdrawn (when,
  which app, why), outside the model and Undo, so Undo never brings it back. A withdrawn proposal
  leaves the transcript window, its counts and the Cut previews, and claims no spoken cue; it can
  be proposed again. If a decision exists anyway (Redo after the agent withdrew what Undo had
  reopened), the decision wins.
- **Kept for learning, apart from rejections.** `get_proposal_decisions` reads it back with status
  `withdrawn` (counted and filtered on its own; `decided` stays accepted or rejected). The batch
  record lists each withdrawal with its reason, its final state labels the proposal withdrawn,
  and a withdrawal ends the recording's first pass. Intent scoring leaves withdrawn proposals out
  and counts them separately; the intent guide's examples never include them.
- **Activity** says "Withdrew N for <recording>".

## Alternatives considered

- A user-side "Reject all pending" button: deferred (Connor, 2026-11-06); it would label the
  stale cards as the user's rejections.
- `replaces` on `submit_proposals`: deferred; a withdraw call before the second pass does the
  same.

## Consequences

Withdrawn proposals are not shown anywhere in the app yet; they are read through MCP and the
batch record. The intent guide does not yet tell agents to withdraw before a second pass (a guide
change needs Connor's OK).
