# 0010. Transcript in a separate floating window, no docking

- Status: Accepted (October 2, 2026)
- Sources: [M3 implementation](../m3-implementation.md#persistence-and-editing), [design decisions — Transcript feature](../design-decisions.md#transcript-feature-requested-for-exploration), Production roadmap intake (VC-80)

## Context

The transcript needs space for reading, search, corrections and cue review while the main window keeps the viewer and timeline usable.

## Decision

- The transcript opens in a separate, sandboxed floating window with its own narrow IPC interface. Docking is excluded by Connor's decision.
- Clicking a word selects and seeks the main viewer; double-click opens its correction. Clicking a different word dismisses an unfinished editor without saving; clicking the same word keeps the draft.
- Closing and reopening the window in the same project restores bounded reading state (search, page, filter, highlighted word, scroll), but not drafts. Reopening the project or restarting the app starts fresh.
- Editorial commands go through the main editor's validation and Undo path. Closing the window does not stop a recognition job or discard edits.

## Consequences

- Layout and help changes for the transcript (VC-92, VC-93) happen inside this window.
- Window bounds are restored only onto a display that still exists.
