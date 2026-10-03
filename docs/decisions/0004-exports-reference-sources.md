# 0004. Reference sources in place; game-audio-only packet-copy exports

- Status: Accepted (September 29, 2026)
- Sources: [design decisions — Confirmed cutting workflow and defaults](../design-decisions.md#confirmed-cutting-workflow-and-defaults), [Milestone 2](../milestone-2.md), [filing and Library](../filing-and-library.md)

## Context

Recordings are 4K AV1 with separate game and microphone-note audio tracks. Finished clips go to Resolve, must sort chronologically, and must never contain Connor's microphone commentary.

## Decision

- Projects reference original recordings in place; importing does not copy, move or modify them.
- Exports copy the original video and the selected clean **game** audio stream without re-encoding. Microphone streams are excluded and their absence is verified. Prepared listening audio never feeds exports.
- The default container is the source container. Cuts expand outward to usable keyframes (start at or before the in-point, end at or after the out-point) with no extra padding. Requested and verified actual ranges are stored separately.
- Output Date modified is the source Date modified plus the requested in-offset, so clips sort chronologically in Explorer and Resolve.
- Publication is verified (packets, timing, chapters, hashes, dates) before a clip is reported complete; existing files are never overwritten.

## Consequences

- Adjacent exports may share boundary footage after outward snapping.
- A microphone already mixed into the game track cannot meet the exclusion guarantee.
- Export and filing work must preserve source A/V timing and annotation mappings.
