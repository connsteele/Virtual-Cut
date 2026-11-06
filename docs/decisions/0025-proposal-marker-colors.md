# 0025. Agents suggest marker colors

- Status: Proposed
- Amends: [0015](0015-agent-proposals.md) (accepting an agent marker made it Blue)
- Sources: Connor during the first real batch (VC-29, 2026-11-06: every accepted marker came in
  Blue and had to be recolored by hand), VC-200, batch feedback note 38, picker A chosen on the
  card prototype (2026-11-06)

## Context

The agent drafted a per-project color key and wanted to color its markers by it, but
`submit_proposals` had no color and accepting always made a Blue marker. Marker colors already
reach Resolve through the helper.

## Decision

- **An optional `color`** on marker, range marker and clip range proposals, one of Resolve's 16
  marker color names. Any other kind, or another name, refuses the call naming the field.
- **The card shows it** after the time code (Blue, the default, when the agent gave none). Edit
  shows a color dropdown, the same as Cut's marker list. A clip range's color applies if it is
  kept as a range marker.
- **Accept keeps the color shown**: the marker gets it and the decision records it.
- **Read back for learning.** `get_proposal_decisions` gives `proposed.color`, `chosen.color` and
  `recolored` (against Blue when the agent gave none). The batch record keeps the color in the
  first pass, in `chosen`, as a `changed.color` when the card changed it, and as a later change
  when the marker is recolored in Cut.

## Alternatives considered

- A row of 16 swatches in Edit (prototype option B): not chosen; the dropdown matches Cut and keeps
  the compact card short.

## Consequences

Not in this step: proposing a color change on an existing marker, a per-project default color,
and clip colors. The intent guide does not yet tell agents to use the project's color key (a guide
change needs Connor's OK).
