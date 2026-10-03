# 0003. SQLite project files with session-only Undo and timed autosave

- Status: Accepted (September 30, 2026)
- Sources: [design decisions — Saving](../design-decisions.md#keyboard-preferences), [save policy](../save-policy.md), [project recovery](../project-recovery.md)

## Context

Projects must survive restarts and crashes, keep export receipts durable, and avoid excessive disk writes. An earlier design saved continuously and persisted Undo snapshots, which produced large files and heavy write volume.

## Decision

- A project is a `.vcut` SQLite file using Node's built-in SQLite runtime. Source facts, jobs and export/filing receipts are durable independently of editorial saves.
- Undo is bounded and **session-only**; saved projects do not persist Undo. Manual Save keeps the live history; reopening or restoring starts fresh. Navigation is never an Undo step, and Undo does not reset the viewing position.
- Autosave defaults to **10 minutes** (configurable), with optional saving after edits. Automatic saves wait for playback, seeking and manipulation to stop. Manual Save and normal close save immediately.
- Five autosave and five manual checkpoints are kept as verified `VACUUM INTO` copies. Schema upgrades first make a verified pre-upgrade copy; older builds refuse upgraded projects.

## Alternatives considered

Continuous edit saving with cross-session Undo was the previous behavior. It was replaced after measurement: checkpoint plus WAL bytes for the same edit pattern fell by about 99.8% (see save policy).

## Consequences

- An unexpected exit can lose edits since the last save; Manual Save protects important edits.
- Source/job/receipt writes must not flush unrelated unsaved edits.
- New persistent fields need migration and recovery coverage.
