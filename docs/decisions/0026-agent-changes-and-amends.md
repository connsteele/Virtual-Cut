# 0026. Agents propose changes to markers and clips, and amend their own cards

- Status: Proposed
- Amends: [0015](0015-agent-proposals.md) (agents propose new items only; proposals are
  append-only), [0024](0024-agent-withdrawals.md) (withdraw and propose again to tweak a card)
- Sources: the first real batch (VC-29, Mass Effect: a color key change and small fixes to
  accepted cards were done by hand, and the agent ran about 43 withdraw-and-resubmit rounds on
  00-36-07 alone), VC-204, filing review card B29-EDITS, the card prototype Connor accepted on
  2026-11-09 (chips, Changes and Versions tables, swatch color picker, kind icons)

## Context

Agents could only propose new markers, notes, splits and clip ranges. A change to something
already in the project, such as a new color key or a better name for an accepted marker, had to
be made by hand, and a tweak to a card still waiting meant withdrawing it and proposing it again,
which loses the link between the versions.

## Decision

- **`propose_changes`** proposes edits to markers and clips already in the project: name,
  position or range (a range marker can become a point marker), marker color, Resolve clip color
  (or none), note, and a clip's start or end (trim). Only fields that differ are stored, with the
  values as the agent saw them. One pending change per marker or clip; the whole call is refused,
  naming the field, if any change is invalid.
- **A change card shows before and after.** Line 2 shows the item as accepting would leave it
  (moved times lit with "was" beside them, the new color only); line 3 lists the changes as chips
  named like the table rows. Open, a centered **Changes** header heads a Before/After table; Edit
  changes only the After column. If the user changed the item after the agent looked, an amber
  **Changed since proposed** tag shows and Before shows it as it is now; accepting writes only the
  proposed fields. If the item is gone, only Reject is left; it is never rejected for the user.
- **Accepting is an edit of the project.** It writes the values through the model like the
  user's own edits, so Undo returns the card to review; the decision keeps the values before and
  as written, and Reopen puts the old ones back unless a field was changed again by hand. A
  trimmed clip needs accepting again in Cut.
- **`amend_proposal`** lets an agent revise its own card still waiting, in place: title, note,
  times, colors, split names, or a change card's proposed values. Every earlier version is kept on
  the proposal with the agent's reason. The card shows **Amended**, the newest amend's changes as
  chips, and open, a table of the previous version against the newest and every version newest
  first. Decided, withdrawn and other apps' proposals can't be amended.
- **Clip ranges carry a Resolve clip color** besides the marker color: the clip color applies
  when accepted as a clip, the marker color when kept as a range marker.
- **Learning.** `get_proposal_decisions` reads back changes (before, proposed, chosen and the
  fields the user changed) and an amended proposal's versions and the version decided; the batch
  record keeps change proposals and clip colors.
- **Cards get kind icons** (the app's lucide set plus the timeline diamond and an N for Notion
  notes; a change adds a small pencil) and colors are picked from a list with a swatch before
  every name.

## Alternatives considered

- A grouped card for one change across many items (a color key on 20 markers): left for a later
  ticket; one card per item, stepped through with N and A.
- Amending decided cards: refused; a change to what accepting made is a change proposal.

## Consequences

The agent can maintain the project's markers and clips without the user redoing its work by hand,
and the record shows how each card evolved before the user decided it. Changes never apply
themselves: every one waits on a card.
