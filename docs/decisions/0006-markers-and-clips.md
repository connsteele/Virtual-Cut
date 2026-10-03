# 0006. OBS chapters import as point markers; markers stay distinct from clips

- Status: Accepted (September 29, 2026; range conversion refined October 1)
- Sources: [design decisions — Confirmed cutting workflow and defaults](../design-decisions.md#confirmed-cutting-workflow-and-defaults), [design decisions — Timeline interaction correction](../design-decisions.md#timeline-interaction-correction--0320)

## Context

OBS writes chapters during recording. In LosslessCut these became ranges that Connor had to correct manually, and chapter durations do not express editorial intent.

## Decision

- Recorded OBS chapters import automatically as **point markers** at their start times. Chapter end times never split recordings or imply a range.
- Point markers, range markers and exportable clips are separate concepts. Range markers are ordinary annotations with start/end, split endpoints, translucent bands and overlap lanes; they are not exports.
- A point becomes a range only through an explicit action (Alt-drag, Shift-drag in Manipulate, or timing fields).
- Selection, editing and seeking are separate: single-click selects, double-click seeks, and Manipulate (H) retiming leaves the playhead fixed.

## Consequences

- Marker metadata travels to Resolve through embedded chapters plus the explicit helper (see 0009), not as standalone clips.
- Agents or cue detection may propose markers or splits, but never convert chapters automatically.
