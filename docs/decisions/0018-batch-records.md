# 0018. One batch record keeps the agent's first pass beside the exported state

- Status: Proposed
- Sources: VC-182, the October 10 intent-learning discussion, Sprint 7 refinement

## Context

Real batches are about to go through Virtual Cut: an agent makes a first pass (markers, ranges,
splits, clips), the user reviews and adjusts it, then exports. `get_proposal_decisions` records
only the card step. The misses (what the user added), the changes after accepting (trims,
renames, moved edges) and what was cut away were not kept anywhere an agent could compare.

## Decision

- **One record per batch:** `<profile>/batch-records/<project>/<batch>.json`, in per-user data,
  outside the project file, its editable model and Undo. Restoring a save copy or undoing an edit
  never changes it.
- **First pass:** frozen per recording when the agent's first proposals for it land, before any
  decision: the proposals as submitted, and the recording's clips, markers and notes at that
  moment. Submissions after the user decided a proposal on that recording are kept as runs marked
  `afterDecisions`, not as first pass. Proposals stored before batch records existed are rebuilt
  from the proposal store at export, without the state they landed on.
- **What the agent read:** each run keeps pointers, not copies: the mic and game transcript ids
  with their correction counts, the intent guide version, the agent app and model, the project
  revision, and an optional `run_intent` given to `submit_proposals`.
- **Final state:** saved whenever an export or filing in the batch is queued, so the newest one
  holds the state that went out: clips with in and out points, markers and ranges, notes, each
  linked to the proposal it came from, marked as there before the first pass, or as the user's
  own. Items carry what changed after accepting (start, end, name, note); removed items and the
  spans outside every included clip are listed; each proposal's status and chosen values are kept.
  A clip range accepted as a range marker (VC-186) carries
  `kindChange: { from: 'clip-range', to: 'range-marker' }`, in this record and in
  `get_proposal_decisions`, so the marker still counts as the agent's suggestion.
- **Size:** JSON only, no media and no file paths.
- **Read:** one read-only MCP tool, `get_batch_record`.

## Alternatives considered

- **A table in the project:** it would travel with save copies and restore, so a restore could
  roll back the record of what was exported.
- **Copying the import state or media:** large, and the transcripts and recordings already have
  ids to point at.

## Consequences

- The training pass (VC-183) and reasons on decisions (VC-173) read this record; neither is part
  of it.
- Deleting a project does not remove its batch records; they are small and live with the user's
  settings.
