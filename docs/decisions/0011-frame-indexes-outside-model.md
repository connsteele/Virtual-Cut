# 0011. Frame and keyframe indexes live outside the editable project model

- Status: Accepted (October 3, 2026; VC-97)
- Sources: [Claude M3 Audit](https://app.notion.com/p/3ee7c5227a8081bf86a4ddf66c5b8f1b), [0.4.8 review](../review-0.4.8.md), [M3 implementation](../m3-implementation.md#project-capacity-and-change-notifications--048-vc-969798102)

## Context

Inspection records every video packet timestamp so frame stepping, frame entry, snapping and
variable-frame-rate handling are exact. These arrays were stored on each recording inside the
editable model: about 2.6 MB per hour of 60 fps footage. The model is validated against a
32 MiB edit limit on save, Undo, restore and open, and was cloned and serialized for every
project snapshot. GPT and Claude measured that a 16-hour project rejected edits and could not
reopen.

## Decision

- Store inspected `frameTimes` and `keys` in a `frame_indexes` table (saved format 5) as exact
  doubles, keyed by recording and the source fingerprint they were inspected from. A stale
  index (different fingerprint) is never returned.
- Keep only `frameCount` and `keyCount` in the model.
- Migrate after the existing verified pre-upgrade copy. Open-time validation ignores legacy
  inline indexes so an oversized project can always open and migrate. Save compaction and
  restore carry indexes.
- The renderer loads indexes on demand for recordings it displays and never sends them back in
  saves.

## Alternatives considered

Raising the size limit was rejected: it would leave the per-snapshot copying and still fail at
a larger project. Storing indexes as JSON in a table was rejected in favor of binary doubles,
which are smaller and exact.

## Consequences

- Project size, saves, Undo and snapshots no longer grow with footage length;
  `project-capacity-checks.mjs` guards this.
- Older builds cannot open format 5 projects; the pre-upgrade copy remains for them.
- New code that needs frame timing must read the index through the store or the renderer cache,
  not from `model.recordings`.
