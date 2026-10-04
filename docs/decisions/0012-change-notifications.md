# 0012. Native change notifications instead of renderer polling

- Status: Accepted (October 3, 2026; VC-98)
- Sources: [Claude M3 Audit](https://app.notion.com/p/3ee7c5227a8081bf86a4ddf66c5b8f1b), [0.4.8 review](../review-0.4.8.md)

## Context

The main window requested the full project snapshot every second. Each request checked every
source file and completed export on disk and recomputed destinations, whether or not anything
had changed. This conflicted with the confirmed principle of no continuous scans or polling
(see [0005](0005-cleanup-never-deletes-outputs.md) and the design decisions on storage
visibility) and would grow with project size.

## Decision

- The project store reports every durable native change (jobs, exports, sources, model writes
  and saves).
- Main throttles these into one `workspace:changed` notification at most every 250 ms, always
  followed by a trailing one so the final state is delivered.
- The renderer refreshes the snapshot on that notification and when the window regains focus or
  becomes visible. Focus refreshes also recheck files moved outside the app. Refreshes during a
  local save retry after it finishes. There is no polling timer.

## Alternatives considered

A slower fallback poll was rejected because notifications cover in-app changes and focus covers
external file moves. Moving the remaining work to a utility process is deferred (VC-104) until
measurements show it is needed.

## Consequences

- Any new native code path that changes project state must go through the store methods that
  report changes, or call the change hook, or the window will not refresh.
- External file changes appear when the user returns to the app rather than within a second
  while the window stays focused.
- Editorial commands moving fully to the main process (VC-99) can build on the same channel.
