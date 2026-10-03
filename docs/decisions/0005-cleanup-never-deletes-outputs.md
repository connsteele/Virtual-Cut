# 0005. Cleanup never deletes originals, completed exports or companions

- Status: Accepted (October 1, 2026)
- Sources: [design decisions — VC-26 follow-up](../design-decisions.md#vc-26-follow-up--0322), [design decisions — Storage visibility](../design-decisions.md#storage-visibility--0323), [Milestone 2 closeout](../m2-closeout.md)

## Context

Project and batch deletion must free disposable data without risking footage or finished work, including files that are shared, linked or changed outside the app.

## Decision

- Project cleanup **never** deletes source footage, completed exports or their `.vcut.json` companions, under either deletion choice.
- Cleanup may remove only verified, same-project save copies and known disposable previews. It presents the exact file list and retains shared, linked, changed, unknown or unproven files.
- It never recursively deletes the user-selected cache or destination directory. An open project is saved and closed before inspection; Cancel deletes nothing.
- Storage use is measured only when Projects opens or on explicit Refresh: no polling, decoding, hashing or arbitrary media-tree scans.

## Consequences

- Source retirement, if added, is a separate explicit workflow with its own safeguards (Later).
- Any new disposable artifact must be identifiable as project-owned before cleanup may remove it.
