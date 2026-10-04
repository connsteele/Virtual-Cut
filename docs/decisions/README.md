# Decision records

Short records of confirmed architecture and product decisions: what was decided, why, what was rejected, and what it constrains. They are summaries for quick orientation and review.

[Design decisions](../design-decisions.md) remains the authoritative, detailed record of Connor's confirmed preferences until these records fully cover it. If a record and that document disagree, the design-decisions document wins and the record should be corrected.

## Records

| #                                              | Decision                                                                    | Status   |
| ---------------------------------------------- | --------------------------------------------------------------------------- | -------- |
| [0001](0001-desktop-stack.md)                  | Electron desktop app with React, TypeScript, Vite and CSS Modules           | Accepted |
| [0002](0002-native-boundary.md)                | Sandboxed renderer with a narrow typed preload; main owns native operations | Accepted |
| [0003](0003-project-storage-and-saving.md)     | SQLite project files with session-only Undo and timed autosave              | Accepted |
| [0004](0004-exports-reference-sources.md)      | Reference sources in place; game-audio-only packet-copy exports             | Accepted |
| [0005](0005-cleanup-never-deletes-outputs.md)  | Cleanup never deletes originals, completed exports or companions            | Accepted |
| [0006](0006-markers-and-clips.md)              | OBS chapters import as point markers; markers stay distinct from clips      | Accepted |
| [0007](0007-local-transcription.md)            | Local, on-demand faster-whisper transcription with immutable recognition    | Accepted |
| [0008](0008-utterance-recognition-adapters.md) | Keep utterance recognition; alignment and speakers as optional adapters     | Accepted |
| [0009](0009-resolve-handoff.md)                | Explicit Resolve helper for marker metadata; transcript import stays manual | Accepted |
| [0010](0010-floating-transcript-window.md)     | Transcript in a separate floating window, no docking                        | Accepted |
| [0011](0011-frame-indexes-outside-model.md)    | Frame and keyframe indexes live outside the editable project model          | Accepted |
| [0012](0012-change-notifications.md)           | Native change notifications instead of renderer polling                     | Accepted |

## Adding a record

Copy the template, use the next number, and link the evidence or conversation that confirmed it. A record is **Proposed** until Connor confirms it, then **Accepted**. Replace an outdated decision with a new record marked **Supersedes NNNN** and mark the old one **Superseded by NNNN**; do not rewrite history.

```markdown
# NNNN. Title

- Status: Proposed | Accepted (date) | Superseded by NNNN
- Sources: links to design decisions, research, reviews or tickets

## Context

What problem or constraint required a decision.

## Decision

What was chosen, stated so it can be checked against code.

## Alternatives considered

Options that were evaluated and why they were not chosen. Omit if none were evaluated.

## Consequences

What this enables, what it constrains, and what future work must preserve.
```
