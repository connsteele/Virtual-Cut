# 0006. OBS chapters import as point markers; markers stay distinct from clips

- Status: Accepted (September 29, 2026; range conversion refined October 1; import clip removed
  November 6, VC-206)
- Sources: [design decisions — Confirmed cutting workflow and defaults](../design-decisions.md#confirmed-cutting-workflow-and-defaults), [design decisions — Timeline interaction correction](../design-decisions.md#timeline-interaction-correction--0320)

## Context

OBS writes chapters during recording. In LosslessCut these became ranges that Connor had to correct manually, and chapter durations do not express editorial intent.

## Decision

- Recorded OBS chapters import automatically as **point markers** at their start times. Chapter end times never split recordings or imply a range.
- Point markers, range markers and exportable clips are separate concepts. Range markers are ordinary annotations with start/end, split endpoints, translucent bands and overlap lanes; they are not exports.
- Importing a recording makes **no clip** (VC-206, from the first real batch, where Connor deleted
  the whole-recording clip on every recording so footage would not export twice). Every clip is
  cut by the user or comes from an accepted cue or agent proposal. A recording with no clips says
  so in Cut and Review and exports nothing; **Whole recording** in Cut makes the old clip in one
  step. Projects keep the clips they already have.
- A point becomes a range only through an explicit action (Alt-drag, Shift-drag in Manipulate, or timing fields).
- Selection, editing and seeking are separate: single-click selects, double-click seeks, and Manipulate (H) retiming leaves the playhead fixed.

## Consequences

- Marker metadata travels to Resolve through embedded chapters plus the explicit helper (see 0009), not as standalone clips.
- Agents or cue detection may propose markers or splits, but never convert chapters automatically.
