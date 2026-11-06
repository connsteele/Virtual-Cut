# M4 review — 0.4.28

November 6, 2026. A hotfix during the first real batch (VC-29, Mass Effect footage on 0.4.27),
for the two gaps Connor hit live: stale first-pass cards he had to reject one by one, and agent
markers that always came in Blue. Built off `m4-agents-mcp` at 0.4.27; scope agreed in the
hotfix thread (withdraw tool only, no app-side "Reject all pending"; the "first step" of VC-200;
picker A from the card prototype).

## Agents withdraw their own pending proposals (VC-201)

- New MCP tool `withdraw_proposals`: up to 200 proposal ids and an optional reason (300
  characters). Only the calling app's proposals still waiting can be withdrawn; an accepted,
  rejected or another app's id refuses the whole call and names it, and nothing changes.
- Withdrawn is its own state on the stored proposal, outside the model and Undo. The card leaves
  the transcript window, its counts and the Cut previews, claims no spoken cue, and the same
  moment can be proposed again. A decision outranks a withdrawal (Redo after the agent withdrew
  what Undo reopened).
- `get_proposal_decisions` reads withdrawn apart from rejected: status `withdrawn` with when and
  why, its own count and filter; `decided` stays accepted or rejected.
- The batch record lists each withdrawal with its reason (`withdrawals`), labels the proposal
  withdrawn in its final state, and a withdrawal ends the recording's first pass. Intent scoring
  leaves withdrawn proposals out and counts them on their own.
- Activity shows "Withdrew N for <recording>".
- The transcript window now refreshes its counts when proposals arrive or leave; before, a
  submission changed no project revision and the chips waited for the next edit.
- Not in this hotfix: `replaces` on `submit_proposals`, "Reject all pending" in the app, and the
  intent guide line about withdrawing before a second pass (needs Connor's OK).

## Agents suggest marker colors (VC-200, first step)

- Optional `color` on marker, range marker and clip range proposals, one of Resolve's 16 names;
  other kinds or names refuse the call naming the field.
- The card shows the color after the time code (Blue when none was given). Edit has a color
  dropdown like Cut's marker list (picker A). Accept keeps the color shown; a clip range's color
  applies if it is kept as a range marker.
- Read-back: `proposed.color`, `chosen.color` and `recolored`. The batch record keeps the
  proposed color in the first pass, the kept color in `chosen`, `changed.color` when the card
  changed it, and a later recolor in Cut as a change after accepting. The folded card says
  "color Red → Green" when you changed it.
- Not in this hotfix: an "edit marker" proposal, a per-project default color, clip colors, and
  the intent guide line about the project's color key.

## Checks

- Unit: `agent-proposals.test.mjs` (withdraw refusals, all-or-nothing, read-back, re-proposing,
  the store; colors on submit, accept, validation and read-back), `batch-record.test.mjs`
  (withdrawals, first pass, final state; colors chosen, changed and recolored later),
  `intent-score.test.mjs` (withdrawn left out).
- Desktop: `agent-proposals-ui.mjs` withdraws one of two new cards over MCP after a refused call,
  checks the card and count leave the transcript window, Activity, decisions and the batch
  record; then a Red marker proposal is changed to Green in Edit (normal and compact window) and
  accepted, and the marker, folded card and read-back say Green.
- Screenshots: `proposal-withdraw-before.png`, `proposal-withdraw-after.png`,
  `proposal-color.png`, `proposal-color-edit.png`, `proposal-color-edit-compact.png`,
  `proposal-color-accepted.png`.

## Decisions

[0024](decisions/0024-agent-withdrawals.md) and
[0025](decisions/0025-proposal-marker-colors.md), both amending 0015.
